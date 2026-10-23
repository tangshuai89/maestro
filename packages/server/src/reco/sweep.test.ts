/**
 * L3 参数扫描 · 自测（specs/eval-driven-nl/ Phase E）。
 *
 * 覆盖：
 *   1. 评分函数的口径（纯度/不变量权重）
 *   2. 空网格 / 空场景集 / 无效参数 → 不炸
 *   3. 真跑一轮扫描（fixture 在库时）→ 出表、有最优
 */
export {};

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SWEEP_GRID, formatSweepTable, runSweep, sweepScore } = require('./sweep');
const { DEFAULT_FIXTURE_DIR } = require('./eval-offline');

async function main() {
  // ── 1. 评分口径 ────────────────────────────────────────
  {
    assert.strictEqual(sweepScore({ seedBlockPurity: 1, queuePurity: 1, invariantsOkRate: 1 }), 1);
    assert.strictEqual(sweepScore({ seedBlockPurity: 0, queuePurity: 0, invariantsOkRate: 0 }), 0);
    // 种子块纯度权重最高（0.5 > 0.3 > 0.2）
    const a = sweepScore({ seedBlockPurity: 1, queuePurity: 0, invariantsOkRate: 0 });
    const b = sweepScore({ seedBlockPurity: 0, queuePurity: 1, invariantsOkRate: 0 });
    assert.ok(a > b, '种子块纯度权重必须高于队列纯度');
    const c = sweepScore({ seedBlockPurity: 0, queuePurity: 0, invariantsOkRate: 1 });
    assert.ok(c < b, '不变量通过率权重最低');
    console.log('  ✓ 评分口径: 种子块 0.5 / 队列 0.3 / 不变量 0.2');
  }

  // ── 2. 边界：空网格 / 空场景 / 无效参数 ────────────────
  {
    const empty = await runSweep({ grid: [], only: ['__no_such_scenario__'] });
    assert.strictEqual(empty.rows.length, 0, '空网格 → 0 行');
    assert.strictEqual(empty.best, null, '空网格 → 无最优');
    assert.match(formatSweepTable(empty), /参数扫描/);

    // 无效参数（负数 / 0）不炸
    const weird = await runSweep({
      grid: [
        { label: '负数', params: { perArtistCap: -1, perArtistCandidates: 0 } },
        { label: '极大', params: { maxPoolSize: 99999, anchorLimit: 0 } },
      ],
      only: ['jazz'],
    });
    assert.strictEqual(weird.rows.length, 2, '无效参数也要跑出结果（不炸）');
    console.log('  ✓ 边界: 空网格 / 空场景 / 无效参数都不炸');
  }

  // ── 3. 真跑一轮 ────────────────────────────────────────
  if (fs.existsSync(path.join(DEFAULT_FIXTURE_DIR, 'nl-search.json'))) {
    const report = await runSweep();
    assert.ok(report.rows.length > 0, '扫描有结果');
    assert.ok(report.best, '扫描给出最优');
    assert.ok(report.best.score >= 0, '最优有分');
    const text = formatSweepTable(report);
    assert.match(text, /★ 推荐/);
    // 默认组合必须在网格里（基线）
    assert.ok(
      report.rows.some((r: any) => r.label === '默认'),
      '网格里要有"默认"基线',
    );
    console.log(
      `  ✓ 扫描跑通: ${report.rows.length} 组｜最优=${report.best.label}（${report.best.score.toFixed(3)}）`,
    );
  } else {
    console.log('  ⚠️ 跳过真跑（fixture 未入库）');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
