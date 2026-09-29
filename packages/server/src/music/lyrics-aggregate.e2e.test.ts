/**
 * 歌词多源聚合回归测试（stub provider，不打真实网络）。
 *
 * 覆盖两种模式：
 *  A. merge（默认）：并行拉全部候选源 → LRC 合并去重
 *     1. 主源有词且 extras 也命中 → 合并并集（低优先级补进来的行在列）
 *     2. 主源无词 → 合并结果来自 extras（mergedFrom=netease）
 *     3. 主源有词但 extras 缺行 → added>0（并集增量）
 *     4. 平台全落空 → lyrics.ovh 兜底，synced=false（纯文本）
 *     5. 全部无词 → lines=null，source=null
 *     6. 文本重复的两源 → dropped>0 且不产生重复行
 *     7. 时间轴错位的源 → rejected 含该源，主源结果不被污染
 *  B. merge=false 快路径（first-hit-wins，回归旧行为）
 *     8. 主源命中即返回，不打其余平台
 *  C. availability：命中即停 + 缓存生效 / 全 miss
 *     9. availability 命中即停 + 第二次走缓存
 *    10. availability 全 miss → false
 *
 * 运行: npx ts-node src/music/lyrics-aggregate.e2e.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');

const fakeStorage = {
  get: () => undefined,
  set: () => {},
};

const SYNCED = [
  { time: 1.2, text: '第一句' },
  { time: 5.8, text: '第二句' },
];

/** 与 SYNCED 同源但多一行（第三句），用来验并集增量。 */
const SYNCED_PLUS = [...SYNCED, { time: 9.0, text: '第三句' }];

/** 与 SYNCED 同词但整条时间轴 +6s —— 应当被判为错位源整源丢弃。 */
const MISALIGNED = [
  { time: 7.4, text: '第一句' },
  { time: 12.0, text: '第二句' },
];

let qqCalls = 0;
let neteaseCalls = 0;

