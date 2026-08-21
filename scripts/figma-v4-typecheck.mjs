#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER v4 — use_figma 段代码类型检查工具
// 把 figma-aether-v4-*.js 的 SEG 模板字符串抽成 .js 桩（@ts-check），
// 用 @figma/plugin-typings 做完整类型校验（含枚举/结构/属性名）。
//
// 前置：npm i @figma/plugin-typings 到可访问目录（默认 /tmp/figma-check）
// 用法：FIGMA_TYPINGS=<path>/index.d.ts node scripts/figma-v4-typecheck.mjs
// 退出码：0 = 全部通过
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outDir = process.env.TS_OUT || '/tmp/figma-check/segments';
const typings = process.env.FIGMA_TYPINGS || '/tmp/figma-check/node_modules/@figma/plugin-typings/index.d.ts';
const tsc = path.join(repo, 'node_modules/.bin/tsc');

if (!existsSync(typings)) {
  console.error(`找不到 typings: ${typings}\n先执行: mkdir -p /tmp/figma-check && cd /tmp/figma-check && npm i @figma/plugin-typings --no-audit --no-fund --cache /tmp/figma-check/.npm-cache`);
  process.exit(2);
}

const files = [
  ['figma-aether-v4-cleanup.js', ['SEG1']],
  ['figma-aether-v4-icons.js', ['SEG1']],
  ['figma-aether-v4-snapshot.js', ['SEG1']],
  ['figma-aether-v4-foundations.js', ['SEG0', 'SEG1', 'SEG2', 'SEG3']],
  ['figma-aether-v4-components.js', ['SEG1', 'SEG2', 'SEG3', 'SEG4']],
  ['figma-aether-v4-screens.js', ['SEG1', 'SEG2', 'SEG3', 'SEG4']],
  ['figma-aether-v4-motion.js', ['SEG1', 'SEG2']],
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const tsFiles = [];
for (const [file, segs] of files) {
  const mod = require(path.join(here, file));
  for (const seg of segs) {
    const out = path.join(outDir, file.replace('.js', '') + '-' + seg + '.js');
    // JSDoc 断言只在 .js + checkJs 下生效；包 async 函数规避顶层 return（TS1108）
    writeFileSync(out, `/// <reference path="${typings}" />\n// @ts-check\nexport {};\nasync function __run() {\n${mod[seg]}\n}\n__run();\n`);
    tsFiles.push(out);
  }
}
try {
  execFileSync(tsc, ['--noEmit', '--skipLibCheck', '--strict', 'false', '--allowJs', '--checkJs', '--target', 'es2020', '--module', 'esnext', '--moduleResolution', 'bundler', ...tsFiles], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`✅ 全部 ${tsFiles.length} 段通过类型检查`);
} catch (e) {
  console.log('❌ 类型检查发现错误:\n');
  console.log(e.stdout || e.message);
  process.exit(1);
}
