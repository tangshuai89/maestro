/**
 * 回归测试：「我的喜欢」库的 badge 反映运行时 fanOut 状态。
 *
 * 背景 bug：库的 badge 之前只看 `UnifiedSearchItem.sources`（catalog 维度），
 * 但 sources 在 import 之后就不会变了。用户通过 detect / fanOutLike 在其他
 * 平台 ❤ 后，库里看不到新平台（如 Lydia 只显示 QQ 角标，但播放后 ❤ 了三端）。
 * 修复：import 时给每个 item 填 `likedPlatforms`（= sources 平台），然后
 * `getLibrary` 叠加 `state.fanOut[item.id]`，badge 反映真实 ❤ 状态。
 *
 * 顺带验证 fanOut 历史脏数据（Deezer）被 isLikeable 过滤掉。
 *
 * 运行: npx ts-node src/music/library-badge-merge.e2e.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');

const fakeStorage = (() => {
  const m = new Map<string, unknown>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => {
      m.set(k, v);
    },
  };
})();

const qq = { fetchLiked: async () => [] };
const netease = { fetchLiked: async () => [] };
const deezer = {};
const spotify = {};
const match = { mergeLibrary: (tracks: any[]) => tracks };
const lyricsOvh = { getLyrics: async () => null };
const likeSync = {
  registerProcessor: () => {},
  registerDiscoverResolver: () => {},
  enqueue: () => {},
  pendingTargets: () => [],
};
const lyricsService = new LyricsService(
  netease as any,
  deezer as any,
  qq as any,
  lyricsOvh as any,
);

const svc = new MusicService(
  fakeStorage,
  qq,
  netease,
  deezer,
  spotify,
  lyricsOvh,
  lyricsService,
  match,
  likeSync,
);

const session = {
  id: 'sess-badge',
  createdAt: Date.now(),
  providers: {},
};

function makeItem(id: string, platforms: string[]): any {
  return {
    id,
    title: `T-${id}`,
    artist: 'A',
    album: '',
    coverUrl: '',
    duration: 200,
    sources: platforms.map((p) => ({
      platform: p,
      trackId: `${p}-${id}`,
      hasCopyright: true,
      url: '',
    })),
    bestSource: platforms[0] ?? null,
  };
}

async function main() {
  // ── 1. import 时落地 likedPlatforms（= sources 平台列表） ──
  fakeStorage.set(`library:${session.id}`, {
    importedAt: 1,
    items: [
      makeItem('m-lydia', ['qq']),
      makeItem('m-rained', ['qq', 'netease']),
      makeItem('m-other', ['spotify']),
    ],
    sources: [
      { provider: 'qq', count: 2 },
      { provider: 'netease', count: 1 },
      { provider: 'spotify', count: 1 },
    ],
  });
  const lib = svc.getLibrary(session);
  assert.ok(lib, '应有库');
  assert.deepStrictEqual(
    lib!.items.find((i: any) => i.id === 'm-lydia')!.likedPlatforms,
    ['qq'],
    'import 时刻 likedPlatforms 应等于 sources 平台',
  );
  assert.deepStrictEqual(
    lib!.items.find((i: any) => i.id === 'm-rained')!.likedPlatforms,
    ['qq', 'netease'],
    'QQ+网易云 多平台 likedPlatforms 应保留',
  );
  console.log('✅ 1. getLibrary 落地 likedPlatforms 反映 import 时刻 ❤ 平台');

  // ── 2. 运行时 fanOut 新增平台 → getLibrary 叠加 ──
  // 模拟用户播了 m-lydia 后 fanOut 跨平台同步到 netease + spotify（只有
  // fanOut 条目占位，library 没动）。直接写 storage 模拟 in-memory state。
  // 注意 loadState 会做 orphan GC：fanOut 里的每个平台只要 providers[].liked
  // 非空就保留，否则删除；这里每个平台塞一个 fake liked 防止被 GC。
  // 持久化层用数组（loadState 会做 Set 还原），不是 Set 对象。
  fakeStorage.set(`music:${session.id}`, {
    providers: {
      qq: { queue: [], liked: ['qq-fake'], disliked: [] },
      netease: { queue: [], liked: ['n-fake'], disliked: [] },
      deezer: { queue: [], liked: [], disliked: [] },
      spotify: { queue: [], liked: ['s-fake'], disliked: [] },
    },
    fanOut: {
      'm-lydia': [
        { platform: 'qq', trackId: 'qq-m-lydia' },
        { platform: 'netease', trackId: 'n-m-lydia' },
        { platform: 'spotify', trackId: 's-m-lydia' },
      ],
    },
  });

  const lib2 = svc.getLibrary(session)!;
  const lydia = lib2.items.find((i: any) => i.id === 'm-lydia')!;
  assert.deepStrictEqual(
    lydia.likedPlatforms.sort(),
    ['netease', 'qq', 'spotify'],
    `运行时 fanOut 加上 netease + spotify 后，Lydia badge 应是三平台，实际: ${JSON.stringify(lydia.likedPlatforms)}`,
  );
  console.log('✅ 2. getLibrary 叠加 fanOut 新增平台（修 Lydia 角标漏显示）');

  // ── 3. fanOut 单平台新增 → likedPlatforms 也带上 ──
  fakeStorage.set(`music:${session.id}`, {
    providers: {
      qq: { queue: [], liked: ['qq-fake'], disliked: [] },
      netease: { queue: [], liked: ['n-fake'], disliked: [] },
      deezer: { queue: [], liked: [], disliked: [] },
      spotify: { queue: [], liked: ['s-fake'], disliked: [] },
    },
    fanOut: {
      'm-lydia': [
        { platform: 'qq', trackId: 'qq-m-lydia' },
        { platform: 'netease', trackId: 'n-m-lydia' },
        { platform: 'spotify', trackId: 's-m-lydia' },
      ],
      'm-other': [
        { platform: 'spotify', trackId: 's-m-other' },
        { platform: 'qq', trackId: 'qq-m-other' },
      ],
    },
  });
  const lib3 = svc.getLibrary(session)!;
  const other = lib3.items.find((i: any) => i.id === 'm-other')!;
  assert.deepStrictEqual(
    other.likedPlatforms.sort(),
    ['qq', 'spotify'],
    `Spotify 已被 fanOut 同步到 QQ，badge 应该是两者，实际: ${JSON.stringify(other.likedPlatforms)}`,
  );
  console.log('✅ 3. fanOut 单平台新增 → likedPlatforms 同步带上');

  // ── 4. 历史 deezer 脏数据被 isLikeable 过滤（Deezer 匿名无收藏概念） ──
  fakeStorage.set(`music:${session.id}`, {
    providers: {
      qq: { queue: [], liked: ['qq-fake'], disliked: [] },
      netease: { queue: [], liked: ['n-fake'], disliked: [] },
      deezer: { queue: [], liked: [], disliked: [] },
      spotify: { queue: [], liked: ['s-fake'], disliked: [] },
    },
    fanOut: {
      'm-lydia': [
        { platform: 'qq', trackId: 'qq-m-lydia' },
        { platform: 'netease', trackId: 'n-m-lydia' },
        { platform: 'spotify', trackId: 's-m-lydia' },
      ],
      'm-other': [
        { platform: 'spotify', trackId: 's-m-other' },
        { platform: 'qq', trackId: 'qq-m-other' },
      ],
      'm-rained': [
        { platform: 'qq', trackId: 'qq-m-rained' },
        { platform: 'netease', trackId: 'n-m-rained' },
        { platform: 'deezer', trackId: 'd-m-rained' }, // 历史污染
      ],
    },
  });
  const lib4 = svc.getLibrary(session)!;
  const rained = lib4.items.find((i: any) => i.id === 'm-rained')!;
  assert.ok(
    !rained.likedPlatforms.includes('deezer'),
    `历史 deezer 脏数据不应污染 likedPlatforms，实际: ${JSON.stringify(rained.likedPlatforms)}`,
  );
  assert.deepStrictEqual(
    rained.likedPlatforms.sort(),
    ['netease', 'qq'],
    '保留 QQ + 网易云，过滤 Deezer',
  );
  console.log('✅ 4. 历史 deezer 脏数据被 isLikeable 过滤');

// ── 6. likedPlatforms 与 base 相同 → 复用同一对象（避免无谓重渲染） ──
  // fanOut 不含新平台时，likedPlatforms 应该是新数组（即使内容相同，对象不同
  // 也无所谓，因为我们用 `same` 短路过）；测试确保 likedPlatforms 字段确实
  // 被覆写为新值（不然 same 短路下应该返回原 item）
  const lib5 = svc.getLibrary(session)!;
  const rained5 = lib5.items.find((i: any) => i.id === 'm-rained')!;
  assert.deepStrictEqual(
    rained5.likedPlatforms.sort(),
    ['netease', 'qq'],
    '后续 getLibrary 仍正确（无 fanOut 变更）',
  );
  console.log('✅ 6. getLibrary 幂等：相同 fanOut 状态多次调用一致');

  // ── 7. fanOut key 与 library item.id 不一致 + library 只有 1 source ─────
  // 真实线上场景：用户在 netease ❤ 过这首歌 → import 时 library item 只有
  // netease source → buildUnifiedItems 取 main = netease → item.id =
  // merged-netease-XXX。之后从 search 播放（QQ 是 search 的 main）→
  // detectLikedAndSync 写入 fanOut[merged-qq-YYY]。直接 state.fanOut[item.id]
  // 查不到。旧逻辑漏算 QQ/Spotify badge（用户实测：Lefty Hand Cream 翻唱的
  // 別の人の彼女になったよ 三个平台都 ❤ 但弹窗只显示云）。
  //
  // 修复：在 getLibrary 里建 (platform, trackId) → fanOut key 反向索引，
  // item 任一 source (netease, N1) 命中 → 取 N1 所在 fanOut key 的**整组**
  // entries → QQ/Spotify 一并加进 likedPlatforms。
  fakeStorage.set(`library:${session.id}`, {
    importedAt: 1,
    items: [
      {
        id: 'merged-netease-N1',  // id 用 netease 作 main（import 路径决定的）
        title: 'T-m-drift',
        artist: 'A',
        album: '',
        coverUrl: '',
        duration: 200,
        // 真实线上：library item 只有最初 import 的 source（netease）——
        // patchLibraryWithSources 可能因 normalizeKey 不一致未命中、或用户在
        // fanOut 完成前没再打开过库。sources 仍只有 netease。
        sources: [
          { platform: 'netease', trackId: 'N1', hasCopyright: true, url: '' },
        ],
        bestSource: 'netease',
        likedPlatforms: ['netease'],
      },
    ],
    sources: [{ provider: 'netease', count: 1 }],
  });
  fakeStorage.set(`music:${session.id}`, {
    providers: {
      qq: { queue: [], liked: ['Q1'], disliked: [] },
      netease: { queue: [], liked: ['N1'], disliked: [] },
      deezer: { queue: [], liked: [], disliked: [] },
      spotify: { queue: [], liked: ['s-N1'], disliked: [] },
    },
    fanOut: {
      // key 是 QQ 作 main（search 播放路径），fanOut 组里已包含三平台。
      'merged-qq-Q1': [
        { platform: 'qq', trackId: 'Q1' },
        { platform: 'netease', trackId: 'N1' },
        { platform: 'spotify', trackId: 's-N1' },
      ],
    },
  });
  const libDrift = svc.getLibrary(session)!;
  const driftItem = libDrift.items.find((i: any) => i.id === 'merged-netease-N1')!;
  assert.deepStrictEqual(
    driftItem.likedPlatforms.sort(),
    ['netease', 'qq', 'spotify'],
    `library 只有 netease source + fanOut 在另一个 key 时反向索引应把整组并入，实际: ${JSON.stringify(driftItem.likedPlatforms)}`,
  );
  console.log('✅ 7. fanOut key ≠ library item.id + library 单 source → 反向索引取整组合并（修 Lefty Hand Cream 翻唱歌曲漏 badge）');

  // ── 8. healLibraryItem: trackId 漂移场景用搜索兜底 ──────────────────
  // 真实线上回归：library item 用 netease trackId 作 main，fanOut 用 QQ trackId
  // 作 main，两边 trackId 完全对不上 → 反向索引失效。靠 healLibraryItem 后台跑
  // searchEquivalent（复用 heart-sync 那套 4-tier 匹配：normalizeKey / 双向
  // includes / 跨脚本 / JW fuzzy）找到 QQ/Spotify 等价曲目，补回 sources 和
  // fanOut。
  //
  // 本测试 mock 掉 searchEquivalent，让它返回带 (platform, trackId) 的等价
  // 曲目，断言：调用 healLibraryItem 后，library item.sources 多出 QQ/Spotify，
  // state.fanOut 也写入对应条目，likedPlatforms 满 3 平台。
  const session2 = {
    id: 'sess-heal',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: {
      qq: { qqCookie: 'c' },
      netease: { musicU: 'u' },
      // canSyncLike 通过 `!!ps?.spotify` 检查；塞一个 truthy 标记让守卫通过
      spotify: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: Date.now() + 3600_000,
        spotify: true as any,
      },
    },
  };
  const fakeStorage2 = (() => {
    const m = new Map<string, unknown>();
    return {
      get: (k: string) => m.get(k),
      set: (k: string, v: unknown) => {
        m.set(k, v);
      },
    };
  })();
  const svc2 = new MusicService(
    fakeStorage2,
    // qq: 模拟返回同一首歌（normalizeKey 一致 + 时长匹配）
    {
      fetchLiked: async () => [],
      search: async () => [{
        id: 'qq-roman-1', title: 'Betsu no Hito no Kanojo',
        artist: 'Lefty Hand Cream', album: '', coverUrl: '',
        duration: 215, audioUrl: '', liked: true, provider: 'qq',
      }],
    },
    // netease: 空（不参与这次自愈）
    { fetchLiked: async () => [], search: async () => [] },
    // deezer / spotify: 不返回
    {},
    {
      fetchLiked: async () => [],
      search: async () => [{
        id: 'sp-roman-1', title: 'Betsu no Hito no Kanojo',
        artist: 'Lefty Hand Cream', album: '', coverUrl: '',
        duration: 215, audioUrl: '', liked: true, provider: 'spotify',
      }],
      bindSessionId: () => {}, // MusicService 传 session 时会绑 sessionId（refresh 单飞用）
    },
    { getLyrics: async () => null },
    lyricsService,
    { mergeLibrary: (tracks: any[]) => tracks },
    {
      registerProcessor: () => {},
      registerDiscoverResolver: () => {},
      enqueue: () => {},
      pendingTargets: () => [],
    },
  );
  // 模拟 library：只有 netease source
  fakeStorage2.set(`library:${session2.id}`, {
    importedAt: 1,
    items: [{
      id: 'merged-netease-1815901850',
      title: 'Betsu no Hito no Kanojo ni Natta yo',
      artist: 'Lefty Hand Cream',
      album: '',
      coverUrl: '',
      duration: 215,
      sources: [{ platform: 'netease', trackId: '1815901850', hasCopyright: true, url: '' }],
      bestSource: 'netease',
      likedPlatforms: ['netease'],
    }],
    sources: [{ provider: 'netease', count: 1 }],
  });
  fakeStorage2.set(`music:${session2.id}`, {
    providers: {
      qq: { queue: [], liked: ['qq-roman-1'], disliked: [] },
      netease: { queue: [], liked: ['1815901850'], disliked: [] },
      deezer: { queue: [], liked: [], disliked: [] },
      spotify: { queue: [], liked: ['sp-roman-1'], disliked: [] },
    },
    fanOut: {},
  });
  // 调用 getLibrary → 不再自动触发 healLibraryItem（已改为懒同步）。
  // 显式调用 healLibraryItem 触发后台自愈。
  const libBefore = svc2.getLibrary(session2)!;
  assert.deepStrictEqual(
    libBefore.items[0].likedPlatforms,
    ['netease'],
    'getLibrary 同步返回时 likedPlatforms 仍是 netease（自愈是异步）',
  );
  svc2.healLibraryItem(session2, libBefore.items[0]);
  // 等异步任务完成。注意：searchEquivalent 现在会先 await warmupJa()
  // （kuromoji 词典首次加载 ~几百 ms-1s，2026-08-07 星野源 恋 修复引入），
  // 200ms 不够，等 2s 覆盖首次词典加载。
  await new Promise((r) => setTimeout(r, 2000));
  // 再读一次 storage：library 应已补 QQ/Spotify source（netease 本来就有）
  const stored: any = fakeStorage2.get(`library:${session2.id}`);
  const libItem = stored.items[0];
  const sourcePlatforms = libItem.sources.map((s: any) => s.platform).sort();
  assert.deepStrictEqual(
    sourcePlatforms,
    ['netease', 'qq', 'spotify'],
    `healLibraryItem 后 library 应有 3 个平台 source，实际: ${JSON.stringify(sourcePlatforms)}`,
  );
  const musicState: any = fakeStorage2.get(`music:${session2.id}`);
  const fanOutForItem = musicState.fanOut['merged-netease-1815901850'] ?? [];
  const fanOutPlatforms = fanOutForItem.map((e: any) => e.platform).sort();
  // fanOut 是新增条目（mergeFanOutEntries 不去重已有平台），netease 本来不在
  // healLibraryItem 的搜索范围里——所以 fanOut 只新增 QQ/Spotify。library 的
  // likedPlatforms 拼接了 fanOut（QQ+Spotify）+ item.sources（netease）= 3 平台。
  assert.deepStrictEqual(
    fanOutPlatforms,
    ['qq', 'spotify'],
    `healLibraryItem 后 fanOut[item.id] 新增 QQ+Spotify，实际: ${JSON.stringify(fanOutPlatforms)}`,
  );
  console.log('✅ 8. healLibraryItem: trackId 漂移时用 searchEquivalent 兜底补 source + fanOut（修日音罗马字漏 badge）');

  console.log('\n🎉 library-badge-merge.e2e 全部 8 项通过');
}

main().catch((err) => {
  console.error('❌ library-badge-merge.e2e 失败:', err);
  process.exit(1);
});
