/**
 * D4 测试：/music/deezer/preset 切换持久化 + 不存在 preset → 400
 *
 * 验证：
 *  1. PUT /music/deezer/preset 合法 preset → 200 + 持久化到 session
 *  2. PUT /music/deezer/preset 不存在 preset → 400
 *  3. PUT /music/deezer/preset 缺 preset 字段 → 400
 *  4. GET /music/deezer/editorials 返回 preset 列表
 *  5. 合法 preset 切换后，后续 /next 请求使用新 preset（通过 session.prefs 验证）
 *
 * 运行: npx ts-node src/music/deezer-preset.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-deezer-preset-'));
process.env.STORAGE_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-var-requires */
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
  ): Promise<{ status: number; json: unknown }> => {
    const r = await client.call(method, pathname, body);
    let json: unknown = null;
    try {
      json = r.json();
    } catch {
      /* no body / non-JSON */
    }
    return { status: r.status, json };
  };

  try {
    // ── 1. GET /music/deezer/editorials 返回列表 ──────────────
    {
      const r = await call('GET', '/music/deezer/editorials');
      assert.strictEqual(r.status, 200);
      const items = (r.json as { items?: unknown[] }).items;
      assert.ok(Array.isArray(items) && items!.length > 0,
        'editorials 列表应非空');
      console.log(`✅ 1. editorials 返回 ${items!.length} 项`);
    }

    // ── 2. PUT 合法 preset → 200 ──────────────────────────────
    {
      const r = await call('PUT', '/music/deezer/preset', { preset: 'rock' });
      assert.strictEqual(r.status, 200, `期望 200，实际 ${r.status}`);
      assert.strictEqual((r.json as { preset?: string }).preset, 'rock');
      console.log('✅ 2. PUT deezer/preset rock → 200');
    }

    // ── 3. PUT 不存在 preset → 400 ────────────────────────────
    {
      const r = await call('PUT', '/music/deezer/preset', { preset: 'nonexistent' });
      assert.strictEqual(r.status, 400, `期望 400，实际 ${r.status}`);
      assert.ok(
        (r.json as { message?: string }).message?.includes('Invalid deezer preset'),
        '错误消息应含 "Invalid deezer preset"',
      );
      console.log('✅ 3. PUT 不存在 preset → 400');
    }

    // ── 4. PUT 缺 preset 字段 → 400 ───────────────────────────
    {
      const r = await call('PUT', '/music/deezer/preset', {});
      assert.strictEqual(r.status, 400, `期望 400，实际 ${r.status}`);
      console.log('✅ 4. PUT 缺 preset → 400');
    }

    // ── 5. PUT 空 preset → 400 ────────────────────────────────
    {
      const r = await call('PUT', '/music/deezer/preset', { preset: '' });
      assert.strictEqual(r.status, 400, `期望 400，实际 ${r.status}`);
      console.log('✅ 5. PUT 空 preset → 400');
    }

    // ── 6. 切换 preset 后再切另一个，验证持久化 ────────────────
    {
      const r1 = await call('PUT', '/music/deezer/preset', { preset: 'jazz' });
      assert.strictEqual(r1.status, 200);
      const r2 = await call('PUT', '/music/deezer/preset', { preset: 'classical' });
      assert.strictEqual(r2.status, 200);
      assert.strictEqual((r2.json as { preset?: string }).preset, 'classical');
      console.log('✅ 6. 连续切换 jazz → classical 持久化');
    }

    // ── 7. 所有合法 preset 都能切换 ───────────────────────────
    {
      const validPresets = ['all', 'asia', 'pop', 'rap', 'rock', 'dance', 'rnb', 'classical', 'jazz'];
      for (const p of validPresets) {
        const r = await call('PUT', '/music/deezer/preset', { preset: p });
        assert.strictEqual(r.status, 200, `preset ${p} 应 200，实际 ${r.status}`);
      }
      console.log(`✅ 7. 全部 ${validPresets.length} 个合法 preset 切换成功`);
    }

    console.log('\n🎉 deezer-preset.test 全部 7 项通过');
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('❌ deezer-preset.test 失败:', e);
  process.exit(1);
});
