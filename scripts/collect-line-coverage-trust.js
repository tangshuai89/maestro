#!/usr/bin/env node
/**
 * 收集「哪些源文件的**行级**覆盖数据可信」。
 *
 * ## 为什么需要这个
 *
 * c8 把 V8 的**字节偏移**范围映射回源码行，需要 **source map**。source map
 * 从 node 的 `source-map-cache` 拿（node 原生 CJS/ESM loader 加载模块时填充）。
 *
 * - **node 侧**（`ts-node` 跑 `.test.ts`）：ts-node 注册了 source-map-support
 *   → `source-map-cache` **有** → 行号正确 ✓
 * - **node 侧**（`node` 直接跑 `.test.mjs`，renderer 的纯函数档）：node 的
 *   type-stripping **不产出 source map** → 行号**错位** ✗
 * - **vitest 侧**（`.test.tsx`）：vite/esbuild 转换后的 JS 在**内存**里，
 *   source map 是 inline data URL，node 的 `source-map-cache` 里**没有** →
 *   行号**错位** ✗
 *
 * 行号错位长什么样（2026-10-21 实测）：
 *
 *   - esbuild 把 `usePlayer.ts` 从 2192 行压成 1336 行（删掉 856 行类型/空行）
 *   - c8 拿不到 source map → 拿 **转换后 JS 的字节偏移** 去切 **源 .ts 文件**
 *   - 切出来的行号是**随机的** —— 但因为切的是完整源文件，**DA 条目数 = 源文件
 *     行数**，看起来「对齐」，极具欺骗性
 *   - 实测反例：一个**从未被调用**的函数，它的函数体各行 DA hits 却是 170
 *     （模块顶层语句的次数）；而同一函数里**必然执行**的 `setCurrentTime(0)`
 *     hits 却是 0
 *
 * ⇒ **renderer 的行级覆盖数字不可信**（server/common/electron 的可信）。
 * 门禁若拿行级数据判「新增代码有没有被测到」，在 renderer 上会**漏报**（未覆盖
 * 的新代码看起来已覆盖）甚至**误报**。
 *
 * ## 函数级覆盖为什么可信
 *
 * 函数名是**源码标识符**，不随转换器的字节布局变化 → 跨管线、跨 entry 都稳定。
 * 实测：从未被调用的探针函数，FNDA 精确地是 0 ✓
 *
 * ## 用法
 *
 *   node scripts/collect-line-coverage-trust.js <输出文件> <temp 目录>...
 *
 * 输出每行一个「行覆盖可信」的源文件路径（相对仓库根）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: node scripts/collect-line-coverage-trust.js <out> <tempDir>...');
    process.exit(2);
  }
  const [outPath, ...tempDirs] = args;

  /** @type {Set<string>} */
  const trusted = new Set();

  for (const dir of tempDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      let json;
      try {
        json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      } catch {
        continue;
      }
      const cache = json['source-map-cache'];
      if (!cache) continue;
      for (const fileUrl of Object.keys(cache)) {
        // file:///abs/path → 相对仓库根
        if (!fileUrl.startsWith('file://')) continue;
        const abs = fileUrl.slice('file://'.length);
        const rel = path.relative(process.cwd(), abs);
        if (rel.startsWith('..')) continue; // 不在仓库内
        if (!rel.includes('/packages/')) continue;
        if (rel.includes('/node_modules/')) continue;
        if (rel.includes('/dist/')) continue;
        // 只有**真的带 source map 数据**的才算（data 为空 = 没有映射）
        const entry = cache[fileUrl];
        if (!entry || !entry.data) continue;
        trusted.add(rel);
      }
    }
  }

  const out = [...trusted].sort().join('\n');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out ? out + '\n' : '');

  console.error(
    `── 行覆盖可信的源文件：${trusted.size} 个（清单：${outPath}）`,
  );
}

main();
