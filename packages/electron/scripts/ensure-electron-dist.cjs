#!/usr/bin/env node
/**
 * 确保 electron 二进制已就位（`npm install` 产不出来的那种）。
 *
 * ## 为什么需要（2026-10-24 实测）
 *
 * 本项目用的 castLabs 版 electron（`electron-releases#8244344c`，43.2.0+wvcus）
 * 的 `package.json` **没有 `scripts` 字段** → **npm 不会执行任何 install
 * 生命周期脚本** → `node_modules/electron/dist/` **永远不会被下载**。
 *
 * 后果（都是「看起来像别的 bug」的症状）：
 *   - `npm run dev`（electron）→ `electron dist/main.js` 报「Electron failed to
 *     install correctly」
 *   - `npm run pack` → `electronDist` 指向的目录里没有 `Electron.app`
 *     → electron-builder 直接失败
 *
 * 而 `electron` 包自带的 `install.js` 是**能用的**（它从
 * `github.com/castlabs/electron-releases/releases` 下载对应版本），只是没人调它。
 *
 * ## 为什么挂在 `predev` / `prepack` 上，而不是根 `postinstall`
 *
 * 根 `postinstall` 会在**每次** `npm install`（包括每次 CI）都跑一遍 →
 * 冷缓存下就是每次 CI 多下载 ~100MB。而这个二进制**只有 dev 和 pack 需要**。
 * 挂在 `predev` / `prepack` 上 → **要才付钱**。
 *
 * `install.js` 自带 `isInstalled()` 判定（`dist/version` + `path.txt` + 可执行
 * 文件存在）→ 已装则直接 exit 0 → 幂等，不会重复下载。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.resolve(__dirname, '../../node_modules/electron');
const installer = path.join(electronDir, 'install.js');

// electron 没装（比如 `--omit=dev` 的生产安装）→ 不是错误，跳过。
if (!fs.existsSync(installer)) {
  process.exit(0);
}

console.log('[electron] 确认 electron 二进制…');
const res = spawnSync(process.execPath, [installer], { stdio: 'inherit' });

if (res.status !== 0) {
  console.error(
    '\n❌ [electron] 下载 electron 二进制失败。\n' +
      '   · 检查网络（要访问 github.com/castlabs/electron-releases/releases）。\n' +
      '   · 手动重试：node node_modules/electron/install.js\n',
  );
  process.exit(res.status ?? 1);
}
