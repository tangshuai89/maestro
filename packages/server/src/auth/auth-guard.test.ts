/**
 * D6 测试：/auth/* controller + RequireInternalTokenGuard 校验
 *
 * 验证三态：
 *  1. 无 MAESTRO_INTERNAL_TOKEN → dev mode，所有请求放行（200/400 取决于业务逻辑）
 *  2. 有 MAESTRO_INTERNAL_TOKEN + 无 X-Maestro-Token header → 401
 *  3. 有 MAESTRO_INTERNAL_TOKEN + 错误 X-Maestro-Token → 401
 *  4. 有 MAESTRO_INTERNAL_TOKEN + 正确 X-Maestro-Token → 放行
 *
 * 用 GET /auth/status?provider=qq 作为探测端点（GET 也被 guard 覆盖）。
 *
 * 运行: npx ts-node src/auth/auth-guard.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

async function createApp(tmpDir: string) {
  process.env.STORAGE_DIR = tmpDir;
  const { NestFactory } = require('@nestjs/core');
  const cookieParser = require('cookie-parser');
  const { AppModule } = require('../app.module');
  const {
    InProcessClient,
    getRequestHandlerFromNestApp,
  } = require('../test-helpers/in-process-http');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();
  return { app, client: new InProcessClient(getRequestHandlerFromNestApp(app)) };
}

async function main() {
  // ── 1. 无 token（dev mode）→ 放行 ─────────────────────────
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-dev-'));
    delete process.env.MAESTRO_INTERNAL_TOKEN;
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/auth/status?provider=qq');
      assert.strictEqual(r.status, 200, `dev mode 应放行，实际 ${r.status}`);
      console.log('✅ 1. 无 token（dev mode）→ 放行 200');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 2. 有 token + 无 header → 401 ─────────────────────────
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-nohdr-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/auth/status?provider=qq');
      assert.strictEqual(r.status, 401, `无 header 应 401，实际 ${r.status}`);
      console.log('✅ 2. 有 token + 无 X-Maestro-Token → 401');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 3. 有 token + 错误 header → 401 ───────────────────────
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-bad-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/auth/status?provider=qq', undefined, {
        'x-maestro-token': 'wrong-token',
      });
      assert.strictEqual(r.status, 401, `错误 header 应 401，实际 ${r.status}`);
      console.log('✅ 3. 有 token + 错误 X-Maestro-Token → 401');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 4. 有 token + 正确 header → 放行 ──────────────────────
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-ok-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/auth/status?provider=qq', undefined, {
        'x-maestro-token': 'test-secret-token-abc',
      });
      assert.strictEqual(r.status, 200, `正确 header 应放行，实际 ${r.status}`);
      const json = r.json();
      assert.strictEqual(json.provider, 'qq');
      console.log('✅ 4. 有 token + 正确 X-Maestro-Token → 放行 200');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 5. POST 端点也受保护（spotify/cancel）────────────────
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-post-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      // 无 header
      const r1 = await client.call('POST', '/auth/spotify/cancel', {});
      assert.strictEqual(r1.status, 401, `POST 无 header 应 401，实际 ${r1.status}`);
      // 正确 header
      const r2 = await client.call('POST', '/auth/spotify/cancel', {}, {
        'x-maestro-token': 'test-secret-token-abc',
      });
      assert.strictEqual(r2.status, 201, `POST 正确 header 应放行，实际 ${r2.status}`);
      console.log('✅ 5. POST 端点也受 guard 保护');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 清理
  delete process.env.MAESTRO_INTERNAL_TOKEN;

  console.log('\n🎉 auth-guard.test 全部 5 项通过');
  await mediaRouteRegression();
}

main().catch((e) => {
  console.error('❌ auth-guard.test 失败:', e);
  process.exit(1);
});


// ─────────────────────────────────────────────────────────────────────
// Audit A1 (consistency-fixes T1): media GET routes are exempt from
// RequireInternalTokenGuard. Regression coverage — even with a token
// configured, no X-Maestro-Token header on the request still returns
// the controller's response (not 401). Other routes (e.g. /auth/status)
// must still 401 without the header.
// ─────────────────────────────────────────────────────────────────────
async function mediaRouteRegression() {
  // ── /music/deezer/editorials without header → 200 (not 401) ──
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-media-editor-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/music/deezer/editorials');
      assert.strictEqual(
        r.status,
        200,
        `/music/deezer/editorials 无 token 应放行（媒体路由豁免），实际 ${r.status}`,
      );
      const json = r.json();
      assert.ok(Array.isArray(json.items), 'editorials 应返回数组');
      console.log('✅ A1.1 /music/deezer/editorials 无 token → 200（豁免生效）');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── /music/cover-proxy?url=... without header → 不 401 ──
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-media-cover-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      // 用一个会被 cover-proxy 的 allowlist 拒绝的 URL，期望 403/400
      // 但**不是** 401。证明 guard 没拦。
      const r = await client.call(
        'GET',
        '/music/cover-proxy?url=https%3A%2F%2Fevil.example.com%2Fa.jpg',
      );
      assert.notStrictEqual(
        r.status,
        401,
        `/music/cover-proxy 无 token 不应 401，实际 ${r.status}`,
      );
      console.log(
        `✅ A1.2 /music/cover-proxy 无 token → ${r.status}（guard 未拦）`,
      );
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── /music/stream/... without header → 404（找不到 track），不是 401 ──
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-media-stream-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/music/stream/deezer/99999999');
      assert.notStrictEqual(
        r.status,
        401,
        `/music/stream 无 token 不应 401，实际 ${r.status}`,
      );
      console.log(
        `✅ A1.3 /music/stream 无 token → ${r.status}（guard 未拦）`,
      );
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── /music/lyrics?... without header → 不 401 ──
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-media-lyrics-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call(
        'GET',
        '/music/lyrics?provider=deezer&trackId=99999999',
      );
      assert.notStrictEqual(
        r.status,
        401,
        `/music/lyrics 无 token 不应 401，实际 ${r.status}`,
      );
      console.log(
        `✅ A1.4 /music/lyrics 无 token → ${r.status}（guard 未拦）`,
      );
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── 反例：非媒体路由仍然 401 ──
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-media-counter-'));
    process.env.MAESTRO_INTERNAL_TOKEN = 'test-secret-token-abc';
    const { app, client } = await createApp(tmpDir);
    try {
      const r = await client.call('GET', '/music/liked?provider=qq');
      assert.strictEqual(
        r.status,
        401,
        `/music/liked 无 token 应仍 401，实际 ${r.status}`,
      );
      console.log('✅ A1.5 /music/liked 无 token → 仍 401（保护未失效）');
    } finally {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 清理
  delete process.env.MAESTRO_INTERNAL_TOKEN;
  console.log('\n🎉 A1 media-route 豁免回归 5 项通过');
}

// mediaRouteRegression is invoked from main() above (sequential with the
// original 5 cases — important because they share process.env.MAESTRO_INTERNAL_TOKEN).
