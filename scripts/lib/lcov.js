'use strict';
/**
 * scripts/lib/lcov.js —— lcov 解析 + 「行级可信」判定的**唯一真源**。
 *
 * ## 为什么要有这个模块
 *
 * 2026-10-24 之前，仓库里有**三份** lcov 解析实现（`merge-lcov.js` /
 * `lcov-summary.js` / `coverage-diff-gate.js`），而且**三份行为都不一样**：
 *
 * | | 同一文件出现多次时 | 解析 FN: | 「行级可信」的判据 |
 * |---|---|---|---|
 * | `merge-lcov.js` | 取 max | ✅ | 信任清单 |
 * | `lcov-summary.js` | **后者覆盖前者** | ❌ | 信任清单 |
 * | `coverage-diff-gate.js` | 保留第一个 + 报错 | ❌ | 信任清单 |
 *
 * 「后者覆盖前者」最危险：后一轮采集的 0 覆盖会把前一轮盖掉 → 报告的数字
 * 直接是错的。而三份判据各写各的 → 「报告说可信、门禁说不可信」这类矛盾
 * 无法避免。
 *
 * ⇒ 合并成一份，**判据也合并成一份**。
 *
 * ## 「行级可信」的判据（2026-10-24 统一）
 *
 * 1. **在「行覆盖可信清单」里** → 可信。
 *    清单由 `scripts/collect-line-coverage-trust.js` 生成 = node 侧出现在 V8
 *    覆盖结果里的文件 ∪ coverage-v8 的产物 ∪ 浏览器侧。
 *    （node 的 type-stripping **按原位抹掉类型** → 行位置完整保留 → 行号是准的，
 *    见 `specs/stability/tasks.md` H16。）
 *
 * 2. **全部 0 命中** → **也算可信**。
 *    ⚠️ 这条是「覆盖率总数虚高 1.46pp」的修复（P2）：
 *    c8 的 `--all` 会把**从没被加载过**的文件也列进 lcov（DA 条目 = 1..N
 *    连续的**真实源文件行**，实测行号是准的），它们是 0% 覆盖。
 *    「0%」这个**结论**是真的 → **必须按 0% 计入分母**。
 *    否则「新增一个从没被测过的文件」**完全不影响总数** → 覆盖率在骗人。
 *
 * 3. 其余 → 不可信（行号不可信 → 行级数字不能当真值）。
 *
 * ⚠️ 判据 2 之前**不存在**，于是「不可信」这个桶被理解成「行号是错位的」——
 *    H16 之后不成立了：不可信 = 「有命中、但行号不可信」，而
 *    「从没被加载」的那批（全 0 命中）现在归入可信桶。
 */

const fs = require('node:fs');

/**
 * @typedef {{da: Map<number, number>, brda: Map<string, number>, fnda: Map<string, number>, fn: Map<string, number>}} FileCov
 */

/**
 * 解析一份 lcov.info。
 *
 * ⚠️ **同一文件出现多次**时：保留**第一个**块，后续块**整体丢弃**并记进
 *    `duplicates`。
 *    - 不是「后者覆盖前者」：那会让后一轮采集的 0 覆盖把前一轮盖掉 → 数字是错的。
 *    - 不是「取 max」：那会**掩盖**「这份 lcov 混了多轮采集」这个异常。
 *    保留第一个 + 明确报出来 = 数据是「第一个」那份（确定的），异常也不被藏。
 *
 * @param {string} text
 * @returns {{files: Map<string, FileCov>, duplicates: string[]}}
 */
function parseLcov(text) {
  /** @type {Map<string, FileCov>} */
  const files = new Map();
  /** @type {string[]} */
  const duplicates = [];
  /** @type {FileCov | null} */
  let current = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const file = line.slice(3).trim();
      if (files.has(file)) {
        duplicates.push(file);
        current = null; // 重复块的行不归到第一个块上
        continue;
      }
      current = { da: new Map(), brda: new Map(), fnda: new Map(), fn: new Map() };
      files.set(file, current);
      continue;
    }
    if (line.startsWith('end_of_record')) {
      current = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('DA:')) {
      // DA:<line>,<hits>[,<checksum>]
      const [ln, hits] = line.slice(3).split(',');
      const n = Number(ln);
      const h = Number(hits);
      if (!Number.isFinite(n)) continue;
      current.da.set(n, Number.isFinite(h) ? h : 0);
    } else if (line.startsWith('BRDA:')) {
      // BRDA:<line>,<block>,<branch>,<taken>
      const parts = line.slice(5).split(',');
      if (parts.length < 4) continue;
      const key = `${parts[0]},${parts[1]},${parts[2]}`;
      const taken = parts[3] === '-' ? 0 : Number(parts[3]);
      current.brda.set(key, Number.isFinite(taken) ? taken : 0);
    } else if (line.startsWith('FNDA:')) {
      // FNDA:<hits>,<name> —— name 里可能带逗号 → 只在剥掉前缀后找第一个逗号
      const rest = line.slice(5);
      const idx = rest.indexOf(',');
      if (idx < 0) continue;
      const hits = Number(rest.slice(0, idx));
      const name = rest.slice(idx + 1);
      current.fnda.set(name, Number.isFinite(hits) ? hits : 0);
    } else if (line.startsWith('FN:')) {
      // FN:<line>,<name>
      const rest = line.slice(3);
      const idx = rest.indexOf(',');
      if (idx < 0) continue;
      const ln = Number(rest.slice(0, idx));
      const name = rest.slice(idx + 1);
      current.fn.set(name, Number.isFinite(ln) ? ln : 0);
    }
  }
  return { files, duplicates };
}

