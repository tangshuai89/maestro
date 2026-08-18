// 跨包共享的归一（displayKey）从 @maestro/common 引入——和 server normalizeKey
// 同一条流水线，确保 server 端合并的「UnifiedSearchItem」在弹窗里不会被重新
// 拆开 / 错并（前后端 fuzzy key 漂移是「合并不利索」的根因）。
import {
  artistLooseMatch,
  displayKey,
  extractVersionTag,
  normalizeKey,
  splitArtists,
  stageNameAliasMatch,
  stripParensContent,
  stripTrailingMeta,
  titleAliasKey,
  type VersionTag,
} from '@maestro/common';
import type { UnifiedSearchItem, MusicProvider } from '../api';

/**
 * 红心库的「展示级」跨平台分组。
 *
 * server `mergeLibrary` 用 `normalizeKey`(歌名+歌手) 把跨平台同首合并到同
 * 一条 `UnifiedSearchItem`——但 server 现在因 `stripVersionTags` 把 (Live)
 * 与 (现场版) 落到不同 key（catalog 级跨版本隔离），所以一个 group 内可能
 * 出现「海阔天空」+「海阔天空 (Live)」两条不同 item。这里把它们按 displayKey
 * 重新聚到同一 group，**展开后用 versionTag 染色**让用户区分版本。翻唱
 * （COVER）也在同 group 里展开，但折叠行默认不展示它（representative 优先
 * 取 studio + 有封面）。
 *
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
  /** 折叠态展示用的代表条目（studio + 有封面优先，其次标题最简洁，COVER 排末）。 */
  representative: UnifiedSearchItem;
  /** 代表条目在原始 items 数组里的下标（点折叠行播放时传给 onPlay）。 */
  representativeIndex: number;
  /** 组内所有成员（含原始下标、版本标签，展开子列表 + 点击播放用）。 */
  members: Array<{
    item: UnifiedSearchItem;
    index: number;
    versionTag: VersionTag;
  }>;
  /** 组覆盖的平台（去重、按徽章优先级排序）。 */
  platforms: MusicProvider[];
  /** 组内**任一成员是 COVER**——折叠行加 ⚠ 翻唱提示。 */
  hasCover: boolean;
}

// 2026-08-07 需求变更：**同歌曲 + 同歌手全部合并**——不再按时长拆组。
// 同一 displayKey（title+artist 归一相等）无论 studio / live / remix /
// acoustic 全部并成一个 group，版本差异靠展开子行 + versionTag 染色体现。
// 旧版按时长 ±5s 聚类会把「Live 320s vs studio 300s」拆成两组（用户明确
// 不要：同歌同歌手就是一首歌，版本只是子条目）。

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
  /** 组代表艺人的原始串 + 归一 key——桶内「同人」判等用（不等同 title 时
   *  新建组；同 title 不同人靠这俩区分）。 */
  artist: string;
  artistKey: string;
}

/**
 * 弹窗分组的「艺人同人」判定（2026-08-07 多艺人兜底，2026-08-14 增强）：
 *  1) 归一相等（cjkUnify 简繁统一 + noise strip）
 *  2) 策展别名表整串命中（陈绮贞 = Cheer Chen）
 *  3) 「artist·album」/「artist, album」复合串段段配对（@maestro/common
 *     `artistLooseMatch`）：「李荣浩·黑马」vs「Ronghao Li·黑馬」按
 *     `·`/`,` 切后段对段再查别名表。
 *  4) 多艺人拆分配对：任一方 ≥2 人时，按分隔符拆开逐对匹配
 *     （归一相等 或 表别名），命中 ≥ ceil(多侧/2) 即同人——
 *     Vocaloid「のぼる↑P / 初音未来」vs「Noboru」这类组合写法差异。
 * 单艺人对单艺人仍只走 1/2/3——Coldplay vs Cold、Taylor vs Taylor Swift
 * 这类巧合前缀不因拆分放宽而误并（双方都单艺人且无表内别名）。
 */
function artistsEquivalent(a: string, b: string): boolean {
  const na = normalizeKey(stripParensContent(a), '');
  const nb = normalizeKey(stripParensContent(b), '');
  if (na && nb && na === nb) return true;
  if (stageNameAliasMatch(a, b)) return true;
  // 「artist·album」/「artist, album」复合串段段配对（@maestro/common
  // `artistLooseMatch` 内部做：先整串 stageNameAliasMatch 再段段配对）。
  // 这里单独调一次：哪怕整串未命中（含 album 段），段段配对也能桥上。
  if (artistLooseMatch(a, b)) return true;
  const pa = splitArtists(a);
  const pb = splitArtists(b);
  if (pa.length < 2 && pb.length < 2) return false;
  let matched = 0;
  for (const x of pa) {
    for (const y of pb) {
      const nx = normalizeKey(stripParensContent(x), '');
      const ny = normalizeKey(stripParensContent(y), '');
      if ((nx && ny && nx === ny) || stageNameAliasMatch(x, y)) {
        matched++;
        break;
      }
    }
  }
  // 以「多的一侧」过半为命中（与 server artistLooseMatch 的 ceil(n/2) 同哲学）。
  const need = Math.ceil(Math.max(pa.length, pb.length) / 2);
  return matched > 0 && matched >= need;
}

