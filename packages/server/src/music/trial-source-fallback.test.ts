/**
 * 试听升级 / 播放兜底：**候选必须实探**，不能「取首个命中就返回」。
 * 覆盖 spec: specs/trial-source-fallback/spec.md
 *
 * 复刻 2026-10-26 用户实测「又出现 29 秒」：
 *   QQ 0019n4uH2jsLcq（死 mid，GetVkey 无 purl）→ 前端 code=4
 *   → 降级到 Deezer 的 30s 试听 → 试听升级时服务端**必须**返回同歌真正
 *     能出声的 mid，而不是把刚失败的那个死 mid 再推一次。
 *
 * 关键断言（每条都对应一次真实故障形状）：
 *   1. 同平台第一个候选死 → 换**同 tier 的下一个**候选（不是取首个就返回）
 *   2. 网易云候选元数据 vipLocked=true 但实探出**完整流** → 必须能用
 *      （旧代码按元数据一票否决 → 把真正能播的源扔了）
 *   3. 所有候选实探都挂 → source=null + reason='stream-failed'
 *   4. QQ 候选元数据 vipLocked=true → 仍拒（QQ 的 30s 试听流实探分不出来）
 *
 * 运行: npx ts-node packages/server/src/music/trial-source-fallback.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');
const { LikeSyncQueue } = require('./like-sync.queue');

const store: Record<string, unknown> = {};
const fakeStorage = {
  get: (k: string) => store[k],
  set: (k: string, v: unknown) => {
    store[k] = v;
  },
};

// ── 可变的 stub provider 状态 ───────────────────────────────────
let qqSearchResults: any[] = [];
let neteaseSearchResults: any[] = [];
let spotifySearchResults: any[] = [];
/** null = 全部能出声；否则只有集合内的 id 能出声（其余模拟 GetVkey 无 purl）。 */
let qqStreamOk: Set<string> | null = null;
/** null = 全部是完整流；否则集合内的 id 只给 30s 试听（probeFullStream=false）。 */
let neteaseFullStream: Set<string> | null = null;

const qq = {
  search: async () => qqSearchResults,
  like: async () => true,
  unlike: async () => true,
  fetchLikedMidSet: async () => new Set<string>(),
  getStreamPath: async (_ps: unknown, id: string, _mediaMid?: string) => {
    if (qqStreamOk && !qqStreamOk.has(id)) {
      throw new Error(`qq getStreamPath(${id}): 104003 no purl`);
    }
    return `/music/stream/qq/${id}`;
  },
};
const netease = {
  search: async () => neteaseSearchResults,
  // 真实 provider 的 probeFullStream：要求**完整流**（30s 试听不算）。
  probeFullStream: async (_ps: unknown, id: string) => {
    if (neteaseFullStream && !neteaseFullStream.has(id)) return false;
    return true;
  },
  like: async () => true,
  unlike: async () => true,
};
const deezer = {};
const spotify = {
  search: async () => spotifySearchResults,
  like: async () => ({ success: true }),
  unlike: async () => ({ success: true }),
  fetchLiked: async () => [],
  bindSessionId: () => {},
};
const match = {};
const lyricsOvh = { getLyrics: async () => null };
const lyricsService = new LyricsService(qq as any, netease as any, deezer as any, lyricsOvh as any);
const likeSync = new LikeSyncQueue();
const svc = new MusicService(
  fakeStorage,
  qq as any,
  netease as any,
  deezer as any,
  spotify as any,
  lyricsOvh as any,
  lyricsService,
  match as any,
  likeSync,
);

// qq + netease 已登录（canSyncLike 为真）。
const session = {
  id: 'sess-trial-fallback',
  providers: { qq: { qqCookie: 'c' }, netease: { musicU: 'u' } },
  prefs: { channelPriority: 'qq,netease,deezer,spotify' },
};

function qqTrack(
  id: string,
  title: string,
  artist: string,
  duration: number,
  extra: any = {},
): any {
  return {
    id,
    provider: 'qq',
    title,
    artist,
    album: '专辑',
    duration,
    mediaMid: `MM-${id}`,
    hasCopyright: true,
    vipLocked: false,
    ...extra,
  };
}

