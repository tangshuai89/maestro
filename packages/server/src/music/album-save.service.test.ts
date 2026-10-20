/**
 * 专辑 fan-out 白盒测试（spec: specs/album-fanout）。
 *
 * 覆盖服务层语义（不碰网络，provider 全是假实现）：
 *   1. 能力矩阵：QQ / Deezer / Spotify 没实现 saveAlbum → 结构性跳过，
 *      **不写 state**（假收藏污染 + 角标虚高的防线）
 *   2. 网易云已登录 → 写入成功 → state.albumFanOut 记录 {platform, albumId}
 *   3. 网易云未登录 → 跳过，不写 state
 *   4. 单平台写失败 → fannedOutTo 不含该平台，整体 success 仍为 true
 *   5. 取消收藏：只反写 state 里记录过的 platform + albumId（幂等）
 *   6. 取消收藏不动「用户原本单平台收藏过」的专辑（state 无记录 → 什么都不做）
 *   7. 老 state 文件（无 albumFanOut 字段）能正常加载，不炸
 *   8. 定向等价查找 findAlbumEquivalentOnPlatform：同名命中 / year 冲突不命中 /
 *      未登录返回 null
 *
 * 运行: npx ts-node src/music/album-save.service.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-album-save-'));
process.env.STORAGE_DIR = tmpDir;

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MatchService } = require('../match/match.service');

/** 假 provider 集合。`netease.saveAlbum` 的行为由每个用例单独覆盖。 */
function quietProviders(neteaseOverrides: Record<string, unknown> = {}) {
  return {
    qq: {
      fetchLikedMidSet: async () => new Set(),
      like: async () => true,
      unlike: async () => true,
      fetchRadioBatch: async () => [],
    },
    netease: {
      fetchLiked: async () => [],
      like: async () => true,
      unlike: async () => true,
      fmTrash: async () => true,
      search: async () => [],
      searchAlbums: async () => [],
      fetchRadioBatch: async () => [],
      saveAlbum: async () => true,
      ...neteaseOverrides,
    },
    spotify: {
      fetchLiked: async () => [],
      like: async () => ({ success: true }),
      unlike: async () => ({ success: true }),
      bindSessionId: () => {},
      search: async () => [],
      fetchRadioBatch: async () => [],
    },
    deezer: { getEditorials: () => [], search: async () => [], fetchRadioBatch: async () => [] },
    search: { searchUnified: async () => [] },
    lyricsOvh: { fetch: async () => null },
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: `album-save-${Math.random().toString(36).slice(2, 8)}`,
    providers: {
      qq: { qqCookie: 'fake' },
      netease: { musicU: 'fake' },
      ...overrides,
    },
  };
}

let sharedStorage: any = null;

async function makeService(neteaseOverrides: Record<string, unknown> = {}) {
  const cfg = new ConfigService();
  if (!sharedStorage) sharedStorage = new StorageService(cfg);
  sharedStorage.flushSync();
  const session = new SessionService(sharedStorage);
  const qs = quietProviders(neteaseOverrides);
  const match = new MatchService(qs);
  const { LikeSyncQueue } = require('./like-sync.queue');
  const lyricsService = new LyricsService(qs.netease, qs.deezer, qs.qq, qs.lyricsOvh);
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

const ALBUM_ID = 'merged-album-test-1';

// ── 1. 能力矩阵：没实现 saveAlbum 的平台结构性跳过，不写 state ──────
async function test1_capability_matrix() {
  const { ms } = await makeService();
  const s = makeSession();
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [
      { platform: 'qq', albumId: 'qq-album-1' },
      { platform: 'deezer', albumId: 'dz-album-1' },
      { platform: 'spotify', albumId: 'sp-album-1' },
    ],
    true,
  );
  assert.strictEqual(res.success, true, '整体 success 恒为 true');
  assert.deepStrictEqual(res.fannedOutTo, [], '无能力平台不应出现在 fannedOutTo');
  const state = (ms as any).loadState(s);
  assert.ok(
    !state.albumFanOut[ALBUM_ID],
    '结构性跳过的平台不能写进 albumFanOut（否则角标虚高 + 假收藏）',
  );
  console.log('✅ 1. 能力矩阵：QQ/Deezer/Spotify 结构性跳过，不写 state');
}

