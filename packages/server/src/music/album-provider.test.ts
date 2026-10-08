/**
 * 专辑 provider 层单测：QQ / 网易云 / Deezer 的 searchAlbums + getAlbumTracks。
 * mock globalThis.fetch，不打真实网络。
 *
 * 重点锁住 2026-09-30 Spike 实测暴露的三个坑（见 specs/album-search/spec.md 附录）：
 *   1. 网易云 `artist`(单数) 恒为空串，必须读 `artists[]`(复数)
 *   2. QQ 曲序要由 belongCD + cdIdx 组装
 *   3. Deezer 曲目没有 trackNumber，且限流用 200+{error} 表达
 *
 * 运行: npx ts-node packages/server/src/music/album-provider.test.ts
 */
export {};
const assert = require('node:assert');

const { QqMusicProvider } = require('./qq.provider');
const { NeteaseMusicProvider } = require('./netease.provider');
const { DeezerMusicProvider } = require('./deezer.provider');

const QQ_SESSION: any = { qqCookie: 'x=1', qqVip: false };
const NE_SESSION: any = { musicU: 'u', csrfToken: 'c' };
const DZ_SESSION: any = {};

/** mock fetch。raw 模式返回 {json} 形态（QQ/Deezer 用 res.json），
 *  text 模式返回 {text} 形态（网易云 apiCall 用 res.text + JSON.parse）。 */
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    if (out && typeof out === 'object' && ('text' in out || 'json' in out)) {
      return out as any;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(out),
      json: async () => out,
    } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

