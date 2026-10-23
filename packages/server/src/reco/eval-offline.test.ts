/**
 * L1 离线回放评测 · 门禁测试（specs/eval-driven-nl/ Phase B）。
 *
 * 覆盖：
 *   1. **确定性**：同输入跑两次，数字完全一致（0 网络 0 token 的前提）
 *   2. **不变量全过**：真实 fixture 上跑 L0 的 7 条不变量
 *   3. **黄金集覆盖够**：覆盖不足 → 拒绝给结论（不当通过算）
 *   4. **fixture / 黄金集缺失 → fail loud**（不静默按"通过"算）
 *   5. **基线对比**：纯度下降超过容差 → 门禁红
 */
export {};

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  compareOfflineToBaseline,
  evaluateOfflineScenario,
  formatOfflineReport,
  loadFixture,
  loadGolden,
  MIN_GOLDEN_COVERAGE,
  runOfflineEval,
  DEFAULT_FIXTURE_DIR,
} = require('./eval-offline');

async function main() {
  // ── 4. fixture / 黄金集缺失 → fail loud ────────────────
  {
    assert.throws(
      () => loadFixture(path.join(__dirname, '__no_such_dir__')),
      /fixture 不存在/,
      'fixture 缺失必须明确报错（不静默当通过）',
    );
    assert.throws(
      () => loadGolden(path.join(__dirname, '__no_such_dir__')),
      /黄金集不存在/,
      '黄金集缺失必须明确报错',
    );
    console.log('  ✓ fixture / 黄金集缺失 → fail loud');
  }

  // fixture 必须存在（这是 PR 门禁的前提；缺了就该红）
  assert.ok(
    fs.existsSync(path.join(DEFAULT_FIXTURE_DIR, 'nl-search.json')),
    'fixture 未入库：跑 node scripts/record-nl-fixtures.mjs 录一份',
  );
  assert.ok(
    fs.existsSync(path.join(DEFAULT_FIXTURE_DIR, 'genre-golden.json')),
    '黄金集未入库：跑 node scripts/record-nl-fixtures.mjs 录一份',
  );

  const fixture = loadFixture();
  const golden = loadGolden();
  assert.ok(Object.keys(fixture.scenarios).length > 0, 'fixture 里有场景');
  assert.ok(Object.keys(golden).length > 0, '黄金集非空');

  // ── 1. 确定性 ─────────────────────────────────────────
  {
    const a = await runOfflineEval();
    const b = await runOfflineEval();
    assert.deepStrictEqual(
      a.scenarios.map((s: any) => [
        s.id,
        s.poolSize,
        s.seedBlockSize,
        s.seedBlockPurity,
        s.queuePurity,
      ]),
      b.scenarios.map((s: any) => [
        s.id,
        s.poolSize,
        s.seedBlockSize,
        s.seedBlockPurity,
        s.queuePurity,
      ]),
      '同输入两次跑必须完全一致',
    );
    console.log(`  ✓ 确定性: ${a.scenarios.length} 个场景两次跑数字一致`);
  }

  // ── 2 + 3. 不变量全过 + 黄金集覆盖够 ──────────────────
  {
    const report = await runOfflineEval();
    const broken = report.scenarios.filter((s: any) => s.invariants.some((i: any) => !i.pass));
    assert.strictEqual(broken.length, 0, `这些场景的不变量没过：\n${formatOfflineReport(report)}`);
    const inconclusive = report.scenarios.filter((s: any) => s.inconclusive);
    assert.strictEqual(
      inconclusive.length,
      0,
      `黄金集覆盖不足（拒绝给结论）：${inconclusive.map((s: any) => s.id).join('、')}`,
    );
    // 覆盖率必须整体够（否则结论不可信）
    assert.ok(
      report.average.goldenCoverage >= MIN_GOLDEN_COVERAGE,
      `黄金集覆盖率 ${report.average.goldenCoverage} 低于 ${MIN_GOLDEN_COVERAGE}`,
    );
    console.log(
      `  ✓ 不变量全过（${report.scenarios.length} 场景）｜黄金集覆盖 ${(report.average.goldenCoverage * 100).toFixed(1)}%`,
    );
  }

  // ── 5. 基线对比：纯度下降 → 门禁红 ────────────────────
  {
    const report = await runOfflineEval();
    // 造一个"基线更高"的假基线 → 必然超容差 → 必须判红
    const fakeBaseline = {
      scenarios: report.scenarios.map((s: any) => ({
        id: s.id,
        seedBlockPurity: Math.min(1, s.seedBlockPurity + 0.3),
        queuePurity: Math.min(1, s.queuePurity + 0.3),
      })),
    };
    const cmp = compareOfflineToBaseline(fakeBaseline, report, 5);
    assert.strictEqual(cmp.ok, false, '低于基线超过容差 → 门禁必须红');
    assert.ok(cmp.lines.some((l: string) => l.includes('❌')));

    // 反过来：基线更低 → 必须绿
    const lowBaseline = {
      scenarios: report.scenarios.map((s: any) => ({
        id: s.id,
        seedBlockPurity: Math.max(0, s.seedBlockPurity - 0.05),
        queuePurity: Math.max(0, s.queuePurity - 0.05),
      })),
    };
    const cmp2 = compareOfflineToBaseline(lowBaseline, report, 5);
    assert.strictEqual(cmp2.ok, true, '不低于基线 → 门禁必须绿');
    console.log('  ✓ 基线对比: 下降超容差 → 红 / 不低于基线 → 绿');
  }

  // ── 6. 场景级：种子被 anchorLimit 截断 → 不变量变红（真实 fixture 上做） ──
  {
    const sc: any = Object.values(fixture.scenarios).find((s: any) => (s.seeds?.length ?? 0) >= 3);
    assert.ok(sc, 'fixture 里要有一个 ≥3 个种子的场景');
    // 模拟 2026-10-20 那个 bug：anchorLimit 把种子截断了（种子还在意图里，
    // 但没被搜）→ all-seeds-searched 必须红。
    const broken = await evaluateOfflineScenario(sc, fixture, golden, 12, { anchorLimit: 2 });
    const hit = broken.invariants.find((i: any) => i.id === 'all-seeds-searched');
    assert.strictEqual(hit.pass, false, '种子被截断 → all-seeds-searched 必须红');
    console.log('  ✓ 场景级反向验证: 种子被截断 → all-seeds-searched 红');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
