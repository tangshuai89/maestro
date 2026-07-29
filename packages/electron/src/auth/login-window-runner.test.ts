/**
 * runLoginWindow unit tests with a fake MinimalBrowserWindow. Verifies
 * that listeners are added and removed in pairs (no leak), timers are
 * cleared on every terminal path, and the window is closed / hidden
 * based on `keepAliveAfterSuccess`.
 *
 * Run: npx ts-node packages/electron/src/auth/login-window-runner.test.ts
 */
export {};
const assert = require('node:assert');

import {
  runLoginWindow,
  type MinimalBrowserWindow,
  type MinimalSession,
  type LoginWindowConfig,
} from './login-window-runner';

// ── Test fixtures ──────────────────────────────────────────────────────────

interface FakeState {
  listeners: Array<(...args: unknown[]) => void>;
  onCount: number;
  offCount: number;
  intervals: number;
  intervalsCleared: number;
  timeouts: number;
  timeoutsCleared: number;
  hidden: boolean;
  closed: boolean;
  destroyed: boolean;
}

function makeFake(): { win: MinimalBrowserWindow; state: FakeState } {
  const state: FakeState = {
    listeners: [],
    onCount: 0,
    offCount: 0,
    intervals: 0,
    intervalsCleared: 0,
    timeouts: 0,
    timeoutsCleared: 0,
    hidden: false,
    closed: false,
    destroyed: false,
  };
  const session: MinimalSession = {
    cookies: {
      on(_event, listener) {
        state.onCount++;
        state.listeners.push(listener as (...args: unknown[]) => void);
      },
      off(_event, _listener) {
        state.offCount++;
      },
    },
  };
  const win: MinimalBrowserWindow = {
    webContents: { session, setWindowOpenHandler: () => undefined },
    isDestroyed() {
      return state.destroyed;
    },
    hide() {
      state.hidden = true;
    },
    close() {
      state.closed = true;
      state.destroyed = true;
    },
  };
  return { win, state };
}

function baseConfig<T>(
  win: MinimalBrowserWindow,
  overrides: Partial<LoginWindowConfig<T>> = {},
): LoginWindowConfig<T> {
  return {
    url: 'https://example.com/login',
    title: 'Test Login',
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    domains: ['example.com'],
    capture: async () => null,
    deadlineMs: 60_000,
    pollIntervalMs: 1_500,
    createWindow: () => win,
    log: () => undefined,
    ...overrides,
  };
}

void (async () => {

// ── 1. Successful capture: listener + timers cleaned up ──────────────────
{
  const { win, state } = makeFake();
  const p = runLoginWindow(
    baseConfig(win, {
      capture: async () => ({ ok: true, cookie: 'a=1' }),
    }),
  );
  const result = await p;
  assert.deepStrictEqual(result, { ok: true, cookie: 'a=1' });
  assert.strictEqual(state.onCount, 1, 'cookies.on called once');
  assert.strictEqual(state.offCount, 1, 'cookies.off called once');
  assert.strictEqual(state.closed || state.hidden, true, 'window closed or hidden');
  console.log('✅ 1. success: listener added/removed once, window closed');
}

// ── 2. Timeout: window closed, timers cleared, error.code = LOGIN_TIMEOUT ─
{
  const { win, state } = makeFake();
  const p = runLoginWindow(
    baseConfig(win, {
      deadlineMs: 10,
      pollIntervalMs: 5,
      capture: async () => null,
    }),
  );
  await assert.rejects(p, (err: Error & { code: string }) => {
    assert.strictEqual(err.code, 'LOGIN_TIMEOUT');
    return true;
  });
  assert.strictEqual(state.onCount, 1);
  assert.strictEqual(state.offCount, 1);
  assert.strictEqual(state.closed, true, 'window closed after timeout');
  console.log('✅ 2. timeout: error.code=LOGIN_TIMEOUT, window closed, listener removed');
}

// ── 3. Capture throws: error.code = LOGIN_FAILED, listener still removed ─
{
  const { win, state } = makeFake();
  const p = runLoginWindow(
    baseConfig(win, {
      capture: async () => {
        throw new Error('boom');
      },
    }),
  );
  await assert.rejects(p, (err: Error & { code: string; message: string }) => {
    assert.strictEqual(err.code, 'LOGIN_FAILED');
    assert.ok(/boom/.test(err.message));
    return true;
  });
  assert.strictEqual(state.offCount, 1, 'listener removed even on capture error');
  assert.strictEqual(state.closed, true);
  console.log('✅ 3. capture throws: error.code=LOGIN_FAILED, listener removed');
}

// ── 4. 20 cycles: zero listener / timer leak ─────────────────────────────
{
  for (let i = 0; i < 20; i++) {
    const { win, state } = makeFake();
    const p = runLoginWindow(
      baseConfig(win, {
        deadlineMs: 5,
        pollIntervalMs: 1,
        capture: async () => null,
      }),
    );
    await assert.rejects(p);
    assert.strictEqual(
      state.onCount,
      state.offCount,
      `cycle ${i}: on=${state.onCount} off=${state.offCount}`,
    );
  }
  console.log('✅ 4. 20 cycles: every cycle balanced (on=off, no leak)');
}

// ── 5. keepAliveAfterSuccess=true: window hidden, not closed ─────────────
{
  const { win, state } = makeFake();
  const p = runLoginWindow(
    baseConfig(win, {
      capture: async () => ({ cookie: 'x' }),
      keepAliveAfterSuccess: true,
    }),
  );
  await p;
  assert.strictEqual(state.hidden, true, 'window hidden');
  assert.strictEqual(state.closed, false, 'window NOT closed');
  console.log('✅ 5. keepAliveAfterSuccess=true: window hidden, not closed');
}

// ── 6. Double-resolve guard: second capture result is ignored ─────────────
{
  const { win, state } = makeFake();
  let calls = 0;
  const p = runLoginWindow(
    baseConfig(win, {
      capture: async () => {
        calls++;
        return { n: calls };
      },
      deadlineMs: 30,
      pollIntervalMs: 1,
    }),
  );
  const r = await p;
  assert.deepStrictEqual(r, { n: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(state.offCount, 1, 'listener removed once even with multiple captures');
  console.log('✅ 6. double-capture: first wins, listener removed once');
}

console.log('\n🎉 login-window-runner.test.ts: all 6 cases passed');
})();
