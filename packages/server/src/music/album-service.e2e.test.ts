/**
 * 专辑 service 层 e2e 测试（stub provider，不打真实网络）。
 *
 * 覆盖 spec: specs/album-search/tasks.md 2.3 / 2.4 / 2.6 / 2.7 / 3.x
 * 重点是 fail-soft 语义 —— 单平台失败绝不能让整个专辑搜索 500
 * （与 search-unified.e2e 同一个坑，不能重蹈覆辙）。
 *
 * 运行: npx ts-node packages/server/src/music/album-service.e2e.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');

const album = (
  platform: string,
  albumId: string,
  title: string,
  artist: string,
  trackCount: number,
  extra: Record<string, unknown> = {},
): any => ({
  platform,
  albumId,
  title,
  artist,
  coverUrl: '',
  trackCount,
  year: 0,
  rank: 0,
  ...extra,
});

const track = (
  provider: string,
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
): any => ({
  id,
  provider,
  title,
  artist: 'Artist',
  album: 'Album',
  coverUrl: '',
  audioUrl: '',
  duration: 200,
  liked: false,
  ...extra,
});

const fakeStorage = { get: () => undefined, set: () => {} };
const match = {};
const lyricsOvh = { getLyrics: async () => null };
const likeSync = {
  registerProcessor: () => {},
  registerDiscoverResolver: () => {},
  enqueue: () => {},
};

/** 组一个 MusicService。四个 provider 的专辑方法由调用方给。 */
function makeSvc(stubs: { qq?: any; netease?: any; deezer?: any; spotify?: any }) {
  const qq = { ...(stubs.qq ?? {}) };
  const netease = { ...(stubs.netease ?? {}) };
  const deezer = { ...(stubs.deezer ?? {}) };
  const spotify = { ...(stubs.spotify ?? {}) };
  const lyricsService = new LyricsService(
    qq as any,
    netease as any,
    deezer as any,
    lyricsOvh as any,
  );
  return new MusicService(
    fakeStorage,
    qq as any,
    netease as any,
    deezer as any,
    spotify as any,
    lyricsOvh as any,
    lyricsService as any,
    match as any,
    likeSync as any,
  );
}

const anonymous = { id: 's', createdAt: 0, providers: {} };
const loggedInNetease = {
  id: 's',
  createdAt: 0,
  providers: { netease: { musicU: 'u' } },
};

