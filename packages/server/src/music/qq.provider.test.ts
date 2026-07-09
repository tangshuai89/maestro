/**
 * QqMusicProvider 单测：computeGtk（g_tk 的 DJB2 实现）。
 * 运行: npx ts-node packages/server/src/music/qq.provider.test.ts
 *
 * computeGtk 是私有方法，通过 `(prov as any).computeGtk(...)` 直接调。
 * 用例：
 *   - 空字符串 → '5381'（DJB2 of "" = 5381）
 *   - 'a' → '177610'（5381*33 + 97 = 177670；不对……下面用同一公式独立算后断言）
 *   - 'abc' 用同一公式独立算后断言
 *   - '1234567890' 用同一公式独立算后断言
 *
 * 不打网络，纯算法验证。
 */
export {};
const assert = require('node:assert');

import { QqMusicProvider } from './qq.provider';

const prov = new QqMusicProvider();
const gtk = (skey: string): string =>
  (prov as unknown as { computeGtk(s: string): string }).computeGtk(skey);

/**
 * 独立 DJB2 参考实现（与生产代码相同算法；用于在测试里独立算出期望值，
 * 不复制生产代码到测试里——这是 golden test 的标准做法）。
 */
function referenceDjb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ── computeGtk ──────────────────────────────────────────────

assert.strictEqual(gtk(''), '5381', 'DJB2 of "" should be 5381');
assert.strictEqual(
  gtk('a'),
  String(referenceDjb2('a')),
  'single char should match reference',
);
assert.strictEqual(
  gtk('abc'),
  String(referenceDjb2('abc')),
  '"abc" should match reference',
);
assert.strictEqual(
  gtk('1234567890'),
  String(referenceDjb2('1234567890')),
  'numeric string should match reference',
);

// 已知典型 skey 长度（QQ cookie 里的 skey 通常 10 位字母数字）
const skey = 'aB3xY9zQw1';
assert.strictEqual(gtk(skey), String(referenceDjb2(skey)));

// 大字符串不应越界（unsigned 32-bit via >>> 0）
const longSkey = 'a'.repeat(1024);
assert.strictEqual(gtk(longSkey), String(referenceDjb2(longSkey)));

// 中文 skey 也能算
assert.strictEqual(gtk('测试'), String(referenceDjb2('测试')));

console.log('qq.provider.test.ts: all computeGtk assertions passed');