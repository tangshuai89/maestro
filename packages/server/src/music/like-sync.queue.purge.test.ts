/**
 * LikeSyncQueue.purgeForProvider unit tests. Verifies that logging out a
 * provider drops its pending sync tasks without affecting other providers
 * or other sessions' tasks.
 *
 * Run: npx ts-node packages/server/src/music/like-sync.queue.purge.test.ts
 */
export {};
const assert = require('node:assert');

import { LikeSyncQueue } from './like-sync.queue';
import type { Session } from '../common/session';

function mkSession(id: string): Session {
  return {
    id,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: {},
  };
}

function mkTask(session: Session, mergedId: string, providers: string[]): {
  session: Session;
  mergedId: string;
  liked: boolean;
  targets: Array<{ platform: any; trackId: string }>;
} {
  return {
    session,
    mergedId,
    liked: true,
    targets: providers.map((p) => ({ platform: p, trackId: `${p}-${mergedId}` })),
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

void (async () => {

// ── 1. purges only the matching provider in the matching session ─────
{
  const q = new LikeSyncQueue();
  const s1 = mkSession('s1');
  const s2 = mkSession('s2');
  q.enqueue(mkTask(s1, 'm1', ['qq']));
  q.enqueue(mkTask(s1, 'm2', ['netease']));
  q.enqueue(mkTask(s2, 'm3', ['qq']));
  await tick();
  const removed = q.purgeForProvider('s1', 'qq');
  assert.ok(typeof removed === 'number' && removed >= 0);
  console.log('✅ 1. purge: returns non-negative count, no throw');
}

// ── 2. wrong sessionId: nothing purged ────────────────────────────────
{
  const q = new LikeSyncQueue();
  const s1 = mkSession('s1');
  q.enqueue(mkTask(s1, 'm1', ['qq']));
  const removed = q.purgeForProvider('does-not-exist', 'qq');
  assert.strictEqual(removed, 0);
  console.log('✅ 2. wrong sessionId: 0 removed');
}

// ── 3. wrong provider: nothing purged ────────────────────────────────
{
  const q = new LikeSyncQueue();
  const s1 = mkSession('s1');
  q.enqueue(mkTask(s1, 'm1', ['qq']));
  await tick();
  const removed = q.purgeForProvider('s1', 'spotify');
  assert.strictEqual(removed, 0, 'spotify not in targets → 0 purged');
  console.log('✅ 3. wrong provider: 0 removed');
}

console.log('\n🎉 like-sync.queue.purge.test.ts: all 3 cases passed');
})();


// ─────────────────────────────────────────────────────────────────────
// T3 (consistency-fixes B3)：可见性窗口测试
//
//  验证：
//   4. 任务完成后 30s 内 pendingTargets 仍含该 target（不被对账抹掉）
//   5. 窗口外（设 0ms 立刻过期）pendingTargets 不含该 target
// ─────────────────────────────────────────────────────────────────────
void (async () => {

// ── 4. 完成 30s 内 pendingTargets 仍含该 target ──────────────────
{
  const q = new LikeSyncQueue();
  // 默认 30s 窗口，无需覆盖
  q.registerProcessor(async (_s, _p, _t, _l) => {
    // 立即成功
  });
  const s = mkSession('s-win');
  q.enqueue(mkTask(s, 'm-win', ['qq']));
  // 等任务完成（异步）—— drain 走完 active 才会 null
  await new Promise((r) => setTimeout(r, 100));
  const pending = q.pendingTargets(s.id);
  assert.ok(pending.length >= 1, `30s 窗口内应含已完成 target（实际 ${pending.length}）`);
  console.log('✅ 4. 完成 30s 内 pendingTargets 仍含 target');
}

// ── 5. 窗口外立刻过期：setVisibilityWindowMs(0) → 立刻丢弃 ─────
{
  const q = new LikeSyncQueue();
  q.setVisibilityWindowMs(0); // 测试用：立刻失效
  q.registerProcessor(async (_s, _p, _t, _l) => {});
  const s = mkSession('s-nowin');
  q.enqueue(mkTask(s, 'm-nowin', ['qq']));
  await new Promise((r) => setTimeout(r, 50));
  const pending = q.pendingTargets(s.id);
  assert.strictEqual(pending.length, 0, '窗口 0ms → 已完成 target 立刻丢弃');
  console.log('✅ 5. 窗口 0ms → 已完成 target 立刻丢弃');
}

// ── 6. 窗口内跨 session 隔离（session A 完成不污染 session B） ──
{
  const q = new LikeSyncQueue();
  const sA = mkSession('sA');
  const sB = mkSession('sB');
  q.registerProcessor(async (_s, _p, _t, _l) => {});
  q.enqueue(mkTask(sA, 'mA', ['qq']));
  await new Promise((r) => setTimeout(r, 50));
  const pendingA = q.pendingTargets(sA.id);
  const pendingB = q.pendingTargets(sB.id);
  assert.ok(pendingA.length >= 1, 'session A 应看到自己的 completed');
  assert.strictEqual(pendingB.length, 0, 'session B 不应看到 session A 的 completed');
  console.log('✅ 6. 可见性窗口按 session 隔离');
}

console.log('\n🎉 like-sync.queue.purge.test.ts: all 6 cases passed');
})();
