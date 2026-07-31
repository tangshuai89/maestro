// 只引 t2cn 子路径（繁→简），不是 full——full 含双向词典 ~1.18MB，t2cn ~103KB。
// 我们只需要 tw→cn（把 Spotify 繁体折向 QQ/网易云的简体），10x 更小的包体。
import { Converter } from 'opencc-js/t2cn';
import type { UnifiedSearchItem, MusicProvider } from '../api';

/**
 * 繁→简折叠（OpenCC tw→cn），和后端 `search.util.ts` 的 `cjkUnify` 同口径。
 *
 * 为什么前端也要做：后端 `normalizeKey` 已经 tw→cn，但 `buildUnifiedItems` 会
 * 先按 normalizeKey 分组、再按时长 ±3s 聚类成「版本」。Spotify 的繁体版和
 * QQ/网易云的简体版若时长差 >3s，会被拆成两个 UnifiedSearchItem 送到前端。
 * 前端 `stripForFuzzy` 若不做繁→简，就用「龍捲風」vs「龙卷风」两个不同 key，
 * 永远并不回来——展示层就把简繁拆开了。这里补上，让分组 key 与后端一致。
 *
 * 懒初始化 + 兜底：OpenCC 构造偶发抛错时降级成恒等函数（不至于整列表崩）。
 */
let _tw2cn: ((t: string) => string) | null = null;
function tw2cn(s: string): string {
  if (!s) return s;
  if (!_tw2cn) {
    try {
      _tw2cn = Converter({ from: 'tw', to: 'cn' });
    } catch {
      _tw2cn = (t: string) => t;
    }
  }
  const conv = _tw2cn ?? ((t: string) => t);
  return conv(s);
}
/** 日文独有形体（OpenCC tw→cn 不覆盖）——与后端 search.util 的 JP_KANJI 对齐。 */
const JP_KANJI: Record<string, string> = { 気: '气', 黒: '黑' };
function cjkUnify(s: string): string {
  return tw2cn(s).replace(/[気黒]/g, (ch) => JP_KANJI[ch] || ch);
}

/**
 * 红心库的「展示级」跨平台分组。
 *
 * 后端 `buildUnifiedItems` 用 `normalizeKey`(歌名+歌手) 严格合并，但 QQ 常给
 * 标题加中文译名括号（「夜に駆ける (向夜晚奔去)」）、歌手加别名（「YOASOBI
 * (ヨアソビ)」），于是和网易云的「夜に駆ける / YOASOBI」归一 key 不同 → 拆成
 * 两条。这里用更宽的 key（去掉成对括号内容后再归一）+ 时长就近，把「同一首歌
 * 的跨平台副本」并成一个可展开的组。
 *
 * **仅用于弹窗展示**——不改后端红心/播放数据，也不动播放队列（`onPlay` 仍按
 * 成员在原始 items 数组里的下标定位，播放行为不变）。所以即便偶尔把两个不同
 * 版本误并到一组，代价也只是展示分组，不会点错红心。
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

/** 同一 fuzzyKey 内，时长差 ≤ 此值才并入同一组（秒）。跨平台同一录音通常只差
 *  几秒；studio / live 版差得多，靠这个阈值分开，避免把不同版本误并。 */
const DURATION_TOL_SEC = 12;

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
 * 顺序按 BADGE_ORDER 排，去重。 */
export function likedPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  const list = item.likedPlatforms ?? item.sources.map((s) => s.platform);
  const set = new Set(list);
  return BADGE_ORDER.filter((p) => set.has(p));
}

/** 归一：去成对括号及内容 → 全角转半角 → 去空格标点 → 小写。
 *
 *  还额外去掉 feat./ft./featuring 后缀（含括号和无括号两种形式），
 *  让「Promise in Love feat. Jose James」与「Promise in Love」收敛到
 *  同一 fuzzy key。Cover/原唱/翻唱 等标注同理。修订依据：
 *  PR #45 的跨平台 ❤ 错配排查（"Promise in Love" 被拆成 3 条，无法合并）。 */
function stripForFuzzy(s: string): string {
  return cjkUnify(
    s
      .replace(/[（(【[][^)）\]】]*[)）\]】]/g, '') // 去成对括号及里面的内容
      // 去掉 feat./ft./featuring + 后缀名（括号已剥，这一遍只打无括号的 inline
      // feat.。`+` 而非 `[^-...]+` 因为 feat 后面的名字可能有空格如 "Jose James"）
      .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/ig, '')
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s\-_,.·&+/!?！？:：;；'"’”‘“()（）[\]【】~〜～]+/g, ''),
  ).toLowerCase();
}

/** 不去括号的归一——去括号后整段为空时兜底用（罕见：标题整个在括号里）。 */
function normalizeNoStrip(s: string): string {
  return cjkUnify(
    s
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s\-_,.·&+/!?！？:：;；'"’”‘“()（）[\]【】~〜～]+/g, ''),
  ).toLowerCase();
}

/** 分组用的模糊 key：去括号归一的「歌名|歌手」。
 *  歌手侧先按 `/` / `&` / `、` / `,` 拆 token，归一后**排序**再拼回——
 *  这样「José James / DJ MITSU THE BEATS」和「DJ Mitsu The Beats / José James」
 *  收敛到同一个 key，不受名字顺序影响。 */
