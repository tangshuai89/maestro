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
import { installElectronStub, seedProvider } from '../tests/e2e/electronStub.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);

const DEV_PORT = Number(process.env.RENDERER_PORT ?? 5174);
// ⚠️ **专用端口**（不是 3200）：3200 是 Electron sidecar 的端口 → 端口冲突 +
//   静默复用用户的真 server → 采集到的不是假 provider 的链路，还可能往用户
//   真实账号写红心（实测踩到）。
const API_PORT = Number(process.env.E2E_PORT ?? 3210);
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0
    ? resolve(REPO, process.argv[i + 1])
    : resolve(REPO, 'coverage/.lcov-browser/lcov.info');
})();

/**
 * 杀掉一个子进程的**整个进程组**，并释放它的管道 handle。
 *
 * ## 为什么必须是「进程组」而不是「单个进程」
 *
 * 2026-10-22 实测的 CI 6 小时 hang（PR #114）：浏览器覆盖采集这步在 Linux
 * runner 上永不退出。机制：
 *
 *   1. `spawn('npx', ['vite', ...])` → npx 是**包装进程**，真正的 vite 是
 *      **孙进程**（vite 还会再 fork 一个常驻的 esbuild）。
 *   2. 清理时只 `proc.kill('SIGTERM')` → 死的是 npx，**孙进程活下来**。
 *   3. 孙进程继续持有 stdout/stderr 管道的**写端** → 父进程这边的 pipe 流
 *      永远收不到 EOF → **事件循环永不空** → node **永不退出**。
 *   4. `test.sh` 就在这一行上永远等下去 → CI job 烧满 6 小时被 GitHub 强杀。
 *
 * 本地 macOS 不复现（npx→vite 的信号恰好把整棵树带走了）→ **只有 CI 会炸**。
 *
 * 解法：`spawn(..., { detached: true })` 让子进程自成一个进程组 → 用
 * `process.kill(-pid)` 一次带走整组（npx + node + vite + esbuild）。
 */
function killGroup(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // 进程组已经没了 → 退回杀单个进程
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  // 释放管道 handle：即使子进程没死干净，本进程也能正常退出
  try {
    proc.stdout?.destroy();
    proc.stderr?.destroy();
  } catch {
    /* ignore */
  }
}

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

/** 端口有没有被占用（起一个 socket 试连）。 */
async function isPortBusy(port) {
  const net = require_('node:net');
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (busy) => {
      sock.destroy();
      resolve(busy);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1500, () => done(false));
  });
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

/**
 * 自测：验证 killGroup 真的能带走**孙进程**。
 *
 * 这条是补一次真实事故留下的（2026-10-22，CI 上 6 小时 hang）：
 * 造一个「包装进程 → 孙进程」的结构（和 npx→vite 同构），
 * 调 killGroup 后断言**孙进程已经不在了**。
 *
 * 变异点：把 killGroup 里的 `kill(-pid)` 改回 `proc.kill()` →
 * 孙进程活下来 → 这条自测必须失败。
 */
