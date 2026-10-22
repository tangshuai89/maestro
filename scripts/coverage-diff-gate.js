#!/usr/bin/env node
/**
 * 覆盖率**diff 门禁**：PR 新增/修改的代码行必须被执行过。
 *
 * ## 为什么不用「全局覆盖率阈值」
 *
 * 全局阈值在 90% 的水位上等于不存在：实测要新增 **21324 行**零覆盖代码才
 * 跌破 60% 阈值（`coverage-gate` 那次评估算过）。也就是说现有门禁拦不住
 * 任何"具体的坏 PR" —— 仓库自己的 workflow 注释早就写了这件事
 * （`.github/workflows/test.yml`：「一个 PR 把某个文件从 80% 拉到 0%，
 * 全局仍然过」），但当时的结论是"挪到每日定时跑"—— 那只是**不看**了，
 * 不是**修好**了。
 *
 * ## 本门禁的判据
 *
 * 1. **新增/修改的代码行未被执行 → 拦**
 *    拿 `git diff -U0 <base>...HEAD` 的新增行号，和 lcov 的 `DA:<line>,<hits>`
 *    求交集。落在交集里、且 `hits=0` 的行 = 「这次改的代码，测试从没跑到」。
 *    - 注释 / 类型声明 / 空行**不在** lcov 的 DA 记录里 → 天然跳过
 *      （c8 的 `--all` 把所有源文件都放进报告，纯类型文件也在，只是没有
 *      可执行语句 → 没有 DA 记录）
 *    - 新增文件从没被任何测试 import → 它不在 lcov 里 → 全部可执行行都算
 *      未覆盖 → 拦（这正是"新增文件必须有测试"）
 * 2. **PR 触碰的文件整体覆盖率 0% → 拦**
 *    兜底：PR 删掉了某个文件的测试（不产生新增行，判据 1 抓不到），
 *    但那个文件的覆盖率会掉到 0% → 拦。
 *
 * ## 为什么不比对「base 分支的覆盖率」
 *
 * 那需要一份 base 的覆盖率数据 —— 要么每次跑两遍套件（+18 分钟），要么在
 * 仓库里存一份基线快照（每次 master 更新都要改它 → 持续的 diff 噪音，
 * 而且基线本身可能已经偏低）。而判据 1 **完全不需要基线**：它问的是
 * "你这次写的代码有没有被跑到"，而不是"你这次写的代码比上次差多少"。
 *
 * 局限（诚实说明）：行覆盖只说明**这行被执行过**，不说明**这行的逻辑被
 * 断言过**。`if (x) { y(); }` 里新增一行 `y()` 而没断言 `y` 的效果，
 * 行覆盖也是 1。要更强的保证得靠 mutation testing —— 那个太慢，放不进
 * PR 门禁。
 *
 * ## 用法
 *
 *   node scripts/coverage-diff-gate.js [--base <ref>] [--lcov <path>]
 *   node scripts/coverage-diff-gate.js --self-test
 *
 *   --base      base 分支/ref（默认 `origin/master`；CI 上传 base sha）
 *   --lcov      lcov.info 路径（默认 `coverage/lcov.info`）
 *   --self-test 跑自测（diff 解析 + 判定语义 + 路径基准）
 *
 *   本地跑：先 `npm run test:ci`（它会插桩并产出 coverage/lcov.info），
 *   再 `npm run coverage:diff-gate -- --base origin/master`。
 *
 * 退出码：0 = 通过；1 = 有未覆盖的新增行 / 触碰的文件掉到 0%；2 = 用法/环境错
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ── 参数 ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { base: 'origin/master', lcov: 'coverage/lcov.info', selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--lcov') out.lcov = argv[++i];
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node scripts/coverage-diff-gate.js [--base <ref>] [--lcov <path>]',
        '       node scripts/coverage-diff-gate.js --self-test',
      );
      process.exit(0);
    }
  }
  return out;
}

// ── git ─────────────────────────────────────────────────────────────
function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

/**
 * 解析 `git diff -U0` 的输出 → 每个文件的新增行号集合。
 *
 * 格式：
 *   @@ -oldStart,oldCount +newStart,newCount @@
 *   - 删除行（只占 old）
 *   + 新增行（占 new）
 *   (空格) 上下文行（同时占 old 和 new）
 *
 * `-U0` 让 hunk 里没有上下文行 → 每个 hunk 的内容全是变更行。
 */