// ── 2. 网易云已登录 → 写入成功 + state 记录 ─────────────────────
async function test2_netease_writes() {
  const calls: Array<{ albumId: string; saved: boolean }> = [];
  const { ms } = await makeService({
    saveAlbum: async (_ps: any, albumId: string, saved: boolean) => {
      calls.push({ albumId, saved });
      return true;
    },
  });
  const s = makeSession();
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [{ platform: 'netease', albumId: 'ne-album-1' }],
    true,
  );
  assert.deepStrictEqual(res.fannedOutTo, ['netease'], '网易云写成功应进 fannedOutTo');
  assert.strictEqual(calls.length, 1, '应只调一次 saveAlbum');
  assert.deepStrictEqual(calls[0], { albumId: 'ne-album-1', saved: true }, '调用参数');
  const state = (ms as any).loadState(s);
  assert.deepStrictEqual(
    state.albumFanOut[ALBUM_ID],
    [{ platform: 'netease', albumId: 'ne-album-1' }],
    'state 应记录 platform + albumId（取消收藏要靠 albumId 反写）',
  );
  console.log('✅ 2. 网易云收藏：写入成功 + state 记录 platform/albumId');
}

// ── 3. 未登录 → 跳过，不写 state ───────────────────────────────
async function test3_not_logged_in() {
  const { ms } = await makeService();
  const s = makeSession({ netease: undefined });
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [{ platform: 'netease', albumId: 'ne-album-1' }],
    true,
  );
  assert.deepStrictEqual(res.fannedOutTo, [], '未登录不应算写入成功');
  const state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '未登录不能写 state');
  console.log('✅ 3. 未登录：结构性跳过，不写 state');
}

// ── 4. 单平台写失败 → 不进 fannedOutTo，整体 success 仍 true ────
async function test4_write_failure() {
  const { ms } = await makeService({ saveAlbum: async () => false });
  const s = makeSession();
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [{ platform: 'netease', albumId: 'ne-album-1' }],
    true,
  );
  assert.strictEqual(res.success, true, '单平台失败不阻塞，整体 success 仍 true');
  assert.deepStrictEqual(res.fannedOutTo, [], '写失败的平台不进 fannedOutTo');
  const state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '写失败不能写 state（角标不能虚高）');
  console.log('✅ 4. 单平台写失败：fannedOutTo 不含 + 不写 state');
}

// ── 5. 取消收藏：只反写记录过的 platform + albumId（幂等）───────
async function test5_unsave_idempotent() {
  const calls: Array<{ albumId: string; saved: boolean }> = [];
  const { ms } = await makeService({
    saveAlbum: async (_ps: any, albumId: string, saved: boolean) => {
      calls.push({ albumId, saved });
      return true;
    },
  });
  const s = makeSession();
  await ms.fanOutAlbumSave(s, ALBUM_ID, [{ platform: 'netease', albumId: 'ne-1' }], true);
  calls.length = 0;

  const res = await ms.fanOutAlbumSave(s, ALBUM_ID, [], false);
  assert.deepStrictEqual(res.fannedOutTo, ['netease'], '取消应命中已记录平台');
  assert.deepStrictEqual(calls, [{ albumId: 'ne-1', saved: false }], '用记录里的 albumId 反写');
  let state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '取消成功后记录应被移除');

  // 再取消一次 → 幂等：什么都不做，不报错
  calls.length = 0;
  const res2 = await ms.fanOutAlbumSave(s, ALBUM_ID, [], false);
  assert.deepStrictEqual(res2.fannedOutTo, [], '重复取消应为空操作');
  assert.strictEqual(calls.length, 0, '重复取消不应再调远端');
  state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '重复取消后仍无记录');
  console.log('✅ 5. 取消收藏：按记录反写 + 幂等');
}

// ── 6. 取消收藏不动「没被我们收藏过」的专辑 ────────────────────
async function test6_unsave_only_own_records() {
  const calls: any[] = [];
  const { ms } = await makeService({
    saveAlbum: async (_ps: any, albumId: string, saved: boolean) => {
      calls.push({ albumId, saved });
      return true;
    },
  });
  const s = makeSession();
  // state 里没有这张专辑的记录 → 取消不应碰远端
  const res = await ms.fanOutAlbumSave(
    s,
    'merged-album-never-saved',
    [{ platform: 'netease', albumId: 'ne-99' }],
    false,
  );
  assert.deepStrictEqual(res.fannedOutTo, [], '没记录就不该反写');
  assert.strictEqual(calls.length, 0, '不该调远端 saveAlbum');
  console.log('✅ 6. 取消收藏只动自己收藏过的专辑');
}

// ── 7. 老 state 文件（无 albumFanOut 字段）能正常加载 ───────────
async function test7_legacy_state_compat() {
  const { ms } = await makeService();
  const s = makeSession();
  // 手工塞一个老格式 state（只有 providers + fanOut）
  (ms as any).storage.set(`music:${s.id}`, {
    providers: { netease: { queue: [], liked: [], disliked: [] } },
    fanOut: {},
  });
  const state = (ms as any).loadState(s);
  assert.deepStrictEqual(state.albumFanOut, {}, '老文件应读到空 albumFanOut，不炸');
  console.log('✅ 7. 老 state 文件兼容（无 albumFanOut 字段）');
}

