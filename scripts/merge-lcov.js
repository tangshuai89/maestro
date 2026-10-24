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
 * ## 「权威输入」：行号坐标系**已经是同一套**（2026-10-24 实测推翻旧前提）
 *
 * ⚠️ **旧前提（已推翻）**：这里原来写着「node 直跑 `.test.mjs` 的行号是**随机
 * 错位**的 → 权威侧覆盖的文件必须**整份替换**，不能取 max」。
 *
 * **实测不成立**，三条证据：
 *   1. node 的 type-stripping 是**按原位抹掉类型**（把类型替成空白，**行数不变**）
 *      → 行位置完整保留 → 行号是准的。
 *   2. `backup-crypto.ts`：node 侧未覆盖行 = **135-136** = 唯一那条不可达的
 *      `catch { throw new Error('备份内容损坏') }` —— 语义完全对得上。
 *   3. `usePlayer.ts`：node 侧命中行 = **1-131 连续一段** = 正好是「import +
 *      类型 import + re-export」块 = **模块顶层**；`.test.mjs` 只调纯函数 →
 *      顶层执行一次 → 顶层算命中、hook 体一次没跑 → **完全正确**。
 *
 * 那句「esbuild 把 usePlayer.ts 从 2192 行压成 1336 行」说的是**另一件事**：
 * 那是 **c8 包 vitest** 时代的问题（vite/esbuild 转换后的 JS 在内存里跑，
 * source map 是 inline data URL → node 的 source-map-cache 里没有 → c8 拿
 * 转换后字节偏移切源文件）。H12 已经把 renderer 的 `.test.tsx` 迁到
 * `@vitest/coverage-v8`（自带 source map）→ **那条路径不再是行错位的来源**。
 *
 * ⇒ 现在两侧的行号**指的是同一件事** → **行级取 max 是「更全的真相」，
 * 不是污染**。而原来的「整文件替换」会**丢掉 node 侧的真覆盖**：
 * 实测 24 个文件重叠、**568 条行命中被丢**（`spotify-wps.ts` 真实 91% 被写成
 * 25.8%、`backup-crypto.ts` 真实 99.5% 被写成 76.7%）→ 覆盖率被低估，
 * 且 diff 门禁会把「`.test.mjs` 确实测过的老代码」判成「未覆盖」→ **误拦**。
 *
 * ## 「行覆盖分母」只算真实代码行
 *
 * node 侧的 v8 覆盖是**区间**（block range）→ 一段区间会把中间的**注释 / 空行**
 * 一起算成命中（实测 node 侧独有文件的命中行有 **29.7% 落在注释/空行上**）。
 * ⇒ 写输出时**剔除注释/空行的 DA 条目**：分母只算真实代码行，顺带解决
 * 「过度归因」造成的**虚高**。实测全局行覆盖 92.11% → 90.71%（更诚实，不是更松）。
 *
 * ## 用法
 *
 *   node scripts/merge-lcov.js <输出 lcov.info> <输入 lcov.info>...
 *   node scripts/merge-lcov.js --authoritative <权威输入> <输出> <输入>...
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

/**
 * 「真实代码行」的行号集合 —— 剔除空行 / 行注释 / 块注释。
 *
 * 为什么需要：node 侧的 v8 覆盖是**区间**（block range）→ 一段区间会把中间的
 * 注释 / 空行一起算成「命中」（实测 node 侧独有文件的命中行有 29.7% 落在
 * 注释/空行上）→ 行覆盖的**分母**被注释撑大、**分子**被虚高 → 百分比失真。
 *
 * ⇒ 写输出时把注释/空行的 DA 条目剔掉：分母只算真实代码行。
 *
 * ⚠️ **源文件不存在时返回 null** → 调用方**不过滤**（保留全部 DA 条目）。
 *    这条很重要：自测用合成 lcov（`SF:src/x.ts` 这种不存在的路径），
 *    过滤逻辑若在文件缺失时「当作全是非代码行」→ 自测的合成数据会被清空。
 *
 * ⚠️ **块注释内部行（不带 `*` 前缀的）算作代码行** —— 这是**保守**方向：
 *    分母偏大 → 百分比偏低 → 门禁偏严。宁可偏严不可偏松。
 */
