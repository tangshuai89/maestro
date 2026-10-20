#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 老稿改造脚本 — use_figma 段代码类型检查
//
// 把 figma-retrofit-plugin.js 的各段模板字符串抽成 .js 桩（@ts-check），
// 用 @figma/plugin-typings 做完整类型校验（枚举 / 结构 / 属性名 / async 用法）。
//
// 与 scripts/figma-v4-typecheck.mjs 的区别：那个脚本检查**手写**的 v4 构建段（硬编码文件清单），
// 这个检查**生成**出来的改造段 —— 生成器最容易出的错是「拼出来的 API 调用拼错了名字」，
// 必须靠类型校验兜住（mock 兜不住 API 拼写）。
//
// 用法:
//   node scripts/figma-retrofit-typecheck.mjs [plugin.js]
// 前置: FIGMA_TYPINGS=/tmp/figma-check/node_modules/@figma/plugin-typings/index.d.ts
// 退出码: 0 = 全部通过; 1 = 有类型错误; 2 = 环境/用法错误
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outDir = process.env.TS_OUT || '/tmp/figma-check/retrofit-segments';
const typings =
  process.env.FIGMA_TYPINGS || '/tmp/figma-check/node_modules/@figma/plugin-typings/index.d.ts';
const tsc = path.join(repo, 'node_modules/.bin/tsc');

const pluginPath = path.resolve(process.argv[2] ?? '/tmp/retrofit-out/figma-retrofit-plugin.js');

if (!existsSync(typings)) {
  console.error(
    `找不到 typings: ${typings}\n先执行: mkdir -p /tmp/figma-check && cd /tmp/figma-check && npm i @figma/plugin-typings --no-audit --no-fund`,
  );
  process.exit(2);
}
if (!existsSync(pluginPath)) {
  console.error(
    `找不到改造脚本: ${pluginPath}\n先生成: node scripts/figma-retrofit-plan-to-plugin.mjs <plan.json> <out.js>`,
  );
  process.exit(2);
}

const mod = require(pluginPath);
const segs = Object.keys(mod);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const tsFiles = [];
for (const seg of segs) {
  const out = path.join(outDir, seg + '.js');
  // JSDoc 断言只在 .js + checkJs 下生效；包 async 函数规避顶层 return（TS1108）
  writeFileSync(
    out,
    `/// <reference path="${typings}" />\n// @ts-check\nexport {};\nasync function __run() {\n${mod[seg]}\n}\n__run();\n`,
  );
  tsFiles.push(out);
}

try {
  execFileSync(
    tsc,
    [
      '--noEmit',
      '--skipLibCheck',
      '--strict',
      'false',
      '--allowJs',
      '--checkJs',
      '--target',
      'es2020',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      ...tsFiles,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  console.log(`✅ ${segs.length} 段全部通过类型检查：${segs.join(', ')}`);
} catch (e) {
  console.log('❌ 类型检查发现错误:\n');
  console.log(e.stdout || e.message);
  process.exit(1);
}
