/**
 * Controller 层 e2e 测试：/music/* 路由的输入校验 + 未登录/空库态行为。
 *
 * 覆盖路由（test-plan DoD: 每个公开 controller 路由至少 1 个 2xx + 1 个 4xx）：
 *  - GET  /music/next              → deezer → 200（匿名电台）
 *  - GET  /music/search            → 单平台 + 统一搜索 → 200
 *  - GET  /music/library           → 无库 → 404
 *  - POST /music/library/import    → 200（空库导入，无外部网络因无登录）
 *  - POST /music/like/merged       → 缺 mergedId → 400；缺 sources → 400；
 *                                      缺 liked → 400；脏 sources → 400
 *  - POST /music/like/detect       → 缺 mergedId → 400；缺 sources → 400
 *  - POST /music/dislike/merged    → 缺 mergedId → 400；缺 sources → 400
 *  - GET  /music/equivalents       → 无 title+artist → 200 {source:null}
 *  - GET  /music/lyrics            → 200 {lyrics:null}（无 provider 登录）
 *  - GET  /music/lyrics/availability → 200 {available:false}
 *  - GET  /music/deezer/editorials → 200 {items:[...]}
 *  - GET  /music/cover-proxy       → 缺 url → 400；非法 url → 400；
 *                                      非白名单 host → 403
 *
 * 不依赖真实音乐平台网络：只打不需要外部网络的路由，或验证 4xx 校验路径。
 * 用临时 STORAGE_DIR 避免污染真实 state.json。
 *
 * ⚠️ **2026-10-20 补**：上面那句「不依赖真实网络」以前是**许愿不是事实** ——
 * 用例 1/2/3/4/15 各自真去打 QQ / Deezer / lyricsovh 的线上接口。CI runner
 * 上 QQ 匿名搜索会间歇性 500（实测 #110 那次：本次 PR 的两个 CI run 全红在这条，
 * 报 `GET /music/search?provider=qq&q=test → 实际 500`；#108 那次却是绿的）→
 * **间歇红**，而且和代码改动毫无关系。
 *
 * 现在所有会出网的 provider 方法都在 `app.init()` 之后**打桩**（见下）→ 这个
 * 文件真的做到「不依赖网络」，CI 上可重复。路由、校验、响应形状这些真正要测的
 * 东西一点没少测。
 *
 * 运行: npx ts-node src/music/music.controller.e2e.test.ts
 */
export {};
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-music-e2e-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;

const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../app.module');
const {
  InProcessClient,
  getRequestHandlerFromNestApp,
} = require('../test-helpers/in-process-http');
// ── 网络陷阱 ────────────────────────────────────────────────────────
//
// 这个文件承诺「不依赖真实音乐平台网络」—— 那就把它变成**可执行的约束**，
// 而不是注释里的一句许愿：任何一次真实 fetch 都直接炸。
//
// 为什么必须有：这些用例本来真去打 QQ / Deezer / lyricsovh 的线上接口，
// CI runner 上 QQ 匿名搜索会间歇性 500（实测 #110 那次两个 CI run 全红在
// 「GET /music/search?provider=qq&q=test → 实际 500」，#108 那次却是绿的）→
// **间歇红**，而且和代码改动毫无关系。真门禁把这种红如实报出来，但它报的是
// 「网络抖了」而不是「你写错了」—— 那就只能在测试侧断掉网络依赖。
let networkCalls = 0;
const networkTargets: string[] = [];
globalThis.fetch = ((input: unknown) => {
  networkCalls++;
  networkTargets.push(String(input));
  throw new Error(`测试里不允许真实网络请求（被拦下）：${String(input)}`);
}) as unknown as typeof globalThis.fetch;

