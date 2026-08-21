#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — Figma 变量 → SCSS token 导出
// 用法:
//   node scripts/figma-export-tokens.mjs scripts/figma-tokens-dump.json
//   → 生成 packages/renderer/src/styles/base/_tokens.generated.scss
// dump 来源（只读 use_figma，绕过 REST 的 file_variables scope）:
//   figma.variables.getLocalVariables() 解析别名后输出
//   [{ name, resolvedType, value }]（value: 颜色 {r,g,b,a} / 数字 / 字符串）
// 映射约定（与 README 契约一致）:
//   Color/semantic/* → --{kebab}; Color/primitive/* → --primitive-{kebab}
//   Spacing/N → --space-N; Radius/N → --radius-N; Motion/duration-* → --motion-*; Motion/ease-* → --ease-*
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('用法: node scripts/figma-export-tokens.mjs <dump.json>');
  process.exit(2);
}
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const vars = Array.isArray(dump) ? dump : dump.variables;

const hex = (v) => {
  const c = Math.round(v * 255).toString(16).padStart(2, '0');
  return c;
};
const toCss = (e) => {
  // dump 条目格式: { name, resolvedType, value }（value 已解析别名）
  const v = e.value;
  if (e.resolvedType === 'COLOR') {
    const r = hex(v.r), g = hex(v.g), b = hex(v.b);
    const a = v.a ?? 1;
    return a >= 1 ? `#${r}${g}${b}` : `rgba(${Math.round(v.r * 255)}, ${Math.round(v.g * 255)}, ${Math.round(v.b * 255)}, ${Number(a.toFixed(3))})`;
  }
  if (e.resolvedType === 'FLOAT') return `${v}`;
  return `"${v}"`;
};
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[./]/g, '-').toLowerCase();

const lines = [
  '// ============================================================',
  '// AETHER tokens — 由 Figma 变量自动导出（figma-export-tokens.mjs）',
  '// 请勿手改此文件；设计变更后重新导出',
  '// ============================================================',
  ':root {',
];
const groups = { 'Color/semantic': [], 'Color/primitive': [], Spacing: [], Radius: [], Motion: [] };
for (const v of vars) {
  const grp = Object.keys(groups).find((g) => v.name.startsWith(g + '/'));
  if (!grp) continue;
  const key = v.name.slice(grp.length + 1);
  let cssName;
  if (grp === 'Color/semantic') cssName = `--${kebab(key)}`;
  else if (grp === 'Color/primitive') cssName = `--primitive-${kebab(key)}`;
  else if (grp === 'Spacing') cssName = `--space-${key}`;
  else if (grp === 'Radius') cssName = `--radius-${key}`;
  else if (key.startsWith('duration-')) cssName = `--motion-${kebab(key)}`;
  else cssName = `--${kebab(key)}`; // ease-out → --ease-out
  const val = toCss(v);
  const withUnit = (cssName.startsWith('--space-') || cssName.startsWith('--radius-')) && v.resolvedType === 'FLOAT' ? val + 'px' : val;
  groups[grp].push(`  ${cssName}: ${withUnit};`);
}
for (const g of ['Color/primitive', 'Color/semantic', 'Spacing', 'Radius', 'Motion']) {
  lines.push(`  // ---- ${g} ----`);
  lines.push(...groups[g]);
}
lines.push('}');
lines.push('');

const outPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../packages/renderer/src/styles/base/_tokens.generated.scss');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n'));
console.log(`✅ 已生成 ${outPath}（${vars.length} 个变量 → ${lines.length - 2} 行）`);
