/**
 * ConfigService.rendererOrigins 测试（Phase 11 P11-5）。
 * 运行: npx ts-node packages/server/src/common/config.test.ts
 *
 * 覆盖：
 *  - 派生区间覆盖 MAX_TRIES=50 全段（5273–5322）
 *  - RENDERER_ORIGINS env 是追加而非替换（不能架空避让区间）
 *  - 区间外端口（5323+）仍被拒绝
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */

// ConfigService 在字段初始化时读 env —— 必须在 require 之前设好。
process.env.RENDERER_ORIGINS = 'http://127.0.0.1:5273';
process.env.STORAGE_DIR = require('node:os').tmpdir() + '/maestro-config-test';

const { ConfigService } = require('./config');

const c = new ConfigService();
const has = (o: string): boolean => c.rendererOrigins.includes(o);

// env 只配了 5273，但顺延端口必须仍然放行（env 是追加不是替换）
assert.ok(has('http://127.0.0.1:5274'), 'env=5273 时 5274 仍须放行');
assert.ok(has('http://localhost:5274'), 'localhost 变体同步放行');
assert.ok(has('http://localhost:5300'), '顺延中段 5300 放行');
assert.ok(has('http://127.0.0.1:5322'), '顺延上限 5322 放行（5273+49）');
assert.ok(has('http://127.0.0.1:5273'), 'env 自己的条目也在');
assert.ok(!has('http://127.0.0.1:5323'), '区间外 5323 拒绝');
assert.ok(!has('https://evil.example.com'), '无关 origin 拒绝');
console.log('✅ RENDERER_ORIGINS 追加合并 + 5273–5322 全段覆盖');
