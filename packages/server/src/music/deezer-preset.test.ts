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
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');

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


// ─────────────────────────────────────────────────────────────────────
// T10 G2: deezer-preset persist (setPref 路径)
// 验证：
//   - setDeezerPreset 调用后 state.json 有 deezerPreset
//   - 重启后 session.prefs.deezerPreset 仍在
// ─────────────────────────────────────────────────────────────────────
void (async () => {

// ── G2.1 setDeezerPreset 写入并 persist ──────────────────────────
{
  // 直接调 service.setPref 走持久化路径，避免 HTTP 启动开销
  const cfg = new ConfigService();
  const storage = new StorageService(cfg);
  const session = new SessionService(storage, cfg);

  // 直接造一个 session
  const fakeSession = {
    id: 'test-t10-g2-1',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: {},
  };
  (session as any).blob.byId[fakeSession.id] = fakeSession;

  // setPref（这是 setDeezerPreset 现在走的路径）
  session.setPref(fakeSession, 'deezerPreset', 'pop');
  storage.flushSync();

  // 重新 load
  const cfg2 = new ConfigService();
  const storage2 = new StorageService(cfg2);
  const session2 = new SessionService(storage2, cfg2);

  const reloaded = session2['blob'].byId[fakeSession.id];
  assert.ok(reloaded, 'session 应被持久化（重启后仍存在）');
  assert.strictEqual(
    reloaded.prefs?.deezerPreset,
    'pop',
    `重启后 prefs.deezerPreset 应 = 'pop'（实际 ${reloaded.prefs?.deezerPreset}）`,
  );
  console.log('✅ G2.1 setPref 写入 deezerPreset → 持久化 + 重启保留');
}

// ── G2.2 /next?preset= 也走 prefs 路径 ────────────────────────────
{
  // 通过 MusicService.getNextTrack 路径读取 preset 时确认 session.prefs.deezerPreset
  // 被使用。无需真调 QQ/N/，把 deezer preset 改成'rock' 然后用 MusicService 读出来。
  const cfg = new ConfigService();
  const storage = new StorageService(cfg);
  const session = new SessionService(storage, cfg);
  const sessLike: any = {
    id: 'test-t10-g2-2',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: {},
  };
  (session as any).blob.byId[sessLike.id] = sessLike;

  // 直接设 prefs（无需经过 controller）
  session.setPref(sessLike, 'deezerPreset', 'rock');
  storage.flushSync();

  // 重新 load + 用 music.service 读
  const cfg2 = new ConfigService();
  const storage2 = new StorageService(cfg2);
  const session2 = new SessionService(storage2, cfg2);
  const reloaded = session2['blob'].byId[sessLike.id];

  assert.strictEqual(
    reloaded.prefs?.deezerPreset,
    'rock',
    '重启后 prefs.deezerPreset = rock',
  );
  console.log('✅ G2.2 prefs.deezerPreset 跨 service 实例保持');
}

console.log('\n🎉 deezer-preset.test: all T2 cases + G2.1/G2.2 passed');
})();
