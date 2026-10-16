/**
 * 远端歌单能力单测（specs/remote-playlist Phase 1）。
 *
 * 覆盖：
 *   网易云 listPlaylists / fetchPlaylistTracks 的字段映射、保序、错误路径
 *   MusicService 的能力探测（不支持平台 → supported:false，不 500）
 *   严格 provider 校验（未知 provider → 400，不静默兜底成 qq）
 *
 * ⚠️ 全程 mock globalThis.fetch，不打真实网络 —— 网易云匿名请求会被反爬截断
 * （specs/remote-playlist/spec.md 实测：trackCount=158 只回 6 首），真打网络
 * 这个测试必然假红。
 *
 * 运行: npx ts-node packages/server/src/music/playlist.provider.test.ts
 */
export {};
const assert = require('node:assert');

const { NeteaseMusicProvider } = require('./netease.provider');

const { QqMusicProvider } = require('./qq.provider');
const { DeezerMusicProvider } = require('./deezer.provider');

const prov = new NeteaseMusicProvider();
const qqProv = new QqMusicProvider();
const dzProv = new DeezerMusicProvider();

const SESSION: any = { musicU: 'test-music-u', csrfToken: 'test-csrf' };

/**
 * Mock globalThis.fetch。
 *
 * 必须**同时**提供 `text()` 和 `json()`：netease 的 apiCall 走 `res.text()`
 * 再 JSON.parse（见其注释），而 qq.provider 的 CgiGetDiss 走 `res.json()`。
 * 只给一个会让另一个 provider 的测试炸在「r.json is not a function」。
 */
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    if (out && typeof out === 'object' && ('text' in out || 'json' in out)) return out as any;
    const body = JSON.stringify(out);
    return {
      ok: true,
      status: 200,
      text: async () => body,
      json: async () => JSON.parse(body),
    } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

const ACCOUNT_GET = 'https://music.163.com/api/nuser/account/get';
const USER_PLAYLIST = 'https://music.163.com/api/user/playlist';
const PLAYLIST_DETAIL = 'https://music.163.com/api/v6/playlist/detail';

/** 抓 apiCall 的 POST payload 里的字段（mock 用）。 */
function bodyOf(opts: any): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(opts?.body ?? '')).entries());
}

/**
 * 构造一个只够跑 listRemotePlaylists / getRemotePlaylist 的 MusicService。
 * 真实构造器会调 likeSync.registerProcessor / registerDiscoverResolver，所以
 * 那两个方法必须是桩。sessionService / health 走默认参数。
 */
function makeSvc() {
  const { MusicService } = require('./music.service');
  const likeSync: any = {
    registerProcessor() {},
    registerDiscoverResolver() {},
    purgeForProvider() {},
  };
  const match: any = { mergeLibrary: () => [] };
  const lyricsService: any = {};
  return new MusicService(
    {} as any, // storage
    {} as any, // qq（无歌单能力）
    prov, // netease（有歌单能力）
    {} as any, // deezer（无歌单能力）
    {} as any, // spotify（无歌单能力）
    {} as any, // lyricsOvh
    lyricsService as any,
    match,
    likeSync,
  );
}

/** QQ 版 service（provider 顺序：storage / qq / netease / deezer / spotify …）。 */
function makeQqSvc() {
  const { MusicService } = require('./music.service');
  const likeSync: any = {
    registerProcessor() {},
    registerDiscoverResolver() {},
    purgeForProvider() {},
  };
  return new MusicService(
    {} as any, // storage
    qqProv, // qq（有「读歌单」能力，无「列目录」能力）
    prov, // netease
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { mergeLibrary: () => [] } as any,
    likeSync,
  );
}