function neTrack(
  id: string,
  title: string,
  artist: string,
  duration: number,
  extra: any = {},
): any {
  return {
    id,
    provider: 'netease',
    title,
    artist,
    album: '专辑',
    duration,
    hasCopyright: true,
    vipLocked: false,
    ...extra,
  };
}

/** 每次用例前重置搜索缓存（缓存里只有首个命中，拿不到同 tier 的其它候选）。 */
function reset(): void {
  (svc as any).equivSearchCache?.clear?.();
  (svc as any).inflightSearchEquivalent?.clear?.();
  qqSearchResults = [];
  neteaseSearchResults = [];
  spotifySearchResults = [];
  qqStreamOk = null;
  neteaseFullStream = null;
}

async function main() {
  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ── 1. 首个候选死 → 换同 tier 的下一个（用户实测的形状）──────────
  {
    reset();
    // 实测顺序：死 mid（330s，时长最接近 seed）排在前面，活 mid（331s）在后。
    qqSearchResults = [
      qqTrack('dead-mid', 'Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330),
      qqTrack('alive-mid', 'Drip Dry Eyes', 'Yukihiro Takahashi', 331),
    ];
    qqStreamOk = new Set(['alive-mid']); // dead-mid 无 purl
    neteaseSearchResults = [];

    const res = await svc.findPlayableEquivalent(
      session,
      'deezer', // seed = Deezer（30s 试听源）
      { title: 'Drip Dry Eyes', artist: 'YUKIHIRO TAKAHASHI', duration: 330 },
      { excludeTrackId: '1543760812' },
    );
    const src = res.source;
    assert.ok(src, '应找到能出声的等价源');
    assert.strictEqual(
      src.trackId,
      'alive-mid',
      '第一个候选实探不过 → 必须换同 tier 的下一个可播候选，而不是把死 mid 推回去',
    );
    assert.strictEqual(src.platform, 'qq', '应返回 QQ 源');
    assert.ok(src.url.startsWith('/music/stream/qq/'), `url 应是后端代理路径（实际 ${src.url}）`);
    assert.strictEqual(res.reason, null, '命中时 reason 应为 null');
    ok('1. 首个候选实探不过 → 换同 tier 的下一个可播候选');
  }

  // ── 2. 网易云 vipLocked=true 但实探出完整流 → 必须能用 ────────────
  {
    reset();
    // 网易云搜索命中「DRIP DRY EYES - 高橋幸宏」(338s)，元数据标 vipLocked=true，
    // 但实测 player/url 给的是**完整流**（2026-10-26 实探）。
    neteaseSearchResults = [
      neTrack('ne-528685', 'DRIP DRY EYES', '高橋幸宏', 338, { vipLocked: true }),
    ];
    qqSearchResults = []; // QQ 搜不到 → 只能走网易云
    neteaseFullStream = new Set(['ne-528685']); // 实探：完整流

    const res = await svc.findPlayableEquivalent(
      session,
      'deezer',
      { title: 'Drip Dry Eyes', artist: 'YUKIHIRO TAKAHASHI', duration: 330 },
      { excludeTrackId: '1543760812' },
    );
    const src = res.source;
    assert.ok(src, '网易云候选实探出完整流 → 应返回');
    assert.strictEqual(src.platform, 'netease', '应返回网易云源');
    assert.strictEqual(src.trackId, 'ne-528685');
    assert.strictEqual(res.reason, null);
    ok('2. 网易云 vipLocked=true 但实探出完整流 → 不再被元数据一票否决');
  }

  // ── 3. 所有候选实探都挂 → null + stream-failed ──────────────────
  {
    reset();
    qqSearchResults = [qqTrack('dead-a', 'Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330)];
    qqStreamOk = new Set<string>(); // 全死
    neteaseSearchResults = [
      neTrack('ne-trial', 'DRIP DRY EYES', '高橋幸宏', 338, { vipLocked: true }),
    ];
    neteaseFullStream = new Set<string>(); // 只有 30s 试听 → 不是完整流

    const res = await svc.findPlayableEquivalent(
      session,
      'deezer',
      { title: 'Drip Dry Eyes', artist: 'YUKIHIRO TAKAHASHI', duration: 330 },
      { excludeTrackId: '1543760812' },
    );
    assert.strictEqual(res.source, null, '全死 → 不该返回一个源');
    assert.strictEqual(
      res.reason,
      'stream-failed',
      `reason 应为 stream-failed（实际 ${res.reason}）`,
    );
    ok('3. 全部候选实探不过 → null + reason=stream-failed');
  }

  // ── 4. QQ 候选 vipLocked=true → 仍拒（元数据判据保留）─────────────
  {
    reset();
    qqSearchResults = [
      qqTrack('qq-vip', 'Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330, { vipLocked: true }),
    ];
    neteaseSearchResults = [];
    // 即便 getStreamPath 能出 purl（非会员拿到的仍是 30s 试听流）也拒。

    const res = await svc.findPlayableEquivalent(
      session,
      'deezer',
      { title: 'Drip Dry Eyes', artist: 'YUKIHIRO TAKAHASHI', duration: 330 },
      { excludeTrackId: '1543760812' },
    );
    assert.strictEqual(res.source, null, 'QQ vipLocked 候选不应被返回');
    assert.strictEqual(res.reason, 'vip-locked', `reason 应为 vip-locked（实际 ${res.reason}）`);
    ok('4. QQ vipLocked 候选 → 仍按元数据拒（QQ 试听流实探分不出来）');
  }

  // ── 5. 实探只发生在兜底路径：普通等价搜索不受影响 ────────────────
  {
    reset();
    qqSearchResults = [qqTrack('plain', 'Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330)];
    qqStreamOk = null;
    // 直接调 searchEquivalent（❤ 同步那条路）——不应该触发任何 getStreamPath。
    let streamCalls = 0;
    const origGetStreamPath = qq.getStreamPath;
    qq.getStreamPath = async (...args: any[]) => {
      streamCalls++;
      return (origGetStreamPath as any)(...args);
    };
    try {
      const t = await (svc as any).searchEquivalent(session, 'qq', {
        title: 'Drip Dry Eyes',
        artist: 'YUKIHIRO TAKAHASHI',
        duration: 330,
      });
      assert.ok(t, '普通等价搜索应命中');
      assert.strictEqual(t.id, 'plain');
      assert.strictEqual(streamCalls, 0, '❤ 同步路径不该做实探（实探有网络开销）');
    } finally {
      qq.getStreamPath = origGetStreamPath;
    }
    ok('5. 普通等价搜索（❤ 同步路径）不做实探');
  }

  // ── 6. 只有种子平台能写红心 → 没有跨平台候选 → reason 分级 ──
  // 这条覆盖 `!candidates.length` 那个提前返回分支（覆盖率 diff 门禁在 CI 上
  // 抓到它没被执行过：跨平台候选永远非空，所以这个分支平时走不到）。
  {
    reset();
    qqSearchResults = [
      qqTrack('qq-vip', 'Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330, { vipLocked: true }),
    ];
    // 只登录了 qq → 去掉种子平台后**没有任何跨平台候选**
    const onlyQqSession = {
      id: 'sess-qq-only',
      providers: { qq: { qqCookie: 'c' } },
    };
    const res = await svc.findPlayableEquivalent(
      onlyQqSession,
      'qq',
      { title: 'Drip Dry Eyes', artist: 'YUKIHIRO TAKAHASHI', duration: 330 },
      { excludeTrackId: 'other-mid' },
    );
    assert.strictEqual(res.source, null, '没有可播源 → source=null');
    assert.strictEqual(
      res.reason,
      'vip-locked',
      `同平台候选是 VIP 锁 → reason 应为 vip-locked（实际 ${res.reason}）`,
    );
    ok('6. 无跨平台候选 + 同平台候选被锁 → null + reason=vip-locked');
  }

  console.log(`\n${pass} 个用例全部通过 ✅`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
