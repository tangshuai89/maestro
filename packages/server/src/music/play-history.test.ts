/**
 * 播放历史的服务端存取（specs/play-history/）。
 *
 * 白盒测试（Node built-in assert + stub provider），跟
 * `cross-platform-match.e2e.test.ts` 同一套构造方式。
 *
 * 变异验证：把 `recordPlayHistory` 里的去重去掉 → 本文件必须红。
 *
 * 运行: npx ts-node packages/server/src/music/play-history.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');
const { LikeSyncQueue } = require('./like-sync.queue');

class FakeStorage {
  private m = new Map<string, unknown>();
  get<T>(k: string): T | undefined {
    return this.m.get(k) as T | undefined;
  }
  set<T>(k: string, v: T): void {
    this.m.set(k, v);
  }
  delete(k: string): void {
    this.m.delete(k);
  }
}

const storage = new FakeStorage();
const qq = { search: async () => [], like: async () => true, unlike: async () => true };
const netease = { search: async () => [], like: async () => true, unlike: async () => true };
const deezer = {};
const spotify = {
  search: async () => [],
  like: async () => ({ success: true }),
  unlike: async () => ({ success: true }),
  fetchLiked: async () => [],
  bindSessionId: () => {},
};
const lyricsOvh = { getLyrics: async () => null };
const lyricsService = new LyricsService(qq as any, netease as any, deezer as any, lyricsOvh as any);
const svc = new MusicService(
  storage as any,
  qq as any,
  netease as any,
  deezer as any,
  spotify as any,
  lyricsOvh as any,
  lyricsService,
  {} as any,
  new LikeSyncQueue(),
);

const session = { id: 'sess-h', providers: {} } as any;
const session2 = { id: 'sess-h2', providers: {} } as any;

const input = (platform: string, trackId: string, title: string) => ({
  platform,
  trackId,
  title,
  artist: 'A',
  duration: 200,
});

// ── 1. 没有历史 → 空数组 ───────────────────────────────────
{
  assert.deepStrictEqual(svc.getPlayHistory(session), []);
  console.log('✅ 1. 没有历史 → 空数组');
}

// ── 2. 记一条 → 能读回来 ──────────────────────────────────
{
  const e = svc.recordPlayHistory(session, input('qq', 'mid1', '歌一'));
  assert.ok(e, '应返回记录');
  assert.strictEqual(e.id, 'qq:mid1');
  const list = svc.getPlayHistory(session);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, '歌一');
  console.log('✅ 2. 记一条 → 能读回来');
}

// ── 3. 同一首再记 → 移到最前，不追加 ──────────────────────
{
  svc.recordPlayHistory(session, input('netease', 'mid2', '歌二'));
  svc.recordPlayHistory(session, input('qq', 'mid3', '歌三'));
  assert.strictEqual(svc.getPlayHistory(session).length, 3);
  svc.recordPlayHistory(session, input('qq', 'mid1', '歌一'));
  const list = svc.getPlayHistory(session);
  assert.strictEqual(list.length, 3, '同一条不该追加');
  assert.strictEqual(list[0].id, 'qq:mid1', '同一条该移到最前');
  console.log('✅ 3. 同一首再记 → 移到最前，不追加第二条');
}

// ── 4. session 分片：另一个 session 看不到 ────────────────
{
  assert.deepStrictEqual(svc.getPlayHistory(session2), [], '别的 session 不该看到');
  assert.ok(svc.getPlayHistory(session).length > 0);
  console.log('✅ 4. session 分片 —— 互不可见');
}

// ── 5. 脏数据被过滤 ───────────────────────────────────────
{
  storage.set('history:sess-h', [
    { id: 'qq:a', platform: 'qq', trackId: 'a', title: 'A', artist: 'X', duration: 1, playedAt: 1 },
    null,
    { nope: true },
    { id: 'qq:b', title: 'B' }, // 缺 platform/artist
  ]);
  const list = svc.getPlayHistory(session);
  assert.strictEqual(list.length, 1, '只留合法的一条');
  assert.strictEqual(list[0].id, 'qq:a');
  console.log('✅ 5. 脏数据被过滤');
}

// ── 6. 清空 ───────────────────────────────────────────────
{
  const removed = svc.clearPlayHistory(session);
  assert.strictEqual(removed, 1, '应报告清掉了几条');
  assert.deepStrictEqual(svc.getPlayHistory(session), []);
  console.log('✅ 6. 清空播放历史');
}

// ── 7. 非法输入 → 不记 ────────────────────────────────────
{
  svc.recordPlayHistory(session, { platform: 'qq', trackId: '', title: 'x', artist: 'y' });
  svc.recordPlayHistory(session, { platform: 'qq', trackId: 'x', title: '  ', artist: 'y' });
  assert.deepStrictEqual(svc.getPlayHistory(session), [], '非法输入不该落库');
  console.log('✅ 7. 非法输入 → 不记');
}

console.log('\n🎉 play-history.test 全部通过 ✅');
