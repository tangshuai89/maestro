// Token integrity test — 验证 _tokens.generated.scss 的关键 token 存在且格式正确。
// 这不是视觉回归测试，但能防止 token 文件意外损坏或 drift。
// 完整的 Figma ↔ SCSS drift 检测见 scripts/check-token-drift.mjs。

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scssPath = resolve(__dirname, 'base/_tokens.generated.scss');

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Parse generated SCSS
const scss = readFileSync(scssPath, 'utf8');
const tokens: Record<string, string> = {};
for (const line of scss.split('\n')) {
  const m = line.match(/^\s*--([\w-]+):\s*(.+?);/);
  if (m) tokens[m[1]] = m[2].trim();
}

test('generated tokens file is non-empty', () => {
  assert(Object.keys(tokens).length > 0, 'no tokens parsed');
  assert(Object.keys(tokens).length >= 30, `expected ≥30 tokens, got ${Object.keys(tokens).length}`);
});

test('color semantic tokens present', () => {
  const required = ['accent', 'text-main', 'text-dim', 'glass-fill', 'glass-stroke', 'status-liked'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('color primitive tokens present', () => {
  const required = ['primitive-bg-top', 'primitive-bg-bottom', 'primitive-neon-cyan', 'primitive-heart-red'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('spacing scale present', () => {
  const required = ['space-2', 'space-4', 'space-8', 'space-16', 'space-24', 'space-32'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('radius scale present', () => {
  const required = ['radius-8', 'radius-12', 'radius-24'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('motion tokens present', () => {
  const required = ['motion-duration-fast', 'motion-duration-base', 'ease-out', 'ease-spring'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('platform colors present', () => {
  const required = ['platform-qq', 'platform-netease', 'platform-deezer', 'platform-spotify'];
  for (const k of required) {
    assert(k in tokens, `missing --${k}`);
  }
});

test('color values are valid format', () => {
  for (const [k, v] of Object.entries(tokens)) {
    if (k.startsWith('primitive-') || k === 'accent' || k === 'accent-purple' || k === 'ai' || k === 'text-main' || k.startsWith('status-') || k.startsWith('platform-')) {
      assert(/^#[0-9a-f]{6}$/i.test(v) || /^rgba?\(/.test(v), `--${k} has invalid color: ${v}`);
    }
  }
});

test('spacing values are numeric', () => {
  for (const [k, v] of Object.entries(tokens)) {
    if (k.startsWith('space-')) {
      assert(/^\d+px$/.test(v), `--${k} should be Npx, got ${v}`);
    }
  }
});

console.log('── token integrity tests done ──');
