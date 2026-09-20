/**
 * 口味档案（P0-a）——把"统一库"压成一份**稳定**的用户口味描述。
 *
 * 为什么需要它：v1.1 直接从全库**均匀随机**采 150 首喂给模型。对 3000 首的混合
 * 库（日音 + 古典 + 电子 + 华语），这个样本是风格沙拉，而 prompt 却要求"风格
 * 相近"；更要命的是每次 run 重新随机 → 口味锚点每次都在漂，用户点第三次推荐就
 * 觉得"不像我"。
 *
 * 这里把口味拆成两半：
 *  - **主干（稳定）**：`artists` / `anchors` 由库的组成**确定性**决定，同一会话
 *    内多次 run 不变（库变了才重算）。
 *  - **种子（每轮换）**：`seeds` 按**艺人亲和度加权**采样——每轮换一批，但始终
 *    落在用户真实口味内，而不是均匀撒到全库。
 *
 * 纯函数，无 IO，方便单测。
 */
import { normalizeKey, splitArtists } from '@maestro/common';
import type { UnifiedSearchItem } from '../music/types';

/** 喂给 prompt 的种子规模（沿用 v1.1 的 token 预算）。 */
export const TASTE_SEED_COUNT = 150;
/** 口味主干点名的艺人数（沿用 v1.1 的 TOP_ARTISTS_HINT）。 */
export const TASTE_ANCHOR_COUNT = 6;
/** 种子中"长尾探索"比例——避免完全困在 top 艺人的回音壁里。 */
export const TASTE_EXPLORE_RATIO = 0.3;

export interface ArtistAffinity {
  /** 库里的原始写法（多艺人歌取第一个出现的写法）。 */
  name: string;
  /** `normalizeKey(name, '')` —— 与搜索/去重同口径，跨大小写与符号变体归一。 */
  key: string;
  /** 该艺人在库里的曲目数。 */
  songs: number;
  /** 行为信号带来的加权（带符号，0 = 没有任何信号）。 */
  signal: number;
  /** 最终权重 = 曲目数 + 有界信号加权；排序与采样都用它。 */
  weight: number;
}

export interface TasteProfile {
  /** 库规模。 */
  size: number;
  /** 库签名——库变化（导入/合并）后签名变，用于缓存失效。 */
  signature: string;
  /** 全部艺人按时（曲目数）降序。 */
  artists: ArtistAffinity[];
  /** 口味主干：top N 艺人名，稳定不随 run 漂移。 */
  anchors: string[];
  /** 本轮种子样本（亲和度加权 + 长尾探索）。 */
  seeds: UnifiedSearchItem[];
}

/** 不含种子的"主干"——可跨 run 缓存。 */
export type TasteProfileCore = Omit<TasteProfile, 'seeds'>;

export interface TasteProfileOptions {
  /** 库的导入时间戳，参与签名（同一 session 重新导入 → 档案重算）。 */
  importedAt?: number;
  /** 艺人维度的信号分（`signals.ts` 的 `artistSignalScores`）。 */
  signalScores?: Map<string, number>;
  anchorCount?: number;
  seedCount?: number;
  exploreRatio?: number;
  rng?: () => number;
}

/** 库签名：规模 + 导入时间。库内容变化（合并/自愈）不改签名——口味主干对
 *  平台来源漂移不敏感，没必要为此重算。 */
export function librarySignature(
  items: UnifiedSearchItem[],
  importedAt?: number,
): string {
  return `${items.length}:${importedAt ?? 0}`;
}

/**
 * 艺人亲和度：拆多艺人（`A / B`、`A & B`、`A feat. B`）后逐个计数。
 * 一首里重复出现的同一艺人只算一次；空艺人名丢弃。
 */