function parseAddedLines(diffText) {
  /** @type {Map<string, Set<number>>} */
  const added = new Map();
  let currentFile = null;
  let newLine = 0;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      // `+++ b/path` —— 新文件路径（`/dev/null` = 新增文件）
      const p = line.slice(4).trim();
      currentFile = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (currentFile && !added.has(currentFile)) added.set(currentFile, new Set());
      continue;
    }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('diff --git ')) {
      currentFile = null;
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      newLine = Number(hunk[3]);
      continue;
    }
    if (!currentFile || newLine === 0) continue;
    if (line.startsWith('+')) {
      added.get(currentFile).add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      /* 删除行不占 new 行号 */
    } else if (line.startsWith('\\')) {
      /* "\ No newline at end of file" */
    } else if (line === '') {
      /* 空行 = 上下文空行（-U0 下不会出现，保险处理）*/
      newLine++;
    }
  }
  return added;
}

// ── lcov ────────────────────────────────────────────────────────────
/** 读 lcov.info → Map<文件, Map<行号, hits>> */
function readLcov(lcovPath) {
  /** @type {Map<string, Map<number, number>>} */
  const files = new Map();
  /** @type {string[]} */
  const duplicates = [];
  if (!fs.existsSync(lcovPath)) return { files, duplicates };
  const text = fs.readFileSync(lcovPath, 'utf8');
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      if (files.has(current)) {
        // ⚠️ 同一文件出现多次 = lcov 里有**多轮采集的数据**（比如手工合并了
        // 两次采集结果）。静默合并会让后一轮的 0 覆盖把前一轮盖掉 → 门禁
        // 拿到的数字是错的。明确报出来，不硬判。
        duplicates.push(current);
        continue;
      }
      files.set(current, new Map());
    } else if (line.startsWith('DA:') && current) {
      const [ln, hits] = line.slice(3).split(',');
      const n = Number(ln);
      const h = Number(hits);
      if (Number.isFinite(n)) files.get(current)?.set(n, Number.isFinite(h) ? h : 0);
    } else if (line.startsWith('end_of_record')) {
      current = null;
    }
  }
  return { files, duplicates };
}

/**
 * diff 的 pathspec —— 只看 packages/<包>/src/ 下的源文件。
 *
 * ⚠️ 末尾必须带 `**` —— 写成 `packages/<通配>/src/`（少一段）就匹配不到任何
 * 东西（git 的 pathspec 里 `*` 不跨 `/`）。实测踩过：改短之后 diff 恒为空
 * → 门禁**永远通过**（最坏的失败模式：看起来在把关，其实没有）。
 *
 * ⚠️ 注释里别直接写那条 pathspec —— 里面的 `*` + `/` 组合会提前闭合块注释。
 */
const DIFF_PATHSPEC = ['packages/*/src/**'];

// ── 主流程 ──────────────────────────────────────────────────────────
/**
 * 从 lcov 的 `SF:` 路径里认出「包名」。
 *
 * ⚠️ 路径基准有两种（实测踩过）：
 *   - `packages/server/src/music/x.ts`（从仓库根跑 report —— 本脚本的用法）
 *   - `src/music/x.ts`（从 `packages/server` 目录内跑 report —— 手搓采集会这样）
 *
 * 第二种**推不出包名**（路径里已经没有包这一层了）→ 返回 '' 表示"认不出"。
 * 护栏据此判断"这份 lcov 的基准和仓库根不一致" → 明确要求重采，
 * 而不是拿它硬判（那会产生一堆误报，把人引向错误的方向）。
 */
function pkgOf(f) {
  const parts = f.split('/');
  if (parts[0] === 'packages' && parts[1]) return parts[1];
  return ''; // 基准不一致 → 认不出
}

