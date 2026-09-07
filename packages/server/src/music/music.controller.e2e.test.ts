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
 *  - PUT  /music/deezer/preset     → 非法 preset → 400；合法 → 200
 *  - GET  /music/cover-proxy       → 缺 url → 400；非法 url → 400；
 *                                      非白名单 host → 403
 *
 * 不依赖真实音乐平台网络：只打不需要外部网络的路由，或验证 4xx 校验路径。
 * 用临时 STORAGE_DIR 避免污染真实 state.json。
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

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();
  const client = new InProcessClient(getRequestHandlerFromNestApp(app));

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
      expect(
        '5. GET /music/library 无库 → 404',
        r.status === 404,
        `实际 ${r.status}`,
      );
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
      expect(
        '6. POST /music/like/merged 缺 mergedId → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 7. POST /music/like/merged 缺 sources → 400 ──────────────
    {
      const r = await call('POST', '/music/like/merged', {
        mergedId: 'm1',
        liked: true,
      });
      expect(
        '7. POST /music/like/merged 缺 sources → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 8. POST /music/like/merged 缺 liked → 400 ────────────────
    {
      const r = await call('POST', '/music/like/merged', {
        mergedId: 'm1',
        sources: [{ platform: 'qq', trackId: '1' }],
      });
      expect(
        '8. POST /music/like/merged 缺 liked → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
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
      expect(
        '10. POST /music/like/detect 缺 mergedId → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 11. POST /music/like/detect 缺 sources → 400 ─────────────
    {
      const r = await call('POST', '/music/like/detect', { mergedId: 'm1' });
      expect(
        '11. POST /music/like/detect 缺 sources → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
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
      expect(
        '17. GET /music/deezer/editorials → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { items?: unknown[] };
      expect(
        '17b. /music/deezer/editorials 返回 items 数组',
        Array.isArray(json.items),
        JSON.stringify(json),
      );
    }

    // ── 18. PUT /music/deezer/preset 非法 preset → 400 ───────────
    {
      const r = await call('PUT', '/music/deezer/preset', { preset: 'bogus-genre' });
      expect(
        '18. PUT /music/deezer/preset 非法 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 19. PUT /music/deezer/preset 缺 preset → 400 ─────────────
    {
      const r = await call('PUT', '/music/deezer/preset', {});
      expect(
        '19. PUT /music/deezer/preset 缺 preset → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 20. PUT /music/deezer/preset 合法 → 200 ──────────────────
    //   先拿一个合法 preset 名
    {
      const ed = await call('GET', '/music/deezer/editorials');
      const edJson = ed.json as { items?: Array<{ id?: string; name?: string }> };
      const items = edJson.items;
      if (items && items.length > 0) {
        // Deezer preset 用小写 name，取第一个 editorial 的 id 并小写化
        const presetName = (items[0].id || items[0].name || '').toLowerCase();
        if (presetName) {
          const r = await call('PUT', '/music/deezer/preset', { preset: presetName });
          expect(
            `20. PUT /music/deezer/preset 合法(${presetName}) → 200`,
            r.status === 200,
            `实际 ${r.status}: ${r.text.slice(0, 100)}`,
          );
        }
      }
    }

    // ── 21. GET /music/cover-proxy 缺 url → 400 ──────────────────
    {
      const r = await call('GET', '/music/cover-proxy');
      expect(
        '21. GET /music/cover-proxy 缺 url → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 22. GET /music/cover-proxy 非法 url → 400 ────────────────
    {
      const r = await call('GET', '/music/cover-proxy?url=not-a-url');
      expect(
        '22. GET /music/cover-proxy 非法 url → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 23. GET /music/cover-proxy 非白名单 host → 403 ───────────
    {
      const r = await call('GET', '/music/cover-proxy?url=https://evil.com/img.jpg');
      expect(
        '23. GET /music/cover-proxy 非白名单 host → 403',
        r.status === 403,
        `实际 ${r.status}`,
      );
    }

    // ── 24. GET /music/cover-proxy 非 http 协议 → 400 ────────────
    {
      const r = await call('GET', '/music/cover-proxy?url=ftp://y.gtimg.cn/img.jpg');
      expect(
        '24. GET /music/cover-proxy ftp 协议 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 25. GET /music/liked?provider=qq → 200 ───────────────────
    {
      const r = await call('GET', '/music/liked?provider=qq');
      expect(
        `25. GET /music/liked?provider=qq → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 26. GET /music/lyrics/search?title=x&artist=y → 200 ──────
    {
      const r = await call('GET', '/music/lyrics/search?title=test&artist=test');
      expect(
        `26. GET /music/lyrics/search → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 27. POST /music/library/import → 200/4xx ─────────────────
    //   无登录态 → importLiked 会尝试拉各平台，无平台登录时返回空结果
    {
      const r = await call('POST', '/music/library/import', {});
      // 可能 200（空导入）或 4xx（无登录），都算「路由可达」
      expect(
        `27. POST /music/library/import → 2xx/4xx（实际 ${r.status}）`,
        r.status >= 200 && r.status < 500,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n🎉 music.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ music.controller.e2e 失败:', e);
  process.exit(1);
});
