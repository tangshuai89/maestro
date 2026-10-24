#!/usr/bin/env node
/**
 * 组装 **server sidecar 的运行时依赖**（打包用）。
 *
 * ## 为什么需要（2026-10-24 实测）
 *
 * 打包产物里，NestJS server 是通过 `extraResources` 放在
 * `Maestro.app/Contents/Resources/server/` 的 —— **不在 asar 里**。
 * 而它的运行时依赖（@nestjs/core / reflect-metadata / kuromoji / opencc-js …，
 * 共 154 个包）**没有被打进去**：
 *
 *   $ ELECTRON_RUN_AS_NODE=1 Maestro.app/Contents/MacOS/Maestro \
 *       -e "require.resolve('@nestjs/core', {paths:['…/Resources/server']})"
 *   ❌ @nestjs/core 解析失败：MODULE_NOT_FOUND
 *
 * ⇒ **dmg 打得出来，但装上去启动即崩**（sidecar 一 `require` 就挂）。
 *
 * ## 修法
 *
 * 在 `packages/electron/pack-server-deps/` 里做一次**隔离的 production install**，
 * 再把结果作为 `extraResources` 打进 `Resources/server/node_modules` ——
 * 正好是 sidecar 的 require 解析路径。
 *
 * ## 两个关键细节
 *
 * ① **隔离**：在 workspace 里跑 `npm install --production` 会把**整棵树**的
 *    devDependencies 剪掉（实测把 electron 本身都删了）。这个目录**不在**
 *    npm 的 workspace 列表里（`workspaces` 只匹配 `packages/*`），npm 会把它
 *    当成独立项目 → 不影响仓库。
 *    ⚠️ 但这个行为依赖 npm 的项目根判定 —— 所以调用方（pack.cjs）在装完之后
 *    **会复查**仓库的 devDependencies 还在不在，不在就立刻失败。
 *
 * ② **`--install-links`**：`@maestro/common` 是 workspace 内的私有包
 *    （`"@maestro/common": "*"`，且 `private: true`），得用 `file:` 引用。
 *    默认 npm 会**软链**它 → 软链在 .app 里指向包外，直接坏掉；
 *    `--install-links` 让它**拷贝**一份进去（实测是实体目录 ✓）。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const SERVER_DIR = path.join(REPO_ROOT, 'packages', 'server');
const COMMON_DIR = path.join(REPO_ROOT, 'packages', 'common');
const STAGING_DIR = path.join(PKG_DIR, 'pack-server-deps');
const STAMP_FILE = path.join(STAGING_DIR, '.fingerprint');

/**
 * 指纹：server 的依赖声明 + `@maestro/common` 的内容状态。
 * 任何一个变了都要重装（否则打出来的包带的是旧依赖）。
 */
function fingerprint() {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(path.join(SERVER_DIR, 'package.json')));
  h.update(fs.readFileSync(path.join(COMMON_DIR, 'package.json')));

  // common 是 file: 依赖 → 会被整体拷进去 → 它的 build 产物变了也得重装
  const distDir = path.join(COMMON_DIR, 'dist');
  let entries;
  try {
    entries = fs
      .readdirSync(distDir)
      .map((f) => {
        const st = fs.statSync(path.join(distDir, f));
        return `${f}:${st.size}:${Math.floor(st.mtimeMs)}`;
      })
      .sort();
  } catch {
    entries = ['<no dist>'];
  }
  h.update(entries.join('|'));
  return h.digest('hex');
}

/**
 * 装出 server 的运行时依赖。
 * @param {{force?: boolean}} [opts]
 * @returns {{dir: string, reused: boolean, packages: number}}
 */
function assemble(opts = {}) {
  const target = path.join(STAGING_DIR, 'node_modules');
  const fp = fingerprint();

  if (
    !opts.force &&
    fs.existsSync(STAMP_FILE) &&
    fs.existsSync(target) &&
    fs.readFileSync(STAMP_FILE, 'utf8').trim() === fp
  ) {
    console.log('[pack] server 运行时依赖已是最新（指纹一致）→ 复用');
    return { dir: STAGING_DIR, reused: true, packages: countPackages(target) };
  }

  console.log('[pack] 组装 server 运行时依赖（隔离 production install）…');
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8'));
  const deps = { ...serverPkg.dependencies };
  deps['@maestro/common'] = `file:${COMMON_DIR}`;

  fs.writeFileSync(
    path.join(STAGING_DIR, 'package.json'),
    JSON.stringify(
      {
        name: 'maestro-server-runtime',
        version: '1.0.0',
        private: true,
        description: '打包用：server sidecar 的运行时依赖（由 scripts/server-runtime-deps.cjs 生成，勿手改）',
        dependencies: deps,
      },
      null,
      2,
    ),
  );

  execFileSync(
    'npm',
    ['install', '--omit=dev', '--install-links', '--no-audit', '--no-fund'],
    { cwd: STAGING_DIR, stdio: 'inherit' },
  );

  fs.writeFileSync(STAMP_FILE, fp);
  const count = countPackages(target);
  console.log(`[pack] server 运行时依赖就绪：${count} 个包 → ${path.relative(PKG_DIR, target)}`);
  return { dir: STAGING_DIR, reused: false, packages: count };
}

function countPackages(dir) {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

module.exports = { assemble, fingerprint, STAGING_DIR };

if (require.main === module) {
  assemble({ force: process.argv.includes('--force') });
}
