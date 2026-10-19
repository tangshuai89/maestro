import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { UseSpotifyWpsPlayer } from './useSpotifyWpsPlayer';
import {
  fetchNextTrack,
  toggleLike,
  fanOutLike,
  detectLiked,
  dislike,
  dislikeMerged,
  fetchTrackLikeCount,
  findEquivalentSource,
  getApiOrigin,
  recomputeCrossPlatformLikeTotal,
  reportRecoSignal,
  getAuthStatusValidated,
} from '../api';
import type { Track, MusicProvider, QqQuality, UnifiedSearchItem, UnifiedSourceInfo } from '../api';
import {
  readStoredProvider,
  writeStoredProvider,
  clearStoredProvider,
  readStoredQuality,
  writeStoredQuality,
  readStoredDeezerPreset,
  writeStoredDeezerPreset,
  readAudioFx,
  writeAudioFx,
} from '../lib/storage';
import {
  EQ_BANDS,
  applyPreset,
  clampGain,
  clampCrossfade,
  type AudioFxPrefs,
} from '../lib/audioFx';
import { createEqChain, pushEqGains } from '../lib/eqChain';
import { activeElementProxy, type AudioSlot, type AudioSlots } from '../lib/audioSlots';
import { createSlotLoader, type SlotLoader } from '../lib/crossfadeRunner';
import { useCoverArt } from './useCoverArt';
import { wpsLog } from '../lib/debug';
import {
  FALLBACK_PRIORITY,
  // 注意：FULL_SONG_PROVIDERS 不在这里 import —— 它只剩「对外 re-export」一个用途
  // （旧的残缺判定还在直接读它时需要）。删掉那个直接使用点后 eslint 会报
  // no-unused-vars，而 re-export 块走的是独立的 `export { X } from`，不依赖它。
  getFullSongProviders,
  shouldApplyLikeResult,
  shouldStopWpsBeforeTransition,
  isResidualAudio,
  parsePlayableQueue,
  shouldTransientRetry,
  shouldSearchEquivalent,
  isPlaybackStalled,
  STALL_PROBE_MS,
} from './usePlayer.helpers.ts';

/**
 * The playback core: everything that touches the <audio> element, the Web
 * Audio analyser graph, the track/queue state, and provider/quality
 * switching. This is deliberately one cohesive hook — the pieces share the
 * same refs and closures and are riddled with hard-won ordering fixes
 * (epoch cancellation, effect dep arrays, the search-open freeze), so
 * splitting them further would only re-introduce the closure traps the
 * comments below guard against.
 *
 * `audioRef` is owned by the caller (App) and shared with useVolume + the
 * <audio> JSX + the progress/lyrics seek paths.
 */
// 纯 helpers 拆到 ./usePlayer.helpers（ISSUES.md §5.2 partial split）。
// 这里 re-export 保持外部 import 路径不变（App.tsx / 测试继续
// `import { ... } from './usePlayer'`）。
export {
  // TRANSIENT_RETRY_MAX 生产代码不直接引用（shouldTransientRetry 用它自己的默认
  // 值），只被 usePlayer.test.mjs 导入 —— 和下面 FULL_SONG_PROVIDERS 同款理由。
  TRANSIENT_RETRY_MAX,
  FALLBACK_PRIORITY,
  FULL_SONG_PROVIDERS,
  getFullSongProviders,
  shouldApplyLikeResult,
  shouldStopWpsBeforeTransition,
  TRIAL_MAX_SEC,
  TRIAL_GAP_SEC,
  isResidualAudio,
  pickFallbackSource,
  pickUpgradeSource,
  parsePlayableQueue,
  shouldTransientRetry,
  shouldSearchEquivalent,
  isPlaybackStalled,
  STALL_PROBE_MS,
} from './usePlayer.helpers.ts';

