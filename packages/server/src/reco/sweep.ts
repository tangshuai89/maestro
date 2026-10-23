/**
 * NL 检索 · 参数扫描（specs/eval-driven-nl/ L3）。
 *
 * ## 为什么要有这一层
 *
 * `perArtistCap` / `perArtistCandidates` / `grouped` / `anchorLimit` /
 * 邻居数 / 池上限——这些参数以前是"拍脑袋定 + 事后被 bug 教"。2026-10-20 的
 * 4 个 bug 里有 3 个是参数不对造成的（超额要、anchorLimit 截断、交错插队）。
 *
 * L3 让参数**由数据定**：离线跑（0 元 / 0 网络 / 确定性）→ 出表 → 选最优 →
 * 结论写进 spec。从此"这个数为什么是 4"有据可查。
 *
 * ## 扫描方式：单维扫描（不是笛卡尔积）
 *
 * 每个参数**独立**扫一遍（其余保持默认）。笛卡尔积会得到 4×3×2×2×3×2 = 288
 * 组，虽然离线跑得动，但**组合之间的交互**（比如"每人配额大 + 分组关"）才是
 * 真正要选的，而单维扫描的结果已经能定位"哪个维度在拖后腿"。要更细再上组合。
 *
 * ## 评分
 *
 * 主判据是**种子块纯度**（检索层风格纯度，用户体感最直接），其次是队列纯度
 * （策展层），再是通过率。种子块大小只作参考——大不是好事（一个艺人占满整批
 * 同样不健康）。
 */
import {
  evaluateOfflineScenario,
  loadFixture,
  loadGolden,
  type NlFixture,
  type GoldenTags,
} from './eval-offline';
import type { IntentPoolParams } from './reco.service';

export interface SweepCombination {
  label: string;
  params: IntentPoolParams;
}

/**
 * 默认扫描网格：每个维度独立扫，其余用默认值。
 *
 * 默认值与 `INTENT_POOL_PARAMS`（生产路径）一致——扫描的基线就是"现在这样"。
 */
export const DEFAULT_SWEEP_GRID: SweepCombination[] = [
  { label: '默认', params: {} },
  // 每个艺人进池几条
  { label: 'perArtistCap=2', params: { perArtistCap: 2 } },
  { label: 'perArtistCap=3', params: { perArtistCap: 3 } },
  { label: 'perArtistCap=6', params: { perArtistCap: 6 } },
  // 每个艺人取几条候选
  { label: 'perArtistCandidates=3', params: { perArtistCandidates: 3 } },
  { label: 'perArtistCandidates=10', params: { perArtistCandidates: 10 } },
  // 分组 vs 交错
  { label: 'grouped=false', params: { grouped: false } },
  // 种子截断
  { label: 'anchorLimit=3', params: { anchorLimit: 3 } },
  // 相邻艺人数
  { label: 'relatedPerAnchor=1', params: { relatedPerAnchor: 1 } },
  { label: 'relatedPerAnchor=3', params: { relatedPerAnchor: 3 } },
  // 池上限
  { label: 'maxPoolSize=30', params: { maxPoolSize: 30 } },
];

export interface SweepRow {
  label: string;
  params: IntentPoolParams;
  /** 平均种子块纯度。 */
  seedBlockPurity: number;
  /** 平均全池纯度。 */
  poolPurity: number;
  /** 平均队列纯度。 */
  queuePurity: number;
  /** 平均种子块大小。 */
  seedBlockSize: number;
  /** 不变量全过的场景占比。 */
  invariantsOkRate: number;
  /** 综合评分（越高越好）。 */
  score: number;
}

export interface SweepReport {
  at: number;
  fixtureRecordedAt: string;
  count: number;
  rows: SweepRow[];
  best: SweepRow | null;
}

/**
 * 综合评分：种子块纯度 50% + 队列纯度 30% + 不变量通过率 20%。
 * 种子块大小**不进分数**（大 ≠ 好，见文件头注释）。
 */
