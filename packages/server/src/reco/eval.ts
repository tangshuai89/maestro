/**
 * 推荐离线评测基座（pure 层）。
 *
 * **为什么需要它**：没有度量，"推荐变好了吗"就只能靠感觉——上一轮我们靠
 * 「实测慢」发现了延迟问题，但质量侧至今没有可重复的数字。这里用最常见的
 * 留一法（leave-one-out）：把用户库里的一部分红心歌**藏起来**，只用剩下的
 * 歌喂推荐引擎，看它能不能把藏起来的歌重新推回来。
 *
 * 指标分两层，**这一层拆分是关键**（能直接告诉我们损失发生在哪一段）：
 *  - **检索层** `poolRecall`：藏起来的歌有没有进候选池（目录锚定的那一层）；
 *  - **选择层** `recallAtK`：候选池里的歌，模型/排序有没有真的推给用户。
 *  如果 poolRecall 高而 recallAtK 低 → 问题在 LLM 挑选；反之 → 问题在候选生成。
 *
 * 另外按"同艺人 / 新艺人"拆开看：藏起来的歌如果和训练集里某位艺人是同一人，
 * 我们的候选池天然容易捞到（会搜这位艺人）——**真正难、也真正反映品味泛化能力
 * 的是"新艺人"那一档**。报告里两档分开列，避免被好看的同艺人数字骗了。
 *
 * 纯函数，无 IO，单测覆盖全部指标口径。
 */
import { normalizeKey } from '@maestro/common';
import type { UnifiedSearchItem } from '../music/types';

/** 参与排名的对象（推荐结果 / 候选池条目都满足）。 */
export interface Rankable {
  title: string;
  artist: string;
}

export interface EvalSplit {
  train: UnifiedSearchItem[];
  holdout: UnifiedSearchItem[];
}

export function keyOf(item: Rankable): string {
  return normalizeKey(item?.title ?? '', item?.artist ?? '');
}

/**
 * 随机留出 `holdoutSize` 首当"考卷"。至少给训练集留 1 首（否则没法建档案）。
 * rng 可注入 → 同一 seed 可复现同一次评测。
 */
export function splitLibrary(
  items: UnifiedSearchItem[],
  opts: { holdoutSize: number; rng?: () => number },
): EvalSplit {
  const rng = opts.rng ?? Math.random;
  const maxHoldout = Math.max(0, items.length - 1);
  const size = Math.max(0, Math.min(Math.floor(opts.holdoutSize), maxHoldout));
  const copy = items.slice();
  // 部分 Fisher-Yates：前 size 个作为留出。
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return { holdout: copy.slice(0, size), train: copy.slice(size) };
}

/** 藏起来的歌按"艺人在训练集里出现过没有"分档。 */
export function holdoutBreakdown(
  holdout: UnifiedSearchItem[],
  train: UnifiedSearchItem[],
): { sameArtist: UnifiedSearchItem[]; newArtist: UnifiedSearchItem[] } {
  const trainArtists = new Set(
    train.map((t) => normalizeKey(t.artist ?? '', '')).filter(Boolean),
  );
  const sameArtist: UnifiedSearchItem[] = [];
  const newArtist: UnifiedSearchItem[] = [];
  for (const h of holdout) {
    const key = normalizeKey(h.artist ?? '', '');
    if (key && trainArtists.has(key)) sameArtist.push(h);
    else newArtist.push(h);
  }
  return { sameArtist, newArtist };
}

/** 第一个命中在排名里的位置（1-based）。没命中 → Infinity。 */
export function rankOfFirstHit(
  holdout: Rankable[],
  ranked: Rankable[],
): number {
  const want = new Set(holdout.map(keyOf).filter(Boolean));
  for (let i = 0; i < ranked.length; i++) {
    if (want.has(keyOf(ranked[i]))) return i + 1;
  }
  return Number.POSITIVE_INFINITY;
}

