/**
 * 回归测试：跨平台红心匹配（heart-sync 的 P3「跨平台匹配」落地）。
 *
 * 背景：fan-out / detect 以前只写 item.sources 里已有的平台，从不主动去别的
 * 平台「找同一首歌」。实测用户库里几乎没有跨平台合并的条目（1060/1088 QQ-only），
 * 于是点 ❤ / 播放已红心歌几乎同步不到网易云。
 *
 * 本测试用 stub provider（search + like）+ 真实 LikeSyncQueue，验证：
 *  1) fanOutLike(qq-only, liked, meta) → 后台去 netease 搜同名同时长的等价曲目，
 *     命中后本地点亮 + 调 netease.like 同步远端 + 记进 fanOut。
 *  2) 时长差 > ±3s → 不匹配（严格 duration gate）。
 *  3) 歌名/歌手对不上 → 不匹配。
 *  4) detect 到某平台已红心（qq）→ 后台同样跨平台匹配补齐 netease。
 *  5) 取消方向（liked=false）不触发匹配。
 *
 * 运行: npx ts-node src/music/cross-platform-match.e2e.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { MusicService } = require('./music.service');
const { LikeSyncQueue } = require('./like-sync.queue');
const { warmupJa } = require('./translit');

// 真·内存 storage：loadState/saveState 要能 round-trip（断言靠 getLikedTracks 读回）。
const store: Record<string, unknown> = {};
const fakeStorage = {
  get: (k: string) => store[k],
  set: (k: string, v: unknown) => {
    store[k] = v;
  },
};

// 每个用例可变的搜索返回 + like 调用记录。
let neteaseSearchResults: any[] = [];
let qqSearchResults: any[] = [];
let spotifySearchResults: any[] = [];
const neteaseLikes: string[] = [];
let qqLikedRemote: string[] = [];
const spotifyLikes: string[] = [];
const netease = {
  search: async () => neteaseSearchResults,
  like: async (_ps: unknown, id: string) => {
    neteaseLikes.push(id);
    return true;
  },
  unlike: async () => true,
};
const qq = {
  search: async () => qqSearchResults,
  like: async () => true,
  unlike: async () => true,
  fetchLikedMidSet: async () => new Set(qqLikedRemote),
};
const deezer = {};
const spotify = {
  search: async () => spotifySearchResults,
  like: async (_ps: unknown, id: string) => {
    spotifyLikes.push(id);
    return { success: true };
  },
  unlike: async () => ({ success: true }),
  fetchLiked: async () => [],
  bindSessionId: () => {}, // MusicService 在传 session 时会绑 sessionId（refresh 单飞用）
};
const match = {};
const lyricsOvh = { getLyrics: async () => null };


const likeSync = new LikeSyncQueue(); // 真队列，跑后台 discover + 同步
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

// qq + netease 都已登录（canSyncLike 为真）。
const session = {
  id: 'sess-xpm',
  providers: { qq: { qqCookie: 'c' }, netease: { musicU: 'u' } },
};

async function likedIds(provider: string): Promise<string[]> {
  const arr = await svc.getLikedTracks(session, provider);
  return arr.map((t: { id: string }) => t.id);
}

async function waitFor(
  pred: () => Promise<boolean>,
  ms = 2000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

function neTrack(id: string, title: string, artist: string, duration: number) {
  return {
    id,
    provider: 'netease',
    title,
    artist,
    album: '',
    coverUrl: '',
    audioUrl: '',
    duration,
    liked: false,
  };
}

function qqTrack(
  id: string,
  title: string,
  artist: string,
  duration: number,
  mediaMid?: string,
) {
  return {
    id,
    provider: 'qq',
    title,
    artist,
    album: '',
    coverUrl: '',
    audioUrl: '',
    duration,
    liked: false,
    mediaMid,
  };
}

/** Spot 测试用 Track（与 neTrack 同结构但 provider = 'spotify'）。 */
function spTrack(
  id: string,
  title: string,
  artist: string,
  duration: number,
) {
  return {
    id,
    provider: 'spotify',
    title,
    artist,
    album: '',
    coverUrl: '',
    audioUrl: '',
    duration,
    liked: false,
  };
}

