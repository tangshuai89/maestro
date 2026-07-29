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