/**
 * 读一份 lcov.info 并解析。
 * @param {string} lcovPath
 * @returns {{files: Map<string, FileCov>, duplicates: string[]}}
 */
function readLcov(lcovPath) {
  if (!fs.existsSync(lcovPath)) return { files: new Map(), duplicates: [] };
  return parseLcov(fs.readFileSync(lcovPath, 'utf8'));
}

/**
 * 这个文件**一行都没被命中**吗？
 *
 * ⚠️ 「没有 DA 记录」不算 —— 那是「没有数据」，不是「0% 覆盖」。
 * @param {Map<number, number> | undefined | null} da
 */
function isAllZeroHit(da) {
  if (!da || da.size === 0) return false;
  for (const h of da.values()) if (h > 0) return false;
  return true;
}

/**
 * 这个文件的**行级**覆盖可信吗？（判据见文件头）
 *
 * @param {string} file
 * @param {Map<number, number> | undefined | null} da 该文件的行命中表
 * @param {Set<string>} trusted 「行覆盖可信文件」清单
 */
function isLineTrustworthy(file, da, trusted) {
  if (trusted && trusted.has(file)) return true;
  return isAllZeroHit(da);
}

module.exports = { parseLcov, readLcov, isAllZeroHit, isLineTrustworthy };

// ── 自测 ────────────────────────────────────────────────────────────
if (require.main === module && process.argv[2] === '--self-test') {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // 1. 基本解析
  {
    const { files, duplicates } = parseLcov(
      [
        'SF:packages/a/src/x.ts',
        'FN:3,f',
        'FNF:1',
        'FNH:1',
        'FNDA:7,f',
        'BRF:1',
        'BRH:1',
        'BRDA:3,0,0,2',
        'LF:3',
        'LH:2',
        'DA:3,7',
        'DA:4,0',
        'DA:5,0',
        'end_of_record',
        '',
      ].join('\n'),
    );
    const d = files.get('packages/a/src/x.ts');
    expect('解析：文件数 1', files.size === 1);
    expect('解析：DA 条目 3 条', d && d.da.size === 3);
    expect('解析：DA hits 正确', d && d.da.get(3) === 7);
    expect('解析：FNDA 正确', d && d.fnda.get('f') === 7);
    expect('解析：FN 正确', d && d.fn.get('f') === 3);
    expect('解析：BRDA 正确', d && d.brda.get('3,0,0') === 2);
    expect('解析：无重复', duplicates.length === 0);
  }

  // 2. 同一文件出现多次 → 保留第一个 + 报重复（不是「后者覆盖前者」）
  {
    const { files, duplicates } = parseLcov(
      [
        'SF:packages/a/src/x.ts',
        'DA:1,5',
        'end_of_record',
        'SF:packages/a/src/x.ts',
        'DA:1,0',
        'DA:2,0',
        'end_of_record',
        '',
      ].join('\n'),
    );
    const d = files.get('packages/a/src/x.ts');
    expect('重复文件：报出 1 个重复', duplicates.length === 1);
    expect('重复文件：重复项是那个文件', duplicates[0] === 'packages/a/src/x.ts');
    expect(
      '重复文件：**保留第一个**的 DA（不是后者覆盖前者）',
      d && d.da.get(1) === 5 && d.da.size === 1,
    );
  }

  // 3. 「行级可信」判据
  {
    const trusted = new Set(['packages/a/src/trusted.ts']);
    const zero = new Map([
      [1, 0],
      [2, 0],
    ]);
    const hit = new Map([
      [1, 3],
      [2, 0],
    ]);
    const empty = new Map();
    expect(
      '可信判定：清单里的文件 → 可信',
      isLineTrustworthy('packages/a/src/trusted.ts', hit, trusted) === true,
    );
    expect(
      '可信判定：**全 0 命中** → 可信（0% 这个结论是真的，必须计入分母）',
      isLineTrustworthy('packages/a/src/never-loaded.ts', zero, trusted) === true,
    );
    expect(
      '可信判定：有命中但不在清单里 → 不可信',
      isLineTrustworthy('packages/a/src/other.ts', hit, trusted) === false,
    );
    expect(
      '可信判定：**没有 DA 记录** → 不可信（是「没数据」不是「0%」）',
      isLineTrustworthy('packages/a/src/nodata.ts', empty, trusted) === false,
    );
  }

  if (failures.length > 0) {
    console.error(`❌ scripts/lib/lcov.js 自测失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log('✅ scripts/lib/lcov.js 自测通过（解析 + 重复文件语义 + 可信判定）');
}
