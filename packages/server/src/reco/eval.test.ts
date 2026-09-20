/**
 * 离线评测基座（eval.ts 纯函数）单测。
 * 运行: npx ts-node packages/server/src/reco/eval.test.ts
 *
 * 只测口径：切分可复现、召回/MRR/分档/多样性、报告与基线对比的取数。
 * 真实流水线的编排（RecoService.evaluate）在 reco.test #46/#47 覆盖。
 */
export {};
const assert = require('node:assert');
const {
  splitLibrary,
  recall,
  meanReciprocalRank,
  rankOfFirstHit,
  holdoutBreakdown,
  diversityMetrics,
  hitDetails,
  averageRuns,
  formatEvalReport,
  compareEvalReports,
} = require('./eval');

function item(title: string, artist: string) {
  return {
    id: `${title}-${artist}`,
    title,
    artist,
    album: '',
    coverUrl: '',
    duration: 200,
    sources: [],
    bestSource: 'qq',
    versionType: 'studio',
  } as any;
}

/** 浮点比较（均值会产生 0.30000000000000004 这种尾巴）。 */
function close(actual: number, expected: number, label?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label ?? 'float'}: 期望 ${expected}，实际 ${actual}`,
  );
}

// ── 1. 留出切分：不重叠、覆盖全部、可复现 ─────────────────
{
  const lib = Array.from({ length: 10 }, (_v, i) => item(`歌${i}`, `手${i}`));
  const a = splitLibrary(lib, { holdoutSize: 3, rng: () => 0.42 });
  assert.strictEqual(a.holdout.length, 3);
  assert.strictEqual(a.train.length, 7, 'train + holdout = 全库');
  const keys = new Set(a.holdout.map((h: any) => `${h.title}|${h.artist}`));
  assert.ok(
    a.train.every((t: any) => !keys.has(`${t.title}|${t.artist}`)),
    'train 与 holdout 不能重叠（否则等于把答案喂进去）',
  );

  // 同 seed（这里用同一个固定 rng 序列）→ 同一份考卷
  const mkRng = () => {
    let s = 7;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  };
  const b1 = splitLibrary(lib, { holdoutSize: 3, rng: mkRng() });
  const b2 = splitLibrary(lib, { holdoutSize: 3, rng: mkRng() });
  assert.deepStrictEqual(
    b1.holdout.map((h: any) => h.title),
    b2.holdout.map((h: any) => h.title),
    '同种子应切出同一份考卷（可复现）',
  );

  // 至少给训练集留 1 首
  const big = splitLibrary(lib, { holdoutSize: 999 });
  assert.strictEqual(big.train.length, 1, '留出再大也要给 train 留 1 首');
  console.log('✅ 1. splitLibrary: 不重叠 / 可复现 / 至少留 1 首训练');
}

// ── 2. 召回 / MRR / 首个命中位置 ───────────────────────────
{
  const holdout = [item('甲歌', 'A'), item('乙歌', 'B')];
  const ranked = [item('别的', 'X'), item('甲歌', 'A'), item('乙歌', 'B')];
  assert.strictEqual(rankOfFirstHit(holdout, ranked), 2);
  assert.strictEqual(recall(holdout, ranked), 1, '两首都找回 → 100%');
  assert.strictEqual(recall(holdout, ranked, 1), 0, 'Top-1 只看到"别的"');
  assert.strictEqual(recall(holdout, ranked, 2), 0.5, 'Top-2 只找回一首');
  assert.strictEqual(
    meanReciprocalRank(holdout, ranked),
    0.5,
    '首个命中排第 2 → MRR = 1/2',
  );
  assert.strictEqual(
    meanReciprocalRank(holdout, [item('别的', 'X')]),
    0,
    '没命中 → 0',
  );
  assert.strictEqual(recall([], ranked), 0, '留出为空 → 0（不除零）');
  assert.deepStrictEqual(
    hitDetails(holdout, ranked).map((h: any) => [h.title, h.rank]),
    [
      ['甲歌', 2],
      ['乙歌', 3],
    ],
  );
  console.log('✅ 2. recall/MRR/hitDetails: 口径正确（含 Top-K 截断与空输入）');
}

// ── 3. 同艺人 / 新艺人分档 ─────────────────────────────────
{
  const train = [item('训练歌', '老熟人')];
  const holdout = [
    item('老熟人的另一首', '老熟人'),
    item('新面孔', '陌生人'),
  ];
  const b = holdoutBreakdown(holdout, train);
  assert.strictEqual(b.sameArtist.length, 1);
  assert.strictEqual(b.newArtist.length, 1);
  assert.strictEqual(b.newArtist[0].artist, '陌生人');
  console.log('✅ 3. holdoutBreakdown: 同艺人 / 新艺人分档');
}

// ── 4. 多样性 ─────────────────────────────────────────────
{
  const d = diversityMetrics([
    item('a', '甲'),
    item('b', '甲'),
    item('c', '乙'),
  ]);
  assert.strictEqual(d.items, 3);
  assert.strictEqual(d.uniqueArtists, 2);
  assert.strictEqual(Math.round(d.artistCoverage * 100) / 100, 0.67);
  assert.strictEqual(diversityMetrics([]).artistCoverage, 0, '空输入不除零');
  console.log('✅ 4. diversityMetrics: 艺人覆盖');
}

// ── 5. 多轮平均 + 报告格式 ────────────────────────────────
{
  const mk = (poolRecall: number, recallAtK: number, newArtistRecall: number) => ({
    poolSize: 40,
    poolRecall,
    poolRecallTop20: poolRecall,
    recallAtK,
    mrr: recallAtK,
    holdoutSameArtist: { size: 10, recall: 0.5 },
    holdoutNewArtist: { size: 10, recall: newArtistRecall },
    diversity: { items: 10, uniqueArtists: 8, artistCoverage: 0.8 },
    candidatesByOrigin: { artist: 20, 'related-artist': 10, radio: 10 },
    timings: { poolMs: 1000, llmMs: 500, totalMs: 1600 },
    hits: [],
    holdout: [],
  });
  const report = averageRuns([mk(0.5, 0.2, 0.1), mk(0.7, 0.4, 0.3)], {
    mode: 'pool',
    count: 10,
    librarySize: 300,
    holdoutSize: 20,
  });
  assert.strictEqual(report.runs, 2);
  close(report.average.poolRecall, 0.6, '取多轮平均');
  close(report.average.recallAtK, 0.3);
  close(report.average.newArtistRecall, 0.2);

  const text = formatEvalReport(report);
  assert.ok(text.includes('检索层') && text.includes('选择层'), '报告含两层指标');
  assert.ok(text.includes('新艺人'), '报告单列"新艺人"这一档');
  assert.ok(text.includes('60.0%'), '百分比格式');

  // 基线对比：涨了打 ✅，跌了打 ⚠️
  const better = averageRuns([mk(0.5, 0.6, 0.5)], {
    mode: 'pool',
    count: 10,
    librarySize: 300,
    holdoutSize: 20,
  });
  const diff = compareEvalReports(report, better);
  assert.ok(diff.includes('Top-K 召回'), '对比里有 Top-K 一行');
  assert.ok(diff.includes('✅'), '变好应标 ✅');
  assert.ok(diff.includes('⚠️'), '变差应标 ⚠️');
  console.log('✅ 5. averageRuns/formatEvalReport/compareEvalReports');
}

console.log('\n🎉 eval.test 全部 5 组通过');
