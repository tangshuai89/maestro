/**
 * 并发压测（补第 8 层：稳定性/长稳验证此前是空白）。
 *
 * 为什么需要：仓库里所有 state 写路径都走 per-session 的 promise-chain 锁
 * （`MusicService.withStateLock`），而**并发丢更新**是这个设计最危险的失效
 * 模式：两个写路径交错 loadState → 改 → saveState，后写的把先写的覆盖掉，
 * 用户看到的是"我刚点的心动没了"。此前的并发验证只有
 * `per-session-lock.test.ts` 的 5+5 条 —— 规模太小，且没覆盖**专辑**这条
 * 新的 fan-out 路径。
 *
 * 这里压四件事：
 *  1. **混合写压力**：800 个并发 fanOutLike / toggleLike / dislike 交错 →
 *     断言 state 与 fanOut 记录一致（无 lost update）
 *  2. **专辑 fan-out 并发**：同一张专辑被并发收藏多次 → state 里只有一条记录
 *  3. **跨 session 隔离**：两个 session 并发写 → 互不串（锁是 per-session 的）
 *  4. 🔴 **锁不跨网络 I/O**（本次最要紧的一条）：远端写**进行中**时，
 *     另一个 state 写路径必须能立刻完成。
 *
 * ⚠️ 第 4 条为什么关键：state 写路径的临界区（loadState → 改 → saveState）
 * **全是同步的**（中间没有 await）→ 天然原子，丢更新在 track 侧不可能发生。
 * 但只要**有人在锁内加一个 await**（比如专辑 fan-out 早期版本在锁里调
 * `await saveAlbum(...)`），临界区就不再原子：这段时间里的别的写会被
 * 覆盖，或者所有人被堵住 10s。第 4 条把这条不变量钉死。
 *
 * 全部用假 provider，不打网络。
 *
 * 运行: npx ts-node src/music/concurrency-stress.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-stress-'));
process.env.STORAGE_DIR = tmpDir;

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MatchService } = require('../match/match.service');

let sharedStorage: any = null;

async function makeService() {
  const cfg = new ConfigService();
  if (!sharedStorage) sharedStorage = new StorageService(cfg);
  sharedStorage.flushSync();
  const session = new SessionService(sharedStorage);
  const qs = {
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
  const match = new MatchService(qs as never);
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

function makeSession(id: string) {
  return {
    id,
    providers: {
      qq: { qqCookie: 'fake' },
      netease: { musicU: 'fake' },
      spotify: { spotify: { accessToken: 'fake-tok', expiresAt: Date.now() + 3_600_000 } },
    },
  };
}

async function main() {
  // ── 1. 混合写压力：200 并发 → 无 lost update ─────────────────
  {
    const { ms } = await makeService();
    const s = makeSession('stress-1');
    const N = 200;
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < N; i++) {
      const trackId = `t-${i}`;
      ops.push(ms.fanOutLike(s, `merged-${i}`, [{ platform: 'qq', trackId }], true));
      ops.push(ms.fanOutLike(s, `merged-${i}`, [{ platform: 'netease', trackId }], true));
      ops.push(ms.toggleLike(s, 'qq', trackId));
      ops.push(ms.dislikeMerged(s, `merged-${i}`, [{ platform: 'qq', trackId }]));
    }
    await Promise.all(ops);

    const state = (ms as any).loadState(s);
    // 关键不变式：**每个还在 liked 集合里的 track，都必须有对应的 fanOut 记录**；
    // 反之，fanOut 里的 track 必须还在 liked 集合里。
    // 这条一破，就说明某次写被后写的旧 state 覆盖了（lost update）。
    // （注：这条现在"天然"成立 —— state 写路径的临界区是同步的，见文件头第 4 条。）
    const likedQq = state.providers.qq.liked;
    const fanOutQq = new Set<string>();
    for (const entries of Object.values(state.fanOut) as Array<
      Array<{ platform: string; trackId?: string }>
    >) {
      for (const e of entries) {
        if (e.platform === 'qq' && e.trackId) fanOutQq.add(e.trackId);
      }
    }
    const likedButUnrecorded = [...likedQq].filter((id) => !fanOutQq.has(id));
    assert.strictEqual(
      likedButUnrecorded.length,
      0,
      `有 ${likedButUnrecorded.length} 首歌在 liked 集合里却没有 fanOut 记录 → lost update`,
    );
    console.log(`✅ 1. 混合写压力（${N * 4} 个并发写）：state 与 fanOut 一致，无 lost update`);
  }

  // ── 2. 专辑 fan-out 并发：同一张专辑并发收藏 → 只有一条记录 ───
  {
    const { ms } = await makeService();
    const s = makeSession('stress-2');
    const MERGED = 'merged-album-stress';
    await Promise.all(
      Array.from({ length: 30 }, () =>
        ms.fanOutAlbumSave(s, MERGED, [{ platform: 'netease', albumId: 'ne-album-1' }], true),
      ),
    );
    const state = (ms as any).loadState(s);
    const keys = Object.keys(state.albumFanOut);
    assert.strictEqual(keys.length, 1, `同一张专辑应只有一条记录（实际 ${keys.length}）`);
    const entries = state.albumFanOut[MERGED];
    assert.strictEqual(entries.length, 1, '同一平台只应有一条（去重）');
    assert.strictEqual(entries[0].platform, 'netease');
    assert.strictEqual(entries[0].albumId, 'ne-album-1');
    console.log('✅ 2. 专辑 fan-out 并发（30 并发同一张）：state 只有一条记录');
  }

  // ── 3. 跨 session 隔离：锁是 per-session 的，不能互相串 ──────
  {
    const { ms } = await makeService();
    const a = makeSession('stress-3a');
    const b = makeSession('stress-3b');
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) =>
        ms.fanOutLike(a, `m-${i}`, [{ platform: 'qq', trackId: `ta-${i}` }], true),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        ms.fanOutLike(b, `m-${i}`, [{ platform: 'qq', trackId: `tb-${i}` }], true),
      ),
    ]);
    const sa = (ms as any).loadState(a);
    const sb = (ms as any).loadState(b);
    assert.ok(
      [...sa.providers.qq.liked].every((id: string) => id.startsWith('ta-')),
      'session A 的 liked 里不该出现 session B 的 track',
    );
    assert.ok(
      [...sb.providers.qq.liked].every((id: string) => id.startsWith('tb-')),
      'session B 的 liked 里不该出现 session A 的 track',
    );
    assert.strictEqual(sa.providers.qq.liked.size, 20);
    assert.strictEqual(sb.providers.qq.liked.size, 20);
    console.log('✅ 3. 跨 session 隔离：两个 session 并发写互不串');
  }

  // ── 4. 🔴 锁不跨网络 I/O：远端写进行中时别的写路径不被堵 ──────
  {
    const { ms } = await makeService();
    const s = makeSession('stress-4');
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // 让网易云的远端写挂住（模拟慢网络）
    (ms as any).netease.saveAlbum = async () => {
      await gate;
      return true;
    };
    const albumSave = ms.fanOutAlbumSave(
      s,
      'merged-album-slow',
      [{ platform: 'netease', albumId: 'ne-slow' }],
      true,
    );
    await new Promise((r) => setTimeout(r, 20)); // 等远端写真的挂住

    // 此刻另一个 state 写路径必须能立刻拿到锁
    const raced = await Promise.race([
      ms.withStateLock(s.id, async () => 'other-done').then(() => 'other-done'),
      new Promise((r) => setTimeout(() => r('blocked'), 500)),
    ]);
    assert.strictEqual(
      raced,
      'other-done',
      '远端写进行中时其它 state 写路径被堵住了 —— 锁跨了网络 I/O',
    );
    release!();
    await albumSave;
    console.log('✅ 4. 锁不跨网络 I/O（远端写期间其它写路径不被堵）');
  }

  console.log('\n✅ concurrency-stress.test 全部通过');
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