// ── 8. 定向等价查找 ────────────────────────────────────────────
async function test8_find_equivalent_album() {
  const { ms } = await makeService({
    searchAlbums: async () => [
      {
        platform: 'netease',
        albumId: 'ne-777',
        title: '范特西',
        artist: '周杰伦',
        coverUrl: '',
        trackCount: 10,
        year: 2001,
        rank: 0,
      },
      {
        platform: 'netease',
        albumId: 'ne-888',
        title: '范特西 PLUS',
        artist: '周杰伦',
        coverUrl: '',
        trackCount: 14,
        year: 2003,
        rank: 1,
      },
    ],
  });
  const s = makeSession();

  const hit = await ms.findAlbumEquivalentOnPlatform(s, 'netease', '范特西', '周杰伦', 2001);
  assert.ok(hit, '同名同年应命中');
  assert.strictEqual(hit!.albumId, 'ne-777', '应命中 2001 年的那张');

  // 年份冲突 → 不命中（PLUS 是 2003）
  const miss = await ms.findAlbumEquivalentOnPlatform(s, 'netease', '范特西', '周杰伦', 2005);
  assert.strictEqual(miss, null, '年份冲突不应命中');

  // 未登录 → null
  const s2 = makeSession({ netease: undefined });
  const miss2 = await ms.findAlbumEquivalentOnPlatform(s2, 'netease', '范特西', '周杰伦');
  assert.strictEqual(miss2, null, '未登录不应做等价查找');
  console.log('✅ 8. 定向等价查找：同名同年命中 / year 冲突不命中 / 未登录 null');
}

// ── 9. 源码契约：接线没被删 ───────────────────────────────────
function test9_source_contract() {
  const src = fs.readFileSync(path.join(__dirname, 'music.service.ts'), 'utf8');
  assert.ok(src.includes('saveAlbum('), 'service 必须真的调 saveAlbum');
  assert.ok(src.includes('albumFanOut'), 'service 必须真的写 albumFanOut');
  const ctrl = fs.readFileSync(path.join(__dirname, 'music.controller.ts'), 'utf8');
  assert.ok(ctrl.includes('album/save/merged'), 'controller 必须有 album/save/merged 端点');
  const provider = fs.readFileSync(path.join(__dirname, 'netease.provider.ts'), 'utf8');
  assert.ok(provider.includes('async saveAlbum('), '网易云 provider 必须实现 saveAlbum');
  console.log('✅ 9. 源码契约：saveAlbum 接线 / albumFanOut 写入 / 端点都在');
}

// ── 10. saveAlbum 抛异常 → 降级成"没写成"，不炸穿 fan-out ─────
async function test10_provider_throws_isolated() {
  const { ms } = await makeService({
    saveAlbum: async () => {
      throw new Error('netease 请求失败: fetch failed');
    },
  });
  const s = makeSession();
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [{ platform: 'netease', albumId: 'ne-album-1' }],
    true,
  );
  assert.strictEqual(res.success, true, '平台抛错也不能让整体失败（spec 失败策略）');
  assert.deepStrictEqual(res.fannedOutTo, [], '抛错 = 没写成');
  const state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '抛错不能落账（否则远端孤儿）');
  console.log('✅ 10. saveAlbum 抛异常：降级成失败，不炸穿 fan-out、不落账');
}

// ── 11. 等价查找抛异常 → 降级成"没找到"，不炸穿 ───────────────
async function test11_equivalent_lookup_throws_isolated() {
  const { ms } = await makeService({
    searchAlbums: async () => {
      throw new Error('网易云专辑搜索失败: code=-460');
    },
  });
  const s = makeSession();
  // sources 里没有 netease → 必然走等价查找 → 查找抛错
  const res = await ms.fanOutAlbumSave(
    s,
    ALBUM_ID,
    [{ platform: 'qq', albumId: 'qq-album-1', title: '范特西', artist: '周杰伦' }],
    true,
  );
  assert.strictEqual(res.success, true, '等价查找抛错不能炸穿');
  assert.deepStrictEqual(res.fannedOutTo, [], '查找失败 = 没有可收藏的平台');
  const state = (ms as any).loadState(s);
  assert.ok(!state.albumFanOut[ALBUM_ID], '查找失败不能落账');
  console.log('✅ 11. 等价查找抛异常：降级成"没找到"，不炸穿');
}

