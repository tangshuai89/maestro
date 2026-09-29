/**
 * prefs.test.ts — 桌面歌词偏好的归一化 + 落盘读回。
 *
 * 契约：
 *  1. 坏输入（非对象 / null / 字符串）整体回落 DEFAULT
 *  2. 逐字段兜底：只多一个字段的旧文件不该把其它样式重置
 *  3. fontScale / bounds 越界与非法值被夹紧或丢弃
 *  4. savePrefs → loadPrefs 往返一致；写坏的文件读回默认值
 *
 * Run: npx ts-node packages/electron/src/desktop-lyrics/prefs.test.ts
 */
export {};
const assert = require('node:assert');
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PREFS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  OVERLAY_MIN_SIZE,
  loadPrefs,
  normalisePrefs,
  prefsPath,
  savePrefs,
} from './prefs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'maestro-dl-'));
}

// ── normalisePrefs ─────────────────────────────────────────────────────────

assert.deepStrictEqual(normalisePrefs(null), DEFAULT_PREFS, 'null → 默认');
assert.deepStrictEqual(normalisePrefs('nope'), DEFAULT_PREFS, '字符串 → 默认');
assert.deepStrictEqual(normalisePrefs(undefined), DEFAULT_PREFS, 'undefined → 默认');

const partial = normalisePrefs({ enabled: true, fontScale: 1.4 });
assert.strictEqual(partial.enabled, true, 'enabled 透传');
assert.strictEqual(partial.fontScale, 1.4, 'fontScale 透传');
assert.strictEqual(partial.palette, DEFAULT_PREFS.palette, '缺省 palette 回默认');
assert.strictEqual(partial.locked, DEFAULT_PREFS.locked, '缺省 locked 回默认');
assert.strictEqual(partial.stroke, DEFAULT_PREFS.stroke, '缺省 stroke 回默认');
assert.strictEqual(partial.bounds, null, '缺省 bounds 为 null');

assert.strictEqual(normalisePrefs({ fontScale: 99 }).fontScale, FONT_SCALE_MAX, 'fontScale 上限夹紧');
assert.strictEqual(normalisePrefs({ fontScale: 0 }).fontScale, FONT_SCALE_MIN, 'fontScale 下限夹紧');
assert.strictEqual(normalisePrefs({ fontScale: 'x' }).fontScale, DEFAULT_PREFS.fontScale, '非数字回落默认');
assert.strictEqual(normalisePrefs({ stroke: 'yes' }).stroke, DEFAULT_PREFS.stroke, '非布尔 stroke 回落');
assert.strictEqual(normalisePrefs({ palette: 'neon' }).palette, DEFAULT_PREFS.palette, '未知 palette 回落');
assert.strictEqual(normalisePrefs({ palette: 'cyan' }).palette, 'cyan', '合法 palette 透传');

assert.deepStrictEqual(
  normalisePrefs({ bounds: { x: 10.4, y: 20.6, width: 900, height: 200 } }).bounds,
  { x: 10, y: 21, width: 900, height: 200 },
  'bounds 取整',
);
assert.strictEqual(
  normalisePrefs({ bounds: { x: 1, y: 2, width: 10, height: 10 } }).bounds?.width,
  OVERLAY_MIN_SIZE.width,
  '过小尺寸抬到下限（否则窗口打不开）',
);
assert.strictEqual(
  normalisePrefs({ bounds: { x: 1, y: 2, width: NaN, height: 200 } }).bounds,
  null,
  'NaN 尺寸 → 整个 bounds 丢弃',
);
assert.strictEqual(normalisePrefs({ bounds: 'nope' }).bounds, null, '非对象 bounds → null');

// ── 落盘往返 ──────────────────────────────────────────────────────────────

const dir = tmpDir();
try {
  assert.deepStrictEqual(loadPrefs(dir), DEFAULT_PREFS, '文件不存在 → 默认');

  const saved = { ...DEFAULT_PREFS, enabled: true, locked: true, fontScale: 1.25, palette: 'amber' as const, bounds: { x: 5, y: 6, width: 700, height: 150 } };
  assert.strictEqual(savePrefs(dir, saved), true, 'savePrefs 成功');
  const back = loadPrefs(dir);
  assert.strictEqual(back.enabled, true);
  assert.strictEqual(back.locked, true);
  assert.strictEqual(back.fontScale, 1.25);
  assert.strictEqual(back.palette, 'amber');
  assert.deepStrictEqual(back.bounds, { x: 5, y: 6, width: 700, height: 150 });

  // 手改坏的 JSON → 读回默认而不是抛
  writeFileSync(prefsPath(dir), '{ broken', 'utf-8');
  assert.deepStrictEqual(loadPrefs(dir), DEFAULT_PREFS, '坏 JSON → 默认');

  // 只写了部分字段的旧文件 → 保留已写字段
  writeFileSync(prefsPath(dir), JSON.stringify({ enabled: true }), 'utf-8');
  assert.strictEqual(loadPrefs(dir).enabled, true, '旧文件保留 enabled');
  assert.strictEqual(loadPrefs(dir).palette, DEFAULT_PREFS.palette, '旧文件缺失字段回落默认');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// savePrefs 到不存在的目录：自动建，不炸
const dir2 = join(tmpDir(), 'nested', 'deeper');
try {
  assert.strictEqual(savePrefs(dir2, DEFAULT_PREFS), true, '缺失目录自动创建');
  assert.deepStrictEqual(loadPrefs(dir2), DEFAULT_PREFS, '嵌套目录读回正常');
} finally {
  rmSync(dir2, { recursive: true, force: true });
}

console.log('✓ desktop-lyrics/prefs.test.ts');