async function main() {
  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ══════════════════════════════════════════════════════════════
  // QQ — searchAlbums
  // ══════════════════════════════════════════════════════════════
  const qq = new QqMusicProvider();
  {
    let seen = '';
    const restore = mockFetch((url) => {
      seen = url;
      return {
        code: 0,
        data: {
          album: {
            list: [
              {
                albumID: 8220,
                albumMID: '000MkMni19ClKG',
                albumName: '叶惠美',
                albumPic: 'http://y.gtimg.cn/...R180...jpg',
                publicTime: '2003-07-31',
                singerName: '周杰伦',
                song_count: 11,
              },
              {
                albumMID: '',
                albumName: '缺 mid 的脏数据',
                singerName: '某人',
                song_count: 3,
              },
            ],
          },
        },
      };
    });
    const r = await qq.searchAlbums(QQ_SESSION, '叶惠美', 5);
    restore();

    assert.ok(seen.includes('t=8'), `必须打 t=8（专辑），实际: ${seen}`);
    ok('QQ searchAlbums 用 t=8');
    assert.strictEqual(r.length, 1, 'albumMID 缺失的条目应被丢弃');
    ok('QQ searchAlbums 丢弃 albumMID 缺失项');
    assert.strictEqual(r[0].albumId, '000MkMni19ClKG');
    assert.strictEqual(r[0].title, '叶惠美');
    assert.strictEqual(r[0].artist, '周杰伦');
    assert.strictEqual(r[0].trackCount, 11);
    assert.strictEqual(r[0].year, 2003, 'publicTime "2003-07-31" → 2003');
    assert.strictEqual(r[0].rank, 0, '第一项 rank 应为 0');
    assert.strictEqual(r[0].platform, 'qq');
    ok('QQ searchAlbums 字段映射正确');
  }
  {
    // publicTime 缺失/畸形 → year=0（未知），不能变 NaN
    const restore = mockFetch(() => ({
      code: 0,
      data: { album: { list: [{ albumMID: 'm1', albumName: 'x', publicTime: '未知' }] } },
    }));
    const r = await qq.searchAlbums(QQ_SESSION, 'x');
    restore();
    assert.strictEqual(r[0].year, 0, '畸形 publicTime 应回落到 0');
    assert.ok(Number.isFinite(r[0].year), 'year 不能是 NaN');
    assert.strictEqual(r[0].trackCount, 0, 'song_count 缺失 → 0（未知），不是空专辑');
    ok('QQ searchAlbums 畸形 publicTime / 缺失 song_count 兜底');
  }
  {
    const restore = mockFetch(() => ({ code: -1 }));
    let threw = '';
    try {
      await qq.searchAlbums(QQ_SESSION, 'x');
    } catch (e: any) {
      threw = e.message;
    }
    restore();
    assert.ok(threw.includes('code=-1'), `非 0 code 必须抛错，实际: ${threw}`);
    ok('QQ searchAlbums code!==0 抛错（不静默返回空）');
  }

  // ══════════════════════════════════════════════════════════════
  // QQ — getAlbumTracks
  // ══════════════════════════════════════════════════════════════
  {
    let seen = '';
    const restore = mockFetch((url) => {
      seen = url;
      return {
        code: 0,
        data: {
          cur_song_num: 3,
          list: [
            {
              songmid: '001n4C3p1yv0FU',
              strMediaMid: '002ExFMX2Jt6gv',
              songname: '以父之名',
              albumname: '叶惠美',
              albummid: '000MkMni19ClKG',
              singer: [{ id: 4558, mid: 'x', name: '周杰伦' }],
              interval: 342,
              belongCD: 1,
              cdIdx: 0,
              pay: { payplay: 1 },
            },
            {
              songmid: 'm2',
              songname: '第二首',
              belongCD: 1,
              cdIdx: 1,
            },
            {
              songmid: 'm3',
              songname: '第二碟第一首',
              belongCD: 2,
              cdIdx: 0,
            },
            { songmid: '', songname: '缺 mid 的脏数据' },
          ],
        },
      };
    });
    const r = await qq.getAlbumTracks(QQ_SESSION, '000MkMni19ClKG');
    restore();

    assert.ok(seen.includes('albummid=000MkMni19ClKG'), '必须带 albummid');
    assert.ok(seen.includes('fcg_v8_album_info_cp'), '应走 fcg_v8_album_info_cp（无需签名的端点）');
    ok('QQ getAlbumTracks 走 fcg_v8_album_info_cp + albummid');
    assert.strictEqual(r.length, 3, 'songmid 缺失项应丢弃');
    ok('QQ getAlbumTracks 丢弃 songmid 缺失项');
    assert.strictEqual(r[0].title, '以父之名');
    assert.strictEqual(r[0].artist, '周杰伦');
    assert.strictEqual(r[0].duration, 342);
    assert.strictEqual(r[0].mediaMid, '002ExFMX2Jt6gv', '高音质取流用 strMediaMid');
    ok('QQ getAlbumTracks 字段映射正确');

    // 曲序：cdIdx 0-based → trackNumber 1-based
    assert.strictEqual(r[0].trackNumber, 1, 'cdIdx=0 → trackNumber=1');
    assert.strictEqual(r[0].discNumber, 1);
    assert.strictEqual(r[1].trackNumber, 2);
    assert.strictEqual(r[2].discNumber, 2, 'belongCD=2 → discNumber=2');
    assert.strictEqual(r[2].trackNumber, 1, '换碟后曲序重新从 1 开始');
    ok('QQ getAlbumTracks 曲序由 belongCD + cdIdx 组装');

    // 付费判定复用现有 detectQqVipLocked：payplay=1 + 非绿钻 → vipLocked
    assert.strictEqual(r[0].vipLocked, true, 'payplay=1 且非绿钻 → vipLocked');
    ok('QQ getAlbumTracks 复用 detectQqVipLocked（payplay=1 非绿钻 → 锁）');
  }
  {
    // cdIdx 缺失 → trackNumber 必须是 undefined，不能填 0（否则排到第一首前面）
    const restore = mockFetch(() => ({
      code: 0,
      data: { list: [{ songmid: 'm1', songname: 'x', belongCD: 1 }] },
    }));
    const r = await qq.getAlbumTracks(QQ_SESSION, 'a');
    restore();
    assert.strictEqual(r[0].trackNumber, undefined, 'cdIdx 缺失 → trackNumber undefined');
    assert.ok(r[0].trackNumber !== 0, '绝不能填 0');
    ok('QQ getAlbumTracks cdIdx 缺失 → trackNumber=undefined（不填 0）');
  }

  // ══════════════════════════════════════════════════════════════
  // 网易云 — searchAlbums（重点：artists[] vs artist）
  // ══════════════════════════════════════════════════════════════
  const ne = new NeteaseMusicProvider();
  {
    let payload = '';
    const restore = mockFetch((url, opts) => {
      payload = String(opts?.body ?? '');
      return {
        code: 200,
        result: {
          albums: [
            {
              id: 372081313,
              name: '叶惠美',
              size: 18,
              picUrl: 'https://p1.music.126.net/xxx.jpg',
              publishTime: 1777219200000,
              // ⚠️ 实测：单数是空串，复数才有值
              artist: { name: '' },
              artists: [{ name: '王珏子乔' }],
            },
          ],
        },
      };
    });
    const r = await ne.searchAlbums(NE_SESSION, '叶惠美', 5);
    restore();

    assert.ok(payload.includes('type=10'), `必须打 type=10（专辑），实际: ${payload}`);
    ok('网易云 searchAlbums 用 type=10');
    assert.strictEqual(r[0].albumId, '372081313');
    assert.strictEqual(r[0].title, '叶惠美');
    assert.strictEqual(r[0].trackCount, 18);
    assert.strictEqual(
      r[0].artist,
      '王珏子乔',
      '必须取 artists[]（复数），不能取恒空的 artist（单数）',
    );
    assert.notStrictEqual(r[0].artist, '', 'artist 绝不能是空串');
    ok('网易云 searchAlbums 取 artists[] 而非恒空的 artist[]（核心防回归）');
    assert.ok(r[0].coverUrl.includes('param=300y300'), '封面应加 CDN 缩放参数');
    assert.strictEqual(r[0].year, new Date(1777219200000).getFullYear());
    ok('网易云 searchAlbums 封面缩放 + publishTime→year');
  }
  {
    // artists[] 也空 → 回落 artist.name，再空 → "未知艺人"，绝不能返回 ""
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        albums: [{ id: 1, name: 'x', artist: { name: '' }, artists: [] }],
      },
    }));
    const r = await ne.searchAlbums(NE_SESSION, 'x');
    restore();
    assert.strictEqual(r[0].artist, '未知艺人', '两处都空时兜底，不返回空串');
    ok('网易云 searchAlbums artist 全空时兜底为「未知艺人」');
  }
  {
    // 多艺人拼接
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        albums: [{ id: 1, name: '合辑', artists: [{ name: 'A' }, { name: 'B' }] }],
      },
    }));
    const r = await ne.searchAlbums(NE_SESSION, 'x');
    restore();
    assert.strictEqual(r[0].artist, 'A / B', '多艺人用 " / " 拼接（与单曲一致）');
    ok('网易云 searchAlbums 多艺人拼接');
  }
  {
    // 非 200 → 抛错（不伪装成"没结果"）。这是 unified-search:19 的坑。
    const restore = mockFetch(() => ({ code: 405, msg: '操作频繁' }));
    let threw = '';
    try {
      await ne.searchAlbums(NE_SESSION, 'x');
    } catch (e: any) {
      threw = e.message;
    }
    restore();
    assert.ok(threw.includes('405'), `非 200 code 必须抛错，实际: ${threw}`);
    assert.ok(threw.includes('操作频繁'), '错误信息应带上 msg');
    ok('网易云 searchAlbums code!==200 抛错并带 msg');
  }

  // ══════════════════════════════════════════════════════════════
  // Deezer — searchAlbums
  // ══════════════════════════════════════════════════════════════
  const dz = new DeezerMusicProvider();
  {
    let seen = '';
    const restore = mockFetch((url) => {
      seen = url;
      return {
        total: 1,
        data: [
          {
            id: 966922721,
            title: '叶惠美',
            cover_xl: 'https://cdn/1000x1000.jpg',
            nb_tracks: 19,
            release_date: '2003-07-28',
            record_type: 'album',
            artist: { id: 578008, name: 'Jue Wang' },
          },
        ],
      };
    });
    const r = await dz.searchAlbums(DZ_SESSION, '叶惠美', 5);
    restore();

    assert.ok(seen.includes('/search/album'), `应打 /search/album，实际: ${seen}`);
    assert.ok(seen.includes('limit=5'));
    ok('Deezer searchAlbums 走 /search/album');
    assert.strictEqual(r[0].albumId, '966922721');
    assert.strictEqual(r[0].title, '叶惠美');
    assert.strictEqual(r[0].artist, 'Jue Wang', '罗马音原样保留，桥接交给合并层');
    assert.strictEqual(r[0].trackCount, 19);
    assert.strictEqual(r[0].year, 2003);
    assert.strictEqual(r[0].coverUrl, 'https://cdn/1000x1000.jpg');
    ok('Deezer searchAlbums 字段映射正确');
  }
  {
    // 限流：Deezer 用 200 + {error:{...}} 表达 → 必须抛错，不能返回空数组
    const restore = mockFetch(() => ({
      error: { type: 'DataException', message: 'no data' },
    }));
    let threw = '';
    let r: any = null;
    try {
      r = await dz.searchAlbums(DZ_SESSION, 'x');
    } catch (e: any) {
      threw = e.message;
    }
    restore();
    assert.ok(threw.length > 0, '限流必须抛错，不能静默返回空数组');
    assert.strictEqual(r, null, '抛错时不应有返回值');
    ok('Deezer searchAlbums 限流(200+error) 抛错，不伪装成"没搜到"');
  }
  {
    const restore = mockFetch((url) => {
      assert.ok(Number(new URL(url).searchParams.get('limit')) <= 50, 'limit 必须 clamp 到 50');
      return { data: [] };
    });
    await dz.searchAlbums(DZ_SESSION, 'x', 999);
    restore();
    ok('Deezer searchAlbums limit clamp 到 50');
  }

  // ══════════════════════════════════════════════════════════════
  // Deezer — getAlbumTracks
  // ══════════════════════════════════════════════════════════════
  {
    let seen = '';
    const restore = mockFetch((url) => {
      seen = url;
      return {
        id: 966922721,
        title: '叶惠美',
        nb_tracks: 2,
        cover_xl: 'https://cdn/album-xl.jpg',
        tracks: {
          data: [
            {
              id: 3976396981,
              title: '爱情悬崖',
              duration: 229,
              preview: 'https://preview/1.mp3',
              artist: { id: 578008, name: 'Jue Wang' },
            },
            {
              id: 2,
              title: '第二首',
              duration: 200,
              preview: 'https://preview/2.mp3',
              artist: { id: 578008, name: 'Jue Wang' },
            },
          ],
        },
      };
    });
    const r = await dz.getAlbumTracks(DZ_SESSION, '966922721');
    restore();

    assert.ok(seen.includes('/album/966922721'), `应打 /album/{id}，实际: ${seen}`);
    ok('Deezer getAlbumTracks 走 /album/{id}');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].title, '爱情悬崖');
    assert.strictEqual(r[0].duration, 229);
    assert.strictEqual(r[0].provider, 'deezer');
    ok('Deezer getAlbumTracks 字段映射正确');
    // 关键：Deezer 无曲序，必须是 undefined
    assert.strictEqual(r[0].trackNumber, undefined, 'Deezer 无 trackNumber，必须 undefined');
    assert.strictEqual(r[1].trackNumber, undefined);
    assert.strictEqual(r[0].discNumber, undefined);
    ok('Deezer getAlbumTracks trackNumber/discNumber 恒 undefined（保序不重排）');
  }
  {
    // 实测（2026-09-30）：Deezer 查无此专辑时返 **HTTP 200** +
    // {error:{type:'DataException',message:'no data',code:800}}，不是 404。
    // 必须从 body 判别，否则会退化成 500。
    const restore = mockFetch(() => ({
      error: { type: 'DataException', message: 'no data', code: 800 },
    }));
    let status = 0;
    let msg = '';
    try {
      await dz.getAlbumTracks(DZ_SESSION, 'x');
    } catch (e: any) {
      status = e.getStatus?.() ?? 0;
      msg = e.message;
    }
    restore();
    assert.strictEqual(status, 404, '"no data" → 404，不是 500');
    assert.ok(msg.includes('not found'), `错误信息应为 not found，实际: ${msg}`);
    ok('Deezer getAlbumTracks "no data" → 404（HTTP 200 + body error）');
  }
  {
    // 限流也走 200+error，但 message 不是 no data → 上游故障 → 502
    const restore = mockFetch(() => ({
      error: { type: 'DataException', message: 'Service unavailable' },
    }));
    let status = 0;
    try {
      await dz.getAlbumTracks(DZ_SESSION, 'x');
    } catch (e: any) {
      status = e.getStatus?.() ?? 0;
    }
    restore();
    assert.strictEqual(status, 502, '非 "no data" 的 error → 502');
    ok('Deezer getAlbumTracks 限流 → 502（区别于 not found）');
  }
  {
    // 搜索侧同理：限流 → 502，service 层会 fail-soft 记进 errors
    const restore = mockFetch(() => ({
      error: { type: 'DataException', message: 'Service unavailable' },
    }));
    let status = 0;
    try {
      await dz.searchAlbums(DZ_SESSION, 'x');
    } catch (e: any) {
      status = e.getStatus?.() ?? 0;
    }
    restore();
    assert.strictEqual(status, 502, '搜索限流 → 502');
    ok('Deezer searchAlbums 限流 → 502');
  }

  console.log(`\n${pass} 个用例全部通过 ✅`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
