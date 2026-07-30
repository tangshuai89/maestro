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
import type { BufferedCallback, BufferedError, BufferedOAuthEntry } from './oauth-buffer';

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
  const peeked = b.peek() as BufferedCallback | null;
  assert.ok(peeked);
  assert.strictEqual(peeked!.code, 'code1');
  console.log('✅ 1. push without consumer: buffered');
});

// ── 2. consume drains the buffer ────────────────────────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('code2', 'state2');
  const got = (await b.consume()) as BufferedCallback | null;
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
  const got = (await p) as BufferedCallback | null;
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
  const got = (await b.consume()) as BufferedCallback | null;
  assert.strictEqual(got!.code, 'new', 'newer push wins');
  console.log('✅ 6. newer push replaces older');
});

// ── 7. consumer-via-push: second push after consumer already resolved ──
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('first', 's1');
  const r1 = (await b.consume()) as BufferedCallback | null;
  assert.strictEqual(r1!.code, 'first');
  const p = b.consume();
  b.push('second', 's2');
  const r2 = (await p) as BufferedCallback | null;
  assert.strictEqual(r2!.code, 'second');
  console.log('✅ 7. push after consume: registers new consumer, flushes');
});

// ── 8. pushError: error entry surfaces to consumer ──────────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const p = b.consume();
  b.pushError('access_denied', 's9', 'maestro://x?error=access_denied');
  const got = (await p) as BufferedError | null;
  assert.ok(got);
  assert.strictEqual((got as BufferedError).error, 'access_denied');
  assert.strictEqual(got!.state, 's9');
  console.log('✅ 8. pushError: OAuth error surfaces to waiting consumer');
});

// ── 9. hasError / peek: distinguishes error vs success ──────────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('c', 's');
  assert.strictEqual(b.hasError(), false);
  const peeked = b.peek() as BufferedCallback | null;
  assert.strictEqual(peeked!.code, 'c');
  // New buffer → error
  const b2 = new OAuthCallbackBuffer();
  b2.pushError('access_denied', undefined, 'maestro://x?error=access_denied');
  assert.strictEqual(b2.hasError(), true);
  console.log('✅ 9. hasError distinguishes success vs error');
});

// ── 10. concurrent consume (Strict Mode double-mount) ───────────────────
// Two consume() calls back-to-back before push() — both must resolve to
// the same payload when it arrives. Old single-consumer code overwrote
// the second consumer's resolver with the first's, leaking the first
// Promise forever. With the FIFO queue both Promises settle.
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const p1 = b.consume();
  const p2 = b.consume();
  // Both waiters enqueued before push.
  assert.strictEqual(b.peek(), null);
  b.push('code10', 'state10');
  const [r1, r2] = (await Promise.all([p1, p2])) as [
    BufferedCallback | null,
    BufferedCallback | null,
  ];
  assert.ok(r1 && r2, 'both concurrent consumers must resolve');
  assert.strictEqual(r1!.code, 'code10');
  assert.strictEqual(r2!.code, 'code10');
  // FIFO order: first registered gets the first deliver call.
  assert.strictEqual(r1!.state, 'state10');
  console.log('✅ 10. concurrent consume (Strict Mode race): both resolve');
});

// ── 11. FIFO order: consumers drain in registration order ───────────────
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const order: number[] = [];
  const promises: Promise<BufferedOAuthEntry | null>[] = [];
  // Register 5 waiters in order.
  for (let i = 0; i < 5; i++) {
    promises.push(
      b.consume().then((cb) => {
        order.push(i);
        return cb;
      }),
    );
  }
  b.push('code11', 'state11');
  await Promise.all(promises);
  assert.deepStrictEqual(
    order,
    [0, 1, 2, 3, 4],
    'consumers drain in FIFO order',
  );
  console.log('✅ 11. FIFO drain order preserved');
});

// ── 12. after push drain, late consume() blocks (one-shot semantics) ─────
// Once a push has been delivered to all current waiters, a NEW consume()
// (registered AFTER the push) should NOT get the same entry — Spotify
// OAuth codes are one-shot. It must block until the next push.
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  b.push('code12', 'state12');
  const r1 = (await b.consume()) as BufferedCallback | null;
  assert.strictEqual(r1!.code, 'code12');
  // Late consumer should NOT see the already-consumed code.
  const late = b.consume();
  let lateResolved = false;
  void late.then(() => {
    lateResolved = true;
  });
  await tick(50);
  assert.strictEqual(lateResolved, false, 'late consume must not see stale code');
  // It should resolve when a NEW push arrives.
  b.push('code13', 'state13');
  const r2 = (await late) as BufferedCallback | null;
  assert.strictEqual(r2!.code, 'code13');
  console.log('✅ 12. late consume() blocks until next push (no code replay)');
});

void tick;

console.log('\n🎉 oauth-buffer.test.ts: all 12 cases passed');
})();
