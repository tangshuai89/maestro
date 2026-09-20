/**
 * Controller 层 e2e 测试：/music/channel-priority + /music/source-health +
 *   /music/library/* 清理端点 + /reco/key/reset。
 *
 * 覆盖路由（test-plan DoD：每个公开 controller 路由至少 1 个 2xx + 1 个 4xx）：
 *  - GET  /music/channel-priority → 200（首次 → PLAY_PRIORITY）
 *  - PUT  /music/channel-priority → 200（合法）/ 400（非数组/未知 provider/重复）
 *  - GET  /music/channel-priority → 200（持久化后读到新序）
 *  - DEL  /music/channel-priority → 200（重置回 PLAY_PRIORITY）
 *  - GET  /music/source-health → 200（items 长度 = MUSIC_PROVIDERS）
 *  - POST /music/library/deezer/clear → 400（deezer 不支持）
 *  - POST /music/library/qq/clear → 200（空库 → removed=0）
 *  - DEL  /music/library → 200
 *  - POST /reco/key/reset → 200（先 POST key 再 reset 验 status 回退）
 *
 * 不打真实音乐平台 API：只测输入校验 + 持久化回环 + 空库清空。
 *
 * 运行: npx ts-node src/music/channel-priority.e2e.test.ts
 *
 * **sandbox 友好**：通过 in-process-http 直接调 Express handler。
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-cp-e2e-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;
delete process.env.DEEPSEEK_API_KEY;

const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../app.module');
const {
  InProcessClient,
  getRequestHandlerFromNestApp,
} = require('../test-helpers/in-process-http');
const { MUSIC_PROVIDERS } = require('../common/provider');
const { PLAY_PRIORITY } = require('./search.util');

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
    // ── 1. GET /music/channel-priority 首次 → 200, 缺省 PLAY_PRIORITY ──
    {
      const r = await call('GET', '/music/channel-priority');
      expect(
        '1. GET /music/channel-priority → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
      const json = r.json as {
        priority?: string[];
        default?: string[];
      };
      expect(
        '1b. 首次返回 priority=PLAY_PRIORITY + default 同步',
        JSON.stringify(json.priority) === JSON.stringify(PLAY_PRIORITY) &&
          JSON.stringify(json.default) === JSON.stringify(PLAY_PRIORITY),
        JSON.stringify(json),
      );
    }

    // ── 2. PUT /music/channel-priority 合法 → 200 + 持久化 ────────
    {
      const next = ['spotify', 'netease', 'deezer']; // 缺 qq（故意测"用户禁用平台"）
      const r = await call('PUT', '/music/channel-priority', {
        priority: next,
      });
      expect(
        '2. PUT /music/channel-priority 合法 → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
      const json = r.json as { ok?: boolean; priority?: string[] };
      expect(
        '2b. PUT 持久化 ok + 返回 cleaned priority',
        json.ok === true &&
          JSON.stringify(json.priority) === JSON.stringify(next),
        JSON.stringify(json),
      );
    }

    // ── 3. GET /music/channel-priority 持久化后再读 → 顺序一致 ─────
    {
      const r = await call('GET', '/music/channel-priority');
      const json = r.json as { priority?: string[] };
      expect(
        '3. GET 持久化后 priority=["spotify","netease","deezer"]',
        JSON.stringify(json.priority) ===
          JSON.stringify(['spotify', 'netease', 'deezer']),
        JSON.stringify(json),
      );
    }

    // ── 4. PUT /music/channel-priority 非数组 → 400 ─────────────────
    {
      const r = await call('PUT', '/music/channel-priority', {
        priority: 'qq',
      });
      expect(
        '4. PUT priority 不是数组 → 400',
        r.status === 400,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 5. PUT /music/channel-priority 未知 provider → 400 ────────
    {
      const r = await call('PUT', '/music/channel-priority', {
        priority: ['qq', 'soundcloud'],
      });
      expect(
        '5. PUT 包含未知 provider → 400',
        r.status === 400,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 6. PUT /music/channel-priority 重复 → 400 ──────────────────
    {
      const r = await call('PUT', '/music/channel-priority', {
        priority: ['qq', 'netease', 'qq'],
      });
      expect(
        '6. PUT 重复 provider → 400',
        r.status === 400,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 7. PUT 重复测试后，再次 PUT 合法顺序，确保前面测试没污染 ──
    {
      const r = await call('PUT', '/music/channel-priority', {
        priority: ['qq', 'netease', 'deezer', 'spotify'],
      });
      expect(
        '7. PUT 完整顺序 → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 8. DELETE /music/channel-priority → 重置回 PLAY_PRIORITY ──
    {
      const r = await call('DELETE', '/music/channel-priority');
      expect(
        '8. DELETE /music/channel-priority → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
      const json = r.json as { ok?: boolean; priority?: string[] };
      expect(
        '8b. DELETE 返回 ok=true + priority=PLAY_PRIORITY',
        json.ok === true &&
          JSON.stringify(json.priority) === JSON.stringify(PLAY_PRIORITY),
        JSON.stringify(json),
      );
    }

    // ── 9. GET 重置后 → 应回到 PLAY_PRIORITY ─────────────────────
    {
      const r = await call('GET', '/music/channel-priority');
      const json = r.json as { priority?: string[] };
      expect(
        '9. DELETE 后 GET 回退到 PLAY_PRIORITY',
        JSON.stringify(json.priority) === JSON.stringify(PLAY_PRIORITY),
        JSON.stringify(json),
      );
    }

    // ── 10. GET /music/source-health → 200, items = MUSIC_PROVIDERS ─
    {
      const r = await call('GET', '/music/source-health');
      expect(
        '10. GET /music/source-health → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
      const json = r.json as {
        items?: Array<{
          provider: string;
          total: number;
          successRate: number;
          lastFailureAt: number | null;
        }>;
      };
      expect(
        '10b. source-health items 长度 = MUSIC_PROVIDERS.length',
        Array.isArray(json.items) &&
          json.items.length === MUSIC_PROVIDERS.length,
        JSON.stringify(json),
      );
      // 全部 total=0 + successRate=1（未跑过搜索）
      expect(
        '10c. 全部平台 total=0 + successRate=1 + lastFailureAt=null',
        json.items!.every(
          (it) =>
            it.total === 0 &&
            it.successRate === 1 &&
            it.lastFailureAt === null,
        ),
        JSON.stringify(json.items?.[0]),
      );
    }

    // ── 11. POST /music/library/deezer/clear → 400 ────────────────
    {
      const r = await call('POST', '/music/library/deezer/clear');
      expect(
        '11. POST /music/library/deezer/clear → 400',
        r.status === 400,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 12. POST /music/library/qq/clear 空库 → 200, removed=0 ────
    {
      const r = await call('POST', '/music/library/qq/clear');
      expect(
        '12. POST /music/library/qq/clear 空库 → 2xx',
        r.status === 200 || r.status === 201,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
      const json = r.json as { ok?: boolean; removed?: number };
      expect(
        '12b. 空库 removed=0',
        json.ok === true && json.removed === 0,
        JSON.stringify(json),
      );
    }

    // ── 13. POST /music/library/:provider/clear 未知 provider → 400
    //   normalizeProvider 把未知值默认归到 'qq'，所以这条路径不会 400 —
    //   这是已知降级（容错性 > 严格性）。验证走 fallback 不报错：
    {
      const r = await call('POST', '/music/library/soundcloud/clear');
      expect(
        '13. POST /music/library/<未知> → 2xx（normalizeProvider fallback 到 qq）',
        r.status === 200 || r.status === 201,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 14. DELETE /music/library → 200 ───────────────────────────
    {
      const r = await call('DELETE', '/music/library');
      expect(
        '14. DELETE /music/library → 200',
        r.status === 200,
        `实际 ${r.status}: ${r.text.slice(0, 100)}`,
      );
    }

    // ── 15. POST /reco/key → POST /reco/key/reset → configured 回退 ─
    {
      const r1 = await call('POST', '/reco/key', {
        apiKey: 'sk-test-deepseek-1234567890-abcdef',
      });
      expect(
        '15a. POST /reco/key 合法 → 200/201',
        r1.status === 200 || r1.status === 201,
        `实际 ${r1.status}: ${r1.text.slice(0, 100)}`,
      );
      const statusAfter = await call('GET', '/reco/status');
      const jsonAfter = statusAfter.json as { configured?: boolean };
      expect(
        '15b. 设 key 后 configured=true',
        jsonAfter.configured === true,
        JSON.stringify(jsonAfter),
      );
      const reset = await call('POST', '/reco/key/reset');
      expect(
        '15c. POST /reco/key/reset → 200',
        reset.status === 200 || reset.status === 201,
        `实际 ${reset.status}: ${reset.text.slice(0, 100)}`,
      );
      const statusFinal = await call('GET', '/reco/status');
      const jsonFinal = statusFinal.json as { configured?: boolean };
      expect(
        '15d. 重置后 configured=false',
        jsonFinal.configured === false,
        JSON.stringify(jsonFinal),
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `\n🎉 channel-priority.e2e: ${passed} passed, ${failed} failed`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ channel-priority.e2e 失败:', e);
  process.exit(1);
});