export function artistAffinity(
  items: UnifiedSearchItem[],
  signalScores?: Map<string, number>,
): ArtistAffinity[] {
  const byKey = new Map<string, ArtistAffinity>();
  for (const it of items) {
    const seen = new Set<string>();
    for (const raw of splitArtists(it.artist ?? '')) {
      const name = raw.trim();
      if (!name) continue;
      const key = normalizeKey(name, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hit = byKey.get(key);
      if (hit) hit.songs += 1;
      else byKey.set(key, { name, key, songs: 1, signal: 0, weight: 1 });
    }
  }
  // 行为信号接入：把（带时间衰减的）信号分折进来。**有界**是关键——不让
  // 单曲循环刷出的 +50 把口味档案彻底带偏：
  //  - 正分最多 +10（约占一次重听的量级，足够把常听艺人顶到前面）
  //  - 负分最多把该艺人的"曲目数权重"归零（不变成负数，否则会被当成噪音）
  for (const a of byKey.values()) {
    const raw = signalScores?.get(a.key) ?? 0;
    const bounded = Math.max(-a.songs, Math.min(raw, 10));
    a.signal = bounded;
    a.weight = Math.max(0, a.songs + bounded);
  }
  // 权重降序；同分按 key 的码点排序保证**稳定**（同一份库 → 同一份主干）。
  // 刻意不用 localeCompare——它随 ICU/locale 变，会让 anchors 在不同机器上漂。
  return [...byKey.values()].sort(
    (a, b) =>
      b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * 亲和度加权采样（Efraimidis–Spirakis：`key = rng()^(1/w)` 取 top n，等价于
 * 按权重不放回抽样，O(n log n)）。
 *
 * 权重 = 该曲目**最高亲和**艺人的曲目数（多艺人取最大），未知艺人记 1——保证
 * 长尾歌仍有机会，但远低于常听艺人。
 *
 * `exploreRatio` 比例的坑位留给**均匀随机**：既贴口味，又不至于每轮都是同一批
 * 头部歌。rng 可注入，测试里给确定性序列。
 */
export function pickTasteSeeds(
  items: UnifiedSearchItem[],
  affinity: ArtistAffinity[],
  opts: {
    count: number;
    exploreRatio?: number;
    rng?: () => number;
  },
): UnifiedSearchItem[] {
  const count = Math.max(0, Math.floor(opts.count));
  if (count === 0) return [];
  if (items.length <= count) return items.slice();

  const rng = opts.rng ?? Math.random;
  const weightByKey = new Map<string, number>();
  for (const a of affinity) weightByKey.set(a.key, Math.max(0.1, a.weight));
  const weightOf = (it: UnifiedSearchItem): number => {
    let w = 1;
    for (const raw of splitArtists(it.artist ?? '')) {
      const key = normalizeKey(raw.trim(), '');
      const hit = weightByKey.get(key);
      if (hit && hit > w) w = hit;
    }
    return w;
  };

  const exploreCount = Math.min(
    count,
    Math.floor(count * (opts.exploreRatio ?? TASTE_EXPLORE_RATIO)),
  );
  const exploitCount = count - exploreCount;

  // exploit：亲和度加权不放回抽样。
  const scored = items.map((it) => ({
    it,
    k: Math.pow(rng(), 1 / weightOf(it)),
  }));
  scored.sort((a, b) => b.k - a.k); // k 越大越优先（k=1 是最理想）
  const picked = scored.slice(0, exploitCount);
  const pickedSet = new Set(picked.map((p) => p.it));

  // explore：剩余曲目里的均匀随机（部分 Fisher-Yates）。
  const rest = items.filter((it) => !pickedSet.has(it));
  for (let i = 0; i < exploreCount && i < rest.length; i++) {
    const j = i + Math.floor(rng() * (rest.length - i));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const explore = rest.slice(0, exploreCount);

  // 主干采样与长尾探索交错排列——prompt 里的顺序会影响模型的注意力分布，
  // 把长尾均匀撒开比全堆在末尾更不容易被忽略。
  const head = picked.map((p) => p.it);
  const total = head.length + explore.length;
  const out: UnifiedSearchItem[] = [];
  let hi = 0;
  let ei = 0;
  while (hi < head.length || ei < explore.length) {
    if (hi >= head.length) {
      out.push(explore[ei++]);
      continue;
    }
    if (ei >= explore.length) {
      out.push(head[hi++]);
      continue;
    }
    // 已排位置里"应出现"的 explore 条数——超过已放入的数量就插一条。
    const expect = Math.floor(((out.length + 1) * explore.length) / total);
    if (expect > ei) out.push(explore[ei++]);
    else out.push(head[hi++]);
  }
  return out.slice(0, count);
}

/** 口味主干（不含种子）——确定性的，可跨 run 复用。 */
export function buildProfileCore(
  items: UnifiedSearchItem[],
  opts: TasteProfileOptions = {},
): TasteProfileCore {
  const artists = artistAffinity(items, opts.signalScores);
  const anchorCount = opts.anchorCount ?? TASTE_ANCHOR_COUNT;
  return {
    size: items.length,
    signature: librarySignature(items, opts.importedAt),
    artists,
    anchors: artists.slice(0, Math.max(0, anchorCount)).map((a) => a.name),
  };
}

/** 完整档案（主干 + 本轮种子）。 */
export function buildTasteProfile(
  items: UnifiedSearchItem[],
  opts: TasteProfileOptions = {},
): TasteProfile {
  const core = buildProfileCore(items, opts);
  const seeds = pickTasteSeeds(items, core.artists, {
    count: opts.seedCount ?? TASTE_SEED_COUNT,
    exploreRatio: opts.exploreRatio,
    rng: opts.rng,
  });
  return { ...core, seeds };
}

/**
 * 每轮轮换的"探索艺人"：从主干之外的中频艺人里随机挑几个。用于候选池
 * ——主干艺人保证贴脸，探索艺人保证每批有点新东西。
 */
export function pickExploreArtists(
  artists: ArtistAffinity[],
  anchors: string[],
  count: number,
  rng: () => number = Math.random,
): string[] {
  const anchorKeys = new Set(anchors.map((a) => normalizeKey(a, '')));
  const pool = artists.filter((a) => !anchorKeys.has(a.key)).map((a) => a.name);
  if (pool.length === 0 || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count && i < pool.length; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}
