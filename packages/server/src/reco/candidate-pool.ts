/**
 * 目录锚定候选池（P0-c）——把"让模型凭空想一首歌"换成"从真实目录里挑"。
 *
 * 为什么：v1.1 让 DeepSeek 直接输出 `{title, artist}`，两个损失同时发生——
 *  ① 幻觉条目在填源阶段被丢弃（白烧 token，批次常常凑不满 count）；
 *  ② 模型为求稳**只敢推超热门曲**，用户库里的深层口味永远出不来。
 * 主流播放器的做法是「检索（候选生成）+ 重排」，这里把检索这一半补上，
 * 交给 LLM 的是**已经从真实平台取回、且确认可播**的候选，它只负责挑选与排序。
 *
 * 三条候选来源：
 *  - `artist`：口味主干艺人（含每轮轮换的探索艺人）的**库外**曲目 → 深挖
 *  - `related-artist`：相邻艺人（Deezer 相关艺人 = 平台侧协同过滤）→ 跨艺人发现
 *  - `radio`：平台 FM / 榜单（网易云私人 FM 背后就是网易自己的推荐算法）→ 品味外扩
 *
 * 纯编排逻辑，所有 IO 由调用方以 `deps` 注入——方便单测，也让 "fail-soft 由
 * 谁负责" 这件事显式（deps 实现里就该兜成空数组，池子少一个来源不能打挂推荐）。
 */
import { normalizeKey } from '@maestro/common';
import type { RadioCandidate, UnifiedSearchItem } from '../music/types';
import { isAcceptableDuration, isBadVersionTitle } from './version-filter';

export type CandidateOrigin = 'artist' | 'related-artist' | 'radio';

export interface RecoCandidate {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  origin: CandidateOrigin;
  /** 这个候选是从哪位艺人（或哪条路径）扩展出来的——调试与多样性重排用。 */
  seedArtist?: string;
}

export interface CandidatePoolDeps {
  /** 按艺人名搜索该艺人的曲目（调用方负责 fail-soft 成空数组）。 */
  searchArtist(artist: string): Promise<UnifiedSearchItem[]>;
  /** 相邻艺人（调用方负责 fail-soft 成空数组）。 */
  findRelatedArtists(artist: string): Promise<string[]>;
  /** 平台 FM / 榜单候选；不提供则该来源缺席。 */
  fetchRadio?: () => Promise<RadioCandidate[]>;
}

export interface CandidatePoolOptions {
  /** 口味主干艺人（稳定）。 */
  anchors: string[];
  /** 每轮轮换的探索艺人。 */
  exploreArtists?: string[];
  library: UnifiedSearchItem[];
  exclude?: Array<{ title: string; artist: string }>;
  /** 主干里最多对几个艺人做深挖搜索。 */
  anchorLimit?: number;
  /** 最多对几个主干艺人做"相邻艺人"扩展。 */
  neighborAnchorLimit?: number;
  /** 每位主干艺人取几个相邻艺人。 */
  relatedPerAnchor?: number;
  /** 单个艺人搜索结果里最多取几首进池。 */
  perArtistCandidates?: number;
  /** 单个艺人在池里的总上限（深挖 + 相邻两条路径合计）。 */
  perArtistCap?: number;
  /** 池子上限（token 预算）。 */
  maxPoolSize?: number;
  /** 并发搜索的艺人数（压住对 QQ/网易云的读并发）。 */
  concurrency?: number;
}

export const DEFAULT_CANDIDATE_LIMITS = {
  anchorLimit: 4,
  neighborAnchorLimit: 3,
  relatedPerAnchor: 3,
  perArtistCandidates: 3,
  perArtistCap: 2,
  maxPoolSize: 120,
  concurrency: 4,
} as const;

/** 候选池构建结果（带上来源统计，run 响应里回给前端排查效果）。 */
export interface CandidatePoolResult {
  candidates: RecoCandidate[];
  /** 各来源贡献条数——调参时看这个就知道哪条路在供血。 */
  byOrigin: Record<CandidateOrigin, number>;
  /** 被过滤掉的原因统计（库内/坏版本/时长/去重/超配额）。 */
  dropped: {
    inLibrary: number;
    badVersion: number;
    duration: number;
    duplicate: number;
    overCap: number;
  };
}

/**
 * 构建候选池。顺序策略：主干深挖（最贴口味）打头，相邻艺人与电台**交错**补充
 * （避免 prompt 后半段全是同一来源），最后按 `maxPoolSize` 截断。
 */
