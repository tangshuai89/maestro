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
 * ## 「权威输入」：行号坐标系不同的两份数据**不能取 max**
 *
 * ⚠️ 取 max 的前提是**两份数据的行号指的是同一件事**。
 *
 * 实际情况：同一个源文件可能被**两种转换管线**覆盖 ——
 *   - `node` 直跑 `.test.mjs`（node 自己的 type-stripping，**无 source map**）
 *     → c8 拿转换后 JS 的字节偏移去切源 .ts 文件 → **行号随机**
 *   - `vitest` + `@vitest/coverage-v8`（走 vite 的 transform 链，**有 source map**）
 *     → 行号正确
 *
 * 这两份的「第 100 行」**根本不是同一行** → 取 max = **污染**（把随机值
 * 和真值混在一起），不是「更全的覆盖」。
 *
 * 所以加了 `--authoritative <file>`：被指定的那份是**权威**的，它覆盖的
 * 文件**完全替换**其它来源的数据（不是取 max）。其它来源只贡献它**没有**的
 * 文件。
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
    const expectAuth =
      merged.includes('DA:5,0') && merged.includes('DA:9,4') && !merged.includes('DA:5,9');
    fs2.rmSync(tmp2, { recursive: true, force: true });
    expect(
      '权威输入：同名文件被**完全替换**（不是取 max）',
      expectAuth,
      `合并结果不对：\n${merged}`,
    );

    // ── 权威文件：**函数级跨侧并集**（行仍然只用权威侧）────────────
    //
    // 行号会平移（node 侧独有文件的命中行有 29.7% 落在注释/空行上）→ 行不能混。
    // 但**函数名是源码标识符**、跨转换器稳定 → FNDA 可以跨侧取 max：
    // 「这个函数跑没跑过」的真相是两条管线的并集，整文件替换会把它丢掉
    // （实测丢了 22 个真跑过的函数 → 门禁对它们误判「从未执行」→ 假红）。
    {
      const fs4 = require('node:fs');
      const os4 = require('node:os');
      const p4 = require('node:path');
      const tmp4 = fs4.mkdtempSync(p4.join(os4.tmpdir(), 'maestro-merge-fnunion-'));
      const nodeInfo4 = p4.join(tmp4, 'node.info');
      const authInfo4 = p4.join(tmp4, 'auth.info');
      const out4 = p4.join(tmp4, 'out.info');
      // node 侧（行错位）：第 5 行命中；函数 g 跑过（2 次）
      fs4.writeFileSync(
        nodeInfo4,
        [
          'SF:packages/x/src/a.ts',
          'FN:3,g',
          'FNF:1',
          'FNH:1',
          'FNDA:2,g',
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
      expect(
        '权威文件：行仍然只用权威侧（node 侧的错位行不混进来）',
        merged4.includes('DA:9,4') && !merged4.includes('DA:5,9'),
        `行不该跨侧混合：\n${merged4}`,
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
  // ⚠️ **只有权威侧有「实质覆盖」的文件才替换**（>0 的行/函数命中）。
  //
  // 原因：有些文件**只被 `.test.mjs` 覆盖**（node 侧，有 16 个真实用例，但
  // 行号错位）。权威侧（coverage-v8）里它不存在 → 如果无条件替换，它会
  // 变成「0% 覆盖」—— 比实际更差（实际是被测过的）。
  //
  // 所以：权威侧 hits 全 0 → 保留另一侧的数据（并在报告里标注该文件
  // 的行覆盖**不可信**）；权威侧有实质命中 → 完全替换（它的行号是对的，
  // 另一侧的随机行号必须丢弃，否则是污染）。
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
      // 权威来源已经给了这个文件 → **行/分支完全替换**，不取 max
      // （两份的行号坐标系不同，取 max = 污染）
      if (authoritativeFiles.has(file)) {
        // ⚠️ **但函数级（FNDA）可以跨侧并集** ——
        //
        // 行号会平移（node 的类型剥离会删掉纯类型行 → 命中行整体偏移，
        // 实测 node 独有文件的命中行有 **29.7% 落在注释/空行上**），
        // 所以行数据不能跨侧混合。
        //
        // 但**函数名是源码标识符**、不随转换器变 → FNDA 可以跨侧取 max：
        // 同一个源文件被两条管线覆盖时，「这个函数跑没跑过」的真相是
        // **两条管线的并集**。整文件替换会把这个真相丢掉 ——
        // 实测丢了 **22 个函数**（backup-crypto 的 5 个加解密函数、
        // spotify-wps 的 4 个、降级链的 pickFallbackSource/pickUpgradeSource…），
        // 它们**确实被 .test.mjs 测过**，却因为权威侧（vitest 那条管线）
        // 没跑到而显示 0 覆盖 → diff 门禁会把「改了这些函数」误判成
        // 「新增的函数从没被执行过」→ **假红**。
        //
        // ⚠️ **只从「对该文件有真实覆盖」的一侧并集**：c8 的 `--all` 会给
        //    **从没被执行过**的文件也列一份 0 命中的函数清单，而那些名字是
        //    c8 自己猜的（跟权威侧不一致）→ 混进来会**污染函数分母**
        //    （实测全局 % Funcs 从 88.6% 掉到 87.1%）。
        const target = merged.get(file);
        const sideHasRealCoverage =
          [...data.da.values()].some((v) => v > 0) || [...data.fnda.values()].some((v) => v > 0);
        if (sideHasRealCoverage) {
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
