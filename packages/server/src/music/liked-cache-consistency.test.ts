/**
 * T2 (consistency-fixes) 回归测试：likedCache / state.providers[p].liked 双真值源一致。
 *
 * 覆盖 4 个性质：
 *   1. toggleLike 后 getLikedSet 立即反映（含 likedCache 同步）
 *   2. markDisliked 后 detect 不再看到 liked（likedCache 同步清理）
 *   3. reconcileLiked 末尾把 reconciled next 回写 likedCache，
 *      下次 getLikedSet 读到的是 reconciled 集合（不是 raw remote）
 *   4. 在途 like（pendingTargets）不被 reconcile 抹掉（缓存反映 next 而非 raw remote）
 *
 * 与 like.e2e 不同：本文件直接 new MusicService，不依赖 NestJS 容器，
 * 用 stub ProviderSession + fakeSession util，单测焦点在 cache/state 同步。
 *
 * 运行: npx ts-node src/music/liked-cache-consistency.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-t2-'));
process.env.STORAGE_DIR = tmpDir;

const { MusicService } = require('./music.service');
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MatchService } = require('../match/match.service');

// 测试用 logger：保持安静
const quietProviders = () => ({
  qq: { fetchLikedMidSet: async () => new Set(), like: async () => true, unlike: async () => true },
  netease: { fetchLiked: async () => [], like: async () => true, unlike: async () => true, fmTrash: async () => true },
  spotify: { fetchLiked: async () => [], like: async () => ({ success: true }), unlike: async () => ({ success: true }), bindSessionId: () => {} },
  deezer: { getEditorials: () => [] },
  search: { searchUnified: async () => [] },
  lyricsOvh: { fetch: async () => null },
});

function makeSession() {
  return {
    id: 'test-session',
    providers: {
      qq: { qqCookie: 'fake-cookie' },
      netease: { musicU: 'fake-music-u' },
      spotify: { spotify: { accessToken: 'fake-tok', expiresAt: Date.now() + 3600_000 } },
    },
  };
}

// Shared storage across tests — state from earlier tests must be visible
// in later ones; debounced writes need explicit flush between tests.
let sharedStorage: any = null;

async function makeService() {
  const cfg = new ConfigService();
  if (!sharedStorage) sharedStorage = new StorageService(cfg);
  const storage = sharedStorage;
  storage.flushSync(); // make sure prior test's debounced writes are on disk
  const session = new SessionService(storage);
  const qs = quietProviders();
  const match = new MatchService(qs);
  const ms = new MusicService(
    storage,
    qs.qq,
    qs.netease,
    qs.deezer,
    qs.spotify,
    qs.lyricsOvh,
    match,
    require('./like-sync.queue').LikeSyncQueue,
  );
  // Note: passing the CLASS not an instance would error — fix:
  return null;
}

async function makeServiceV2() {
  const cfg = new ConfigService();
  if (!sharedStorage) sharedStorage = new StorageService(cfg);
  const storage = sharedStorage;
  storage.flushSync();
  const session = new SessionService(storage);
  const qs = quietProviders();
  const match = new MatchService(qs);
  const { LikeSyncQueue } = require('./like-sync.queue');
  const ms = new MusicService(
    storage,
    qs.qq,
    qs.netease,
    qs.deezer,
    qs.spotify,
    qs.lyricsOvh,
    match,
    new LikeSyncQueue(),
  );
  return { ms, session, storage };
}

// ── 1. toggleLike 后 getLikedSet 立即反映 ─────────────────────────
async function test1_toggleLike_immediate() {
  const { ms } = await makeServiceV2();
  const s = makeSession();

  // 模拟远端：QQ 没有任何 ❤
  ms.qq.fetchLikedMidSet = async () => new Set();

  // 先 prime 一下 cache，让 updateLikedCache 后续有 cache 可改
  await ms.isLikedOn(s, 'qq', 'track-x');
  const before = await ms.isLikedOn(s, 'qq', 'track-x');
  assert.strictEqual(before, false, 'prime 后 track-x 不应 ❤');

  // toggleLike → ❤
  const r = await ms.toggleLike(s, 'qq', 'track-x');
  assert.strictEqual(r.liked, true, 'toggleLike 应翻为 liked=true');

  // T2 修复点：likedCache 应同步写入；下次 isLikedOn 立即返 true
  const after = await ms.isLikedOn(s, 'qq', 'track-x');
  assert.strictEqual(after, true, 'toggleLike 后 getLikedSet 立即反映 ❤（likedCache 同步）');

  console.log('✅ 1. toggleLike 后 getLikedSet 立即反映');
}

// ── 2. markDisliked 后 detect 不再看到 liked ──────────────────────
async function test2_markDisliked_cacheCleaned() {
  const { ms } = await makeServiceV2();
  const s = makeSession();

  // 远端 = {track-a}
  ms.qq.fetchLikedMidSet = async () => new Set(['track-a']);

  await ms.isLikedOn(s, 'qq', 'track-a'); // prime
  assert.strictEqual(await ms.isLikedOn(s, 'qq', 'track-a'), true);

  // markDisliked → track-a 不再 ❤
  await ms.markDisliked(s, 'qq', 'track-a');

  // T2 修复点：likedCache 应被同步移除，下次 isLikedOn 不再返 true
  const after = await ms.isLikedOn(s, 'qq', 'track-a');
  assert.strictEqual(after, false, 'markDisliked 后 cache 同步清理（不复活）');

  console.log('✅ 2. markDisliked 后 detect 不再看到 liked');
}

// ── 3. reconcileLiked 末尾回写 likedCache ────────────────────────
async function test3_reconcile_writesCache() {
  const { ms } = await makeServiceV2();
  const s = makeSession();

  // 远端先为空（建空 cache）
  let remote = new Set();
  ms.qq.fetchLikedMidSet = async () => new Set(remote);
  await ms.isLikedOn(s, 'qq', 'whatever');

  // 改远端为包含 track-b；invalidate cache 让下次 fetch 重对账
  remote = new Set(['track-b']);
  (ms as any).likedCache.clear();

  // 第二次 isLikedOn 触发 reconcileLiked
  const set = await (ms as any).getLikedSet(s, 'qq');
  assert.ok(set instanceof Set, 'getLikedSet 返回 Set');
  assert.strictEqual(set!.has('track-b'), true, 'reconcile 后 cache 含 track-b');

  // cache 应被回写为 reconciled 集合
  const cached = (ms as any).likedCache.get(`test-session:qq`);
  assert.ok(cached, 'likedCache 已写入');
  assert.strictEqual(cached.set.has('track-b'), true, 'cache 内容是 reconciled');

  console.log('✅ 3. reconcileLiked 末尾回写 likedCache');
}

// ── 4. 在途 like 不被 reconcile 抹掉 ─────────────────────────────
//
// 直接验证 computeReconciledLiked 的输出 + 手动构造 in-flight target。
// 不依赖 LikeSyncQueue 的 drain 时序（fake provider 让 drain 跑得太快）。
async function test4_inflightPendingPreserved() {
  const { ms } = await makeServiceV2();
  const s = makeSession();

  // 远端 ❤ 列表**非空**（避免 reconcileLiked 「remote=0+local>0」保守分支）。
  const remote = new Set(['track-existing']);
  ms.qq.fetchLikedMidSet = async () => new Set(remote);

  // Prime cache 为 {track-existing}（走 fetch + reconcile）
  await ms.isLikedOn(s, 'qq', 'whatever');

  // 用户点 ❤ → writeLike(state, qq, track-c, true)，cache + state 同步写
  const state = (ms as any).loadState(s);
  (ms as any).writeLike(s, state, 'qq', 'track-c', true);
  (ms as any).saveState(s, state);

  // Monkey-patch pendingTargets：模拟「队列报告了一个 in-flight like」（这正是
  // pendingTargets 在 active + pending 期间返回的内容）。这样 reconcileLiked
  // 看到的就是「真实在途」语义，不受 fake drain 时序影响。
  const originalPending = (ms as any).likeSync.pendingTargets.bind(
    (ms as any).likeSync,
  );
  (ms as any).likeSync.pendingTargets = (sid: string) => {
    if (sid !== s.id) return [];
    return [{ platform: 'qq', trackId: 'track-c', liked: true }];
  };

  try {
    // expire cache 强制下次 fetch 重对账
    (ms as any).likedCache.clear();

    // reconcileLiked 计算 next = remote ∪ in-flight like
    // remote 没有 track-c，但有 in-flight like 应把 track-c 补进 next
    const set = await (ms as any).getLikedSet(s, 'qq');
    assert.strictEqual(set!.has('track-c'), true,
      'reconcile 后 cache 含 in-flight like（不被抹）');
    assert.strictEqual(set!.has('track-existing'), true,
      'reconcile 后 cache 保留已有 ❤');
  } finally {
    (ms as any).likeSync.pendingTargets = originalPending;
  }

  console.log('✅ 4. 在途 like 不被 reconcile 抹掉');
}

(async () => {
  try {
    await test1_toggleLike_immediate();
    await test2_markDisliked_cacheCleaned();
    await test3_reconcile_writesCache();
    await test4_inflightPendingPreserved();
    console.log('\n🎉 liked-cache-consistency 全部 4 项通过');
  } catch (e) {
    console.error('❌ failed:', e);
    process.exit(1);
  }
})();
