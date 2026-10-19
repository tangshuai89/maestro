/**
 * usePlayer 的纯 helper 集合（ISSUES.md §5.2 partial split）。
 *
 * 与主 hook 解耦——这些函数不依赖 React、不读 refs/state，纯粹基于输入
 * 算出降级/升级顺序，封装跨平台选择的决策逻辑。usePlayer.test.mjs 单测
 * 35 项全部针对这组函数。
 *
 * 拆分动机：usePlayer 主 hook 1460 行里这块 186 行（10%）零 React 依赖、
 * 100% 可单测，混在 hook 文件里既拖慢 typecheck 也让真正的 hook 逻辑
 * 难找。提取后主文件降到 ~1270 行；3 个 hook 的进一步拆分（usePlayback
 * Transport / useFallback / useTrialUpgrade）涉及 ref 闭包 / 序敏感的
 * effect deps，留在专门的 PR。
 */

import type { Track, MusicProvider, UnifiedSearchItem } from '../api';
import { isPlayableEntry, pickPlayableTrack } from '../api';

/**
 * 跨平台降级的优先级（镜像 server 的 PLAY_PRIORITY）：某首歌的当前源播放
 * 失败（无版权 / 取流 502 → <audio> code=4）时，按这个顺序在同一首统一
 * track 的其它平台 source 里挑下一个能播的。QQ/网易云是完整曲流优先，
 * Deezer/Spotify 是 30s 预览兜底。
 */
export const FALLBACK_PRIORITY: MusicProvider[] = ['qq', 'netease', 'deezer', 'spotify'];

/** 可拿全曲流的平台：QQ + 网易云始终。Spotify Premium (WPS) 是例外——见
 *  getFullSongProviders()。 */
export const FULL_SONG_PROVIDERS: MusicProvider[] = ['qq', 'netease'];

/** 根据 Spotify 订阅档位 + WPS 实际就绪状态决定是否把 Spotify 纳入「全曲流」候选。
 *
 * **必须双重条件** `tier ∈ premium-* AND wpsReady === true`——光看 tier 不够：
 *   - Premium 用户但 WPS 没初始化成功（Widevine CDM 不可用 / 设备未注册）
 *   - 此时 spotify source 实际只能走 30s preview URL，被纳入 fullProviders 会让
 *     VIP 试听升级（tryUpgradeFromTrial）跨平台换源时切到 spotify，结果
 *     audioUrl 是 30s preview URL，UI 显示 30s 而不是 04:34 等完整时长。
 *   - 这正是 Bug #3 (stability-bug3-trial-source-not-flagged) 根因。
 *
 * Free / Open / 未登录 / WPS 未就绪 → 都不纳入 spotify（保持原行为）。 */
export function getFullSongProviders(
  spotifyTier?: string | null,
  wpsReady: boolean = false,
): MusicProvider[] {
  const isPremiumTier =
    spotifyTier === 'premium' || spotifyTier === 'premium-duo' || spotifyTier === 'premium-family';
  if (isPremiumTier && wpsReady) {
    return [...FULL_SONG_PROVIDERS, 'spotify'];
  }
  return [...FULL_SONG_PROVIDERS];
}

