#!/usr/bin/env node
/**
 * 组装 **electron 主进程的运行时依赖**（打包用）—— 目前只有 `electron-updater`。
 *
 * ## 为什么需要（2026-10-27 实测）
 *
 * `electron-updater` 是 `@maestro/electron` 的**生产依赖**（自动更新要它），
 * 但 **npm workspace 会把它提升到仓库根的 `node_modules`** ⇒
 * `packages/electron/node_modules/` 是**空的**。
 *
 * 而 electron-builder 的 appDir = `packages/electron` ⇒ 它的依赖收集器在
 * **appDir/node_modules** 里找生产依赖 ⇒ **找不到 electron-updater** ⇒
 * 打进 app.asar 的包里**没有这个依赖** ⇒ `require('electron-updater')` 失败。
 *
 * ⚠️ 好在 main 侧是**懒加载 + try/catch**（见 src/updater.ts）⇒ 缺依赖时
 *    App **照常启动**，只是没有自动更新（降级，不是崩）。这个脚本是为了
 *    让「有依赖」这件事**真的成立**，而不是靠降级蒙混。
 *
 * ## 做法
 *
 * 直接从**仓库根的 node_modules** 复制这棵子树（不做隔离 install ——
 * 依赖已经在根 node_modules 里装好了，复制比再跑一次 npm install 稳，
 * 也不会碰 workspace 的依赖树）。
 *
 * 依赖清单用 `npm ls --omit=dev --all --json` 现算 ⇒ 加/减依赖不用改这里。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const TARGET_DIR = path.join(PKG_DIR, 'node_modules');

/** 主进程需要的运行时依赖（= electron 包的**生产**依赖）。 */
const RUNTIME_DEPS = ['electron-updater'];

/**
 * 依赖子树（含传递依赖）的包名列表。
 *
 * ⚠️ **不用 `npm ls`**：在 workspace 里对某个包 `--prefix` 跑 npm ls 会直接
 * 报错退出（实测）。改成**自己读 package.json 递归** —— 无外部依赖、可离线、
 * 而且只看 `dependencies`（不含 devDependencies / optionalDependencies）。
 */
function resolveTree(names) {
  const found = new Set();
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const pkgJson = path.join(REPO_ROOT, "node_modules", name, "package.json");
    if (!fs.existsSync(pkgJson)) return;
    let deps = {};
    try {
      deps = JSON.parse(fs.readFileSync(pkgJson, "utf8")).dependencies || {};
    } catch {
      deps = {};
    }
    found.add(name);
    for (const dep of Object.keys(deps)) visit(dep);
  };
  for (const n of names) visit(n);
  return [...found];
}

function copyPkg(name) {
  const from = path.join(REPO_ROOT, 'node_modules', name);
  const to = path.join(TARGET_DIR, name);
  if (!fs.existsSync(from)) return false;
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
  return true;
}

function assemble() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  const names = resolveTree(RUNTIME_DEPS);
  const copied = [];
  const missing = [];
  for (const name of names) {
    if (copyPkg(name)) copied.push(name);
    else missing.push(name);
  }
  // 顶层依赖必须真的在（少一个就等于功能缺失）
  for (const name of RUNTIME_DEPS) {
    if (!copied.includes(name)) {
      throw new Error(
        `主进程运行时依赖 ${name} 没装到仓库根的 node_modules —— ` +
          `在仓库根跑 \`npm install\` 再试（别拿旧产物凑）`,
      );
    }
  }
  return { copied, missing };
}

module.exports = { assemble, RUNTIME_DEPS, TARGET_DIR };

if (require.main === module) {
  try {
    const { copied, missing } = assemble();
    console.log(
      `[updater-deps] 已装配 ${copied.length} 个包到 packages/electron/node_modules` +
        (missing.length ? `（${missing.length} 个不在根 node_modules，跳过）` : ''),
    );
  } catch (err) {
    console.error(`❌ [updater-deps] 装配失败：${err?.message ?? err}`);
    process.exit(1);
  }
}
