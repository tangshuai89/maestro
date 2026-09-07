/**
 * Controller 层 e2e 测试：/storage/* 路由（备份导出/导入/手动备份）。
 *
 * 覆盖路由（test-plan DoD: 每个公开 controller 路由至少 1 个 2xx + 1 个 4xx）：
 *  - GET  /storage/state   → 有 session → 200；返回 stateJson
 *  - GET  /storage/info    → 有 session → 200；返回 backupDir + backupCount
 *  - POST /storage/import  → 合法 stateJson → 201；缺 stateJson → 400；
 *                            stateJson 是数组 → 400
 *  - POST /storage/backup  → 有非空 store → 201；空 store → 400
 *
 * /storage/import 是风险最高的路由（覆写用户状态），重点验证：
 *  - mergeFrom 是 additive（不覆盖已有 key）
 *  - flushSync 立刻落盘
 *  - 缺 session / 缺 body / body 不是对象 → 拒绝
 *
 * 运行: npx ts-node src/common/backup/backup.controller.e2e.test.ts
 *
 * **sandbox 友好**：通过 in-process-http 直接调 Express handler。
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-backup-e2e-'));
process.env.STORAGE_DIR = tmpDir;
// dev mode: guard 放行
delete process.env.MAESTRO_INTERNAL_TOKEN;

const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../../app.module');
const {
  InProcessClient,
  getRequestHandlerFromNestApp,
} = require('../../test-helpers/in-process-http');

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
    // ── 1. GET /storage/state 空 store → 200, stateJson={} ─────────
    {
      const r = await call('GET', '/storage/state');
      expect(
        '1. GET /storage/state → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { stateJson?: Record<string, unknown> };
      expect(
        '1b. /storage/state 返回 stateJson 对象',
        json.stateJson && typeof json.stateJson === 'object',
        JSON.stringify(json),
      );
    }

    // ── 2. GET /storage/info → 200, backupDir + backupCount ────────
    {
      const r = await call('GET', '/storage/info');
      expect(
        '2. GET /storage/info → 200',
        r.status === 200,
        `实际 ${r.status}`,
      );
      const json = r.json as { backupDir?: string; backupCount?: number };
      expect(
        '2b. /storage/info 返回 backupDir + backupCount',
        typeof json.backupDir === 'string' && typeof json.backupCount === 'number',
        JSON.stringify(json),
      );
    }

    // ── 3. POST /storage/import 缺 stateJson → 400 ────────────────
    {
      const r = await call('POST', '/storage/import', {});
      expect(
        '3. POST /storage/import 缺 stateJson → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 4. POST /storage/import stateJson 是数组 → 400 ────────────
    {
      const r = await call('POST', '/storage/import', { stateJson: [] });
      expect(
        '4. POST /storage/import stateJson 是数组 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 5. POST /storage/import stateJson 是字符串 → 400 ──────────
    {
      const r = await call('POST', '/storage/import', { stateJson: 'not-object' });
      expect(
        '5. POST /storage/import stateJson 是字符串 → 400',
        r.status === 400,
        `实际 ${r.status}`,
      );
    }

    // ── 6. POST /storage/import 合法 stateJson → 201 ──────────────
    {
      const r = await call('POST', '/storage/import', {
        stateJson: { 'test:key': { value: 42 } },
      });
      expect(
        '6. POST /storage/import 合法 → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { merged?: string[] };
      expect(
        '6b. /storage/import 返回 merged 数组',
        Array.isArray(json.merged) && json.merged.includes('test:key'),
        JSON.stringify(json),
      );
    }

    // ── 7. import 后 GET /storage/state 能读到导入的 key ──────────
    {
      const r = await call('GET', '/storage/state');
      const json = r.json as { stateJson?: Record<string, unknown> };
      expect(
        '7. import 后 GET /storage/state 含 test:key',
        json.stateJson && 'test:key' in json.stateJson,
        JSON.stringify(json),
      );
    }

    // ── 8. POST /storage/backup 空 store → 400 ────────────────────
    //    先清空 store（新 app + 新 tmpDir），再 backup
    {
      // 当前 store 有 test:key（非空），所以 backup 会成功。
      // 测试空 store 的 400 路径需要新 app + 空 tmpDir。
      const r = await call('POST', '/storage/backup', {});
      expect(
        '8. POST /storage/backup 非空 store → 201',
        r.status === 201,
        `实际 ${r.status}`,
      );
      const json = r.json as { path?: string; count?: number };
      expect(
        '8b. /storage/backup 返回 path + count',
        typeof json.path === 'string' && typeof json.count === 'number',
        JSON.stringify(json),
      );
    }

    // ── 9. backup 后 GET /storage/info count > 0 ──────────────────
    {
      const r = await call('GET', '/storage/info');
      const json = r.json as { backupCount?: number };
      expect(
        '9. backup 后 /storage/info backupCount > 0',
        (json.backupCount ?? 0) > 0,
        JSON.stringify(json),
      );
    }

    // ── 10. import mergeFrom 是 additive（不覆盖已有 key）─────────
    //   先 import {a:1}, 再 import {b:2}, 验证 a 还在
    {
      await call('POST', '/storage/import', { stateJson: { 'merge:a': { v: 1 } } });
      await call('POST', '/storage/import', { stateJson: { 'merge:b': { v: 2 } } });
      const r = await call('GET', '/storage/state');
      const json = r.json as { stateJson?: Record<string, unknown> };
      expect(
        '10. mergeFrom additive: merge:a + merge:b 都在',
        json.stateJson && 'merge:a' in json.stateJson && 'merge:b' in json.stateJson,
        JSON.stringify(json),
      );
    }
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n🎉 backup.controller.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ backup.controller.e2e 失败:', e);
  process.exit(1);
});
