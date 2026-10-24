#!/usr/bin/env node
/**
 * packages/server/scripts/clean-dist.cjs —— 构建前清掉 dist。
 *
 * ## 为什么需要（2026-10-24 实测）
 *
 * `nest build` **不会删掉**已不存在源文件的旧产物 → 源文件被删了，dist 里那份还在。
 *
 * 实测踩到：`packages/server/dist/reco/_tmp-dbg2.js` —— 一个**从没提交过**的
 * 本地调试残留，源文件删了之后产物一直躺在 dist 里，而且
 *
 *   ⚠️ 它已经**跟着 dmg 出货**了：
 *      packages/electron/release/mac-arm64/Maestro.app/Contents/Resources/server/reco/_tmp-dbg2.js
 *
 * 为什么它能一路出货：打包把 `../server/dist` **整个目录**拷进
 * `Resources/server/`（extraResources）→ dist 里有什么，用户手里就有什么。
 *
 * 实测确认：`nest build` 跑完之后 `_tmp-dbg2.js` **依然在** dist 里
 * → 不是「nest 偶尔没清」，是它**根本不清**。
 *
 * ⇒ 每次 build 前清一次 dist。
 *
 * ## 为什么放在**包内**而不是仓库根
 *
 * 与 `packages/common` / `packages/electron` 的同名脚本保持同一套约定：
 * 构建期脚本一律**自足**（用 __dirname 相对定位），不依赖仓库根的相对路径 ——
 * 免得某个包被 `file:` 依赖复制到别处时，构建脚本找不到路（common 就被复制到
 * 打包的隔离安装目录里）。
 *
 * ## ⚠️ 为什么还要一起删 `tsconfig.build.tsbuildinfo`（2026-10-24 实测）
 *
 * server 的 tsconfig 开了 `incremental` → tsc 把「上次编译到哪了」记在
 * **包根目录**的 `tsconfig.build.tsbuildinfo`（**不在 dist 里**）。
 *
 * 于是有一个**静默无输出**的坑：
 *   1. 清掉 dist
 *   2. 跑 `nest build`
 *   3. tsc 读 tsbuildinfo → 判定「全都编译过了」→ **一个文件都不产出**
 *   4. **退出码 0**，屏幕上一行输出都没有，dist 依然不存在
 *
 * ⚠️ 这是典型的**静默降级**：构建"成功"了，实际产物是空的。
 *   靠"没看到报错"验收会当场被骗过去 —— 必须用**正向信号**验收
 *   （产物真的在）。
 *
 * ⇒ 清 dist 的同时**必须**清掉构建的增量状态，否则"清空 + 构建" = 空产物。
 *   （`packages/common` / `packages/electron` 没这个问题：它们的 tsconfig
 *    没开 `incremental`，没有 tsbuildinfo。）
 *
 * 用法：`node scripts/clean-dist.cjs dist tsconfig.build.tsbuildinfo`
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node scripts/clean-dist.cjs <dir|file>...');
  process.exit(2);
}

for (const target of targets) {
  const abs = path.resolve(__dirname, '..', target);
  if (!fs.existsSync(abs)) continue;
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`── 已清理 ${path.relative(path.resolve(__dirname, '..'), abs)}`);
}
