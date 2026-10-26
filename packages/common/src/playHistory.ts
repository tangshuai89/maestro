/**
 * 播放历史（最近播放）的**共享类型**（specs/play-history/）。
 *
 * 放 common 是因为 server（存/读）和 renderer（显示）都要用同一份形状 ——
 * 两边各写一份必然漂移（AGENTS.md：跨包类型放 `packages/common/src/`）。
 */

/**
 * 平台标识（结构化最小类型）。
 *
 * ⚠️ `MusicProvider` 在 server（`common/provider.ts`）和 renderer（`api.ts`）
 * **各写一份**，common 不能依赖任一端 —— 跟 `playlist.ts` 同一个理由。
 */
export type PlayHistoryPlatform = string;

/** 一条播放记录。 */
export interface PlayHistoryEntry {
  /** `platform:trackId` —— 去重用的身份键（同平台同一 track 算同一条）。 */
  id: string;
  platform: PlayHistoryPlatform;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  /** 时长（秒）；0 = 未知。 */
  duration: number;
  /** 播放时间（epoch ms）。 */
  playedAt: number;
}

/** 记录一条播放时前端要带的东西（服务端补 id / playedAt）。 */
export interface PlayHistoryInput {
  platform: PlayHistoryPlatform;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

/**
 * 最多记多少条。
 *
 * 200 条 ≈ 一个人两三天的播放量（重度用户更多）。再往上对「找回昨天那首」
 * 这个用途没有额外价值，却会让 state.json 一直变大。
 */
export const PLAY_HISTORY_LIMIT = 200;

/** 去重用的身份键。 */
export function playHistoryKey(platform: PlayHistoryPlatform, trackId: string): string {
  return `${platform}:${trackId}`;
}

/**
 * 把一条新播放并进历史：**去重 + 移到最前 + 截断**（纯函数）。
 *
 * 语义是「**最近播放**」而不是「每一次播放的流水」：
 * 同一首歌再听一次 → 移到最前、更新时间，**不追加第二条**。
 * （流水账对「找回昨天那首」这个用途没用，还会让列表被同一首歌刷屏。）
 */
export function mergePlayHistory(
  history: readonly PlayHistoryEntry[],
  entry: PlayHistoryEntry,
  limit: number = PLAY_HISTORY_LIMIT,
): PlayHistoryEntry[] {
  const rest = history.filter((h) => h.id !== entry.id);
  return [entry, ...rest].slice(0, Math.max(0, limit));
}

/** 规整一条记录：补 id、丢掉没用的字段。 */
export function normalisePlayHistoryEntry(
  input: PlayHistoryInput,
  playedAt: number = Date.now(),
): PlayHistoryEntry | null {
  if (!input || typeof input !== 'object') return null;
  const { platform, trackId, title, artist } = input;
  if (typeof platform !== 'string' || !platform) return null;
  if (typeof trackId !== 'string' || !trackId) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (typeof artist !== 'string' || !artist.trim()) return null;
  const duration = typeof input.duration === 'number' && input.duration > 0 ? input.duration : 0;
  return {
    id: playHistoryKey(platform, trackId),
    platform,
    trackId,
    title: title.trim(),
    artist: artist.trim(),
    ...(input.album ? { album: input.album } : {}),
    ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
    duration,
    playedAt,
  };
}
