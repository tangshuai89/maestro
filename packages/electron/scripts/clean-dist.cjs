#!/usr/bin/env node
/**
 * packages/electron/scripts/clean-dist.cjs —— 构建前清掉 dist。
 *
 * ## 为什么需要
 *
 * `tsc` **不会删掉**已不存在源文件的旧产物 → 源文件被删了，dist 里那份还在。
 * 实测：`packages/electron/dist/` 里躺着一堆 `*.test.js`（测试文件），而
 * `build.files` 把 dist 下**所有**文件都收进去（只排除了 map / d.ts）→
 * 它们**被打进 app.asar 出货**（实测 asar 里��� 11 个测试文件）。
 *
 * ⇒ 每次 build 前清一次 dist，测试文件就不会残留。
 *
 * ⚠️ 写这类注释时注意：**块注释里不能出现结束符**（会提前闭合）——
 *    所以下面用「dist 下所有文件」这种说法，而不是带通配符的路径写法。
 *
 * 用法：`node scripts/clean-dist.cjs dist`
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node scripts/clean-dist.cjs <dir>...');
  process.exit(2);
}

const pkgRoot = path.resolve(__dirname, '..');
for (const dir of targets) {
  const abs = path.resolve(pkgRoot, dir);
  if (!fs.existsSync(abs)) continue;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`── 已清理 ${path.relative(pkgRoot, abs)}`);
}
