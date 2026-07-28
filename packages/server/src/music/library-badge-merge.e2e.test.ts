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

const svc = new MusicService(
  fakeStorage,
  qq,
  netease,
  deezer,
  spotify,
  lyricsOvh,
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

  // ── 5. likedPlatforms 与 base 相同 → 复用同一对象（避免无谓重渲染） ──
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
  console.log('✅ 5. getLibrary 幂等：相同 fanOut 状态多次调用一致');

  console.log('\n🎉 library-badge-merge.e2e 全部 5 项通过');
}

main().catch((err) => {
  console.error('❌ library-badge-merge.e2e 失败:', err);
  process.exit(1);
});