export function fuzzyKey(title: string, artist: string): string {
  const t = stripForFuzzy(title) || normalizeNoStrip(title);
  return `${t}|${sortedArtistKey(artist)}`;
}

/** 把 artist 名按分隔符拆 token，每个 token 归一到 fuzzy 形式，排序后拼接。
 *  分隔符目前识别 `/` `&` `、` `,`（中文顿号、日文中点已被 stripForFuzzy 的
 *  第 4 步去掉，不在此处处理）。 */
function sortedArtistKey(artist: string): string {
  const tokens = artist.split(/\s*[/&、,]\s*/);
  if (tokens.length <= 1) return stripForFuzzy(artist);
  const normalized = tokens
    .map((tok) => stripForFuzzy(tok))
    .filter(Boolean)
    .sort();
  return normalized.join('');
}

/**
 * 是否「同人异名」：两组 fuzzyKey 不同，但 artist fuzzyKey 一方是另一方的
 * 前缀/后缀（且至少一方长度 ≥ 2）。修「F.I.R.」 vs 「F.I.R.飞儿乐团」这种
 * 库内被 publish API 写命差异误拆成 2 条的回归。
 *
 * 例子：
 *   - 「fir」vs「fir飞儿乐团」 → contains=true → 合并
 *   - 「周杰伦」vs「周杰伦团队」 → contains=true → 合并
 *   - 「jay」vs「jaychou」 → contains=true → 合并
 *   - 「jay」vs「tom」 → contains=false → 不合并
 *   - 「a」vs「abc」 → 长度 < 2 拒绝（防 "A" 撞 "ABC" 误并）
 *   - 「林俊杰」vs「俊杰林」 → chars 不一致 → contains 不命中 → 拒绝（不依赖顺序）
 */
function artistPrefixMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

interface MutableGroup extends LibraryGroup {
  anchorDuration: number;
}

export function groupLibraryItems(items: UnifiedSearchItem[]): LibraryGroup[] {
  const byFk = new Map<string, MutableGroup[]>();
  const order: MutableGroup[] = [];

  // 预先把每个 item 的 fuzzyKey / artist fuzzyKey 算好，避免 O(N²) 里重复调。
  const enriched = items.map((item, index) => {
    const fullKey = fuzzyKey(item.title, item.artist);
    const sep = fullKey.indexOf('|');
    const titleKey = sep >= 0 ? fullKey.slice(0, sep) : fullKey;
    const artistKey = sep >= 0 ? fullKey.slice(sep + 1) : '';
    return { item, index, fullKey, titleKey, artistKey };
  });

  enriched.forEach((e) => {
    let bucket = byFk.get(e.fullKey);
    if (!bucket) {
      bucket = [];
      byFk.set(e.fullKey, bucket);
    }
    // 同 fk 里找一个时长相近的组并入（两边时长都已知才比，否则允许并入）。
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
  });

  // 第二遍：fuzzyKey 不同但「同人异名」的组尝试合并（user 场景：QQ 写
  // F.I.R.飞儿乐团、网易云写 F.I.R.，fuzzyKey 拆成两组但其实是同一首歌）。
  // 只在 titleKey 完全相同 + artistKey 互为子串/被包含 + 时长相近时合并。
  // 同一 pass 内允许串联合并（A→B→C）。
  for (let i = 0; i < order.length; i++) {
    const anchor = order[i];
    if (!anchor) continue;
    const aFk = fuzzyKey(anchor.representative.title, anchor.representative.artist);
    const aSep = aFk.indexOf('|');
    const aTitle = aSep >= 0 ? aFk.slice(0, aSep) : aFk;
    const aArtist = aSep >= 0 ? aFk.slice(aSep + 1) : '';
    for (let j = i + 1; j < order.length; j++) {
      const cand = order[j];
      if (!cand) continue;
      const cFk = fuzzyKey(cand.representative.title, cand.representative.artist);
      const cSep = cFk.indexOf('|');
      const cTitle = cSep >= 0 ? cFk.slice(0, cSep) : cFk;
      const cArtist = cSep >= 0 ? cFk.slice(cSep + 1) : '';
      if (aTitle !== cTitle) continue;
      if (!artistPrefixMatch(aArtist, cArtist)) continue;
      const durA = anchor.anchorDuration;
      const durC = cand.anchorDuration;
      if (durA > 0 && durC > 0 && Math.abs(durA - durC) > DURATION_TOL_SEC) continue;
      // 合并 cand 进 anchor
      anchor.members.push(...cand.members);
      if (!(anchor.anchorDuration > 0) && durC > 0) {
        anchor.anchorDuration = durC;
      }
      order[j] = null as unknown as MutableGroup;
    }
  }
  const mergedOrder = order.filter((g): g is MutableGroup => g !== null);

  for (const g of mergedOrder) {
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

  return mergedOrder;
}

/** 单个统一条目覆盖的平台（去重、按徽章顺序）——子行徽章用。 */
export function itemPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  return likedPlatforms(item);
}
