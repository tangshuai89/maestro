#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — Figma 变量 → SCSS token 导出
// 用法:
//   node scripts/figma-export-tokens.mjs scripts/figma-tokens-dump.json
//   node scripts/figma-export-tokens.mjs <dump.json> --out /tmp/x.scss   # 写到别处
//   node scripts/figma-export-tokens.mjs <dump.json> --stdout            # 打到 stdout
//   默认输出: packages/renderer/src/styles/base/_tokens.generated.scss
// dump 来源（只读 use_figma，绕过 REST 的 file_variables scope）:
//   figma.variables.getLocalVariables() 解析别名后输出
//   [{ name, resolvedType, value }]（value: 颜色 {r,g,b,a} / 数字 / 字符串）
// 也可用 REST 直接拉: node scripts/figma-tokens-pull.mjs --write
//
// 映射实现在 scripts/lib/aether-tokens.mjs —— 与比对脚本共用同一份，
// 不要再在本文件里另写一份映射（历史上两套映射导致比对永久假 FAIL）。
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScss, djb2 } from './lib/aether-tokens.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const dumpPath = argv.find((a) => !a.startsWith('--') && a !== flag('--out'));
if (!dumpPath) {
  console.error('用法: node scripts/figma-export-tokens.mjs <dump.json> [--out <path>] [--stdout]');
  process.exit(2);
}
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const vars = Array.isArray(dump) ? dump : dump.variables;

const { css, unmapped } = renderScss(vars);

if (argv.includes('--stdout')) {
  process.stdout.write(css);
} else {
  const wanted = flag('--out');
  const outPath = typeof wanted === 'string'
    ? path.resolve(wanted)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/renderer/src/styles/base/_tokens.generated.scss');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, css);
  const cssVarCount = css.split('\n').filter((l) => /^\s+--[\w-]+:/.test(l)).length;
  console.log(`✅ 已生成 ${outPath}（${vars.length} 个变量 → ${cssVarCount} 个 token，hash ${djb2(css)}）`);
}
if (unmapped.length) {
  console.error(`⚠️  ${unmapped.length} 个变量不属于 AETHER token 体系，已跳过: ${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? ' …' : ''}`);
}
