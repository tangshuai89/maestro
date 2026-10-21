#!/usr/bin/env node
/**
 * 合并多份 lcov.info —— 按「行/分支/函数是否被命中」取**并集**。
 *
 * ## 为什么需要它（2026-10-21 实测）
 *
 * 仓库里有**两条互不兼容的 TS 转换管线**会覆盖同一个源文件：
 *
 *   - `.test.mjs` → `node` + 自实现 ESM loader（node 自己的 type-stripping）
 *   - `.test.tsx` → `vitest` + vite/esbuild 转换
 *
 * 两份产物都被 c8 收进**同一个** temp 目录，c8 在生成报告时按 URL 把它们
 * 合并（`@bcoe/v8-coverage` 的 `mergeScriptCovs`）—— 但那个合并是按
 * **字节偏移**匹配函数的。两份的偏移基于**不同的转换后源码**，对不上 →
 * 同一份文件被拆成两组互不相认的函数条目 → 只有其中一组能对上 c8 手里的
 * source map → **另一组的覆盖被整份丢弃**。
 *
 * 实测（`packages/renderer/src/lib/lyricsShare.ts`）：
 *
 *   | 来源                       | 行覆盖      |
 *   | -------------------------- | ----------- |
 *   | 只跑 `.test.mjs`           | 71/171      |
 *   | 只跑 `.test.tsx`           | 167/171     |
 *   | **合并后（当前，有 bug）** | **67/171**  |
 *   | 正确值（并集）              | 171/171     |
 *
 * 而且**哪一边胜出不可预测**：`api.ts` 是 vitest 赢、`lyricsShare.ts` 是
 * node 赢。门禁阈值（≥60% 行覆盖）就建立在这组数字上 —— 也就是说
 * **门禁读到的可能是任意一边的值**，不是真实覆盖。
 *
 * ## 修法
 *
 * 让两条管线**各自采集到独立的 temp 目录**，再在 **lcov 文本层**做并集：
 *
 *   - lcov 是行级格式（`DA:<line>,<hits>`），**不依赖字节偏移** → 两边天然可比
 *   - 「这一行有没有被执行」是布尔语义 → 并集 = `max(hits_a, hits_b)`
 *   - 分支（`BRDA`）同理：任一边命中即算命中
 *   - 函数（`FNDA`）同理：命中次数取 max（不求和 —— 求和会让"覆盖"与
 *     "执行次数"混为一谈，而门禁只关心有没有执行过）
 *
 * ## 用法
 *
 *   node scripts/merge-lcov.js <输出 lcov.info> <输入 lcov.info>...
 *
 * 输入文件里**没有**的源文件（某条管线没覆盖到）由调用方保证：c8 的
 * `--all` 已经在各自报告里给全量源文件留了 0% 记录，所以并集之后仍是全量。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 解析一份 lcov.info → 按文件路径聚合的结构。 */
function parseLcov(text) {
  /** @type {Map<string, {da: Map<number, number>, brda: Map<string, number>, fnda: Map<string, number>, fn: Map<string, number>}>} */
  const files = new Map();

  const ensure = (file) => {
    let f = files.get(file);
    if (!f) {
      f = {
        da: new Map(),
        brda: new Map(),
        fnda: new Map(),
        fn: new Map(),
      };
      files.set(file, f);
    }
    return f;
  };

  for (const block of text.split('end_of_record')) {
    const lines = block.split('\n');
    let file = null;
    for (const line of lines) {
      if (line.startsWith('SF:')) {
        file = line.slice(3).trim();
        ensure(file);
      } else if (line.startsWith('DA:')) {
        // DA:<line>,<hits>[,<checksum>]
        const [ln, hits] = line.slice(3).split(',');
        const n = Number(ln);
        const h = Number(hits);
        if (!Number.isFinite(n)) continue;
        const f = ensure(file);
        f.da.set(n, Math.max(f.da.get(n) ?? 0, h));
      } else if (line.startsWith('BRDA:')) {
        // BRDA:<line>,<block>,<branch>,<taken>
        const parts = line.slice(5).split(',');
        if (parts.length < 4) continue;
        const key = `${parts[0]},${parts[1]},${parts[2]}`;
        const taken = parts[3] === '-' ? 0 : Number(parts[3]);
        const f = ensure(file);
        f.brda.set(key, Math.max(f.brda.get(key) ?? 0, Number.isFinite(taken) ? taken : 0));
      } else if (line.startsWith('FNDA:')) {
        // FNDA:<hits>,<name>  —— name 里可能带逗号，所以只在**剥掉前缀后**
        // 找第一个逗号。
        const rest = line.slice(5);
        const idx = rest.indexOf(',');
        if (idx < 0) continue;
        const hits = Number(rest.slice(0, idx));
        const name = rest.slice(idx + 1);
        const f = ensure(file);
        f.fnda.set(name, Math.max(f.fnda.get(name) ?? 0, Number.isFinite(hits) ? hits : 0));
      } else if (line.startsWith('FN:')) {
        // FN:<line>,<name>
        const rest = line.slice(3);
        const idx = rest.indexOf(',');
        if (idx < 0) continue;
        const ln = Number(rest.slice(0, idx));
        const name = rest.slice(idx + 1);
        const f = ensure(file);
        f.fn.set(name, Math.max(f.fn.get(name) ?? 0, Number.isFinite(ln) ? ln : 0));
      }
    }
  }
  return files;
}

