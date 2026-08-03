// 跨包共享的归一（displayKey）从 @maestro/common 引入——和 server normalizeKey
// 同一条流水线，确保 server 端合并的「UnifiedSearchItem」在弹窗里不会被重新
// 拆开 / 错并（前后端 fuzzy key 漂移是「合并不利索」的根因）。
import { displayKey } from '@maestro/common';
import type { UnifiedSearchItem, MusicProvider } from '../api';

/**
 * 红心库的「展示级」跨平台分组。
 *
 * server `mergeLibrary` 用 `normalizeKey`(歌名+歌手) + 时长 ±3s 把跨平台
 * 同首合并到同一条 `UnifiedSearchItem`。这里再做一道展示级聚类：把 server
 * 拆开的不同版本（Live/Remix/Acoustic）重新聚到同一 group（可展开看子行），
 * 跨平台但 server 没合并的「同人异名」（如 QQ 写「F.I.R.飞儿乐团」/ 网易云
 * 写「F.I.R.」）也聚一起——这部分由 `displayKey` 在 `normalizeKey` 基础上
 * 加 `stripParensContent` 实现。
 *
 * **只做聚类，不做启发合并**：旧版的二级扫描（artistPrefixMatch）已删除——
 * 之前用 `includes` 启发，对「Coldplay vs Cold」「Taylor Swift vs Taylor」
 * 「Apple vs Apple Music」等纯巧合 prefix 误并，徽章（likedPlatforms 并集）
 * 会虚高。真正的同人异名合并交给 server `mergeLibrary` / `mergeCrossScript`
 * 走 catalog metadata 严格匹配。
 *
 * 仅用于弹窗展示——不改后端红心/播放数据。`onPlay` 仍按成员在 items 数组
 * 里的原始下标定位，播放行为不变。
 */
export interface LibraryGroup {
  /** 稳定的 React key。 */
  key: string;
  /** 折叠态展示用的代表条目（有封面优先、标题最简洁的成员）。 */
  representative: UnifiedSearchItem;
  /** 代表条目在原始 items 数组里的下标（点折叠行播放时传给 onPlay）。 */
  representativeIndex: number;
  /** 组内所有成员（含原始下标，展开子列表 + 点击播放用）。 */
  members: Array<{ item: UnifiedSearchItem; index: number }>;
  /** 组覆盖的平台（去重、按徽章优先级排序）。 */
  platforms: MusicProvider[];
}

/** 同一 displayKey 内，时长差 ≤ 此值才并入同一组（秒）。
 *
 *  跨平台同一录音通常差 0-3s；Live/Remix/Acoustic 差 5-30s+。
 *  5s 容差足以覆盖跨平台时长漂移，同时能把混音版/不插电版独立成条（不被
 *  原版误并）。旧版用 12s 导致 Remix (差 8s) / Acoustic (差 5s) 误并。 */
const DURATION_TOL_SEC = 5;

/** 徽章展示顺序（与播放优先级一致）。 */
export const BADGE_ORDER: MusicProvider[] = ['qq', 'netease', 'spotify', 'deezer'];

/**
 * 取『红心来源』平台列表——UI 角标唯一真相源。
 *
 * 优先级：
 *  1. `item.likedPlatforms`（后端 `getLibrary` 已叠加 import + fanOut 状态）→
 *     这是用户维度的真实 ❤ 集合，覆盖运行时跨平台同步。
 *  2. 落空 → `item.sources.map(s => s.platform)`（catalog 维度，搜索结果路径）。
 *
 * 顺序按 BADGE_ORDER 排，去重。
 */
export function likedPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  const list = item.likedPlatforms ?? item.sources.map((s) => s.platform);
  const set = new Set(list);
  return BADGE_ORDER.filter((p) => set.has(p));
}

interface MutableGroup extends LibraryGroup {
  anchorDuration: number;
}

export function groupLibraryItems(items: UnifiedSearchItem[]): LibraryGroup[] {
  const byFk = new Map<string, MutableGroup[]>();
  const order: MutableGroup[] = [];

  // 预先把每个 item 的 displayKey 算好（一次摊销）。displayKey 内部已经过
  // feat strip / 括号 strip / noise strip / OpenCC tw→cn / lowercase 整套
  // 流水线——和 server normalizeKey 同口径。
  const enriched = items.map((item, index) => ({
    item,
    index,
    fullKey: displayKey(item.title, item.artist),
  }));

  for (const e of enriched) {
    let bucket = byFk.get(e.fullKey);
    if (!bucket) {
      bucket = [];
      byFk.set(e.fullKey, bucket);
    }
    // 同 displayKey 内按时长聚类：差 ≤ DURATION_TOL_SEC 进同 group；超过则
    // 开新 group。同 displayKey 但跨平台时长差 >5s 的通常是不同版本
    // （live/remix/acoustic 短版），值得让用户分开看到。
    const g = bucket.find(
      (grp) =>
        !(grp.anchorDuration > 0 && e.item.duration > 0) ||
        Math.abs(grp.anchorDuration - e.item.duration) <= DURATION_TOL_SEC,
    );
    if (g) {
      g.members.push({ item: e.item, index: e.index });
      if (!(g.anchorDuration > 0) && e.item.duration > 0) {
        g.anchorDuration = e.item.duration;
      }
    } else {
      const fresh: MutableGroup = {
        key: `${e.fullKey}#${bucket.length}`,
        representative: e.item,
        representativeIndex: e.index,
        members: [{ item: e.item, index: e.index }],
        platforms: [],
        anchorDuration: e.item.duration,
      };
      bucket.push(fresh);
      order.push(fresh);
    }
  }

  for (const g of order) {
    if (!g) continue;
    // 代表：有封面优先，其次标题最短（通常是无译名括号的原名，更干净）。
    const rep = g.members.reduce((best, m) => {
      const bc = best.item.coverUrl ? 1 : 0;
      const mc = m.item.coverUrl ? 1 : 0;
      if (mc !== bc) return mc > bc ? m : best;
      return m.item.title.length < best.item.title.length ? m : best;
    }, g.members[0]);
    g.representative = rep.item;
    g.representativeIndex = rep.index;

    // 角标 = 所有成员 likedPlatforms 的并集（fallback sources）。
    // likedPlatforms 反映用户真实 ❤ 状态（import + fanOut），比 sources 准。
    const set = new Set<MusicProvider>();
    for (const m of g.members) {
      for (const p of likedPlatforms(m.item)) set.add(p);
    }
    g.platforms = BADGE_ORDER.filter((p) => set.has(p));
  }

  return order;
}

/** 单个统一条目覆盖的平台（去重、按徽章顺序）——子行徽章用。 */
export function itemPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  return likedPlatforms(item);
}