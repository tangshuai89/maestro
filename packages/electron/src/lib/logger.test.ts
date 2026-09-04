/**
 * logger wrapper 单测（ISSUES.md §3.7）。
 *
 * 验证：
 *   - log/warn/error 都加 [main] 前缀
 *   - debug 默认隐藏，ELECTRON_ENABLE_VERBOSE=1 时输出
 *   - 不污染参数（rest spread 原样透传）
 *
 * 运行: npx ts-node packages/electron/src/lib/logger.test.ts
 */
export {};
const assert = require('node:assert');

const { logger } = require('./logger');

async function main() {
  // ── 1. log/warn/error 加 [main] 前缀 ─────────────────────────
  const savedLog = console.log;
  const savedWarn = console.warn;
  const savedError = console.error;
  let logCall: unknown[] | undefined;
  let warnCall: unknown[] | undefined;
  let errorCall: unknown[] | undefined;
  (console as any).log = (...args: unknown[]) => { logCall = args; };
  (console as any).warn = (...args: unknown[]) => { warnCall = args; };
  (console as any).error = (...args: unknown[]) => { errorCall = args; };

  try {
    logger.log('hello', 42, { x: 1 });
    assert.deepStrictEqual(logCall, ['[main]', 'hello', 42, { x: 1 }]);
    assert.strictEqual(logCall?.[0], '[main]', 'log 应加 [main] 前缀');

    logger.warn('warn-msg', 1);
    assert.deepStrictEqual(warnCall, ['[main]', 'warn-msg', 1]);

    logger.error('error-msg');
    assert.deepStrictEqual(errorCall, ['[main]', 'error-msg']);
    console.log('✅ 1. log/warn/error 加 [main] 前缀');
  } finally {
    (console as any).log = savedLog;
    (console as any).warn = savedWarn;
    (console as any).error = savedError;
  }

  // ── 2. debug 默认隐藏（无 ELECTRON_ENABLE_VERBOSE） ──────────
  {
    const saved = console.log;
    let debugCalled = false;
    (console as any).log = () => { debugCalled = true; };
    delete process.env.ELECTRON_ENABLE_VERBOSE;
    try {
      logger.debug('should-not-log');
    } finally {
      (console as any).log = saved;
    }
    assert.strictEqual(debugCalled, false, '无 verbose 时 debug 应静默');
    console.log('✅ 2. debug 默认隐藏（无 ELECTRON_ENABLE_VERBOSE）');
  }

  // ── 3. ELECTRON_ENABLE_VERBOSE=1 时 debug 输出 ────────────────
  {
    const saved = console.log;
    let debugCall: unknown[] | undefined;
    (console as any).log = (...args: unknown[]) => { debugCall = args; };
    process.env.ELECTRON_ENABLE_VERBOSE = '1';
    try {
      logger.debug('debug-payload', 99);
    } finally {
      (console as any).log = saved;
      delete process.env.ELECTRON_ENABLE_VERBOSE;
    }
    assert.ok(debugCall, '应调一次 console.log');
    assert.strictEqual(debugCall?.[0], '[main]', 'debug 也加 [main] 前缀');
    assert.strictEqual(debugCall?.[1], '[debug]', 'debug 输出带 [debug] 子前缀');
    assert.strictEqual(debugCall?.[2], 'debug-payload');
    assert.strictEqual(debugCall?.[3], 99);
    console.log('✅ 3. ELECTRON_ENABLE_VERBOSE=1 → debug 输出');
  }

  console.log('\n🎉 全部 3 个 logger 测试通过');
}

main().catch((err) => {
  console.error('❌ logger 测试失败:', err);
  process.exit(1);
});
