import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from './hooks/usePlayer';
import { useVolume } from './hooks/useVolume';
import { useMediaSession } from './hooks/useMediaSession';
import { buildMediaSessionCommands } from './lib/media-session-commands';
import { useSpotifyWpsPlayer } from './hooks/useSpotifyWpsPlayer';
import { useLyrics } from './hooks/useLyrics';
import { useDesktopLyrics } from './hooks/useDesktopLyrics';
import { useAuth } from './hooks/useAuth';
import { useReco } from './hooks/useReco';
import { useTheme } from './hooks/useTheme';
import { useDeezerEditorials } from './hooks/useDeezerEditorials';
import { getLibrary, fetchPlayHistory, clearPlayHistory } from './api';
import type { LibraryImportResult, MusicProvider } from './api';
import type { PlayHistoryItem } from './components/modals/RecentlyPlayedModal';
import { readCachedLibrary } from './lib/likedCache';
import { createAudioSlots } from './lib/audioSlots';
import { readStoredPlayerMode, writeStoredPlayerMode, type PlayerMode } from './lib/storage';
import { APP_SHORTCUT_BY_ID, matchesShortcut } from './lib/shortcuts';
import { downloadLyricsImage } from './lib/lyricsShare';
import { wpsLog, wpsError, wpsDebugBanner } from './lib/debug';
import SourceSelect from './components/source-select/SourceSelect';
import TheaterView from './components/views/TheaterView';
import LiteView from './components/views/LiteView';
import MiniPlayer from './components/mini/MiniPlayer';
import Titlebar from './components/layout/Titlebar';
import SearchPanel from './components/search/SearchPanel';
import NeteaseCookieModal from './components/modals/NeteaseCookieModal';
import RecoKeyModal from './components/modals/RecoKeyModal';
import LikedLibraryModal from './components/modals/LikedLibraryModal';
import { NLPlaylistModal } from './components/modals/NLPlaylistModal';
import { RemotePlaylistModal } from './components/modals/RemotePlaylistModal';
import { QueuePanel } from './components/modals/QueuePanel';
import { ShortcutModal } from './components/modals/ShortcutModal';
import { RecentlyPlayedModal } from './components/modals/RecentlyPlayedModal';
import FirstRunGuide from './components/onboarding/FirstRunGuide';
import { markOnboardingDone, shouldShowOnboarding } from './lib/onboarding';
import SettingsModal from './components/modals/SettingsModal';
import AuthErrorPanel from './components/common/AuthErrorPanel';
import PlayerNotice from './components/common/PlayerNotice';
import RecoLoading from './components/common/RecoLoading';

/**
 * Composition layer. All logic lives in hooks/ (usePlayer owns the audio
 * core; the rest are focused concerns) and all markup in components/. App
 * just wires the hooks to the components and owns the cross-cutting resets
 * (which touch multiple hooks). `audioRef` is the one ref shared across
 * hooks — created here and threaded into usePlayer, useVolume, and the
 * <audio> element.
 */