export function sweepScore(r: {
  seedBlockPurity: number;
  queuePurity: number;
  invariantsOkRate: number;
}): number {
  return r.seedBlockPurity * 0.5 + r.queuePurity * 0.3 + r.invariantsOkRate * 0.2;
}

export interface SweepOptions {
  fixtureDir?: string;
  count?: number;
  /** 只跑这些场景 id。 */
  only?: string[];
  /** 自定义网格（默认 DEFAULT_SWEEP_GRID）。 */
  grid?: SweepCombination[];
}

export async function runSweep(opts: SweepOptions = {}): Promise<SweepReport> {
  const dir = opts.fixtureDir;
  const fixture: NlFixture = loadFixture(dir);
  const golden: GoldenTags = loadGolden(dir);
  const count = opts.count ?? 12;
  const grid = opts.grid ?? DEFAULT_SWEEP_GRID;
  const scenarios = Object.values(fixture.scenarios).filter(
    (s) => !opts.only?.length || opts.only.includes(s.id),
  );

  const rows: SweepRow[] = [];
  for (const combo of grid) {
    let seedBlockPurity = 0;
    let poolPurity = 0;
    let queuePurity = 0;
    let seedBlockSize = 0;
    let invariantsOk = 0;
    for (const sc of scenarios) {
      const r = await evaluateOfflineScenario(sc, fixture, golden, count, combo.params);
      seedBlockPurity += r.seedBlockPurity;
      poolPurity += r.poolPurity;
      queuePurity += r.queuePurity;
      seedBlockSize += r.seedBlockSize;
      if (r.invariants.every((i) => i.pass)) invariantsOk++;
    }
    const n = Math.max(1, scenarios.length);
    const row: SweepRow = {
      label: combo.label,
      params: combo.params,
      seedBlockPurity: seedBlockPurity / n,
      poolPurity: poolPurity / n,
      queuePurity: queuePurity / n,
      seedBlockSize: seedBlockSize / n,
      invariantsOkRate: invariantsOk / n,
      score: 0,
    };
    row.score = sweepScore(row);
    rows.push(row);
  }
  // 最优 = 分数最高；并列时取不变量全过的（不变量是硬要求）
  const best = rows.reduce<SweepRow | null>((acc, r) => {
    if (!acc) return r;
    if (r.score > acc.score) return r;
    if (r.score === acc.score && r.invariantsOkRate > acc.invariantsOkRate) return r;
    return acc;
  }, null);
  return {
    at: Date.now(),
    fixtureRecordedAt: fixture.recordedAt,
    count,
    rows,
    best,
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 人读扫描表。 */
export function formatSweepTable(report: SweepReport): string {
  const lines = [
    `NL 检索 · 参数扫描｜fixture 录于 ${report.fixtureRecordedAt}｜每例 ${report.count} 首`,
    '',
    `${'组合'.padEnd(26)}${'种子块纯度'.padStart(12)}${'队列纯度'.padStart(12)}${'种子块大小'.padStart(12)}${'不变量通过'.padStart(12)}${'评分'.padStart(9)}`,
  ];
  for (const r of [...report.rows].sort((a, b) => b.score - a.score)) {
    const isBest = report.best && r.label === report.best.label;
    lines.push(
      `${(isBest ? '★ ' : '  ') + r.label.padEnd(24)}${pct(r.seedBlockPurity).padStart(12)}` +
        `${pct(r.queuePurity).padStart(12)}${r.seedBlockSize.toFixed(1).padStart(12)}` +
        `${pct(r.invariantsOkRate).padStart(12)}${r.score.toFixed(3).padStart(9)}`,
    );
  }
  if (report.best) {
    lines.push('');
    lines.push(
      `★ 推荐：${report.best.label}（评分 ${report.best.score.toFixed(3)}）` +
        `——种子块纯度 ${pct(report.best.seedBlockPurity)}，队列纯度 ${pct(report.best.queuePurity)}`,
    );
  }
  return lines.join('\n');
}