const { QqMusicProvider } = require('./qq.provider');
const { DeezerMusicProvider } = require('./deezer.provider');
const { LyricsOvhProvider } = require('./lyricsovh.provider');
const { NeteaseMusicProvider } = require('./netease.provider');
const { SpotifyMusicProvider } = require('./spotify.provider');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();
  const client = new InProcessClient(getRequestHandlerFromNestApp(app));

  // ── 断网：把所有会出网的 provider 方法打桩 ──────────────────────
  //
  // 为什么必须打桩（2026-10-20 实测踩坑）：这些用例本来直接打 QQ / Deezer /
  // lyricsovh 的**线上接口**，CI runner 上 QQ 匿名搜索会间歇性 500 →
  // 「用例 3 GET /music/search?provider=qq&q=test → 实际 500」→ 整个文件判失败。
  // 同一份代码在 #108 那次 CI 是绿的、在 #110 那次全红 —— 纯网络抖动。
  //
  // 打桩的是**实例方法**（覆盖原型方法），不引入 @nestjs/testing（仓库没这个依赖）。
  // 桩返回固定的假歌/假电台批次：路由、参数校验、响应结构这些真正要断言的东西
  // 一点不少，只是数据源从"线上平台"换成了"本地假数据"。
  const fakeTrack = (provider: string, id: string, title: string) => ({
    id,
    provider,
    title,
    artist: '假艺人',
    album: '假专辑',
    coverUrl: '',
    audioUrl: '',
    duration: 100,
    liked: false,
  });

  const qqProvider: any = app.get(QqMusicProvider);
  const deezerProvider: any = app.get(DeezerMusicProvider);
  const lyricsovhProvider: any = app.get(LyricsOvhProvider);
  const neteaseProvider: any = app.get(NeteaseMusicProvider);
  const spotifyProvider: any = app.get(SpotifyMusicProvider);

  // **所有**出网方法都打桩（不只是当前用例走的那几个）—— 以后有人加一条新用例
  // 也不会突然把网络依赖引进 CI。桩的是"provider 行为"，而这个文件要测的是
  // **路由 + 参数校验 + 响应形状**，那些一点没少测。
  const stub = (target: any, methods: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(methods)) {
      target[name] = typeof value === 'function' ? value : async () => value;
    }
  };

  stub(qqProvider, {
    search: async () => [fakeTrack('qq', 'q-1', 'QQ 假歌')],
    searchAlbums: async () => [],
    getAlbumTracks: async () => [],
    fetchLiked: async () => [],
    fetchLikedMidSet: async () => new Set<string>(),
    fetchPlaylistTracks: async () => [],
    fetchRadioBatch: async () => [fakeTrack('qq', 'q-3', 'QQ 假电台')],
    getLyrics: async () => null,
    getTrackFavCount: async () => null,
    resolveSongId: async () => null,
    probeSession: async () => ({ alive: false, reason: 'no_cookie' }),
    probeVipAccess: async () => undefined,
    getStreamPath: async () => '',
    like: async () => true,
    unlike: async () => true,
    ensureFreshSession: async () => true,
    refreshSession: async () => true,
  });

  stub(deezerProvider, {
    search: async () => [fakeTrack('deezer', 'd-1', 'Deezer 假歌')],
    searchAlbums: async () => [],
    getAlbumTracks: async () => [],
    fetchLiked: async () => [],
    fetchLikedMidSet: async () => new Set<string>(),
    fetchPlaylistTracks: async () => [],
    fetchRadioBatch: async () => [fakeTrack('deezer', 'd-2', 'Deezer 假电台')],
    getLyrics: async () => null,
    getTrackFavCount: async () => null,
    getStreamPath: async () => '',
  });

  stub(lyricsovhProvider, { getLyrics: async () => null });
  stub(neteaseProvider, {
    search: async () => [],
    searchAlbums: async () => [],
    getAlbumTracks: async () => [],
    fetchLiked: async () => [],
    fetchLikedMidSet: async () => new Set<string>(),
    fetchPlaylistTracks: async () => [],
    fetchRadioBatch: async () => [],
    getLyrics: async () => null,
    getTrackFavCount: async () => null,
    getStreamPath: async () => '',
    like: async () => true,
    unlike: async () => true,
  });
  stub(spotifyProvider, {
    search: async () => [],
    searchAlbums: async () => [],
    getAlbumTracks: async () => [],
    fetchLiked: async () => [],
    fetchLikedMidSet: async () => new Set<string>(),
    fetchPlaylistTracks: async () => [],
    fetchRadioBatch: async () => [],
    getLyrics: async () => null,
    getTrackFavCount: async () => null,
    getStreamPath: async () => '',
    like: async () => true,
    unlike: async () => true,
  });

  const call = async (
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown; text: string }> => {
    const r = await client.call(method, pathname, body);
    let json: unknown = null;
    try {
      json = r.json();
    } catch {
      /* no body / non-JSON */
    }
    return { status: r.status, json, text: r.text() };
  };

  let passed = 0;
  let failed = 0;
  function ok(label: string) {
    console.log(`✅ ${label}`);
    passed++;
  }
  function fail(label: string, msg: string) {
    console.log(`❌ ${label}\n   ${msg}`);
    failed++;
  }
  function expect(label: string, cond: unknown, detail = '') {
    if (cond) ok(label);
    else fail(label, detail);
  }

  try {
    // ── 1. GET /music/next?provider=deezer → 200 ───────────────────
    {
      const r = await call('GET', '/music/next?provider=deezer');
      expect(
        `1. GET /music/next?provider=deezer → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 2. GET /music/next?provider=deezer&preset=electronic → 200 ─
    {
      const r = await call('GET', '/music/next?provider=deezer&preset=electronic');
      expect(
        `2. GET /music/next?provider=deezer&preset=electronic → 200`,
        r.status === 200,
        `实际 ${r.status}`,
      );
    }

    // ── 3. GET /music/search?provider=qq&q=test → 200 ─────────────
    //   QQ 未登录，searchTracks 会走匿名搜索或返回空
    {
      const r = await call('GET', '/music/search?provider=qq&q=test');
      expect(
        `3. GET /music/search?provider=qq&q=test → 200`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 4. GET /music/search?q=test → 200（统一搜索）──────────────
    {
      const r = await call('GET', '/music/search?q=test');
      expect(
        `4. GET /music/search?q=test → 200（统一搜索）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 5. GET /music/library → 404（无库）──────────────────────
    {
      const r = await call('GET', '/music/library');
      expect('5. GET /music/library 无库 → 404', r.status === 404, `实际 ${r.status}`);
      const json = r.json as { error?: string };
      expect(
        '5b. /music/library 404 返回 library_not_imported',
        json.error === 'library_not_imported',
        JSON.stringify(json),
      );
    }

    // ── 6. POST /music/like/merged 缺 mergedId → 400 ─────────────
    {
      const r = await call('POST', '/music/like/merged', {
        sources: [{ platform: 'qq', trackId: '1' }],
        liked: true,
      });
      expect('6. POST /music/like/merged 缺 mergedId → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 7. POST /music/like/merged 缺 sources → 400 ──────────────
    {
      const r = await call('POST', '/music/like/merged', {
        mergedId: 'm1',
        liked: true,
      });
      expect('7. POST /music/like/merged 缺 sources → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 8. POST /music/like/merged 缺 liked → 400 ────────────────
    {
      const r = await call('POST', '/music/like/merged', {
        mergedId: 'm1',
        sources: [{ platform: 'qq', trackId: '1' }],
      });
      expect('8. POST /music/like/merged 缺 liked → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 9. POST /music/like/merged 脏 sources → 400 ──────────────
    {
      const r = await call('POST', '/music/like/merged', {
        mergedId: 'm1',
        sources: [{ platform: 'qq' }], // 缺 trackId
        liked: true,
      });
      expect(
        '9. POST /music/like/merged sources 缺 trackId → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 10. POST /music/like/detect 缺 mergedId → 400 ────────────
    {
      const r = await call('POST', '/music/like/detect', {
        sources: [{ platform: 'qq', trackId: '1' }],
      });
      expect('10. POST /music/like/detect 缺 mergedId → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 11. POST /music/like/detect 缺 sources → 400 ─────────────
    {
      const r = await call('POST', '/music/like/detect', { mergedId: 'm1' });
      expect('11. POST /music/like/detect 缺 sources → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 12. POST /music/dislike/merged 缺 mergedId → 400 ─────────
    {
      const r = await call('POST', '/music/dislike/merged', {
        sources: [{ platform: 'qq', trackId: '1' }],
      });
      expect(
        '12. POST /music/dislike/merged 缺 mergedId → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 13. POST /music/dislike/merged 缺 sources → 400 ──────────
    {
      const r = await call('POST', '/music/dislike/merged', { mergedId: 'm1' });
      expect(
        '13. POST /music/dislike/merged 缺 sources → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 14. GET /music/equivalents 无 title+artist → 200 {source:null} ─
    {
      const r = await call('GET', '/music/equivalents?provider=qq');
      expect(
        '14. GET /music/equivalents 无 title+artist → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { source?: unknown };
      expect(
        '14b. /music/equivalents 返回 source=null',
        json.source === null,
        JSON.stringify(json),
      );
    }

    // ── 15. GET /music/lyrics?provider=qq&trackId=x → 200 ────────
    {
      const r = await call('GET', '/music/lyrics?provider=qq&trackId=fake-id');
      expect(
        `15. GET /music/lyrics → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 16. GET /music/lyrics/availability → 200 ─────────────────
    {
      const r = await call('GET', '/music/lyrics/availability?sources=qq:fake-id');
      expect(
        `16. GET /music/lyrics/availability → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}`,
      );
    }

    // ── 17. GET /music/deezer/editorials → 200 ───────────────────
    {
      const r = await call('GET', '/music/deezer/editorials');
      expect('17. GET /music/deezer/editorials → 200', r.status === 200, `实际 ${r.status}`);
      const json = r.json as { items?: unknown[] };
      expect(
        '17b. /music/deezer/editorials 返回 items 数组',
        Array.isArray(json.items),
        JSON.stringify(json),
      );
    }

    // ── 18. GET /music/cover-proxy 缺 url → 400 ──────────────────
    {
      const r = await call('GET', '/music/cover-proxy');
      expect('18. GET /music/cover-proxy 缺 url → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 19. GET /music/cover-proxy 非法 url → 400 ────────────────
    {
      const r = await call('GET', '/music/cover-proxy?url=not-a-url');
      expect('19. GET /music/cover-proxy 非法 url → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 20. GET /music/cover-proxy 非白名单 host → 403 ───────────
    {
      const r = await call('GET', '/music/cover-proxy?url=https://evil.com/img.jpg');
      expect(
        '20. GET /music/cover-proxy 非白名单 host → 403',
        r.status === 403,
        `实际 ${r.status}`,
      );
    }

    // ── 21. GET /music/cover-proxy 非 http 协议 → 400 ────────────
    {
      const r = await call('GET', '/music/cover-proxy?url=ftp://y.gtimg.cn/img.jpg');
      expect('21. GET /music/cover-proxy ftp 协议 → 400', r.status === 400, `实际 ${r.status}`);
    }

    // ── 22. GET /music/liked?provider=qq → 200 ───────────────────
    {
      const r = await call('GET', '/music/liked?provider=qq');
      expect(
        `22. GET /music/liked?provider=qq → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 23. GET /music/lyrics/search?title=x&artist=y → 200 ──────
    {
      const r = await call('GET', '/music/lyrics/search?title=test&artist=test');
      expect(
        `23. GET /music/lyrics/search → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 24. POST /music/library/import → 200/4xx ─────────────────
    //   无登录态 → importLiked 会尝试拉各平台，无平台登录时返回空结果
    {
      const r = await call('POST', '/music/library/import', {});
      // 可能 200（空导入）或 4xx（无登录），都算「路由可达」
      expect(
        `24. POST /music/library/import → 2xx/4xx（实际 ${r.status}）`,
        r.status >= 200 && r.status < 500,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // 网络陷阱的账：一次真实请求都不该发生。发生了说明又有人把线上依赖
    // 悄悄引进来了（或者桩没盖住某条路径）—— 直接判失败，别等 CI 上偶发红。
    if (networkCalls > 0) {
      console.error(`❌ 测试期间发起了 ${networkCalls} 次真实网络请求`);
      console.error('   记录: ' + JSON.stringify(networkTargets));
      failed++;
    } else {
      console.log('✅ 25. 零真实网络请求（网络陷阱没被触发）');
      passed++;
    }
  }

  console.log(`\n🎉 music.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ music.controller.e2e 失败:', e);
  process.exit(1);
});