export default function App() {
  // A/B 音频槽位（crossfade，specs/audio-fx §2.2）。两个 `<audio>` 都常驻
  // App、不进条件渲染：重建元素 = Web Audio graph 断链 = 有声变无声。
  // 谁在出声由 usePlayer 通过 slots.setActive 切换；本文件只负责挂 ref。
  const audioSlots = useMemo(() => createAudioSlots(), []);

  // WPS (Spotify Premium 全曲播放) 和 usePlayer 互相依赖：usePlayer 的
  // transport 要驱动 WPS，而 WPS 的 enabled 又要读 player.provider + auth.tier。
  // 用一个 ref 打破循环：usePlayer 拿 wpsRef（引用稳定），在 effect 里懒读
  // wpsRef.current；wps 实例本身在所有 hook 之后再填进 ref。
  const wpsRef = useRef<ReturnType<typeof useSpotifyWpsPlayer> | null>(null);

  // Spotify tier 的快照 ref：在 auth hook 之后保持同步，供 tryUpgradeFromTrial
  // 决定 Spotify Premium 是否应被当作有效全曲升级目标。
  const spotifyTierRef = useRef<string | undefined>(undefined);

  // 播放彻底失败后判定"是不是登录过期"的回调（specs/auth-resilience Phase 10）。
  // 用 ref 是因为 usePlayer 在 useAuth **之前**调用，直接传函数会撞 TDZ。
  const onAuthExpiredRef = useRef<((p: MusicProvider) => void) | null>(null);
  const player = usePlayer(audioSlots, wpsRef, spotifyTierRef, onAuthExpiredRef);
  const lyrics = useLyrics(player.track, player.provider, player.currentSources);

  // ── 歌词分享图（导出 PNG 到本地下载目录）────────────────────────
  // 副作用留在 App（composition layer），TheaterView 只管传「点了哪一句」。
  // 状态机 idle → working → done/error → 2.4s 自动回落，避免 Toast 基建。
  const [lyricsExport, setLyricsExport] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const lyricsExportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (lyricsExportTimer.current) clearTimeout(lyricsExportTimer.current);
    },
    [],
  );
  const handleExportLyrics = useCallback(
    async (highlightText?: string) => {
      const cur = player.track;
      const lines = lyrics.lyrics;
      if (!cur || !lines || lines.length === 0 || lyricsExport === 'working') {
        return;
      }
      if (lyricsExportTimer.current) clearTimeout(lyricsExportTimer.current);
      setLyricsExport('working');
      try {
        const ok = await downloadLyricsImage({
          title: cur.title,
          artist: cur.artist,
          coverUrl: cur.coverUrl ?? '',
          lines,
          highlightText: highlightText ?? null,
        });
        setLyricsExport(ok ? 'done' : 'error');
      } catch {
        setLyricsExport('error');
      }
      lyricsExportTimer.current = setTimeout(() => setLyricsExport('idle'), 2400);
    },
    [player.track, lyrics.lyrics, lyricsExport],
  );
  const auth = useAuth(player.provider, player.loadNextTrack, player.setError);
  // 音量（2026-10-20 接上）：此前 useVolume 从没被调用过 → 音量偏好从不推给
  // 任何 <audio>，界面上也没有控件。slots 而非单个元素：crossfade 有两个槽位。
  const volume = useVolume(player.slots, player.track);
  // 系统媒体控件 / 耳机媒体键 / macOS「正在播放」（specs/desktop-integration）。
  // 一套 mediaSession 顶三件事：Chromium 在 macOS 上把它接到了
  // MPNowPlayingInfoCenter，所以设一次 metadata，系统控件 / 媒体键 / 正在播放
  // 一起点亮。
  //
  // ⚠️ 媒体键**只走这一条路**：Electron 在 macOS 上把媒体键实现成
  // globalShortcut 时会占住通道并**关掉 Chromium 自己的处理** → 所以
  // `global-shortcuts.ts` 只注册非媒体键。
  useMediaSession(
    player.track,
    player.playing,
    player.currentTime,
    player.duration,
    // 逻辑在 lib/media-session-commands.ts（可单测）—— App.tsx 是接线层，
    // 逻辑写在这里的话，闭包体只在用户按媒体键时才执行 → 覆盖率 diff 门禁会拦。
    buildMediaSessionCommands({
      playing: player.playing,
      handlePlayPause: player.handlePlayPause,
      handlePrev: player.handlePrev,
      handleSkip: player.handleSkip,
      seek: player.seek,
    }),
  );
  spotifyTierRef.current = auth.auth.tier ?? undefined;
  // auth 就绪后把回调写进 ref，usePlayer 的 onError 兜底会用它。
  onAuthExpiredRef.current = (p: MusicProvider) => auth.markExpired(p);
  // 把 usePlayer 的 reactive queue 状态（queueIdx / queueUnifiedItems）
  // 透传给 useReco —— 推荐卡「正在播 + 接下来 2」从这里派生
  // （spec 2026-09-21「推荐卡跟随队列位置」）。
  const reco = useReco(
    player.playSearch,
    player.setError,
    player.queueIdx,
    player.queueUnifiedItems,
  );
  const theme = useTheme();
  const deezerEditorials = useDeezerEditorials();

  // WPS 仅在 spotify Premium 时启用；Free / 其他 provider 走 <audio> + 30s 预览。
  const wpsEnabled = player.provider === 'spotify' && auth.auth.tier === 'premium';
  wpsDebugBanner();
  // wpsEnabled 只在变化时打（每次 render 都打会刷屏，淹没其他 wps 日志）
  const prevWpsEnabled = useRef<boolean | null>(null);
  if (prevWpsEnabled.current !== wpsEnabled) {
    prevWpsEnabled.current = wpsEnabled;
    wpsLog(
      'wpsEnabled',
      `provider=${player.provider} tier=${String(auth.auth.tier)} → wpsEnabled=${wpsEnabled}`,
    );
  }
  const wps = useSpotifyWpsPlayer({ enabled: wpsEnabled });
  wpsRef.current = wps;

  // 当 WPS 从 disconnected → connected 时，当前歌如果已经在播（30s 预览），
  // 需要重调 presentTrack 让 usePlayer 切到 WPS 全曲播放路径。
  useEffect(() => {
    wpsLog(
      'wpsReady-change',
      `wpsReady=${wps.wpsReady} currentTrack.provider=${String(player.track?.provider)}`,
    );
    if (wps.wpsReady && player.track?.provider === 'spotify') {
      wpsLog('wpsReady-change', `→ refreshTrackForWps（切到 WPS 全曲路径）`);
      player.refreshTrackForWps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wps.wpsReady]);

  // WPS → progress bar：把 SDK 上报的播放位置 / 时长喂回 usePlayer，让
  // ProgressBar / 时间轴与其它平台一致。
  const applyWpsProgress = player.applyWpsProgress;
  useEffect(() => {
    if (wps.wpsReady && wps.state.hasTrack) {
      applyWpsProgress(wps.state.positionMs, wps.state.track?.durationMs ?? 0);
    }
  }, [wps.wpsReady, wps.state, applyWpsProgress]);

  // Switch source (Deezer "account" button): drop playback + auth back to the
  // picker. Lyrics clear themselves via useLyrics when provider → null.
  const handleSwitchSource = () => {
    player.resetForSwitch();
    auth.resetAuth();
  };

  // Wipe all client-side state and bounce back to the source picker.
  const handleResetLocal = () => {
    localStorage.clear();
    sessionStorage.clear();
    player.resetForSwitch();
    auth.resetAuth();
    theme.resetTheme();
  };

  // Liked library modal: 缓存的库（getLibrary 不强制 import）—— titlebar ❤
  // 按钮上展示数量，点击弹窗内自己处理 refresh。
  const [likedOpen, setLikedOpen] = useState(false);
  const [nlOpen, setNlOpen] = useState(false);
  // 远端歌单（specs/remote-playlist Phase 5）
  const [remoteOpen, setRemoteOpen] = useState(false);
  // 播放队列面板（specs/queue-panel/）—— titlebar ☰ 按钮。
  // 队列数据在 usePlayer 里（queueUnifiedItems / queueIdx），本组件只开合。
  const [queueOpen, setQueueOpen] = useState(false);
  // 快捷键速查面板（specs/shortcut-cheatsheet/）
  const [shortcutOpen, setShortcutOpen] = useState(false);
  // 最近播放（specs/play-history/）
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentEntries, setRecentEntries] = useState<PlayHistoryItem[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const openRecent = useCallback(() => {
    setRecentOpen(true);
    setRecentLoading(true);
    void fetchPlayHistory()
      .then((list) => setRecentEntries(list as PlayHistoryItem[]))
      .catch(() => setRecentEntries([]))
      .finally(() => setRecentLoading(false));
  }, []);
  // 首次启动引导（specs/first-run-guide）—— 3 步，可跳过。
  //
  // 触发点：**选完音源之后**（选音源那步已经有 SourceSelect 全屏页了，
  // 引导接在它后面，不重复造、也不挡在它前面）。
  // 「看过没有」记在 localStorage（onboarding.ts）⇒ 跳过后不再打扰；
  // 设置里的「重新看引导」可以再打开。
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    if (shouldShowOnboarding(Boolean(player.provider))) setGuideOpen(true);
  }, [player.provider]);
  const finishGuide = useCallback(() => {
    markOnboardingDone();
    setGuideOpen(false);
  }, []);
  // 首帧秒出：从 localStorage 缓存取最近一次库数量（writeCachedLibrary 写入），
  // 避免 titlebar ❤ 按钮显示 "0" 一闪。后台 getLibrary 拉到后用真实值覆盖。
  const [likedCount, setLikedCount] = useState<number>(() => {
    try {
      return readCachedLibrary()?.items.length ?? 0;
    } catch {
      return 0;
    }
  });
  const [likedVersion, setLikedVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // theater ↔ mini（specs/mini-player）↔ lite（specs/lite-mode）三态切换。
  // <audio> 常驻本组件，切 mode 只是 TheaterView/MiniPlayer/LiteView 的条件
  // 渲染 —— Web Audio graph 不动，当前歌 / 队列 / 进度天然不丢。
  // 持久化到 localStorage（键在 lib/storage 里），重启恢复上次模式。
  const [playerMode, setPlayerMode] = useState<PlayerMode>(readStoredPlayerMode);
  const { bgLayerRef, coverBackdropRef } = player;
  useEffect(() => {
    writeStoredPlayerMode(playerMode);
    // Electron 下让 main 把窗口收成紧凑形态 / 还原；浏览器 dev 无 electronAPI 跳过。
    window.electronAPI?.reportPlayerMode(playerMode);

    // SearchPanel 的挂载条件只有 player.searchOpen（与 mode 无关）—— 进 lite
    // 时若搜索面板还开着，overlay 会盖在极简界面上。顺手关掉。
    // 有意不把 player 放进依赖：setSearchOpen 是 useState setter，引用终身
    // 稳定，加进去只会让这个 effect 每次 render 都重订阅 mousemove。见下方
    // 依赖数组处的 eslint-disable。
    if (playerMode === 'lite') player.setSearchOpen(false);

    // 切回 theater 时 .th-cover 是全新挂载的 div —— 它的 background-image 只在
    // 换歌时由 presentCover 命令式写入 ref.current，mode 切换不会重放。
    // bg-layer 常驻且持有同一封面，把它的 image 镜回新 div；bg 为空（无封面或
    // 在途 fetch）则跳过 —— 在途的 applyCoverImage 落地时惰性读 ref.current，
    // 会写到新 div 上。
    if (playerMode === 'theater') {
      const bg = bgLayerRef.current;
      const cover = coverBackdropRef.current;
      if (bg?.style.backgroundImage && cover && !cover.style.backgroundImage) {
        cover.style.backgroundImage = bg.style.backgroundImage;
      }
    }

    // mini 模式红绿灯 hover 显隐（AM miniPlayer 式）：mouse 在窗口内 → 显示，
    // 离开窗口 → 隐藏。mousemove 节流成可见性翻转（visible flag 去重 IPC）。
    // main 端在进 mini 时已默认隐藏；退出 mini 由 main 统一恢复显示。
    if (playerMode !== 'mini') return;
    const api = window.electronAPI;
    if (!api?.setWindowButtonsVisible) return;
    let visible = false;
    const setVisible = (v: boolean) => {
      if (v === visible) return;
      visible = v;
      api.setWindowButtonsVisible(v);
    };
    const onMove = () => setVisible(true);
    const onLeave = () => setVisible(false);
    window.addEventListener('mousemove', onMove);
    // 红绿灯是原生控件，悬停其上可能不发 DOM mousemove —— 进窗口的
    // mouseenter 兜底，保证从任何角度 hover 上来都能显出按钮。
    document.documentElement.addEventListener('mouseenter', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseenter', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      api.setWindowButtonsVisible(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerMode, bgLayerRef, coverBackdropRef]);
  // Cmd+Shift+M（避开 macOS Cmd+M 最小化）。setPlayerMode 是稳定引用，
  // effect 内直接调，不把 handler 加进依赖。
  //
  // ⚠️ 键位条件**不在这里手写** —— 走 `lib/shortcuts.ts` 的定义表
  // （快捷键面板渲染的是同一张表 ⇒ 面板和实现不可能漂移）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, APP_SHORTCUT_BY_ID['toggle-mini'])) {
        e.preventDefault();
        setPlayerMode((m) => (m === 'mini' ? 'theater' : 'mini'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const handleTogglePlayerMode = () => setPlayerMode((m) => (m === 'mini' ? 'theater' : 'mini'));

  // 桌面歌词浮窗（§7.2）：这里算「当前行/下一行/行内进度」推给 main，
  // main 转发到浮窗窗口。浮窗不碰 <audio>，所以切浮窗不影响播放。
  const desktopLyrics = useDesktopLyrics({
    lines: lyrics.lyrics,
    currentTime: player.currentTime,
    playing: player.playing,
    title: player.track?.title,
    artist: player.track?.artist,
  });
  const toggleDesktopLyrics = desktopLyrics.toggle;
  // ⌘⇧D 开/关桌面歌词（与 Titlebar 按钮、Tray 勾选同一套状态）。
  // ⌘⇧L 归 lite 模式（§6.3）、⌘⇧M 归 mini，所以这里用 D(Desktop)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, APP_SHORTCUT_BY_ID['toggle-desktop-lyrics'])) {
        e.preventDefault();
        toggleDesktopLyrics();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDesktopLyrics]);
  // lite ↔ theater 定向切换（快捷键 / 设置 / ⛶ 键都走它）。设置节要的是
  // 任意目标态（完整 / 迷你 / 极简三选一），所以额外暴露 changePlayerMode。
  const goTheater = () => setPlayerMode('theater');
  // SettingsModal 是 z-index:1000 的全屏浮层且不会自动关闭 —— 只改 playerMode
  // 的话用户在设置页里看不出任何变化，「即时生效」就无从观察。选极简/迷你时
  // 主动关掉它（回 theater 不关：theater 恰恰是设置页背后的那个完整界面）。
  const changePlayerMode = (m: PlayerMode) => {
    setPlayerMode(m);
    if (m !== 'theater') setSettingsOpen(false);
  };

  // lite 模式键盘（specs/lite-mode §2）：
  //   ⌘⇧L  进/出 lite · Esc 回 theater · Space 播放/暂停
  // 界面刻意只留三类元素（歌名 / ◀▶ / ✨），播放/暂停与"怎么出去"就落在这
  // 几个键上 + 一个 hover 显形的 ⛶ 键上。
  //
  // Esc / Space 在有浮层（搜索 / 库 / NL / 设置 / reco key / 登录态报错）打开时
  // 一律让位 —— 那些浮层各自有 ESC 处理，叠加会让一次 Esc 关两层。
  // 登录态两个浮层容易漏：AuthErrorPanel / NeteaseCookieModal 在 lite 下照样
  // 无条件渲染（它们只由 auth 决定，与 playerMode 无关）。
  const overlayOpen =
    player.searchOpen ||
    likedOpen ||
    nlOpen ||
    queueOpen ||
    recentOpen ||
    shortcutOpen ||
    settingsOpen ||
    guideOpen ||
    reco.recoKeyOpen ||
    !!auth.authError ||
    auth.showCookieFallback;
  // handlePlayPause 不是 useCallback（每次 render 新引用），而 App 会跟着进度
  // 每秒重渲染数次 —— 用 ref 兜住，键盘 effect 才能只订阅一次。
  const playPauseRef = useRef(player.handlePlayPause);
  playPauseRef.current = player.handlePlayPause;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, APP_SHORTCUT_BY_ID['toggle-lite'])) {
        e.preventDefault();
        setPlayerMode((m) => (m === 'lite' ? 'theater' : 'lite'));
        return;
      }
      if (playerMode !== 'lite' || overlayOpen) return;
      if (matchesShortcut(e, APP_SHORTCUT_BY_ID['exit-lite'])) {
        e.preventDefault();
        setPlayerMode('theater');
        return;
      }
      if (!matchesShortcut(e, APP_SHORTCUT_BY_ID['play-pause'])) return;
      // 焦点在输入框 / 按钮里时空格另有归属，不是播放/暂停：
      //   输入框 —— 空格是打字；
      //   按钮   —— 浏览器在 keyup 阶段才由空格生成 click（激活该按钮），
      //     这里若 preventDefault 就把它吃掉了，键盘用户只能改用 Enter。
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'BUTTON' ||
          el.getAttribute('role') === 'button' ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      playPauseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playerMode, overlayOpen]);
  const reloadLikedCount = async () => {
    // 先用缓存秒出首帧（避免 ❤ 按钮从 0 闪到 N），后台拉到后用真值覆盖。
    const cached = readCachedLibrary();
    if (cached) setLikedCount(cached.items.length);
    try {
      const res: LibraryImportResult | null = await getLibrary();
      setLikedCount(res?.items.length ?? 0);
    } catch {
      // 失败保留缓存值；用户继续看到的是上次成功拉的数。
    }
  };
  useEffect(() => {
    void reloadLikedCount();
  }, [player.provider, auth.auth.loggedIn]);

  // Playing a ❤ song: usePlayer's detect already kicks off the cross-platform
  // fan-out + incremental library patch in the background. That's async (it
  // has to search the other platforms + drain a serial queue with backoff),
  // so a single 2.5s timer is too eager — it reads fannedOutTo before the
  // discover has settled, the badge gets stuck at 1 and never climbs. We poll
  // via refreshLikedStateUntilStable, which keeps trying until (liked, count)
  // holds for two consecutive reads (~800ms apart initially, slower later).
  // Mid-flight, any new track or ❤↔取消 flip invalidates the in-flight poll
  // (generation counter inside the hook) so a stale run can't clobber fresh UI.
  //
  // 同时刷新 ❤ 库总数 + 弹窗（likedVersion 触发 LikedLibraryModal 重拉）。
  useEffect(() => {
    if (!player.track?.liked) return;
    void reloadLikedCount();
    setLikedVersion((v) => v + 1);
    void player.refreshLikedStateUntilStable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.track?.id, player.track?.liked]);

  // Playback commands from the main process (Electron): the macOS tray menu
  // **and** the global hotkeys share one channel ('tray:command'). We map them
  // onto the player and report state back so the tray label/tooltip stay in
  // sync. usePlayer stays the single source of truth — no duplicate playback
  // logic in main. We route through a ref so the IPC listener is registered
  // once (not re-subscribed on every currentTime tick).
  //
  // 音量 ±（'volumeup' / 'volumedown'）是 2026-10-24 随全局热键加的：
  // 主进程只发命令，**音量怎么算在 renderer**（useVolume 是音量的唯一事实来源）。
  const VOLUME_STEP = 0.05;
  const trayHandlersRef = useRef({
    playpause: player.handlePlayPause,
    next: player.handleSkip,
    prev: player.handlePrev,
    volumeup: () => volume.changeVolume(Math.min(1, volume.volume + VOLUME_STEP)),
    volumedown: () => volume.changeVolume(Math.max(0, volume.volume - VOLUME_STEP)),
  });
  trayHandlersRef.current = {
    playpause: player.handlePlayPause,
    next: player.handleSkip,
    prev: player.handlePrev,
    volumeup: () => volume.changeVolume(Math.min(1, volume.volume + VOLUME_STEP)),
    volumedown: () => volume.changeVolume(Math.max(0, volume.volume - VOLUME_STEP)),
  };
  // 启动时查一次 main 端 Widevine CDM 状态。Spotify WPS 初始化失败时
  // （"No supported keysystem was found"）这里能看到 castLabs components
  // 到底有没有就绪，不用切回 npm run dev 终端看 main log。
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getWidevineStatus) return;
    void api.getWidevineStatus().then((s) => {
      wpsLog('widevine', `ready=${s.ready} status=${JSON.stringify(s.status)}`);
      if (!s.ready) {
        wpsError('widevine', 'Widevine CDM 未就绪 — Spotify WPS 全曲播放不可用，会卡 30s');
      }
    });
  }, []);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onTrayCommand) return;
    return api.onTrayCommand((command) => trayHandlersRef.current[command]?.());
  }, []);

  useEffect(() => {
    window.electronAPI?.reportPlaybackState?.({
      isPlaying: player.playing,
      title: player.track?.title,
      artist: player.track?.artist,
    });
  }, [player.playing, player.track?.title, player.track?.artist]);

  // ⚠️ 这里曾有一个「track.audioUrl 变 → audio.load()」的 effect（修 Chromium
  // 在 MEDIA_ERR_NETWORK / aborted 状态下 src 更新不自动 reload 的问题）。
  // crossfade 落地后**删掉了**：src 改由 usePlayer 的 loadIntoSlots 命令式装载
  // ——淡入淡出要求"旧歌留在原元素继续播"，而这个 effect 会在 track 变化时把
  // 当前活跃元素的 src 重置掉，正好掐断正在淡出的歌。强制 reload 的职责跟着
  // 一起搬进 loadIntoSlots（它在装载后立刻 load()）。

  // Demo helper: ?demo=qq / ?demo=netease / ?demo=spotify / ?demo=deezer in the
  // URL forces a provider so the AETHER Theater view can be reviewed without
  // going through the real source picker (which needs the NestJS server up).
  if (!player.provider) {
    if (typeof window !== 'undefined') {
      const m = window.location.search.match(/[?&]demo=([a-z]+)/);
      if (m && ['qq', 'netease', 'deezer', 'spotify'].includes(m[1])) {
        try {
          localStorage.setItem('music-provider', m[1]);
        } catch {
          /* private mode — fall through to picker */
        }
        window.location.replace('/');
        return null;
      }
    }
    return <SourceSelect onSelect={player.selectSource} />;
  }

  return (
    // search-open adds a class the CSS uses to freeze the cover animations
    // behind the search overlay's backdrop-filter (avoids flicker).
    <div
      className={`app ${playerMode === 'mini' ? 'mini-mode' : playerMode === 'lite' ? 'lite-mode' : 'theater-mode'}${player.searchOpen ? ' search-open' : ''}`}
    >
      {/* lite 模式整屏只有三类元素 —— titlebar 不渲染（搜索 / 设置 / 库
          这些入口 lite 下都够不着，切回 theater 再用；⌘⇧L 与 ⛶ 键仍可切回）。*/}
      {playerMode !== 'lite' && (
        <Titlebar
          provider={player.provider}
          onSwitchProvider={player.switchToProvider}
          deezerEditorials={deezerEditorials}
          deezerPreset={player.deezerPreset}
          onChangeDeezerPreset={player.changeDeezerPreset}
          onOpenSearch={() => player.setSearchOpen(true)}
          recoStatus={reco.recoStatus}
          recoRunning={reco.recoRunning}
          onReco={() => void reco.handleReco()}
          qqQuality={player.qqQuality}
          onChangeQuality={player.changeQuality}
          loggedIn={auth.auth.loggedIn}
          loggingIn={auth.loggingIn}
          accountName={auth.auth.user?.nickname}
          onLogin={
            player.provider === 'netease'
              ? auth.handleNeteaseLogin
              : player.provider === 'spotify'
                ? auth.handleSpotifyLogin
                : auth.handleQqLogin
          }
          onAccount={player.provider === 'deezer' ? handleSwitchSource : auth.handleLogout}
          onReset={handleResetLocal}
          likedCount={likedCount}
          onOpenLiked={() => {
            void reloadLikedCount();
            setLikedOpen(true);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          queueCount={player.queueUnifiedItems?.length ?? 0}
          onOpenQueue={() => setQueueOpen(true)}
          onOpenShortcuts={() => setShortcutOpen(true)}
          onOpenRecent={openRecent}
          playerMode={playerMode}
          onTogglePlayerMode={handleTogglePlayerMode}
          desktopLyricsOn={desktopLyrics.enabled}
          onToggleDesktopLyrics={toggleDesktopLyrics}
        />
      )}

      {/* Full-window blurred cover layer — the backdrop the glass cards blur.
          background-image is set by useCoverArt via bgLayerRef. */}
      <div className="bg-layer" ref={player.bgLayerRef} aria-hidden="true" />

      {playerMode === 'lite' ? (
        <LiteView
          track={player.track}
          loading={player.loading}
          recoConfigured={reco.recoStatus?.configured ?? false}
          recoRunning={reco.recoRunning}
          onPrev={player.handlePrev}
          onSkip={player.handleSkip}
          onReco={() => void reco.handleReco()}
          onExit={goTheater}
        />
      ) : playerMode === 'mini' ? (
        <MiniPlayer
          track={player.track}
          playing={player.playing}
          loading={player.loading}
          liked={player.track?.liked ?? false}
          currentTime={player.currentTime}
          duration={player.duration}
          onPlayPause={player.handlePlayPause}
          onSkip={player.handleSkip}
          onPrev={player.handlePrev}
          onLike={() => void player.handleLike()}
          onSeek={player.seek}
          onExpand={handleTogglePlayerMode}
          onOpenNL={() => setNlOpen(true)}
          onOpenRemote={() => setRemoteOpen(true)}
        />
      ) : (
        <TheaterView
          track={player.track}
          playing={player.playing}
          loading={player.loading}
          unavailable={Boolean(player.failure)}
          liked={player.track?.liked ?? false}
          fanOutCount={player.fanOutCount}
          currentUnified={player.currentUnified}
          currentTime={player.currentTime}
          duration={player.duration}
          provider={player.provider ?? 'qq'}
          qqQuality={player.qqQuality}
          trialFellBack={player.trialFellBack}
          accountName={auth.auth.user?.nickname ?? 'Guest'}
          likedCount={likedCount}
          coverBackdropRef={player.coverBackdropRef}
          lyrics={lyrics.lyrics}
          lyricsSynced={lyrics.synced}
          lyricsSource={lyrics.source}
          lyricsMergedFrom={lyrics.mergedFrom}
          lyricsAdded={lyrics.added}
          lyricsLoading={lyrics.loading}
          lyricsExportState={lyricsExport}
          onExportLyrics={handleExportLyrics}
          onRetryLyrics={lyrics.retryByName}
          recoConfigured={reco.recoStatus?.configured ?? false}
          recoLibrarySize={reco.recoStatus?.librarySize ?? 0}
          recoRunning={reco.recoRunning}
          recoMatchRate={0}
          recoSuggestions={reco.suggestions}
          onPlayPause={player.handlePlayPause}
          onSkip={player.handleSkip}
          onPrev={player.handlePrev}
          onLike={() => void player.handleLike()}
          onDislike={() => void player.handleDislike()}
          onSeek={player.seek}
          onOpenLiked={() => {
            void reloadLikedCount();
            setLikedOpen(true);
          }}
          onSwitchProvider={handleSwitchSource}
          onConfigureReco={() => reco.setRecoKeyOpen(true)}
          onRecoSeed={() => reco.handleRecoSeed(player.track?.title, player.track?.artist)}
        />
      )}

      {/* Always mounted (never conditionally unmounted) so the Web Audio graph
          built on it stays valid for the whole session — createMediaElement-
          Source can only be called once per element. crossOrigin + the
          server's CORS header make the media CORS-clean for the analyser. */}
      {/* A/B 两个常驻 <audio>（crossfade，specs/audio-fx §2.2）。
          刻意**不绑 src**：src 由 usePlayer 的 loadIntoSlots 命令式装载 —— 淡变
          期间正在淡出的那一侧必须保持旧 src 不动，交给 React 绑定必然打架。
          preload="auto" 让闲置侧提前把下一首拉起来一点。 */}
      <audio ref={audioSlots.ref('a')} crossOrigin="anonymous" preload="auto" />
      <audio ref={audioSlots.ref('b')} crossOrigin="anonymous" preload="auto" />

      {auth.showCookieFallback && (
        <NeteaseCookieModal
          onClose={() => auth.setShowCookieFallback(false)}
          onSuccess={auth.handleCookieFallbackSuccess}
        />
      )}

      {player.searchOpen && (
        <SearchPanel
          onPlay={player.playSearch}
          // WPS 已连 → Spotify 源能走 SDK 全曲流，那些没有 preview_url 的
          // Spotify 行仍可播；否则它们必须置灰（点了只会卡在 00:00）。
          wpsReady={wps.wpsReady}
          onClose={() => player.setSearchOpen(false)}
          onOpenNL={() => {
            player.setSearchOpen(false);
            setNlOpen(true);
          }}
          onOpenRemote={() => {
            player.setSearchOpen(false);
            setRemoteOpen(true);
          }}
        />
      )}

      {/* lite 下不走全屏 RecoLoading：它是 z-index:150 + inset:0 的整屏星云，
          会把 lite 的三元素整个盖掉 —— 而点 ✨ 正是 lite 最主要的动作。
          loading 态交回 LiteView 自己的 ✨（disabled + aria-busy + 转圈），
          否则那段分支在生产环境永远不可达。见 spec §6 偏离 5。 */}
      {reco.recoRunning && playerMode !== 'lite' && (
        <RecoLoading librarySize={reco.recoStatus?.librarySize ?? 0} />
      )}

      {reco.recoKeyOpen && (
        <RecoKeyModal onSave={reco.handleSaveRecoKey} onClose={() => reco.setRecoKeyOpen(false)} />
      )}

      {likedOpen && (
        <LikedLibraryModal
          refreshSignal={likedVersion}
          onClose={() => {
            setLikedOpen(false);
            void reloadLikedCount();
          }}
          onPlay={(items, idx) => {
            setLikedOpen(false);
            player.playSearch(items, idx);
          }}
          onImportSettled={(newCount) => {
            // 成功时复用 modal 已拿到的 items 数，免去一次额外的 getLibrary
            // 网络往返；失败时（newCount 为 undefined）回到兜底路径再拉一次。
            if (typeof newCount === 'number') setLikedCount(newCount);
            else void reloadLikedCount();
          }}
        />
      )}

      {recentOpen && (
        <RecentlyPlayedModal
          open
          onClose={() => setRecentOpen(false)}
          entries={recentEntries}
          loading={recentLoading}
          onPlay={(items, index) => {
            setRecentOpen(false);
            player.playSearch(items, index);
          }}
          onClear={() => {
            void clearPlayHistory()
              .then(() => setRecentEntries([]))
              .catch(() => undefined);
          }}
        />
      )}

      {queueOpen && (
        <QueuePanel
          open
          onClose={() => setQueueOpen(false)}
          items={player.queueUnifiedItems}
          currentIndex={player.queueIdx}
          onJump={(index) => {
            player.jumpToQueueIndex(index);
          }}
          onRemove={(index) => {
            player.removeFromQueue(index);
          }}
        />
      )}

      {shortcutOpen && <ShortcutModal open onClose={() => setShortcutOpen(false)} />}

      {/* 首次启动引导（specs/first-run-guide）—— 整屏覆盖层（z-index 55：在
          search-overlay 之下 —— 第 2 步打开的 RecoKeyModal 要能点得到）。 */}
      {guideOpen && (
        <FirstRunGuide open onClose={finishGuide} onOpenRecoKey={() => reco.setRecoKeyOpen(true)} />
      )}

      {nlOpen && (
        <NLPlaylistModal
          open
          onClose={() => setNlOpen(false)}
          queueLength={player.queueUnifiedItems?.length ?? 0}
          onPlay={(items, idx) => {
            setNlOpen(false);
            player.setError(null);
            player.playSearch(items, idx);
          }}
          onAppendQueue={(items) => {
            setNlOpen(false);
            player.setError(null);
            player.appendToQueue(items);
          }}
          onNeedKey={() => reco.setRecoKeyOpen(true)}
        />
      )}

      {remoteOpen && (
        <RemotePlaylistModal
          open
          onClose={() => setRemoteOpen(false)}
          onPlay={(items, idx) => {
            setRemoteOpen(false);
            player.setError(null);
            player.playSearch(items, idx);
          }}
          onAppendQueue={(items) => {
            setRemoteOpen(false);
            player.setError(null);
            player.appendToQueue(items);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          playerMode={playerMode}
          onChangePlayerMode={changePlayerMode}
          audioFx={player.audioFx}
          onEqEnabled={player.setEqEnabled}
          volume={volume.volume}
          muted={volume.muted}
          onVolumeChange={volume.changeVolume}
          onToggleMute={volume.toggleMute}
          onCrossfadeSec={player.setCrossfadeSec}
          onEqBandGain={player.setEqBandGain}
          onApplyEqPreset={player.applyEqPreset}
          onReplayGuide={() => setGuideOpen(true)}
        />
      )}

      {auth.authError && (
        <AuthErrorPanel
          provider={player.provider ?? 'qq'}
          error={auth.authError}
          onRetry={() => auth.handleRetry()}
          onReLogin={() => {
            auth.handleDismissError?.();
            if (player.provider === 'netease') void auth.handleNeteaseLogin();
            else if (player.provider === 'qq') void auth.handleQqLogin();
            else if (player.provider === 'spotify') void auth.handleSpotifyLogin();
          }}
          onSwitch={handleSwitchSource}
          onPasteCookie={
            player.provider === 'netease' || player.provider === 'qq'
              ? () => auth.setShowCookieFallback(true)
              : undefined
          }
          onDismiss={() => auth.handleDismissError?.()}
        />
      )}

      {/* 播放兜底链彻底耗尽后的轻量提示：分级文案 + 自动跳下一首倒计时。
          failure（结构化）优先；普通 error 字符串也借它显示——此前 setError
          后没有任何组件渲染，用户看到的是"假死"。 */}
      {(player.failure || player.error) && (
        <PlayerNotice
          failure={player.failure}
          error={player.failure ? null : player.error}
          onSkipNext={() => {
            player.dismissFailure();
            void player.loadNextTrack();
          }}
          onDismiss={() => {
            player.dismissFailure();
            player.setError(null);
          }}
        />
      )}
    </div>
  );
}
