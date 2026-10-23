/**
 * RecoService 候选池边界 + 兜底白盒测试。
 *
 * 这三条路径**真实存在、但一直没被测到**（PR #116 的 coverage diff 门禁点名）：
 *
 *   1. filterPoolByExclude 的**过滤分支**（排除集非空）
 *      —— 之前只测到"排除集为空"（函数第一行就早退），真正的过滤逻辑从没跑过：
 *         「候选池缓存命中 → 按 exclude 过滤」这条路是死代码。
 *   2. 空库 + intent → **不报 library_empty**
 *      —— NL 歌单路径不依赖个人库（specs/nl-intent-retrieval §验收）：
 *         从没导入过 ❤ 库的用户点「生成队列」不能吃 400。
 *   3. 候选池构建抛异常 → 回退空池
 *      —— buildPool 的最后一道兜底："候选池的任何意外都不该让推荐整体失败"。
 *
 * 运行: npx ts-node packages/server/src/reco/reco-pool-edge.test.ts
 */
export {};

const assert = require('node:assert');
const { RecoService } = require('./reco.service');

/** 测试用迷你目录：搜"艺人"或"歌名 艺人"都能命中对应曲目。 */
const CATALOG = [
  { title: 'So What', artist: 'Miles Davis' },
  { title: 'Blue in Green', artist: 'Miles Davis' },
  { title: 'So What', artist: 'John Coltrane' },
];

function mkItem(t: { title: string; artist: string }): any {
  return {
    id: `${t.artist}-${t.title}`,
    title: t.title,
    artist: t.artist,
    album: `${t.artist} Album`,
    // 非空封面 → 不触发封面兜底（那会发真实网络请求）
    coverUrl: 'https://cover.local/x.jpg',
    duration: 200,
    sources: [{ platform: 'qq', trackId: 'x' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
  };
}

interface Log {
  searched: string[];
  radio: number;
  related: string[];
}

function makeMusic(log: Log) {
  return {
    getLibrary: () => null,
    searchUnified: async (_s: any, q: string) => {
      log.searched.push(q);
      const hits = CATALOG.filter((t) => q.includes(t.title) || q.includes(t.artist));
      return { items: hits.map(mkItem) };
    },
    findRelatedArtists: async (_s: any, artist: string) => {
      log.related.push(artist);
      return [];
    },
    fetchRecoRadioCandidates: async () => {
      log.radio++;
      return [];
    },
  };
}

/**
 * Map 支撑的 storage。**key 敏感**：run() 要从 'secrets:deepseek' 拿 API key
 * （getApiKey 的口径），而信号/历史是各自的键 → 缺一个就当空。
 */
function makeStorage(withApiKey = false) {
  const store = new Map<string, any>();
  if (withApiKey) store.set('secrets:deepseek', { apiKey: 'sk-test-0123456789' });
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: any) => {
      store.set(k, v);
    },
  };
}

function makeService(music: any, storage?: any) {
  const fakeSessionService = { resolve: () => ({ id: 's1' }) };
  const fakeConfig = { get: () => undefined };
  return new RecoService(fakeConfig, storage ?? makeStorage(), fakeSessionService, music);
}

const SESSION = { id: 's1' } as any;

/** 口味档案（普通模式用；intent 模式下锚点由种子决定，这份只影响 size/缓存 key）。 */
const PROFILE = {
  size: 100,
  signature: 'x',
  artists: [{ name: '陈奕迅', key: '陈奕迅', songs: 30, signal: 0, weight: 30 }],
  anchors: ['陈奕迅'],
  seeds: [],
};

/** 「来点儿爵士乐」解析后的 intent。 */
const JAZZ_INTENT = {
  mood: 'chill',
  genres: ['jazz'],
  tempo: 'any',
  language: 'any',
  similar_artists: [],
  similar_tracks: [],
  exclude_artists: [],
  exclude_genres: [],
  genre_artists: [{ genre: 'jazz', artists: ['Miles Davis', 'John Coltrane'] }],
  target_count: 8,
  rationale: '用户要爵士',
};

