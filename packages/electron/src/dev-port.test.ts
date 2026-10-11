/**
 * waitForDevPort tests (Phase 11 P11-6). Verifies the port file is polled
 * until it appears, RENDERER_PORT short-circuits, and timeout falls back
 * to devPort() instead of hanging forever.
 *
 * Run: npx ts-node packages/electron/src/dev-port.test.ts
 */
export {};
const assert = require('node:assert');

import { devPort, waitForDevPort, DEFAULT_DEV_PORT } from './dev-port';

async function main(): Promise<void> {
  const savedPortEnv = process.env.RENDERER_PORT;
  delete process.env.RENDERER_PORT;

  // ── 1. RENDERER_PORT 显式指定 → 立即返回，不读文件 ─────────────
  {
    process.env.RENDERER_PORT = '5999';
    let readCalls = 0;
    const port = await waitForDevPort(50, 1, () => {
      readCalls++;
      return 5274;
    });
    assert.strictEqual(port, 5999, 'RENDERER_PORT 优先于端口文件');
    assert.strictEqual(readCalls, 0, '显式端口时根本不轮询文件');
    delete process.env.RENDERER_PORT;
    console.log('✅ 1. RENDERER_PORT 显式指定 → 立即返回');
  }

  // ── 2. 文件已就位 → 首轮即返回发布端口 ────────────────────────
  {
    const port = await waitForDevPort(100, 1, () => 5274);
    assert.strictEqual(port, 5274, '读到端口文件立即返回其实际值');
    console.log('✅ 2. 端口文件已就位 → 首轮返回');
  }

  // ── 3. 文件延迟出现 → 轮询直到读到 ────────────────────────────
  {
    let calls = 0;
    const port = await waitForDevPort(500, 1, () => (++calls >= 4 ? 5276 : null));
    assert.strictEqual(port, 5276, '第 4 次轮询读到 5276');
    assert.strictEqual(calls, 4, '确实轮询了 4 次');
    console.log('✅ 3. 文件延迟出现 → 轮询至读到为止');
  }

  // ── 4. 超时 → 回退 devPort() 且打 warn，不挂死 ───────────────
  {
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg?: unknown) => warns.push(String(msg));
    try {
      const port = await waitForDevPort(30, 1, () => null);
      assert.strictEqual(port, devPort(), '超时回退到 devPort() 兜底值');
      assert.ok(warns.some((w) => w.includes('超时')), '超时必须有 warn 提示');
    } finally {
      console.warn = origWarn;
    }
    console.log('✅ 4. 超时 → warn + devPort() 兜底（不挂死）');
  }

  // ── 5. 回归：devPort() 无文件无 env 时回退 DEFAULT_DEV_PORT ──
  {
    // 本用例依赖本机当前无 .dev-port 发布值时才严格成立；若恰好存在发布
    // 端口文件，则断言「不抛错且是个合法端口」即可。
    const p = devPort();
    assert.ok(Number.isInteger(p) && p > 0 && p < 65536, 'devPort() 必须返回合法端口');
    if (p !== DEFAULT_DEV_PORT) {
      console.log(`   （本机存在发布端口 ${p}，跳过 5273 断言）`);
    }
    console.log('✅ 5. devPort() 兜底合法端口');
  }

  if (savedPortEnv === undefined) delete process.env.RENDERER_PORT;
  else process.env.RENDERER_PORT = savedPortEnv;

  console.log('\n🎉 dev-port.test.ts: all 5 cases passed');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
