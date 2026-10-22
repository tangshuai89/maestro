#!/usr/bin/env node
/**
 * istanbul coverage JSON → lcov.info 转换。
 *
 * ## 为什么需要
 *
 * 2026-10-21 之前，renderer 的覆盖率是用 **c8 包 vitest** 采的 → 行号错位
 * （见 specs/stability/tasks.md H12）。现在 renderer 改用
 * **@vitest/coverage-v8**（vite 自己的 transform 链 → 拿得到 source map →
 * 行号正确），但它输出的是 **istanbul JSON**（`coverage-final.json`），
 * 而仓库里其它工具链（c8、合并器、门禁）都吃 **lcov** 格式。
 *
 * 这个脚本做格式转换，让两边能在同一个层面合并。
 *
 * ## 路径基准
 *
 * istanbul JSON 的 key 是**绝对路径** → 转成**相对仓库根**（和 git diff 对得上）。
 * ⚠️ coverage-v8 自己的 `lcov.info` 用的是「相对 vitest root」的路径
 * （`src/App.tsx`）→ 和 git diff 对不上 → **不能直接用那份 lcov**。
 *
 * ## 用法
 *
 *   node scripts/istanbul-to-lcov.js <coverage-final.json> <out.lcov.info>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** istanbul JSON → lcov 文本。 */
function convert(istanbul, repoRoot) {
  const out = [];
  for (const [absFile, fc] of Object.entries(istanbul)) {
    const rel = path.relative(repoRoot, absFile).split(path.sep).join('/');
    if (rel.startsWith('..')) continue; // 不在仓库内
    if (rel.includes('/node_modules/')) continue;
    if (rel.includes('/dist/')) continue;

    // ── 行覆盖 ────────────────────────────────────────────────────
    // istanbul 的 statementMap 每个 statement 有一个起止行；lcov 的 DA 是
    // 「每行一个 hits」。一个 statement 可能跨多行 → 取该行所有 statement
    // 的 hits 之和（与 istanbul 自己的行覆盖口径一致：行被任一 statement 覆盖
    // 就算覆盖）。
    const lineHits = new Map();
    for (const [k, loc] of Object.entries(fc.statementMap ?? {})) {
      const hits = fc.s?.[k] ?? 0;
      const start = loc.start?.line;
      const end = loc.end?.line ?? start;
      if (!start) continue;
      for (let ln = start; ln <= end; ln++) {
        lineHits.set(ln, (lineHits.get(ln) ?? 0) + hits);
      }
    }
    // 没有任何 statement 的行 → 记 0（保持「每个可执行行都有 DA 记录」的形状）
    // ⚠️ 纯注释/空行没有 statement → 它们不会出现在 lineHits 里 →
    //    lcov 里就没有这些行。这与 c8 的行为一致（c8 也只给可执行行记 DA）。

    // ── 函数覆盖 ──────────────────────────────────────────────────
    const fnEntries = [];
    for (const [k, fn] of Object.entries(fc.fnMap ?? {})) {
      fnEntries.push({ name: fn.name ?? '(anonymous)', line: fn.line ?? fn.loc?.start?.line ?? 0, hits: fc.f?.[k] ?? 0 });
    }
    // lcov 的 FNDA **按函数名索引** → 同名函数的次数会合并（这是 lcov 格式的
    // 固有行为，门禁那边已经知道这个盲区）。
    const fnda = new Map();
    for (const fn of fnEntries) {
      fnda.set(fn.name, (fnda.get(fn.name) ?? 0) + fn.hits);
    }

    // ── 分支覆盖 ──────────────────────────────────────────────────
    const brEntries = [];
    for (const [k, br] of Object.entries(fc.branchMap ?? {})) {
      const counts = fc.b?.[k] ?? [];
      counts.forEach((taken, idx) => {
        const loc = br.locations?.[idx] ?? br.loc;
        const line = loc?.start?.line ?? br.line ?? 0;
        const block = br.locations?.length ? idx : 0;
        brEntries.push({ key: `${line},${block},${idx}`, taken });
      });
    }

    const lh = [...lineHits.values()].filter((h) => h > 0).length;
    const fnh = [...fnda.values()].filter((h) => h > 0).length;
    const brh = brEntries.filter((b) => b.taken > 0).length;

    out.push(`SF:${rel}`);
    for (const fn of fnEntries) out.push(`FN:${fn.line},${fn.name}`);
    out.push(`FNF:${fnEntries.length}`);
    out.push(`FNH:${fnh}`);
    for (const [name, hits] of fnda) out.push(`FNDA:${hits},${name}`);
    out.push(`BRF:${brEntries.length}`);
    out.push(`BRH:${brh}`);
    for (const b of brEntries) out.push(`BRDA:${b.key},${b.taken}`);
    out.push(`LF:${lineHits.size}`);
    out.push(`LH:${lh}`);
    for (const [ln, hits] of [...lineHits.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`DA:${ln},${hits}`);
    }
    out.push('end_of_record');
  }
  return out.join('\n') + '\n';
}