/** 命中数 / 留出总数。留出为空 → 0（避免除零）。 */
export function recall(holdout: Rankable[], ranked: Rankable[], k?: number): number {
  if (!holdout.length) return 0;
  const want = new Set(holdout.map(keyOf).filter(Boolean));
  const pool = k === undefined ? ranked : ranked.slice(0, k);
  const seen = new Set<string>();
  for (const r of pool) {
    const key = keyOf(r);
    if (want.has(key)) seen.add(key);
  }
  return seen.size / want.size;
}

/** MRR（只看第一个命中的倒数排名）；没命中记 0。 */
export function meanReciprocalRank(
  holdout: Rankable[],
  ranked: Rankable[],
): number {
  if (!holdout.length) return 0;
  const rank = rankOfFirstHit(holdout, ranked);
  return Number.isFinite(rank) ? 1 / rank : 0;
}

/** 命中明细（哪几首被找回来了、排在第几），用于人工看"找回的是什么"。 */
export function hitDetails(
  holdout: Rankable[],
  ranked: Rankable[],
): Array<{ title: string; artist: string; rank: number }> {
  const want = new Map<string, Rankable>();
  for (const h of holdout) {
    const key = keyOf(h);
    if (key) want.set(key, h);
  }
  const out: Array<{ title: string; artist: string; rank: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < ranked.length; i++) {
    const key = keyOf(ranked[i]);
    if (!want.has(key) || seen.has(key)) continue;
    seen.add(key);
    const src = want.get(key)!;
    out.push({ title: src.title, artist: src.artist, rank: i + 1 });
  }
  return out;
}

/** 多样性：推荐的歌里有多少位不同艺人（防"一位歌手占满整批"）。 */
export function diversityMetrics(items: Rankable[]): {
  items: number;
  uniqueArtists: number;
  artistCoverage: number;
} {
  const artists = new Set(
    items.map((i) => normalizeKey(i.artist ?? '', '')).filter(Boolean),
  );
  return {
    items: items.length,
    uniqueArtists: artists.size,
    artistCoverage: items.length ? artists.size / items.length : 0,
  };
}

/** 单次评测的数字结果。 */
export interface EvalRunResult {
  poolSize: number;
  poolRecall: number;
  /** 候选池前 20 条里的召回（排序靠前的候选才有机会被挑中）。 */
  poolRecallTop20: number;
  recallAtK: number;
  mrr: number;
  holdoutSameArtist: { size: number; recall: number };
  holdoutNewArtist: { size: number; recall: number };
  diversity: { items: number; uniqueArtists: number; artistCoverage: number };
  candidatesByOrigin: Record<string, number>;
  timings: { poolMs: number; llmMs: number; totalMs: number };
  hits: Array<{ title: string; artist: string; rank: number }>;
  /** 本次留出集（便于人工核对/复现）。 */
  holdout: Array<{ title: string; artist: string }>;
}

export interface EvalReport {
  mode: 'pool' | 'llm';
  runs: number;
  count: number;
  librarySize: number;
  holdoutSize: number;
  at: number;
  model?: string;
  average: {
    poolSize: number;
    poolRecall: number;
    poolRecallTop20: number;
    recallAtK: number;
    mrr: number;
    sameArtistRecall: number;
    newArtistRecall: number;
    artistCoverage: number;
    poolMs: number;
    llmMs: number;
    totalMs: number;
  };
  details: EvalRunResult[];
}