/**
 * 「当前音源是残缺音源」判定 —— 试听升级的**唯一入口条件**。
 *
 * 抽成纯函数（2026-10-16）有两个原因：
 *  1. 这个判定式原先内嵌在 usePlayer 的 onLoadedMetadata 里，零覆盖 —— 而它
 *     恰恰出过一次静默失效（见下）。
 *  2. 有了纯函数才能在 usePlayer.test.mjs 里精确复现《不染》那个场景。
 *
 * ## 判定
 *
 * 音频流实际长度远短于元数据全长 → 残缺（VIP 试听 / preview），应去 qq/网易云
 * 搜全曲换源。
 *
 * ## ⚠️ 为什么**不能**按当前 provider 过滤
 *
 * 原实现带 `FULL_SONG_PROVIDERS.includes(provider)` 前置条件，理由写在注释里是
 * 「Deezer/Spotify 的 30s 是正常预览，换过去还是 30s，白换」。**这个理由只对了
 * 一半**，它漏掉了真正会命中的场景：
 *
 *   实测《不染》（毛不易，2026-10-16）：QQ 上有 5 个全长版 325/319/281s，但
 *   **全部 VIP 锁**；网易云根本没这首歌；Deezer/Spotify 的 preview 是唯一能出声
 *   的源。此时当前 provider 是 preview 平台，旧条件直接 return ——**连试都不试**，
 *   用户静默听完 29 秒，界面零反馈（用户原话：「完全没变化，放完了 29 秒」）。
 *
 * 正确语义：**当前在哪个平台不重要**，重要的是「qq/网易云有没有全曲版」。
 * tryUpgradeFromTrial 的目标本来就是 fullProviders，放开入口只会让它多一次本可
 * 以成功的搜索。
 *
 * ## 代价
 *
 * 所有平台都只有 30s preview 的小众歌，会多一次注定失败的跨平台搜索。后台
 * fire-and-forget 不阻塞播放，且 trialServerTriedRef 保证每首只问一次。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 附：为什么**不能**改成「在搜索阶段把残缺条目过滤掉」
 * （2026-10-16 实测，别再走这条已被否掉的路）
 *
 * 直觉上「搜不到全曲的条目就别让它出现在结果里」很像那么回事。实测否掉了：
 *
 *   ① 搜索层（元数据 duration）：抽 12 个关键词 × 20 条 = **240 条结果，
 *      duration ≤35s 的有 0 条**，≤45s 的只有 1 条且是真的彩蛋（42s「彩蛋2」）。
 *   ② ❤ 库：1174 条里 duration <60s 的只有 **7 条**（0.6%），全是真短音频
 *      ——「声优小剧场」46s、「干饭王」47s 这类，不是被截断的残次品。
 *   ③ QQ 歌单 8584177317：227 首，duration <60s 的 **0 条**。
 *
 * 结论：**「残缺的 29 秒 track」这个对象根本不存在**。用户看到的 29 秒是
 * `<audio>` 读到的**真实流长度**（= UI 显示的总时长），而元数据是干净的
 * 99–325s。残缺发生在**版权锁 / preview 限制**，不在数据里。
 *
 * 所以正确修法只能是**播放时跨平台找替代**（本函数 + tryUpgradeFromTrial），
 * 而不是在搜索/入库阶段剔除条目 —— 那里没有可剔除的对象。
 *
 * 换源也换不到的情况（就是《不染》）：QQ 全长版全 VIP 锁 + 网易云无此歌 →
 * 搜不到替代。此时的收尾体验（是否自动跳过残缺音源）是独立的**产品决策**，
 * 尚未实现；当前行为 = 亮 TRIAL 角标告知 + 播完继续下一首。
 */
export function isResidualAudio(input: {
  /** 当前音源的 provider —— **只用于日志/调试，不参与判定**。 */
  provider?: MusicProvider;
  /** `<audio>` 读到的真实流长度（秒）。UI 显示的总时长也是它。 */
  audioDuration: number;
  /** 元数据全长（秒）。 */
  metaDuration: number;
}): boolean {
  const { audioDuration, metaDuration } = input;
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return false;
  if (!Number.isFinite(metaDuration) || metaDuration <= 0) return false;
  // 流式媒体在 metadata 未就绪时 duration 可能是 Infinity / NaN —— 上面的
  // isFinite 已挡掉。0 是"还没加载出来"，不是残缺。
  if (audioDuration > TRIAL_MAX_SEC) return false;
  // 元数据只比音频长一点点（切片加载抖动）→ 不算残缺，否则会误判正常加载。
  return metaDuration > audioDuration + TRIAL_GAP_SEC;
}

/** ❤ 写回的乐观更新收敛判断：避免陈旧 ticket 覆盖新状态。
 *  isLikedSync 在 usePlayer 与 useAuth 各持一份 ticket，跨 hook 异步
 *  收敛靠「ticket + trackId 双匹配」防覆盖。 */
export function shouldApplyLikeResult(
  ticket: number,
  startedTrackId: string,
  currentTicket: number,
  currentTrackId: string | undefined,
): boolean {
  return ticket === currentTicket && currentTrackId === startedTrackId;
}

/** 试听最长秒数（QQ 30s 预览可拉到 ~30s，加缓冲到 120s 留给切片加载）。 */
export const TRIAL_MAX_SEC = 120;
/** 试听结束的「切换源前等待」秒数——给 loadStart / seeking 抖动留窗口，
 *  别一上来就跳下一首。 */
export const TRIAL_GAP_SEC = 45;

/**
 * Pick the next fallback source. Returns the first source in `priority`
 * order that (a) hasn't been tried yet and (b) has copyright. Returns
 * undefined if no viable source.
 */
export function pickFallbackSource<T extends { platform: string; hasCopyright: boolean }>(
  sources: T[],
  tried: Set<string>,
  priority: readonly string[] = FALLBACK_PRIORITY,
): T | undefined {
  for (const p of priority) {
    const s = sources.find((src) => src.platform === p && !tried.has(p));
    if (s && s.hasCopyright) return s;
  }
  return undefined;
}

/**
 * Pick the next "full song" source for trial upgrade. Same as
 * pickFallbackSource but filters to full-song providers only (QQ/网易云
 * always; Spotify if Premium) and skips vipLocked entries.
 */
export function pickUpgradeSource<
  T extends { platform: string; hasCopyright: boolean; vipLocked?: boolean },