async function selfTest() {
  const failures = [];
  const expect = (label, cond, detail = '') => {
    if (!cond) failures.push(`${label}${detail ? ' —— ' + detail : ''}`);
  };

  // 包装进程 → 孙进程（孙进程睡 5 分钟，抓住 stdout 里的 pid）
  const wrapperCode = `
    const { spawn } = require('node:child_process');
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300000)'], { stdio: 'ignore' });
    console.log('CHILD_PID=' + c.pid);
    setTimeout(() => {}, 300000);
  `;
  const proc = spawn(process.execPath, ['-e', wrapperCode], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // ← 和主流程一样：必须自成一个进程组
  });

  const childPid = await new Promise((resolve) => {
    let buf = '';
    const timer = setTimeout(() => resolve(0), 10_000);
    proc.stdout.on('data', (d) => {
      buf += String(d);
      const m = /CHILD_PID=(\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve(0);
    });
  });

  expect('自测：包装进程成功生成了孙进程', childPid > 0, `拿到 pid=${childPid}`);
  if (childPid > 0) {
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect('自测：孙进程一开始是活着的', alive(childPid));

    killGroup(proc);

    // 等进程组被内核回收
    for (let i = 0; i < 40 && alive(childPid); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(
      '自测：killGroup 之后**孙进程**也没了（杀的是进程组，不是单个进程）',
      !alive(childPid),
      `孙进程 pid=${childPid} 仍然存活 —— 说明只杀了包装进程，管道会被它一直持有 → 父进程永不退出`,
    );
  }

  if (failures.length > 0) {
    console.error(`❌ collect-browser-coverage 自测失败（${failures.length} 项）:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log('✅ collect-browser-coverage 自测通过（杀进程组 → 孙进程一起带走）');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    return;
  }
  // ⚠️ **看门狗**：整段采集（含起 server、跑浏览器、转格式）**绝不该超过
  //   4 分钟**。超时不是「跳过」而是「失败」→ 调用方按「接线层无法判定」处理。
  //   有了它，任何未预料的挂起最多浪费 4 分钟，而不是 6 小时。
  const watchdog = setTimeout(() => {
    console.error('[browser-cov] 超过 4 分钟仍未完成 → 强制退出（防 CI 长时间挂起）');
    process.exit(3);
  }, 240_000);
  watchdog.unref();

  if (!existsSync(resolve(REPO, 'node_modules/@playwright/test'))) {
    console.error('没有 @playwright/test → 跳过浏览器覆盖采集');
    process.exit(2); // 2 = 「环境不具备」，调用方按可跳过处理
  }
  mkdirSync(dirname(OUT), { recursive: true });

  // ── 0. 起飞前检查：端口必须**空闲** ─────────────────────────────
  // ⚠️ 端口被占 → 我们的 server 起不来 → 但 `waitForHttp` 会**打到别人的
  //   server** 上 → 采集到的是**别人的数据**（实测：E2E 的 server 还没退干净
  //   就起下一次采集 → 页面打到一个正在关停的 server → 整条链路失败）。
  //   → 占着就直接失败，别默默用别人的。
  for (const [port, what] of [
    [API_PORT, 'E2E server'],
    [DEV_PORT, 'vite dev server'],
  ]) {
    if (await isPortBusy(port)) {
      console.error(
        `[browser-cov] 端口 ${port}（${what}）已被占用 → 放弃采集。\n` +
          '   → 可能是上一次采集没清理干净，或另一个 E2E / dev server 正在跑。',
      );
      process.exit(3);
    }
  }

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
    // ⚠️ **必须 detached**（2026-10-22 实测的 CI 6 小时 hang 的根因）：
    //   detached 让子进程**自成一个进程组** → 清理时能 `kill(-pid)` 整组带走。
    //   不 detached 时，SIGTERM 只到 `npx` 这个包装进程 → 真正的
    //   `node`（vite / ts-node）**孙进程活下来**，继续持有 stdout/stderr 管道
    //   → 父进程的 pipe 流永远收不到 EOF → **事件循环永不空 → node 不退出**
    //   → CI 上「Run tests」卡满 6 小时被 GitHub 强杀。
    //   本地 macOS 不复现（npx→vite 的信号恰好带走了整棵树）→ 只有 CI 会炸。
    detached: true,
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
      // 同上：detached → 能整组杀（vite 还会再 fork 一个 esbuild 常驻进程）
      detached: true,
    },
  );
  webProc.stdout.on('data', (d) => process.stdout.write(`[web] ${d}`));
  webProc.stderr.on('data', (d) => process.stderr.write(`[web] ${d}`));

  const cleanup = () => {
    for (const proc of [apiProc, webProc]) killGroup(proc);
  };
  process.on('exit', cleanup);

  try {
    await waitForHttp(`http://127.0.0.1:${API_PORT}/music/liked?provider=qq`, 90_000);
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/`, 90_000);

    // ── 3. 浏览器里跑一遍真实链路，边跑边采覆盖 ──────────────────
    const { chromium } = require_('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    // provider 已选 → App 直接进剧场。
    //
    // ⚠️ **注入 apiBase 指向 E2E 自己的 server**（而不是走 vite 的代理）：
    //   vite 的代理目标是写死的 `127.0.0.1:3200` → 那正是 app sidecar 的端口
    //   → 链路会打到**用户的真 server**上（不是假 provider），而且收藏会写进
    //   用户真实账号。指到 3210 才是确定性的。
    //   同站（127.0.0.1）→ 会话 cookie 正常带上（跨站时 SameSite=Lax 的 cookie
    //   根本不发送 —— 那是 E2E 踩过的坑）。
    await seedProvider(page);
    await installElectronStub(page, `http://127.0.0.1:${API_PORT}`);
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
    // ── 队列面板（specs/queue-panel/）──────────────────────────
    // 点第一首之后**队列就有了**（playSearch 把整个搜索结果变成队列）→
    // 这几步专门走 App.tsx 的队列接线分支：开面板 / 跳一首 / 移一首 / 关掉。
    // 接线层（App.tsx）**没有单元测试**，只能靠这里的浏览器覆盖采集走到 ——
    // 不走一遍的话，覆盖率 diff 门禁会报「App.tsx 的新增行没被执行过」。
    await page.locator('.titlebar-btn.queue-btn').waitFor({ state: 'visible', timeout: 20_000 });
    // 队列为空时按钮是 disabled 的 → 等它可点再点（别用 click 的自动等待，它
    // 对 disabled 按钮会一直等到超时）
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.titlebar-btn.queue-btn');
        return Boolean(el) && !el.disabled;
      },
      { timeout: 20_000 },
    );
    await page.locator('.titlebar-btn.queue-btn').click();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 20_000 });
    // 跳到队列里的一首（点歌名）
    await page.locator('[role="dialog"] button[aria-label^="播放 "]').first().click();
    // 把一首移出队列（点 ×）
    await page.locator('[role="dialog"] button[aria-label^="把 "]').first().click();
    // 关掉面板（Esc）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
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
      // ⚠️ **必须给 timeout**：没有它，子进程一旦不退出，这里就永远等下去
      //   （2026-10-22 在 CI 上就是这么卡了 6 小时的）。
      { stdio: 'inherit', timeout: 120_000, killSignal: 'SIGKILL' },
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