const realCodeLinesCache = new Map();
function realCodeLines(file) {
  if (realCodeLinesCache.has(file)) return realCodeLinesCache.get(file);
  let result = null;
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const src = fs.readFileSync(file, 'utf8').split('\n');
      const set = new Set();
      let inBlock = false;
      for (let i = 0; i < src.length; i++) {
        const t = src[i].trim();
        if (inBlock) {
          if (t.includes('*/')) inBlock = false;
          continue;
        }
        if (t === '' || t.startsWith('//')) continue;
        if (t.startsWith('/*')) {
          if (!t.includes('*/')) inBlock = true;
          continue;
        }
        set.add(i + 1);
      }
      result = { set, total: src.length };
    }
  } catch {
    result = null;
  }
  realCodeLinesCache.set(file, result);
  return result;
}

/** 写出一份 lcov.info。 */
function writeLcov(files) {
  const out = [];
  for (const [file, data] of files) {
    // 行覆盖分母只算真实代码行（剔除注释/空行）——
    // 见 realCodeLines() 的注释：node 侧的 block range 会把注释算成命中。
    const real = realCodeLines(file);
    const daEntries = [...data.da.entries()].sort((a, b) => a[0] - b[0]);
    const keptDa = real
      ? // ⚠️ 行号**超出源文件行数**的条目**保留**（那是陈旧/异常数据，
        //   静默丢掉等于把「覆盖缺口」藏起来 → 保守方向是保留并让它暴露）。
        daEntries.filter(([ln]) => ln > real.total || real.set.has(ln))
      : daEntries;

    const lh = keptDa.filter(([, h]) => h > 0).length;
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
    // 行汇总（分母 = 真实代码行数，不是 DA 条目总数）
    out.push(`LF:${keptDa.length}`);
    out.push(`LH:${lh}`);
    for (const [ln, hits] of keptDa) {
      out.push(`DA:${ln},${hits}`);
    }
    out.push('end_of_record');
  }
  return out.join('\n') + '\n';
}

/**
 * 自测：用构造的 lcov 验证合并语义。
 *
 * 为什么需要：「通过的检查脚本可能只是因为规则写错而永远通过」（仓库里
 * `check-readme-i18n.mjs` 的同款教训）。合并器的逻辑只有几行，但一旦写错
 * 就会**静默**产出偏低的覆盖率 —— 而那正是它要修的缺陷本身。
 */
