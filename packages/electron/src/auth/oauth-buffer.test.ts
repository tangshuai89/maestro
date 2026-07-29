/**
 * OAuthCallbackBuffer tests. Verifies push-without-consumer buffers,
 * consume drains the buffer, the consumer-via-push path works, and the
 * 10-min TTL is enforced.
 *
 * Run: npx ts-node packages/electron/src/auth/oauth-buffer.test.ts
 */
export {};
const assert = require('node:assert');

import { OAuthCallbackBuffer, OAUTH_BUFFER_TTL_MS } from './oauth-buffer';

const realNow = Date.now;

function withFakeTime<T>(fn: () => Promise<T> | T): Promise<T> | T {
  let now = 1_000_000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Date as any).now = () => now;
  const restore = (): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Date as any).now = realNow;
  };
  const ret = fn();
  if (ret && typeof (ret as Promise<T>).then === 'function') {
    return (ret as Promise<T>).finally(restore);
  }
  restore();
  return ret;
}

async function tick(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

void (async () => {

// ── 1. push without consumer: buffer holds the entry ─────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('code1', 'state1');
  const peeked = b.peek();
  assert.ok(peeked);
  assert.strictEqual(peeked!.code, 'code1');
  console.log('✅ 1. push without consumer: buffered');
});

// ── 2. consume drains the buffer ────────────────────────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('code2', 'state2');
  const got = await b.consume();
  assert.ok(got);
  assert.strictEqual(got!.code, 'code2');
  assert.strictEqual(got!.state, 'state2');
  assert.strictEqual(b.peek(), null);
  console.log('✅ 2. consume: drains buffer, second peek=null');
});

// ── 3. consumer-first: push while consumer registered, flushes immediately ─
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const p = b.consume();
  b.push('code3', 'state3');
  const got = await p;
  assert.ok(got);
  assert.strictEqual(got!.code, 'code3');
  console.log('✅ 3. consumer first: push flushes to waiting consumer');
});

// ── 4. TTL: entry older than 10 min is dropped ──────────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('code4', 'state4');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Date as any).now = () => 1_000_000 + OAUTH_BUFFER_TTL_MS + 1_000;
  const got = await b.consume();
  assert.strictEqual(got, null, 'expired entry must be dropped');
  console.log('✅ 4. TTL: entry older than 10 min dropped on consume');
});

// ── 5. OAUTH_BUFFER_TTL_MS = 10 min ────────────────────────────────────
{
  assert.strictEqual(OAUTH_BUFFER_TTL_MS, 600_000);
  console.log('✅ 5. OAUTH_BUFFER_TTL_MS = 600_000 (10 min)');
}

// ── 6. second push replaces first when no consumer ──────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('old', 's1');
  b.push('new', 's2');
  const got = await b.consume();
  assert.strictEqual(got!.code, 'new', 'newer push wins');
  console.log('✅ 6. newer push replaces older');
});

// ── 7. consumer-via-push: second push after consumer already resolved ──
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('first', 's1');
  const r1 = await b.consume();
  assert.strictEqual(r1!.code, 'first');
  const p = b.consume();
  b.push('second', 's2');
  const r2 = await p;
  assert.strictEqual(r2!.code, 'second');
  console.log('✅ 7. push after consume: registers new consumer, flushes');
});

void tick;

console.log('\n🎉 oauth-buffer.test.ts: all 7 cases passed');
})();