>(
  sources: T[],
  tried: Set<string>,
  fullProviders: readonly string[] = FULL_SONG_PROVIDERS,
): T | undefined {
  for (const p of fullProviders) {
    const s = sources.find((src) => src.platform === p && !tried.has(p));
    if (s && s.hasCopyright && !s.vipLocked) return s;
  }
  return undefined;
}

/**
 * 将搜索结果（UnifiedSearchItem[]）拍平成 Track[] 队列。WPS 可用时
 * Spotify 源优先（audioUrl 留空，presentTrack 里 WPS 接管）；否则走
 * 平台挑一条能播的 Track。返回的 unifiedItems 跟 tracks 同步——索引
 * 对齐，调用方可以直接 zipped 用。
 */
export function parsePlayableQueue(
  items: UnifiedSearchItem[],
  opts?: { wpsReady?: boolean },
): {
  tracks: Track[];
  unifiedItems: UnifiedSearchItem[];
} {
  const wpsReady = opts?.wpsReady ?? false;
  const tracks: Track[] = [];
  const unifiedItems: UnifiedSearchItem[] = [];
  for (const it of items) {
    // WPS 可用 → Spotify 源优先（audioUrl 留空，presentTrack 里 WPS 接管）
    const spotifySrc = wpsReady ? it.sources.find((s) => s.platform === 'spotify') : undefined;
    const t: Track | null = spotifySrc
      ? {
          id: spotifySrc.trackId,
          provider: 'spotify',
          title: it.title,
          artist: it.artist,
          album: it.album,
          coverUrl: it.coverUrl,
          audioUrl: '', // <audio> 不用，WPS 全曲接管
          duration: it.duration,
          liked: false,
          mediaMid: spotifySrc.mediaMid,
        }
      : pickPlayableTrack(it);
    // isPlayableEntry 与 SearchPanel 的行可点性共用同一把尺子：bestSource
    // 指向的源必须真的能出声（Spotify 无 preview_url 且 WPS 未连 → 不能）。
    // 少了这一步，Spotify 独占条目会被塞进队列，播放时静默卡在 00:00。
    if (t && isPlayableEntry(it, wpsReady)) {
      tracks.push(t);
      unifiedItems.push(it);
    }
  }
  return { tracks, unifiedItems };
}

/**
 * Decide whether the WPS wrapper should be paused+forgotten before
 * transitioning to `nextTrack`. Bug #2 — 切下一曲后两首歌同时播放。
 *
 * Three paths that previously caused WPS + <audio> to both play audio:
 *
 *  A) WPS is playing spotify:track:A → user switches to a QQ track.
 *     useEffect re-runs, `useWps` flips false, <audio>.play() starts the
 *     new track. WPS still has A on its deck → two streams overlap.
 *
 *  B) WPS is playing spotify:track:A → user switches to spotify:track:B
 *     but `wpsReady` flips false mid-transition (token refresh / EME
 *     error / `not_ready` SDK event). Same race.
 *
 *  C) WPS played A → user switches to QQ → back to spotify:track:A.
 *     `wpsPlayedIdRef` still points at A, so useEffect's
 *     `wpsPlayedIdRef.current !== track.id` check is false and we call
 *     `wps.resume()` on a deck that already moved on. Net effect: new
 *     track never starts playing through WPS while <audio> tries the
 *     30s preview, overlap.
 *
 * Returns true when we should call `wps.pause()` AND null out the
 * `wpsPlayedIdRef` so the next transition starts clean. The check is
 * intentionally pure (no React, no refs) so it's unit-testable.
 *
 * @param wpsLastPlayedId  the id we last sent through `wps.play(uri)`;
 *                         null if WPS hasn't been used yet (or was reset).
 * @param nextTrack        the track about to be presented; null = no track.
 * @param wpsReady         current `wpsRef.current?.wpsReady` snapshot.
 */