/** 写出一份 lcov.info。 */
function writeLcov(files) {
  const out = [];
  for (const [file, data] of files) {
    const lh = [...data.da.values()].filter((h) => h > 0).length;
    const fnHits = [...data.fnda.values()].filter((h) => h > 0).length;

    // BRDA 里的 taken 是「该分支被走到几次」；`0` 也算"这条分支存在"，
    // 但 lcov 语义里 taken=-1 表示"不可达"。合并时保留 -1 语义。
    const brEntries = [...data.brda.entries()].sort((a, b) => {
      const [al, ab, ac] = a[0].split(',');
      const [bl, bb, bc] = b[0].split(',');
      return Number(al) - Number(bl) || Number(ab) - Number(bb) || Number(ac) - Number(bc);
    });

    out.push(`SF:${file}`);
    for (const [name, ln] of data.fn) {
      out.push(`FN:${ln},${name}`);
    }
    out.push(`FNF:${data.fn.size}`);
    out.push(`FNH:${fnHits}`);
    for (const [name, hits] of data.fn) {
      out.push(`FNDA:${data.fnda.get(name) ?? 0},${name}`);
    }
    // 分支汇总
    const brTotal = brEntries.length;
    const brTaken = brEntries.filter(([, taken]) => taken > 0).length;
    out.push(`BRF:${brTotal}`);
    out.push(`BRH:${brTaken}`);
    for (const [key, taken] of brEntries) {
      out.push(`BRDA:${key},${taken}`);
    }
    // 行汇总
    out.push(`LF:${data.da.size}`);
    out.push(`LH:${lh}`);
    for (const [ln, hits] of [...data.da.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`DA:${ln},${hits}`);
    }
    out.push('end_of_record');
  }
  return out.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: node scripts/merge-lcov.js <output.lcov> <input.lcov>...');
    process.exit(2);
  }
  const [outPath, ...inputs] = args;

  const merged = new Map();
  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      // 某条管线没有产出（没跑到 / 目录被清）→ 跳过，不算失败：
      // 少一份数据只意味着少一些覆盖，不是数据损坏。
      console.error(`── 跳过缺失的覆盖率文件：${input}`);
      continue;
    }
    const parsed = parseLcov(fs.readFileSync(input, 'utf8'));
    for (const [file, data] of parsed) {
      let target = merged.get(file);
      if (!target) {
        target = {
          da: new Map(),
          brda: new Map(),
          fnda: new Map(),
          fn: new Map(),
        };
        merged.set(file, target);
      }
      for (const [k, v] of data.da) target.da.set(k, Math.max(target.da.get(k) ?? 0, v));
      for (const [k, v] of data.brda) {
        // taken = -1（不可达）是特殊值，不参与 max：只要有一边说"可达"，
        // 那就是可达。
        const cur = target.brda.get(k);
        if (cur === undefined) target.brda.set(k, v);
        else if (cur === -1) target.brda.set(k, v);
        else if (v !== -1) target.brda.set(k, Math.max(cur, v));
      }
      for (const [k, v] of data.fnda) target.fnda.set(k, Math.max(target.fnda.get(k) ?? 0, v));
      for (const [k, v] of data.fn) target.fn.set(k, Math.max(target.fn.get(k) ?? 0, v));
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, writeLcov(merged));

  // 汇总打印（给人看的）
  let lf = 0;
  let lh = 0;
  for (const data of merged.values()) {
    lf += data.da.size;
    lh += [...data.da.values()].filter((h) => h > 0).length;
  }
  const pct = lf === 0 ? 0 : Math.round((lh / lf) * 10000) / 100;
  console.error(
    `── 合并 ${inputs.length} 份 lcov：${merged.size} 个文件，行覆盖 ${lh}/${lf} = ${pct}%`,
  );
}

main();
