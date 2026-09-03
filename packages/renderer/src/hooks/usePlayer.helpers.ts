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
import { pickPlayableTrack } from '../api';

/**
 * 跨平台降级的优先级（镜像 server 的 PLAY_PRIORITY）：某首歌的当前源播放
 * 失败（无版权 / 取流 502 → <audio> code=4）时，按这个顺序在同一首统一
 * track 的其它平台 source 里挑下一个能播的。QQ/网易云是完整曲流优先，
 * Deezer/Spotify 是 30s 预览兜底。
 */
export const FALLBACK_PRIORITY: MusicProvider[] = [
  'qq',
  'netease',
  'deezer',
  'spotify',
];

/** 可拿全曲流的平台：QQ + 网易云始终。Spotify Premium (WPS) 是例外——见
 *  getFullSongProviders()。 */
export const FULL_SONG_PROVIDERS: MusicProvider[] = ['qq', 'netease'];

/** 根据 Spotify 订阅档位决定是否把 Spotify 纳入「全曲流」候选。Free 档
 *  只能听 30s 预览，仍走 30s 试听完切别家；Premium 才走 WPS 全曲。 */
export function getFullSongProviders(spotifyTier?: string | null): MusicProvider[] {
  if (spotifyTier === 'premium' || spotifyTier === 'premium-duo' || spotifyTier === 'premium-family') {
    return [...FULL_SONG_PROVIDERS, 'spotify'];
  }
  return [...FULL_SONG_PROVIDERS];
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
export function pickUpgradeSource<T extends { platform: string; hasCopyright: boolean; vipLocked?: boolean }>(
  sources: T[],
  tried: Set<string>,
  fullProviders: readonly string[] = FULL_SONG_PROVIDERS,
): T | undefined {
  for (const p of fullProviders) {
    const s = sources.find(
      (src) => src.platform === p && !tried.has(p),
    );
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
    const spotifySrc = wpsReady
      ? it.sources.find((s) => s.platform === 'spotify')
      : undefined;
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
    if (t) {
      tracks.push(t);
      unifiedItems.push(it);
    }
  }
  return { tracks, unifiedItems };
}