export function groupLibraryItems(items: UnifiedSearchItem[]): LibraryGroup[] {
  // 2026-08-07 分两级：
  //  1) title 桶：按 displayKey(title, '') 归一（剥括号/feat/简繁/大小写），
  //     同歌（含不同版本 studio/live/remix）进同一桶——这是上一轮「同歌
  //     同歌手全并」的桶。titleKey 再过 titleAliasKey 归等价类（策展表，
  //     如「悲歌」= 韩语「애절가」）——不同语言标题的同歌进同一桶（O(1)）。
  //  2) artist 判等：桶内再按 artistsEquivalent（归一相等 / 策展别名 /
  //     多艺人拆分配对）分 group——不同人同标题（花田错 王力宏 vs 王馨卓）
  //     仍拆开，别名表外不猜。
  // 别名表来自 @maestro/common（与 server 跨平台匹配同表，单一真值源）。
  const byTitle = new Map<string, MutableGroup[]>();
  const order: MutableGroup[] = [];

  // 预先把每个 item 的 titleKey + artistKey + versionTag 算好（一次摊销）。
  const enriched = items.map((item, index) => ({
    item,
    index,
    titleKey: titleAliasKey(displayKey(stripTrailingMeta(item.title), '')),
    artistKey: normalizeKey(item.artist, ''),
    versionTag: extractVersionTag(item.title),
  }));

  for (const e of enriched) {
    const targetBucket = byTitle.get(e.titleKey) ?? [];
    if (!byTitle.has(e.titleKey)) byTitle.set(e.titleKey, targetBucket);
    // 同 title 桶内：找「艺人同人」的既有 group（artistsEquivalent）。
    const g = targetBucket.find((grp) => artistsEquivalent(grp.artist, e.item.artist));
    if (g) {
      g.members.push({ item: e.item, index: e.index, versionTag: e.versionTag });
      if (!(g.anchorDuration > 0) && e.item.duration > 0) {
        g.anchorDuration = e.item.duration;
      }
    } else {
      const fresh: MutableGroup = {
        key: `${e.titleKey}#${order.length}`,
        representative: e.item,
        representativeIndex: e.index,
        members: [{ item: e.item, index: e.index, versionTag: e.versionTag }],
        platforms: [],
        hasCover: e.versionTag === 'COVER',
        anchorDuration: e.item.duration,
        artist: e.item.artist,
        artistKey: e.artistKey,
      };
      targetBucket.push(fresh);
      order.push(fresh);
    }
  }

  for (const g of order) {
    if (!g) continue;
    // 代表条目优先级：studio（versionTag=null）优先 → 有封面优先 →
    // 翻唱（COVER）排末 → **时长长优先** → 标题最短。
    // 时长长优先（2026-08-07）：默认播**原版/完整版**——重录版/短版
    // 通常更短（Humbert Humbert 日が落ちるまで：原版 296s vs 2021 重录版
    // 248s），而标题最短反而会选到重录版（标题更短更干净）。折叠行
    // 默认播长的原版，toggle 展开可自选其他版本。
    const rep = g.members.reduce((best, m) => {
      const bv = best.versionTag;
      const mv = m.versionTag;
      const bvIsStudio = bv === null;
      const mvIsStudio = mv === null;
      if (bvIsStudio !== mvIsStudio) return mvIsStudio ? m : best;
      const bc = best.item.coverUrl ? 1 : 0;
      const mc = m.item.coverUrl ? 1 : 0;
      if (mc !== bc) return mc > bc ? m : best;
      const bvIsCover = bv === 'COVER';
      const mvIsCover = mv === 'COVER';
      if (bvIsCover !== mvIsCover) return mvIsCover ? best : m;
      const bd = best.item.duration > 0 ? best.item.duration : 0;
      const md = m.item.duration > 0 ? m.item.duration : 0;
      if (bd !== md) return md > bd ? m : best;
      return m.item.title.length < best.item.title.length ? m : best;
    }, g.members[0]);
    g.representative = rep.item;
    g.representativeIndex = rep.index;

    // 角标 = 所有成员 likedPlatforms 的并集（fallback sources）。
    // likedPlatforms 反映用户真实 ❤ 状态（import + fanOut），比 sources 准。
    const set = new Set<MusicProvider>();
    let hasCover = false;
    for (const m of g.members) {
      if (m.versionTag === 'COVER') hasCover = true;
      for (const p of likedPlatforms(m.item)) set.add(p);
    }
    g.platforms = BADGE_ORDER.filter((p) => set.has(p));
    g.hasCover = hasCover;
  }

  return order;
}

/** 单个统一条目覆盖的平台（去重、按徽章顺序）——子行徽章用。 */
export function itemPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  return likedPlatforms(item);
}

/** 中文短标签：折叠行/子行展示版本用。 */
export function versionTagLabel(tag: VersionTag): string {
  switch (tag) {
    case 'LIVE':
      return '现场';
    case 'ACOUSTIC':
      return '原声';
    case 'REMIX':
      return '混音';
    case 'INSTRUMENTAL':
      return '伴奏';
    case 'COVER':
      return '翻唱';
    case 'KARAOKE':
      return '伴唱';
    case 'DEMO':
      return '样带';
    case 'EDIT':
      return '剪辑';
    default:
      return '';
  }
}
