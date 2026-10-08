import type { MusicProvider } from '../common/provider';
import { normalizeKey, displayKey, artistLooseMatch } from '@maestro/common';
import { artistTransliterationMatch, titleTransliterationMatch } from './translit';
import { PLAY_PRIORITY } from './search.util';
import type { AlbumSource, UnifiedAlbum } from './album-types';

/**
 * 专辑跨平台合并（spec: specs/album-search/spec.md「合并逻辑」）。
 *
 * 与 `search.util.ts` 平级独立成文件 —— search.util 已经 700+ 行且全是
 * 单曲语义，混进去两边都会难读。
 */

/** trackCount 分歧阈值：max/min > 1.5 即判定为不同版本（再版/豪华版/翻唱）。 */
const TRACK_COUNT_DIVERGENCE = 1.5;

/** 归一化平台优先级：代表项取第一个。 */
function priorityOf(p: MusicProvider): number {
  const i = PLAY_PRIORITY.indexOf(p);
  return i === -1 ? PLAY_PRIORITY.length : i;
}

/** 跨源中位数（偶数取下中位）。空数组 → 0。
 *  为什么不用最大：再版/豪华版曲目数虚高，取最大会被它污染。 */
function median(nums: number[]): number {
  const xs = nums.filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : xs[mid - 1];
}

/** 最早的非零年份（合辑常给 0）。 */
function earliestYear(sources: AlbumSource[]): number {
  const ys = sources.map((s) => s.year).filter((y) => y > 0);
  return ys.length ? Math.min(...ys) : 0;
}

/**
 * 组内曲目数是否分歧过大。
 *
 * ⚠️ 计算分母时**必须排除 trackCount === 0**（平台没给），否则「QQ 报了 11 首 +
 * 某平台没报」会被算成无穷大分歧，把本该合并的专辑拆开。
 */
function hasTrackDivergence(sources: AlbumSource[]): boolean {
  const counts = sources.map((s) => s.trackCount).filter((n) => typeof n === 'number' && n > 0);
  // 少于 2 个有效值 → 无从比较
  if (counts.length < 2) return false;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  if (min <= 0) return false;
  return max / min > TRACK_COUNT_DIVERGENCE;
}

export interface BuildUnifiedAlbumsOptions {
  /** 原始查询词。给了才做相关性排序（库合并场景无 query 不需要）。 */
  query?: string;
}

/**
 * 跨平台合并专辑。
 *
 * 合并键 = `normalizeKey(title, artist)` —— 复用 common 的归一器，
 * **禁止**在本文件另写一份（CLAUDE.md 明令：跨包归一工具禁止两端各写一份）。
 *
 * 关键规则：`trackCount` 分歧 >50% 的组**不跨平台合并**，同平台内各自成卡片并
 * 打 `variantMismatch`。理由：搜「叶惠美」QQ=周杰伦 11 首 / 网易云=王珏子乔 18 首
 * （翻唱）/ Deezer=19 首，合并错 = 整张专辑的曲目列表是错的，比误并单曲严重得多。
 */
export function buildUnifiedAlbums(
  all: AlbumSource[],
  opts: BuildUnifiedAlbumsOptions = {},
): UnifiedAlbum[] {
  if (!Array.isArray(all) || all.length === 0) return [];

  // ① 先按 trackCount 分歧把「明显不是同一张」的拆开：
  //    同名同艺人的一组，若源之间曲目数分歧大，就按平台切开，各自成组。
  const prelim = new Map<string, AlbumSource[]>();
  for (const src of all) {
    const key = normalizeKey(src.title ?? '', src.artist ?? '');
    if (!key) continue; // 标题+艺人都空 → 无法归一，跳过
    const bucket = prelim.get(key);
    if (bucket) bucket.push(src);
    else prelim.set(key, [src]);
  }

  // ② 每个 key 的组：分歧大 → 按 platform 再切一层（并标 variantMismatch）
  interface Group {
    sources: AlbumSource[];
    variantMismatch: boolean;
  }
  const groups: Group[] = [];
  for (const bucket of prelim.values()) {
    const divergent = hasTrackDivergence(bucket);
    if (!divergent) {
      groups.push({ sources: bucket, variantMismatch: false });
      continue;
    }
    // 按平台切开：同一平台内部仍然合并（不同版本是不同 key 的，本来就在不同组）
    const byPlatform = new Map<MusicProvider, AlbumSource[]>();
    for (const s of bucket) {
      const arr = byPlatform.get(s.platform);
      if (arr) arr.push(s);
      else byPlatform.set(s.platform, [s]);
    }
    for (const list of byPlatform.values()) {
      groups.push({ sources: list, variantMismatch: true });
    }
  }

  // ③ 组 → UnifiedAlbum
  const items: UnifiedAlbum[] = groups.map((g) => {
    // 代表项：按 PLAY_PRIORITY 取第一个（qq > netease > deezer > spotify）
    const sources = [...g.sources].sort((a, b) => priorityOf(a.platform) - priorityOf(b.platform));
    const rep = sources[0];
    const idKey = normalizeKey(rep.title, rep.artist);
    const out: UnifiedAlbum = {
      id: `merged-${idKey}`.slice(0, 120),
      title: rep.title,
      artist: rep.artist,
      // 封面：组内首个非空（跨平台取，同 unified-search:15 口径）
      coverUrl: sources.find((s) => s.coverUrl)?.coverUrl ?? '',
      trackCount: median(sources.map((s) => s.trackCount)),
      year: earliestYear(sources),
      sources,
    };
    if (g.variantMismatch) out.variantMismatch = true;
    return out;
  });

  return opts.query ? sortAlbumsByRelevance(items, opts.query) : items;
}

