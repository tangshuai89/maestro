#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 采集**浏览器端**覆盖率（renderer 的接线层：App.tsx / main.tsx）
//
// ── 为什么要有这条采集 ──────────────────────────────────────────
// renderer 的行覆盖由 @vitest/coverage-v8 产出（行号准确），但有一类文件
// **单元测试根本碰不到**：
//   - `App.tsx`（741 行）—— 纯**接线层**（import hook、拼 props），
//     不导出任何逻辑 → 单测里从没 render 过 → 行覆盖恒为 **0%**。
//   - `main.tsx`（入口）—— 同理。
// 而它们恰恰是**改坏了最容易出事**的地方（应用起不来 / 接线接错）。
// 更糟的是：`App.tsx` 的行覆盖数据是**可信的**（coverage-v8 产出）→ diff 门禁
// 会把「App.tsx 的任何新增行」判成「未覆盖」→ **误拦**（实测：往 App.tsx
// 中间插一行就被门禁红）。
// → 浏览器里跑一次真实链路，把接线层的覆盖**真实地**记下来，门禁才能正确判断。
//
// ── 跑在哪 ──────────────────────────────────────────────────────
// **vite dev server**（不是构建产物）：dev 提供的每个模块是独立 URL
// （`/src/App.tsx`）且带 inline source map → V8 的字节偏移能直接回映射到
// 源码行/列。构建产物是一个大 bundle → 要多过一层 chunk sourcemap。
// ⚠️ 「出厂产物能不能用」由 `tests/e2e/fullchain.spec.mjs`（跑 vite preview）
//   负责 —— 两条腿分工：那边验**产物**，这边量**接线层**。
//
// ── 后端 ────────────────────────────────────────────────────────
// 起**真的** E2E server（真 NestJS + 假 provider，见 packages/server/src/e2e/）
// → dev server 把 /music /auth /reco 代理到它 → 链路是真的。
//
// 用法: node scripts/collect-browser-coverage.mjs [--out coverage/.lcov-browser/lcov.info]
// ─────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);

const DEV_PORT = Number(process.env.RENDERER_PORT ?? 5174);
const API_PORT = Number(process.env.E2E_PORT ?? 3200);
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0
    ? resolve(REPO, process.argv[i + 1])
    : resolve(REPO, 'coverage/.lcov-browser/lcov.info');
})();

/** 起一个子进程并等它打印某个标记（或监听某个端口）。 */
function startProc(cmd, args, opts, readyMatcher) {
  const proc = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => {
    const s = String(d);
    if (readyMatcher && readyMatcher.test(s)) readyMatcher.resolve?.();
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[${opts.tag}] ${d}`));
  return proc;
}

function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.status < 500) return resolvePromise();
      } catch {
        /* 还没起来 */
      }
      if (Date.now() > deadline) return reject(new Error(`等待 ${url} 超时`));
      setTimeout(tick, 400);
    };
    tick();
  });
}

async function main() {
  if (!existsSync(resolve(REPO, 'node_modules/@playwright/test'))) {
    console.error('没有 @playwright/test → 跳过浏览器覆盖采集');
    process.exit(2); // 2 = 「环境不具备」，调用方按可跳过处理
  }
  mkdirSync(dirname(OUT), { recursive: true });

  // ── 1. E2E server（真 NestJS + 假 provider）────────────────────
  console.log(`[browser-cov] 起 E2E server :${API_PORT}`);
  const apiProc = spawn('npx', ['ts-node', 'src/e2e/e2e-server.ts'], {
    cwd: resolve(REPO, 'packages/server'),
    env: {
      ...process.env,
      E2E_PORT: String(API_PORT),
      // dev server 的 origin 也要在 CORS allowlist 里（vite 代理会带 Origin）
      RENDERER_ORIGINS: [
        process.env.RENDERER_ORIGINS ?? '',
        `http://127.0.0.1:${DEV_PORT}`,
        `http://localhost:${DEV_PORT}`,
      ]
        .filter(Boolean)
        .join(','),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProc.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  apiProc.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

  // ── 2. vite dev server（提供逐模块的 inline sourcemap）────────
  console.log(`[browser-cov] 起 vite dev :${DEV_PORT}`);
  const webProc = spawn(
    'npx',
    ['vite', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: resolve(REPO, 'packages/renderer'),
      env: { ...process.env, RENDERER_PORT: String(DEV_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  webProc.stdout.on('data', (d) => process.stdout.write(`[web] ${d}`));
  webProc.stderr.on('data', (d) => process.stderr.write(`[web] ${d}`));

  const cleanup = () => {
    try {
      apiProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    try {
      webProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);

  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/music/liked?provider=qq`, 90_000);
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/`, 90_000);

    // ── 3. 浏览器里跑一遍真实链路，边跑边采覆盖 ──────────────────
    const { chromium } = require_('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    // provider 已选 → App 直接进剧场。⚠️ **不注入 electronAPI.apiBase**：
    // dev 模式下 app 会用相对 URL（vite 代理到 :3200）→ **同源** → 会话 cookie
    // 正常带上（跨站时 SameSite=Lax 的 cookie 根本不发送 —— 那是 E2E 踩过的坑）。
    await page.addInitScript(() => {
      try {
        localStorage.setItem('music-provider', 'qq');
      } catch {
        /* ignore */
      }
    });
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto(`http://127.0.0.1:${DEV_PORT}/`);
    await page.locator('.th-canvas').waitFor({ state: 'visible', timeout: 30_000 });
    // 搜索 → 播放 → 收藏（这三步会把 App 的主要分支都走过）
    await page.locator('.titlebar-btn.search-btn').click();
    await page.locator('.sp-search-input').fill('E2E');
    await page.locator('.sp-result-count').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.sp-item .sp-row').first().click();
    await page.locator('audio').first().waitFor({ state: 'attached', timeout: 20_000 });
    await page.locator('.th-like').click();
    await page.waitForTimeout(1500);
    const entries = await page.coverage.stopJSCoverage();
    await browser.close();

    const raw = resolve(REPO, 'coverage/.e2e/v8cov.json');
    mkdirSync(dirname(raw), { recursive: true });
    writeFileSync(raw, JSON.stringify(entries));
    console.log(`[browser-cov] 原始 V8 覆盖 ${entries.length} 条 → ${raw}`);

    // ── 4. V8 → istanbul → lcov ────────────────────────────────
    const { execFileSync } = require_('node:child_process');
    execFileSync(
      process.execPath,
      [resolve(REPO, 'scripts/browser-coverage-to-lcov.mjs'), raw, OUT],
      { stdio: 'inherit' },
    );
    console.log(`[browser-cov] 完成 → ${OUT}`);
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error('[browser-cov] 失败:', e?.message ?? e);
  process.exit(1);
});