function makeSvc(opts: {
  qqLyrics?: any;
  neteaseLyrics?: any;
  ovhLyrics?: any;
}) {
  qqCalls = 0;
  neteaseCalls = 0;
  const qq = {
    getLyrics: async () => {
      qqCalls++;
      return opts.qqLyrics ?? null;
    },
  };
  const netease = {
    getLyrics: async () => {
      neteaseCalls++;
      return opts.neteaseLyrics ?? null;
    },
  };
  const deezer = { getLyrics: async () => null };
  const spotify = {};
  const match = {};
  const lyricsOvh = { getLyrics: async () => opts.ovhLyrics ?? null };
  const likeSync = {
    registerProcessor: () => {},
    registerDiscoverResolver: () => {},
    enqueue: () => {},
  };
  const lyricsService = new LyricsService(
    netease as any,
    deezer as any,
    qq as any,
    lyricsOvh as any,
  );
  return new MusicService(
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
}

// netease getLyrics 需要登录 session
const session = {
  id: 'sess-lyrics',
  createdAt: Date.now(),
  providers: { qq: { qqCookie: 'c' }, netease: { musicU: 'u' } },
};

const EXTRAS = [{ platform: 'netease', trackId: 'n1' }];

async function main() {
  // ── 1. merge 默认开：两源都命中 → 并集 ───────────────────────
  {
    const svc = makeSvc({ qqLyrics: SYNCED, neteaseLyrics: SYNCED_PLUS });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, '晴天', '周杰伦',
    );
    assert.deepStrictEqual(res.mergedFrom, ['qq', 'netease']);
    assert.strictEqual(res.source, 'qq', '主源仍是 source');
    assert.strictEqual(res.synced, true);
    assert.strictEqual(res.lines.length, 3, '并集 = 3 行');
    assert.strictEqual(res.added, 1, 'netease 补进 1 行');
    assert.strictEqual(res.dropped, 2, '两行重复被去重');
    assert.ok(
      res.lines.some((l: any) => l.text === '第三句'),
      '低优先级源独有的行必须在结果里',
    );
    assert.ok(neteaseCalls === 1 && qqCalls === 1, 'merge 模式两源都要拉');
    console.log('✅ 1. merge 并集：mergedFrom=[qq,netease], added=1, dropped=2');
  }

  // ── 2. 主源无词 → 结果来自 extras ────────────────────────────
  {
    const svc = makeSvc({ neteaseLyrics: SYNCED });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, '晴天', '周杰伦',
    );
    assert.deepStrictEqual(res.mergedFrom, ['netease']);
    assert.strictEqual(res.source, 'netease');
    assert.strictEqual(res.added, 0, '单源合并 added=0');
    assert.ok(qqCalls >= 1, 'qq 应被查过');
    console.log('✅ 2. 主源无词 → mergedFrom=[netease]');
  }

  // ── 3. 纯去重（两源完全一致）────────────────────────────────
  {
    const svc = makeSvc({ qqLyrics: SYNCED, neteaseLyrics: SYNCED });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, '晴天', '周杰伦',
    );
    assert.deepStrictEqual(res.mergedFrom, ['qq'], '全重复的源不贡献行');
    assert.strictEqual(res.lines.length, 2);
    assert.strictEqual(res.dropped, 2);
    assert.strictEqual(res.added, 0);
    console.log('✅ 3. 两源一致 → 只留主源，dropped=2');
  }

  // ── 4. 时间轴错位源整源丢弃 ────────────────────────────────
  {
    const svc = makeSvc({ qqLyrics: SYNCED, neteaseLyrics: MISALIGNED });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, '晴天', '周杰伦',
    );
    assert.deepStrictEqual(res.rejected, ['netease'], '错位源应被拒');
    assert.deepStrictEqual(res.mergedFrom, ['qq']);
    assert.strictEqual(res.lines.length, 2, '主源结果不被污染');
    console.log('✅ 4. 错位源（+6s）→ rejected=[netease]，主源结果干净');
  }

  // ── 5. 平台全落空 → lyrics.ovh 兜底（纯文本, synced=false）──
  {
    const svc = makeSvc({
      ovhLyrics: [
        { time: 0, text: 'line one' },
        { time: 0, text: 'line two' },
      ],
    });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, 'Hello', 'Adele',
    );
    assert.strictEqual(res.source, 'lyricsovh');
    assert.deepStrictEqual(res.mergedFrom, ['lyricsovh']);
    assert.strictEqual(res.synced, false, '纯文本歌词必须标记 unsynced');
    console.log('✅ 5. 平台全 miss → lyrics.ovh 兜底, synced=false');
  }

  // ── 6. 全部无词 → null ─────────────────────────────────────
  {
    const svc = makeSvc({});
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', [], 'Unknown', 'Nobody',
    );
    assert.strictEqual(res.lines, null);
    assert.strictEqual(res.source, null);
    assert.deepStrictEqual(res.mergedFrom, []);
    console.log('✅ 6. 全部无词 → lines=null');
  }

  // ── 7. merge=false 快路径：主源命中即返回 ────────────────────
  {
    const svc = makeSvc({ qqLyrics: SYNCED, neteaseLyrics: SYNCED_PLUS });
    const res = await svc.getLyricsAggregated(
      session, 'qq', 'q1', EXTRAS, '晴天', '周杰伦', { merge: false },
    );
    assert.deepStrictEqual(res.mergedFrom, ['qq']);
    assert.strictEqual(res.lines.length, 2, '快路径不做合并');
    assert.strictEqual(res.added, 0);
    assert.strictEqual(neteaseCalls, 0, '快路径命中后不打其余平台');
    console.log('✅ 7. merge=false 快路径：first-hit-wins，不打其余平台');
  }

  // ── 8. availability：命中即停 + 缓存生效 ────────────────────
  {
    const svc = makeSvc({ qqLyrics: SYNCED });
    const sources = [
      { platform: 'qq', trackId: 'q1' },
      { platform: 'netease', trackId: 'n1' },
    ];
    const a1 = await svc.getLyricsAvailability(session, sources);
    assert.strictEqual(a1.available, true);
    assert.strictEqual(a1.source, 'qq');
    assert.strictEqual(neteaseCalls, 0, 'qq 命中后不应再探 netease');
    const callsAfterFirst = qqCalls;
    const a2 = await svc.getLyricsAvailability(session, sources);
    assert.strictEqual(a2.available, true);
    assert.strictEqual(qqCalls, callsAfterFirst, '第二次应走缓存，不再打 provider');
    console.log('✅ 8. availability 命中即停 + 缓存生效');
  }

  // ── 9. availability：全 miss ────────────────────────────────
  {
    const svc = makeSvc({});
    const res = await svc.getLyricsAvailability(session, [
      { platform: 'qq', trackId: 'q1' },
      { platform: 'netease', trackId: 'n1' },
    ]);
    assert.strictEqual(res.available, false);
    assert.strictEqual(res.source, null);
    console.log('✅ 9. availability 全 miss → false');
  }

  console.log('\n全部通过 ✔');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