/**
 * 自测：验证转换语义。
 *
 * 关键点：**行号必须原样保留**（istanbul 的 line → lcov 的 DA:line）。
 * 转换错了行号 → 合并出来的覆盖率又变成错位的 → 白改。
 */
function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };
  const repoRoot = '/repo';
  const json = {
    '/repo/packages/x/src/a.ts': {
      statementMap: {
        0: { start: { line: 10, column: 0 }, end: { line: 10, column: 5 } },
        1: { start: { line: 20, column: 0 }, end: { line: 22, column: 1 } },
        2: { start: { line: 30, column: 0 }, end: { line: 30, column: 1 } },
      },
      s: { 0: 3, 1: 0, 2: 7 },
      fnMap: {
        0: { name: 'hit', line: 10, loc: { start: { line: 10 } } },
        1: { name: 'miss', line: 20, loc: { start: { line: 20 } } },
      },
      f: { 0: 3, 1: 0 },
      branchMap: {
        0: { type: 'branch', line: 10, loc: { start: { line: 10 } }, locations: [{ start: { line: 10 } }, { start: { line: 11 } }] },
      },
      b: { 0: [1, 0] },
    },
  };
  const lcov = convert(json, repoRoot);
  expect('路径转成相对仓库根', lcov.includes('SF:packages/x/src/a.ts'));
  expect('行号原样保留：DA:10,3', lcov.includes('DA:10,3'));
  expect('跨行 statement 落到每一行：DA:20,0', lcov.includes('DA:20,0'));
  expect('跨行 statement 落到每一行：DA:21,0', lcov.includes('DA:21,0'));
  expect('跨行 statement 落到每一行：DA:22,0', lcov.includes('DA:22,0'));
  expect('未覆盖行 hits=0：DA:30,7 是另一个 statement', lcov.includes('DA:30,7'));
  // 覆盖的行：10（statement0）、20/21/22（跨行 statement1）、30（statement2）= 5 行
  expect('行汇总 LF:5（10 + 跨行的 20/21/22 + 30）', lcov.includes('LF:5'));
  expect('行汇总 LH:2（只有 10 和 30 命中）', lcov.includes('LH:2'));
  expect('函数记录 FN:10,hit', lcov.includes('FN:10,hit'));
  expect('函数命中 FNDA:3,hit', lcov.includes('FNDA:3,hit'));
  expect('函数未命中 FNDA:0,miss', lcov.includes('FNDA:0,miss'));
  expect('函数汇总 FNF:2', lcov.includes('FNF:2'));
  expect('函数汇总 FNH:1', lcov.includes('FNH:1'));
  expect('分支汇总 BRF:2', lcov.includes('BRF:2'));
  expect('分支汇总 BRH:1', lcov.includes('BRH:1'));

  if (failures.length > 0) {
    console.error(`❌ istanbul-to-lcov 自测失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log('✅ istanbul-to-lcov 自测通过（路径 + 行号保留 + 行/函数/分支汇总）');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length < 2) {
    console.error(
      'usage: node scripts/istanbul-to-lcov.js <coverage-final.json> <out.lcov.info>\n' +
        '       node scripts/istanbul-to-lcov.js --self-test',
    );
    process.exit(2);
  }
  const [inPath, outPath] = args;
  if (!fs.existsSync(inPath)) {
    console.error(`❌ 读不到 ${inPath}`);
    process.exit(2);
  }
  const json = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const lcov = convert(json, process.cwd());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lcov);
  const files = Object.keys(json).length;
  console.error(`── istanbul → lcov：${files} 个文件 → ${outPath}`);
}

if (require.main === module) main();

module.exports = { convert };