/**
 * 判定（函数级，主判据）：新增代码所在的**函数**有没有被执行过。
 *
 * ## 为什么以函数级为主
 *
 * 行级覆盖只在**有 source map** 的采集里可信（见 collect-line-coverage-trust.js
 * 的说明）：ts-node 跑的那部分（server/common/electron）有；node 直跑 .mjs 和
 * vitest 跑的那部分（**renderer**）没有 → 它们的 DA 行号是**错位**的。
 *
 * 实测反例（2026-10-21）：一个**从未被调用**的函数，它的函数体各行 DA hits
 * 却是 170（模块顶层语句的次数）；而同一函数里**必然执行**的 `setCurrentTime(0)`
 * hits 却是 0。拿这种数据判「新增代码有没有被测到」会**漏报**（未覆盖的新代码
 * 看起来已覆盖）甚至**误报**。
 *
 * 函数名是**源码标识符**，不随转换器的字节布局变化 → 跨管线、跨 entry 都稳定。
 * 实测：从未被调用的探针函数，FNDA 精确地是 0 ✓
 *
 * 代价（诚实说明）：函数被调用过 ≠ 函数体每一行都被走到。所以这个判据
 * **抓不到**「在已有函数里加了一个没走到的分支」。那种情况靠**行级**判据补，
 * 而行级只在可信的文件上用。
 *
 * @param added       Map<文件, 新增行号集合>
 * @param fnByLine    Map<文件, Map<行号, 函数名>>（新增行 → 所属函数）
 * @param fnCounts    Map<函数名, 执行次数>
 * @returns Map<文件, string[]>  文件 → 未被执行的新函数名列表
 */
function judgeNewFunctions(added, fnByLine, fnCounts) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const [file, lines] of added) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (!/(^|\/)src\//.test(file)) continue;
    if (/\.d\.ts$/.test(file)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(file)) continue;
    const map = fnByLine.get(file);
    if (!map) continue;
    const badFns = new Set();
    for (const ln of lines) {
      const fn = map.get(ln);
      if (!fn) continue; // 顶层语句 → 模块加载时必然执行 → 不算
      if ((fnCounts.get(fn) ?? 0) === 0) badFns.add(fn);
    }
    if (badFns.size > 0) out.set(file, [...badFns].sort());
  }
  return out;
}

/**
 * 判定：哪些新增/修改行没被执行过。
 *
 * ⚠️ **主流程和自测必须调同一个函数** —— 自测里再写一份实现的话，
 * 自测就测的是**副本**不是真身：把主流程的判据改坏，自测照样绿
 * （实测踩过：把 `hits === 0` 改成 `false`，自测毫无反应）。
 *
 * @param added  Map<文件, 新增行号集合>
 * @param lcov   Map<文件, Map<行号, hits>>
 * @returns Map<文件, {lines: number[], missing: boolean}>
 *          missing=true → 整个文件不在 lcov 里（新增文件从未被 import）
 */
