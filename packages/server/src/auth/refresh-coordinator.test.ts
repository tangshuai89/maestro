/**
 * RefreshCoordinator unit tests. Verifies single-flight per sessionId.
 *
 * Run: npx ts-node packages/server/src/auth/refresh-coordinator.test.ts
 */
export {};
const assert = require('node:assert');

import { RefreshCoordinator } from './refresh-coordinator';

void (async () => {

// ── 1. run: single sessionId, sequential calls each fire ────────────────
{
  const c = new RefreshCoordinator();
  const a = await c.run('s1', async () => 'a');
  const b = await c.run('s1', async () => 'b');
  assert.strictEqual(a, 'a');
  assert.strictEqual(b, 'b');
  assert.strictEqual(c.size(), 0, 'inflight cleaned up');
  console.log('✅ 1. sequential: each call runs independently');
}

// ── 2. concurrent same sessionId: doRefresh fires once ──────────────────
{
  const c = new RefreshCoordinator();
  let calls = 0;
  const slow = (): Promise<string> =>
    new Promise((r) => setTimeout(() => r((++calls).toString()), 20));
  const promises = [
    c.run('s2', slow),
    c.run('s2', slow),
    c.run('s2', slow),
  ];
  const out = await Promise.all(promises);
  assert.strictEqual(calls, 1, 'doRefresh invoked exactly once');
  assert.deepStrictEqual(out, ['1', '1', '1'], 'all callers got the same result');
  assert.strictEqual(c.size(), 0);
  console.log('✅ 2. concurrent same sessionId: 1 fetch, 3 callers share result');
}

// ── 3. concurrent different sessionIds: each fires ─────────────────────
{
  const c = new RefreshCoordinator();
  let calls = 0;
  const slow = (label: string) => async (): Promise<string> => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return label;
  };
  const out = await Promise.all([
    c.run('sA', slow('A')),
    c.run('sB', slow('B')),
    c.run('sC', slow('C')),
  ]);
  assert.strictEqual(calls, 3, 'one refresh per sessionId');
  assert.deepStrictEqual(out, ['A', 'B', 'C']);
  console.log('✅ 3. concurrent different sessionIds: each fires');
}

// ── 4. failure: inflight cleaned, retry can run again ─────────────────
{
  const c = new RefreshCoordinator();
  let calls = 0;
  const flaky = (): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.reject(new Error('boom'));
    return Promise.resolve('ok');
  };
  await assert.rejects(c.run('sX', flaky));
  assert.strictEqual(c.size(), 0, 'inflight cleaned on failure');
  const v = await c.run('sX', flaky);
  assert.strictEqual(v, 'ok');
  assert.strictEqual(calls, 2);
  console.log('✅ 4. failure: cleans inflight, retry runs again');
}

// ── 5. reset: clears all in-flight (does not cancel work) ──────────────
{
  const c = new RefreshCoordinator();
  const hanging = (): Promise<string> =>
    new Promise((r) => setTimeout(() => r('late'), 100));
  const p = c.run('sY', hanging);
  c.reset();
  assert.strictEqual(c.size(), 0);
  const v = await c.run('sY', () => Promise.resolve('fresh'));
  assert.strictEqual(v, 'fresh');
  await p;
  console.log('✅ 5. reset: clears inflight, next call runs fresh');
}

console.log('\n🎉 refresh-coordinator.test.ts: all 5 cases passed');
})();