function selfTest() {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'maestro-lcov-selftest-'));
  const a = path.join(tmp, 'a.info');
  const b = path.join(tmp, 'b.info');
  const out = path.join(tmp, 'out.info');

  // A：行 1-3 命中，函数 f 命中；B：行 2-5 命中，函数 f 命中
  fs.writeFileSync(
    a,
    [
      'SF:src/x.ts',
      'FN:1,f',
      'FNF:1',
      'FNH:1',
      'FNDA:3,f',
      'BRF:1',
      'BRH:1',
      'BRDA:1,0,0,2',
      'LF:3',
      'LH:3',
      'DA:1,1',
      'DA:2,1',
      'DA:3,1',
      'end_of_record',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    b,
    [
      'SF:src/x.ts',
      'FN:1,f',
      'FNF:1',
      'FNH:1',
      'FNDA:5,f',
      'BRF:1',
      'BRH:0',
      'BRDA:1,0,0,0',
      'LF:5',
      'LH:3',
      'DA:1,0',
      'DA:2,1',
      'DA:3,1',
      'DA:4,1',
      'DA:5,1',
      'end_of_record',
      '',
    ].join('\n'),
  );

  const merged = new Map();
  for (const input of [a, b]) {
    const parsed = parseLcov(fs.readFileSync(input, 'utf8'));
    for (const [file, data] of parsed) {
      let target = merged.get(file);
      if (!target) {
        target = { da: new Map(), brda: new Map(), fnda: new Map(), fn: new Map() };
        merged.set(file, target);
      }
      for (const [k, v] of data.da) target.da.set(k, Math.max(target.da.get(k) ?? 0, v));
      for (const [k, v] of data.brda) {
        const cur = target.brda.get(k);
        if (cur === undefined) target.brda.set(k, v);
        else if (cur === -1) target.brda.set(k, v);
        else if (v !== -1) target.brda.set(k, Math.max(cur, v));
      }
      for (const [k, v] of data.fnda) target.fnda.set(k, Math.max(target.fnda.get(k) ?? 0, v));
      for (const [k, v] of data.fn) target.fn.set(k, Math.max(target.fn.get(k) ?? 0, v));
    }
  }
  fs.writeFileSync(out, writeLcov(merged));

  const text = fs.readFileSync(out, 'utf8');
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // 行并集：A 命中 1-3，B 命中 2-5 → 1-5 全命中
  expect('行并集：LH 应为 5', /LF:5\nLH:5/.test(text));
  expect('行并集：DA:1 应为 1（取 max，不是求和）', /DA:1,1/.test(text));
  expect('行并集：DA:5 应为 1', /DA:5,1/.test(text));
  // 函数命中取 max
  expect('函数并集：FNDA 应为 5', /FNDA:5,f/.test(text));
  expect('函数并集：FNH 应为 1', /FNH:1/.test(text));
  // 分支命中取 max
  expect('分支并集：BRH 应为 1', /BRH:1/.test(text));
  expect('分支并集：BRDA taken 应为 2', /BRDA:1,0,0,2/.test(text));

  // ── 权威输入：行号坐标系不同的两份数据**不能取 max** ──────────────
  //
  // 场景：同一个源文件被两条转换管线覆盖 ——
  //   - node 直跑 .mjs（无 source map）→ c8 的行号**随机**
  //   - vitest + coverage-v8（有 source map）→ 行号**正确**
  // 两份的「第 N 行」不是同一行 → 取 max = **污染**。
  // 所以权威来源覆盖的文件必须**完全替换**。
  {
    const fs2 = require('node:fs');
    const os2 = require('node:os');
    const p2 = require('node:path');
    const tmp2 = fs2.mkdtempSync(p2.join(os2.tmpdir(), 'maestro-merge-auth-'));
    const nodeInfo = p2.join(tmp2, 'node.info');
    const authInfo = p2.join(tmp2, 'auth.info');
    const out2 = p2.join(tmp2, 'out.info');
    // node 侧（错位）：第 5 行命中、第 9 行没命中
    fs2.writeFileSync(
      nodeInfo,
      ['SF:packages/x/src/a.ts', 'DA:5,9', 'DA:9,0', 'end_of_record', ''].join('\n'),
    );
    // 权威侧（正确）：第 5 行没命中、第 9 行命中（与上面**恰好相反**）
    fs2.writeFileSync(
      authInfo,
      ['SF:packages/x/src/a.ts', 'DA:5,0', 'DA:9,4', 'end_of_record', ''].join('\n'),
    );
    const argv2 = process.argv.slice(2);
    process.argv = [argv2[0], argv2[1], '--authoritative', authInfo, out2, nodeInfo, authInfo];
    main();
    const merged = fs2.readFileSync(out2, 'utf8');
    // ★ 2026-10-24 **反转**：原来是「完全替换」（权威侧赢）。
    //   前提「两侧行号坐标系不同」**实测已推翻**（node 的 type-stripping
    //   按原位抹掉类型 → 行位置完整保留 → 行号是准的）→ 两侧指的是同一行
    //   → 取 max 才是「更全的真相」。
    //   node: 第 5 行命中(9)、第 9 行没命中(0)
    //   auth: 第 5 行没命中(0)、第 9 行命中(4)
    //   并集  → 第 5 行 = max(0,9)=9，第 9 行 = max(4,0)=4（两边的真值都保住）
    const expectUnion =
      merged.includes('DA:5,9') && merged.includes('DA:9,4') && !merged.includes('DA:5,0');
    fs2.rmSync(tmp2, { recursive: true, force: true });
    expect(
      '权威输入：同名文件跨侧**行级并集**（两侧真值都保住，不是整文件替换）',
      expectUnion,
      `合并结果不对：\n${merged}`,
    );

    // ── 权威文件：**行 / 分支 / 函数全部跨侧并集** ───────────────────
    //
    // 2026-10-24 **改**：原来行/分支是「权威侧整文件替换」。
    // 前提「两侧行号坐标系不同」**实测已推翻**（node 的 type-stripping
    // 按原位抹掉类型 → 行位置完整保留 → 行号是准的；ts-node / coverage-v8 /
    // 浏览器侧本来就有 source map）→ 两侧指的是同一行 → 取 max 才是真相。
    //
    // 函数名是**源码标识符**、跨转换器稳定 → FNDA 跨侧取 max 一直是对的
    // （实测丢了 22 个真跑过的函数 → 门禁误判「从未执行」→ 假红）。
    {
      const fs4 = require('node:fs');
      const os4 = require('node:os');
      const p4 = require('node:path');
      const tmp4 = fs4.mkdtempSync(p4.join(os4.tmpdir(), 'maestro-merge-fnunion-'));
      const nodeInfo4 = p4.join(tmp4, 'node.info');
      const authInfo4 = p4.join(tmp4, 'auth.info');
      const out4 = p4.join(tmp4, 'out.info');
      // node 侧：第 5 行命中；函数 g 跑过（2 次）
      fs4.writeFileSync(
        nodeInfo4,
        [
          'SF:packages/x/src/a.ts',
          'FN:3,g',
          'FNF:1',
          'FNH:1',
          'FNDA:2,g',
          'BRF:1',
          'BRH:1',
          'BRDA:5,0,0,7',
          'DA:5,9',
          'end_of_record',
          '',
        ].join('\n'),
      );
      // 权威侧（行正确）：第 9 行命中；函数 g **没跑过**（0 次）
      fs4.writeFileSync(
        authInfo4,
        [
          'SF:packages/x/src/a.ts',
          'FN:3,g',
          'FNF:1',
          'FNH:0',
          'FNDA:0,g',
          'BRF:1',
          'BRH:0',
          'BRDA:9,0,0,0',
          'DA:9,4',
          'end_of_record',
          '',
        ].join('\n'),
      );
      const argv4 = process.argv.slice(2);
      process.argv = [argv4[0], argv4[1], '--authoritative', authInfo4, out4, nodeInfo4, authInfo4];
      main();
      const merged4 = fs4.readFileSync(out4, 'utf8');
      fs4.rmSync(tmp4, { recursive: true, force: true });
      expect(
        '权威文件：函数命中次数跨侧并集（node 侧跑过 → 不丢）',
        /FNDA:2,g/.test(merged4),
        `函数并集没生效：\n${merged4}`,
      );
      // ★ 2026-10-24 **反转**：原来是「行仍然只用权威侧」。
      //   实测两侧行号同坐标系 → 行也要并集（node 侧那行是真跑过的）。
      expect(
        '权威文件：行级跨侧并集（node 侧命中的行不丢）',
        merged4.includes('DA:5,9') && merged4.includes('DA:9,4'),
        `行并集没生效：\n${merged4}`,
      );
      expect(
        '权威文件：分支级跨侧并集（node 侧命中的分支不丢）',
        merged4.includes('BRDA:5,0,0,7') && merged4.includes('BRDA:9,0,0,0'),
        `分支并集没生效：\n${merged4}`,
      );
    }

    // ── 行覆盖分母只算**真实代码行**（剔除注释 / 空行）──────────────
    //
    // 为什么：node 侧的 v8 覆盖是**区间**（block range）→ 一段区间会把中间的
    // 注释 / 空行一起算成「命中」（实测 node 侧独有文件的命中行有 29.7% 落在
    // 注释/空行上）→ 分母被注释撑大、分子被虚高 → 百分比失真。
    //
    // ⚠️ 这个用例需要**真实存在的源文件**（过滤靠读源文件判断哪行是注释）。
    //    用**绝对路径**当 SF: → realCodeLines() 能读到它。
    {
      const fs6 = require('node:fs');
      const os6 = require('node:os');
      const p6 = require('node:path');
      const tmp6 = fs6.mkdtempSync(p6.join(os6.tmpdir(), 'maestro-merge-realcode-'));
      const srcFile = p6.join(tmp6, 'a.ts');
      const nodeInfo6 = p6.join(tmp6, 'node.info');
      const out6 = p6.join(tmp6, 'out.info');
      // 源文件：1=行注释 2=代码 3=空行 4-6=块注释 7-9=代码
      fs6.writeFileSync(
        srcFile,
        [
          '// 这是一行注释',
          'const a = 1;',
          '',
          '/**',
          ' * 块注释',
          ' */',
          'function f() {',
          '  return a;',
          '}',
          '',
        ].join('\n'),
      );
      // lcov：9 行**全部**有命中（模拟 node 侧 block range 把注释/空行也算进来）
      fs6.writeFileSync(
        nodeInfo6,
        [
          `SF:${srcFile}`,
          ...Array.from({ length: 9 }, (_, i) => `DA:${i + 1},5`),
          'end_of_record',
          '',
        ].join('\n'),
      );
      const argv6 = process.argv.slice(2);
      process.argv = [argv6[0], argv6[1], out6, nodeInfo6];
      main();
      const merged6 = fs6.readFileSync(out6, 'utf8');
      fs6.rmSync(tmp6, { recursive: true, force: true });
      expect(
        '行覆盖分母只算真实代码行：LF 应为 4（2,7,8,9），不是 9',
        /LF:4/.test(merged6),
        `LF 不是 4：\n${merged6}`,
      );
      expect(
        '行覆盖分母只算真实代码行：注释/空行的 DA 条目被剔除',
        !merged6.includes('DA:1,5') && !merged6.includes('DA:3,5'),
        `注释/空行没被剔除：\n${merged6}`,
      );
      expect(
        '行覆盖分母只算真实代码行：真实代码行的 DA 保留',
        merged6.includes('DA:2,5') && merged6.includes('DA:9,5'),
        `真实代码行被误删：\n${merged6}`,
      );
    }

    // ── 只有「对该文件有真实覆盖」的一侧才参与函数并集 ─────────────
    //
    // c8 的 `--all` 会给**从没被执行过**的文件也列一份 0 命中的函数清单，
    // 而那些名字是 c8 自己猜的（跟权威侧不一致）→ 混进来会污染函数分母
    // （实测全局 % Funcs 从 88.6% 掉到 87.1%）。
    {
      const fs5 = require('node:fs');
      const os5 = require('node:os');
      const p5 = require('node:path');
      const tmp5 = fs5.mkdtempSync(p5.join(os5.tmpdir(), 'maestro-merge-fnall-'));
      const nodeInfo5 = p5.join(tmp5, 'node.info');
      const authInfo5 = p5.join(tmp5, 'auth.info');
      const out5 = p5.join(tmp5, 'out.info');
      // node 侧：只有 0 命中（=--all 占位，没有真跑过）
      fs5.writeFileSync(
        nodeInfo5,
        [
          'SF:packages/x/src/b.tsx',
          'FN:3,ghost',
          'FNF:1',
          'FNH:0',
          'FNDA:0,ghost',
          'DA:1,0',
          'end_of_record',
          '',
        ].join('\n'),
      );
      // 权威侧：真跑过，函数名是 real
      fs5.writeFileSync(
        authInfo5,
        [
          'SF:packages/x/src/b.tsx',
          'FN:3,real',
          'FNF:1',
          'FNH:1',
          'FNDA:2,real',
          'DA:2,1',
          'end_of_record',
          '',
        ].join('\n'),
      );
      const argv5 = process.argv.slice(2);
      process.argv = [argv5[0], argv5[1], '--authoritative', authInfo5, out5, nodeInfo5, authInfo5];
      main();
      const merged5 = fs5.readFileSync(out5, 'utf8');
      fs5.rmSync(tmp5, { recursive: true, force: true });
      expect(
        '没真跑过的一侧：它的 0 命中函数名不混进分母',
        !/FNDA:0,ghost/.test(merged5) && /FNDA:2,real/.test(merged5),
        `不该混入 --all 的占位函数名：\n${merged5}`,
      );
    }

    // ── 权威侧**无实质覆盖**时不该替换 ─────────────────────────────
    //
    // 有些文件只被 .test.mjs 覆盖（node 侧有真实用例，但行号错位）。
    // 权威侧（coverage-v8）里它不存在 → 若无条件替换，会变成「0% 覆盖」，
    // 比实际更差。所以权威侧 hits 全 0 时，保留另一侧的数据。
    {
      const fs3 = require('node:fs');
      const os3 = require('node:os');
      const p3 = require('node:path');
      const tmp3 = fs3.mkdtempSync(p3.join(os3.tmpdir(), 'maestro-merge-auth0-'));
      const nodeInfo3 = p3.join(tmp3, 'node.info');
      const authInfo3 = p3.join(tmp3, 'auth.info');
      const out3 = p3.join(tmp3, 'out.info');
      fs3.writeFileSync(
        nodeInfo3,
        ['SF:packages/x/src/b.ts', 'DA:7,5', 'end_of_record', ''].join('\n'),
      );
      // 权威侧：同一个文件，但 hits 全 0（它没被 vitest 测到）
      fs3.writeFileSync(
        authInfo3,
        ['SF:packages/x/src/b.ts', 'DA:7,0', 'end_of_record', ''].join('\n'),
      );
      const argv3 = process.argv.slice(2);
      process.argv = [argv3[0], argv3[1], '--authoritative', authInfo3, out3, nodeInfo3, authInfo3];
      main();
      const merged3 = fs3.readFileSync(out3, 'utf8');
      fs3.rmSync(tmp3, { recursive: true, force: true });
      expect(
        '权威侧无实质覆盖：保留另一侧的数据（不被 0% 覆盖掉）',
        merged3.includes('DA:7,5'),
        `合并结果不对：\n${merged3}`,
      );
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures.length > 0) {
    console.error(`❌ merge-lcov 自测失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log('✅ merge-lcov 自测通过（行/分支/函数并集语义）');
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length < 2) {
    console.error('usage: node scripts/merge-lcov.js <output.lcov> <input.lcov>...');
    console.error('       node scripts/merge-lcov.js --self-test');
    process.exit(2);
  }
  // --authoritative <file>：该文件是**权威**的，它覆盖的文件完全替换其它来源
  let authoritative = null;
  let argv = args;
  const ai = args.indexOf('--authoritative');
  if (ai >= 0) {
    authoritative = args[ai + 1];
    argv = [...args.slice(0, ai), ...args.slice(ai + 2)];
  }
  const [outPath, ...inputs] = argv;

  const merged = new Map();
  /** 权威来源覆盖的文件 → 其它来源对这些文件的贡献要丢弃 */
  const authoritativeFiles = new Set();

  const mergeInto = (target, data) => {
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
  };

  // 权威来源**先**处理 → 记录它覆盖了哪些文件
  //
  // ⚠️ **只有权威侧有「实质覆盖」的文件才进 `authoritativeFiles`**（>0 的行/函数命中）。
  //
  // 原因：有些文件**只被 `.test.mjs` 覆盖**（node 侧，有真实用例）。权威侧
  // （coverage-v8）里它不存在 → 如果无条件接管，它会变成「0% 覆盖」——
  // 比实际更差（实际是被测过的）。
  //
  // 所以：权威侧 hits 全 0 → 整个文件**交给非权威侧**处理。
  if (authoritative) {
    if (fs.existsSync(authoritative)) {
      const parsed = parseLcov(fs.readFileSync(authoritative, 'utf8'));
      for (const [file, data] of parsed) {
        const hasRealCoverage =
          [...data.da.values()].some((v) => v > 0) || [...data.fnda.values()].some((v) => v > 0);
        if (!hasRealCoverage) continue; // 权威侧无实质覆盖 → 交给非权威侧
        const target = {
          da: new Map(data.da),
          brda: new Map(data.brda),
          fnda: new Map(data.fnda),
          fn: new Map(data.fn),
        };
        merged.set(file, target);
        authoritativeFiles.add(file);
      }
    } else {
      console.error(`── 跳过缺失的权威覆盖率文件：${authoritative}`);
    }
  }

  for (const input of inputs) {
    if (input === authoritative) continue;
    if (!fs.existsSync(input)) {
      // 某条管线没有产出（没跑到 / 目录被清）→ 跳过，不算失败：
      // 少一份数据只意味着少一些覆盖，不是数据损坏。
      console.error(`── 跳过缺失的覆盖率文件：${input}`);
      continue;
    }
    const parsed = parseLcov(fs.readFileSync(input, 'utf8'));
    for (const [file, data] of parsed) {
      // 权威来源已经给了这个文件 → **行 / 分支 / 函数全部跨侧取并集**
      //
      // ⚠️ 2026-10-24 **改**：原来这里是「行/分支完全替换」（权威侧赢）。
      //    那个规则的前提是「两侧行号坐标系不同」—— **实测已推翻**：
      //    node 的 type-stripping **按原位抹掉类型**（行数不变）→ 行号是准的；
      //    ts-node / coverage-v8 / 浏览器侧本来就有 source map → 行号也是准的。
      //    ⇒ 两侧的第 N 行指的是**同一行** → 取 max 是「更全的真相」。
      //
      //    旧规则的实际后果（实测 24 个文件重叠、**568 条行命中被丢**）：
      //    `spotify-wps.ts` 真实 91%（488/534）被写成 25.8%（138/534）；
      //    `backup-crypto.ts` 真实 99.5%（406/408）被写成 76.7%（313/408）。
      //    → 覆盖率被**低估**；且 diff 门禁会把「`.test.mjs` 确实测过的老代码」
      //    判成「未覆盖」→ **误拦**。
      //
      //    分支同理：BRDA 的 key 是 `行,块,分支` → 同一坐标系 → 并集。
      if (authoritativeFiles.has(file)) {
        // ⚠️ **只从「对该文件有真实覆盖」的一侧并集**：c8 的 `--all` 会给
        //    **从没被执行过**的文件也列一份 0 命中的函数清单，而那些名字是
        //    c8 自己猜的（跟权威侧不一致）→ 混进来会**污染函数分母**
        //    （实测全局 % Funcs 从 88.6% 掉到 87.1%）。
        const target = merged.get(file);
        const sideHasRealCoverage =
          [...data.da.values()].some((v) => v > 0) || [...data.fnda.values()].some((v) => v > 0);
        if (sideHasRealCoverage) {
          // ★ 行级并集：两侧行号同坐标系 → 取 max（详见上面的注释）
          for (const [ln, hits] of data.da) {
            const cur = target.da.get(ln) ?? 0;
            if (hits > cur) target.da.set(ln, hits);
          }
          // ★ 分支级并集：BRDA 的 key 是 `行,块,分支` → 同坐标系 → 并集
          for (const [key, taken] of data.brda) {
            const cur = target.brda.get(key);
            if (cur === undefined) target.brda.set(key, taken);
            else if (cur === -1) target.brda.set(key, taken);
            else if (taken !== -1) target.brda.set(key, Math.max(cur, taken));
          }
          // 函数级并集（函数名是源码标识符，跨转换器稳定）
          for (const [name, hits] of data.fnda) {
            const cur = target.fnda.get(name) ?? 0;
            if (hits > cur) target.fnda.set(name, hits);
            // 权威侧没有这个函数（只被 .test.mjs 那条管线看到）→ 把 FN 补上，
            // 否则会写出一条没有对应 FN 的 FNDA（lcov 格式不完整）。
            if (!target.fn.has(name) && data.fn.has(name)) {
              target.fn.set(name, data.fn.get(name));
            }
          }
        }
        continue;
      }
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
      mergeInto(target, data);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const written = writeLcov(merged);
  fs.writeFileSync(outPath, written);

  // 汇总打印（给人看的）—— **与写出的文件口径一致**（分母只算真实代码行）
  let lf = 0;
  let lh = 0;
  for (const [file, data] of merged) {
    const real = realCodeLines(file);
    for (const [ln, hits] of data.da) {
      if (real && ln <= real.total && !real.set.has(ln)) continue;
      lf += 1;
      if (hits > 0) lh += 1;
    }
  }
  const pct = lf === 0 ? 0 : Math.round((lh / lf) * 10000) / 100;
  console.error(
    `── 合并 ${inputs.length} 份 lcov：${merged.size} 个文件，行覆盖 ${lh}/${lf} = ${pct}%`,
  );
}

main();