export function shouldStopWpsBeforeTransition(
  wpsLastPlayedId: string | null,
  nextTrack: { provider: string; id: string } | null,
  wpsReady: boolean,
): boolean {
  // Nothing to stop. WPS never played anything yet (or has been reset).
  if (!wpsLastPlayedId) return false;
  // No track → renderer's useEffect early-returns on `!track` anyway;
  // nothing more to decide here.
  if (!nextTrack) return false;
  // Same track still eligible for WPS → don't disturb a possibly-paused
  // deck; the useEffect's `playing` branch handles play/resume correctly.
  const stillWpsEligible = wpsReady && nextTrack.provider === 'spotify' && Boolean(nextTrack.id);
  if (stillWpsEligible && wpsLastPlayedId === nextTrack.id) return false;
  // Everything else → we must stop WPS so it doesn't keep the old URI
  // alive while <audio> (or a fresh WPS.play) takes over. Covers (A),
  // (B), and (C): provider changed, wpsReady flipped, or the id changed.
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// 播放失败后的处置策略（2026-10-19 报障「启动后不播放」）
//
// 背景：QQ 的 GetVkey 对**部分歌曲**不返 purl（版权 / 绿钻覆盖，实测《演员》
// 能放、《晴天》不能）。这是既有上游行为，但它暴露了降级链的两个洞：
//   1. transient 重试**无次数上限**且成功后立刻把 guard 清零 —— 源一直坏
//      时会「error → 重试 → 成功 resolve → 清零 → 再 error」无限循环，
//      永远走不到跨平台兜底。
//   2. radio 路径的 track **没有 unified**，`tryFallbackSource` 第一行就
//      `if (!unified) return false` —— 于是电台歌放不了时**一条兜底都没有**，
//      界面停在「等待播放」还显示 READY。
//
// 下面三个纯函数把这套策略从 hook 里抠出来，便于白盒测试。
// ─────────────────────────────────────────────────────────────────────

/** 单首歌最多允许几次 transient 同源重试。0 = 不重试，直接兜底。 */
export const TRANSIENT_RETRY_MAX = 2;

/** 多久算「重试后根本没出声」：play() resolve 了但进度一点没动。 */
export const STALL_PROBE_MS = 1500;

/**
 * 这次 `error` 该不该做同源 transient 重试。
 *
 * `wantPlay` = 用户当前是不是想播（暂停后切歌等场景不要重试）。
 * `attempts` = 本首歌**已经重试过几次**——跨 error 事件累加，靠上限收敛，
 * 否则坏源会无限重试（这是修掉的那个洞）。
 */
export function shouldTransientRetry(input: {
  attempts: number;
  wantPlay: boolean | undefined;
  max?: number;
}): boolean {
  if (!input.wantPlay) return false; // 用户已暂停 / 已切歌
  const max = input.max ?? TRANSIENT_RETRY_MAX;
  return input.attempts < max;
}

/**
 * 该不该走「用 title/artist 去服务端找等价源」这条兜底。
 *
 * - 没有 track → 没什么可搜的。
 * - **没有 unified 也照样能搜** —— 这是修掉的洞 #2：`findEquivalentSource`
 *   只吃 `{title, artist, duration}`，radio track 一样有这三个字段。
 *   旧代码在这里直接 `return false`，电台歌放不了时零兜底。
 * - 同一首歌只搜一次（`alreadyTried`），否则会在 qq↔netease 之间来回换源
 *   —— radio 的 `presentTrack` 没有 unified 会把它当新歌重置 triedPlatforms。
 */
export function shouldSearchEquivalent(input: {
  hasTrack: boolean;
  alreadyTried: boolean;
}): boolean {
  return input.hasTrack && !input.alreadyTried;
}

/**
 * 重试「成功」了但其实没出声 → 判定为卡死，继续走兜底。
 *
 * `play()` 的 Promise resolve 只说明"浏览器接受了播放请求"，不代表出了声：
 * 坏源上它经常 resolve，然后 `currentTime` 永远停在 0（用户看到 00:00 /
 * 「等待播放」，而 HUD 还写着 READY）。
 *
 * @param currentTime 重试后观察到的播放位置
 * @param elapsedMs   距离发起重试过了多久
 */
export function isPlaybackStalled(input: {
  currentTime: number;
  elapsedMs: number;
  probeAfterMs?: number;
}): boolean {
  const probe = input.probeAfterMs ?? STALL_PROBE_MS;
  // 观察窗口没到就还不能下结论（否则会把正常起播误判成卡死）
  return input.elapsedMs >= probe && !(input.currentTime > 0);
}

/**
 * 电台 / 单平台 Track 合成的最小 UnifiedSearchItem —— 服务端
 * `/music/like/detect` 只需要 mergedId + sources + meta 三样，全部可从
 * Track 推导。电台路径没有真实 unified item，但红心检测/角标同样需要跑。
 *
 * mergedId 沿用 server 单平台合并键约定 `merged-{provider}-{trackId}-studio`
 * （search.util.ts 同款），让电台 fanOut 落在与统一搜索同一 key 空间；
 * 服务端 canonicalMergedId 还能按 `platform:trackId` 命中 toggleLike 写的
 * `single:{p}:{id}` 记录（电台 ❤ 的 keyspace）——两个键空间按 trackId 打通。
 */
export function synthRadioUnified(track: Track): UnifiedSearchItem {
  return {
    id: `merged-${track.provider}-${track.id}-studio`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    duration: track.duration,
    sources: [
      {
        platform: track.provider,
        trackId: track.id,
        hasCopyright: true,
        url: track.audioUrl,
        mediaMid: track.mediaMid,
        vipLocked: track.vipLocked,
        noPreview: track.noPreview,
      },
    ],
    bestSource: track.provider,
    versionType: 'studio',
    versions: [],
  };
}