/**
 * 专辑相关性排序（分页前调用）。
 *
 * ⚠️ 与 `search.util.ts:sortByRelevance` 是**两套独立实现**，口径刻意保持一致
 * （标题全等 +120 / 前缀 +70 / 包含 +50，艺人全等 +60 / 包含 +30，多 token +20，
 * 同分按平台内 rank 升序）。**改一处必须改另一处。**
 *
 * 为什么不抽公共函数：那边签名绑死 `UnifiedSearchItem`（track 语义），泛化要动
 * 已上线的单曲搜索排序代码，收益不抵风险。接受这几十行重复。
 */
export function sortAlbumsByRelevance(albums: UnifiedAlbum[], query: string): UnifiedAlbum[] {
  const qKey = displayKey(query, '');
  if (!qKey) return albums;
  const tokens = query
    .split(/\s+/)
    .map((t) => displayKey(t, ''))
    .filter((t) => t && t !== qKey);
  const score = (a: UnifiedAlbum): number => {
    const titleK = displayKey(a.title, '');
    const artistK = displayKey(a.artist, '');
    let s = 0;
    if (titleK === qKey) s += 120;
    else if (titleK.startsWith(qKey)) s += 70;
    else if (titleK.includes(qKey)) s += 50;
    if (artistK === qKey) s += 60;
    else if (artistK.includes(qKey)) s += 30;
    for (const tk of tokens) {
      if (titleK.includes(tk) || artistK.includes(tk)) s += 20;
    }
    return s;
  };
  // 组内最小 rank：多平台命中时取最好的那个平台名次
  const bestRank = (a: UnifiedAlbum): number => {
    const rs = a.sources.map((s) => s.rank).filter((r) => typeof r === 'number');
    return rs.length ? Math.min(...rs) : Number.MAX_SAFE_INTEGER;
  };
  // Array.prototype.sort 自 ES2019 起稳定 —— 同分同 rank 保持插入序。
  return [...albums].sort((a, b) => score(b) - score(a) || bestRank(a) - bestRank(b));
}

/**
 * 判断两个专辑源是否指向同一张专辑（跨脚本/别名桥接）。
 *
 * `normalizeKey` 分组是主路径；这里给「CJK ↔ 罗马音」的场景兜底 ——
 * Deezer 的 artist 常是罗马音（实测「叶惠美」→ `Jue Wang`），QQ/网易云是汉字，
 * 纯 `normalizeKey` 分不到一组。这里走 `artistLooseMatch`（别名表）或
 * `artistTransliterationMatch`（拼音佐证），且要求专辑名也可桥接。
 *
 * ⚠️ 条件比单曲的 `mergeCrossScript` 严：专辑搜索是全目录密度，裸跨脚本会把
 * 同艺人的不同专辑误并。只在「专辑名跨脚本可桥 + 艺人也可桥」时才认。
 */
export function albumsProbablySame(a: AlbumSource, b: AlbumSource): boolean {
  if (normalizeKey(a.title, a.artist) === normalizeKey(b.title, b.artist)) {
    return true;
  }
  const ta = displayKey(a.title, '');
  const tb = displayKey(b.title, '');
  if (!ta || !tb || ta === tb) return false; // 专辑名必须也能桥，否则不并
  const titleBridge =
    isCrossScriptPair(ta, tb) &&
    (ta.includes(tb) || tb.includes(ta) || translitTitlesMatch(ta, tb));
  if (!titleBridge) return false;
  return artistLooseMatch(a.artist, b.artist) || artistTransliterationMatch(a.artist, b.artist);
}

/** 粗判两个 key 是否来自不同书写系统（CJK vs 拉丁/假名）。 */
function isCrossScriptPair(a: string, b: string): boolean {
  const hasCjk = (s: string) => /[぀-ヿ一-鿿]/.test(s);
  const hasLatin = (s: string) => /[a-zA-Z]/.test(s);
  return hasCjk(a) !== hasCjk(b) && hasLatin(a) !== hasLatin(b);
}

/** 专辑名音译佐证（复用 search 的跨脚本标题判定思路：只认整串相等，不做 includes，
 *  防 Song ↔ Song II 误并）。词典未预热时内部会优雅降级为 false。 */
function translitTitlesMatch(a: string, b: string): boolean {
  return titleTransliterationMatch(a, b);
}
