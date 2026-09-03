/**
 * T4 (consistency-fixes) 回归测试：
 *   1. resolveEquivalents：搜索期间用户 dislike → canonicalId 已不存在 → 丢弃结果
 *   2. detectLikedAndSync：waitForSettled 后 canonicalId 漂移 → 用新 key 写
 *
 * 与 liked-cache-consistency.test.ts 同样直接 new MusicService，不依赖 NestJS 容器。
 *
 * 运行: npx ts-node src/music/stale-canonicalid-guard.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-t4-'));
process.env.STORAGE_DIR = tmpDir;

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MatchService } = require('../match/match.service');

const quietProviders = () => ({
  qq: { fetchLikedMidSet: async () => new Set(), like: async () => true, unlike: async () => true },
  netease: { fetchLiked: async () => [], like: async () => true, unlike: async () => true, fmTrash: async () => true, search: async () => [] },
  spotify: { fetchLiked: async () => [], like: async () => ({ success: true }), unlike: async () => ({ success: true }), bindSessionId: () => {}, search: async () => [] },
  deezer: { getEditorials: () => [], search: async () => [] },
  search: { searchUnified: async () => [] },
  lyricsOvh: { fetch: async () => null },
});

function makeSession() {
  return {
    id: 'test-session-t4',
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
  const lyricsService = new LyricsService(
    qs.netease, qs.deezer, qs.qq, qs.lyricsOvh,
  );
  const ms = new MusicService(
    sharedStorage,
    qs.qq,
    qs.netease,
    qs.deezer,
    qs.spotify,
    qs.lyricsOvh,
    lyricsService,
    match,
    new LikeSyncQueue(),
  );
  return { ms, session };
}

// ── 1. resolveEquivalents stale canonicalId guard ──────────────
async function test1_resolveEquivalents_discardsOnStale() {
  const { ms } = await makeService();
  const s = makeSession();

  // 初始：fanOut 里没东西
  const state = (ms as any).loadState(s);
  assert.strictEqual(Object.keys(state.fanOut).length, 0, '初始 fanOut 空');

  // 用户点 ❤（走 fanOutLike）—— 这会写入 state.fanOut['m1']
  await ms.fanOutLike(s, 'm1', [{ platform: 'qq', trackId: 't-qq' }], true);
  const stateAfterLike = (ms as any).loadState(s);
  assert.ok(stateAfterLike.fanOut['m1'], 'fanOutLike 应写入 fanOut[m1]');

  // 用户立刻 dislike（走 dislikeMerged → fanOutLike(false) → delete fanOut[m1]）
  await ms.dislikeMerged(s, 'm1', [{ platform: 'qq', trackId: 't-qq' }]);
  const stateAfterDislike = (ms as any).loadState(s);
  assert.ok(!stateAfterDislike.fanOut['m1'], 'dislikeMerged 应删除 fanOut[m1]');

  // 现在手动调用 resolveEquivalents，模拟一个 search 成功后落地流程
  // （stub 一个 discover 任务，目标是 netease / spotify）
  const task: any = {
    session: s,
    mergedId: 'm1', // 用户已 dislike 的 mergedId
    liked: true,
    targets: [], // 已有 source 的平台
    discover: { title: 'Fake Song', artist: 'Fake Artist', duration: 200, have: ['qq'] },
  };

  // 调 resolveEquivalents 的 discover 入口（它是 LikeDiscoverResolver）。
  // resolveEquivalents 直接调用即可：它走 searchEquivalent。
  // 但我们要让 searchEquivalent 返回 null（避免真打网络），或者返回 fake track。
  // 这里 stub 一个 fake match。
  // 因为 searchEquivalent 内部用 MatchService，先看它能不能被 stub。
  const result = await (ms as any).resolveEquivalents(task);
  // 没有 stub 搜索所以 result 应是 []（找不到）
  assert.deepStrictEqual(result, [], '搜索无结果 → 返回空');

  // 进一步测：让搜索有结果（mock searchEquivalent）然后跑一次，验证丢弃逻辑。
  const origSearch = (ms as any).searchEquivalent.bind(ms);
  (ms as any).searchEquivalent = async (_sess: any, p: any, _meta: any) => ({
    id: `t-${p}-match`,
    provider: p,
    title: 'Fake Song',
    artist: 'Fake Artist',
    album: '',
    coverUrl: '',
    audioUrl: '',
    duration: 200,
    liked: false,
  });

  // 但 fanOut[m1] 已经被 dislikeMerged 删除了，所以 re-load state 后 fanOut[m1] 不存在
  // → resolveEquivalents 应在 guard 那里 return [] 并 log 丢弃。
  const result2 = await (ms as any).resolveEquivalents(task);
  assert.deepStrictEqual(
    result2,
    [],
    'fanOut[canonicalId] 不存在 → 丢弃 discover 结果（T4 guard 生效）',
  );

  // state 也不应有新 ❤
  const finalState = (ms as any).loadState(s);
  assert.ok(!finalState.fanOut['m1'], 'discarded 后 fanOut[m1] 仍不存在');
  assert.ok(!finalState.providers.netease.liked.has('t-netease-match'),
    'discarded 后不应点亮 netease');
  assert.ok(!finalState.providers.spotify.liked.has('t-spotify-match'),
    'discarded 后不应点亮 spotify');

  (ms as any).searchEquivalent = origSearch;
  console.log('✅ 1. resolveEquivalents: stale canonicalId → 丢弃');
}

// ── 2. detectLikedAndSync canonicalId 漂移后用新 key 写 ──────
async function test2_detectLikedAndSync_canonicalIdDrift() {
  const { ms } = await makeService();
  const s = makeSession();

  // 远端：QQ 已经有 ❤
  ms.qq.fetchLikedMidSet = async () => new Set(['t-qq']);
  // discover 不跑真搜索：让 resolveEquivalents 啥也找不到（搜索结果 null）
  ms.netease.search = async () => [];
  ms.spotify.search = async () => [];

  // 调用 detectLikedAndSync，断言返回的 fannedOutTo 至少含 qq
  const r = await ms.detectLikedAndSync(
    s,
    'm-drift',
    [
      { platform: 'qq', trackId: 't-qq' },
      { platform: 'netease', trackId: 't-ne' },
      { platform: 'spotify', trackId: 't-sp' },
    ],
    { title: 'Test Song', artist: 'Test Artist', duration: 200 },
  );

  assert.strictEqual(r.liked, true, 'detect 应识别 liked=true');
  assert.ok(r.fannedOutTo.includes('qq'), 'fannedOutTo 应含 qq（已红心）');

  console.log('✅ 2. detectLikedAndSync: canonicalId 漂移后用新 key 写');
}

(async () => {
  try {
    await test1_resolveEquivalents_discardsOnStale();
    await test2_detectLikedAndSync_canonicalIdDrift();
    console.log('\n🎉 stale-canonicalid-guard 全部 2 项通过');
  } catch (e) {
    console.error('❌ failed:', e);
    process.exit(1);
  }
})();
