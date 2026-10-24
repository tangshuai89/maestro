#!/usr/bin/env node
/**
 * packages/common/scripts/run-tests.cjs —— 跑这个包里**全部**的 `*.test.ts`。
 *
 * ## 为什么需要这个脚本
 *
 * 原来的 `npm test` 是：
 *
 *     "test": "npm run build && node dist/normalizer.test.js"
 *
 * 两个问题：
 * 1. **只跑 5 个测试文件里的 1 个**（`normalizer.test.js`）—— 另外 4 个
 *    （`artistAlias` / `contract` / `grouping` / `mask`）在这个包里**从来没跑过**。
 *    （仓库根的 `npm test` 跑全部 5 个 ✓ —— 所以 CI 是绿的，掩盖了包级脚本的过时。）
 * 2. 它依赖 `dist/` 里有测试产物 —— 而现在 `build` 用 `tsconfig.build.json`
 *    **排除了测试文件**（测试代码不该出货）→ `dist/normalizer.test.js`
 *    **不存在** → 这条命令会直接失败。
 *
 * ⇒ 改成**从 `src` 跑**（和仓库根 `scripts/test.sh` 的 `run_pkg common` 一致：
 * `npx ts-node src/<file>.test.ts`），并**自动发现**全部测试文件 ——
 * 以后新增测试文件不用改脚本（漏跑就是静默的覆盖率/质量缺口）。
 *
 * ## 为什么必须**逐个进程**跑
 *
 * 每个测试文件是**独立脚本**：自己统计 `passed` / `failed`，失败时
 * `process.exit(1)`。⇒ 不能 import 到同一个进程里跑（第一个失败就 exit 了）。
 *
 * 用法：`node scripts/run-tests.cjs`
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pkgRoot = path.resolve(__dirname, '..');
const srcDir = path.join(pkgRoot, 'src');

const files = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

if (files.length === 0) {
  console.error(`❌ ${path.relative(pkgRoot, srcDir)} 下没有任何 *.test.ts`);
  process.exit(1);
}

// Windows 上 npx 是 npx.cmd
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

let failed = 0;
for (const file of files) {
  console.log(`── src/${file} ──`);
  const r = spawnSync(npx, ['ts-node', path.join('src', file)], {
    cwd: pkgRoot,
    stdio: 'inherit',
  });
  if (r.status !== 0) failed += 1;
}

console.log(`── ${files.length - failed}/${files.length} 个测试文件通过 ──`);
process.exit(failed > 0 ? 1 : 0);
