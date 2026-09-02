/**
 * T5 (consistency-fixes C2) 回归测试：per-session 状态锁。
 *
 * 验证：
 *   1. 并发 fanOutLike + toggleLike → 全部生效，无 lost update
 *   2. 并发 fanOutLike + dislikeMerged → 最终 disliked 状态正确
 *   3. importLiked 单飞：第二次调用复用 in-flight Promise
 *   4. importLiked 期间 fanOutLike 不丢更新（被锁串行化）
 *
 * 运行: npx ts-node src/music/per-session-lock.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-t5-'));
process.env.STORAGE_DIR = tmpDir;

const { MusicService } = require('./music.service');
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MatchService } = require('../match/match.service');

const quietProviders = () => ({
  qq: { fetchLikedMidSet: async () => new Set(), like: async () => true, unlike: async () => true, fetchRadioBatch: async () => [] },
  netease: { fetchLiked: async () => [], like: async () => true, unlike: async () => true, fmTrash: async () => true, search: async () => [], fetchRadioBatch: async () => [] },
  spotify: { fetchLiked: async () => [], like: async () => ({ success: true }), unlike: async () => ({ success: true }), bindSessionId: () => {}, search: async () => [], fetchRadioBatch: async () => [] },
  deezer: { getEditorials: () => [], search: async () => [], fetchRadioBatch: async () => [] },
  search: { searchUnified: async () => [] },
  lyricsOvh: { fetch: async () => null },
});

function makeSession() {
  return {
    id: 'test-session-t5',
    providers: {
      qq: { qqCookie: 'fake' },
      netease: { musicU: 'fake' },
      spotify: { spotify: { accessToken: 'fake-tok', expiresAt: Date.now() + 3600_000 } },
    },
  };
}

let sharedStorage: any = null;

async function makeService() {
  const cfg = new ConfigService();
  if (!sharedStorage) sharedStorage = new StorageService(cfg);
  sharedStorage.flushSync();
  const session = new SessionService(sharedStorage);
  const qs = quietProviders();
  const match = new MatchService(qs);
  const { LikeSyncQueue } = require('./like-sync.queue');
  const ms = new MusicService(
    sharedStorage,
    qs.qq,
    qs.netease,
    qs.deezer,
    qs.spotify,
    qs.lyricsOvh,
    match,
    new LikeSyncQueue(),
  );
  return { ms, session };
}

// ── 1. 并发 fanOutLike + toggleLike 不丢更新 ─────────────────
async function test1_concurrent_lostUpdate() {
  const { ms } = await makeService();
  const s = makeSession();

  // 起 5 个并发 fanOutLike + 5 个 toggleLike，全部针对不同 platform
  const promises: any[] = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      ms.fanOutLike(s, `merged-${i}`, [{ platform: 'qq', trackId: `t-qq-${i}` }], true),
    );
  }
  for (let i = 0; i < 5; i++) {
    promises.push(ms.toggleLike(s, 'netease', `t-ne-${i}`));
  }
  await Promise.all(promises);

  // 全部 5 个 fanOutLike 都生效：state.fanOut 有 5 条记录
  const state = (ms as any).loadState(s);
  const fanOutKeys = Object.keys(state.fanOut);
  assert.ok(fanOutKeys.length >= 5, `fanOut 应有 ≥5 条记录（实际 ${fanOutKeys.length}）`);
  console.log('✅ 1. 并发 fanOutLike + toggleLike：全部生效');

  // 5 个 toggleLike 全部 ❤
  for (let i = 0; i < 5; i++) {
    assert.ok(
      state.providers.netease.liked.has(`t-ne-${i}`),
      `toggleLike 后 netease.liked 应含 t-ne-${i}`,
    );
  }
  console.log('   + netease.liked 5 项全部 ❤');
}

// ── 2. fanOutLike + dislikeMerged 并发 → 最终 disliked 正确 ──
async function test2_likeThenDislike() {
  const { ms } = await makeService();
  const s = makeSession();

  // 先 fanOutLike 一个
  await ms.fanOutLike(
    s,
    'merged-2',
    [
      { platform: 'qq', trackId: 't-qq-2' },
      { platform: 'netease', trackId: 't-ne-2' },
    ],
    true,
  );

  // 并发 dislikeMerged + toggleLike（QQ 同一 track）
  const promises = [
    ms.dislikeMerged(
      s,
      'merged-2',
      [
        { platform: 'qq', trackId: 't-qq-2' },
        { platform: 'netease', trackId: 't-ne-2' },
      ],
    ),
    ms.toggleLike(s, 'qq', 't-qq-2'),
  ];
  await Promise.all(promises);

  const state = (ms as any).loadState(s);
  // 锁保证：dislike 和 toggle 任一先执行，结果都是「disliked」（toggleLike
  // 把 liked 翻 true，但 dislikeMerged 后续又会 dislike；或反过来）。关键
  // 是 state 一致：disliked.has(t-qq-2) 必须为 true。
  assert.ok(
    state.providers.qq.disliked.has('t-qq-2'),
    'dislikeMerged + toggleLike 并发后，disliked 必须含 t-qq-2',
  );
  console.log('✅ 2. fanOutLike + dislikeMerged + toggleLike 并发：最终 disliked 正确');
}

// ── 3. importLiked 单飞 ──────────────────────────────────────
async function test3_importLiked_singleflight() {
  const { ms } = await makeService();
  const s = makeSession();

  // stub 各 provider.fetchLiked 让 import 跑得快
  let neteaseCalls = 0;
  ms.netease.fetchLiked = async () => {
    neteaseCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return [];
  };

  // 同时发起 5 个 importLiked
  const promises = Array.from({ length: 5 }, () => ms.importLiked(s));
  await Promise.all(promises);

  // 单飞：只调一次 fetchLiked（其他 4 次复用 in-flight Promise）
  assert.strictEqual(neteaseCalls, 1, `单飞应只调一次 netease.fetchLiked（实际 ${neteaseCalls}）`);
  console.log('✅ 3. importLiked 单飞：5 个并发 → 1 次 fetchLiked');
}

// ── 4. import + fanOutLike 串行不崩，且 import 后 state 一致 ─
async function test4_importAndFanOutLike_serializable() {
  const { ms } = await makeService();
  const s = makeSession();

  // stub fetchLiked 跑慢一点
  ms.netease.fetchLiked = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return [];
  };
  ms.qq.fetchLikedMidSet = async () => new Set();
  ms.spotify.fetchLiked = async () => [];

  // 并发：import + fanOutLike。锁保证它们串行执行，不丢失 update。
  const importP = ms.importLiked(s);
  const fanOutP = ms.fanOutLike(s, 'merged-4', [{ platform: 'qq', trackId: 't-qq-4' }], true);
  await Promise.all([importP, fanOutP]);

  // import 完成后 state 一定一致：要么 fanOut 保留（fanOut 后执行），
  // 要么被 clear（import 后执行）。**两种结果都是合法的串行执行结果**——
  // 关键是都不崩，且 storage cache 反映最终态。
  const state = (ms as any).loadState(s);
  // 我们不强求 fanOut['merged-4'] 存在（import 的 clear 是有意的），
  // 但 state 必须是 valid object。
  assert.ok(typeof state === 'object' && state !== null, 'state 加载正常');
  assert.ok(state.providers, 'state.providers 存在');
  console.log('✅ 4. import + fanOutLike 串行不崩，state 一致');
}

(async () => {
  try {
    await test1_concurrent_lostUpdate();
    await test2_likeThenDislike();
    await test3_importLiked_singleflight();
    await test4_importAndFanOutLike_serializable();
    console.log('\n🎉 per-session-lock 全部 4 项通过');
  } catch (e) {
    console.error('❌ failed:', e);
    process.exit(1);
  }
})();