async function main() {
  // ── 1. listPlaylists: 未登录 → not_logged_in ──────────────────────
  {
    let err: any = null;
    try {
      await prov.listPlaylists({} as any);
    } catch (e) {
      err = e;
    }
    assert.strictEqual(err?.getStatus?.(), 400, '未登录应为 400');
    assert.strictEqual(err?.response?.message, 'not_logged_in');
    console.log('✅ 1. listPlaylists: 未登录 → 400 not_logged_in（不 500）');
  }

  // ── 2. listPlaylists: 字段映射 + 私有标记 ─────────────────────────
  {
    const seen: Record<string, string>[] = [];
    const restore = mockFetch((url, opts) => {
      if (url === ACCOUNT_GET) return { account: { id: 42 } };
      if (url === USER_PLAYLIST) {
        seen.push(bodyOf(opts));
        return {
          more: false,
          playlist: [
            {
              id: 1,
              name: '我喜欢的音乐',
              coverImgUrl: 'http://c/1.jpg',
              trackCount: 987,
              privacy: 0,
              specialType: 5,
            },
            { id: 2, name: '通勤', coverImgUrl: 'http://c/2.jpg', trackCount: 30, privacy: 10 },
            { id: 3, name: '缺字段歌单' },
          ],
        };
      }
      throw new Error('unexpected url ' + url);
    });
    const items = await prov.listPlaylists(SESSION, 200);
    restore();

    assert.strictEqual(seen.length, 1, 'user/playlist 只应被调一次');
    assert.strictEqual(seen[0].uid, '42', 'uid 必须来自 /nuser/account/get');
    assert.strictEqual(seen[0].limit, '200', 'limit 应透传');

    assert.strictEqual(items.length, 3, '缺字段的条目也要返回，交给 UI 兜底');
    assert.deepStrictEqual(items[0], {
      provider: 'netease',
      id: '1',
      name: '我喜欢的音乐',
      coverUrl: 'http://c/1.jpg',
      trackCount: 987,
      private: false,
    });
    assert.strictEqual(items[1].private, true, 'privacy=10 → private:true');
    assert.strictEqual(items[2].trackCount, 0, '缺 trackCount → 0 而非 NaN');
    assert.strictEqual(items[2].coverUrl, '');
    console.log('✅ 2. listPlaylists: 字段映射 + privacy=10 → private');
  }

  // ── 3. listPlaylists: 无 uid → not_logged_in ───────────────────────
  {
    const restore = mockFetch((url) => {
      if (url === ACCOUNT_GET) return { account: null };
      throw new Error('unexpected url ' + url);
    });
    let err: any = null;
    try {
      await prov.listPlaylists(SESSION);
    } catch (e) {
      err = e;
    }
    restore();
    assert.strictEqual(err?.getStatus?.(), 400);
    assert.strictEqual(err?.response?.message, 'not_logged_in');
    console.log('✅ 3. listPlaylists: /nuser/account/get 无 uid → not_logged_in');
  }

  // ── 4. fetchPlaylistTracks: 字段映射 + 保序 ───────────────────────
  {
    let sent: Record<string, string> = {};
    // 故意乱序返回（Z → A → B），断言 service 层没有重排
    const restore = mockFetch((url, opts) => {
      if (url === PLAYLIST_DETAIL) {
        sent = bodyOf(opts);
        return {
          code: 200,
          playlist: {
            id: 777,
            name: '夜跑',
            coverImgUrl: 'http://c/777.jpg',
            trackCount: 3,
            privacy: 0,
            tracks: [
              {
                id: 900,
                name: 'Zebra',
                ar: [{ name: 'Z' }],
                al: { name: 'AlbZ', picUrl: 'http://a/z.jpg' },
                dt: 200000,
              },
              {
                id: 901,
                name: 'Apple',
                ar: [{ name: 'A' }],
                al: { name: 'AlbA', picUrl: 'http://a/a.jpg' },
                dt: 180000,
              },
              {
                id: 902,
                name: 'Banana',
                ar: [{ name: 'B1' }, { name: 'B2' }],
                al: { name: 'AlbB', picUrl: 'http://a/b.jpg' },
                dt: 240000,
                fee: 1,
              },
            ],
          },
        };
      }
      throw new Error('unexpected url ' + url);
    });
    const pl = await prov.fetchPlaylistTracks(SESSION, '777', 1000);
    restore();

    assert.strictEqual(sent.id, '777', 'playlistId 应透传给 id');
    assert.strictEqual(sent.n, '1000', 'n 应等于 maxTracks');

    assert.strictEqual(pl.provider, 'netease');
    assert.strictEqual(pl.id, '777');
    assert.strictEqual(pl.name, '夜跑');
    assert.strictEqual(pl.trackCount, 3);
    assert.strictEqual(pl.private, false);

    // ★ 保序：顺序必须 === 平台返回顺序，不被任何排序/去重打乱
    assert.deepStrictEqual(
      pl.tracks.map((t: any) => t.id),
      ['900', '901', '902'],
      '顺序必须保序',
    );
    assert.deepStrictEqual(
      pl.tracks.map((t: any) => t.title),
      ['Zebra', 'Apple', 'Banana'],
    );

    const banana = pl.tracks[2];
    assert.strictEqual(banana.artist, 'B1 / B2', '多艺人用 / 连接');
    assert.strictEqual(banana.duration, 240, 'dt(ms) → duration(s)');
    assert.strictEqual(banana.album, 'AlbB');
    assert.strictEqual(banana.coverUrl, 'http://a/b.jpg');
    assert.strictEqual(banana.audioUrl, '', 'audioUrl 留空，由 getStreamPath 播放时填');
    assert.strictEqual(banana.liked, false, '远端歌单 ≠ ❤ 列表');
    assert.strictEqual(banana.vipCategory, 'paid-album', 'fee=1 → 数字专辑');
    assert.strictEqual(banana.vipLocked, true, 'fee>0 → 锁');
    console.log('✅ 4. fetchPlaylistTracks: 字段映射 + 保序 + privilege 解析');
  }

  // ── 5. fetchPlaylistTracks: 歌单不存在 → 404 ──────────────────────
  {
    const restore = mockFetch((url) => {
      if (url === PLAYLIST_DETAIL) return { code: 404, message: '歌单不存在', playlist: null };
      throw new Error('unexpected url ' + url);
    });
    let err: any = null;
    try {
      await prov.fetchPlaylistTracks(SESSION, '999999');
    } catch (e) {
      err = e;
    }
    restore();
    assert.strictEqual(err?.getStatus?.(), 404, '歌单不存在应为 404');
    // NotFoundException(对象) 的 response 就是那个对象本身，没有 message 包装层
    assert.strictEqual(err?.response?.error, 'playlist_not_found');
    assert.strictEqual(err?.response?.playlistId, '999999');
    console.log('✅ 5. fetchPlaylistTracks: code=404 → 404 playlist_not_found');
  }

  // ── 6. fetchPlaylistTracks: 未登录 → not_logged_in ────────────────
  {
    let err: any = null;
    try {
      await prov.fetchPlaylistTracks({} as any, '777');
    } catch (e) {
      err = e;
    }
    assert.strictEqual(err?.getStatus?.(), 400);
    assert.strictEqual(err?.response?.message, 'not_logged_in');
    console.log('✅ 6. fetchPlaylistTracks: 未登录 → 400 not_logged_in');
  }

  // ── 7. fetchPlaylistTracks: maxTracks clamp（不向平台要超量数据）──
  {
    let sent: Record<string, string> = {};
    const restore = mockFetch((url, opts) => {
      if (url === PLAYLIST_DETAIL) {
        sent = bodyOf(opts);
        return { code: 200, playlist: { id: 1, trackCount: 9999, tracks: [] } };
      }
      throw new Error('unexpected url ' + url);
    });
    const pl = await prov.fetchPlaylistTracks(SESSION, '1', 5000);
    restore();
    assert.strictEqual(sent.n, '1000', 'n 必须 clamp 到网易云歌单上限 1000');
    assert.strictEqual(pl.trackCount, 9999, 'trackCount 记平台口径，不记实际返回');
    console.log('✅ 7. fetchPlaylistTracks: n clamp 到 1000，trackCount 仍记平台口径');
  }

  // ── 8. MusicService 能力探测：deezer 无歌单能力 → supported:false ──
  {
    const svc = makeSvc();
    const res = await svc.listRemotePlaylists({ id: 's1', providers: {} } as any, 'deezer');
    assert.strictEqual(res.supported, false, 'deezer 未实现歌单能力 → supported:false');
    assert.deepStrictEqual(res.items, []);
    console.log('✅ 8. 能力探测: deezer → supported:false（不 500）');
  }

  // ── 9. MusicService 能力探测：不支持的平台调 tracks → 400 playlist_unsupported ──
  {
    const svc = makeSvc();
    let err: any = null;
    try {
      await svc.getRemotePlaylist({ id: 's1', providers: {} } as any, 'deezer', '123');
    } catch (e) {
      err = e;
    }
    assert.strictEqual(err?.getStatus?.(), 400);
    assert.strictEqual(err?.response?.error, 'playlist_unsupported');
    assert.strictEqual(err?.response?.provider, 'deezer');
    console.log('✅ 9. 不支持平台取歌单详情 → 400 playlist_unsupported');
  }

  // ── 10. MusicService: netease 有能力 → 透传 provider session ───────
  {
    let gotSession: any = null;
    const svc = makeSvc();
    // 桩掉 provider 方法，验证 service 层传对了 session + limit
    (prov as any).listPlaylists = async (s: any, limit: number) => {
      gotSession = { s, limit };
      return [];
    };
    const restore = mockFetch(() => ({ account: { id: 9 } }));
    const res = await svc.listRemotePlaylists(
      { id: 's1', providers: { netease: { musicU: 'U1' } } } as any,
      'netease',
      50,
    );
    restore();
    assert.strictEqual(res.supported, true);
    assert.strictEqual(res.provider, 'netease');
    assert.strictEqual(gotSession.s.musicU, 'U1', '必须传该平台的 provider session');
    assert.strictEqual(gotSession.limit, 50, 'limit 应透传');
    console.log('✅ 10. netease 有能力：透传 provider session + limit');
  }

  // ═══════════════════════════════════════════════════════════════
  // QQ（Phase 2）—— 实测结论：只能读指定歌单，不能列目录
  // ═══════════════════════════════════════════════════════════════

  const QQ_SESSION: any = { qqCookie: 'qm_keyst=x; euin=EU1', qqUin: '81295659', qqVip: true };

  /** 造一个 CgiGetDiss 响应。 */
  function dissResp(songlist: any[], hasmore: boolean, dirinfo: any = {}, code = 0) {
    return { code, req_0: { code, data: { songlist, hasmore, dirinfo } } };
  }
  const song = (mid: string, name: string, extra: any = {}) => ({
    mid,
    name,
    title: name,
    singer: [{ name: 'S', mid: 'sm' }],
    album: { name: 'Alb', mid: 'AMID' },
    interval: 200,
    file: { media_mid: 'MMID' },
    ...extra,
  });

  // ── 11. QQ: 真正非数字的 id → 400 invalid_playlist_id（不发请求）────
  //
  // 注意区分两种「字符串」：
  //  - '8584177317'（**纯数字**字符串）→ 必须**接受**，因为用户从
  //    y.qq.com/n/ryqq/playlist/8584177317 复制来的 URL 片段就是这种形态，
  //    前端不该要求他先手动 parseInt（见用例 12）
  //  - 'ryqq/playlist' / 'abc' / '' → 发请求前就拒，否则上游回一个含糊的 10004
  {
    for (const bad of ['ryqq/playlist', 'abc', '', '0', '-1', '1.5']) {
      let called = 0;
      const restore = mockFetch(() => {
        called++;
        return dissResp([], false);
      });
      let err: any = null;
      try {
        await qqProv.fetchPlaylistTracks(QQ_SESSION, bad);
      } catch (e) {
        err = e;
      }
      restore();
      assert.strictEqual(called, 0, `id=${JSON.stringify(bad)} 必须在发请求前就拒掉`);
      assert.strictEqual(err?.getStatus?.(), 400, `id=${JSON.stringify(bad)} → 400`);
      assert.strictEqual(err?.response?.error, 'invalid_playlist_id');
    }
    console.log('✅ 11. QQ: 真正非数字 id → 400 invalid_playlist_id（请求前拦截，6 个用例）');
  }

  // ── 12. QQ: ★ disstid 必须是 number —— 上游对字符串回 10004 ──────
  {
    const bodies: any[] = [];
    const restore = mockFetch((_url, opts) => {
      bodies.push(JSON.parse(String(opts?.body)));
      return dissResp([song('m1', 'A')], false, {
        title: '歌单X',
        songnum: 1,
        picurl: 'http://p/x.jpg',
      });
    });
    const pl = await qqProv.fetchPlaylistTracks(QQ_SESSION, '8584177317'); // 字符串输入
    restore();

    // 输入是字符串，但**发出去的必须是数字**——这是本 spec 最隐蔽的坑
    const sent = bodies[0].req_0.param.disstid;
    assert.strictEqual(typeof sent, 'number', `disstid 必须是 number，实际 ${typeof sent}`);
    assert.strictEqual(sent, 8584177317);
    assert.strictEqual(pl.id, '8584177317');
    assert.strictEqual(pl.provider, 'qq');
    assert.strictEqual(pl.name, '歌单X');
    assert.strictEqual(pl.coverUrl, 'http://p/x.jpg', 'meta 封面走 dirinfo.picurl');
    assert.strictEqual(pl.trackCount, 1);
    console.log('✅ 12. QQ: 输入字符串 → 实际发 number（上游对字符串回 10004）');
  }

  // ── 13. QQ: 分页 —— song_begin 按请求页大小推进 + hasmore 判末页 ──
  {
    const seen: Array<{ begin: number; num: number; returned: number }> = [];
    const restore = mockFetch((_url, opts) => {
      const p = JSON.parse(String(opts?.body)).req_0.param;
      // 第一页请求 num 首、只回 2 首（QQ 过滤失效歌曲），hasmore 仍 true
      const body =
        p.song_begin === 0
          ? dissResp([song('a', 'A'), song('b', 'B')], true, { songnum: 3 })
          : dissResp([song('c', 'C')], false, { songnum: 3 });
      seen.push({
        begin: p.song_begin,
        num: p.song_num,
        returned: body.req_0.data.songlist.length,
      });
      return body;
    });
    const pl = await qqProv.fetchPlaylistTracks(QQ_SESSION, '777');
    restore();
    assert.strictEqual(seen.length, 2, 'hasmore=true 时必须再翻一页');
    // ★ 关键口径：song_begin 按**请求页大小**推进，不按实际返回数。
    //   第一页 num=100 只回 2 首（失效歌曲被过滤），若按 2 推进会漏掉 3..99。
    assert.strictEqual(seen[0].returned, 2, '第一页只回 2 首（模拟失效歌曲过滤）');
    assert.strictEqual(seen[1].begin, seen[0].num, 'song_begin 必须按请求页大小推进');
    assert.deepStrictEqual(
      pl.tracks.map((t: any) => t.id),
      ['a', 'b', 'c'],
      '保序且不丢歌',
    );
    assert.strictEqual(pl.trackCount, 3, 'trackCount 取平台 songnum，不取 tracks.length');
    console.log('✅ 13. QQ: 分页 song_begin 按页大小推进 + hasmore 判末页 + 保序');
  }

  // ── 14. QQ: 短页不代表末页（QQ 过滤失效歌曲）────────────────────
  {
    // 第一页请求 2 首只回 1 首，但 hasmore=true → 必须继续翻
    const restore = mockFetch((_url, opts) => {
      const p = JSON.parse(String(opts?.body)).req_0.param;
      if (p.song_begin === 0) return dissResp([song('a', 'A')], true, { songnum: 2 });
      return dissResp([song('b', 'B')], false, { songnum: 2 });
    });
    const pl = await qqProv.fetchPlaylistTracks(QQ_SESSION, '777');
    restore();
    assert.deepStrictEqual(
      pl.tracks.map((t: any) => t.id),
      ['a', 'b'],
      '短页 + hasmore 仍要继续',
    );
    console.log('✅ 14. QQ: 短页 + hasmore=true 仍继续翻（失效歌曲过滤不误判末页）');
  }

  // ── 15. QQ: 单曲字段映射（mediaMid / pay / 封面）───────────────
  {
    const restore = mockFetch(() =>
      dissResp(
        [song('MID1', '付费歌', { pay: { pay_play: 1, price_track: 200, pay_month: 1 } })],
        false,
        { title: 'T', songnum: 1 },
      ),
    );
    const pl = await qqProv.fetchPlaylistTracks(QQ_SESSION, '777');
    restore();
    const t = pl.tracks[0];
    assert.strictEqual(t.provider, 'qq');
    assert.strictEqual(t.mediaMid, 'MMID', 'file.media_mid → Track.mediaMid（高音质取流要它）');
    assert.strictEqual(t.coverUrl, 'https://y.gtimg.cn/music/photo_new/T002R800x800M000AMID.jpg');
    assert.strictEqual(t.duration, 200);
    assert.strictEqual(t.liked, false, '远端歌单 ≠ ❤ 列表');
    assert.strictEqual(t.vipCategory, 'paid-track', 'price_track=200 → paid-track');
    assert.strictEqual(t.vipLocked, false, 'qqVip=true → 不锁');
    console.log('✅ 15. QQ: mediaMid / 封面 / pay → vipCategory 映射');
  }

  // ── 16. QQ: 错误码映射 ─────────────────────────────────────────
  {
    // 注意两种 NestJS 异常的 response 形状不同：
    //  - NotFoundException({error:'playlist_not_found'}) → response.error 承载语义
    //  - BadRequestException('not_logged_in')            → response.message 承载语义
    //    （后者 response.error 是 Nest 默认的 'Bad Request'）
    for (const [code, status, field, want] of [
      [10004, 404, 'error', 'playlist_not_found'],
      [1000, 400, 'message', 'not_logged_in'],
      [301, 400, 'message', 'not_logged_in'],
    ] as const) {
      const restore = mockFetch(() => dissResp([], false, {}, code));
      let err: any = null;
      try {
        await qqProv.fetchPlaylistTracks(QQ_SESSION, '777');
      } catch (e) {
        err = e;
      }
      restore();
      assert.strictEqual(err?.getStatus?.(), status, `code=${code} → ${status}`);
      assert.strictEqual(err?.response?.[field], want, `code=${code} → ${field}=${want}`);
    }
    console.log('✅ 16. QQ: 10004→404 / 1000·301→not_logged_in');
  }

  // ── 17. QQ: 未登录 → not_logged_in ─────────────────────────────
  {
    let err: any = null;
    try {
      await qqProv.fetchPlaylistTracks({} as any, '777');
    } catch (e) {
      err = e;
    }
    assert.strictEqual(err?.response?.message, 'not_logged_in');
    console.log('✅ 17. QQ: 未登录 → not_logged_in');
  }

  // ── 18. QQ 无 listPlaylists → 列目录 supported:false，但读歌单可用 ──
  {
    const svc = makeQqSvc();
    assert.strictEqual(
      qqProv.listPlaylists,
      undefined,
      'QQ 不应实现 listPlaylists（实测接口已下线）',
    );

    const listed = await svc.listRemotePlaylists(
      { id: 's1', providers: { qq: QQ_SESSION } } as any,
      'qq',
    );
    assert.strictEqual(listed.supported, false, 'QQ 列目录 → supported:false');
    assert.deepStrictEqual(listed.items, []);

    // 但读歌单必须能用（契约允许「只实现一半」）
    const restore = mockFetch(() => dissResp([song('m', 'X')], false, { songnum: 1, title: 'PL' }));
    const pl = await svc.getRemotePlaylist(
      { id: 's1', providers: { qq: QQ_SESSION } } as any,
      'qq',
      '777',
    );
    restore();
    assert.strictEqual(pl.name, 'PL', 'QQ 读歌单必须可用（只实现一半能力）');
    assert.strictEqual(pl.tracks.length, 1);
    console.log('✅ 18. QQ「只实现一半」：列目录 false，读歌单正常');
  }

  // ── 19. QQ: maxTracks 硬上限 ────────────────────────────────────
  {
    const restore = mockFetch(() =>
      dissResp([song('a', 'A'), song('b', 'B'), song('c', 'C')], false, { songnum: 99 }),
    );
    const pl = await qqProv.fetchPlaylistTracks(QQ_SESSION, '777', 2);
    restore();
    assert.strictEqual(pl.tracks.length, 2, 'maxTracks 截断生效');
    assert.strictEqual(pl.trackCount, 99, 'trackCount 仍记平台口径');
    console.log('✅ 19. QQ: maxTracks 截断生效');
  }

  // ═══════════════════════════════════════════════════════════════
  // Deezer（Phase 4）—— 公开歌单，匿名可用，不需要 OAuth
  // ═══════════════════════════════════════════════════════════════

  const dzSong = (id: number, title: string) => ({
    id,
    title,
    title_short: title,
    duration: 210,
    preview: `https://cdn.deezer.com/p/${id}.mp3`,
    artist: { id: 1, name: 'Artist' },
    album: { id: 9, title: 'Alb', cover_xl: `http://c/a/${id}.jpg` },
  });
  const dzMeta = (over: any = {}) => ({
    id: 6399367984,
    title: 'Lofi Girl',
    nb_tracks: 3,
    public: true,
    collaborative: false,
    picture_xl: 'http://c/pl/xl.jpg',
    ...over,
  });

  // ── 20. Deezer: 非数字 id → 400 invalid_playlist_id（请求前拦截）────
  {
    let called = 0;
    const restore = mockFetch(() => {
      called++;
      return dzMeta();
    });
    let err: any = null;
    try {
      await dzProv.fetchPlaylistTracks({} as any, 'deezer.com/playlist/123');
    } catch (e) {
      err = e;
    }
    restore();
    assert.strictEqual(called, 0, '非数字 id 必须在发请求前拒掉');
    assert.strictEqual(err?.getStatus?.(), 400);
    assert.strictEqual(err?.response?.error, 'invalid_playlist_id');
    console.log('✅ 20. Deezer: 非数字 id → 400 invalid_playlist_id（请求前拦截）');
  }

  // ── 21. Deezer: 歌单不存在 → 404（⚠️ HTTP 200 + error.code=800）───
  {
    // Deezer 对不存在的歌单回 **200**，body 是 {error:{code:800}}。
    // 只看 HTTP status 会把「不存在」误判成「成功但空歌单」。
    const restore = mockFetch(() => ({
      error: { type: 'DataException', message: 'no data', code: 800 },
    }));
    let err: any = null;
    try {
      await dzProv.fetchPlaylistTracks({} as any, '1');
    } catch (e) {
      err = e;
    }
    restore();
    assert.strictEqual(err?.getStatus?.(), 404, 'HTTP 200 + error.code=800 必须转成 404');
    assert.strictEqual(err?.response?.error, 'playlist_not_found');
    console.log('✅ 21. Deezer: HTTP 200 + error.code=800 → 404 playlist_not_found');
  }

  // ── 22. Deezer: 翻页 follow next 游标（不自己算 index）+ 保序 ────────
  {
    const urls: string[] = [];
    const restore = mockFetch((url) => {
      urls.push(String(url));
      if (String(url).includes('/tracks')) {
        if (String(url).includes('index=0')) {
          return {
            data: [dzSong(1, 'A'), dzSong(2, 'B')],
            total: 3,
            // 游标是完整 URL，原样 follow —— 不能自己拼 index
            next: 'https://api.deezer.com/playlist/6399367984/tracks?limit=300&index=2',
          };
        }
        return { data: [dzSong(3, 'C')], total: 3, next: null };
      }
      return dzMeta();
    });
    const pl = await dzProv.fetchPlaylistTracks({} as any, '6399367984');
    restore();
    assert.strictEqual(urls.length, 3, '1 次 meta + 2 页 tracks');
    assert.ok(String(urls[2]).includes('index=2'), '第 2 页必须用 next 游标的 URL，不自算 index');
    assert.deepStrictEqual(
      pl.tracks.map((t: any) => t.id),
      ['1', '2', '3'],
      '保序',
    );
    console.log('✅ 22. Deezer: follow next 游标翻页 + 保序');
  }

  // ── 23. Deezer: 字段映射（封面 / private / preview 播放地址）──────
  {
    const restore = mockFetch((url) =>
      String(url).includes('/tracks')
        ? { data: [dzSong(7, 'Song')], total: 1, next: null }
        : dzMeta({ nb_tracks: 1, picture_xl: undefined, picture_big: 'http://c/big.jpg' }),
    );
    const pl = await dzProv.fetchPlaylistTracks({} as any, '6399367984');
    restore();
    assert.strictEqual(pl.provider, 'deezer');
    assert.strictEqual(pl.coverUrl, 'http://c/big.jpg', 'picture_xl 缺失时降级到 picture_big');
    assert.strictEqual(pl.trackCount, 1);
    assert.strictEqual(pl.private, false, 'public=true → private:false');
    const t = pl.tracks[0];
    assert.strictEqual(t.provider, 'deezer');
    assert.strictEqual(
      t.audioUrl,
      'https://cdn.deezer.com/p/7.mp3',
      'audioUrl 走 preview（30s mp3）',
    );
    assert.strictEqual(t.coverUrl, 'http://c/a/7.jpg');
    assert.strictEqual(t.duration, 210);
    console.log('✅ 23. Deezer: 封面降级 / public→private / preview→audioUrl');
  }

  // ── 24. Deezer: public=false → private:true ───────────────────────
  {
    const restore = mockFetch((url) =>
      String(url).includes('/tracks')
        ? { data: [], total: 0, next: null }
        : dzMeta({ public: false }),
    );
    const pl = await dzProv.fetchPlaylistTracks({} as any, '6399367984');
    restore();
    assert.strictEqual(pl.private, true, 'public=false → private:true');
    console.log('✅ 24. Deezer: public=false → private:true');
  }

  // ── 25. Deezer: maxTracks 截断（歌单上限 5000，默认 2000）──────────
  {
    const many = Array.from({ length: 300 }, (_, i) => dzSong(1000 + i, `S${i}`));
    const restore = mockFetch((url) =>
      String(url).includes('/tracks')
        ? { data: many, total: 300, next: null }
        : dzMeta({ nb_tracks: 300 }),
    );
    const pl = await dzProv.fetchPlaylistTracks({} as any, '6399367984', 50);
    restore();
    assert.strictEqual(pl.tracks.length, 50, 'maxTracks 截断生效');
    assert.strictEqual(pl.trackCount, 300, 'trackCount 仍记平台 nb_tracks');
    console.log('✅ 25. Deezer: maxTracks 截断生效（默认上限 2000，Deezer 歌单最大 5000）');
  }

  // ── 26. Deezer: HTTP 5xx → BadGateway；不实现 listPlaylists ────────
  {
    // 必须带 text/json 之一，否则 mockFetch 会把这个对象当成「要序列化的
    // body」重新包成 `{ok:true,status:200,...}`，就模拟不出失败响应了。
    const restore = mockFetch(() => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
      json: async () => ({}),
    }));
    let err: any = null;
    try {
      await dzProv.fetchPlaylistTracks({} as any, '6399367984');
    } catch (e) {
      err = e;
    }
    restore();
    assert.strictEqual(err?.getStatus?.(), 502, '上游 5xx → 502 BadGateway');

    assert.strictEqual(
      dzProv.listPlaylists,
      undefined,
      'Deezer 匿名无「我的歌单」（/user/{id}/playlists 实测 error.code=800），不该实现 listPlaylists',
    );
    console.log('✅ 26. Deezer: 5xx→502；确认未实现 listPlaylists');
  }

  // ═══════════════════════════════════════════════════════════════
  // Track[] → UnifiedSearchItem[] 转换器（Phase 5）
  // 核心诉求：**1:1 保序、不折叠**
  // ═══════════════════════════════════════════════════════════════

  const { playlistTracksToUnifiedItems } = require('./search.util');

  // ── 27. ★ 同名同艺人的歌**不被折叠**，条数与顺序 1:1 守恒 ──────────
  {
    // 三首 normalizeKey 完全相同（同名同艺人），只有 id / 时长不同 ——
    // 正是 buildUnifiedItems 会折叠成 1 条的情形。
    const mk = (id: string, dur: number) => ({
      id,
      provider: 'qq' as const,
      title: '告白气球',
      artist: '周杰伦',
      album: '叶惠美',
      coverUrl: 'http://c/a.jpg',
      audioUrl: '',
      duration: dur,
      liked: false,
    });
    const tracks = [mk('A', 200), mk('B', 210), mk('C', 190)];
    const items = playlistTracksToUnifiedItems(tracks);
    assert.strictEqual(items.length, 3, '★ 同名同艺人必须保持 3 条，不能被折叠');
    assert.deepStrictEqual(
      items.map((i: any) => i.id),
      ['merged-qq-A-studio', 'merged-qq-B-studio', 'merged-qq-C-studio'],
    );
    assert.deepStrictEqual(
      items.map((i: any) => i.duration),
      [200, 210, 190],
      '顺序 1:1 守恒',
    );
    console.log('✅ 27. ★ 同名同艺人不被折叠：3 条 → 3 条，顺序守恒');
  }

  // ── 28. ★ 反向证明：buildUnifiedItems 确实会折叠（说明为什么不能用它）──
  {
    const { buildUnifiedItems } = require('./search.util');
    const mk = (id: string, dur: number) => ({
      id,
      provider: 'qq' as const,
      title: '告白气球',
      artist: '周杰伦',
      album: '叶惠美',
      coverUrl: 'http://c/a.jpg',
      audioUrl: '',
      duration: dur,
      liked: false,
    });
    const entries = [mk('A', 200), mk('B', 210), mk('C', 190)].map((track) => ({
      track,
      source: { platform: track.provider, trackId: track.id, hasCopyright: true, url: '' },
    }));
    const merged = buildUnifiedItems(new Map(), entries);
    assert.ok(
      merged.length < 3,
      `buildUnifiedItems 应该会折叠同名条目（实得 ${merged.length} 条）—— 若这里等于 3，测试前提失效`,
    );
    console.log(
      `✅ 28. 反向证明：buildUnifiedItems 把 3 条同名折叠成 ${merged.length} 条（故歌单路径不能用它）`,
    );
  }

  // ── 29. 单 source / bestSource / vip 字段透传 ──────────────────────
  {
    const tracks = [
      {
        id: 'X1',
        provider: 'spotify' as const,
        title: 'T',
        artist: 'A',
        album: 'Al',
        coverUrl: 'http://c/x.jpg',
        audioUrl: '',
        duration: 100,
        liked: false,
        mediaMid: 'MM',
        vipLocked: true,
        vipCategory: 'paid-track' as const,
        noPreview: true,
      },
    ];
    const [it] = playlistTracksToUnifiedItems(tracks);
    assert.strictEqual(it.sources.length, 1, '只有 1 个 source（不跨平台合并）');
    assert.strictEqual(it.bestSource, 'spotify');
    assert.strictEqual(it.versionType, 'studio', '歌单不做版本识别');
    assert.strictEqual(it.versions.length, 1);
    assert.strictEqual(it.versions[0].id, it.id);
    assert.strictEqual(it.sources[0].mediaMid, 'MM');
    assert.strictEqual(it.sources[0].vipLocked, true);
    assert.strictEqual(it.sources[0].vipCategory, 'paid-track');
    assert.strictEqual(it.sources[0].noPreview, true);
    assert.strictEqual(it.sources[0].hasCopyright, true);
    assert.strictEqual(
      it.likedPlatforms,
      undefined,
      'likedPlatforms 留空 = 视为 sources 平台；远端歌单 ≠ ❤ 列表',
    );
    console.log('✅ 29. 单 source / bestSource / mediaMid / vip 字段透传');
  }

  // ── 30. 空数组 / 边界 ────────────────────────────────────────────
  {
    assert.deepStrictEqual(playlistTracksToUnifiedItems([]), []);
    console.log('✅ 30. 空歌单 → 空数组（不炸）');
  }

  console.log('\n🎉 远端歌单单测全部通过（30/30）');
}

main().catch((e) => {
  console.error('❌ 失败：', e);
  process.exit(1);
});
