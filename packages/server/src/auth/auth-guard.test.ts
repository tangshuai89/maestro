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
}

main().catch((e) => {
  console.error('❌ auth-guard.test 失败:', e);
  process.exit(1);
});