async function main() {
  // ── 1. filterPoolByExclude：排除集非空 → 过滤分支真的跑起来 ──
  //
  // 之前只测了"排除集为空"（函数第一行早退）→ 过滤逻辑是死代码：
  // 缓存命中时按 exclude 过滤（续播避重）这条路径从没跑过。
  {
    const log: Log = { searched: [], radio: 0, related: [] };
    const svc = makeService(makeMusic(log));
    const seeds = {
      artists: ['Miles Davis', 'John Coltrane'],
      tracks: [],
      styleDirective: true,
    };
    const first = await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [],
      2, // count=2：池子够用 → 不触发口味兜底
      undefined,
      undefined,
      {},
      { intentSeeds: seeds },
    );
    const poolSize = first.pool.candidates.length;
    assert.ok(poolSize >= 2, `第一次建池至少 2 首候选（实际 ${poolSize}）`);

    // 第二次：同一个池（命中缓存），但**带排除集** → 走过滤分支
    const victim = first.pool.candidates[0];
    const second = await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [{ title: victim.title, artist: victim.artist }],
      1, // count=1：过滤后仍够用 → 才会返回 cached
      undefined,
      undefined,
      {},
      { intentSeeds: seeds },
    );
    assert.strictEqual(second.cached, true, '第二次应命中池缓存');
    assert.strictEqual(second.pool.candidates.length, poolSize - 1, '排除集把那一首滤掉了');
    assert.ok(
      !second.pool.candidates.some(
        (c: any) => c.title === victim.title && c.artist === victim.artist,
      ),
      '被排除的歌不在返回的池里',
    );
    console.log('  ✓ filterPoolByExclude: 非空排除集真的滤掉了那一首');
  }

  // ── 2. 空库 + intent → 不报 library_empty，照常出歌 ──────────
  //
  // ⚠️ 2026-10-23 实测 bug：库检查原本无条件前置在 intent 判定之前 →
  // 从没导入过 ❤ 库的用户点 NL 歌单「生成队列」必然 400 library_empty。
  {
    const log: Log = { searched: [], radio: 0, related: [] };
    const svc = makeService(makeMusic(log), makeStorage(true));

    // 抓日志：断言走的是"空库 + intent"这条分支（而不是碰巧没进 if）
    const logs: string[] = [];
    const origLog = svc['logger'].log.bind(svc['logger']);
    svc['logger'].log = (m: any) => {
      logs.push(String(m));
      origLog(m);
    };
    // 不打真实网络：DeepSeek 直接返回一首爵士
    svc['callDeepSeek'] = async () =>
      '[{"title":"So What","artist":"Miles Davis","reason":"经典"}]';

    const result = await svc.run(SESSION, { intent: JAZZ_INTENT });
    assert.ok(
      logs.some((l) => l.includes('空库') && l.includes('意图种子')),
      `应记录"空库 + intent"分支日志（实际日志：${logs.join(' | ')}）`,
    );
    assert.ok(Array.isArray(result.items), '返回 items 数组');
    assert.strictEqual(result.items.length, 1, '空库也能照常出歌');
    assert.strictEqual(result.items[0].title, 'So What');
    console.log('  ✓ 空库 + intent: 不报 library_empty，照常出歌');
  }

  // ── 3. 候选池构建抛异常 → 回退空池，推荐不整体失败 ──────────
  //
  // buildPool 的最后一道兜底。真实触发场景：provider 集成漂移
  // （某个方法不存在/签名变了）→ 池构建炸掉 → 推荐仍要能出结果。
  {
    const log: Log = { searched: [], radio: 0, related: [] };
    const music: any = makeMusic(log);
    // 少一个方法（集成漂移）→ 建池时抛 TypeError
    delete music.fetchRecoRadioCandidates;
    const svc = makeService(music);

    const built = await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [],
      3,
      undefined,
      undefined,
      {},
    );
    assert.deepStrictEqual(built.pool.candidates, [], '构建失败 → 回退空池');
    assert.deepStrictEqual(
      built.pool.byOrigin,
      { artist: 0, 'related-artist': 0, radio: 0 },
      '回退的是空池（各来源计数全 0）',
    );
    assert.strictEqual(built.cached, false, '回退不是缓存命中');
    console.log('  ✓ 候选池构建失败 → 回退空池，推荐不整体失败');
  }

  console.log('\n✅ reco-pool-edge: all tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
