/**
 * window-options.test.ts — 浮窗构造参数的关键字段守卫。
 *
 * 这些字段直接决定「浮窗能不能压在别的应用上面 / 会不会闪黑 / 会不会被任务栏收走」，
 * 属于回归高危面，用断言钉死。
 *
 * Run: npx ts-node packages/electron/src/desktop-lyrics/window-options.test.ts
 */
export {};
const assert = require('node:assert');
import { overlayWindowOptions } from './window-options';
import { DEFAULT_PREFS, OVERLAY_DEFAULT_SIZE, OVERLAY_MIN_SIZE } from './prefs';

const preload = '/tmp/preload.js';

const fresh = overlayWindowOptions(DEFAULT_PREFS, { preloadPath: preload });
assert.strictEqual(fresh.frame, false, '无边框');
assert.strictEqual(fresh.transparent, true, '透明');
assert.strictEqual(fresh.backgroundColor, '#00000000', '透明底色（否则启动闪黑）');
assert.strictEqual(fresh.hasShadow, false, '透明窗自带阴影会是一坨黑边');
assert.strictEqual(fresh.alwaysOnTop, true, '置顶');
assert.strictEqual(fresh.skipTaskbar, true, '不进任务栏/Dock');
assert.strictEqual(fresh.minimizable, false, '不可最小化');
assert.strictEqual(fresh.maximizable, false, '不可最大化');
assert.strictEqual(fresh.fullscreenable, false, '不可全屏');
assert.strictEqual(fresh.show, false, '等 did-finish-load 再 show，避免空框闪一下');
assert.strictEqual(fresh.width, OVERLAY_DEFAULT_SIZE.width, '无历史 bounds → 默认宽');
assert.strictEqual(fresh.height, OVERLAY_DEFAULT_SIZE.height, '无历史 bounds → 默认高');
assert.strictEqual(fresh.x, undefined, '无历史 bounds → 不指定位置，让 OS 放');
assert.strictEqual(fresh.minWidth, OVERLAY_MIN_SIZE.width);
assert.strictEqual(fresh.minHeight, OVERLAY_MIN_SIZE.height);
assert.strictEqual(fresh.webPreferences?.backgroundThrottling, false, '节流会让歌词切回可见时最多延迟 1s');
assert.strictEqual(fresh.webPreferences?.preload, preload, '走同一个 preload（共享 session/token）');
assert.strictEqual(fresh.webPreferences?.contextIsolation, true, 'contextIsolation 不能关');

const restored = overlayWindowOptions(
  { ...DEFAULT_PREFS, bounds: { x: 120, y: 340, width: 700, height: 180 } },
  { preloadPath: preload },
);
assert.strictEqual(restored.x, 120, '恢复 x');
assert.strictEqual(restored.y, 340, '恢复 y');
assert.strictEqual(restored.width, 700, '恢复宽');
assert.strictEqual(restored.height, 180, '恢复高');

console.log('✓ desktop-lyrics/window-options.test.ts');

// ── 多显示器：历史坐标可能指向一块已经不存在的屏 ───────────────────────────
// 背景：拔掉外接显示器后，desktop-lyrics.json 里的 x:2400 会把窗口丢到一片空白
// 坐标区 —— 用户看不见、点不到，而 skipTaskbar 又让它在窗口列表里也不出现，
// 等于浮窗永久丢失。clampToVisibleDisplay 就是拦这一下的。

const inScreen = { x: 120, y: 340, width: 700, height: 180 };
const offScreen = { x: 2400, y: 80, width: 700, height: 180 };

// ① 坐标落在某块屏的 workArea 内 → 原样保留（含 clamp 自己的返回）
{
  let seen: unknown = null;
  const clamped = overlayWindowOptions(
    { ...DEFAULT_PREFS, bounds: inScreen },
    {
      preloadPath: preload,
      clampToVisibleDisplay: (b) => {
        seen = b;
        return b;
      },
    },
  );
  assert.deepStrictEqual(seen, inScreen, '注入的 clamp 拿得到完整 bounds（含尺寸）');
  assert.strictEqual(clamped.x, 120, '可见区域 → x 原样还原');
  assert.strictEqual(clamped.y, 340, '可见区域 → y 原样还原');
  assert.strictEqual(clamped.width, 700, '可见区域 → 宽还原');
}

// ② 所有屏幕之外 → 丢掉位置，但尺寸保留（用户拉过的宽度不该白拉）
{
  const clamped = overlayWindowOptions(
    { ...DEFAULT_PREFS, bounds: offScreen },
    { preloadPath: preload, clampToVisibleDisplay: () => null },
  );
  assert.strictEqual(clamped.x, undefined, '坐标失效 → 不下发 x');
  assert.strictEqual(clamped.y, undefined, '坐标失效 → 不下发 y');
  assert.strictEqual(clamped.width, 700, '坐标失效仍保留历史宽度');
  assert.strictEqual(clamped.height, 180, '坐标失效仍保留历史高度');
}

// ③ 没注入 clamp（单测 / 未来其它调用方）→ 退化为原行为，不静默吞坐标
{
  const noClamp = overlayWindowOptions({ ...DEFAULT_PREFS, bounds: offScreen }, { preloadPath: preload });
  assert.strictEqual(noClamp.x, 2400, '未注入 clamp → 行为不变（不替调用方做决定）');
  assert.strictEqual(noClamp.y, 80);
}

// ④ 无历史 bounds 时不该调用 clamp（没有坐标可校验）
{
  let called = 0;
  overlayWindowOptions(DEFAULT_PREFS, {
    preloadPath: preload,
    clampToVisibleDisplay: (b) => {
      called++;
      return b;
    },
  });
  assert.strictEqual(called, 0, 'bounds=null 时不该白跑一次屏幕查询');
}
