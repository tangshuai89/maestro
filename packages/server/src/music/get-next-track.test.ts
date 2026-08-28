/**
 * C1 测试：getNextTrack 流控
 *
 * 验证：
 *  1. refill 失败（provider 抛错）→ 返回 placeholder，不抛异常
 *  2. refill 成功但产出 0 首（全被 disliked 过滤）→ 返回 placeholder
 *  3. refill 成功有曲目 → shift 返回第一首
 *  4. 连续调用：第二首从 queue 取（不再 refill）
 *  5. placeholder 的字段形状正确（id/ title/ artist 含原因）
 *  6. 全 disliked 过滤后 queue 空 → placeholder
 *
 * 运行: npx ts-node src/music/get-next-track.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-next-track-'));
process.env.STORAGE_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-var-requires */
const { MusicService } = require('./music.service');

// ── Stubs ──────────────────────────────────────────────────────
function makeThrowingProvider(): any {
  return {
    isConfigured: () => true,
    fetchRadioBatch: async () => { throw new Error('network down'); },
  };
}
function makeEmptyProvider(): any {
  return {
    isConfigured: () => true,
    fetchRadioBatch: async () => [],
  };
}
function makeStockProvider(tracks: any[]): any {
  return {
    isConfigured: () => true,
    fetchRadioBatch: async () => tracks,
  };
}
function makeTrack(id: string, title: string): any {
  return {
    id, provider: 'qq', title, artist: 'Artist',
    album: '', coverUrl: '', audioUrl: '', duration: 200, liked: false,
  };
}
function makeSession(): any {
  return {
    id: 'test-session-next-track',
    providers: { qq: { qqCookie: 'fake', uin: '123' } },
    prefs: {},
  };
}
function makeStorage(): any {
  const store: Record<string, unknown> = {};
  return {
    get: (key: string) => store[key],
    set: (key: string, val: unknown) => { store[key] = val; },
  };
}
const lyricsOvh = { getLyrics: async () => null };
const match = {
  findEquivalent: async () => null,
  findEquivalents: async () => [],
  score: () => 0,
};
const likeSync = {
  registerProcessor: () => {},
  registerDiscoverResolver: () => {},
  enqueue: () => {},
  pendingTargets: () => [],
};

function makeService(qq: any): any {
  return new MusicService(
    makeStorage(), qq, makeEmptyProvider(), makeEmptyProvider(),
    makeEmptyProvider(), lyricsOvh, match, likeSync,
  );
}

async function main() {
  // ── 1. refill 失败 → placeholder ───────────────────────────
  {
    const svc = makeService(makeThrowingProvider());
    const track = await svc.getNextTrack(makeSession(), 'qq');
    assert.ok(track.id.startsWith('placeholder-'),
      `placeholder id 应以 placeholder- 开头，实际 ${track.id}`);
    assert.strictEqual(track.title, '暂时没有可播放的曲目');
    assert.strictEqual(track.artist, 'network down');
    assert.strictEqual(track.audioUrl, '');
    console.log('✅ 1. refill 失败 → placeholder（含错误原因）');
  }

  // ── 2. refill 成功但产出 0 首 → placeholder ────────────────
  {
    const svc = makeService(makeEmptyProvider());
    const track = await svc.getNextTrack(makeSession(), 'qq');
    assert.ok(track.id.startsWith('placeholder-'));
    assert.strictEqual(track.artist, '暂无更多曲目');
    console.log('✅ 2. refill 产出 0 首 → placeholder');
  }

  // ── 3. refill 成功有曲目 → shift 第一首 ───────────────────
  {
    const t1 = makeTrack('q1', 'Song 1');
    const t2 = makeTrack('q2', 'Song 2');
    const svc = makeService(makeStockProvider([t1, t2]));
    const track = await svc.getNextTrack(makeSession(), 'qq');
    assert.strictEqual(track.id, 'q1');
    assert.strictEqual(track.title, 'Song 1');
    console.log('✅ 3. refill 有曲目 → shift 第一首');
  }

  // ── 4. 连续调用：第二首从 queue 取 ─────────────────────────
  {
    const t1 = makeTrack('q1', 'Song 1');
    const t2 = makeTrack('q2', 'Song 2');
    let callCount = 0;
    const provider = {
      isConfigured: () => true,
      fetchRadioBatch: async () => { callCount++; return [t1, t2]; },
    };
    const svc = makeService(provider);
    const first = await svc.getNextTrack(makeSession(), 'qq');
    assert.strictEqual(first.id, 'q1');
    const second = await svc.getNextTrack(makeSession(), 'qq');
    assert.strictEqual(second.id, 'q2');
    assert.strictEqual(callCount, 1, 'refill 只应调一次');
    console.log('✅ 4. 连续调用：第二首从 queue 取，refill 只调 1 次');
  }

  // ── 5. placeholder 字段形状 ────────────────────────────────
  {
    const svc = makeService(makeThrowingProvider());
    const track = await svc.getNextTrack(makeSession(), 'qq');
    assert.strictEqual(track.provider, 'qq');
    assert.strictEqual(track.album, '');
    assert.strictEqual(track.coverUrl, '');
    assert.strictEqual(track.duration, 0);
    assert.strictEqual(track.liked, false);
    console.log('✅ 5. placeholder 字段形状正确');
  }

  // ── 6. disliked 过滤后 queue 空 → placeholder ─────────────
  {
    const t1 = makeTrack('q1', 'Song 1');
    const svc = makeService(makeStockProvider([t1]));
    const session = makeSession();
    const state = svc.loadState(session);
    state.providers.qq.disliked.add('q1');
    svc.saveState(session, state);
    const track = await svc.getNextTrack(session, 'qq');
    assert.ok(track.id.startsWith('placeholder-'),
      `全 disliked 后应返 placeholder，实际 ${track.id}`);
    console.log('✅ 6. 全 disliked 过滤后 → placeholder');
  }

  console.log('\n🎉 get-next-track.test 全部 6 项通过');
}

main().catch((e) => {
  console.error('❌ get-next-track.test 失败:', e);
  process.exit(1);
});
