/**
 * 歌单曲目身份（playlist track identity）。
 *
 * ## 为什么必须放 common
 *
 * server 追加曲目时**去重**，renderer 的歌单管理弹窗要显示「已在歌单」。
 * 这两处如果各写一份 key：
 * - 客户端按 `id` 判「不在歌单」→ 放行「+ 加」
 * - 服务端按 `platform:trackId` 判「重复」→ 跳过
 * - ⇒ 用户点了「+」，歌单长度**不变**，界面上也没提示 → 症状是「点了没反应」
 *
 * 这跟 `normalizer.ts` 那套归一函数是同一类问题：**两端必须算出同一个答案**，
 * 否则前端显示的和后端实际做的对不上。详见 `AGENTS.md`「跨包归一工具」。
 *
 * ## 判定规则
 *
 * - 有 `sources[0]` → `${platform}:${trackId}`（跨平台同一首歌在歌单里只算一首）
 * - 没有 `sources`  → `id`（退化路径：老数据 / 无源曲目）
 *
 * 参数用**结构化最小类型**而不是 import server/renderer 的 `UnifiedSearchItem`：
 * 两端的 `UnifiedSearchItem` 是**各写一份**的（server `music/types.ts` /
 * renderer `api.ts`），字段结构相同但类型不通用 —— common 不能依赖任一端。
 */

/** 曲目的第一个音源（只需 platform + trackId 就能定身份）。 */
export interface PlaylistTrackKeySource {
  platform: string;
  trackId: string;
}

/** 能算出歌单曲目身份所需的最小结构。 */
export interface PlaylistTrackKeyInput {
  id: string;
  sources?: readonly PlaylistTrackKeySource[] | undefined;
}

/**
 * 歌单里一首曲目的唯一 key。
 *
 * server `PlaylistService` 的追加去重 / 移除匹配，和 renderer
 * 「已在歌单」判定，用的都是这个函数。
 */
export function playlistTrackKey(track: PlaylistTrackKeyInput): string {
  const first = track.sources?.[0];
  return first ? `${first.platform}:${first.trackId}` : track.id;
}
