#!/usr/bin/env node
/**
 * 从 lcov.info 生成 c8 风格的**文本报告**（`All files` + 每个目录/文件一行）。
 *
 * ## 为什么不用 `c8 report --reporter=text`
 *
 * 因为最终数据是**两份 lcov 合并后的结果**（见 scripts/merge-lcov.js），
 * 而 `c8 report` 只会读 temp 目录里的原始 V8 数据 —— 读不出合并结果。
 * 所以文本报告也得从合并后的 lcov 重新算。
 *
 * 输出格式与 c8 的 text reporter 对齐（`coverage_threshold_gate` 靠
 * `awk -F'|' '{... $5}'` 取第 5 列的 % Lines，所以列序不能变）：
 *
 *   File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Ln.
 *   ----------------|---------|----------|---------|---------|----------------
 *   All files       |   84.96 |    80.84 |   82.66 |   84.96 |
 *
 * 用法：node scripts/lcov-summary.js <lcov.info>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
// lcov 解析 + 「行级可信」判定的**唯一真源**（与 merge-lcov / coverage-diff-gate 共用）
const { readLcov, isLineTrustworthy } = require('./lib/lcov.js');

const pct = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 10000) / 100);

function statsFor(data) {
  const lines = [...data.da.values()];
  const linesCovered = lines.filter((h) => h > 0).length;
  const branches = [...data.brda.values()];
  const branchesCovered = branches.filter((h) => h > 0).length;
  const fns = [...data.fnda.values()];
  const fnsCovered = fns.filter((h) => h > 0).length;
  return {
    lines: { covered: linesCovered, total: lines.length },
    branches: { covered: branchesCovered, total: branches.length },
    functions: { covered: fnsCovered, total: fns.length },
    uncovered: [...data.da.entries()].filter(([, h]) => h === 0).map(([l]) => l),
  };
}

function main() {
  const lcovPath = process.argv[2];
  if (!lcovPath || !fs.existsSync(lcovPath)) {
    console.error('usage: node scripts/lcov-summary.js <lcov.info> [--trust <file>]');
    process.exit(2);
  }
  // 「行覆盖可信」的源文件清单（scripts/collect-line-coverage-trust.js 生成）。
  // 清单不存在 → **没有一份数据的行覆盖是可信的** → 报告里必须说清楚，
  // 不能把错位的行覆盖当成真数字报出去。
  const trustIdx = process.argv.indexOf('--trust');
  const trustPath = trustIdx > 0 ? process.argv[trustIdx + 1] : null;
  const trusted = new Set();
  let trustKnown = false;
  if (trustPath && fs.existsSync(trustPath)) {
    trustKnown = true;
    for (const line of fs.readFileSync(trustPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (t) trusted.add(t);
    }
  }
  const { files } = readLcov(lcovPath);
  /** 这个文件的**行级**覆盖可信吗？（分支/函数的口径不依赖行号） */
  // ⚠️ 判据在 scripts/lib/lcov.js 里（**唯一真源**）—— 报告端和门禁端必须
  //    用同一套，否则会出现「报告说可信、门禁说不可信」的矛盾。
  const lineTrustOf = (file) =>
    trustKnown ? isLineTrustworthy(file, files.get(file)?.da, trusted) : false;

  // 按目录聚合（**分「可信 / 不可信」两桶**）
  //
  // ⚠️ 为什么要分桶：**行级数字只有在「行号可信」时才能当真值**。
  //   「行号不可信」= 该文件有命中、但那些命中的**行号**是错位的
  //   （H16 之后剩下的这一类极少见：node 侧无 source map 的那批已被证明
  //   行号是准的 → 进了信任清单）。
  //
  //   ⚠️ **但「从没被加载过」的文件（全 0 命中）现在算「可信」** ——
  //     c8 的 `--all` 会把它们列进 lcov（DA = 1..N 连续的真实源文件行，
  //     实测行号是准的），它们是 0% 覆盖 → **必须按 0% 计入分母**。
  //     否则「新增一个从没被测过的文件」**完全不影响总数** → 覆盖率在骗人
  //     （实测虚高 1.46pp：92.13% vs 真实 90.67%）。
  const dirAgg = new Map();
  const newAgg = () => ({ lines: [0, 0], branches: [0, 0], functions: [0, 0] });
  for (const [file, data] of files) {
    const s = statsFor(data);
    const dir = path.dirname(file);
    let agg = dirAgg.get(dir);
    if (!agg) {
      agg = { trusted: newAgg(), untrusted: newAgg() };
      dirAgg.set(dir, agg);
    }
    // 可信性**只影响行级**（分支/函数的口径不依赖行号）
    const target = lineTrustOf(file) ? agg.trusted : agg.untrusted;
    target.lines[0] += s.lines.covered;
    target.lines[1] += s.lines.total;
    target.branches[0] += s.branches.covered;
    target.branches[1] += s.branches.total;
    target.functions[0] += s.functions.covered;
    target.functions[1] += s.functions.total;
  }

  const total = { trusted: newAgg(), untrusted: newAgg() };
  for (const agg of dirAgg.values()) {
    for (const k of ['lines', 'branches', 'functions']) {
      total.trusted[k][0] += agg.trusted[k][0];
      total.trusted[k][1] += agg.trusted[k][1];
      total.untrusted[k][0] += agg.untrusted[k][0];
      total.untrusted[k][1] += agg.untrusted[k][1];
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v) => String(v).padStart(5);
  const out = [];

  // ── 可信性标注（**数字必须诚实**）───────────────────────────────
  //
  // 「行级可信」= 该文件的**行号**能当真值（判据见 scripts/lib/lcov.js）。
  //
  // ⚠️ 2026-10-24 **H16 之后口径变了**：
  //   - 「从没被加载过」的文件（全 0 命中，c8 的 `--all` 列出来的）→
  //     **行号是准的**（DA = 1..N 连续的真实源文件行）→ 算**可信** →
  //     按 0% 计入分母。否则「新增一个从没被测过的文件」**完全不影响总数**
  //     → 覆盖率在骗人（实测虚高 1.46pp）。
  //   - 剩下的「不可信」= 有命中、但**行号**是错位的 → 那些「未覆盖行号」
  //     是**假的** → 不能和可信的混在一起报成「总覆盖率」。
  const trustedLines = [0, 0];
  const untrustedLines = [0, 0];
  for (const [file, data] of files) {
    const st = statsFor(data);
    const target = lineTrustOf(file) ? trustedLines : untrustedLines;
    target[0] += st.lines.covered;
    target[1] += st.lines.total;
  }
  const tp = (c, t) => (t === 0 ? 0 : Math.round((c / t) * 10000) / 100);
  if (trustKnown) {
    out.push(
      `── 行覆盖可信性：可信 ${trustedLines[1]} 行（${tp(trustedLines[0], trustedLines[1])}%），` +
        `不可信 ${untrustedLines[1]} 行（${tp(untrustedLines[0], untrustedLines[1])}%）`,
    );
    if (untrustedLines[1] > 0) {
      out.push('   ⚠️ 不可信的那部分**行号是错位的** → 其中的「% Lines」和「未覆盖行号」');
      out.push('      **不要当真**（函数覆盖 % Funcs 仍可信）。');
    }
    out.push('');
  } else {
    out.push('── ⚠️ 找不到「行覆盖可信文件」清单 → 本报告的**行覆盖数字全部不可信**');
    out.push('   （有命中、但行号是错位的那部分不能当真；% Funcs 仍然可信）');
    out.push('');
  }

  out.push('-----------------|---------|----------|---------|---------|----------------');
  for (const dir of [...dirAgg.keys()].sort()) {
    const a = dirAgg.get(dir);
    // ⚠️ 目录行：只要这个目录里**混有不可信文件**，它的「% Lines」就不是
    //   一个能当真的数字 → 标 `~`（和文件行同一套约定）。
    const mixed = a.untrusted.lines[1] > 0;
    const lineCol = mixed ? '    ~' : num(pct(a.trusted.lines[0], a.trusted.lines[1]));
    out.push(
      `${pad(dir, 17)}|${lineCol}|${num(pct(a.trusted.branches[0], a.trusted.branches[1]))}|` +
        `${num(pct(a.trusted.functions[0], a.trusted.functions[1]))}|${lineCol}|`,
    );
  }
  out.push('-----------------|---------|----------|---------|---------|----------------');
  // ── 「All files」行 = **只统计可信部分** ─────────────────────────
  //
  // ⚠️ 这一行被 `coverage_threshold_gate` 读（≥60% 那条底线）→ 它判的
  //   必须是**能当真的数字**。混着不可信数据 = 拿假行号当真值。
  //
  // ⚠️ 2026-10-24（P2）：「从没被加载过」的文件（全 0 命中）现在算**可信**
  //   → 它们按 0% **计入分母** → 「All files」== 合并后 lcov 的整体行覆盖。
  //   修之前它们被踢出分母 → 报告虚高 1.46pp（92.13% vs 真实 90.67%），
  //   且「新增一个从没被测过的文件」**完全不影响总数**。
  //
  // ⚠️ 兜底：**一份可信数据都没有**时（清单缺失 / 采集环境不具备）不能报
  //   0%（那是「没有数据」，不是「没覆盖」）→ 退回混合总数并**明确警告**。
  const hasTrusted = total.trusted.lines[1] > 0;
  const headline = hasTrusted ? total.trusted : total.untrusted;
  if (!hasTrusted) {
    out.push('   ⚠️ **没有一份可信的行覆盖数据** → 下面的「All files」退回未分层总数（不可信）');
  }
  out.push(
    `${pad('All files', 17)}|${num(pct(headline.lines[0], headline.lines[1]))}|` +
      `${num(pct(headline.branches[0], headline.branches[1]))}|` +
      `${num(pct(headline.functions[0], headline.functions[1]))}|` +
      `${num(pct(headline.lines[0], headline.lines[1]))}|`,
  );
  out.push('-----------------|---------|----------|---------|---------|----------------');

  // 文件级明细（缩进两格，与 c8 的 text reporter 一致）
  for (const file of [...files.keys()].sort()) {
    const s = statsFor(files.get(file));
    const uncovered = s.uncovered.length ? s.uncovered.join(',') : '';
    // 行覆盖不可信的文件 → 行号列标 `~`（表示"这个数字别当真"）
    const lineCol = lineTrustOf(file) ? num(pct(s.lines.covered, s.lines.total)) : '    ~';
    const uncoveredCol = lineTrustOf(file) ? uncovered : '(行号不可信)';
    out.push(
      `  ${pad(path.basename(file), 15)}|${num(pct(s.lines.covered, s.lines.total))}|` +
        `${num(pct(s.branches.covered, s.branches.total))}|${num(pct(s.functions.covered, s.functions.total))}|` +
        `${lineCol}| ${uncoveredCol}`,
    );
  }

  console.log(out.join('\n'));
}

main();