export function usePlayer(
  /**
   * A/B 音频槽位（specs/audio-fx §2.2 crossfade）。**由调用方创建、这里只消费**——
   * 因为 `<audio>` 的 JSX 在 App 里，refs 得由创建方 attach。
   *
   * 槽位之上包了一层只读代理 `audioRef`：它每次读都返回**当前活跃元素**，
   * 于是本文件里 14 处 `audioRef.current` 一行都不用改，crossfade 开关对它们
   * 完全透明（见 lib/audioSlots.ts 的设计说明）。
   */
  slots: AudioSlots,
  /**
   * Optional Premium Spotify Web Playback SDK bridge (v2), passed as a ref
   * to break the circular dependency (App needs player.provider to decide
   * whether WPS is enabled, and usePlayer needs WPS to route transport).
   * When wpsRef.current is ready AND the current track is from spotify,
   * transport commands (play / pause / resume) route through WPS instead of
   * the HTML <audio> element. For non-spotify tracks or when WPS isn't ready,
   * the existing <audio> path is used unchanged.
   */
  wpsRef?: RefObject<UseSpotifyWpsPlayer | null>,
  /**
   * Spotify product tier (premium/free/open/undefined). Passed as a ref to
   * read the latest value without re-running effects. Used by tryUpgradeFromTrial
   * to decide whether Spotify is a valid full-track upgrade target.
   */
  spotifyTierRef?: RefObject<string | undefined>,
  /**
   * 播放彻底失败（重试 + 跨平台 fallback 都试过）后，用来判断"是不是登录过期了"
   * 的回调（spec: specs/auth-resilience Phase 10）。
   *
   * 为什么需要它：`<audio src>` 拿不到服务端 401 的 body，只能看到
   * `MediaError code=4`。所以必须**再问一次服务端**才知道是"登录过期请重登"
   * 还是"这首歌没源，换个歌吧" —— 后者不该弹登录框。
   *
   * 用 ref 而不是直接 callback：App 里 usePlayer 在 useAuth **之前**调用，
   * 直接传函数会撞上 TDZ。用 ref 由 App 在 auth 就绪后写入当前值。
   */
  onAuthExpiredRef?: RefObject<((provider: MusicProvider) => void) | null>,
) {
  const [provider, setProvider] = useState<MusicProvider | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const fromCallback = params.get('provider');
    if (fromCallback === 'qq' || fromCallback === 'netease') return fromCallback;
    return readStoredProvider();
  });
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fanOutCount, setFanOutCount] = useState<number>(0);
  // 当前播放曲目对应的 UnifiedSearchItem（reactive 镜像 — render 用）。
  // ref 在 presentTrack 等热路径里更新，但 TheaterView 等子组件需要 re-render，
  // 所以同时 setState。setCurrentUnified 不带 prev 回调：与 currentUnifiedRef
  // 一一对应，写 ref 的同一处必然 setState，不需要 reconcile。
  const [currentUnified, setCurrentUnified] = useState<UnifiedSearchItem | undefined>(undefined);
  // 本首歌是否因请求音质是 VIP 试听、被自动降到标准音质播放（UI 如实展示）。
  const [trialFellBack, setTrialFellBack] = useState(false);

  const [qqQuality, setQqQuality] = useState<QqQuality>(() => readStoredQuality());
  // presentTrack reads the current quality via ref to avoid a dep on it.
  const qqQualityRef = useRef<QqQuality>(qqQuality);
  qqQualityRef.current = qqQuality;

  const [deezerPreset, setDeezerPreset] = useState<string>(() => readStoredDeezerPreset());

  // Search-mode client queue. Non-empty → loadNextTrack advances within the
  // results instead of hitting the server radio. Held in a ref so
  // loadNextTrack's closure doesn't read a stale value. Unified search adds
  // unifiedItems + mergedId for the heart fan-out path.
  // `unifiedItems` is kept ALIGNED with `tracks` (both index by idx) — playSearch
  // drops non-playable items from BOTH so idx maps to the right unified item.
  // mergedId is derived per-track as unifiedItems[idx].id (not a fixed field).
  const queueRef = useRef<{
    tracks: Track[];
    idx: number;
    unifiedItems?: UnifiedSearchItem[];
    /**
     * Reco queues only: fetch the next batch when the last track ends, instead
     * of looping back to #1. Returns the raw unified items for the next batch
     * (parsed + appended by loadNextTrack). Search / liked-library queues leave
     * this undefined and keep the classic looping behaviour.
     */
    loadMore?: () => Promise<UnifiedSearchItem[]>;
  } | null>(null);
  // Reactive 镜像 of queueRef.idx / unifiedItems — ref 改了 consumer 收不到，
  // TheaterView 的「推荐卡跟随队列位置」（spec 2026-09-21）需要 state。
  // presentTrack / switchToProvider / resetForSwitch 都同步写一次（只有 idx
  // 真变了才 setState，避免跨平台 fallback 同首重 presentTrack 时无意义 re-render）。
  const [queueSnapshot, setQueueSnapshot] = useState<{
    idx: number;
    items: UnifiedSearchItem[] | undefined;
  }>({ idx: -1, items: undefined });
  // Guards the async detect-liked result: only apply if the queue is still on
  // the same unified track we detected for (avoids a stale detect clobbering a
  // newer song's ❤ state after a fast skip).
  const activeMergedIdRef = useRef<string | undefined>(undefined);
  // refreshLikedState 的「代」计数：每次触发自增，poll 循环只认自己那一代——
  // 换歌 / 新的 refresh 触发时旧 poll 立即让位，避免旧循环覆盖新歌角标。
  const likedRefreshGenRef = useRef(0);
  // T6 (consistency-fixes D2)：handleLike / handleDislike 的「任务票据」。
  // 每次 ❤/踩 都 ++，await 回来后比对当前票据与启动时票据：
  //   - 不等 → 旧 in-flight 结果丢弃（用户已切歌 / 已再次点击）；
  //   - 等   → 才应用 setTrack/setFanOutCount。
  // 同时要求 `trackRef.current?.id === startedTrackId`：切歌后旧结果也丢。
  const likeTicketRef = useRef(0);
  // On source switch with a track playing, skip one provider-change auto-load
  // so the current song keeps playing until it ends / the user skips.
  const skipAutoLoadRef = useRef(false);
  // 行为信号去重：同一首歌（provider:id）只在"开始播放"时上报一次 play，
  // 避免 WPS 重载 / 音质切换 等重放路径把同一首重复上报。
  const signaledTrackRef = useRef<string | null>(null);

  // ── 行为信号：开始播放 ──────────────────────────────────
  // 推荐质量真正吃的是"最近在听什么"，而红心库只能说明"曾经喜欢"。这里把
  // 播放行为上报给服务端（只落本机 .storage，不上传），供口味档案加权 +
  // 负反馈闭环使用。同一切歌多次重放（WPS 重载 / 音质切换）只记一次。
  useEffect(() => {
    if (!track?.id || !track.title || !track.artist) return;
    const key = `${track.provider}:${track.id}`;
    if (signaledTrackRef.current === key) return;
    signaledTrackRef.current = key;
    reportRecoSignal({ type: 'play', title: track.title, artist: track.artist });
  }, [track?.id, track?.provider, track?.title, track?.artist]);
  // For quality switches: jump back to the original position after reload.
  const pendingSeekRef = useRef<number | null>(null);
  // WPS: 最近一次通过 WPS play() 送出的 spotify track id。用来区分
  // 当前活跃 <audio> 的只读代理。见签名处的说明：14 处 audioRef.current 不用改。
  const audioRef = useMemo(() => activeElementProxy(slots), [slots]);

  // 槽位切换版本号：crossfade 换歌会让"当前播放元素"**易主**，而事件监听是
  // 在 effect 里绑到具体元素上的（audioRef 是稳定代理，effect 不会因此重跑）。
  // 靠订阅槽位变更 bump 版本号，把监听重绑到新的活跃元素。
  const [slotVersion, setSlotVersion] = useState(0);
  useEffect(() => slots.subscribe(() => setSlotVersion((v) => v + 1)), [slots]);

  // "切到新歌 → play(newUri)" 和 "同一首暂停后恢复 → resume()"。
  const wpsPlayedIdRef = useRef<string | null>(null);

  // 跨平台自动降级用的三件套：
  //  - currentUnifiedRef：当前在播这首「统一 track」（含各平台 source）。
  //    radio 单平台 track 没有 unified item → undefined，降级直接跳过。
  //  - triedPlatformsRef：本首歌已经试过的平台，防止在 sources 间来回死循环。
  //  - trackRef：最新 track 的镜像，降级构造 fallback track 时读当前平台 /
  //    保留红心态，避免把 track 塞进各 effect 的依赖数组。
  const currentUnifiedRef = useRef<UnifiedSearchItem | undefined>(undefined);
  const triedPlatformsRef = useRef<Set<MusicProvider>>(new Set());
  const trackRef = useRef<Track | null>(null);
  // audio 元素当前 src 的镜像：onError 的"同源重试 1 次"延迟 800ms 后用这个判
  // 用户这期间切歌没；切了就不该重试旧 src，应直接 fallback / 报错。
  const currentSrcRef = useRef<string>('');
  // onError 重试同源 1 次的 guard flag：避免同一波错误反复触发而不停重试。
  // 切歌时（presentTrack）重置。
  const retryAttemptedRef = useRef(false);
  // ⚠️ 同源重试**次数**（2026-10-19 修）：原实现是「重试成功后把 guard 清零」，
  // 而 play() 在坏源上照样 resolve → 清零 → 下一个 error 又满足重试条件 →
  // 「error → 重试 → resolve → 清零 → 再 error」无限循环，永远走不到跨平台
  // 兜底。改成按本首歌累加次数（presentTrack 重置），由 shouldTransientRetry
  // 收敛到 TRANSIENT_RETRY_MAX 次。
  const transientAttemptsRef = useRef(0);
  // 「重试 resolve 了但其实没出声」的探测定时器。
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current != null) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      clearStallTimer();
    },
    [clearStallTimer],
  );
  // 换歌 / 换源计数。跨 await 的竞态守卫**不能只靠 currentUnifiedRef 的 id**：
  // radio 路径的 track 没有 unified（id 是 undefined），`undefined === undefined`
  // 在切歌后依然成立 —— 结果就是"用户已经切歌了，回调的旧结果照样生效"。
  const songEpochRef = useRef(0);
  // radio 路径的兜底闸：同**一首歌**只许换一次源。
  //
  // unified 路径天然安全（presentFallbackSource 带着同一个 unified 回去，
  // isNewSong=false → triedPlatforms / serverEquivTried 都不重置）。radio
  // 不行：它没有 unified，presentTrack 把它当**新歌** → 把
  // serverEquivTriedRef 清成 false → 新源再失败就又去搜 → 可能搜回原平台，
  // qq↔netease 无限来回换。所以这里按「歌的身份」而不是「换了没换歌」来记。
  const radioFallbackKeyRef = useRef<string | null>(null);
  trackRef.current = track;
  // 本首歌是否已经问过服务端要跨平台等价源（每首歌只问一次，避免死循环）。
  // 用于「unified item 只有 netease 一个 source、netease 又挂了」时向服务端
  // 实时匹配一个 QQ/其它平台的可播放源。换新歌时在 presentTrack 里重置。
  const serverEquivTriedRef = useRef(false);
  // VIP 30s 试听自动升级用：
  //  - trialServerTriedRef：本首歌是否已就「试听」问过服务端等价源（每首一次）。
  //    与 serverEquivTriedRef 分开——试听升级和 code=4 降级是两条独立触发。
  //  - trialEvaluatedRef：当前这个音源是否已做过试听判定（每次上源一次，防
  //    onLoadedMetadata/onDurationChange 重复触发；每次 presentTrack 重置）。
  const trialServerTriedRef = useRef(false);
  const trialEvaluatedRef = useRef(false);
  // 本首歌是否已就"试听"降到过标准音质重试（每首一次）。很多 VIP 试听其实是
  // "无损/极高是 VIP、标准免费全曲"，降标准通常直接拿到全曲；每首歌只降一次，
  // 标准仍是试听才继续跨平台。换新歌时在 presentTrack 里重置。
  const forcedStandardRef = useRef(false);

  // Web Audio graph — created lazily on the first play (autoplay policy gates
  // AudioContext + MediaElementSource to user gestures). `analyser` is state
  // (not a ref) because the bass RAF effect below reads it as a dependency
  // and needs a real re-render when the graph comes online.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  /**
   * 每个槽位一条独立的 Web Audio 链（specs/audio-fx §2.2）：
   *
   *     <audio> → source → f0 … f9 → fadeGain → analyser → destination
   *                                            └──────────┘
   *
   * `createMediaElementSource` **每个元素只能调一次且永久改路由**，所以两条链
   * 必须分别建、分别记住；把两个元素接同一张图 = 没法分别淡入淡出。
   * fadeGain 夹在 EQ 与 analyser 之间：淡变是"用户听到的音量"的一部分，
   * 放在 analyser 之后会让声波环在淡出时还显示满格。
   * 两个槽位共用**同一个 AudioContext**（浏览器限制：一个元素只能被一个
   * context 的 MediaElementSource 接管，但反过来多个元素可以共用一个 context）。
   */
  const slotGraphsRef = useRef<
    Partial<
      Record<AudioSlot, { filters: BiquadFilterNode[]; fade: GainNode; analyser: AnalyserNode }>
    >
  >({});

  // ── EQ（specs/audio-fx §2.1）────────────────────────────────
  // 10 个 peaking 滤波器在 graph **建立时**一次性插入链里，之后只改 gain
  // 参数、绝不 disconnect 重连 —— 重连发生在正在出声的时刻，会咔哒。
  /** EQ 滤波器已随每槽链建好；这里只做"当前活跃槽的曲线镜像"，推参数时遍历全部槽。 */
  const [audioFx, setAudioFx] = useState<AudioFxPrefs>(() => readAudioFx());
  // graph 可能还没建（首次播放前），届时用 ref 里的最新偏好初始化滤波器。
  const audioFxRef = useRef<AudioFxPrefs>(audioFx);
  audioFxRef.current = audioFx;

  /**
   * 把偏好落到 live 滤波器上。
   *
   * 开关关闭时是「把各频段 ramp 到 0 dB」而不是把滤波器从链上摘掉——
   * 真正的 bypass 要 disconnect，发生在出声时会咔哒（见 spec §7 风险）。
   * 用户曲线存在 prefs 里，重新打开开关恢复原样而不是被抹平。
   * 用 setTargetAtTime 而非 `.value =`：后者是阶跃，会咔哒。
   */
  const pushEqToFilters = useCallback((prefs: AudioFxPrefs): void => {
    const ctx = audioCtxRef.current;
    const at = ctx?.currentTime ?? 0;
    // 两槽都要推：EQ 开着时次槽正在淡入，它的曲线也得是用户的曲线。
    for (const g of Object.values(slotGraphsRef.current)) {
      if (g) pushEqGains(g.filters, prefs.eqGains, at, prefs.eqEnabled);
    }
  }, []);

  const { bgLayerRef, coverBackdropRef, presentCover, presentPlaceholder } = useCoverArt();

  /**
   * 惰性建某个槽位的 Web Audio 链（specs/audio-fx §2.1 EQ + §2.2 crossfade）：
   *
   *     <audio> → source → f0 … f9 → fadeGain → analyser → destination
   *
   * 两个关键约束（都来自 spec §7，写错了不报错、只表现为"不响 / 发糊 / 咔哒"）：
   *  - `createMediaElementSource` **每个元素只能调一次且永久改路由**：漏掉
   *    `connect` 就是全静音且无报错（2026-09-29 真踩过）。
   *  - EQ 节点在**建链时**就全部插好（哪怕增益全 0），之后只改 gain 参数、
   *    绝不 disconnect 重连 —— 重连发生在正在出声的时刻必然咔哒。
   *
   * fadeGain 初始为 1（不因为建了 crossfade 就默认变小）。
   */
  const ensureSlotGraph = useCallback(
    (slot: AudioSlot): GainNode | null => {
      const audioEl = slots.el(slot);
      if (!audioEl) return null;
      const existing = slotGraphsRef.current[slot];
      if (existing) {
        // 已建 —— 只确保 context 在跑（失焦时某些系统会挂起它）。
        const ctx = audioCtxRef.current;
        if (ctx?.state === 'suspended') {
          void ctx.resume().catch((e) => console.warn('[audio] context resume() rejected:', e));
        }
        return existing.fade;
      }
      try {
        const Ctor: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = audioCtxRef.current ?? new Ctor();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaElementSource(audioEl);

        const filters = createEqChain(ctx, EQ_BANDS, src);
        // 淡变用的乘法增益。EQ 之后、analyser 之前（声波环要反映用户听到的
        // 音量：淡出到一半时频谱就该跟着暗下去）。
        const fade = ctx.createGain();
        fade.gain.value = 1;
        filters[filters.length - 1]?.connect(fade);

        const node = ctx.createAnalyser();
        node.fftSize = 256;
        node.smoothingTimeConstant = 0.72;
        // 单路串到 destination：绝不要再把 fade 单独接一次 destination，
        // destination 会把同一份信号相加（凭空 +6dB）。
        fade.connect(node);
        node.connect(ctx.destination);
        slotGraphsRef.current[slot] = { filters, fade, analyser: node };

        // graph 刚建好，把当前偏好一次性灌进去（之前调过 EQ 也会保留）。
        const ctx2 = audioCtxRef.current;
        pushEqGains(
          filters,
          audioFxRef.current.eqGains,
          ctx2?.currentTime ?? 0,
          audioFxRef.current.eqEnabled,
        );
        if (ctx.state === 'suspended') {
          void ctx
            .resume()
            .catch((e) => console.warn('[audio] initial context resume() rejected:', e));
        }
        // analyser 是"当前活跃槽"的状态：建好新槽时同步一次，声波环才能跟着
        // crossfade 换元素读。
        if (slot === slots.active()) setAnalyser(node);
        return fade;
      } catch (e) {
        console.error(`[audio] failed to build audio graph for slot ${slot}`, e);
        return null;
      }
    },
    [slots],
  );

  /** 兼容旧调用点：建/取**活跃槽**的 analyser。 */
  const ensureAudioGraph = useCallback((): AnalyserNode | null => {
    ensureSlotGraph(slots.active());
    return analyser;
  }, [analyser, ensureSlotGraph, slots]);

  /**
   * 把 analyser 状态切到当前活跃槽（crossfade 换槽后调用）。
   *
   * 声波环（bass RAF effect）读的是 state 里的 analyser，所以"逻辑上当前在播
   * 哪个元素"变了就得同步换观察点——否则淡入淡出过程中频谱还在读旧元素，
   * 而旧元素正在淡出（越来越小声）却显示满格。
   */
  const syncAnalyserToActiveSlot = useCallback(() => {
    setAnalyser(slotGraphsRef.current[slots.active()]?.analyser ?? null);
  }, [slots]);

  /**
   * 切歌执行器（specs/audio-fx §2.2）。实现全在 lib/crossfadeRunner.ts —— 这里
   * 只把 usePlayer 的内部状态注入进去，并且**只在依赖变化时重建**（它内部有
   * 定时器，重建必须先 dispose，否则旧定时器会孤儿 pause 元素）。
   */
  const slotLoaderRef = useRef<SlotLoader | null>(null);
  const loaderDepsRef = useRef({
    ensureSlotGraph,
    slots,
    syncAnalyserToActiveSlot,
    getFade: (slot: AudioSlot) => slotGraphsRef.current[slot]?.fade ?? null,
    now: () => audioCtxRef.current?.currentTime ?? 0,
  });
  loaderDepsRef.current = {
    ensureSlotGraph,
    slots,
    syncAnalyserToActiveSlot,
    getFade: (slot: AudioSlot) => slotGraphsRef.current[slot]?.fade ?? null,
    now: () => audioCtxRef.current?.currentTime ?? 0,
  };
  if (!slotLoaderRef.current) {
    const deps = loaderDepsRef.current;
    slotLoaderRef.current = createSlotLoader({
      slots: deps.slots,
      getFade: (s) => loaderDepsRef.current.getFade(s),
      now: () => loaderDepsRef.current.now(),
      ensureGraph: (s) => loaderDepsRef.current.ensureSlotGraph(s),
      onActiveChanged: () => loaderDepsRef.current.syncAnalyserToActiveSlot(),
    });
  }
  // 卸载时清掉孤儿定时器（真机上它会 pause 元素 / 改增益）。
  useEffect(
    () => () => {
      slotLoaderRef.current?.dispose();
      slotLoaderRef.current = null;
    },
    [],
  );

  /**
   * **同一首歌**换 URL（切音质 / VIP 试听降标准重试）——把新 URL 装回**当前活跃
   * 元素**，不换槽、不淡变（还是那首歌，淡入淡出没有意义）。
   *
   * ⚠️ 这条路径以前靠 React 的 `src={track.audioUrl}` 绑定生效：src 改成命令式
   * 装载（crossfade 必需）之后，`setTrack({...prev, audioUrl})` 只会改 React
   * 状态，元素永远不去加载新 URL —— 表现为「音质切了 / 降标准了，但还是 00:00
   * 不出声」。凡是改 audioUrl 的地方都必须显式走这里。
   *
   * 刻意**不动** `dataset.wantPlay`：保持改动前的行为（用户暂停着切音质 → 不
   * 会因为这次 reload 突然自己播起来）。
   */
  const reloadActiveWithUrl = useCallback((url: string) => {
    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
  }, []);

  const loadIntoSlots = useCallback((url: string, wpsActive: boolean) => {
    const loader = slotLoaderRef.current;
    if (!loader) {
      // ⚠️ 到这里 = 切歌执行器被卸载清理掉了还没重建（ref 为 null）。原来的
      // `?.load()` 是**静默 no-op**：React 状态照变、界面照更新，但音频元素
      // 从头到尾没被装载过一次 —— 症状是「歌名封面都换了，就是 00:00 不出声」，
      // 而且日志里什么都看不到。这条必须炸出来。
      console.error('[audio] slot loader 缺失 —— 切歌被静默跳过（audioUrl=' + url + '）');
      return;
    }
    loader.load(url, wpsActive, audioFxRef.current.crossfadeSec);
  }, []);

  // Present a Track to the player: resolve absolute audioUrl, swap cover,
  // set play intent. Shared by the server radio and search-result paths.
  // `unified`（可选）是这首歌的跨平台源信息：传了它，播放失败时才能自动
  // 降级到其它平台。radio 单平台 track 不传。
  const presentTrack = useCallback(
    (next: Track, unified?: UnifiedSearchItem) => {
      // 换歌就重置「已试平台」；同一首歌的跨平台降级复用 presentTrack 但要
      // 保留记录（否则 netease→qq 失败后又把 netease 当没试过 → 死循环）。
      const isNewSong = !unified || unified.id !== currentUnifiedRef.current?.id;
      currentUnifiedRef.current = unified;
      setCurrentUnified(unified);
      // 切歌瞬间 fire-and-forget 拉 ❤ 数（覆盖电台路径：电台自动切歌时
      // searchUnified 不会触发 fillLikeCountsForItems，需 renderer 端单独触发）。
      // 2s 超时不阻塞；同一首歌重复切同一首也安全（fill 完再做一次 likeCount
      // 返回新对象，前端用 setX(mutated) 触发 re-render）。
      if (unified) void fillLikeCountForCurrentTrack(unified, setCurrentUnified);
      if (isNewSong) {
        triedPlatformsRef.current = new Set();
        serverEquivTriedRef.current = false;
        trialServerTriedRef.current = false;
        forcedStandardRef.current = false;
        // Bug #2 (stability-bug2-wps-double-play)：换歌 / 切 provider 时
        // 清掉上次 WPS.play 的 track id——否则切到 QQ 再切回 spotify 同一
        // 首时 useEffect 的 `wpsPlayedIdRef.current !== track.id` 判 false
        // 会走 wps.resume()（deck 上其实已经没有这首歌了）。useEffect 顶
        // 部守卫会在切歌瞬间 pause 一次 WPS，这里只是把 ref 也同步清掉。
        wpsPlayedIdRef.current = null;
      }
      triedPlatformsRef.current.add(next.provider);
      // 每次上源（含跨平台切换）都要对新源重做一次试听判定。
      trialEvaluatedRef.current = false;
      // 新上的源默认按用户选的音质播——清掉"试听回退到标准"的标记。standard
      // 重载走的是 setTrack（不经 presentTrack），所以那个标记能一直保留到换歌 /
      // 跨平台换源为止（那两种才经过这里）。
      setTrialFellBack(false);
      // 每次上歌/换源都先清掉上一次的报错——切到下一首/降级成功后不该再
      // 残留旧的 "音频加载失败" 弹窗。真正失败会在 onError 里重新 setError。
      setError(null);
      // Audit A3 (consistency-fixes T1): use the live sidecar origin
      // instead of the module-load snapshot so radio next-track previews
      // fired after `sidecar-ready` see the real URL.
      let audioUrl =
        next.audioUrl && next.audioUrl.startsWith('/')
          ? getApiOrigin() + next.audioUrl
          : next.audioUrl;
      // QQ / NetEase: append the selected quality to the stream URL.
      if (
        (next.provider === 'qq' || next.provider === 'netease') &&
        audioUrl.includes(`/music/stream/${next.provider}/`)
      ) {
        const sep = audioUrl.includes('?') ? '&' : '?';
        audioUrl += `${sep}q=${qqQualityRef.current}`;
      }
      // Spotify Premium + WPS ready：清空 audioUrl，否则 <audio> 会同时播
      // 30s 预览代理，跟 WPS 全曲流冲突（双声道）。WPS 就绪判断懒读 ref。
      if (next.provider === 'spotify' && wpsRef?.current?.wpsReady) {
        audioUrl = '';
        wpsLog('presentTrack', `provider=spotify && wpsReady=true → 清空 audioUrl（WPS 全曲接管）`);
      } else if (next.provider === 'spotify') {
        wpsLog(
          'presentTrack',
          `provider=spotify 但 wpsReady=${Boolean(wpsRef?.current?.wpsReady)} → 走 30s 预览路径（如果 Premium 但仍卡 30s，看 enabled/wpsReady/connect 日志）`,
        );
      }
      if (next.coverUrl) {
        // presentCover reads the ref.current INSIDE its async work, so it
        // writes onto the freshly-remounted cover div (key={track.id} makes
        // the cover unmount/remount on every track change).
        presentCover(next.coverUrl);
      } else {
        // No artwork → generate a stable gradient placeholder from the song
        // identity. Also overwrites the previous track's cover in the blurred
        // bg-layer (which presentCover would otherwise leave stale).
        presentPlaceholder(next.title || next.artist ? `${next.title}·${next.artist}` : next.id);
      }
      setTrack({ ...next, audioUrl });
      // audioUrl 是最终落到 <audio src={...}> 的 URL（含 API_ORIGIN 前缀、
      // QQ/网易云追加 ?q=、Spotify WPS 清空）。用它镜给 currentSrcRef，
      // onError 的"800ms 同源重试"判用户期间是否切歌时用。
      currentSrcRef.current = audioUrl ?? '';
      // 同源重试的 guard 在每次 presentTrack 重置——跨平台 fallback 算新 URL,
      // 给 1 次重试机会。
      retryAttemptedRef.current = false;
      // 重试次数按「本首歌」计数，切歌归零（否则第一首的坏源会吃掉后面的额度）。
      transientAttemptsRef.current = 0;
      clearStallTimer();
      // 换歌计数 +1：跨 await 的兜底回调靠它判"用户是不是已经切歌了"。
      songEpochRef.current += 1;
      // 清掉可能残留的「同源重试保位」——上一首歌的 transient 重试若在换歌前
      // 没落地（load 失败 → loadedmetadata 没 fire），pendingSeekRef 会漏到这首
      // 新歌把它错误地 seek 过去。换歌一律从 0 起。
      pendingSeekRef.current = null;
      setCurrentTime(0);
      // ── 装载 + 起播（含 crossfade，specs/audio-fx §2.2）────────────
      //
      // src **不再**由 React 的 `src={track.audioUrl}` 绑定：淡入淡出要求"旧歌
      // 留在原元素上继续播、新歌进另一个元素"，而 React 改 src 会立刻把新 URL
      // 甩到同一个元素上、把正在淡出的歌掐断。所以这里改成命令式装载（App 里
      // 的 `<audio>` 不再绑 src），并在最后显式 load()。
      loadIntoSlots(audioUrl, Boolean(wpsRef?.current?.wpsReady));
      setPlaying(true);
      // 同步 queueSnapshot（idx / items）给 reactive consumer；只有 idx 真变了
      // 才 setState，避免同首跨平台 fallback 重复 presentTrack 时无意义 re-render。
      const qSnap = queueRef.current;
      setQueueSnapshot((prev) => {
        const newIdx = qSnap?.idx ?? -1;
        if (prev.idx === newIdx) return prev;
        return { idx: newIdx, items: qSnap?.unifiedItems };
      });
      // NOTE: do NOT build the audio graph here — it requires a real user
      // gesture. The graph is built lazily on the first play (onPlay /
      // handlePlayPause). Until then audio plays through the default path.
    },
    [presentCover, presentPlaceholder, loadIntoSlots, wpsRef, setQueueSnapshot, clearStallTimer],
  );

  /** 用一个跨平台 source + 展示元数据构造 fallback Track 并重播。同一首歌
   *  → presentTrack 里 isNewSong=false，triedPlatformsRef / serverEquivTriedRef
   *  累加不清零，避免死循环。 */
  const presentFallbackSource = useCallback(
    (
      src: UnifiedSourceInfo,
      unified: UnifiedSearchItem | undefined,
      display: { title: string; artist: string; album: string; coverUrl: string; duration: number },
    ) => {
      const fallback: Track = {
        id: src.trackId,
        provider: src.platform,
        title: display.title,
        artist: display.artist,
        album: display.album,
        coverUrl: display.coverUrl,
        audioUrl: src.url,
        duration: display.duration,
        // 跨平台是同一首歌，红心态一致 —— 保留，别被降级重置成未收藏。
        liked: trackRef.current?.liked ?? false,
        mediaMid: src.mediaMid,
      };
      console.warn(
        `[audio] "${display.title}" 在 ${trackRef.current?.provider} 播放失败，` +
          `自动切到 ${src.platform} 源`,
      );
      presentTrack(fallback, unified);
    },
    [presentTrack],
  );

  /**
   * 当前源播放失败时，自动降级到同一首歌的其它平台源。两级：
   *  1. **item 内**：unified.sources 里还没试过的平台（快，无网络）。
   *  2. **服务端实时匹配**：item 只有一个 source（如 netease-only 库条目），
   *     netease 又挂了 → 问服务端去其余已登录平台搜同名同时长的等价源
   *     （每首歌只问一次）。这修的正是「突然好想你只有网易云源、code=4 后无源
   *     可退」的盲点。
   * 成功切源 → true（onError 不报错）；彻底无源 → false，交调用方报错。
   */

  /**
   * 对指定 provider 跑一次「是否登录过期」的服务端校验（spec: specs/auth-resilience Phase 10）。
   *
   * **调用前提**：已经观察到该 provider 的播放异常（取流失败 / 30s 试听），
   * 怀疑是登录态掉了，不是"这首歌没版权"。若 `validate=1` 返回
   * `expired:true` → 通知上层弹重登（onAuthExpiredRef）。只对 QQ 有意义
   * （目前只有 QQ 实现了探针），其它 provider 调用直接 no-op。
   *
   * ⚠️ 这是**异步后台补查**：当前源的降级/试听流程不阻塞，避免打断"切到
   *   Deezer 30s 预览先能听"的体验。命中过期才弹窗。
   */
  const checkProviderAuthExpired = useCallback(
    (provider: MusicProvider): void => {
      if (provider !== 'qq') return; // 目前只有 QQ 探针；netease/spotify 另立 Phase 11
      void (async () => {
        try {
          const st = await getAuthStatusValidated(provider);
          if (st.expired === true) {
            onAuthExpiredRef?.current?.(provider);
          }
        } catch {
          /* 探不通就当作没过期 —— 宁可少提示，不要误伤正常降级 */
        }
      })();
    },
    [onAuthExpiredRef],
  );

  /**
   * 播放彻底失败后的收尾（spec: specs/auth-resilience Phase 10）。
   *
   * 「重试 + 跨平台 fallback 都试过」之后仍失败，原因有多种，从 `<audio>` 的
   * `MediaError code=4` 分不出来：
   *   - 登录过期了（所有源都取不到流）
   *   - 这首歌所有平台都没源 / 都受限
   * 用户诉求是第一种要弹「重新登录」，第二种不该弹。
   *
   * 所以这里**再问一次服务端**（带 validate=1 的 status）。只在已失败后发，
   * 正常播放路径零额外请求；服务端还有 10min session 级缓存。
   */
  const reportPlayFailure = useCallback(
    (failedProvider: MusicProvider, code: string) => {
      void (async () => {
        try {
          const st = await getAuthStatusValidated(failedProvider);
          if (st.expired === true) {
            onAuthExpiredRef?.current?.(failedProvider);
            return;
          }
        } catch {
          /* 探不通就按普通播放失败处理 —— 宁可少提示，不要卡住用户 */
        }
        setError(`音频加载失败（${code}），请尝试切歌`);
      })();
    },
    [onAuthExpiredRef],
  );

  const tryFallbackSource = useCallback(async (): Promise<boolean> => {
    const unified = currentUnifiedRef.current;
    const cur = trackRef.current;
    if (!cur) return false;
    const tried = triedPlatformsRef.current;
    // 展示元数据：有 unified 用它（更全，有 album/cover），radio track 用 track 自己。
    const display = unified
      ? {
          title: unified.title,
          artist: unified.artist,
          album: unified.album,
          coverUrl: unified.coverUrl,
          duration: unified.duration,
        }
      : {
          title: cur.title,
          artist: cur.artist,
          album: cur.album,
          coverUrl: cur.coverUrl,
          duration: cur.duration,
        };

    // 1) item 内其它平台 source（**需要 unified**：radio track 没有跨平台源表）。
    if (unified) {
      const inItem = FALLBACK_PRIORITY.filter((p) => !tried.has(p))
        .map((p) =>
          // Bug #3 防御性：过滤 vipLocked——否则 code=4 后切到 vipLocked 源仍是 30s。
          unified.sources.find((s) => s.platform === p && s.hasCopyright && !s.vipLocked),
        )
        .find((s): s is UnifiedSourceInfo => Boolean(s));
      if (inItem) {
        presentFallbackSource(inItem, unified, display);
        return true;
      }
    }

    // 2) 服务端实时跨平台匹配（每首歌一次）。
    //
    // ⚠️ **unified 不是前置条件**（2026-10-19 修的洞）：QQ 电台 track 由服务端
    // 单平台生成、没有 unified，旧代码在这里直接 `return false` —— 于是电台歌
    // 在 QQ 拿不到流时**一条兜底都没有**，界面停在「等待播放」还显示 READY。
    // `findEquivalentSource` 只吃 {title, artist, duration}，radio track 一样有。
    // radio（无 unified）按歌身份去重，unified 路径沿用 per-song 的 guard。
    const radioKey = unified ? null : `${cur.title}|${cur.artist}`;
    const alreadyTried = radioKey
      ? radioFallbackKeyRef.current === radioKey
      : serverEquivTriedRef.current;
    if (!shouldSearchEquivalent({ hasTrack: true, alreadyTried })) {
      if (!unified) {
        console.warn(`[audio] "${cur.title}" 兜底跳过：同歌已换过一次源（防 qq↔netease 来回换）`);
      }
      return false;
    }
    if (radioKey) radioFallbackKeyRef.current = radioKey;
    else serverEquivTriedRef.current = true;
    const songId = unified?.id; // 快照：await 期间用户可能切歌，回来要校验。
    const epoch = songEpochRef.current; // radio 路径没有 id，只能靠这个判"没换歌"
    try {
      const src = await findEquivalentSource(cur.provider, {
        title: display.title,
        artist: display.artist,
        duration: display.duration,
      });
      // 竞态守卫：await 期间已切到别的歌 → 丢弃结果。
      // ⚠️ 不能只看 unified id：radio 路径下它前后都是 undefined，切歌了也
      // 照样相等 —— 旧守卫在 radio 上等于没有。
      if (songEpochRef.current !== epoch) {
        console.warn('[audio] 兜底结果已过期（期间切歌了），丢弃');
        return false;
      }
      if (unified && currentUnifiedRef.current?.id !== songId) return false;
      // 可观测性：这条链之前是全黑的（搜到了不切、切了不出声，日志都看不出）。
      if (!src) {
        console.warn(
          `[audio] "${display.title}" 服务端没找到可播的等价源` +
            `（其它平台都是 VIP 锁 / 搜不到）→ 只能报错`,
        );
        return false;
      }
      if (triedPlatformsRef.current.has(src.platform)) {
        console.warn(`[audio] "${display.title}" 兜底到 ${src.platform}，但该平台本首歌已试过`);
        return false;
      }
      console.warn(
        `[audio] "${display.title}" 在 ${cur.provider} 播放失败，` +
          `兜底切到 ${src.platform} 源（${unified ? 'unified' : 'radio 无 unified'}）`,
      );
      presentFallbackSource(src, currentUnifiedRef.current, display);
      return true;
    } catch {
      // 网络/匹配失败 → 静默走报错。
    }
    return false;
  }, [presentFallbackSource]);

  /**
   * VIP 30s 试听自动升级：QQ/网易云对 VIP 独占曲目会返回 30s 试听片段——音频
   * **实际时长 ≈30s，但元数据是全长**。检测到后去**其它完整曲流平台**（qq/网易
   * 云）搜同名等价源换过去，把 30s 试听升级成全曲。与 tryFallbackSource 的区别：
   *  - 触发点不同：那个是 code=4 播放失败；这个是播成功但被锁成试听片段。
   *
   * 目标平台 = FULL_SONG_PROVIDERS（qq/网易云 + Premium 时的 Spotify），
   * 但**触发不限定当前平台**（2026-10-16 修正，见 onLoadedMetadata 处的注释）：
   * 当前在 Deezer/Spotify 上不等于「白换」——QQ/网易云可能有全曲版只是 VIP 锁。
   * 换源后新音源的 onLoadedMetadata 会再判一次：还是试听 → 试下一个完整平台；
   * 完整平台都试过仍是残缺 → 保持现状（由 UI 角标告知，不静默）。
   */
  const tryUpgradeFromTrial = useCallback(async (): Promise<void> => {
    const unified = currentUnifiedRef.current;
    const cur = trackRef.current;
    // 需要 unified item 才能安全升级：radio 单平台 track 没有 unified，换源时
    // presentTrack 会把它当新歌重置 triedPlatformsRef → qq↔netease 来回死循环。
    // 与 tryFallbackSource 同款约束（radio 本就没有跨平台降级）。
    if (!unified || !cur) return;
    const tried = triedPlatformsRef.current;
    const display = {
      title: unified.title,
      artist: unified.artist,
      album: unified.album,
      coverUrl: unified.coverUrl,
      // 用元数据全长——换到新源后若仍是试听，其 audio.duration 会再次远短于它。
      duration: unified.duration,
    };

    // 1) item 内其它「完整曲流」平台的源（快，无网络）。要求 !vipLocked——换到
    //    另一个已知 VIP 锁的源没意义（还是试听），跳过它。Spotify Premium 用户
    //    额外纳入 Spotify 作为有效全曲目标（WPS 解全曲）。
    const fullProviders = getFullSongProviders(spotifyTierRef?.current);
    const inItem = fullProviders
      .filter((p) => !tried.has(p))
      .map((p) => unified.sources.find((s) => s.platform === p && s.hasCopyright && !s.vipLocked))
      .find((s): s is UnifiedSourceInfo => Boolean(s));
    if (inItem) {
      console.warn(
        `[audio] "${display.title}" 疑似 ${cur.provider} 30s 试听，` +
          `升级到 ${inItem.platform} 全曲源`,
      );
      presentFallbackSource(inItem, unified, display);
      return;
    }

    // 2) 服务端实时匹配（每首歌一次），同样接受动态全曲源。
    if (trialServerTriedRef.current) return;
    trialServerTriedRef.current = true;
    const songId = unified.id;
    try {
      const src = await findEquivalentSource(cur.provider, {
        title: display.title,
        artist: display.artist,
        duration: display.duration,
      });
      if (currentUnifiedRef.current?.id !== songId) return;
      if (
        src &&
        fullProviders.includes(src.platform) &&
        !triedPlatformsRef.current.has(src.platform)
      ) {
        console.warn(
          `[audio] "${display.title}" 30s 试听，服务端匹配到 ${src.platform} ` + `全曲源，升级`,
        );
        presentFallbackSource(src, currentUnifiedRef.current, display);
      }
    } catch {
      // 匹配失败 → 保持现状（继续放 30s 试听，best-effort）。
    }
  }, [presentFallbackSource, spotifyTierRef]);

  /**
   * 检测到 VIP 试听片段后的处理，两步（先便宜的、再兜底）：
   *  1. **同平台降标准音质重试**：QQ/网易云很多"试听"其实是"无损/极高是 VIP、
   *     标准免费全曲"（本次两张截图都是「无损」）。降到标准通常直接拿到全曲，
   *     还留在用户选的平台。每首歌只降一次（forcedStandardRef）。
   *  2. **跨平台换完整曲流源**：标准也被锁成试听（整首 VIP）→ 去别的完整平台。
   * 换源/重载后新音源的 onLoadedMetadata 会再判一次，形成"标准→跨平台"的接力。
   *
   * ⚠️ 2026-10-14 报障：QQ 掉线后 GetVkey 直接返 30s 试听流（HTTP 200，
   * 不走 onError）。此刻 onLoadedMetadata 判定 isTrial 进到这里——若不在
   * 此处顺手补一次登录态探针，用户永远只会看到"30s 试听"而不是"请重新登录"。
   */
  const handleTrialDetected = useCallback(async () => {
    const cur = trackRef.current;
    if (!cur) return;
    // QQ 出现试听片段有两种可能：「这首歌是 VIP 独占」或「登录态掉了被降权」
    // （也可能是原 QQ 源失败后 tryFallbackSource 切到了网易云/Deezer 30s 试听）。
    // 无法从时长分辨，所以**异步**跑一次 validate=1 探针：过期 → 立即弹重登；
    // 有效 → 当普通 VIP 处理继续走音质降级/跨平台升级。
    if (cur.provider === 'qq' || triedPlatformsRef.current.has('qq')) {
      checkProviderAuthExpired('qq');
    }
    // 1) 同平台降标准音质重试。
    if (
      (cur.provider === 'qq' || cur.provider === 'netease') &&
      qqQualityRef.current !== 'standard' &&
      !forcedStandardRef.current
    ) {
      forcedStandardRef.current = true;
      // 去掉已有的 q=xxx 再拼 q=standard（复用 changeQuality 的写法）。
      const base = cur.audioUrl.replace(/[?&]q=[^&]*/, '').replace(/[?&]$/, '');
      const sep = base.includes('?') ? '&' : '?';
      console.warn(
        `[audio] "${cur.title}" 疑似 ${qqQualityRef.current} 音质 VIP 试听，` +
          `先降到标准音质同平台重试`,
      );
      // 让重载后的标准源重新做试听判定（setTrack 改 audioUrl 不走 presentTrack）。
      trialEvaluatedRef.current = false;
      setTrialFellBack(true); // UI 如实展示"标准(试听回退)"
      const stdUrl = `${base}${sep}q=standard`;
      // 同步 onError 用的 src 镜像——否则降标准后镜像还停在旧音质 URL，transient
      // 重试会误判"用户切歌了"直接跳过同源重试。
      currentSrcRef.current = stdUrl;
      setTrack((prev) => (prev ? { ...prev, audioUrl: stdUrl } : prev));
      // src 不再由 React 绑定 —— 必须自己把新 URL 装进元素，否则「降到标准」
      // 只改了状态、声音永远停在 00:00（crossfade 落地时踩过一次）。
      reloadActiveWithUrl(stdUrl);
      return;
    }
    // 2) 跨平台换完整曲流源。
    await tryUpgradeFromTrial();
  }, [tryUpgradeFromTrial, checkProviderAuthExpired]);

  /**
   * 切歌后的红心检测：查这首统一 track 在各平台的红心情况；任一平台已 ❤ →
   * 后端补齐其余平台 → 前端把 ❤ 点亮 + 角标显示平台数。用 activeMergedIdRef
   * 防止快速切歌时旧结果盖掉新歌状态。
   */
  const detectAndApplyLiked = useCallback(
    async (
      unified: UnifiedSearchItem | undefined,
      // D3 守护期望值：null = 不守护（detect 服务端为准；用于 loadNextTrack
      // 切歌时同步 liked）；boolean = 期望 trackRef.current.liked 与该值匹配
      // 才应用（用于 refreshLikedStateUntilStable polling 场景，防止用户 ❤
      // 翻转后 detect 旧响应覆盖手动状态）。
      //
      // 旧实现默认 = true，把「切歌后初次打开已 ❤ 歌」也短路（trackRef.cur.liked
      // 初始 false，expectedLiked=true → D3 误杀）→ ❤ 永远不亮 / fanOutCount
      // 永远 0。复刻自「盲选 - 黄霄雲」实测：用户三平台都红心，从我的喜欢打开
      // ❤ 按钮空心。
      expectedLiked: boolean | null = null,
    ): Promise<{ count: number; settled: boolean } | null> => {
      activeMergedIdRef.current = unified?.id;
      if (!unified) {
        setFanOutCount(0);
        return { count: 0, settled: true };
      }
      // 旧的「!expectedLiked 短路返」删掉：用户从未点过 ❤ 也应让 detect 跑、
      // 以服务端真相为准点亮 ❤ 按钮（修上记 blind case）。
      const sources = unified.sources
        .filter((s) => s.hasCopyright)
        .map((s) => ({ platform: s.platform, trackId: s.trackId }));
      if (!sources.length) {
        setFanOutCount(0);
        return { count: 0, settled: true };
      }
      try {
        const r = await detectLiked(unified.id, sources, {
          title: unified.title,
          artist: unified.artist,
          duration: unified.duration,
        });
        // 只在还停留在这首歌时应用（防快速切歌竞态）。null = 结果被丢弃，
        // 调用方（poll）不当作稳定值、会继续重试。
        if (activeMergedIdRef.current !== unified.id) return null;
        // D3 守护：apply 时校验 expectedLiked（仅在调用方明确传了 boolean
        // 时生效——refreshLikedStateUntilStable polling 场景）。用户主动翻转
        // ❤ 后 detect 旧响应不应覆盖手动状态。loadNextTrack 切歌场景不传
        // expectedLiked（= null）→ 跳过此守卫，让 detect 服务端结果点亮 ❤。
        if (expectedLiked !== null && trackRef.current?.liked !== expectedLiked) {
          return null;
        }
        const count = r.liked ? r.fannedOutTo.length : 0;
        setFanOutCount(count);
        setTrack((prev) => (prev ? { ...prev, liked: r.liked } : prev));
        return { count, settled: r.settled };
      } catch {
        // 检测失败不影响播放，静默。
        return null;
      }
    },
    [],
  );

  /**
   * 重检当前这首歌的 liked/fanOut 状态。用于后台跨平台匹配（LikeSyncQueue
   * discover）补齐后重新拿到更新后的 fannedOutTo，让 fanOutCount 角标准确。
   *
   * 不做单次刷新——后台 discover 是异步的（搜索 + 串行消费 + 退避重试，最多
   * 几十秒），单个 2.5s 定时器过早探查会读到 discover 落地前的中间值（角标
   * 永远停在 1，看不到后台补齐的 netease / spotify）。`refreshLikedStateUntilStable`
   * 会持续轮询直到连续两次读到相同的 count（含 liked 状态），证明后台已落定。
   * 中途换歌 / ❤↔取消 / 触发新一轮 refresh 时旧轮询自动让位（generation 计数）。
   */
  const refreshLikedState = useCallback(() => {
    void detectAndApplyLiked(currentUnifiedRef.current);
  }, [detectAndApplyLiked]);

  /**
   * 持续轮询 detect，直到后台 discover 确认落定（detect 响应 settled=true）
   * 且 liked + fanOutCount 连续两次读到相同值。返回 Promise<{ liked, count } |
   * null>，外层 stale 时返回 null（切歌 / 翻转 / 新一轮 refresh 让位）。
   *
   * ⚠️ 稳定判定的关键：**只有 settled=true 的读数才计入稳定命中**。detect 的
   * waitForSettled 只有 6s，后台 discover（跨平台搜索 + 串行队列）可能更久——
   * 尤其某个 likeable 平台没有这首歌时（如 Spotify 无中文老歌，fanOut 永远
   * 不含它，每次 detect 都重搜）。这种窗口里连续两次读到相同 count 只是
   * 「中间态没变」，不是「discover 落定」；按老逻辑判定稳定后轮询退出，discover
   * 落定（如 netease 补上、count 1→2）后没人再刷新，角标永远停在 1（用户
   * 实测：好不容易-方大同，QQ+网易云已 ❤，Spotify 无此歌，角标不显示 2）。
   * settled=false 的读数重置 lastKey/stableHits，逼轮询等到真落定。
   *
   * 节奏：前 6s 每 800ms 探一次（discover 通常 < 3s 落定），再放慢到每 2s，
   * 最多 30s 后放弃——background discover 真卡死了也不把 UI 拉死。
   */
  const refreshLikedStateUntilStable = useCallback(async (): Promise<{
    liked: boolean;
    count: number;
  } | null> => {
    const myGen = ++likedRefreshGenRef.current;
    const startTs = Date.now();
    const HARD_TIMEOUT_MS = 30_000;
    let lastKey: string | null = null;
    let stableHits = 0;
    while (Date.now() - startTs < HARD_TIMEOUT_MS) {
      if (likedRefreshGenRef.current !== myGen) return null; // 让位给新一轮
      const unified = currentUnifiedRef.current;
      if (!unified) return null;
      // T6 (consistency-fixes D3)：detect 轮询只在用户当前 liked=true 时启动。
      // 用户手动翻转（❤→不 ❤）后，`trackRef.current?.liked` 与期望不符，
      // 直接退出轮询——避免 detect 旧响应覆盖手动状态。
      const expectedLiked = trackRef.current?.liked === true;
      const res = await detectAndApplyLiked(unified, expectedLiked);
      if (likedRefreshGenRef.current !== myGen) return null;
      if (res === null) {
        // 探测失败（响应被丢弃 / 网络错）—— 重试但不计入稳定命中。
        stableHits = 0;
        lastKey = null;
      } else if (!res.settled) {
        // discover 还没落定：读到的 count 是中间态，既不算稳定命中，
        // 也不作比较基准（防止中间态与落定后的最终值恰好相同被误判稳定）。
        stableHits = 0;
        lastKey = null;
      } else {
        const liked = !!trackRef.current?.liked;
        const key = `${liked}|${res.count}`;
        if (key === lastKey) {
          stableHits += 1;
          if (stableHits >= 2) return { liked, count: res.count };
        } else {
          lastKey = key;
          stableHits = 1;
        }
      }
      const elapsed = Date.now() - startTs;
      const delay = elapsed < 6_000 ? 800 : 2_000;
      await new Promise((r) => setTimeout(r, delay));
    }
    return null;
  }, [detectAndApplyLiked]);

  /** WPS 连上后重切当前歌——从 30s 预览路径切换到 WPS 全曲路径。 */
  /**
   * 切歌时 fire-and-forget 拉 ❤ 数：
   *   1. 对 unified.sources 里 qq/netease 两个 platform 各调一次 fetchTrackLikeCount
   *   2. 写回 source.likeCount
   *   3. recomputeCrossPlatformLikeTotal 重算派生
   *   4. setCurrentUnified({...item}) 触发 React re-render（HUD 显示新数字）
   * 整体 2s 超时（公开匿名接口通常 <500ms），失败留 undefined，HUD 显示 …。
   */
  async function fillLikeCountForCurrentTrack(
    item: UnifiedSearchItem,
    setItem: (next: UnifiedSearchItem | undefined) => void,
  ): Promise<void> {
    const targets = item.sources.filter(
      (s) => (s.platform === 'qq' || s.platform === 'netease') && !s.likeCount,
    );
    if (targets.length === 0) return;
    const settled = await Promise.allSettled(
      targets.map(async (s) => {
        const r = await fetchTrackLikeCount(s.platform as 'qq' | 'netease', s.trackId);
        if (r) {
          s.likeCount = r;
        }
      }),
    );
    // 至少一个成功 → 重算 + 触发 re-render
    if (settled.some((r) => r.status === 'fulfilled')) {
      recomputeCrossPlatformLikeTotal(item);
      setItem({ ...item });
    }
  }

  const refreshTrackForWps = useCallback(() => {
    const cur = trackRef.current;
    const unified = currentUnifiedRef.current;
    if (cur && unified && cur.provider === 'spotify') {
      presentTrack(cur, unified);
    }
  }, [presentTrack]);

  const loadNextTrack = useCallback(async () => {
    if (!provider) return;
    // Search / reco / liked-library mode: advance within the results queue.
    const q = queueRef.current;
    if (q && q.tracks.length) {
      // Reco queue reached the end → pull the next AI batch and continue,
      // rather than looping back to #1 (the classic search-queue behaviour).
      const atEnd = q.idx >= q.tracks.length - 1;
      if (atEnd && q.loadMore) {
        setLoading(true);
        try {
          const more = await q.loadMore();
          // Race guard: user may have skipped / switched source / started a new
          // search during the await — only mutate if this is still the queue.
          if (queueRef.current !== q) return;
          const parsed = parsePlayableQueue(more, {
            wpsReady: Boolean(wpsRef?.current?.wpsReady),
          });
          if (parsed.tracks.length) {
            q.tracks.push(...parsed.tracks);
            (q.unifiedItems ??= []).push(...parsed.unifiedItems);
            q.idx += 1;
            presentTrack(q.tracks[q.idx], q.unifiedItems[q.idx]);
            void detectAndApplyLiked(q.unifiedItems[q.idx]);
            return;
          }
          // Next batch had nothing playable → fall through to loop so playback
          // isn't a dead end.
        } catch (e) {
          setError(`获取下一批推荐失败：${(e as Error).message}`);
          if (queueRef.current !== q) return;
          // fall through to loop
        } finally {
          setLoading(false);
        }
      }
      q.idx = (q.idx + 1) % q.tracks.length;
      presentTrack(q.tracks[q.idx], q.unifiedItems?.[q.idx]);
      void detectAndApplyLiked(q.unifiedItems?.[q.idx]);
      return;
    }
    // Radio (server) track: not a unified item, so there's no fan-out. Clear
    // the badge, otherwise it keeps showing the last search song's platform
    // count on top of unrelated radio tracks. `next.liked` (from the server)
    // still drives the ❤ fill via presentTrack.
    // T6 (consistency-fixes D4)：radio 路径 await 期间用户可能切了平台 /
    // preset（API 不支持中途切，UI 限制先于这点；但保险起见守护）。快照
    // 启动时的 provider + preset，await 回来不一致就丢弃（让新的 loadNextTrack
    // 自己 presentTrack 正确的歌）。
    const startedProvider = provider;
    const startedPreset = provider === 'deezer' ? deezerPreset : undefined;
    setFanOutCount(0);
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNextTrack(startedProvider, startedPreset);
      // D4 守护：await 期间 provider / preset 变了 → 旧的 fetchNextTrack 结果
      // 丢弃（让新的 loadNextTrack 自然 presentTrack 正确曲）。
      if (
        provider !== startedProvider ||
        (startedProvider === 'deezer' && deezerPreset !== startedPreset)
      ) {
        return;
      }
      presentTrack(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [provider, deezerPreset, presentTrack, detectAndApplyLiked, wpsRef]);

  /** Play a search result: parse UnifiedSearchItem[] into a playable queue,
   *  dropping items with no playable source. Keeps unifiedItems aligned with
   *  tracks so handleLike / detect can map idx → the right unified item. */
  const playSearch = useCallback(
    (
      unifiedItems: UnifiedSearchItem[],
      index: number,
      /** Reco only: loader for the next batch when this queue runs out. */
      loadMore?: () => Promise<UnifiedSearchItem[]>,
    ) => {
      // Keep track+unified ALIGNED: drop non-playable from both so idx maps
      // to the right unified item (for per-song ❤ detect / fan-out).
      const { tracks, unifiedItems: aligned } = parsePlayableQueue(unifiedItems, {
        wpsReady: Boolean(wpsRef?.current?.wpsReady),
      });
      const targetSrcIndex = unifiedItems[index] ? index : 0;
      const startIdx = aligned.indexOf(unifiedItems[targetSrcIndex]);
      if (startIdx < 0 || tracks.length === 0) {
        setError('没有可播放的音源');
        return;
      }
      queueRef.current = { tracks, idx: startIdx, unifiedItems: aligned, loadMore };
      setSearchOpen(false);
      setError(null);
      // New search context → clear the old fan-out count.
      setFanOutCount(0);
      presentTrack(tracks[startIdx], aligned[startIdx]);
      void detectAndApplyLiked(aligned[startIdx]);
    },
    [presentTrack, detectAndApplyLiked, wpsRef],
  );

  /** NL playlist「追加到当前队列」（specs/nl-playlist/ §UI 覆盖/追加切换）：
   *  解析后接到现有队列尾部，不清空、不切歌。没有现存队列时退化成
   *  从头播放（等价 playSearch(items, 0)）。 */
  const appendToQueue = useCallback(
    (unifiedItems: UnifiedSearchItem[]) => {
      const q = queueRef.current;
      if (!q || q.tracks.length === 0) {
        playSearch(unifiedItems, 0);
        return;
      }
      const { tracks, unifiedItems: aligned } = parsePlayableQueue(unifiedItems, {
        wpsReady: Boolean(wpsRef?.current?.wpsReady),
      });
      if (tracks.length === 0) {
        setError('没有可播放的音源');
        return;
      }
      q.tracks = [...q.tracks, ...tracks];
      q.unifiedItems = q.unifiedItems ? [...q.unifiedItems, ...aligned] : aligned;
      // idx 不变但 items 引用变了——主动推一版 snapshot 给 reactive consumer。
      setQueueSnapshot({ idx: q.idx, items: q.unifiedItems });
      setError(null);
    },
    [playSearch, wpsRef],
  );

  // Auto-load on provider / preset change (but skip once when delaying a
  // source switch so the current song isn't interrupted).
  useEffect(() => {
    if (!provider) return;
    if (skipAutoLoadRef.current) {
      skipAutoLoadRef.current = false;
      return;
    }
    loadNextTrack();
  }, [provider, deezerPreset, loadNextTrack]);

  // Audio element wiring. Re-bind whenever `track` changes (NOT when
  // loadNextTrack does — that closure trap was the original bug).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // crossfade 换槽后 duration 不会自己冒出来（loadedmetadata 打在新元素上，
    // 而绑定发生在换槽之后）。主动补一次，否则进度条会拿旧时长算百分比。
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => {
      if (trackRef.current?.provider === 'spotify' && wpsRef?.current?.wpsReady) return;
      setDuration(audio.duration || 0);
    };
    const onLoadedMetadata = () => {
      if (trackRef.current?.provider === 'spotify' && wpsRef?.current?.wpsReady) return;
      setDuration(audio.duration || 0);
      // After a quality-switch reload, jump back to the original position.
      // (Skip trial detection here — a quality reload of a trial is still a
      // trial, and we don't want to yank the platform mid-listen.)
      if (pendingSeekRef.current != null) {
        try {
          audio.currentTime = pendingSeekRef.current;
        } catch {
          // ignore occasional out-of-range seek
        }
        pendingSeekRef.current = null;
        return;
      }
      // 残缺音源检测（每个音源判一次）：**不限定当前平台**，只要实际音频远短于
      // 元数据全长 → 判定为残缺，去 qq/网易云搜全曲换过去。
      //
      // ⚠️ 2026-10-16 修正：原实现带 `FULL_SONG_PROVIDERS.includes(cur.provider)`
      // 前置条件，注释的理由是「Deezer/Spotify 的 30s 是正常预览，换过去还是 30s，
      // 白换」。这个理由**只对一半**成立——它漏掉了真正会命中的场景：
      //
      //   实测《不染》（毛不易）：QQ 有 5 个全长版 325/319/281s 但**全部 VIP 锁**，
      //   网易云根本没这首歌，Deezer/Spotify 的 preview 是唯一能出声的源。
      //   → 当前 provider 是 preview 平台 → 旧条件直接 return → **连试都不试**，
      //     静默播完 29 秒，用户完全无感知（这正是用户报的「完全没变化」）。
      //
      // 正确语义：当前在哪个平台**不重要**，重要的是「qq/网易云有没有全曲版」。
      // tryUpgradeFromTrial 的目标本来就是 fullProviders，放开入口只会让它多一
      // 次本可以成功的搜索；换不到时 trialServerTriedRef 保证每首只问一次。
      //
      // 代价（已知且可接受）：所有平台都只有 30s preview 的小众歌，会多一次注定
      // 失败的跨平台搜索。后台 fire-and-forget，不阻塞播放。
      //
      // Bug #3 UI 提示：trial 检测触发时无条件 setTrialFellBack(true)，让
      // TheaterView 显示 TRIAL 角标；升级成功（isTrial=false）时 reset false。
      if (!trialEvaluatedRef.current) {
        trialEvaluatedRef.current = true;
        const cur = trackRef.current;
        const isTrial =
          cur != null &&
          isResidualAudio({
            provider: cur.provider,
            audioDuration: audio.duration,
            metaDuration: cur.duration,
          });
        if (isTrial) {
          setTrialFellBack(true);
          void handleTrialDetected();
        } else {
          // 升级成功 / 切到非 trial 平台 / 跨平台换源后新源是全曲 → reset。
          setTrialFellBack(false);
        }
      }
    };
    const onCanPlay = () => {
      if (audio.dataset.wantPlay === '1' && audio.paused) {
        audio.play().catch((e) => {
          console.error('[audio] play() rejected in canplay:', e);
        });
      }
    };
    const onPlay = () => {
      audio.dataset.wantPlay = '1';
      // Build the graph the moment playback actually starts (autoplay is
      // allowed in this Electron shell). Idempotent.
      ensureAudioGraph();
    };
    const onPause = () => {
      audio.dataset.wantPlay = '0';
    };
    const onEnded = () => {
      audio.dataset.wantPlay = '0';
      // 自然播完 = 最强的正信号（比"切歌"可信得多）。
      const t = trackRef.current;
      if (t?.title && t.artist) {
        reportRecoSignal({ type: 'complete', title: t.title, artist: t.artist });
      }
      loadNextTrack();
    };
    const onError = () => {
      const err = audio.error;
      const code = err ? `code=${err.code}` : 'no-MediaError';
      // 失败的是**当前正在放**的那个源的 provider —— 后面判定"是不是登录
      // 过期"要拿它去问服务端。
      const failedProvider = trackRef.current?.provider ?? provider ?? 'qq';
      console.error('[audio] error', code, audio.src);
      // 防御性"同源重试一次": CDN / Tailscale 代理瞬间抖动 / 上游 keep-alive
      // 超时引起的 transient MEDIA_ERR_NETWORK 不该立刻换源——换源会丢播放进度、
      // 红心、queue 位置。等 800ms 让上游 stream 重新 fetch，再 audio.load() +
      // audio.play() 重试；还错才进跨平台 fallback。
      //
      // 同源 transient 重试：**有次数上限**（shouldTransientRetry）。
      // 旧实现无上限且"重试成功就清零 guard"，而 play() 在坏源上照样 resolve
      // → 清零 → 下一个 error 又满足条件 → 无限重试，永远走不到跨平台兜底
      // （2026-10-19 报障：QQ 对部分歌曲不返 purl，界面卡在「等待播放」）。
      if (
        !retryAttemptedRef.current &&
        shouldTransientRetry({
          attempts: transientAttemptsRef.current,
          wantPlay: audio.dataset.wantPlay === '1',
        })
      ) {
        retryAttemptedRef.current = true;
        transientAttemptsRef.current += 1;
        setTimeout(() => {
          const stillOnTrack =
            audio.dataset.wantPlay === '1' && audio.src === currentSrcRef.current;
          if (!stillOnTrack) {
            // 用户这期间切歌 / 暂停了 → 不重试，进 fallback
            retryAttemptedRef.current = false;
            void tryFallbackSource().then((ok) => {
              if (!ok) setError(`音频加载失败（${code}），请尝试切歌`);
            });
            return;
          }
          console.warn(`[audio] transient — 重试同源（第 ${transientAttemptsRef.current} 次）`);
          // 保住播放位置：mid-stream 掉线（"放着放着 code 4"）重载后应从断点续，
          // 而不是跳回 0。复用 changeQuality 的 pendingSeekRef 机制——
          // onLoadedMetadata 会在 load() 触发的重新加载后 seek 回去。
          if (audio.currentTime > 0) pendingSeekRef.current = audio.currentTime;
          const startedAt = Date.now();
          audio.load();
          const afterRetry = (why: string) => {
            retryAttemptedRef.current = false;
            clearStallTimer();
            console.warn(`[audio] 同源重试未成功（${why}）→ 跨平台兜底`);
            void tryFallbackSource().then((ok) => {
              if (!ok) reportPlayFailure(failedProvider, code);
            });
          };
          void audio.play().then(
            () => {
              // ⚠️ play() resolve 只代表"浏览器接受了播放请求"，不代表出了声：
              // 坏源上它经常 resolve，然后 currentTime 永远停在 0。起一个探测
              // 定时器，到点还在 00:00 就走兜底，别让界面停在「等待播放」。
              retryAttemptedRef.current = false;
              clearStallTimer();
              stallTimerRef.current = setTimeout(() => {
                stallTimerRef.current = null;
                if (
                  !isPlaybackStalled({
                    currentTime: audio.currentTime,
                    elapsedMs: Date.now() - startedAt,
                  })
                ) {
                  return; // 已经在走了 → 正常播放
                }
                // 用户已暂停 / 已切歌 → 不是"卡死"，别打扰
                if (audio.dataset.wantPlay !== '1' || audio.src !== currentSrcRef.current) return;
                afterRetry('重试后 00:00 不出声');
              }, STALL_PROBE_MS);
            },
            () => afterRetry('play() rejected'),
          );
        }, 800);
        return;
      }

      // 无版权 / 真没源：先自动降级到同一首歌的其它平台源（含向服务端实时
      // 匹配），全都失败才把报错弹给用户。
      void tryFallbackSource().then((ok) => {
        if (!ok) {
          reportPlayFailure(failedProvider, code);
          return;
        }
        // ⚠️ fallback 成功 ≠ 原 provider 没问题：切到 Deezer/Spotify 30s 预览
        // 后 tryFallbackSource 返回 true，整条"失败上报"路径被跳过 —— QQ 真实
        // 掉线会被静默吞掉（2026-10-14 报障）。fallback 成功后**异步**给原
        // provider 补一次 validate=1 探针，过期 → mark_expired 弹重登；非过期
        // → 什么都不做（当前 30s 预览继续播，用户感知不受影响）。
        if (ok && failedProvider === 'qq') {
          checkProviderAuthExpired(failedProvider);
        }
      });
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [
    track,
    // crossfade 换槽 = "当前播放元素"易主 → 必须重绑事件到新元素。
    slotVersion,
    loadNextTrack,
    ensureAudioGraph,
    audioRef,
    wpsRef,
    tryFallbackSource,
    handleTrialDetected,
    reportPlayFailure,
    checkProviderAuthExpired,
  ]);

  // Sync play/pause — but only call play() once the audio is actually ready
  // (the src is set on mount but data hasn't streamed yet). onCanPlay retries.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    // Spotify Premium + WPS ready → 走 WPS 路径（HTMLAudioElement 不用，
    // 否则会被 30s 预览代理劫持成 mp3 字节流）。wpsRef 引用稳定，effect 只在
    // playing / track 变化时跑，此处懒读 .current 拿最新 WPS 实例。
    const wps = wpsRef?.current ?? null;
    // Bug #2 (stability-bug2-wps-double-play)：切歌 / 换 provider / wpsReady
    // 翻 false 时，先确保旧 WPS URI 停掉——不然下面的 useWps=false 分支会走
    // <audio>.play()，旧 WPS 还在播 → 两路叠加。shouldStopWpsBeforeTransition
    // 是 usePlayer.helpers 里的纯函数，单测覆盖。
    if (
      shouldStopWpsBeforeTransition(
        wpsPlayedIdRef.current,
        { provider: track.provider, id: track.id },
        Boolean(wps?.wpsReady),
      )
    ) {
      void wps?.pause().catch(() => {});
      wpsPlayedIdRef.current = null;
    }
    const useWps = Boolean(wps?.wpsReady && track.provider === 'spotify' && track.id);
    if (useWps && wps) {
      if (playing) {
        audio.dataset.wantPlay = '1';
        // 切到新歌 → play(newUri)；同一首暂停后恢复 → resume。用 ref 里记的
        // 上一次 play 过的 id 区分（audio.dataset.wantPlay 无法区分这两种）。
        if (wpsPlayedIdRef.current !== track.id) {
          const uri = `spotify:track:${track.id}`;
          wpsPlayedIdRef.current = track.id;
          // T6 (consistency-fixes D6)：track 守护。transferHere().then() 回调里
          // 校验「现在还停留在同一首歌」——用户切歌后再 play 旧 URI 会让 WPS
          // 播放与 UI 不同步。startedTrackId 是 await 之前的快照。
          const startedTrackId = track.id;
          // transferHere 失败（设备还没注册完）不阻断 play——play 请求带
          // device_id 参数本身也会激活设备。两边都有 404 退避重试。
          void wps
            .transferHere()
            .catch((e: Error) => {
              wpsLog('transfer-fallback', `transferHere 失败，继续 play：${e.message}`);
            })
            .then(() => {
              // D6：切歌检查。startedTrackId 与 wpsPlayedIdRef 都已设过，
              // 但 await 期间切歌时 ref 也会被刷新——以 wpsPlayedIdRef 为准。
              if (wpsPlayedIdRef.current !== startedTrackId) return;
              return wps.play(uri);
            })
            .catch((e: Error) => {
              console.error('[wps] play() rejected:', e);
              setError(`WPS 播放失败：${e.message}`);
            });
        } else {
          void wps.resume().catch(() => {
            // resume 失败常见于 SDK 内部状态；忽略
          });
        }
      } else {
        audio.dataset.wantPlay = '0';
        void wps.pause().catch(() => {
          // ignore
        });
      }
      return;
    }
    if (playing) {
      audio.dataset.wantPlay = '1';
      if (audio.readyState >= 3 /* HAVE_FUTURE_DATA */) {
        audio.play().catch((e) => {
          console.error('[audio] play() rejected:', e);
          setError(`播放失败: ${(e as Error).message || e}`);
        });
      }
    } else {
      audio.dataset.wantPlay = '0';
      audio.pause();
    }
  }, [playing, track, audioRef, wpsRef]);

  /** WPS → 时间轴桥：App 在 wps.state 变化时调它，把 SDK 上报的位置/时长
   *  喂回 usePlayer 的 currentTime / duration。仅在 WPS 播放 spotify 时用。 */
  const applyWpsProgress = useCallback((positionMs: number, durationMs: number) => {
    setCurrentTime(positionMs / 1000);
    if (durationMs > 0) setDuration(durationMs / 1000);
  }, []);

  useEffect(() => {
    let target: HTMLDivElement | null = null;
    let lastValue = '';
    const writeBassIntensity = (value: string) => {
      const nextTarget = coverBackdropRef.current;
      if (nextTarget !== target) {
        target = nextTarget;
        lastValue = '';
      }
      if (target && value !== lastValue) {
        target.style.setProperty('--bass-intensity', value);
        lastValue = value;
      }
    };

    if (searchOpen || !analyser || !playing) {
      writeBassIntensity('0');
      return;
    }

    let raf = 0;
    const buf = new Uint8Array(64);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 1; i <= 12; i++) sum += buf[i];
      const bass = sum / (12 * 255);
      writeBassIntensity(Math.min(1, bass * 1.1).toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, analyser, searchOpen, coverBackdropRef]);

  const selectSource = (next: MusicProvider) => {
    writeStoredProvider(next);
    if (next === 'deezer') {
      // Pre-arm user activation for Chromium's autoplay policy: play a tiny
      // silent WAV synchronously inside this click handler so subsequent
      // play() calls from our effects are allowed.
      try {
        const tmp = new Audio();
        tmp.muted = true;
        tmp.src =
          'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
        const p = tmp.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            tmp.pause();
            tmp.src = '';
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    }
    setProvider(next);
  };

  /** Switch source from the dropdown without interrupting playback: same
   *  source → no-op; different → only later tracks come from the new source
   *  (current song plays out, or the user skips). */
  const switchToProvider = (next: MusicProvider) => {
    if (next === provider) return;
    queueRef.current = null; // the search queue is source-specific
    setQueueSnapshot({ idx: -1, items: undefined }); // mirror to reactive state
    setSearchOpen(false);
    writeStoredProvider(next);
    if (track) skipAutoLoadRef.current = true;
    setProvider(next);
  };

  /** Switch quality (QQ / NetEase): reload the current song at the new
   *  quality, preserving the playback position. */
  const changeQuality = (q: QqQuality) => {
    setQqQuality(q);
    qqQualityRef.current = q;
    writeStoredQuality(q);
    const audio = audioRef.current;
    if (
      audio &&
      track &&
      (track.provider === 'qq' || track.provider === 'netease') &&
      track.audioUrl
    ) {
      pendingSeekRef.current = audio.currentTime; // restore after reload
      const base = track.audioUrl.replace(/[?&]q=[^&]*/, '').replace(/[?&]$/, '');
      const sep = base.includes('?') ? '&' : '?';
      const nextUrl = `${base}${sep}q=${q}`;
      // 同步 onError 的 src 镜像（见 handleTrialDetected 里同款注释）。
      currentSrcRef.current = nextUrl;
      setTrack((prev) => (prev ? { ...prev, audioUrl: nextUrl } : prev));
      // 同上：src 是命令式装载的，setTrack 不会让元素去加载。
      reloadActiveWithUrl(nextUrl);
    }
  };

  const changeDeezerPreset = (next: string) => {
    setDeezerPreset(next);
    writeStoredDeezerPreset(next);
  };

  /**
   * 设置某一频段的增益（dB）。UI 拖滑块时每个像素都会调它，所以要保持廉价：
   * 只改一个 state + 写一次 storage + 一次 setTargetAtTime。
   */
  const setEqBandGain = useCallback(
    (index: number, dB: number) => {
      setAudioFx((prev) => {
        const gains = [...prev.eqGains];
        if (index < 0 || index >= gains.length) return prev;
        gains[index] = clampGain(dB);
        // 手动拖过就不再声称自己等于某个预置（UI 据此显示「已修改」）
        const next: AudioFxPrefs = { ...prev, eqGains: gains, presetId: null };
        writeAudioFx(next);
        pushEqToFilters(next);
        return next;
      });
    },
    [pushEqToFilters],
  );

  /** 切到某个预置。未知 id 会被 applyPreset 洗成平直，不会抛。 */
  const applyEqPreset = useCallback(
    (presetId: string) => {
      setAudioFx((prev) => {
        const next = applyPreset(prev, presetId);
        writeAudioFx(next);
        pushEqToFilters(next);
        return next;
      });
    },
    [pushEqToFilters],
  );

  /** EQ 总开关。关闭 = 各频段 ramp 到 0 dB（曲线保留在 prefs 里，见 pushEqToFilters）。 */
  const setEqEnabled = useCallback(
    (enabled: boolean) => {
      setAudioFx((prev) => {
        const next: AudioFxPrefs = { ...prev, eqEnabled: enabled };
        writeAudioFx(next);
        pushEqToFilters(next);
        return next;
      });
    },
    [pushEqToFilters],
  );

  /**
   * crossfade 时长（秒）。0 = 关闭（默认，见 audioFx.ts 的取值说明）。
   *
   * 改的是**偏好**，不是正在进行的淡变：用户拖滑块时正在播的歌不会重新淡一次
   * （那会突然把音量拽下去）。下一次切歌才按新时长走。
   */
  const setCrossfadeSec = useCallback((sec: number) => {
    setAudioFx((prev) => {
      const next: AudioFxPrefs = { ...prev, crossfadeSec: clampCrossfade(sec) };
      writeAudioFx(next);
      return next;
    });
  }, []);

  const handlePlayPause = () => {
    // Build the graph the first time the user hits play; later clicks just
    // resume the context if needed.
    ensureAudioGraph();
    setPlaying((p) => !p);
  };

  /**
   * 手动切歌。听得很浅就切 = 负信号（推荐里最有用的一条），但**听完大半再切
   * 属于正常换歌**，不算负反馈——否则用户正常切歌也会被当成"讨厌这首歌"。
   */
  const handleSkip = () => {
    const audio = audioRef.current;
    const t = trackRef.current;
    if (audio && t?.title && t.artist) {
      const dur =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t.duration;
      const pct = dur > 0 ? Math.round((audio.currentTime / dur) * 100) : 0;
      if (dur >= 60 && pct < 30) {
        reportRecoSignal({
          type: 'skip',
          title: t.title,
          artist: t.artist,
          progress: pct,
        });
      }
    }
    loadNextTrack();
  };

  /** Go back one track within the search queue (looping). Radio has no history,
   *  so prev is a no-op there. */
  const loadPrevTrack = useCallback(() => {
    const q = queueRef.current;
    if (q && q.tracks.length) {
      q.idx = (q.idx - 1 + q.tracks.length) % q.tracks.length;
      presentTrack(q.tracks[q.idx], q.unifiedItems?.[q.idx]);
      void detectAndApplyLiked(q.unifiedItems?.[q.idx]);
    }
  }, [presentTrack, detectAndApplyLiked]);

  const handlePrev = () => loadPrevTrack();

  const handleLike = async () => {
    if (!track || !provider) return;
    // T6 (consistency-fixes D1+D2)：任务票据 + 作废在途轮询。
    // - likedRefreshGenRef++：让上一轮 refreshLikedStateUntilStable 的
    //   轮询立刻 return null，不再读 detect 旧值。
    // - likeTicketRef++：await 回来后比对，保证旧 ❤ 点击的结果不覆盖
    //   新的 ❤ 点击（用户连点 ❤ → ❤ → ❤，旧 fetch 晚回 → 不应用）。
    // - startedTrackId：切歌后旧结果丢弃。
    const myTicket = ++likeTicketRef.current;
    const startedTrackId = track.id;
    likedRefreshGenRef.current++;
    // 语义：❤ 是开关。未收藏 → 在所有有版权的平台收藏（fan-out）；已收藏 →
    // 取消之前 fan-out 过的所有平台的收藏（不写「不喜欢」、不影响 FM 推荐——
    // 那是「踩」的语义）。
    const q = queueRef.current;
    const current = q?.unifiedItems?.[q.idx];
    if (current && current.bestSource) {
      const sources = current.sources
        .filter((s) => s.hasCopyright)
        .map((s) => ({ platform: s.platform, trackId: s.trackId }));
      const next = !track.liked;
      try {
        // 带上歌曲元数据：收藏时后端会去其余已登录平台跨平台匹配同名同时长的
        // 等价曲目，把红心真正同步过去（严格 ±3s，后台异步）。
        const result = await fanOutLike(current.id, sources, next, {
          title: current.title,
          artist: current.artist,
          duration: current.duration,
        });
        // T6 D2：守护「应用 setTrack / setFanOutCount」前，校验 ticket + track。
        // 任一不匹配 → 旧结果丢弃（用户已切歌 / 再次 ❤ → 新 ticket 占位）。
        if (
          !shouldApplyLikeResult(
            myTicket,
            startedTrackId,
            likeTicketRef.current,
            trackRef.current?.id,
          )
        ) {
          return;
        }
        setFanOutCount(next ? result.fannedOutTo.length : 0);
        setTrack((prev) => (prev ? { ...prev, liked: next } : prev));
        if (next) {
          reportRecoSignal({
            type: 'like',
            title: current.title,
            artist: current.artist,
          });
        }
      } catch (e) {
        setError(`心动作业失败：${(e as Error).message}`);
      }
      return;
    }
    // Single-platform path (radio): toggleLike 本身就是翻转语义。收藏方向同样
    // 带元数据，让后端跨平台匹配把红心补到其余已登录平台。
    const result = await toggleLike(provider, track.id, {
      title: track.title,
      artist: track.artist,
      duration: track.duration,
    });
    if (result.success) {
      // T6 D2：同 ticket/track 守护。
      if (
        !shouldApplyLikeResult(
          myTicket,
          startedTrackId,
          likeTicketRef.current,
          trackRef.current?.id,
        )
      ) {
        return;
      }
      setTrack((prev) => (prev ? { ...prev, liked: result.liked } : prev));
      setFanOutCount(0);
      if (result.liked) {
        reportRecoSignal({
          type: 'like',
          title: track.title,
          artist: track.artist,
        });
      }
    }
  };

  const handleDislike = async () => {
    if (!track || !provider) return;
    // T6 (consistency-fixes D5)：与 handleLike 同款 ticket/track 守护，
    // 避免旧 ❤ 操作的 await 晚回时复活红心。
    const myTicket = ++likeTicketRef.current;
    const startedTrackId = track.id;
    likedRefreshGenRef.current++;
    // Unified search path: 踩 = 取消这首歌在所有平台的红心 + 标记不喜欢，
    // 否则某平台残留的红心会在下次切到这首歌时被 detect 重新点亮/收藏回来。
    const q = queueRef.current;
    const current = q?.unifiedItems?.[q.idx];
    if (current && current.bestSource) {
      const sources = current.sources
        .filter((s) => s.hasCopyright)
        .map((s) => ({ platform: s.platform, trackId: s.trackId }));
      try {
        await dislikeMerged(current.id, sources);
        // 切歌 / 再次 ❤ 触发新 ticket → 旧结果不应用。
        if (
          !shouldApplyLikeResult(
            myTicket,
            startedTrackId,
            likeTicketRef.current,
            trackRef.current?.id,
          )
        ) {
          return;
        }
        setFanOutCount(0);
        setTrack((prev) => (prev ? { ...prev, liked: false } : prev));
        reportRecoSignal({
          type: 'dislike',
          title: current.title,
          artist: current.artist,
        });
      } catch {
        // 踩失败不阻塞切歌，静默。
      }
      loadNextTrack();
      return;
    }
    // Single-platform path (radio): 单平台标记不喜欢。
    await dislike(provider, track.id);
    if (
      !shouldApplyLikeResult(myTicket, startedTrackId, likeTicketRef.current, trackRef.current?.id)
    ) {
      return;
    }
    reportRecoSignal({
      type: 'dislike',
      title: track.title,
      artist: track.artist,
    });
    loadNextTrack();
  };

  /** Seek the live <audio> element (progress-bar click, lyric-line click).
   *  Spotify Premium + WPS ready → seek through the SDK instead (the <audio>
   *  element isn't the playback source for those tracks). */
  const seek = (seconds: number) => {
    const wps = wpsRef?.current ?? null;
    if (wps?.wpsReady && track?.provider === 'spotify') {
      setCurrentTime(seconds); // 乐观更新，SDK 回报后再校正
      void wps.seek(Math.round(seconds * 1000)).catch(() => {
        // ignore
      });
      return;
    }
    const audio = audioRef.current;
    if (audio) audio.currentTime = seconds;
  };

  /** Clear all playback state and drop back to no-provider. The auth reset,
   *  lyric clear (auto, via useLyrics when provider→null) and localStorage
   *  wipe are orchestrated by the caller. */
  const resetForSwitch = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setTrack(null);
    setCurrentTime(0);
    setDuration(0);
    queueRef.current = null;
    setQueueSnapshot({ idx: -1, items: undefined });
    currentUnifiedRef.current = undefined;
    triedPlatformsRef.current = new Set();
    setError(null);
    setSearchOpen(false);
    setProvider(null);
    // Drop the analyser so it doesn't keep reading from a MediaStream whose
    // source <audio> element we just unmounted; it rebuilds on next play.
    setAnalyser(null);
    clearStoredProvider();
  };

  return {
    // state
    provider,
    track,
    /** 当前歌来自 unified search 时的跨平台 sources（歌词多源回退用）。
     *  ref 的更新总是先于 setTrack，所以 render 时读到的一定是当前歌的。 */
    currentSources:
      currentUnifiedRef.current?.sources.map((s) => ({
        platform: s.platform,
        trackId: s.trackId,
      })) ?? undefined,
    playing,
    currentTime,
    duration,
    loading,
    error,
    setError,
    searchOpen,
    setSearchOpen,
    fanOutCount,
    currentUnified,
    trialFellBack,
    qqQuality,
    deezerPreset,
    /** Reactive 镜像 of queueRef — TheaterView「推荐卡跟随队列位置」用。
     *  默认 { idx: -1, items: undefined } 表示当前不在搜索/推荐队列里。 */
    queueIdx: queueSnapshot.idx,
    queueUnifiedItems: queueSnapshot.items,
    // cover refs (for the JSX)
    bgLayerRef,
    coverBackdropRef,
    // actions
    selectSource,
    switchToProvider,
    changeQuality,
    changeDeezerPreset,
    loadNextTrack,
    playSearch,
    appendToQueue,
    applyWpsProgress,
    handlePlayPause,
    handleSkip,
    handlePrev,
    handleLike,
    handleDislike,
    refreshLikedState,
    refreshLikedStateUntilStable,
    refreshTrackForWps,
    seek,
    resetForSwitch,
    // ── 音频效果（specs/audio-fx §2.1）────────────────────────
    /** EQ 偏好镜像（SettingsModal 渲染滑块/预置用） */
    audioFx,
    setEqEnabled,
    setEqBandGain,
    applyEqPreset,
    setCrossfadeSec,
    // ── A/B 音频槽位（crossfade，specs/audio-fx §2.2）──────────────
    /** 两个常驻 `<audio>` 的槽位。App 用 `slots.ref('a' / 'b')` 挂 ref。 */
    slots,
    /** 当前活跃元素的只读代理（给 useVolume 等需要 RefObject 形状的调用方）。 */
    audioRef,
  };
}
