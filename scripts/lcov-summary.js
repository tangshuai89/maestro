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
    console.error('usage: node scripts/lcov-summary.js <lcov.info>');
    process.exit(2);
  }
  const files = parseLcov(fs.readFileSync(lcovPath, 'utf8'));

  // 按目录聚合
  const dirAgg = new Map();
  for (const [file, data] of files) {
    const s = statsFor(data);
    const dir = path.dirname(file);
    let agg = dirAgg.get(dir);
    if (!agg) {
      agg = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
      dirAgg.set(dir, agg);
    }
    agg.lines[0] += s.lines.covered;
    agg.lines[1] += s.lines.total;
    agg.branches[0] += s.branches.covered;
    agg.branches[1] += s.branches.total;
    agg.functions[0] += s.functions.covered;
    agg.functions[1] += s.functions.total;
  }

  const total = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
  for (const agg of dirAgg.values()) {
    total.lines[0] += agg.lines[0];
    total.lines[1] += agg.lines[1];
    total.branches[0] += agg.branches[0];
    total.branches[1] += agg.branches[1];
    total.functions[0] += agg.functions[0];
    total.functions[1] += agg.functions[1];
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v) => String(v).padStart(5);
  const out = [];

  out.push('-----------------|---------|----------|---------|---------|----------------');
  for (const dir of [...dirAgg.keys()].sort()) {
    const a = dirAgg.get(dir);
    out.push(
      `${pad(dir, 17)}|${num(pct(a.lines[0], a.lines[1]))}|${num(pct(a.branches[0], a.branches[1]))}|` +
        `${num(pct(a.functions[0], a.functions[1]))}|${num(pct(a.lines[0], a.lines[1]))}|`,
    );
  }
  out.push('-----------------|---------|----------|---------|---------|----------------');
  out.push(
    `${pad('All files', 17)}|${num(pct(total.lines[0], total.lines[1]))}|` +
      `${num(pct(total.branches[0], total.branches[1]))}|${num(pct(total.functions[0], total.functions[1]))}|` +
      `${num(pct(total.lines[0], total.lines[1]))}|`,
  );
  out.push('-----------------|---------|----------|---------|---------|----------------');

  // 文件级明细（缩进两格，与 c8 的 text reporter 一致）
  for (const file of [...files.keys()].sort()) {
    const s = statsFor(files.get(file));
    const uncovered = s.uncovered.length ? s.uncovered.join(',') : '';
    out.push(
      `  ${pad(path.basename(file), 15)}|${num(pct(s.lines.covered, s.lines.total))}|` +
        `${num(pct(s.branches.covered, s.branches.total))}|${num(pct(s.functions.covered, s.functions.total))}|` +
        `${num(pct(s.lines.covered, s.lines.total))}| ${uncovered}`,
    );
  }

  console.log(out.join('\n'));
}

main();
