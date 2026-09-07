/**
 * Controller 层 e2e 测试：/auth/* 路由的输入校验 + 未登录态行为。
 *
 * 覆盖路由（test-plan DoD: 每个公开 controller 路由至少 1 个 2xx + 1 个 4xx）：
 *  - GET  /auth/spotify/callback    → 缺 code/state → 400
 *  - GET  /auth/spotify/redeem      → 缺 code/state → 400
 *  - GET  /auth/netease/qr/check    → 缺 key → 400
 *  - POST /auth/netease/qr/start    → 201（qrStart 会打真实网络，但 fetch 失败
 *                                      时 netease strategy 抛 400 → 用 mock env
 *                                      使其可预测地失败，验证 4xx 路径）
 *  - POST /auth/spotify/start       → 无 client_id → 400
 *  - POST /auth/spotify/client-id   → 太短 → 400；合法 → 201
 *  - POST /auth/spotify/cancel      → 201（无 in-flight flow）
 *  - POST /auth/event               → 非法 outcome → 400；合法 → 201
 *  - GET  /auth/spotify/status      → 200（未登录态）
 *  - GET  /auth/spotify/token       → 401（未登录）
 *  - GET  /auth/spotify/me          → 401（未登录）
 *  - GET  /auth/logout              → deezer → 200 noop
 *  - GET  /auth/status              → deezer → 200 loggedIn=true
 *
 * 不依赖真实音乐平台网络：只打不需要外部网络的路由，或验证 4xx 校验路径。
 * 用临时 STORAGE_DIR 避免污染真实 state.json。
 *
 * 运行: npx ts-node src/auth/auth.controller.e2e.test.ts
 *
 * **sandbox 友好**：通过 `src/test-helpers/in-process-http.ts` 直接调
 * 内部 Express handler，不走 `app.listen(0)`。
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

// ⚠️ 必须在 import AppModule 之前设 env——ConfigService 在构造时读 storageDir。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-auth-e2e-'));
process.env.STORAGE_DIR = tmpDir;
// dev mode: 不设 MAESTRO_INTERNAL_TOKEN，guard 放行所有请求
delete process.env.MAESTRO_INTERNAL_TOKEN;
// 清掉可能从环境继承的 spotify client_id
delete process.env.SPOTIFY_CLIENT_ID;

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
  function expect(label: string, cond: boolean, detail = '') {
    if (cond) ok(label);
    else fail(label, detail);
  }

  try {
    // ── 1. GET /auth/spotify/callback 缺 code → 400 ─────────────────
    {
      const r = await call('GET', '/auth/spotify/callback');
      expect(
        '1. /auth/spotify/callback 缺 code+state → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 2. GET /auth/spotify/callback 缺 state → 400 ───────────────
    {
      const r = await call('GET', '/auth/spotify/callback?code=abc');
      expect(
        '2. /auth/spotify/callback 缺 state → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 3. GET /auth/spotify/redeem 缺 code → 400 ──────────────────
    {
      const r = await call('GET', '/auth/spotify/redeem');
      expect(
        '3. /auth/spotify/redeem 缺 code+state → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 4. GET /auth/netease/qr/check 缺 key → 400 ─────────────────
    {
      const r = await call('GET', '/auth/netease/qr/check');
      expect(
        '4. /auth/netease/qr/check 缺 key → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 5. POST /auth/spotify/start 无 client_id → 400 ─────────────
    {
      const r = await call('POST', '/auth/spotify/start', {});
      expect(
        '5. /auth/spotify/start 无 client_id → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 6. POST /auth/spotify/client-id 太短 → 400 ─────────────────
    {
      const r = await call('POST', '/auth/spotify/client-id', { clientId: 'ab' });
      expect(
        '6. /auth/spotify/client-id 太短 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 7. POST /auth/spotify/client-id 合法 → 201 ─────────────────
    {
      const r = await call('POST', '/auth/spotify/client-id', {
        clientId: 'test-client-id-12345678',
      });
      expect(
        '7. /auth/spotify/client-id 合法 → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { ok?: boolean; tail?: string };
      expect(
        '7b. /auth/spotify/client-id 返回 ok=true + tail',
        json.ok === true && typeof json.tail === 'string',
        JSON.stringify(json),
      );
    }

    // ── 8. POST /auth/spotify/start 有 client_id → 201 ─────────────
    {
      const r = await call('POST', '/auth/spotify/start', {});
      expect(
        '8. /auth/spotify/start 有 client_id → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { authorizeUrl?: string; state?: string };
      expect(
        '8b. /auth/spotify/start 返回 authorizeUrl + state',
        typeof json.authorizeUrl === 'string' && typeof json.state === 'string',
        JSON.stringify(json),
      );
    }

    // ── 9. POST /auth/spotify/cancel → 201（无 in-flight flow）──────
    {
      const r = await call('POST', '/auth/spotify/cancel', {});
      expect(
        '9. /auth/spotify/cancel → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { ok?: boolean; removed?: number };
      expect(
        '9b. /auth/spotify/cancel 返回 ok=true + removed≥0',
        json.ok === true && typeof json.removed === 'number',
        JSON.stringify(json),
      );
    }

    // ── 10. POST /auth/event 非法 outcome → 400 ────────────────────
    {
      const r = await call('POST', '/auth/event', {
        provider: 'qq',
        attemptId: 'a1',
        outcome: 'bogus',
        durationMs: 100,
      });
      expect(
        '10. /auth/event 非法 outcome → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 11. POST /auth/event 非法 durationMs → 400 ─────────────────
    {
      const r = await call('POST', '/auth/event', {
        provider: 'qq',
        attemptId: 'a1',
        outcome: 'ok',
        durationMs: -1,
      });
      expect(
        '11. /auth/event 负 durationMs → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 12. POST /auth/event 合法 → 201 ────────────────────────────
    {
      const r = await call('POST', '/auth/event', {
        provider: 'qq',
        attemptId: 'a1',
        outcome: 'ok',
        durationMs: 1500,
      });
      expect(
        '12. /auth/event 合法 → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
    }

    // ── 13. POST /auth/event fail + errorCode → 201 ────────────────
    {
      const r = await call('POST', '/auth/event', {
        provider: 'spotify',
        attemptId: 'a2',
        outcome: 'fail',
        durationMs: 3000,
        errorCode: 'AUTH_EXPIRED',
      });
      expect(
        '13. /auth/event fail+errorCode → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
    }

    // ── 14. GET /auth/spotify/status 未登录 → 200 ──────────────────
    {
      const r = await call('GET', '/auth/spotify/status');
      expect(
        '14. /auth/spotify/status 未登录 → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { hasClientId?: boolean; loggedIn?: boolean; tier?: string };
      expect(
        '14b. /auth/spotify/status loggedIn=false, tier=null',
        json.loggedIn === false && json.tier === null,
        JSON.stringify(json),
      );
    }

    // ── 15. GET /auth/spotify/token 未登录 → 401 ───────────────────
    {
      const r = await call('GET', '/auth/spotify/token');
      expect(
        '15. /auth/spotify/token 未登录 → 401',
        r.status === 401,
        `实际 ${r.status}`,
      );
    }

    // ── 16. GET /auth/spotify/me 未登录 → 401 ──────────────────────
    {
      const r = await call('GET', '/auth/spotify/me');
      expect(
        '16. /auth/spotify/me 未登录 → 401',
        r.status === 401,
        `实际 ${r.status}`,
      );
    }

    // ── 17. GET /auth/logout?provider=deezer → 200 noop ────────────
    {
      const r = await call('GET', '/auth/logout?provider=deezer');
      expect(
        '17. /auth/logout?provider=deezer → 200 noop',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { success?: boolean; noop?: boolean };
      expect(
        '17b. /auth/logout deezer 返回 success=true + noop=true',
        json.success === true && json.noop === true,
        JSON.stringify(json),
      );
    }

    // ── 18. GET /auth/status?provider=deezer → 200 loggedIn=true ───
    {
      const r = await call('GET', '/auth/status?provider=deezer');
      expect(
        '18. /auth/status?provider=deezer → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { provider?: string; loggedIn?: boolean };
      expect(
        '18b. /auth/status deezer loggedIn=true',
        json.provider === 'deezer' && json.loggedIn === true,
        JSON.stringify(json),
      );
    }

    // ── 19. GET /auth/status?provider=qq 未登录 → 200 loggedIn=false ─
    {
      const r = await call('GET', '/auth/status?provider=qq');
      expect(
        '19. /auth/status?provider=qq 未登录 → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { provider?: string; loggedIn?: boolean };
      expect(
        '19b. /auth/status qq loggedIn=false',
        json.provider === 'qq' && json.loggedIn === false,
        JSON.stringify(json),
      );
    }

    // ── 20. GET /auth/status?provider=qq&extended=1 → 200 带 lastValidatedAt ─
    {
      const r = await call('GET', '/auth/status?provider=qq&extended=1');
      expect(
        '20. /auth/status?provider=qq&extended=1 → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { lastValidatedAt?: unknown };
      expect(
        '20b. /auth/status extended 带 lastValidatedAt 字段',
        'lastValidatedAt' in json,
        JSON.stringify(json),
      );
    }

    // ── 21. GET /auth/status?provider=invalid → 200 (normalizeProvider 回退) ─
    {
      const r = await call('GET', '/auth/status?provider=bogus');
      expect(
        '21. /auth/status?provider=bogus → 200（normalize 回退）',
        r.status === 200,
        `实际 ${r.status}`,
      );
    }

    // ── 22. POST /auth/qq/cookie 缺 cookie → 400 ───────────────────
    {
      const r = await call('POST', '/auth/qq/cookie', {});
      expect(
        '22. /auth/qq/cookie 缺 cookie → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 23. POST /auth/netease/cookie 缺 musicU → 400 ──────────────
    {
      const r = await call('POST', '/auth/netease/cookie', {});
      expect(
        '23. /auth/netease/cookie 缺 musicU → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 24. POST /auth/spotify/client-id 缺 clientId → 400 ─────────
    {
      const r = await call('POST', '/auth/spotify/client-id', {});
      expect(
        '24. /auth/spotify/client-id 缺 clientId → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 25. POST /auth/event 缺 outcome → 400 ──────────────────────
    {
      const r = await call('POST', '/auth/event', {
        provider: 'qq',
        attemptId: 'a1',
        durationMs: 100,
      });
      expect(
        '25. /auth/event 缺 outcome → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n🎉 auth.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ auth.controller.e2e 失败:', e);
  process.exit(1);
});