function judgeAddedLines(added, lcov, trusted) {
  /** @type {Map<string, {lines: number[], missing: boolean}>} */
  const out = new Map();
  for (const [file, lines] of added) {
    // 只关心有可执行代码的源文件
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (!/(^|\/)src\//.test(file)) continue;
    // 类型声明文件不是可执行代码（c8 的 --exclude=**/*.d.ts 也排除了它们）
    if (/\.d\.ts$/.test(file)) continue;
    // 测试文件本身不算（它们不在 lcov 里 —— 被 --exclude 排除了）
    if (/\.test\.(ts|tsx|mjs)$/.test(file)) continue;

    const da = lcov.get(file);
    if (!da) {
      // 文件完全不在 lcov 里 → 这次新增的文件从没被任何测试 import
      out.set(file, { lines: [...lines].sort((a, b) => a - b), missing: true });
      continue;
    }
    // ⚠️ 该文件的**行覆盖不可信** → 不用行级判据（函数级判据覆盖了它）。
    //
    // 行级数据在缺 source map 的采集里是**错位**的：c8 拿转换后 JS 的字节偏移
    // 去切源文件 → 行号随机（但 DA 条目数 = 源文件行数，看起来「对齐」）。
    // 实测反例：一个**从未被调用**的函数，其函数体各行 DA hits 却是 170。
    if (trusted && !trusted.has(file)) continue;
    const bad = [...lines].filter((ln) => {
      const hits = da.get(ln);
      // 不在 DA 记录里 = 不可执行行（注释/类型声明/空行）→ 跳过
      if (hits === undefined) return false;
      return hits === 0;
    });
    if (bad.length === 0) continue;
    out.set(file, { lines: bad.sort((a, b) => a - b), missing: false });
  }
  return out;
}

/**
 * 判定 2：PR 触碰的文件里，整体覆盖率掉到 0% 的那些。
 *
 * 兜底判据 1 抓不到的情况：PR **删掉了**某个文件的测试（不产生新增行，
 * 判据 1 无从下手），但那个文件的覆盖率会掉到 0%。
 *
 * ⚠️ 同样必须和主流程共用实现 —— 自测里另写一份的话，判据改坏了自测
 * 测不出来（和判据 1 踩过的同一个坑）。
 */
function judgeZeroCoverageFiles(added, lcov) {
  /** @type {string[]} */
  const zeroFiles = [];
  for (const file of added.keys()) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (!/(^|\/)src\//.test(file)) continue;
    if (/\.d\.ts$/.test(file)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(file)) continue;
    const da = lcov.get(file);
    if (!da) continue; // 判据 1 已经报了
    const total = da.size;
    const covered = [...da.values()].filter((h) => h > 0).length;
    if (total > 0 && covered === 0) {
      zeroFiles.push(file);
    }
  }
  return zeroFiles;
}

/**
 * 自测：用构造的 diff + lcov 验证门禁判据。
 *
 * 为什么需要：「一个永远通过的检查脚本可能只是因为规则写错而永远通过」。
 * 这个门禁的价值全在「能拦住」，所以必须**证明它能拦**。
 */
function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // ── 1. diff 解析 ────────────────────────────────────────────────
  const diff = [
    'diff --git a/packages/server/src/a.ts b/packages/server/src/a.ts',
    '--- a/packages/server/src/a.ts',
    '+++ b/packages/server/src/a.ts',
    '@@ -10,0 +11,3 @@',
    '+const a = 1;',
    '+const b = 2;',
    '+',
    '@@ -30,2 +33,1 @@',
    ' keep',
    '-removed',
    '+added2',
    'diff --git a/packages/server/src/b.ts b/packages/server/src/b.ts',
    '--- a/packages/server/src/b.ts',
    '+++ b/packages/server/src/b.ts',
    '@@ -1,0 +2,1 @@',
    '+const c = 3;',
  ].join('\n');
  const added = parseAddedLines(diff);
  expect(
    'diff 解析：a.ts 新增行 = 11,12,13（第一个 hunk）+ 33（第二个 hunk）',
    JSON.stringify([...added.get('packages/server/src/a.ts')]) === '[11,12,13,33]',
  );
  expect('diff 解析：a.ts 第二个 hunk = 33', added.get('packages/server/src/a.ts').has(33));
  expect('diff 解析：b.ts 新增行 = 2', added.get('packages/server/src/b.ts').has(2));

  // ── 2. 判定逻辑（调**真身**，不是副本）────────────────────────────
  // a.ts：11/12 未覆盖，13 是注释（不在 DA 里）
  // b.ts：整个文件不在 lcov 里（新增文件从未被 import）
  const lcov = new Map([
    [
      'packages/server/src/a.ts',
      new Map([
        [10, 5],
        [11, 0],
        [12, 0],
        [14, 3],
      ]),
    ],
  ]);

  const r1 = judgeAddedLines(added, lcov);
  expect(
    '判定：a.ts 报出未覆盖的 11,12（13 是注释 → 跳过）',
    JSON.stringify(r1.get('packages/server/src/a.ts')?.lines) === '[11,12]',
  );
  expect(
    '判定：b.ts 标为 missing（新增文件从未被 import）',
    r1.get('packages/server/src/b.ts')?.missing === true,
  );

  // ── 3. 全部覆盖时不该报 ─────────────────────────────────────────
  const lcovAll = new Map([
    [
      'packages/server/src/a.ts',
      new Map([
        [11, 1],
        [12, 1],
        [13, 1],
        [33, 1],
      ]),
    ],
    [
      'packages/server/src/b.ts',
      new Map([[2, 1]]),
    ],
  ]);
  const r2 = judgeAddedLines(added, lcovAll);
  expect('判定：全覆盖时不报', r2.size === 0);

  // ── 4. 判据的「反面」必须成立（变异测试的等价物）─────────────────
  // 如果把 `hits === 0` 改成 `false`（永远不报未覆盖），这里必须失败。
  const lcovMutant = new Map([
    [
      'packages/server/src/a.ts',
      new Map([
        [11, 0],
        [12, 0],
      ]),
    ],
  ]);
  const rMutant = judgeAddedLines(added, lcovMutant);
  expect(
    '判定反面：全是 hits=0 的新增行必须被报出来（判据写坏时这里要红）',
    (rMutant.get('packages/server/src/a.ts')?.lines.length ?? 0) > 0,
  );

  // ── 5. pkgOf 的路径基准 ─────────────────────────────────────────
  expect('pkgOf：packages 前缀', pkgOf('packages/server/src/a.ts') === 'server');
  expect('pkgOf：非 packages 前缀 → 认不出', pkgOf('src/a.ts') === '');

  // ── 6. 重复文件检测（多轮采集混在一起）─────────────────────────
  {
    const fs = require('node:fs');
    const os = require('node:os');
    const p = require('node:path');
    const tmp = fs.mkdtempSync(p.join(os.tmpdir(), 'maestro-gate-selftest-'));
    const dup = p.join(tmp, 'dup.info');
    fs.writeFileSync(
      dup,
      [
        'SF:packages/server/src/a.ts',
        'DA:1,1',
        'end_of_record',
        'SF:packages/server/src/a.ts',
        'DA:1,0',
        'end_of_record',
        '',
      ].join('\n'),
    );
    const r = readLcov(dup);
    expect('重复文件检测：应报出 1 个重复', r.duplicates.length === 1);
    expect('重复文件检测：重复项是那个文件', r.duplicates[0] === 'packages/server/src/a.ts');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 6b. diff pathspec 必须真的能匹配到 src/ 下的文件 ───────────────
  //
  // ⚠️ 踩过的坑：pathspec 写成 `packages/<通配>/src/`（少一段 `**`）→ diff
  // 恒为空 → 门禁**永远通过** —— 最坏的失败模式（看起来在把关，其实没有）。
  //
  // 验证方式：`git ls-files <pathspec>`（列**已跟踪**的文件，不依赖任何
  // commit 的 diff 内容）→ 必须能列出一堆 src/ 下的源文件。
  {
    const { execFileSync } = require('node:child_process');
    let listed = '';
    try {
      listed = execFileSync('git', ['ls-files', ...DIFF_PATHSPEC], { encoding: 'utf8' });
    } catch {
      listed = '';
    }
    const files = listed.split('\n').filter(Boolean);
    expect(
      'pathspec 能匹配到 src/ 下的源文件（否则门禁永远通过 = 最坏的失败模式）',
      files.length > 10,
      `只匹配到 ${files.length} 个文件 —— 门禁会永远放过！`,
    );
    expect(
      'pathspec 匹配到的都是 src/ 下的文件',
      files.every((f) => f.includes('/src/')),
      '匹配到了 src/ 之外的文件',
    );
  }

  // ── 6c. 判据 2（文件掉到 0%）────────────────────────────────────
  {
    const added2 = new Map([
      ['packages/server/src/zeroed.ts', new Set([5])],
      ['packages/server/src/partial.ts', new Set([5])],
      ['packages/server/src/ok.ts', new Set([5])],
    ]);
    const lcov2 = new Map([
      ['packages/server/src/zeroed.ts', new Map([[1, 0], [2, 0]])],
      ['packages/server/src/partial.ts', new Map([[1, 0], [2, 3]])],
      ['packages/server/src/ok.ts', new Map([[1, 5], [2, 2]])],
    ]);
    const z = judgeZeroCoverageFiles(added2, lcov2);
    expect('判据 2：全覆盖为 0 的文件被报出', z.includes('packages/server/src/zeroed.ts'));
    expect('判据 2：部分覆盖的不报', !z.includes('packages/server/src/partial.ts'));
    expect('判据 2：有覆盖的不报', !z.includes('packages/server/src/ok.ts'));
  }

  // ── 6d. 函数级判据（主判据）─────────────────────────────────────
  //
  // 函数名是源码标识符 → 跨转换管线稳定 → 行级数据错位时唯一可靠的信号。
  {
    const added2 = new Map([
      ['packages/server/src/a.ts', new Set([10, 11, 20])],
    ]);
    // 10/11 在 `neverCalled` 里（FNDA=0）→ 报；20 在 `called` 里（FNDA=3）→ 不报
    const fnByLine2 = new Map([
      [
        'packages/server/src/a.ts',
        new Map([
          [10, 'neverCalled'],
          [11, 'neverCalled'],
          [20, 'called'],
        ]),
      ],
    ]);
    const fnda2 = new Map([
      ['neverCalled', 0],
      ['called', 3],
    ]);
    const r = judgeNewFunctions(added2, fnByLine2, fnda2);
    expect(
      '函数级判据：未被调用的新函数被报出',
      JSON.stringify(r.get('packages/server/src/a.ts')) === '["neverCalled"]',
    );
    expect(
      '函数级判据：被调用过的新函数不报',
      !JSON.stringify(r.get('packages/server/src/a.ts')).includes('called"'),
    );
  }

  // ── 6e. 行级判据只对「可信文件」生效 ─────────────────────────────
  //
  // 行覆盖在 renderer 上是**错位**的（见 collect-line-coverage-trust.js）。
  // 不可信的文件必须**跳过行级判据** —— 否则未覆盖的新代码看起来已覆盖
  // （漏报），或者反过来误报。
  {
    const added2 = new Map([['packages/server/src/a.ts', new Set([5])]]);
    const lcov2 = new Map([['packages/server/src/a.ts', new Map([[5, 0]])]]);
    const trusted2 = new Set(['packages/server/src/a.ts']);

    const withTrust = judgeAddedLines(added2, lcov2, trusted2);
    expect('行级判据：可信文件 → 报出未覆盖行', withTrust.has('packages/server/src/a.ts'));

    const withoutTrust = judgeAddedLines(added2, lcov2, new Set());
    expect(
      '行级判据：不可信文件 → 跳过（不误报）',
      !withoutTrust.has('packages/server/src/a.ts'),
    );
  }

  // ── 7. 不该被门禁管的文件类型 ───────────────────────────────────
  //
  // 配置文件（vite.config.ts 等）和类型声明（.d.ts）**不在 lcov 里**（c8 的
  // --src 只指向各包的 src/，--exclude 排除了 .d.ts）→ 如果门禁把它们算进来，
  // 改个构建配置就会被判成「新增文件从未被任何测试 import」→ **误拦**。
  {
    const junk = judgeAddedLines(
      new Map([
        ['packages/renderer/vite.config.ts', new Set([1, 2, 3])],
        ['packages/server/src/music/kuromoji.d.ts', new Set([1, 2])],
        ['packages/server/src/real.ts', new Set([1])],
      ]),
      new Map(),
    );
    expect('不该被管的：vite.config.ts 被跳过', !junk.has('packages/renderer/vite.config.ts'));
    expect('不该被管的：.d.ts 被跳过', !junk.has('packages/server/src/music/kuromoji.d.ts'));
    expect('该被管的：普通源文件仍被报', junk.has('packages/server/src/real.ts'));
  }

  if (failures.length > 0) {
    console.error(`❌ coverage-diff-gate 自测失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log('✅ coverage-diff-gate 自测通过（diff 解析 + 判定语义 + 路径基准）');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
    return;
  }

  // base 必须存在 —— 拿不到 diff 就**明确失败**，不能默默放过。
  // 静默放过 = 门禁形同虚设（这正是旧门禁的毛病）。
  const baseCheck = git(['rev-parse', '--verify', `${args.base}^{commit}`], true);
  if (baseCheck === null) {
    console.error(
      `❌ 拿不到 base ref「${args.base}」—— 无法算 diff。\n` +
        `   CI 上要 fetch-depth: 0（或至少 fetch base）。\n` +
        `   拿不到 base 就**不判**（静默放过 = 门禁形同虚设）。`,
    );
    process.exit(2);
  }

  // 只看 packages/<包>/src/ 下的源文件 —— 那是覆盖率数据覆盖的范围。
  //
  // ⚠️ 早先只过滤 `-- packages/`（整个目录）→ 把 `packages/renderer/vite.config.ts`
  // 这种**不在 src/ 下**的文件也算了进来。而配置文件不在 lcov 里（c8 的
  // `--src` 只指向各包的 src/）→ 改了配置就被判成「新增文件从未被任何测试
  // import」→ **误拦**。这类文件本来就不该由覆盖率门禁管（它们是构建配置，
  // 不是运行时代码）。
  //
  // ⚠️ pathspec 末尾必须带 `**`（见 DIFF_PATHSPEC 的说明）。
  const diffText = git([
    'diff',
    '-U0',
    `${args.base}...HEAD`,
    '--',
    ...DIFF_PATHSPEC,
  ]);
  if (!diffText) {
    console.log('── diff 为空（本次 PR 没改 packages/ 下的文件）→ 跳过 ──');
    process.exit(0);
  }

  const added = parseAddedLines(diffText);
  const { files: lcov, duplicates } = readLcov(args.lcov);
  if (lcov.size === 0) {
    console.error(
      `❌ 读不到覆盖率数据（${args.lcov}）。\n` +
        `   门禁需要**同一次执行**产出的 lcov —— 跑「跑两遍套件」的架构会产出\n` +
        `   自相矛盾的数字（某个测试文件挂了 → 覆盖率塌成假洞）。`,
    );
    process.exit(2);
  }
  if (duplicates.length > 0) {
    console.error(
      `❌ lcov 里有 ${duplicates.length} 个文件出现**多次**（例：${duplicates[0]}）。\n` +
        `   → 这份 lcov 混了**多轮采集**的数据。后一轮的 0 覆盖会把前一轮盖掉\n` +
        `   → 门禁拿到的数字是错的。\n` +
        `   → 用**一次**采集产出的 lcov（scripts/test.sh --ci 会自动处理）。`,
    );
    process.exit(2);
  }

  // ── 数据完整性护栏 ─────────────────────────────────────────────
  //
  // 门禁的判据是「新增行在**全量**覆盖率数据里有没有被命中」。如果 lcov
  // 只覆盖了部分包（比如只跑了 server 的测试），那 renderer / electron 的
  // 文件会**整个不在 lcov 里** → 全部可执行行都被判成"未覆盖" → 一堆
  // 误报，而且报错信息会把人引向"我的代码怎么没被测"而不是"覆盖率数据不全"。
  //
  // 所以：本次改动涉及的每个包，都必须在 lcov 里有**至少一个**文件。
  // 缺了就明确说"数据不全"，而不是硬判。
  const changedPkgs = new Set();
  for (const f of added.keys()) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    if (/\.test\.(ts|tsx|mjs)$/.test(f)) continue;
    changedPkgs.add(pkgOf(f));
  }
  const lcovPkgs = new Set([...lcov.keys()].map(pkgOf).filter(Boolean));
  const missingPkgs = [...changedPkgs].filter((p) => !lcovPkgs.has(p));
  if (missingPkgs.length > 0) {
    // 分两种情况报 —— 错误信息要指向**正确的方向**：
    const baseMismatch = lcovPkgs.size === 0;
    console.error(
      baseMismatch
        ? `❌ 覆盖率数据的**路径基准不对**：lcov 里的文件路径不是「packages/<包>/src/...」\n` +
            `   形式（第一项：${[...lcov.keys()][0]}）。\n` +
            `   → 这份 lcov 是从某个包目录内部采集的，不能拿来和 git diff 对照。\n` +
            `   → 请从**仓库根**跑采集（scripts/test.sh --ci 会自动处理）。`
        : `❌ 覆盖率数据不完整：本次改动涉及包 [${[...changedPkgs].join(', ')}]，\n` +
            `   但 lcov 里没有包 [${missingPkgs.join(', ')}] 的任何文件。\n` +
            `   → 这份 lcov 不是**全量**采集的，用它判门禁会产生大量误报。\n` +
            `   → 门禁需要「同一次执行跑完全部测试套件」产出的 lcov。`,
    );
    process.exit(2);
  }

  // ── 判定 1（函数级，主判据）：新增代码所在的函数没被执行过 ────────
  // 调**共享**的 judgeNewFunctions（自测也调它）。
  const fnByLine = buildFunctionByLine(added);
  const untestedFns = judgeNewFunctions(added, fnByLine, fnCounts);

  // ── 判定 2（行级）：新增行未被执行 ────────────────────────────────
  // ⚠️ **只对「行覆盖可信」的文件启用**。
  //
  // 行级覆盖需要 source map 才能把 V8 的字节偏移映射回源码行。没有 source map
  // 时（renderer 的两条采集路径都没有 —— 见 collect-line-coverage-trust.js 的
  // 说明），c8 拿**转换后 JS 的字节偏移**去切**源文件** → 行号是**随机的**，
  // 但因为切的是完整源文件，DA 条目数 = 源文件行数，**看起来「对齐」**。
  //
  // 实测反例：一个**从未被调用**的函数，它的函数体各行 DA hits 却是 170；
  // 而同一函数里**必然执行**的 `setCurrentTime(0)` hits 却是 0。
  // 拿这种数据判「新增代码有没有被测到」→ **漏报**（未覆盖的新代码看起来已覆盖）。
  const trusted = readTrustedFiles(args.trust);
  const uncoveredByFile = judgeAddedLines(added, lcov, trusted);
  let totalUncovered = 0;
  for (const info of uncoveredByFile.values()) totalUncovered += info.lines.length;

  // ── 判定 3：触碰的文件整体覆盖率 0% ─────────────────────────────
  // 调**共享**的 judgeZeroCoverageFiles（自测也调它）。
  const zeroFiles = judgeZeroCoverageFiles(added, lcov);

  // ── 报告 ────────────────────────────────────────────────────────
  console.log('── 覆盖率 diff 门禁 ──────────────────────────────────────');
  console.log(`   base    : ${args.base}`);
  console.log(`   lcov    : ${args.lcov}（${lcov.size} 个文件）`);
  console.log(`   改动文件: ${added.size} 个（packages/ 下）`);

  if (uncoveredByFile.size === 0 && zeroFiles.length === 0 && untestedFns.size === 0) {
    console.log('   ✅ 本次改动的代码全部被执行过');
    process.exit(0);
  }

  if (untestedFns.size > 0) {
    console.log('');
    console.log(`   ⚠️  ${untestedFns.size} 个文件里有**从未被执行过**的新增函数：`);
    for (const [file, fns] of untestedFns) {
      console.log(`     · ${file}: ${fns.join(', ')}`);
    }
    console.log('   （新增的函数从没被调用过 → 那段代码一行都没跑过）');
  }

  if (uncoveredByFile.size > 0) {
    console.log('');
    console.log(`   ⚠️  ${uncoveredByFile.size} 个文件里有未覆盖的新增/修改行：`);
    for (const [file, info] of uncoveredByFile) {
      const head = info.missing
        ? `（新增文件，从未被任何测试 import → 全部 ${info.lines.length} 行可执行代码未覆盖）`
        : `（${info.lines.length} 行）`;
      console.log(`     · ${file} ${head}`);
      const show = info.lines.slice(0, 20);
      console.log(`         行号: ${show.join(', ')}${info.lines.length > show.length ? ' …' : ''}`);
    }
    console.log('');
    console.log(
      '   说明：行覆盖只说明**这行被执行过**，不说明**这行的逻辑被断言过**。',
    );
    console.log('         要更强的保证得靠 mutation testing（太慢，放不进 PR 门禁）。');
  }

  if (zeroFiles.length > 0) {
    console.log('');
    console.log(`   ⚠️  ${zeroFiles.length} 个被改动的文件覆盖率掉到 0%：`);
    for (const f of zeroFiles) console.log(`     · ${f}`);
    console.log('   （通常是 PR 删掉了该文件的测试 —— 上面判据 1 抓不到这种）');
  }

  console.log('');
  console.log('── ❌ 覆盖率 diff 门禁未通过 ──');
  process.exit(1);
}

main();
