#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Token drift checker — 对比 _tokens.generated.scss 与 Figma 变量 dump
// 用法:
//   node scripts/check-token-drift.mjs scripts/figma-tokens-dump.json
// 退出码: 0 = 一致; 1 = 有 drift（CI 可用）
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dumpPath = process.argv[2];
if (!dumpPath) {
  console.error('用法: node scripts/check-token-drift.mjs <figma-tokens-dump.json>');
  process.exit(2);
}

// 1. Parse generated SCSS tokens
const scssPath = resolve(__dirname, '../packages/renderer/src/styles/base/_tokens.generated.scss');
const scss = readFileSync(scssPath, 'utf8');
const scssTokens = {};
for (const line of scss.split('\n')) {
  const m = line.match(/^\s*--([\w-]+):\s*(.+?);/);
  if (m) scssTokens[m[1]] = m[2].trim();
}

// 2. Parse Figma dump (same format as figma-export-tokens.mjs)
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const vars = Array.isArray(dump) ? dump : dump.variables;

const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
const toCss = (e) => {
  const v = e.value;
  if (e.resolvedType === 'COLOR') {
    const r = hex(v.r), g = hex(v.g), b = hex(v.b);
    const a = v.a ?? 1;
    return a >= 1 ? `#${r}${g}${b}` : `rgba(${Math.round(v.r * 255)}, ${Math.round(v.g * 255)}, ${Math.round(v.b * 255)}, ${Number(a.toFixed(3))})`;
  }
  if (e.resolvedType === 'FLOAT') return `${v}`;
  if (e.name.includes('/ease-') || e.name.startsWith('ease-')) return `${v}`;
  return `${v}`;
};

// Map Figma variable name → CSS custom property name
const toCssName = (figmaName) => {
  const parts = figmaName.split('/');
  const group = parts[0];
  const rest = parts.slice(1).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (group === 'Color') {
    const sub = parts[1];
    if (sub === 'primitive') return `primitive-${parts.slice(2).join('-').toLowerCase()}`;
    return rest;
  }
  if (group === 'Spacing') return `space-${rest}`;
  if (group === 'Radius') return `radius-${rest}`;
  if (group === 'Motion') {
    if (parts[1]?.startsWith('duration-')) return `motion-duration-${parts[1].slice(9)}`;
    if (parts[1]?.startsWith('ease-')) return `ease-${parts[1].slice(5)}`;
    return `motion-${rest}`;
  }
  return rest;
};

const figmaTokens = {};
for (const v of vars) {
  const cssName = toCssName(v.name);
  figmaTokens[cssName] = toCss(v);
}

// 3. Compare
const allKeys = new Set([...Object.keys(scssTokens), ...Object.keys(figmaTokens)]);
const missingInScss = [];
const missingInFigma = [];
const valueMismatch = [];

for (const key of allKeys) {
  if (!(key in scssTokens)) {
    missingInScss.push(key);
  } else if (!(key in figmaTokens)) {
    missingInFigma.push(key);
  } else if (scssTokens[key] !== figmaTokens[key]) {
    valueMismatch.push({ key, scss: scssTokens[key], figma: figmaTokens[key] });
  }
}

// 4. Report
let hasDrift = false;

if (missingInScss.length) {
  hasDrift = true;
  console.error('❌ Figma 有但 SCSS 缺失的 token:');
  for (const k of missingInScss) console.error(`   --${k}: ${figmaTokens[k]}`);
}
if (missingInFigma.length) {
  hasDrift = true;
  console.error('❌ SCSS 有但 Figma 缺失的 token:');
  for (const k of missingInFigma) console.error(`   --${k}: ${scssTokens[k]}`);
}
if (valueMismatch.length) {
  hasDrift = true;
  console.error('❌ 值不一致:');
  for (const m of valueMismatch) console.error(`   --${m.key}: SCSS=${m.scss} vs Figma=${m.figma}`);
}

if (!hasDrift) {
  console.log(`✅ Token 一致（${Object.keys(scssTokens).length} 个 token）`);
  process.exit(0);
} else {
  console.error(`\n共 ${missingInScss.length + missingInFigma.length + valueMismatch.length} 处 drift`);
  console.error('修复: node scripts/figma-export-tokens.mjs scripts/figma-tokens-dump.json');
  process.exit(1);
}
