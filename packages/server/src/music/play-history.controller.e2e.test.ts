/**
 * 播放历史的 **Controller 层** e2e：GET/POST/DELETE /music/history 三个端点。
 *
 * 为什么单独一个文件（而不是塞进 music.controller.e2e.test.ts）：
 * 播放历史的语义是「**最近播放**」而不是「播放流水」—— 同一首再记一次要
 * **移到最前**而不是追加第二条；这个语义只有**从 HTTP 端点进去**才验得到
 * （service 层的白盒测试绕过了「幂等 + 排序 + 响应形状」这一整条链）。
 *
 * 顺带覆盖门禁抓到的那 3 个「从未被执行过」的 controller 方法：
 * `getPlayHistory` / `recordPlayHistory` / `clearPlayHistory`。
 *
 * 不依赖真实音乐平台网络：这三个端点根本不碰外部平台。
 * 用临时 STORAGE_DIR 避免污染真实 state.json。
 *
 * 运行: npx ts-node src/music/play-history.controller.e2e.test.ts
 */
export {};
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-playhist-e2e-'));
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
// 这三个端点不碰外部平台；一旦有真实 fetch 就说明有别的路径漏进来了。
let networkCalls = 0;
const networkTargets: string[] = [];
globalThis.fetch = ((input: unknown) => {
  networkCalls++;
  networkTargets.push(String(input));
  throw new Error(`测试里不允许真实网络请求（被拦下）：${String(input)}`);
}) as unknown as typeof globalThis.fetch;

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();

  const client = new InProcessClient(getRequestHandlerFromNestApp(app));

  const call = async (
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; json: any; text: string }> => {
    const r = await client.call(method, pathname, body);
    let json: any = null;
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

  const track = (id: string, title = `歌 ${id}`) => ({
    platform: 'qq',
    trackId: id,
    title,
    artist: '歌手',
    duration: 210,
  });

  try {
    // ── 1. 空历史 → 200 + 空数组（不是 404）────────────────────
    {
      const r = await call('GET', '/music/history');
      expect(
        `1. GET /music/history → 200（实际 ${r.status}）`,
        r.status === 200,
        `实际 ${r.status}`,
      );
      expect(
        '2. 空历史 → entries 是空数组（不是 404、不是 null）',
        Array.isArray(r.json?.entries) && r.json.entries.length === 0,
        `实际 ${JSON.stringify(r.json)}`,
      );
    }

    // ── 3. POST 记一条 → 201（Nest 的 POST 默认码）+ 回显 entry ──
    {
      const r = await call('POST', '/music/history', track('t1', '第一首'));
      expect(
        `3. POST /music/history → 201（实际 ${r.status}）`,
        r.status === 201,
        `实际 ${r.status}: ${r.text.slice(0, 120)}`,
      );
      expect('4. POST → ok=true', r.json?.ok === true, `实际 ${JSON.stringify(r.json)}`);
      expect(
        '5. POST → 回显 entry（id = platform:trackId）',
        r.json?.entry?.id === 'qq:t1',
        `实际 ${JSON.stringify(r.json?.entry)}`,
      );
      expect(
        '6. POST → entry 带 playedAt',
        typeof r.json?.entry?.playedAt === 'number',
        `实际 ${JSON.stringify(r.json?.entry)}`,
      );
    }

    // ── 7. GET 能读回来 ───────────────────────────────────────
    {
      const r = await call('GET', '/music/history');
      expect('7. GET → 读回 1 条', r.json?.entries?.length === 1, `实际 ${JSON.stringify(r.json)}`);
      expect(
        '8. GET → 条目内容对得上',
        r.json?.entries?.[0]?.title === '第一首',
        `实际 ${JSON.stringify(r.json?.entries?.[0])}`,
      );
    }

    // ── 9. 幂等：同一首再记 → 还是 1 条，且更新时间变了 ──────────
    {
      const before = (await call('GET', '/music/history')).json?.entries?.[0]?.playedAt;
      await new Promise((r) => setTimeout(r, 5));
      const r = await call('POST', '/music/history', track('t1', '第一首'));
      expect(
        '9. 同一首再记 → 仍是 1 条（不是流水账）',
        (await call('GET', '/music/history')).json?.entries?.length === 1,
        `实际 ${JSON.stringify(r.json)}`,
      );
      const after = (await call('GET', '/music/history')).json?.entries?.[0]?.playedAt;
      expect(
        '10. 同一首再记 → 移到最前 + 更新 playedAt',
        typeof after === 'number' && after >= (before ?? 0),
        `before=${before} after=${after}`,
      );
    }

    // ── 11. 记第二首 → 排在最前 ───────────────────────────────
    {
      await call('POST', '/music/history', track('t2', '第二首'));
      const r = await call('GET', '/music/history');
      expect(
        '11. 记第二首 → 共 2 条',
        r.json?.entries?.length === 2,
        `实际 ${JSON.stringify(r.json)}`,
      );
      expect(
        '12. 最新的在最前',
        r.json?.entries?.[0]?.title === '第二首',
        `实际 ${JSON.stringify(r.json?.entries)}`,
      );
    }

    // ── 13. 脏数据 → entry 为 null（不炸）─────────────────────
    {
      const r = await call('POST', '/music/history', { platform: '', trackId: '' });
      expect(
        '13. 脏数据 → 201 + entry=null（不 500）',
        r.status === 201 && r.json?.entry === null,
        `实际 ${r.status}: ${JSON.stringify(r.json)}`,
      );
    }

    // ── 14. DELETE → 回传删了几条 ─────────────────────────────
    {
      const r = await call('DELETE', '/music/history');
      expect('14. DELETE /music/history → 200', r.status === 200, `实际 ${r.status}`);
      expect('15. DELETE → removed=2', r.json?.removed === 2, `实际 ${JSON.stringify(r.json)}`);
      const after = await call('GET', '/music/history');
      expect(
        '16. DELETE 之后 → 历史为空',
        after.json?.entries?.length === 0,
        `实际 ${JSON.stringify(after.json)}`,
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (networkCalls > 0) {
      console.error(`❌ 测试期间发起了 ${networkCalls} 次真实网络请求`);
      console.error('   记录: ' + JSON.stringify(networkTargets));
      failed++;
    } else {
      console.log('✅ 17. 零真实网络请求（网络陷阱没被触发）');
      passed++;
    }
  }

  console.log(`\n🎉 play-history.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ play-history.controller.e2e 失败:', e);
  process.exit(1);
});
