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
// T9 (consistency-fixes F2)：每次 push 只 resolve 一个 waiter（FIFO 头）。
// 旧测试期望「两个并发 consumer 都拿到 code」——这正是 spec 修复的 bug
// （同一 PKCE code 被多次兑换 → 第二次 invalid_grant）。新语义：第一个
// consumer 拿到 entry 并 resolve，第二个继续等下一次 push。
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const p1 = b.consume();
  const p2 = b.consume();
  assert.strictEqual(b.peek(), null);
  b.push('code10', 'state10');
  const r1 = (await p1) as BufferedCallback | null;
  assert.ok(r1);
  assert.strictEqual(r1!.code, 'code10');
  // p2 仍 pending（没拿到 code）
  let r2Resolved = false;
  void p2.then(() => {
    r2Resolved = true;
  });
  await tick(50);
  assert.strictEqual(r2Resolved, false,
    'FIFO-head-only: 第二个 consumer 应继续等下一次 push');
  // 推到下一个 push → p2 拿到新 code
  b.push('code10b', 'state10b');
  const r2 = (await p2) as BufferedCallback | null;
  assert.ok(r2);
  assert.strictEqual(r2!.code, 'code10b');
  console.log('✅ 10. concurrent consume: 只有 FIFO 头 resolve（避免 PKCE code 重复兑换）');
});

// ── 11. FIFO head: only first registered gets the push ──────────────────
// T9 F2：每次 push 只 resolve 队首一个 waiter。后续 consume() 仍排在
// 队列里等下一次 push——避免一个 OAuth code 被多 consumer 兑换多次。
await withFakeTime(async () => {
  const b = new OAuthCallbackBuffer();
  const order: number[] = [];
  const promises: Promise<BufferedOAuthEntry | null>[] = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      b.consume().then((cb) => {
        order.push(i);
        return cb;
      }),
    );
  }
  b.push('code11', 'state11');
  // 只有第一个 resolve
  const r0 = (await promises[0]) as BufferedCallback | null;
  assert.ok(r0);
  assert.strictEqual(r0!.code, 'code11');
  // 其他 4 个仍 pending
  let othersResolved = false;
  Promise.all(promises.slice(1)).then(() => {
    othersResolved = true;
  });
  await tick(50);
  assert.strictEqual(othersResolved, false,
    'FIFO-head-only: 第 2-5 个 consumer 应继续 pending');
  assert.deepStrictEqual(order, [0],
    '只有第一个注册的 consumer resolve');
  console.log('✅ 11. FIFO head: 只有队首 consumer 拿到 entry');
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