async function main() {
  // 先预热 kuromoji 词典：searchEquivalentUncached 现在会 await warmupJa()
  // （title-romaji 变体需要），首次加载 ~1-2s。若不预热，测试 #1 的 fanOutLike
  // 后台 discover 首次搜索会把这 ~2s 算进 waitFor(2000ms) 窗口 → 边界 flaky。
  // 放最前面让词典就绪后再跑所有 waitFor 计时用例。
  await warmupJa();
  // ── 1. fanOutLike(qq-only) → 后台匹配到 netease 等价曲目并同步 ──────
  {
    neteaseSearchResults = [neTrack('n1', '晴天', '周杰伦', 271)]; // 时长差 1s ≤ 3
    await svc.fanOutLike(
      session,
      'merged-qq-1',
      [{ platform: 'qq', trackId: 'q1' }],
      true,
      { title: '晴天', artist: '周杰伦', duration: 270 },
    );
    const ok = await waitFor(async () =>
      (await likedIds('netease')).includes('n1'),
    );
    assert.ok(ok, '跨平台匹配应把 netease n1 加入本地 liked');
    assert.ok(
      neteaseLikes.includes('n1'),
      '应调用 netease.like 把红心同步到远端',
    );
    assert.ok(
      (await likedIds('qq')).includes('q1'),
      'qq 原本的红心仍在',
    );
    console.log('✅ 1. fanOutLike(qq-only) → 后台匹配 netease 并同步');
  }

  // ── 2. 时长差 > ±3s → 不匹配（严格 duration gate）──────────────────
  {
    neteaseSearchResults = [neTrack('n2', '稻香', '周杰伦', 200)]; // 差 70s
    await svc.fanOutLike(
      session,
      'merged-qq-2',
      [{ platform: 'qq', trackId: 'q2' }],
      true,
      { title: '稻香', artist: '周杰伦', duration: 270 },
    );
    await new Promise((r) => setTimeout(r, 250)); // 给后台队列时间
    assert.ok(
      !(await likedIds('netease')).includes('n2'),
      '时长差 70s 不应匹配（严格 ±3s）',
    );
    console.log('✅ 2. 时长差超容差 → 不匹配');
  }

  // ── 3. 歌名/歌手对不上 → 不匹配 ────────────────────────────────────
  {
    neteaseSearchResults = [neTrack('n3', '完全不同的歌', '别的歌手', 270)];
    await svc.fanOutLike(
      session,
      'merged-qq-3',
      [{ platform: 'qq', trackId: 'q3' }],
      true,
      { title: '七里香', artist: '周杰伦', duration: 270 },
    );
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      !(await likedIds('netease')).includes('n3'),
      '归一化歌名+歌手不一致不应匹配',
    );
    console.log('✅ 3. 歌名/歌手不一致 → 不匹配');
  }

  // ── 4. detect 到 qq 已红心 → 后台跨平台匹配补齐 netease ─────────────
  {
    qqLikedRemote = ['q-det']; // getLikedSet(qq) 会看到这首已红心
    neteaseSearchResults = [neTrack('n-det', '告白气球', '周杰伦', 215)];
    const r = await svc.detectLikedAndSync(
      session,
      'merged-det',
      [{ platform: 'qq', trackId: 'q-det' }],
      { title: '告白气球', artist: '周杰伦', duration: 215 },
    );
    assert.strictEqual(r.liked, true, 'detect 到 qq 已红心 → liked=true');
    const ok = await waitFor(async () =>
      (await likedIds('netease')).includes('n-det'),
    );
    assert.ok(ok, 'detect 后台匹配应把 netease n-det 加入');
    assert.ok(neteaseLikes.includes('n-det'), 'detect 匹配应同步远端 netease');
    console.log('✅ 4. detect(qq 已红心) → 后台匹配补齐 netease');
  }

  // ── 4b. detect 重跑 — fanOut 已全覆盖 → 不再入队（enqueueLikeSync）────
  // renderer 侧 refreshLikedState 2.5 秒后再调一次 detect——如果 fanOut 已
  // 含所有 likeable 平台（qq + netease），这次不应再起 discover、也不得
  // 多写远端。BUG：老代码会再跑一次 resolveEquivalents（debug 日志：
  // "no candidates (..., already in fanOut)"）。
  {
    const beforeLikes = neteaseLikes.length;
    // 设一个会污染结果的假搜索——如果进 resolveEquivalents 就会误匹配此条
    neteaseSearchResults = [neTrack('n-dup', '假搜索结果不应出现', 'X', 215)];
    const r = await svc.detectLikedAndSync(
      session,
      'merged-det', // 复用 test 4 的歌，fanOut 已含 qq + netease
      [{ platform: 'qq', trackId: 'q-det' }],
      { title: '告白气球', artist: '周杰伦', duration: 215 },
    );
    assert.strictEqual(r.liked, true, '已 fanOut → liked 仍为 true');
    assert.deepStrictEqual(r.fannedOutTo.sort(), ['netease', 'qq'],
      'fannedOutTo 不变（含 qq + netease）');
    // 关键：远端不应多 call netease.like（证明没有新队列任务触发 discover）
    const afterLikes = neteaseLikes.length;
    // 等一小段时间，给任何潜在的后台任务时间跑完
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(afterLikes, neteaseLikes.length,
      `不应多 call netease.like（第一次 already fanOut 已写，after 队里不新增）`+
      `实际 before=${beforeLikes}, after=${afterLikes}`);
    console.log('✅ 4b. detect 重跑 — fanOut 全覆盖 → 不入队不写远端');
  }

  // ── 5. 取消方向（liked=false）不触发匹配 ──────────────────────────
  {
    neteaseLikes.length = 0;
    neteaseSearchResults = [neTrack('n5', '一路向北', '周杰伦', 300)];
    await svc.fanOutLike(
      session,
      'merged-qq-1', // 复用已存在的记录
      [{ platform: 'qq', trackId: 'q1' }],
      false,
      { title: '一路向北', artist: '周杰伦', duration: 300 },
    );
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      !neteaseLikes.includes('n5'),
      '取消收藏方向不应触发跨平台匹配搜索',
    );
    console.log('✅ 5. 取消方向不触发匹配');
  }

  // ── 6. findPlayableEquivalent：netease 失败 → 拿到可播放的 QQ 源 ─────
  // 复刻用户 bug：突然好想你在库里只有 netease 一个 source、code=4 后无源可退。
  // 前端拿这个端点向服务端实时匹配，应返回带后端代理 URL 的 QQ 源。
  {
    qqSearchResults = [qqTrack('002M8hNI2QgtRY', '突然好想你', '五月天', 265, 'MMQQ')];
    const src = await svc.findPlayableEquivalent(session, 'netease', {
      title: '突然好想你',
      artist: '五月天',
      duration: 266, // 与 QQ 的 265s 差 1s，在 ±3s 内
    });
    assert.ok(src, 'netease-only 曲目应能匹配到 QQ 等价源');
    assert.strictEqual(src.platform, 'qq', 'fallback 源应是 QQ');
    assert.strictEqual(src.trackId, '002M8hNI2QgtRY', 'trackId 应是 QQ 命中');
    assert.ok(
      src.url.startsWith('/music/stream/qq/'),
      `url 应是可播放的后端代理路径（实际 ${src.url}）`,
    );
    assert.ok(src.url.includes('mm=MMQQ'), 'QQ 高音质取流应透传 media_mid');
    console.log('✅ 6. findPlayableEquivalent → 返回可播放 QQ 源');
  }

  // ── 7. findPlayableEquivalent：时长差超容差 → 不匹配（返回 null） ─────
  {
    // 清掉 test 6 写入的等价搜索缓存——它和 test 7 用同样的 (kw, dur)，但
    // QQ 搜索结果不同，缓存命中会拿 test 6 的命中 → 误判时长门限失效。
    (svc as any).equivSearchCache?.clear?.();
    qqSearchResults = [qqTrack('wrong', '突然好想你', '五月天', 180)]; // 差 86s
    const src = await svc.findPlayableEquivalent(session, 'netease', {
      title: '突然好想你',
      artist: '五月天',
      duration: 266,
    });
    assert.strictEqual(src, null, '时长差超容差不应匹配，返回 null');
    console.log('✅ 7. findPlayableEquivalent 严格时长 gate → null');
  }

  // ── 8. 跨平台匹配成功 → 增量补进「我的喜欢」库快照（bug3） ───────────
  // 库里这首只有 QQ 一个 source。播到它（detect / fanOut）触发后台匹配到
  // netease 后，库快照的 sources 应被补上 netease —— 弹窗重开即可看到新徽章。
  {
    store['library:sess-xpm'] = {
      importedAt: 1,
      items: [
        {
          id: 'lib-1',
          title: '反方向的钟',
          artist: '周杰伦',
          album: '',
          coverUrl: '',
          duration: 261,
          sources: [
            {
              platform: 'qq',
              trackId: 'q-lib',
              hasCopyright: true,
              url: '/music/stream/qq/q-lib',
            },
          ],
          bestSource: 'qq',
        },
      ],
      sources: [],
    };
    neteaseSearchResults = [neTrack('n-lib', '反方向的钟', '周杰伦', 260)];
    await svc.fanOutLike(
      session,
      'merged-lib',
      [{ platform: 'qq', trackId: 'q-lib' }],
      true,
      { title: '反方向的钟', artist: '周杰伦', duration: 261 },
    );
    const ok = await waitFor(async () => {
      const lib = store['library:sess-xpm'] as any;
      return lib.items[0].sources.some((s: any) => s.platform === 'netease');
    });
    assert.ok(ok, 'discover 匹配后应把 netease source 补进库快照');
    const neSrc = (store['library:sess-xpm'] as any).items[0].sources.find(
      (s: any) => s.platform === 'netease',
    );
    assert.strictEqual(neSrc.trackId, 'n-lib', '补进的应是匹配到的 netease 曲目');
    assert.ok(
      neSrc.url.startsWith('/music/stream/netease/'),
      `补进的 netease 源应带可播放代理 url（实际 ${neSrc.url}）`,
    );
    // QQ 原有 source 不被覆盖，仍在。
    assert.ok(
      (store['library:sess-xpm'] as any).items[0].sources.some(
        (s: any) => s.platform === 'qq',
      ),
      'QQ 原有 source 应保留',
    );
    console.log('✅ 8. 跨平台匹配 → 增量补进库快照（bug3）');
  }

  // ── 9. 兜底搜索：原 kw 0 候选 → 剥括号内容再搜 ─────────────
  // 修 "TO BE (存在) 滨崎步 (浜崎あゆみ)" → Spotify 0 candidates 的 bug。
  // Spotify 对带版本标签 + 艺人别名括号的查询词命中率低，剥掉括号后就能命中。
  // 这里用 netease 模拟"严格搜索返回 0"的行为（同 Spotify bug 的形态），验证
  // 兜底搜索层 + 匹配层都正常工作。
  {
    let neteaseKwHistory: string[] = [];
    const wrappedNetease = {
      ...netease,
      search: async (_ps: unknown, kw: string) => {
        neteaseKwHistory.push(kw);
        // 模拟"严格搜索 0 候选"：只要 kw 里有括号内容（存在 / 浜崎あゆみ）→ 0；
        // 剥括号后 → 1 命中。
        if (kw.includes('存在') || kw.includes('浜崎あゆみ')) {
          return [];
        }
        return [
          {
            id: 'n-tobe',
            provider: 'netease',
            title: 'TO BE',
            artist: '滨崎步',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 317,
            liked: false,
          },
        ];
      },
    };
    // spotify 走原本的空结果（不影响这一条用例）
    spotifySearchResults = [];
    const origNetease = (svc as any).netease;
    (svc as any).netease = wrappedNetease;
    try {
      await svc.fanOutLike(
        session,
        'merged-tobe',
        [{ platform: 'qq', trackId: 'q-tobe' }],
        true,
        { title: 'TO BE (存在)', artist: '滨崎步 (浜崎あゆみ)', duration: 317 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('netease')).includes('n-tobe'),
      );
      assert.ok(
        ok,
        '原 kw 0 候选 → 剥括号兜底命中 → netease 应被点亮',
      );
      assert.ok(
        neteaseLikes.includes('n-tobe'),
        '兜底命中后应同步远端 netease.like',
      );
      // 关键断言：搜索至少发起 2 次（原始 + 剥括号兜底），否则兜底没生效
      assert.ok(
        neteaseKwHistory.length >= 2,
        `应至少 2 次搜索（原 kw + 兜底），实际 ${neteaseKwHistory.length} 次，kw=${JSON.stringify(neteaseKwHistory)}`,
      );
      assert.ok(
        neteaseKwHistory[0].includes('存在'),
        `第 1 次应仍是原 kw（带括号），实际 "${neteaseKwHistory[0]}"`,
      );
      assert.ok(
        !neteaseKwHistory[1].includes('存在') && !neteaseKwHistory[1].includes('浜崎あゆみ'),
        `第 2 次应是剥括号 kw，实际 "${neteaseKwHistory[1]}"`,
      );
    } finally {
      (svc as any).netease = origNetease;
    }
    console.log('✅ 9. 兜底搜索：原 kw 0 候选 → 剥括号内容再搜');
  }

  // ── 10. 兜底：原 kw 非 0 但候选全是无关歌 → 4 tier 失败后用 title-only 收紧再搜 ──
  // 修 "サマータイムシンデレラ (盛夏的灰姑娘) 緑黄色社会"：
  // Spotify 原 kw 搜回 おつかれSUMMER / summertime / Remember Summer Days 三个
  // 主题相关但无关候选，4 tier 匹配全失败 → 旧代码直接返回 null；新代码试
  // title-only 变体（"サマータイムシンデレラ"），Spotify 这次返回真实歌曲。
  {
    let spotifyCalls: string[] = [];
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, kw: string, limit: number) => {
        spotifyCalls.push(`q=${kw}&limit=${limit}`);
        if (kw === 'サマータイムシンデレラ') return [
          {
            id: 's-summertime',
            provider: 'spotify',
            title: 'サマータイムシンデレラ',
            artist: '緑黄色社会',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 228,
            liked: false,
          },
        ];
        // 原 kw 命中 3 个无关候选（模拟 Spotify 解析偏差）
        return [
          {
            id: 's-otsukare',
            provider: 'spotify',
            title: 'おつかれSUMMER',
            artist: 'HALCALI',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 240,
            liked: false,
          },
          {
            id: 's-summertime',
            provider: 'spotify',
            title: 'summertime',
            artist: 'cinnamons / evening cinema',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 252,
            liked: false,
          },
          {
            id: 's-remember',
            provider: 'spotify',
            title: 'Remember Summer Days',
            artist: 'Anri',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 296,
            liked: false,
          },
        ];
      },
    };
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      const t = await (svc as any).searchEquivalent(
        session,
        'spotify',
        {
          title: 'サマータイムシンデレラ (盛夏的灰姑娘)',
          artist: '緑黄色社会',
          duration: 228,
        },
      );
      assert.ok(t, 'title-only 变体应能命中真实歌曲');
      assert.strictEqual(t.id, 's-summertime', '命中 title-only 那次返回的 result');
      assert.ok(
        spotifyCalls.length >= 2,
        `至少 2 次搜索（原 kw + title-only），实际 ${spotifyCalls.length} 次：${JSON.stringify(spotifyCalls)}`,
      );
      assert.ok(
        spotifyCalls[0].includes('サマータイムシンデレラ (盛夏的灰姑娘)'),
        `第 1 次应是原 kw，实际 "${spotifyCalls[0]}"`,
      );
      assert.ok(
        spotifyCalls[1].includes('サマータイムシンデレラ') &&
          !spotifyCalls[1].includes('盛夏的灰姑娘'),
        `第 2 次应是 title-only 变体（去掉中译括号），实际 "${spotifyCalls[1]}"`,
      );
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 10. 兜底title-only：Spotify 候选全无关 → title-only 收紧再搜');
  }

  // ── 11. 标题剥括号内容 substring 兜底：seed 带中译括号，候选带 MV 标签 ──
  // 修 "胸の煙 (焚心如火) - ずっと真夜中でいいのに。 (永远是深夜有多好｡)" 这种
  // 回归：seed 标题 = "胸の煙 (焚心如火)"，候选 = "胸の煙 (Official MV)"。
  // Tier 1-4 的 normalizeKey 字符串 includes 都失败（双方各自有独有尾缀）；
  // Tier 5（strip parens content 后再 substring）应命中。
  {
    let spotifyCalls: string[] = [];
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, kw: string, _limit: number) => {
        spotifyCalls.push(kw);
        // 所有变体都返回同一个候选（模拟 Spotify 实际只有这一首）
        return [
          {
            id: 's-munenonKemuri',
            provider: 'spotify',
            title: '胸の煙 (Official MV)',
            artist: 'ずっと真夜中でいいのに。',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 249,
            liked: false,
          },
        ];
      },
    };
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      const t = await (svc as any).searchEquivalent(
        session,
        'spotify',
        {
          title: '胸の煙 (焚心如火)',
          artist: 'ずっと真夜中でいいのに。 (永远是深夜有多好｡)',
          duration: 249,
        },
      );
      assert.ok(t, 'Tier 5 (relaxed title stripped) 应能命中变体');
      assert.strictEqual(t.id, 's-munenonKemuri', '命中 Official MV 候选');
      assert.ok(
        spotifyCalls.length >= 1,
        `至少跑过 1 次搜索，实际 ${spotifyCalls.length} 次`,
      );
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 11. 标题剥括号内容 substring 兜底：seed 中译 + 候选 MV 标签');
  }

  // ── 12. JW fuzzy title match：候选标题是 seed 轻微改写 ──
  // 修「聖夜」vs「聖夜☆」这种一个字符差的情况。前 4 + 5 tier 都失败（normalizeKey
  // 不等、剥括号后也不等），Tier 6 用 JW 0.88 兜底命中。
  {
    let spotifyCalls = 0;
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => {
        spotifyCalls++;
        return [
          {
            id: 's-seiya2',
            provider: 'spotify',
            title: '聖夜☆',
            artist: 'あるぱか',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 200,
            liked: false,
          },
        ];
      },
    };
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      const t = await (svc as any).searchEquivalent(
        session,
        'spotify',
        { title: '聖夜', artist: 'あるぱか', duration: 200 },
      );
      assert.ok(t, 'JW fuzzy title match 应能命中「聖夜☆」vs「聖夜」');
      assert.strictEqual(t.id, 's-seiya2');
      assert.ok(spotifyCalls >= 1, '至少跑过 1 次搜索');
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 12. JW fuzzy title match 兑底：单字符差');
  }

  // ── 13. 标题撞名不同歌手：花田错 王力宏 vs 花田错 王馨卓 → 不得误命 ─
  // 修「标题相同但歌手不同」被 Tier 3（title-exact, artist ignored）拉走、
  // 进 fanOut 后导致用户库被污染的回归。Tier 3 / 5 / 6 都需艺人宽松命中。
  // 正确同曲不同拼写（Spotify Leohom Wang）仍能命中（跨脚本）。
  {
    const wrappedNetease = {
      ...netease,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 'n-wrong-artist',
          provider: 'netease',
          title: '花田错',
          artist: '王馨卓',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 249,
          liked: false,
        },
      ],
    };
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 's-leehom',
          provider: 'spotify',
          title: '花田错',
          artist: 'Leohom Wang',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 249,
          liked: false,
        },
      ],
    };
    const origNe = (svc as any).netease;
    const origSp = (svc as any).spotify;
    (svc as any).netease = wrappedNetease;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      netease: { musicU: 'u' },
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      // 同一 seed 测两个平台：netease 必须拒（艺人是王馨卓 ≠王力宏）、spotify
      // 必须收（Leohom Wang 是王力宏拼音，跨脚本）。分别调用，避免互相污染。
      const tNe = await (svc as any).searchEquivalent(
        session,
        'netease',
        { title: '花田错', artist: '王力宏', duration: 249 },
      );
      assert.strictEqual(
        tNe,
        null,
        'netease 搜到王馨卓是不同名曲 → 必须返回 null，不写 fanOut',
      );
      const tSp = await (svc as any).searchEquivalent(
        session,
        'spotify',
        { title: '花田错', artist: '王力宏', duration: 249 },
      );
      assert.ok(tSp, 'spotify 搜到 Leohom Wang（王力宏拼音）应能命中');
      assert.strictEqual(tSp.id, 's-leehom');
    } finally {
      (svc as any).netease = origNe;
      (svc as any).spotify = origSp;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 13. 标题撞名不同歌手：花田错 王力宏 vs 王馨卓 不误命');
  }

  // ── 14. りりあ。+ ねえ、ちゃんと聞いてる？：跨形态跨标识符容错 ──
  // 用户场景：搜索「ねえ、ちゃんと聞いてる？ りりあ。」找不到歌。Spotify 实际
  // 有这首歌，但返回的 5 个候选都是别的歌（同名其他歌手或同名变体）。这条测试
  // 验证当 Spotify 确实返回「正确」候选时（不同字形态 / 标点 / 拼写差异），
  // 匹配应能命中——确保匹配规则本身没漏，而不是曲目确实不在平台。
  {
    // 同一首歌多个常见 Spotify/Netease 候选形态。
    const variants = [
      { title: 'ねえ、ちゃんと聞いてる？', artist: 'りりあ。', dur: 258, tag: 'exact' },
      { title: 'ねえ、ちゃんと聞いてる？', artist: 'りりあ', dur: 258, tag: 'no-period' },
      { title: 'ねえ、ちゃんと聞いてる？', artist: 'Riria', dur: 258, tag: 'cross-script' },
      { title: 'ねえちゃんと聞いてる？', artist: 'りりあ。', dur: 258, tag: 'no-cmm' },
      { title: 'ねえ、ちゃんと聞いてる？ (Acoustic)', artist: 'りりあ。', dur: 258, tag: 'extra-parens' },
    ];
    for (const v of variants) {
      const wrappedSpotify = {
        ...spotify,
        search: async (_ps: unknown, _kw: string, _limit: number) => [
          {
            id: 's-ria',
            provider: 'spotify',
            title: v.title,
            artist: v.artist,
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: v.dur,
            liked: false,
          },
        ],
      };
      const origSpotify = (svc as any).spotify;
      (svc as any).spotify = wrappedSpotify;
      const origSessionProviders = session.providers;
      (session as any).providers = {
        ...session.providers,
        spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
      };
      try {
        const t = await (svc as any).searchEquivalent(
          session,
          'spotify',
          { title: 'ねえ、ちゃんと聞いてる？', artist: 'りりあ。', duration: 258 },
        );
        assert.ok(t, `变体 ${v.tag} (="${v.title} - ${v.artist}") 应能命中`);
        assert.strictEqual(t.id, 's-ria', `变体 ${v.tag} 命中同一首`);
      } finally {
        (svc as any).spotify = origSpotify;
        (session as any).providers = origSessionProviders;
      }
    }
    console.log('✅ 14. りりあ。+ ねえ、ちゃんと聞いてる？ 跨形态容错命中');
  }

  // ── 15. 跨版本 duration 差 15s：QQ 源 258s vs Spotify 源 243s ──
  // 修「ねえ、ちゃんと聞いてる？ りりあ。」QQ 源 dur=258、Spotify/Netease 源
  // dur=243——同歌不同版本（带 intro/outro 的专辑版 vs 短版 single）。3s 严苛
  // 容差根本搜不到，让 Tier 3（title-exact + artist 宽松）用跨版本 30s 容差
  // 找回。Tier 1/2/4/6 仍走 3s（防"恰好时长相同但不同歌"的误命中）。
  {
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 's-ria-243',
          provider: 'spotify',
          title: 'ねえ、ちゃんと聞いてる？',
          artist: 'りりあ。',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 243, // 比 seed 短 15s
          liked: false,
        },
      ],
    };
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      // 清 cache：test 14 同 session 同 kw 写过命中，cache 里已是 's-ria'。
      // 实际 test 15 候选 ID 是 's-ria-243'，必须绕过 cache。
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(
        session,
        'spotify',
        { title: 'ねえ、ちゃんと聞いてる？', artist: 'りりあ。', duration: 258 },
      );
      assert.ok(t, '跨版本 15s 差命中');
      assert.strictEqual(t.id, 's-ria-243');
    } finally {
      (svc as any).spotify = origSpotify;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 15. 跨版本 duration 容差：QQ 258s vs Spotify 243s 命中');
  }

  // ── 16. tilde 变体归一：seed 用 `~`，Spotify 候选用 `〜` ─────
  // 用户场景：QQ/网易云标题里用 ASCII tilde（U+007E）做分隔符，Spotify
  // 用 wave dash（U+301C）——同一首歌不同平台字符不同。之前 normalizeKey
  // 的 noise-strip 不含 tilde，所有 tier 都因 `~` ≠ `〜` 挂掉。
  // 修法：normalizeKey step 5 的 noise-strip 加入 `~〜～` 三种 tilde。
  // 例:「Departures~あなたにおくるアイの歌~ (Departures~送给你的爱之歌~) - EGOIST (エゴイスト)」
  // vs Spotify 候选「Departures 〜あなたにおくるアイの歌〜 - EGOIST」dur=255。
  {
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        // 与生产 Spotify 实际返回顺序一致（实测日志）：[dur=256, dur=255, dur=95 TV Edit]
        {
          id: 's-dep-256',
          provider: 'spotify',
          title: 'Departures \u301Cあなたにおくるアイの歌\u301C', // 〜
          artist: 'EGOIST',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 256,
          liked: false,
        },
        {
          id: 's-dep-255',
          provider: 'spotify',
          title: 'Departures \u301Cあなたにおくるアイの歌\u301C', // 〜
          artist: 'EGOIST',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 255, // 与 seed 完全一致
          liked: false,
        },
        {
          id: 's-dep-tv',
          provider: 'spotify',
          title: 'Departures \u301Cあなたにおくるアイの歌\u301C\uff08TV Edit\uff09', // 〜（TV Edit）
          artist: 'EGOIST',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 95,
          liked: false,
        },
      ],
    };
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(
        session,
        'spotify',
        {
          title:
            'Departures~あなたにおくるアイの歌~ (Departures~送给你的爱之歌~)',
          artist: 'EGOIST (エゴイスト)',
          duration: 255,
        },
      );
      assert.ok(t, '`~` vs `〜` tilde 变体应能命中（之前所有 tier 全挂）');
      // Tier 2 (loose) 命中后即返回——按 search 返回顺序取首条。
      // 这里不强求命中 dur=255（duration-preferring 属于另一个 PR 的优化），
      // 只确保命中**正版本**（256/255 之一），绝不能命中 95 的 TV Edit。
      assert.notStrictEqual(
        t.id,
        's-dep-tv',
        '不得误命中 dur=95 TV Edit（与 seed 差 160s）',
      );
      assert.ok(
        ['s-dep-256', 's-dep-255'].includes(t.id),
        `命中正版本（256/255），实际 ${t.id}`,
      );
    } finally {
      (svc as any).spotify = origSpotify;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 16. tilde 变体归一: `~` (seed) vs `〜` (Spotify) 命中正版本（不是 TV Edit）');
  }

  // ── 17. 同名不同艺人的翻唱链：跨脚本艺人不得靠「裸 isCrossScript」误并 ──
  // 真实线上事故（2026-07-31）：「別の人の彼女になったよ」这首歌在用户三个平台
  // 的红心里其实是**三个不同艺人**的录音：
  //   netease = Lefty Hand Cream(翻唱, 310s) / QQ = 铃木爱理(298s) / Spotify = wacci(原唱, 305s)
  // 旧 matchEquivalentTrack 的 artistLooseMatch 用裸 isCrossScript——只要「一边
  // CJK、一边拉丁」就判同一艺人。于是 CJK 的「铃木爱理」同时 cross-script-匹配
  // 拉丁的「Lefty Hand Cream」和「wacci」，把三条不相干录音传递性并成一个 fanOut
  // 组（badge 虚报 3❤ + 计数虚高 + 错误红心被同步到远端）。
  //
  // 修复：跨脚本艺人必须**音译佐证**（拼音/假名罗马字对得上）才认。铃木爱理→
  // "lingmuaili"、Lefty→"leftyhandcream"、wacci→"wacci" 两两零重叠 → 全部拒绝。
  {
    // seed = Lefty Hand Cream 版（netease），去 QQ / Spotify 搜。
    // QQ 只返回铃木爱理版、Spotify 只返回 wacci 版（用户库里的真实情况）。
    const seed = {
      title: '別の人の彼女になったよ',
      artist: 'Lefty Hand Cream',
      duration: 310,
    };
    const wrappedQq = {
      ...qq,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 'qq-suzuki',
          provider: 'qq',
          title: '別の人の彼女になったよ (成为了别人的女朋友)',
          artist: '铃木爱理 (すずき あいり)',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 298,
          liked: false,
        },
      ],
    };
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 'sp-wacci',
          provider: 'spotify',
          title: '別の人の彼女になったよ',
          artist: 'wacci',
          album: '',
          coverUrl: '',
          audioUrl: '',
          // 关键：故意用与 seed **完全相同**的时长（310s）——这样时长 gate
          // 帮不上忙，唯一能拒绝这条 wacci 原唱的就是「艺人音译对不上」。锁死
          // 「別の人の彼女になったよ」标题相等 + 时长相等仍不得跨艺人误并。
          duration: 310,
          liked: false,
        },
      ],
    };
    const origQq = (svc as any).qq;
    const origSp = (svc as any).spotify;
    (svc as any).qq = wrappedQq;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      qq: { qqCookie: 'c' },
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).equivSearchCache.clear();
      const tQq = await (svc as any).searchEquivalent(session, 'qq', seed);
      assert.strictEqual(
        tQq,
        null,
        `QQ 铃木爱理 ≠ Lefty Hand Cream（音译对不上）→ 必须拒，实际命中 ${tQq && tQq.id}`,
      );
      (svc as any).equivSearchCache.clear();
      const tSp = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.strictEqual(
        tSp,
        null,
        `Spotify wacci ≠ Lefty Hand Cream → 必须拒，实际命中 ${tSp && tSp.id}`,
      );
    } finally {
      (svc as any).qq = origQq;
      (svc as any).spotify = origSp;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 17. 同名不同艺人翻唱链：跨脚本艺人音译对不上 → 拒绝误并（修 Lefty/铃木爱理/wacci 事故）');
  }

  // ── 18. 纯汉字日文名的合法跨脚本：藤井风 ↔ Fujii Kaze 仍能命中（Tier 3b）──
  // 音译（拼音）给的是中文读音「tengjingfeng」≠ 日文「fujiikaze」，artistLooseMatch
  // 会拒。但这是真·同一艺人，靠「标题 normalizeKey 完全相等 + 时长 ±3s 严格 +
  // 艺人跨脚本」的强佐证通道（Tier 3b）兜底。验证 17 收紧后没误伤这个合法场景。
  {
    const seed = { title: '何なんw', artist: '藤井风', duration: 240 };
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 'sp-fujii',
          provider: 'spotify',
          title: '何なんw',
          artist: 'Fujii Kaze',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 240, // 同录音，±3s 内
          liked: false,
        },
      ],
    };
    const origSp = (svc as any).spotify;
    (svc as any).spotify = wrappedSpotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.ok(
        t && t.id === 'sp-fujii',
        `藤井风 ↔ Fujii Kaze 同录音应经 Tier 3b 命中，实际 ${t && t.id}`,
      );
    } finally {
      (svc as any).spotify = origSp;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 18. 合法跨脚本日文汉字名：藤井风 ↔ Fujii Kaze（Tier 3b 强佐证）命中');
  }

  // ── 19. kuromoji 端到端：简体日文名 ↔ 罗马字，且时长差 >3s（Tier 3b 够不着）──
  // 证明 kuromoji 音译佐证真的接进了匹配链：seed「铃木爱理」(简体) 去 QQ 搜到
  // 「Suzuki Airi」(罗马字)，标题相同但时长差 15s——Tier 1/2/3b 都要 ±3s 严格
  // 够不着，只有 Tier 3（标题完全相等 + artistLooseMatch + 跨版本 30s 容差）能中，
  // 而 artistLooseMatch 命中**只能靠 kuromoji**（拼音 lingmuaili ≠ suzukiairi）。
  // 需先 await warmupJa() 让词典就绪（放在最后，不影响前面测 pinyin 降级路径的用例）。
  {
    await warmupJa();
    const wrappedQq = {
      ...qq,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id: 'qq-suzuki-airi',
          provider: 'qq',
          title: '微風',
          artist: 'Suzuki Airi',
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 215, // 比 seed 差 15s：>3s(Tier 3b 出局) 但 ≤30s(Tier 3 容差内)
          liked: false,
        },
      ],
    };
    const origQq = (svc as any).qq;
    (svc as any).qq = wrappedQq;
    const origSessionProviders = session.providers;
    (session as any).providers = { ...session.providers, qq: { qqCookie: 'c' } };
    try {
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(session, 'qq', {
        title: '微風',
        artist: '铃木爱理', // 简体；cn2t→鈴木愛理→kuromoji→suzukiairi
        duration: 200,
      });
      assert.ok(
        t && t.id === 'qq-suzuki-airi',
        `kuromoji 音译（铃木爱理→suzukiairi）应让 15s 差的 Suzuki Airi 命中 Tier 3，实际 ${t && t.id}`,
      );
    } finally {
      (svc as any).qq = origQq;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 19. kuromoji 端到端：铃木爱理 ↔ Suzuki Airi（拼音够不着，音译命中 Tier 3）');
  }

  // ── 20. 英文艺名别名表端到端：印地安老斑鳩 - Jay Chou 命中（非音译艺名）──
  // 用户实测回归：「印第安老斑鸠 - 周杰伦」(QQ, dur=304) 在 Spotify 搜到
  // 「印地安老斑鳩 - Jay Chou」(dur=305) 却 no match。标题差一个「的/地」
  // （非简繁，OpenCC 救不了），JW=0.9 能过 Tier 6 的 0.88；但艺人「Jay Chou」
  // 是非音译英文艺名（zhoujielun ≠ jaychou），拼音/kuromoji 都桥不了 →
  // artistLooseMatch 拒 → 6 个 tier 全挂。靠 STAGE_NAME_ALIASES 策展表解锁。
  // 对照组：把候选艺人换成表外的「Jay Zhou」，必须仍然拒绝（表内才是同人）。
  {
    const seed = { title: '印第安老斑鸠', artist: '周杰伦', duration: 304 };
    const makeStub = (artist: string, id: string) => ({
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        {
          id,
          provider: 'spotify',
          title: '印地安老斑鳩', // 繁 + 的/地异写：Tier 1-5 全挂，只走 Tier 6 JW
          artist,
          album: '',
          coverUrl: '',
          audioUrl: '',
          duration: 305, // 与 seed 差 1s，±3s 内
          liked: false,
        },
      ],
    });
    const origSp = (svc as any).spotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).spotify = makeStub('Jay Chou', 'sp-yin-di-an');
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.ok(
        t && t.id === 'sp-yin-di-an',
        `周杰伦 ↔ Jay Chou（英文艺名表）应经 Tier 6 JW + 艺人别名命中，实际 ${t && t.id}`,
      );

      (svc as any).spotify = makeStub('Jay Zhou', 'sp-jay-zhou');
      (svc as any).equivSearchCache.clear();
      const t2 = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.strictEqual(
        t2,
        null,
        `表外拉丁名「Jay Zhou」不得搭「印地安老斑鳩」误并，实际命中 ${t2 && t2.id}`,
      );
    } finally {
      (svc as any).spotify = origSp;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 20. 英文艺名别名表：印地安老斑鳩 ↔ Jay Chou 命中；表外 Jay Zhou 拒绝');
  }

  // ── 21. 日语艺名别名端到端：ヒューマノイド ↔ ZUTOMAYO 命中（含译名括号）──
  // 用户实测回归：seed「ヒューマノイド (仿生人) - ずっと真夜中でいいのに。
  // (永远是深夜有多好｡)」(QQ, dur=258) 在 Spotify 搜到「ヒューマノイド -
  // ZUTOMAYO」(dur=259) 却 no match。标题侧 Tier 5 剥括号后完全相等没问题；
  // 艺人「ZUTOMAYO」是造词型拉丁艺名（kuromoji 只给 zutto mayonaka de ii
  // noni）→ 别名表「ずっと真夜中でいいのに」解锁（key 提取自动剥掉艺人名里
  // 的译名括号注释）。对照组：候选换「Humanoid Colic / kojika」必须拒绝。
  {
    const seed = {
      title: 'ヒューマノイド (仿生人)',
      artist: 'ずっと真夜中でいいのに。 (永远是深夜有多好｡)',
      duration: 258,
    };
    const makeStub = (tracks: any[], id: string) => ({
      ...spotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => tracks,
    });
    const origSp = (svc as any).spotify;
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).spotify = makeStub(
        [
          { id: 'sp-zutomayo', provider: 'spotify', title: 'ヒューマノイド', artist: 'ZUTOMAYO', album: '', coverUrl: '', audioUrl: '', duration: 259, liked: false },
        ],
        'sp-zutomayo',
      );
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.ok(
        t && t.id === 'sp-zutomayo',
        `ずっと真夜中でいいのに。 ↔ ZUTOMAYO（别名表 + 译名括号）应命中，实际 ${t && t.id}`,
      );

      (svc as any).spotify = makeStub(
        [
          { id: 'sp-kojika', provider: 'spotify', title: 'Humanoid Colic (feat. HATSUNE MIKU)', artist: 'kojika / Hatsune Miku', album: '', coverUrl: '', audioUrl: '', duration: 193, liked: false },
        ],
        'sp-kojika',
      );
      (svc as any).equivSearchCache.clear();
      const t2 = await (svc as any).searchEquivalent(session, 'spotify', seed);
      assert.strictEqual(
        t2,
        null,
        `无关候选（kojika / Humanoid Colic）不得误并，实际命中 ${t2 && t2.id}`,
      );
    } finally {
      (svc as any).spotify = origSp;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 21. 日语艺名别名表：ヒューマノイド ↔ ZUTOMAYO 命中；kojika 拒绝');
  }

  // ── 22. detect 等 discover 落定 + 同曲兄弟版本并账：❤ 角标按「歌」算 ──
  // 用户实测回归：「夜中のキスミ」播放 258s 版本时，discover 只给 275s 版本
  // 的 fanOut 记录补了 qq+spotify（日志 "library patched += qq, spotify"），
  // 播放 258s 版本时 ❤ 角标却只有 1。两个根因：
  //   a) 前端 2.5s 的 refresh detect 与后台 discover 竞态——响应返回时补平台
  //      还没写完 → 角标停在旧值。修复：detect 先 waitForSettled 再返回。
  //   b) 兄弟版本（同 normalizeKey、时长差 >3s → 独立 item / 独立 fanOut 记录）
  //      的已红心平台桥不到播放中的记录。修复：detect 里按库快照并账。
  {
    // 库快照：同一首歌两个版本（title/artist 相同、时长差 17s → 两条 item）。
    // A 版本已被 discover 补成 3 平台；B 版本（用户正在播的）只有 netease。
    const libraryKey = `library:${session.id}`;
    store[libraryKey] = {
      importedAt: Date.now(),
      sources: [],
      items: [
        {
          id: 'merged-item-a',
          title: '夜中のキスミ',
          artist: 'ずっと真夜中でいいのに。',
          duration: 275,
          bestSource: 'netease',
          sources: [
            { platform: 'netease', trackId: 'n-sib-275', hasCopyright: true },
            { platform: 'qq', trackId: 'q-sib', hasCopyright: true },
            { platform: 'spotify', trackId: 'sp-sib', hasCopyright: true },
          ],
        },
        {
          id: 'merged-item-b',
          title: '夜中のキスミ',
          artist: 'ずっと真夜中でいいのに。',
          duration: 258,
          bestSource: 'netease',
          sources: [{ platform: 'netease', trackId: 'n-258', hasCopyright: true }],
        },
      ],
    };
    neteaseSearchResults = [];
    qqSearchResults = [];
    spotifySearchResults = [];
    try {
      // (a) settle-wait：detect 的响应应等 discover 落定，直接含新匹配的平台。
      (svc as any).likedCache.clear(); // 清掉前面用例的 liked TTL 缓存
      qqLikedRemote = ['q-det-settle'];
      neteaseSearchResults = [
        neTrack('n-det-settle', 'settle-wait 测试曲', 'Settle Artist', 200),
      ];
      const ra = await svc.detectLikedAndSync(
        session,
        'merged-settle',
        [{ platform: 'qq', trackId: 'q-det-settle' }],
        { title: 'settle-wait 测试曲', artist: 'Settle Artist', duration: 200 },
      );
      assert.deepStrictEqual(
        ra.fannedOutTo.sort(),
        ['netease', 'qq'],
        `detect 响应应等 discover 落定（fannedOutTo 含 netease），实际 ${JSON.stringify(ra.fannedOutTo)}`,
      );

      // (b) 兄弟并账：播放 258s 版本（库里只有 netease source），角标应并进
      // 275s 版本已补的 qq + spotify（+ netease 自身）→ 3 平台。
      (svc as any).likedCache.clear();
      neteaseSearchResults = [];
      qqLikedRemote = ['q-258'];
      const rb = await svc.detectLikedAndSync(
        session,
        'merged-qq-item-b',
        [{ platform: 'qq', trackId: 'q-258' }],
        { title: '夜中のキスミ', artist: 'ずっと真夜中でいいのに。', duration: 258 },
      );
      assert.deepStrictEqual(
        rb.fannedOutTo.sort(),
        ['netease', 'qq', 'spotify'],
        `兄弟版本已红心平台应并账（角标按歌算），实际 ${JSON.stringify(rb.fannedOutTo)}`,
      );
      assert.ok(
        neteaseLikes.includes('n-det-settle'),
        'settle-wait 的 discover 命中应已同步远端 netease',
      );
    } finally {
      neteaseSearchResults = [];
    }
    console.log('✅ 22. detect 等 discover 落定 + 兄弟版本并账：❤ 角标按歌算');
  }

  // ── 23. 多艺人 collab + Spotify 「title + co-author 后缀」识别 ──
  // 用户实测回归：「PLACEBO (安慰剂) - 米津玄師 (よねづ けんし) / 野田洋次郎 
  // (のだようじろう)」(QQ/netease, dur=240) 在 Spotify 是「PLACEBO ＋ 野田洋次郎 - 
  // Kenshi Yonezu / Yojiro Noda」(dur=240)。两个拦路虎：
  //   a) 艺人字段多艺人用「/」拼——别名表/罗马化按 blob 查不到。
  //      修：artistLooseMatch 多艺人兜底，按 /／,&; 拆后配对别名/罗马化，命中
  //      ≥ ceil(n/2) 过。本例米津玄師↔Kenshi Yonezu 命中（1/2 过）。
  //   b) Spotify 标题「PLACEBO ＋ 野田洋次郎」= seed 标题剥括号「PLACEBO」+
  //      协作者后缀。Tier 5 长度门 50% 把它挡掉（15 vs 7 = 53%），JW 0.857 也
  //      差 0.023。修：Tier 5b「cand 是 want 的严格前缀 + extra 段命中某侧
  //      艺人别名/罗马化」豁免长度门。本例 extra「野田洋次郎」命中 seed.artist。
  {
    let spotifyCalls: string[] = [];
    const wrappedSpotify = {
      ...spotify,
      search: async (_ps: unknown, kw: string, limit: number) => {
        spotifyCalls.push(kw);
        // 任何 kw 都返回真实歌曲（模拟 Spotify 实际只有这一首且元数据略有差异）
        return [
          {
            id: 'sp-placebo',
            provider: 'spotify',
            title: 'PLACEBO ＋ 野田洋次郎',
            artist: 'Kenshi Yonezu / Yojiro Noda',
            album: '',
            coverUrl: '',
            audioUrl: '',
            duration: 240,
            liked: false,
          },
        ];
      },
    };
    const origSpotify = (svc as any).spotify;
    const origSessionProviders = session.providers;
    (svc as any).spotify = wrappedSpotify;
    (session as any).providers = {
      ...origSessionProviders,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      (svc as any).equivSearchCache.clear();
      const t = await (svc as any).searchEquivalent(session, 'spotify', {
        title: 'PLACEBO (安慰剂)',
        artist: '米津玄師 (よねづ けんし) / 野田洋次郎 (のだようじろう)',
        duration: 240,
      });
      assert.ok(
        t && t.id === 'sp-placebo',
        `PLACEBO 多艺人 collab 应命中 Spotify（Tier 5b），实际 ${t && t.id}`,
      );
    } finally {
      (svc as any).spotify = origSpotify;
      (svc as any).equivSearchCache.clear();
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 23. 多艺人 collab + Spotify 「title + co-author 后缀」识别');
  }

  // ── 24. Tier 5b 翻唱拒绝：诱 - 林宥嘉 ↔ 诱丨林宥嘉（Cover by KiraCola）- KiraCola
  // 用户场景：seed 是 QQ 平台的「诱 - 林宥嘉」原唱，cand 标题里把原唱名写在
  // 后面「诱丨林宥嘉」+ (Cover by KiraCola)。老代码因 Tier 5b 把「命中原唱名」
  // 当正信号而误命中，把 KiraCola 翻唱版当作林宥嘉原唱纳入 fan-out。
  // 修：COVER 候选池前置过滤 + Tier 5b 反转 + artistLooseMatch 复查。
  {
    neteaseSearchResults = [neTrack('n-cover', '诱丨林宥嘉（Cover by KiraCola）', 'KiraCola', 100)];
    const r = await svc.fanOutLike(
      session,
      'merged-cover',
      [{ platform: 'qq', trackId: 'q-cover' }],
      true,
      { title: '诱', artist: '林宥嘉', duration: 100 },
    );
    // fannedOutTo 总是包含 source（这里是 qq）—— 我们关心的是**有没有被
    // 新增 netease**。翻唱场景下 netease 必须没有进入。
    assert.strictEqual(
      r.fannedOutTo.includes('netease'),
      false,
      `翻唱（Coby KiraCola）绝不能被 fan-out 到 netease，实际 fannedOutTo=${JSON.stringify(r.fannedOutTo)}`,
    );
    assert.ok(
      !(await likedIds('netease')).includes('n-cover'),
      '翻唱不能被写进本地 liked',
    );
    console.log('✅ 24. Tier 5b 翻唱拒绝：Coby KiraCola 不被 fan-out');
  }

  // ── 25. Tier 2 长度门：单字标题 seed + 长候选（虹/诱/Love）不可任意 includes
  // 用户场景：seed 「诱」(1字) + cand 「诱惑的街」是不同歌，老代码 Tier 2 includes
  // 命中。修：minLen=3 + max>3 才放行（双方都 ≥3 时仍走 includes）。
  {
    neteaseSearchResults = [neTrack('n-bait', '诱惑的街', '某人', 100)];
    const r = await svc.fanOutLike(
      session,
      'merged-bait',
      [{ platform: 'qq', trackId: 'q-bait' }],
      true,
      { title: '诱', artist: '林宥嘉', duration: 100 },
    );
    assert.ok(
      !(await likedIds('netease')).includes('n-bait'),
      '单字 seed + 长候选 不可 includes 命中（虹/诱/Love 等)',
    );
    console.log('✅ 25. Tier 2 单字标题长度门：单字 seed 不再误并长候选');
  }

  // ── 26. Tier 3 跨版本拒绝：seed 是 studio 版（无标签）+ cand 是 Live 版（差 25s）
  // 用户场景：用户 ❤ 的是 QQ studio 版（300s），Spotify 搜索返回 Live 版（320s）
  // 同名歌，老代码用 ±30s lenient 命中 → live 被 star 进来。修：跨版本守卫把
  // 30s 收窄到 ±3s（seed 是 null、cand 是 LIVE，标签不等）。
  {
    neteaseSearchResults = []; // 清空，避免其他平台干扰
    spotifySearchResults = [spTrack('sp-live', '诱 (Live)', '林宥嘉', 320)];
    const r = await svc.fanOutLike(
      session,
      'merged-xversion',
      [{ platform: 'qq', trackId: 'q-xv' }],
      true,
      { title: '诱', artist: '林宥嘉', duration: 300 },
    );
    assert.strictEqual(
      r.fannedOutTo.includes('spotify'),
      false,
      `跨版本（studio seed + live cand 差 20s）不可命中，实际 fannedOutTo=${JSON.stringify(r.fannedOutTo)}`,
    );
    console.log('✅ 26. Tier 3 跨版本拒绝：studio seed + (Live) cand 不命中');
  }

  // ── 27. Tier 3 同版本保留：seed 是 (Live) + cand 也是 (Live) 差 20s 仍命中
  // 用户场景：用户 ❤ 的是 QQ (Live) 版（320s），Spotify 也有 (Live) 版（300s）。
  // 同版本标签 → 30s lenient 保留（这是为找回用户已经在听的同一录音的跨平台源）。
  {
    neteaseSearchResults = [];
    spotifySearchResults = [spTrack('sp-live-2', '誘 (Live at Studio)', '林宥嘉', 300)];
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      await svc.fanOutLike(
        session,
        'merged-xversion-2',
        [{ platform: 'qq', trackId: 'q-xv-2' }],
        true,
        { title: '誘 (Live)', artist: '林宥嘉', duration: 320 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('spotify')).includes('sp-live-2'),
      );
      assert.ok(
        ok,
        '同版本（都是 LIVE）差 20s 仍命中 30s lenient',
      );
    } finally {
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 27. Tier 3 同版本保留：(Live) seed + (Live at Studio) cand 命中');
  }

  // ── 28. COVER 候选池前置过滤：搜出来的整条候选都是翻唱版 → 直接 no-match
  // 用户场景：seed = 海阔天空（studio，原版），所有平台搜索都只返回了「翻唱」
  // 版（标题含 (翻唱) / (Cover by X)）。修：extractVersionTag 在 matchEquivalentTrack
  // 入口就过滤掉 COVER → 后续 6 tier 看不到，no match 正确返回。
  {
    neteaseSearchResults = [
      neTrack('n-cov', '海阔天空 (翻唱)', '路人甲', 305),
      neTrack('n-cov-2', '海阔天空 (Cover by X)', 'X', 304),
    ];
    const r = await svc.fanOutLike(
      session,
      'merged-only-cover',
      [{ platform: 'qq', trackId: 'q-oc' }],
      true,
      { title: '海阔天空', artist: 'Beyond', duration: 305 },
    );
    assert.strictEqual(
      r.fannedOutTo.includes('netease'),
      false,
      `全是翻唱候选时绝不能被 fan-out 到 netease，实际 fannedOutTo=${JSON.stringify(r.fannedOutTo)}`,
    );
    console.log('✅ 28. COVER 候选池前置过滤：所有候选是翻唱 → no match');
  }

  // ── 29. PLACEBO 反向回归：seed + cand 都是米津玄師 / 野田洋次郎（同一 collab
  // 两端），Tier 5b 应命中（discriminator：extra 是 cand 自己艺人整串，且 cand
  // 与 seed 艺人语义对齐）。
  // 修复前：反转规则「extraHitsSeed=true → continue」误拒（extra `野田洋次郎`
  // 出现在 seed 字段里）。修复后：加 extraIsExactCandArtist 整串佐证，
  // PLACEBO 重新命中。
  {
    spotifySearchResults = [spTrack('sp-placebo', 'PLACEBO + 野田洋次郎', 'Kenshi Yonezu / Yojiro Noda', 240)];
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      await svc.fanOutLike(
        session,
        'merged-placebo',
        [{ platform: 'qq', trackId: 'q-placebo' }],
        true,
        { title: 'PLACEBO (安慰剂)', artist: '米津玄師 / 野田洋次郎', duration: 240 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('spotify')).includes('sp-placebo'),
      );
      assert.ok(
        ok,
        'PLACEBO 多艺人 collab 重新命中（extra 整串等于 cand 艺人）',
      );
    } finally {
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 29. PLACEBO 反向回归：修复 extraHitsSeed 误拒，collab 重新命中');
  }

  // ── 30. 标题罗马音变体：星野源 恋 ↔ Spotify Koi ─────────────
  // 用户场景：QQ 上是「恋」（汉字），Spotify 索引的是罗马音「Koi」——搜汉字
  // 召回到 0。修：searchEquivalentUncached 加 title-romaji 变体（kuromoji
  // 读日文读音 → koi 再搜）。这里 mock 的 spotify.search 按 kw 区分：只有 kw
  // 含 'koi' 才返回 Koi（模拟 Spotify 按罗马音索引），其余返回空。
  {
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = {
      ...origSpotify,
      search: async (_ps: unknown, kw: string, _limit: number) => {
        if (kw.toLowerCase().includes('koi')) {
          return [spTrack('sp-koi', 'Koi', '星野源', 270)];
        }
        return [];
      },
    };
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      await svc.fanOutLike(
        session,
        'merged-koi',
        [{ platform: 'qq', trackId: 'q-koi' }],
        true,
        { title: '恋', artist: '星野源', duration: 270 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('spotify')).includes('sp-koi'),
      );
      assert.ok(ok, '标题罗马音变体应命中 Spotify 的 Koi（星野源 恋）');
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 30. 标题罗马音变体：恋 ↔ Koi（Spotify 罗马音索引）命中');
  }

  // ── 31. 假名标题跨脚本：aiko もっと ↔ Spotify Motto ─────────
  // 用户场景：seed「もっと - aiko」（假名标题），Spotify 是「Motto - aiko」。
  // 修：isCrossScript 的 hasCjk 加入假名（぀-ヿ）——旧版只看汉字，「もっと」
  // 不被视为 CJK 侧 → Tier 4 跨脚本标题拒绝。这里 mock 返回 Motto - aiko
  // （标题罗马音已在 #30 覆盖召回，本 case 专测匹配层）。
  {
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = {
      ...origSpotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        spTrack('sp-motto', 'Motto', 'aiko', 290),
      ],
    };
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      await svc.fanOutLike(
        session,
        'merged-motto',
        [{ platform: 'qq', trackId: 'q-motto' }],
        true,
        { title: 'もっと', artist: 'aiko', duration: 291 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('spotify')).includes('sp-motto'),
      );
      assert.ok(ok, '假名标题跨脚本应命中 Spotify 的 Motto（aiko もっと）');
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 31. 假名标题跨脚本：もっと ↔ Motto（aiko）命中');
  }

  // ── 32. 多候选选最近时长版本（告别的时代 选错版本修复）──────
  // seed 告别的时代 dur=300（QQ/网易云 同专辑母带版）。Spotify 返回两个版本：
  // 精选集版 dur=280（排搜索结果**第一**）+ 同专辑版 dur=301。旧代码「命中
  // 即返回第一个」→ star 精选集版（错）。修后按时长接近度排序 → star 301 版。
  {
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = {
      ...origSpotify,
      search: async (_ps: unknown, _kw: string, _limit: number) => [
        spTrack('sp-compilation', '告别的时代', '罗大佑', 280), // 精选集版，排第一
        spTrack('sp-album', '告别的时代', '罗大佑', 301), // 同专辑母带版，时长最近
      ],
    };
    const origSessionProviders = session.providers;
    (session as any).providers = {
      ...session.providers,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    try {
      await svc.fanOutLike(
        session,
        'merged-gaobie',
        [{ platform: 'qq', trackId: 'q-gaobie' }],
        true,
        { title: '告别的时代', artist: '罗大佑', duration: 300 },
      );
      const ok = await waitFor(async () =>
        (await likedIds('spotify')).includes('sp-album'),
      );
      assert.ok(ok, '应 star 时长最接近的同专辑版 sp-album(301)，非排第一的精选集版 sp-compilation(280)');
      assert.ok(
        !(await likedIds('spotify')).includes('sp-compilation'),
        '不应 star 精选集版',
      );
    } finally {
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
    }
    console.log('✅ 32. 多候选按时长接近度选版本（告别的时代 选对同专辑版）');
  }

  // ── 33. 慢 discover（某 likeable 平台搜索悬挂 > waitForSettled 6s）→ settled 语义
  // 用户场景：好不容易-方大同，QQ + 网易云已 ❤，Spotify 已登录但**没有这首歌**
  // （且网络差时搜索能悬挂 30s / fetch failed）。discover 必须搜 Spotify 才能
  // 确认缺席 → 串行队列被拖过 detect 的 waitForSettled(6s) → detect 返回的是
  // **中间态**（只有 qq，角标 1）。老前端把两个相同的中间值当"稳定"停止轮询，
  // discover 落定（netease 补上、应显示 2）后没人再刷新 → 角标永远不显示 2。
  // 修：detect 响应带 settled 标志——settled=false = 中间态，前端必须继续轮询
  // 直到 settled=true；同时等价曲搜索套 5s 超时，悬挂不再堵死整条队列。
  {
    const origSpotify = (svc as any).spotify;
    const origSessionProviders = session.providers;
    let releaseSpotify: () => void = () => {};
    const spotifyGate = new Promise<void>((r) => {
      releaseSpotify = r;
    });
    (svc as any).spotify = {
      ...origSpotify,
      search: async () => {
        await spotifyGate; // 模拟悬挂的网络请求（老代码无超时 → 堵死串行队列）
        return [];
      },
    };
    (session as any).providers = {
      ...origSessionProviders,
      spotify: { spotify: { accessToken: 'tok', tier: 'free' } },
    };
    (svc as any).likedCache.clear();
    (svc as any).equivSearchCache.clear();
    qqLikedRemote = ['q-slow'];
    neteaseSearchResults = [neTrack('n-slow', '慢速测试曲', 'Slow Artist', 200)];
    try {
      // (a) discover 未落定 → settled=false，fannedOutTo 只有 qq（netease 还没补上）
      const ra = await svc.detectLikedAndSync(
        session,
        'merged-slow',
        [{ platform: 'qq', trackId: 'q-slow' }],
        { title: '慢速测试曲', artist: 'Slow Artist', duration: 200 },
      );
      assert.strictEqual(
        ra.settled,
        false,
        `discover 悬挂时 detect 应返回 settled=false（中间态），实际 ${JSON.stringify(ra)}`,
      );
      assert.deepStrictEqual(
        ra.fannedOutTo.sort(),
        ['qq'],
        'settled=false 时 fannedOutTo 只含已落账平台（qq）',
      );

      // (b) 放行 Spotify（模拟 fetch 最终返回/失败）→ discover 落定 → 后续
      // detect 应返回 settled=true 且 fannedOutTo 含 netease（角标 = 2）。
      releaseSpotify();
      const ok = await waitFor(async () => {
        const rb = await svc.detectLikedAndSync(
          session,
          'merged-slow',
          [{ platform: 'qq', trackId: 'q-slow' }],
          { title: '慢速测试曲', artist: 'Slow Artist', duration: 200 },
        );
        return rb.settled === true && rb.fannedOutTo.includes('netease');
      }, 8000);
      assert.ok(
        ok,
        'discover 落定后 detect 应返回 settled=true 且 fannedOutTo 含 netease',
      );
      const rc = await svc.detectLikedAndSync(
        session,
        'merged-slow',
        [{ platform: 'qq', trackId: 'q-slow' }],
        { title: '慢速测试曲', artist: 'Slow Artist', duration: 200 },
      );
      assert.deepStrictEqual(
        rc.fannedOutTo.sort(),
        ['netease', 'qq'],
        `落定后角标应是 2 平台（qq+netease），实际 ${JSON.stringify(rc.fannedOutTo)}`,
      );
    } finally {
      releaseSpotify(); // 别把 gate 卡在队列里影响后续用例
      (svc as any).spotify = origSpotify;
      (session as any).providers = origSessionProviders;
      (svc as any).equivSearchCache.clear();
      neteaseSearchResults = [];
    }
    console.log('✅ 33. 慢 discover → detect settled=false（中间态），落定后 settled=true 角标齐全');
  }

  // ── 34. 合唱跨平台配对：拼接 key 移除后仍走拆分配对命中 ──
  // 2026-08-14：别名表的多艺人拼接 key（'方大同王力宏' 等 33 条）全部移除——
  // 独唱↔合唱不再经表互并（见 common artistAlias.test）。合唱的跨平台匹配由
  // artistLooseMatch 的 splitArtists 拆分配对承担：QQ「方大同 / 王力宏」↔
  // Spotify「Khalil Fong / Wang Leehom」按位桥（表：方大同↔Khalil Fong、
  // 王力宏↔Wang Leehom），2/2 命中 → 红心正常同步。回归锁死这条链路。
  {
    neteaseSearchResults = [
      neTrack('n-collab-34', '好不容易', 'Khalil Fong / Wang Leehom', 380),
    ];
    // fanOutLike 立即返回（discover 异步落账），轮询本地 liked 集合等命中。
    await svc.fanOutLike(
      session,
      'merged-collab-34',
      [{ platform: 'qq', trackId: 'q-collab-34' }],
      true,
      { title: '好不容易', artist: '方大同 / 王力宏', duration: 380 },
    );
    const ok = await waitFor(async () =>
      (await likedIds('netease')).includes('n-collab-34'),
    );
    assert.ok(
      ok,
      '合唱 seed 应通过拆分配对命中 netease 合唱候选（Khalil Fong / Wang Leehom）',
    );
    console.log('✅ 34. 合唱跨平台配对：方大同/王力宏 ↔ Khalil Fong/Wang Leehom 命中');
  }

  // ── 35. 松散规则误并修复（2026-08-14 用户实测）──
  //  a) 「我们 - 陈奕迅」(260s) 不得匹配合唱/另一首歌「我們萬歲 - Eason Chan /
  //     eason and the duo band」(237s)——2 字标题 ⊂ 4 字标题，Tier 5 relaxed
  //     title 的 50% 长度门恰好在 0.5 放行。修：短标题门（短侧 <3 字、长侧
  //     >3 字 → 拒，与 Tier 2 同款）。
  //  b) 「告别的时代」(studio 300s) 不得匹配「告别的时代 - Live」(237s)——无
  //     括号的破折号版本尾缀 extractVersionTag 认不出 → 版本守卫退化 lenient
  //     30s。修：versionTagStrict 识别 ' - Live' 尾缀 → 版本不等 → ±3s 严格。
  {
    const origSpotify = (svc as any).spotify;
    (svc as any).spotify = {
      ...origSpotify,
      search: async () => [
        spTrack('sp-wmws-35', '我們萬歲', 'Eason Chan / eason and the duo band', 237),
      ],
    };
    try {
      const t = await (svc as any).searchEquivalent(session, 'spotify', {
        title: '我们', artist: '陈奕迅', duration: 260,
      });
      assert.strictEqual(t, null, '「我们」不得匹配「我們萬歲」（短标题门）');
    } finally {
      (svc as any).spotify = origSpotify;
    }
    (svc as any).equivSearchCache.clear();

    (svc as any).spotify = {
      ...origSpotify,
      search: async () => [
        spTrack('sp-live-35', '告别的时代 - Live', '罗大佑', 237),
      ],
    };
    try {
      const t = await (svc as any).searchEquivalent(session, 'spotify', {
        title: '告别的时代', artist: '罗大佑', duration: 300,
      });
      assert.strictEqual(t, null, '「告别的时代」studio 不得匹配「告别的时代 - Live」（无括号版本尾缀守卫）');
    } finally {
      (svc as any).spotify = origSpotify;
      (svc as any).equivSearchCache.clear();
    }
    console.log('✅ 35. 松散规则收紧：我们≠我們萬歲、告别的时代≠-Live 版');
  }

  console.log('\n🎉 cross-platform-match.e2e 全部 35 项通过');
}

main().catch((err) => {
  console.error('❌ cross-platform-match.e2e 失败:', err);
  process.exit(1);
});