export function averageRuns(
  runs: EvalRunResult[],
  meta: { mode: 'pool' | 'llm'; count: number; librarySize: number; holdoutSize: number; model?: string },
): EvalReport {
  const mean = (pick: (r: EvalRunResult) => number): number =>
    runs.length ? runs.reduce((s, r) => s + pick(r), 0) / runs.length : 0;
  return {
    mode: meta.mode,
    runs: runs.length,
    count: meta.count,
    librarySize: meta.librarySize,
    holdoutSize: meta.holdoutSize,
    at: Date.now(),
    model: meta.model,
    average: {
      poolSize: mean((r) => r.poolSize),
      poolRecall: mean((r) => r.poolRecall),
      poolRecallTop20: mean((r) => r.poolRecallTop20),
      recallAtK: mean((r) => r.recallAtK),
      mrr: mean((r) => r.mrr),
      sameArtistRecall: mean((r) => r.holdoutSameArtist.recall),
      newArtistRecall: mean((r) => r.holdoutNewArtist.recall),
      artistCoverage: mean((r) => r.diversity.artistCoverage),
      poolMs: mean((r) => r.timings.poolMs),
      llmMs: mean((r) => r.timings.llmMs),
      totalMs: mean((r) => r.timings.totalMs),
    },
    details: runs,
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const ms = (v: number): string => `${Math.round(v)}ms`;

/** 人读报告（CLI 直接打印）。 */
export function formatEvalReport(report: EvalReport): string {
  const a = report.average;
  const lines = [
    `推荐离线评测｜模式=${report.mode}｜库 ${report.librarySize} 首｜留出 ${report.holdoutSize} 首｜${report.runs} 轮`,
    '',
    `检索层  候选池 ${Math.round(a.poolSize)} 首，池内召回 ${pct(a.poolRecall)}（前 20 条 ${pct(a.poolRecallTop20)}）`,
    `选择层  Top-${report.count} 召回 ${pct(a.recallAtK)}｜MRR ${a.mrr.toFixed(3)}`,
    `分档     同艺人 ${pct(a.sameArtistRecall)} / 新艺人 ${pct(a.newArtistRecall)}（新艺人这档才是泛化能力）`,
    `多样性   艺人覆盖 ${pct(a.artistCoverage)}`,
    `耗时     池 ${ms(a.poolMs)} / LLM ${ms(a.llmMs)} / 合计 ${ms(a.totalMs)}`,
  ];
  const hits = report.details.flatMap((d) => d.hits);
  if (hits.length) {
    lines.push('', '找回的歌（前 10）：');
    for (const h of hits.slice(0, 10)) {
      lines.push(`  #${h.rank} ${h.title} - ${h.artist}`);
    }
  }
  return lines.join('\n');
}

/** 与基线对比（同一模式、同一留出规模才有意义）。 */
export function compareEvalReports(
  baseline: EvalReport,
  current: EvalReport,
): string {
  // MRR 不是百分比（是 1/rank 的均值），单独用三位小数格式化，别混进 pct()。
  const rows: Array<{ name: string; base: number; cur: number; ratio: boolean }> = [
    { name: '池内召回', base: baseline.average.poolRecall, cur: current.average.poolRecall, ratio: true },
    { name: '前 20 条召回', base: baseline.average.poolRecallTop20, cur: current.average.poolRecallTop20, ratio: true },
    { name: 'Top-K 召回', base: baseline.average.recallAtK, cur: current.average.recallAtK, ratio: true },
    { name: 'MRR', base: baseline.average.mrr, cur: current.average.mrr, ratio: false },
    { name: '同艺人召回', base: baseline.average.sameArtistRecall, cur: current.average.sameArtistRecall, ratio: true },
    { name: '新艺人召回', base: baseline.average.newArtistRecall, cur: current.average.newArtistRecall, ratio: true },
    { name: '艺人覆盖', base: baseline.average.artistCoverage, cur: current.average.artistCoverage, ratio: true },
  ];
  const fmt = (v: number, ratio: boolean): string =>
    ratio ? pct(v) : v.toFixed(3);
  const lines = [`与基线对比（基线 ${new Date(baseline.at).toLocaleString()}）：`];
  for (const { name, base: b, cur: c, ratio } of rows) {
    const delta = c - b;
    const sign = delta > 0 ? '+' : '';
    const tolerance = ratio ? 0.005 : 0.002;
    const flag = Math.abs(delta) < tolerance ? '  ' : delta > 0 ? '✅' : '⚠️';
    const deltaText = ratio
      ? `${sign}${(delta * 100).toFixed(1)}pt`
      : `${sign}${delta.toFixed(3)}`;
    lines.push(
      `  ${flag} ${name.padEnd(10)} ${fmt(b, ratio).padStart(7)} → ${fmt(c, ratio).padStart(7)}  (${deltaText})`,
    );
  }
  return lines.join('\n');
}