async function main() {
  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ══════════════════════════════════════════════════════════
  // 1. 基本合并：QQ + Deezer 同一张专辑
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      qq: { searchAlbums: async () => [album('qq', 'm1', '叶惠美', '周杰伦', 11)] },
      deezer: {
        searchAlbums: async () => [album('deezer', 'd1', '叶惠美', '周杰伦', 11)],
      },
    });
    const r = await svc.searchAlbumsUnified(anonymous, '叶惠美', 1, 20);
    assert.strictEqual(r.items.length, 1, '同一张专辑应合并成 1 张卡片');
    assert.strictEqual(r.items[0].sources.length, 2);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.page, 1);
    assert.strictEqual(r.pageSize, 20);
    assert.ok(!r.errors, '全成功时不应有 errors 字段');
    ok('1. QQ + Deezer 同专辑合并为 1 张卡片');
  }

  // ══════════════════════════════════════════════════════════
  // 2. Spotify 无 searchAlbums → 缺席，不是失败
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      qq: { searchAlbums: async () => [album('qq', 'm1', 'X', 'Y', 5)] },
      // spotify 故意不提供 searchAlbums
    });
    const r = await svc.searchAlbumsUnified(anonymous, 'X');
    assert.strictEqual(r.items.length, 1);
    assert.ok(!r.errors || !r.errors.spotify, '没实现专辑能力的平台算「缺席」，不该进 errors');
    ok('2. 未实现 searchAlbums 的平台算缺席，不进 errors');
  }

  // ══════════════════════════════════════════════════════════
  // 3. 单平台 throw → 仍 200 + 记 errors（fail-soft）
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      qq: {
        searchAlbums: async () => {
          throw new Error('qq boom');
        },
      },
      deezer: {
        searchAlbums: async () => [album('deezer', 'd1', 'X', 'Y', 5)],
      },
    });
    const r = await svc.searchAlbumsUnified(anonymous, 'X');
    assert.strictEqual(r.items.length, 1, 'Deezer 结果仍应返回');
    assert.ok(r.errors?.qq, 'QQ 失败应记进 errors');
    assert.ok(r.errors!.qq!.includes('qq boom'), 'errors 应带原始错误信息');
    ok('3. 单平台 throw → 200 + errors 记原因，其余平台正常');
  }

  // ══════════════════════════════════════════════════════════
  // 4. 4 平台全失败 → 200 + 空 items（不抛不 500）
  // ══════════════════════════════════════════════════════════
  {
    const boom = async () => {
      throw new Error('boom');
    };
    const svc = makeSvc({
      qq: { searchAlbums: boom },
      deezer: { searchAlbums: boom },
    });
    const r = await svc.searchAlbumsUnified(anonymous, 'X');
    assert.deepStrictEqual(r.items, [], '全失败应返回空 items 而不是抛错');
    assert.strictEqual(r.total, 0);
    assert.ok(r.errors?.qq && r.errors?.deezer, '两个平台的失败都应记录');
    ok('4. 全部平台失败 → 200 + 空 items + errors（不 500）');
  }

  // ══════════════════════════════════════════════════════════
  // 5. 参数校验
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({});
    for (const [q, why] of [
      ['', '空 q'],
      ['   ', '纯空格 q'],
      ['x'.repeat(101), '超过 100 字符'],
    ] as [string, string][]) {
      let threw = false;
      try {
        await svc.searchAlbumsUnified(anonymous, q);
      } catch {
        threw = true;
      }
      assert.ok(threw, `${why} 应抛 BadRequest`);
    }
    ok('5. 空 q / 纯空格 / >100 字符 → 抛 BadRequest');
  }

  // ══════════════════════════════════════════════════════════
  // 6. 分页 + 非法参数兜底
  // ══════════════════════════════════════════════════════════
  {
    const many = Array.from({ length: 25 }, (_, i) =>
      album('qq', `m${i}`, `专辑${i}`, '歌手', 5, { rank: i }),
    );
    const svc = makeSvc({ qq: { searchAlbums: async () => many } });

    const p1 = await svc.searchAlbumsUnified(anonymous, '专辑', 1, 10);
    assert.strictEqual(p1.items.length, 10);
    assert.strictEqual(p1.total, 25);
    const p3 = await svc.searchAlbumsUnified(anonymous, '专辑', 3, 10);
    assert.strictEqual(p3.items.length, 5, '最后一页应只剩 5 条');
    const p9 = await svc.searchAlbumsUnified(anonymous, '专辑', 9, 10);
    assert.strictEqual(p9.items.length, 0, '越界页应返回空而不是崩');

    // 非法参数兜底
    const bad = await svc.searchAlbumsUnified(anonymous, '专辑', NaN, NaN);
    assert.strictEqual(bad.page, 1, 'NaN page → 1');
    assert.strictEqual(bad.pageSize, 20, 'NaN pageSize → 默认 20');
    const over = await svc.searchAlbumsUnified(anonymous, '专辑', -5, 999);
    assert.strictEqual(over.page, 1, '负 page → 1');
    assert.strictEqual(over.pageSize, 50, 'pageSize clamp 到 50');
    ok('6. 分页正确 + NaN/负数/越界参数兜底');
  }

  // ══════════════════════════════════════════════════════════
  // 7. 排序在分页之前（弱相关不能被挤出第一页）
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      // QQ 返 20 条弱相关，QQ 第 1 条才是真命中
      qq: {
        searchAlbums: async () => [
          album('qq', 'hit', '叶惠美', '周杰伦', 11, { rank: 0 }),
          ...Array.from({ length: 20 }, (_, i) =>
            album('qq', `w${i}`, `无关专辑${i}`, '某人', 5, { rank: i + 1 }),
          ),
        ],
      },
    });
    const r = await svc.searchAlbumsUnified(anonymous, '叶惠美', 1, 5);
    assert.strictEqual(r.items[0].title, '叶惠美', '强相关项必须在第一页第一位（排序先于分页）');
    ok('7. 相关性排序在分页之前执行');
  }

  // ══════════════════════════════════════════════════════════
  // 8. 回归护栏：叶惠美三平台 → 3 张卡片（翻唱不被并）
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      qq: {
        searchAlbums: async () => [album('qq', '000MkMni19ClKG', '叶惠美', '周杰伦', 11)],
      },
      netease: {
        searchAlbums: async () => [album('netease', '372081313', '叶惠美', '王珏子乔', 18)],
      },
      deezer: {
        searchAlbums: async () => [album('deezer', '966922721', '叶惠美', 'Jue Wang', 19)],
      },
    });
    const r = await svc.searchAlbumsUnified(loggedInNetease, '叶惠美');
    assert.strictEqual(r.items.length, 3, '叶惠美应产出 3 张独立卡片（翻唱不能被并进原版）');
    ok('8. 回归护栏：叶惠美三平台 → 3 张独立卡片');
  }

  // ══════════════════════════════════════════════════════════
  // 9. 网易云未登录 → fail-soft，不是整体失败
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      netease: {
        searchAlbums: async () => {
          throw new Error('should_not_be_called');
        },
      },
      deezer: {
        searchAlbums: async () => [album('deezer', 'd1', 'X', 'Y', 5)],
      },
    });
    // session 未登录 netease → requireProviderSession 抛 → 应被 catch 成 error
    const r = await svc.searchAlbumsUnified(anonymous, 'X');
    assert.strictEqual(r.items.length, 1, 'Deezer 结果仍应返回');
    assert.ok(r.errors?.netease, 'netease 未登录应记进 errors');
    ok('9. 网易云未登录 → fail-soft 记 errors，不整体失败');
  }
  {
    // 登录后 netease 的 searchAlbums 应被正常调用
    let called = 0;
    const svc = makeSvc({
      netease: {
        searchAlbums: async () => {
          called++;
          return [album('netease', 'n1', 'X', 'Y', 5)];
        },
      },
    });
    const r = await svc.searchAlbumsUnified(loggedInNetease, 'X');
    assert.strictEqual(called, 1, '已登录时应调用 netease.searchAlbums');
    assert.strictEqual(r.items.length, 1);
    ok('9b. 网易云已登录 → 正常调用 searchAlbums');
  }

  // ══════════════════════════════════════════════════════════
  // 10. getAlbumTracks：不支持的平台 → 400
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({ qq: { getAlbumTracks: async () => [] } });
    // spotify 没实现 → 抛
    let msg = '';
    try {
      await svc.getAlbumTracksUnified(anonymous, 'spotify', 'x');
    } catch (e: any) {
      msg = e.message;
    }
    assert.ok(msg.includes('not supported'), `不支持的平台应抛明确错误，实际: ${msg}`);
    ok('10. 未实现 getAlbumTracks 的平台 → 抛「not supported」');
  }
  {
    const svc = makeSvc({}); // qq 也没有
    let threw = false;
    try {
      await svc.getAlbumTracksUnified(anonymous, 'netease', 'x');
    } catch {
      threw = true;
    }
    assert.ok(threw, '网易云 getAlbumTracks 未实现（B1 挂起）应抛错');
    ok('10b. 网易云专辑详情未实现 → 抛错（spec 阻塞项 B1）');
  }

  // ══════════════════════════════════════════════════════════
  // 11. 曲序：全部有 trackNumber 才排序
  // ══════════════════════════════════════════════════════════
  {
    const shuffled = [
      track('qq', 'm3', '第三首', { trackNumber: 3, discNumber: 1 }),
      track('qq', 'm1', '第一首', { trackNumber: 1, discNumber: 1 }),
      track('qq', 'm2', '第二首', { trackNumber: 2, discNumber: 1 }),
    ];
    const svc = makeSvc({ qq: { getAlbumTracks: async () => shuffled } });
    const r = await svc.getAlbumTracksForProvider(anonymous, 'qq', 'a');
    assert.deepStrictEqual(
      r.map((t: any) => t.title),
      ['第一首', '第二首', '第三首'],
      '全部有 trackNumber 时应按曲序升序',
    );
    ok('11. 全部有 trackNumber → 按曲序排序');
  }
  {
    // 缺 trackNumber（Deezer 场景）→ 保持平台返回序，不重排
    const original = [
      track('deezer', 'd1', 'B曲'),
      track('deezer', 'd2', 'A曲'),
      track('deezer', 'd3', 'C曲'),
    ];
    const svc = makeSvc({ deezer: { getAlbumTracks: async () => original } });
    const r = await svc.getAlbumTracksForProvider(anonymous, 'deezer', 'a');
    assert.deepStrictEqual(
      r.map((t: any) => t.title),
      ['B曲', 'A曲', 'C曲'],
      '无 trackNumber 时必须保持平台原始顺序（Deezer 编曲序）',
    );
    ok('11b. 缺 trackNumber → 保持平台返回序，不重排');
  }
  {
    // 多碟：先按碟号再按曲序
    const multi = [
      track('qq', 'a', '碟2-第1首', { trackNumber: 1, discNumber: 2 }),
      track('qq', 'b', '碟1-第2首', { trackNumber: 2, discNumber: 1 }),
      track('qq', 'c', '碟1-第1首', { trackNumber: 1, discNumber: 1 }),
    ];
    const svc = makeSvc({ qq: { getAlbumTracks: async () => multi } });
    const r = await svc.getAlbumTracksForProvider(anonymous, 'qq', 'a');
    assert.deepStrictEqual(
      r.map((t: any) => t.title),
      ['碟1-第1首', '碟1-第2首', '碟2-第1首'],
      '多碟应先按碟号再按曲序',
    );
    ok('11c. 多碟专辑按 (discNumber, trackNumber) 排序');
  }

  // ══════════════════════════════════════════════════════════
  // 12. getAlbumTracksUnified 返回已合并的 UnifiedSearchItem
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      qq: {
        getAlbumTracks: async () => [
          track('qq', 'm1', '以父之名', { duration: 342 }),
          track('qq', 'm2', '晴天', { duration: 269 }),
        ],
      },
    });
    const r = await svc.getAlbumTracksUnified(anonymous, 'qq', 'a');
    assert.ok(Array.isArray(r), '应返回数组');
    assert.strictEqual(r.length, 2);
    assert.ok(
      r[0].bestSource !== undefined && r[0].versions,
      '应是 UnifiedSearchItem（含 versions/bestSource），不是裸 Track',
    );
    ok('12. getAlbumTracksUnified 返回已合并的 UnifiedSearchItem');
  }

  // ══════════════════════════════════════════════════════════
  // 13. provider throw → 向上冒（controller 转 502）
  // ══════════════════════════════════════════════════════════
  {
    const svc = makeSvc({
      deezer: {
        getAlbumTracks: async () => {
          throw new Error('deezer down');
        },
      },
    });
    let msg = '';
    try {
      await svc.getAlbumTracksForProvider(anonymous, 'deezer', 'a');
    } catch (e: any) {
      msg = e.message;
    }
    assert.ok(msg.includes('deezer down'), `错误应向上冒，实际: ${msg}`);
    ok('13. 拉曲目失败向上冒（交 controller 转 502）');
  }

  console.log(`\n${pass} 个用例全部通过 ✅`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