// ── 12. 取消时 provider 抛错 → 记录保留（不能误删） ────────────
async function test12_unsave_throw_keeps_record() {
  let mode: 'ok' | 'throw' = 'ok';
  const { ms } = await makeService({
    saveAlbum: async () => {
      if (mode === 'throw') throw new Error('boom');
      return true;
    },
  });
  const s = makeSession();
  await ms.fanOutAlbumSave(s, ALBUM_ID, [{ platform: 'netease', albumId: 'ne-1' }], true);
  mode = 'throw';
  const res = await ms.fanOutAlbumSave(s, ALBUM_ID, [], false);
  assert.strictEqual(res.success, true, '取消时抛错也不能炸穿');
  assert.deepStrictEqual(res.fannedOutTo, [], '抛错 = 没撤成');
  const state = (ms as any).loadState(s);
  assert.ok(
    state.albumFanOut[ALBUM_ID],
    '撤销失败必须保留记录 —— 删了就再也撤不掉（远端还收藏着）',
  );
  console.log('✅ 12. 取消时 provider 抛错：记录保留，可重试');
}

// ── 13. trackCount 分歧守卫（EP vs LP / 豪华版） ───────────────
async function test13_track_count_guard() {
  const { ms } = await makeService({
    searchAlbums: async () => [
      {
        platform: 'netease',
        albumId: 'ne-ep',
        title: '范特西',
        artist: '周杰伦',
        coverUrl: '',
        trackCount: 5, // EP
        year: 2001,
        rank: 0,
      },
    ],
  });
  const s = makeSession();
  // seed 是 10 首的同名同年专辑 → 5 首是 EP，不该被选中
  const miss = await ms.findAlbumEquivalentOnPlatform(s, 'netease', '范特西', '周杰伦', 2001, 10);
  assert.strictEqual(miss, null, '曲目数分歧 >50% 不应命中（写路径选错就是收藏错专辑）');
  // 曲目数相同 → 命中
  const hit = await ms.findAlbumEquivalentOnPlatform(s, 'netease', '范特西', '周杰伦', 2001, 5);
  assert.ok(hit, '曲目数一致应命中');
  assert.strictEqual(hit!.albumId, 'ne-ep');
  console.log('✅ 13. trackCount 分歧守卫：EP vs LP 不误选');
}

// ── 14. mergedId 漂移归一（照 track 侧 canonicalMergedId）──────
async function test14_canonical_merged_id() {
  const { ms } = await makeService();
  const s = makeSession();
  // 第一次：老 mergedId
  await ms.fanOutAlbumSave(s, 'merged-old-key', [{ platform: 'netease', albumId: 'ne-1' }], true);
  // 第二次：同一张专辑（同样的 platform+albumId），但 mergedId 变了
  // （代表源变了 → rep.title/artist 的归一键变了）
  await ms.fanOutAlbumSave(s, 'merged-new-key', [{ platform: 'netease', albumId: 'ne-1' }], true);
  const state = (ms as any).loadState(s);
  const keys = Object.keys(state.albumFanOut);
  assert.strictEqual(keys.length, 1, `同一张专辑只应留一条记录（实际 ${keys.length}：${keys}）`);
  console.log('✅ 14. mergedId 漂移归一：同 (platform, albumId) 复用老 key');
}

// ── 15. 远端写不占 state 锁 ──────────────────────────────────
async function test15_remote_write_does_not_hold_lock() {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { ms } = await makeService({
    saveAlbum: async () => {
      await gate; // 模拟慢速远端写
      return true;
    },
  });
  const s = makeSession();
  const saving = ms.fanOutAlbumSave(s, ALBUM_ID, [{ platform: 'netease', albumId: 'ne-1' }], true);
  // 等远端写真的开始（挂住了）
  await new Promise((r) => setTimeout(r, 20));
  // 此刻另一个 state 写路径必须能**立刻**拿到锁（不被远端写阻塞）。
  // ⚠️ 必须用 race 比时间：只断言"最终跑完了"是假阳性 —— 远端写 5s 超时后
  // 锁也会释放，回调照样能跑完，测试照样绿（变异验证时踩过这个坑）。
  const raced = await Promise.race([
    ms.withStateLock(s.id, async () => 'other-done').then(() => 'other-done'),
    new Promise((r) => setTimeout(() => r('blocked'), 500)),
  ]);
  assert.strictEqual(raced, 'other-done', '远端写期间其它 state 写路径不能被堵住');
  release!();
  await saving;
  console.log('✅ 15. 远端写不占 state 锁（其它写路径不被拖住）');
}

async function main() {
  await test1_capability_matrix();
  await test2_netease_writes();
  await test3_not_logged_in();
  await test4_write_failure();
  await test5_unsave_idempotent();
  await test6_unsave_only_own_records();
  await test7_legacy_state_compat();
  await test8_find_equivalent_album();
  test9_source_contract();
  await test10_provider_throws_isolated();
  await test11_equivalent_lookup_throws_isolated();
  await test12_unsave_throw_keeps_record();
  await test13_track_count_guard();
  await test14_canonical_merged_id();
  await test15_remote_write_does_not_hold_lock();
  console.log('\n✅ album-save.service.test.ts 全部通过');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
