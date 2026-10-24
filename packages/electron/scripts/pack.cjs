#!/usr/bin/env node
/**
 * 打包入口（`npm run pack`）。
 *
 * ## 为什么需要这个脚本（2026-10-24 实测）
 *
 * 直接跑 `electron-builder --mac` 会**必然失败**：
 *
 *   ⨯ Cannot compute electron version from installed node modules - none of the
 *     possible electron modules are installed and version ("https://github.com/
 *     castlabs/electron-releases#8244344c…") is not fixed in project.
 *
 * 根因（`app-builder-lib/out/electron/electronVersion.js`）：
 *   ① `getElectronVersionFromInstalled(projectDir)` 只读
 *      `<projectDir>/node_modules/electron/package.json`；
 *      而 **npm workspaces 把 electron 提升到了仓库根** →
 *      `packages/electron/node_modules/electron` **不存在** → 读不到；
 *   ② 于是回退去读 `packages/electron/package.json` 的 `devDependencies.electron`，
 *      那是 **castLabs 的 git URL**（不以数字开头）→ `computeElectronVersion`
 *      直接抛错。
 *
 * 修法：把**实际装好的** electron 版本显式告诉 electron-builder
 * （`--config.electronVersion=`）。版本号**只从实际安装产物里读**（唯一真源）
 * → 以后换 castLabs commit 时不用改这里的代码。
 *
 * ## 顺带做的两件事（都是「主动抓出坏改动」，不是锦上添花）
 *
 * - **版本漂移检测**（三方比对，任何一对对不上都**直接失败**）：
 *   package.json 声明的 git commit SHA ↔ lockfile 里 `node_modules/electron.resolved`
 *   的 SHA ↔ 实际安装产物的 version。
 *   目的是**不打「electron 版本和依赖声明不一致」的包** —— 那属于静默发错货：
 *   依赖声明换了 commit 但忘了重装（→ 装的是旧版），或 node_modules 是陈的
 *   （→ 装的和 lockfile 对不上）。两种都会让「打包成功」变成假象。
 *
 * - **7za 可执行位**：npm 装出来的 `7za` 是 `-rw-r--r--`（npm 只给 `bin` 字段
 *   里的文件加执行位，而 `7zip-bin` 是用 `path7za` 导出路径的、**没有 `bin`
 *   字段**）→ electron-builder 造 dmg 时会 EACCES。这里补上执行位（幂等）。
 *
 * - **后置守卫：打包不许弄坏开发环境**。见下面第 6 步。
 *
 * ## ⚠️ 为什么 build 配置里有 `npmRebuild: false`（2026-10-24 实测）
 *
 * electron-builder 默认会跑一次 `npm install --production`（cwd = appDir，
 * 见 `app-builder-lib/out/util/yarn.js` 的 `installDependencies`）。
 * 在 **npm workspace** 里 `--production` 是**整棵树**剪 devDependencies ——
 * 实测跑一次 `npm run pack` 就把仓库根 `node_modules` 里的**所有** devDeps
 * 删了（**含 electron 本身**），紧接着造 dmg 时 7za 已经不存在 →
 * `ENOENT: chmod '.../7zip-bin/mac/arm64/7za' failed`。
 *
 * ⇒ 这不只是「打包失败」，是**打包把开发环境拆了**（之后的 `npm test` 全挂）。
 *
 * 本项目的 electron 包**零运行时依赖**（`electron-is-dev` 声明了但从未被
 * import，`main.ts` 直接用 `!app.isPackaged`）→ 根本不需要那次 production
 * install → 关掉它。
 *
 * ## 用法
 *
 *   node scripts/pack.cjs            # 校验 + 打包（参数透传给 electron-builder）
 *   node scripts/pack.cjs --check    # 只做校验，不打包（CI 可用）
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');

function fail(msg) {
  console.error(`\n❌ [pack] ${msg}\n`);
  process.exit(1);
}

/** 从 `git+…#<sha>` / `https://…#<sha>` 里抠出 commit SHA。 */
function commitSha(spec) {
  const m = /#([0-9a-f]{7,40})\s*$/.exec(String(spec ?? ''));
  return m ? m[1] : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ── 1. 实际装好的 electron（唯一真源）──────────────────────────────────────
let installedPkg;
let installedPkgPath;
try {
  installedPkgPath = require.resolve('electron/package.json', { paths: [PKG_DIR] });
  installedPkg = readJson(installedPkgPath);
} catch {
  fail(
    '找不到已安装的 electron。\n' +
      '   → 在**仓库根**跑 `npm install`（workspaces 必须从根装）。',
  );
}
const installedVersion = installedPkg.version;

// ── 2. 三方漂移检测 ─────────────────────────────────────────────────────────
const declaredSpec = readJson(path.join(PKG_DIR, 'package.json')).devDependencies?.electron ?? '';

let lockEntry = null;
try {
  const lock = readJson(path.join(REPO_ROOT, 'package-lock.json'));
  lockEntry = lock.packages?.['node_modules/electron'] ?? null;
} catch {
  /* 没有 lockfile 就跳过 lockfile 那一侧的校验 */
}

if (lockEntry) {
  const declaredSha = commitSha(declaredSpec);
  const lockedSha = commitSha(lockEntry.resolved);

  if (declaredSha && lockedSha && declaredSha !== lockedSha) {
    fail(
      'electron 的 commit 声明与 lockfile 对不上 —— 声明改了但没重装。\n' +
        `   package.json : ${declaredSha}\n` +
        `   package-lock : ${lockedSha}\n` +
        '   → 在**仓库根**跑 `npm install` 更新 lockfile 和 node_modules。',
    );
  }

  if (lockEntry.version && lockEntry.version !== installedVersion) {
    fail(
      '已安装的 electron 与 lockfile 对不上 —— node_modules 是陈的。\n' +
        `   lockfile    : ${lockEntry.version}\n` +
        `   已安装       : ${installedVersion}\n` +
        '   → 在**仓库根**跑 `npm install`（或 `npm ci`）。',
    );
  }
}

// ── 3. electronDist 必须在（否则 electron-builder 会去下载 electron）──────────
const electronDist = path.resolve(PKG_DIR, readJson(path.join(PKG_DIR, 'package.json')).build?.electronDist ?? '');
if (!fs.existsSync(path.join(electronDist, 'Electron.app'))) {
  fail(
    `electronDist 里没有 Electron.app（${electronDist}）。\n` +
      '   → castLabs 版 electron 没装好；在**仓库根**跑 `npm install`。',
  );
}

// ── 4. 7za 的执行位（npm 不会给没有 bin 字段的包加执行位）────────────────────
function ensureExecutable(binPath) {
  if (!binPath || !fs.existsSync(binPath)) return null;
  const mode = fs.statSync(binPath).mode & 0o777;
  if (mode & 0o111) return null; // 已有执行位
  fs.chmodSync(binPath, mode | 0o755);
  return binPath;
}

let fixed7za = null;
try {
  const sevenZip = require('7zip-bin');
  fixed7za = ensureExecutable(sevenZip.path7za);
  if (fixed7za) {
    console.log(`[pack] 7za 缺执行位，已补上：${fixed7za}`);
  }
} catch {
  /* 7zip-bin 缺失不致命 —— 到造 dmg 那步再报错更有信息量 */
}

// ── 4b. 「仓库的 devDependencies 还在吗」守卫 ───────────────────────────────
//
// 下面第 5 步和第 6 步都会跑 npm / electron-builder，它们**有可能**在 workspace
// 里触发 `npm install --production` → 把整棵树的 devDeps 剪掉（实测连 electron
// 本身都会被删）。所以在两个点各查一次，**一旦被剪立刻失败并说清怎么恢复** ——
// 而不是留一个「打包完了但 npm test 全挂」的烂摊子给下一个人。
const MUST_SURVIVE = ['electron', '7zip-bin', 'vitest', 'typescript'];
function assertWorkspaceIntact(where) {
  const pruned = MUST_SURVIVE.filter(
    (name) => !fs.existsSync(path.join(REPO_ROOT, 'node_modules', name)),
  );
  if (pruned.length === 0) return true;
  console.error(
    `\n❌ [pack] ${where}之后，node_modules 的 devDependencies 少了：${pruned.join(', ')}\n` +
      '   → 有一步在 workspace 里跑了 `npm install --production`（会剪掉整棵树的 devDeps）。\n' +
      '   → 恢复：在**仓库根**跑 `npm install`。\n' +
      '   → 根治：确认 build 配置里 `npmRebuild` 仍是 false，且没有别处跑 production install。',
  );
  process.exit(1);
}

// ── 5. server sidecar 的运行时依赖 ─────────────────────────────────────────
//
// 打包产物里 server 在 `Resources/server/`（**不在 asar 里**），而它的 154 个
// 运行时依赖不在那儿 → sidecar 起来就 require 失败 → **app 启动即崩**。
// 详见 scripts/server-runtime-deps.cjs 的说明。
const { assemble: assembleServerRuntimeDeps } = require('./server-runtime-deps.cjs');
try {
  assembleServerRuntimeDeps();
} catch (err) {
  console.error(`\n❌ [pack] 组装 server 运行时依赖失败：${err?.message ?? err}\n`);
  process.exit(1);
}
assertWorkspaceIntact('组装 server 依赖');

// ── 6. 跑 electron-builder ──────────────────────────────────────────────────
const checkOnly = process.argv.includes('--check');
const passthrough = process.argv.slice(2).filter((a) => a !== '--check');

console.log(`[pack] electron 版本：${installedVersion}`);
console.log(`[pack] electronDist ：${electronDist}`);
console.log(`[pack] commit 声明 ：${commitSha(declaredSpec) ?? '(非 git 依赖)'}`);

if (checkOnly) {
  console.log('\n✅ [pack] 校验通过（--check，未打包）\n');
  process.exit(0);
}

const electronBuilderBin = require.resolve('electron-builder/out/cli/cli.js');
const args = [
  electronBuilderBin,
  '--mac',
  `--config.electronVersion=${installedVersion}`,
  ...passthrough,
];

console.log(`[pack] electron-builder ${args.slice(1).join(' ')}\n`);
try {
  execFileSync(process.execPath, args, { stdio: 'inherit', cwd: PKG_DIR });
} catch (err) {
  // electron-builder 自己会打印原因；这里只补一句「失败在哪一步」的定位
  console.error(
    `\n❌ [pack] electron-builder 失败（exit ${err?.status ?? '?'}）。\n` +
      '   · 产物里没有 dmg？先确认 7za 可执行（见上一步日志）。\n' +
      '   · 报「Cannot compute electron version」？说明 electron 没装好，跑 npm install。\n' +
      '   · 报 VMP / evs-vmp 相关？用 `SKIP_VMP=1 npm run pack` 先验打包管线本身。',
  );
  process.exit(err?.status ?? 1);
}

// ── 7. 后置守卫：打包**不许**把开发环境弄坏 ─────────────────────────────────
//
// 那个「npm install --production 剪掉整棵树的 devDeps」的坑，光靠
// `npmRebuild: false` 挡住的是**当前**这一版配置。哪天有人为了加原生依赖
// 把 npmRebuild 改回 true（或换别的打包器又来一次 production install），
// 症状是「打包完 npm test 全挂」—— 很难联想到是打包干的。
assertWorkspaceIntact('打包');
