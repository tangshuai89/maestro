#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Playwright 启动器（D11）：显式解析**本地** `@playwright/test`，缺依赖就明确报错。
//
// 为什么不用 `npx playwright`：
//   · 新版 npm 的 `npx --no-install` 并不真的拦住联网（2026-09-20 实测：仍然去查 registry，
//     离线环境下抛的是 npm 的 proxy 报错，看不出真正原因）；
//   · 就算它自动下载成功也**更糟** —— 会拿到一个跟基线生成时不同版本的 playwright，
//     像素比对的意义直接没了。
//
// 用法: node scripts/run-playwright.mjs test --config playwright.config.mjs [--update-snapshots]
// ─────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

// 解析 CLI：**不能**直接 resolve '@playwright/test/cli.js' ——
// 该包的 exports 只声明了 "."、"./cli"、"./package.json"、"./reporter"，
// 写 './cli.js' 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED（2026-09-20 被这个坑到过：
// 包明明装了，脚本却报"缺少 @playwright/test"）。
function resolveCli() {
  try {
    return require.resolve('@playwright/test/cli'); // exports 里声明的子路径
  } catch { /* 继续走退路 */ }
  try {
    const pkg = require('@playwright/test/package.json');
    const main = require.resolve('@playwright/test');
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.playwright;
    if (bin) {
      const p = path.join(path.dirname(main), bin);
      if (existsSync(p)) return p;
    }
  } catch { /* 继续报错 */ }
  return null;
}

const cli = resolveCli();
if (!cli) {
  // 区分"没装"和"装了但解析不到" —— 后者是脚本自身的问题，不该让你去重装依赖
  let installed = false;
  try { require.resolve('@playwright/test'); installed = true; } catch { installed = false; }
  if (installed) {
    console.error('❌ @playwright/test 已安装，但解析不到它的 CLI 入口。');
    console.error('   多半是包结构变了；请把 node_modules/@playwright/test/package.json 的 exports/bin 发我。');
    process.exit(2);
  }
  console.error('❌ 缺少 @playwright/test');
  console.error('   先装依赖（会一并更新 package-lock.json）：');
  console.error('     npm i -D @playwright/test');
  console.error('   无 Chrome 的机器还要装浏览器：');
  console.error('     npx playwright install --with-deps chromium');
  process.exit(2);
}

const res = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
