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

function parseLcov(text) {
  /** @type {Map<string, {da: Map<number, number>, brda: Map<string, number>, fnda: Map<string, number>}>} */
  const files = new Map();
  for (const block of text.split('end_of_record')) {
    let file = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('SF:')) {
        file = line.slice(3).trim();
        if (!files.has(file)) {
          files.set(file, { da: new Map(), brda: new Map(), fnda: new Map() });
        }
      } else if (file && line.startsWith('DA:')) {
        const [ln, hits] = line.slice(3).split(',');
        const n = Number(ln);
        const h = Number(hits);
        if (Number.isFinite(n)) files.get(file).da.set(n, Number.isFinite(h) ? h : 0);
      } else if (file && line.startsWith('BRDA:')) {
        const parts = line.slice(5).split(',');
        if (parts.length < 4) continue;
        const taken = parts[3] === '-' ? 0 : Number(parts[3]);
        files
          .get(file)
          .brda.set(`${parts[0]},${parts[1]},${parts[2]}`, Number.isFinite(taken) ? taken : 0);
      } else if (file && line.startsWith('FNDA:')) {
        const rest = line.slice(5);
        const idx = rest.indexOf(',');
        if (idx < 0) continue;
        const hits = Number(rest.slice(0, idx));
        files.get(file).fnda.set(rest.slice(idx + 1), Number.isFinite(hits) ? hits : 0);
      }
    }
  }
  return files;
}

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
  /** 这个文件的**行级**覆盖可信吗？（分支/函数的口径不依赖行号） */
  const lineTrustOf = (file) => (trustKnown ? trusted.has(file) : false);
  const files = parseLcov(fs.readFileSync(lcovPath, 'utf8'));

  // 按目录聚合（**分「可信 / 不可信」两桶**）
  //
  // ⚠️ 为什么要分桶：行级覆盖只在**有 source map** 的采集里可信（见
  // collect-line-coverage-trust.js）。缺 source map 时 c8 拿转换后 JS 的
  // 字节偏移去切源文件 → 行号随机（但 DA 条目数 = 源文件行数，看起来
  // 「对齐」）→ 那些「未覆盖行号」是**假的**。
  // → 混在一起报成「总覆盖率」= **一份在骗人的报告**（实测踩过：
  //   某个测试文件跑不起来 → 覆盖率从 80% 塌成 32%，看着像天大的覆盖洞，
  //   其实只是那次测试没跑成）。
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
  // 行级覆盖只在**有 source map** 的采集里可信（见
  // scripts/collect-line-coverage-trust.js）。缺 source map 时 c8 拿转换后
  // JS 的字节偏移去切源文件 → 行号随机（但 DA 条目数 = 源文件行数，看起来
  // 「对齐」）。实测：一个**从未被调用**的函数，其函数体各行 hits 却是 170。
  //
  // → 不可信的行覆盖**不能**和可信的混在一起报成「总覆盖率」。
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
      out.push('   ⚠️ 不可信的那部分行覆盖**行号是错位的**（缺 source map）—— 其中的');
      out.push('      「% Lines」和「未覆盖行号」**不要当真**（函数覆盖 % Funcs 仍可信）。');
    }
    out.push('');
  } else {
    out.push('── ⚠️ 找不到「行覆盖可信文件」清单 → 本报告的**行覆盖数字全部不可信**');
    out.push('   （缺 source map 时行号是错位的；% Funcs 仍然可信）');
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
