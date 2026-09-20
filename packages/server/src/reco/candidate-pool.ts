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
  /** 被行为信号"拉黑"的艺人（normalizeKey 后的 key）——一首都不收。 */
  bannedArtists?: string[];
  /** 池子上限（token 预算）。 */
  maxPoolSize?: number;
  /** 并发搜索的艺人数（压住对 QQ/网易云的读并发）。 */
  concurrency?: number;
}

export const DEFAULT_CANDIDATE_LIMITS = {
  // 2026-09-20 延迟优化下调：用户实测"推荐要等好久"。候选池只要够 LLM 挑
  // + 补位即可（count=10 时下游目标才 20 条），多搜一个艺人就多等一段。
  anchorLimit: 3,
  neighborAnchorLimit: 3,
  relatedPerAnchor: 2,
  perArtistCandidates: 3,
  perArtistCap: 2,
  maxPoolSize: 60,
  concurrency: 5,
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
    /** 被信号拉黑的艺人的曲目（正常为 0/undefined）。 */
    bannedArtist?: number;
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
    bannedArtist: 0,
  };
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const banned = new Set(opts.bannedArtists ?? []);

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
    if (banned.has(artistKey)) {
      dropped.bannedArtist = (dropped.bannedArtist ?? 0) + 1;
      return null;
    }
    const used = perArtist.get(artistKey) ?? 0;
    if (used >= limits.perArtistCap) {
      dropped.overCap++;
      return null;
    }
    seen.add(key);
    perArtist.set(artistKey, used + 1);
    return c;
  };

  // ── 1. 目标队列 + 单并发池（边查边搜，不再分阶段串等）────────
  //
  // 2026-09-20 延迟优化：原实现是「相邻艺人查询 → 主干深挖 → 相邻艺人搜索 →
  // 电台」四段串行，每段各自等网络，用户实测一次推荐要等十几秒到几十秒。
  // 现在：主干/探索艺人的搜索**立刻**入队开跑；相邻艺人查询与电台取批同时起飞；
  // 相邻艺人一查到就往**同一个**并发池里追加任务。段与段之间的等待被抹平。
  //
  // 顺序仍然是确定的：`targets` 按"主干/探索 → 相邻艺人"的入队序记录，结果按
  // 这个序展开，所以去重与单艺人配额谁先占坑不受网络快慢影响（可重放）。
  const targets: Array<{
    artist: string;
    origin: CandidateOrigin;
    seedArtist?: string;
  }> = [];
  const targetItems = new Map<string, UnifiedSearchItem[]>();
  const inflight: Array<Promise<void>> = [];
  const searchPool = new TaskPool(limits.concurrency);

  const enqueue = (t: {
    artist: string;
    origin: CandidateOrigin;
    seedArtist?: string;
  }): void => {
    targets.push(t);
    const key = `${targets.length - 1}`;
    targetItems.set(key, []);
    inflight.push(
      searchPool
        .run(() => deps.searchArtist(t.artist).catch(() => [] as UnifiedSearchItem[]))
        .then((items) => {
          targetItems.set(key, items ?? []);
        }),
    );
  };

  // 主干 + 探索艺人：深挖库外曲目（最高价值来源，先入队拿最前面的并发位）
  for (const a of opts.anchors.slice(0, limits.anchorLimit)) {
    enqueue({ artist: a, origin: 'artist' });
  }
  for (const a of opts.exploreArtists ?? []) {
    enqueue({ artist: a, origin: 'artist' });
  }

  // 相邻艺人查询 + 电台取批：与上面的搜索**并行**跑（原来这两步是串行等待）
  const neighborPromise = Promise.all(
    opts.anchors.slice(0, limits.neighborAnchorLimit).map((a) =>
      deps
        .findRelatedArtists(a)
        .then((names) => ({ anchor: a, names: names ?? [] }))
        .catch(() => ({ anchor: a, names: [] as string[] })),
    ),
  );
  const radioPromise = deps.fetchRadio
    ? deps.fetchRadio().catch(() => [] as RadioCandidate[])
    : Promise.resolve([] as RadioCandidate[]);

  // 相邻艺人一查到就追加进同一个池（此时主干搜索还在飞）
  const neighborLists = await neighborPromise;
  const seenNeighbor = new Set<string>();
  for (const { anchor, names } of neighborLists) {
    for (const name of names.slice(0, limits.relatedPerAnchor)) {
      const key = normalizeKey(name, '');
      if (!key || seenNeighbor.has(key)) continue;
      seenNeighbor.add(key);
      enqueue({ artist: name, origin: 'related-artist', seedArtist: anchor });
    }
  }

  const [radioRaw] = await Promise.all([radioPromise, ...inflight]);

  // ── 2. 按入队顺序收下候选（确定性与网络快慢无关）─────────
  const deepen: RecoCandidate[] = [];
  const neighbors: RecoCandidate[] = [];
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const items = targetItems.get(`${i}`) ?? [];
    const bucket = t.origin === 'related-artist' ? neighbors : deepen;
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
        bucket.push(accepted);
      }
    }
  }

  // ── 3. 平台 FM / 榜单 ──────────────────────────────────
  const radio: RecoCandidate[] = (radioRaw ?? [])
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

/**
 * 并发受限的任务池，**边加边跑**：`run()` 立刻排队，池子有余量就开跑，否则等
 * 前一个结束。用于"相邻艺人查询陆续返回、每返回一批就立刻追加搜索任务"的场景
 * ——没有这个池子就只能先等全部查询完，再开下一轮搜索（两段串行）。
 *
 * 任务契约：**不应 reject**（调用方自己 catch 成 fail-soft 值）；真 reject 了
 * 这里也兜成 undefined，绝不把异常漏给候选池装配流程。
 */
export class TaskPool {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  run<T>(task: () => Promise<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      const start = () => {
        this.active++;
        task()
          .then(
            (value) => resolve(value),
            () => resolve(undefined),
          )
          .finally(() => {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.active < Math.max(1, this.concurrency)) start();
      else this.queue.push(start);
    });
  }
}