export async function buildCandidatePool(
  deps: CandidatePoolDeps,
  opts: CandidatePoolOptions,
): Promise<CandidatePoolResult> {
  const limits = { ...DEFAULT_CANDIDATE_LIMITS, ...opts };
  const excluded = new Set<string>();
  for (const it of opts.library) excluded.add(normalizeKey(it.title, it.artist));
  for (const e of opts.exclude ?? []) {
    if (e?.title && e?.artist) excluded.add(normalizeKey(e.title, e.artist));
  }

  const dropped = {
    inLibrary: 0,
    badVersion: 0,
    duration: 0,
    duplicate: 0,
    overCap: 0,
  };
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();

  /** 统一的"能不能进池"判定 + 记账。 */
  const accept = (
    c: Omit<RecoCandidate, 'origin' | 'seedArtist'> & {
      origin: CandidateOrigin;
      seedArtist?: string;
    },
  ): RecoCandidate | null => {
    if (!c.title?.trim() || !c.artist?.trim()) return null;
    if (isBadVersionTitle(c.title)) {
      dropped.badVersion++;
      return null;
    }
    if (!isAcceptableDuration(c.duration)) {
      dropped.duration++;
      return null;
    }
    const key = normalizeKey(c.title, c.artist);
    if (excluded.has(key)) {
      dropped.inLibrary++;
      return null;
    }
    if (seen.has(key)) {
      dropped.duplicate++;
      return null;
    }
    const artistKey = normalizeKey(c.artist, '');
    const used = perArtist.get(artistKey) ?? 0;
    if (used >= limits.perArtistCap) {
      dropped.overCap++;
      return null;
    }
    seen.add(key);
    perArtist.set(artistKey, used + 1);
    return c;
  };

  // ── 1. 主干 + 探索艺人：深挖库外曲目 ───────────────────
  const anchorTargets = opts.anchors.slice(0, limits.anchorLimit);
  const deepenTargets = [
    ...anchorTargets.map((a) => ({ artist: a, origin: 'artist' as const })),
    ...(opts.exploreArtists ?? []).map((a) => ({
      artist: a,
      origin: 'artist' as const,
    })),
  ];

  // ── 2. 相邻艺人（只对前几个主干做，控住搜索量）─────────
  const neighborAnchors = opts.anchors.slice(0, limits.neighborAnchorLimit);
  const neighborLists = await Promise.all(
    neighborAnchors.map((a) =>
      deps
        .findRelatedArtists(a)
        .then((names) => ({ anchor: a, names: names ?? [] }))
        .catch(() => ({ anchor: a, names: [] as string[] })),
    ),
  );
  const neighborTargets: Array<{ artist: string; seedArtist: string }> = [];
  const seenNeighbor = new Set<string>();
  for (const { anchor, names } of neighborLists) {
    for (const name of names.slice(0, limits.relatedPerAnchor)) {
      const key = normalizeKey(name, '');
      if (!key || seenNeighbor.has(key)) continue;
      seenNeighbor.add(key);
      neighborTargets.push({ artist: name, seedArtist: anchor });
    }
  }

  /** 分波并发跑艺人搜索（保序：每波结果按传入顺序展开）。 */
  const searchAll = async (
    targets: Array<{ artist: string; origin: CandidateOrigin; seedArtist?: string }>,
  ): Promise<RecoCandidate[]> => {
    const out: RecoCandidate[] = [];
    for (let i = 0; i < targets.length; i += limits.concurrency) {
      const wave = targets.slice(i, i + limits.concurrency);
      const results = await Promise.all(
        wave.map((t) =>
          deps
            .searchArtist(t.artist)
            .then((items) => ({ t, items }))
            .catch(() => ({ t, items: [] as UnifiedSearchItem[] })),
        ),
      );
      for (const { t, items } of results) {
        let taken = 0;
        for (const it of items) {
          if (taken >= limits.perArtistCandidates) break;
          // 只有"填源已确认可播"的候选才值得占坑位。
          if (!it.bestSource) continue;
          // 搜索是按艺人名发的，但结果里会混进翻唱/同名艺人的歌——候选必须
          // 真的属于这位艺人（否则等于往池子里灌噪声）。
          if (!artistMatches(it.artist, t.artist)) continue;
          const accepted = accept({
            title: it.title,
            artist: it.artist,
            album: it.album ?? '',
            coverUrl: it.coverUrl ?? '',
            duration: it.duration ?? 0,
            origin: t.origin,
            seedArtist: t.seedArtist ?? t.artist,
          });
          if (accepted) {
            taken++;
            out.push(accepted);
          }
        }
      }
    }
    return out;
  };

  const deepen = await searchAll(deepenTargets);
  const neighbors = await searchAll(
    neighborTargets.map((n) => ({
      artist: n.artist,
      origin: 'related-artist' as const,
      seedArtist: n.seedArtist,
    })),
  );

  // ── 3. 平台 FM / 榜单 ──────────────────────────────────
  let radio: RecoCandidate[] = [];
  if (deps.fetchRadio) {
    const raw = await deps
      .fetchRadio()
      .then((r) => r ?? [])
      .catch(() => [] as RadioCandidate[]);
    radio = raw
      .map((r) =>
        accept({
          title: r.title,
          artist: r.artist,
          album: r.album ?? '',
          coverUrl: r.coverUrl ?? '',
          duration: r.duration ?? 0,
          origin: 'radio' as const,
          seedArtist: r.provider,
        }),
      )
      .filter((c): c is RecoCandidate => Boolean(c));
  }

  // ── 4. 交错合并并截断 ──────────────────────────────────
  const candidates = interleave([deepen, neighbors, radio]).slice(
    0,
    limits.maxPoolSize,
  );
  const byOrigin: Record<CandidateOrigin, number> = {
    artist: 0,
    'related-artist': 0,
    radio: 0,
  };
  for (const c of candidates) byOrigin[c.origin]++;
  return { candidates, byOrigin, dropped };
}

/** 多路轮转合并（`[[a,b],[c],[d,e]]` → `a,c,d,b,e`），让 prompt 里不同来源交错。 */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i++) {
    for (const g of groups) if (i < g.length) out.push(g[i]);
  }
  return out;
}

/**
 * 候选曲目的艺人是否就是我们要搜的那位。按 `normalizeKey` 双向包含判断——
 * 能过掉 feat./合作写法差异与大小写变体，也能拦掉"某某的翻唱版"。
 */
export function artistMatches(
  candidateArtist: string,
  targetArtist: string,
): boolean {
  const a = normalizeKey(candidateArtist ?? '', '');
  const b = normalizeKey(targetArtist ?? '', '');
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}
