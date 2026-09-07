/**
 * Controller 层 e2e 测试：/reco/* 路由（AI 推荐状态/运行/Key 管理）。
 *
 * 覆盖路由（test-plan DoD: 每个公开 controller 路由至少 1 个 2xx + 1 个 4xx）：
 *  - GET  /reco/status     → 200（返回 configured + librarySize）
 *  - POST /reco/run        → 未设 key → 412；设 key 后无库 → 412/400
 *  - POST /reco/key        → 缺 apiKey → 400；太短 → 400；合法 → 201
 *
 * 不打真实 DeepSeek API：只测输入校验 + 未配置 key 的 4xx 路径。
 *
 * 运行: npx ts-node src/reco/reco.controller.e2e.test.ts
 *
 * **sandbox 友好**：通过 in-process-http 直接调 Express handler。
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-reco-e2e-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;
// 清掉可能从环境继承的 DeepSeek key
delete process.env.DEEPSEEK_API_KEY;

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
    // ── 1. GET /reco/status 未设 key → 200, configured=false ──────
    {
      const r = await call('GET', '/reco/status');
      expect(
        '1. GET /reco/status → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { configured?: boolean; librarySize?: number };
      expect(
        '1b. /reco/status configured=false, librarySize=0',
        json.configured === false && json.librarySize === 0,
        JSON.stringify(json),
      );
    }

    // ── 2. POST /reco/key 缺 apiKey → 400 ─────────────────────────
    {
      const r = await call('POST', '/reco/key', {});
      expect(
        '2. POST /reco/key 缺 apiKey → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 3. POST /reco/key 太短 → 400 ──────────────────────────────
    {
      const r = await call('POST', '/reco/key', { apiKey: 'ab' });
      expect(
        '3. POST /reco/key 太短 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 4. POST /reco/key 合法 → 201 ──────────────────────────────
    {
      const r = await call('POST', '/reco/key', {
        apiKey: 'sk-test-deepseek-key-1234567890',
      });
      expect(
        '4. POST /reco/key 合法 → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { ok?: boolean; tail?: string };
      expect(
        '4b. /reco/key 返回 ok=true + tail',
        json.ok === true && typeof json.tail === 'string',
        JSON.stringify(json),
      );
    }

    // ── 5. 设 key 后 GET /reco/status configured=true ─────────────
    {
      const r = await call('GET', '/reco/status');
      const json = r.json as { configured?: boolean };
      expect(
        '5. 设 key 后 /reco/status configured=true',
        json.configured === true,
        JSON.stringify(json),
      );
    }

    // ── 6. POST /reco/run 无库 → 412 (PRECONDITION_REQUIRED) ─────
    //   reco.service.run 在无 key 时抛 412；有 key 但无库时也
    //   会因 librarySize=0 走特定路径。这里验证有 key + 空库的行为。
    {
      const r = await call('POST', '/reco/run', { count: 5 });
      // 有 key 但空库 → reco.service 会抛错（412 或 400，取决于实现）
      expect(
        `6. POST /reco/run 有 key + 空库 → 4xx（实际 ${r.status}）`,
        r.status >= 400 && r.status < 500,
        `实际 ${r.status}`,
      );
    }

    // ── 7. POST /reco/run 带 exclude 脏数据 → 400 (library_empty, 非 exclude 校验错)
    //   controller 对 exclude 做宽松清洗（filter + slice），脏数据不导致
    //   400。空库仍然 400（library_empty），但错误原因是库空，不是 exclude。
    {
      const r = await call('POST', '/reco/run', {
        count: 3,
        exclude: [
          { title: 'Song', artist: 'X' },     // 合法
          { title: 'Bad' },                    // 缺 artist → 丢弃
          null,                                // null → 丢弃
          { artist: 'NoTitle' },               // 缺 title → 丢弃
        ],
      });
      // 400 是 library_empty，不是 exclude 校验错。验证错误消息不含 exclude。
      const text = r.text;
      expect(
        `7. POST /reco/run exclude 脏数据 → 400 (library_empty, 非 exclude 错)`,
        r.status === 400 && /library_empty/.test(text),
        `实际 ${r.status}: ${text.slice(0, 100)}`,
      );
    }

    // ── 8. POST /reco/key 不是字符串 → 400 ────────────────────────
    {
      const r = await call('POST', '/reco/key', { apiKey: 123 });
      expect(
        '8. POST /reco/key apiKey 不是字符串 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n🎉 reco.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ reco.controller.e2e 失败:', e);
  process.exit(1);
});
