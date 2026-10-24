#!/usr/bin/env node
/**
 * packages/common/scripts/clean-dist.cjs —— 构建前清掉 dist。
 *
 * ## 为什么需要
 *
 * `tsc` **不会删掉**已不存在源文件的旧产物 → 源文件被删了，dist 里那份还在。
 * 实测踩到：`packages/common/dist/__gate_probe.test.js`（一个已删除的探针留下的）
 * 一直跟着 `@maestro/common` 出货（进了打包产物的
 * `Resources/server/node_modules/@maestro/common/dist/`）。
 *
 * ⇒ 每次 build 前清一次 dist。
 *
 * ## 为什么放在**包内**而不是仓库根
 *
 * `@maestro/common` 会被 `npm install file:... --install-links` **复制**到
 * `packages/electron/pack-server-deps/node_modules/`（隔离安装）→ 那个副本里
 * `../../scripts/` **不存在** → 构建脚本引用仓库根的路径会直接崩。
 * ⇒ 这个包的所有构建期脚本都必须**自足**（`__dirname` 相对定位）。
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

for (const dir of targets) {
  const abs = path.resolve(__dirname, '..', dir);
  if (!fs.existsSync(abs)) continue;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`── 已清理 ${path.relative(path.resolve(__dirname, '..'), abs)}`);
}
