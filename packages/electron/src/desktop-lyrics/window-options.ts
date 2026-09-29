import type { BrowserWindowConstructorOptions } from 'electron';
import {
  OVERLAY_DEFAULT_SIZE,
  OVERLAY_MIN_SIZE,
  type DesktopLyricsBounds,
  type DesktopLyricsPrefs,
} from './prefs';

/**
 * 桌面歌词浮窗的 BrowserWindow 配置（纯函数，便于单测断言关键字段）。
 *
 * 关键取舍：
 * - `transparent: true` + `frame: false`：浮窗没有自己的背景/标题栏，文字直接压在桌面上。
 *   macOS 上透明窗口必须 `backgroundColor: '#00000000'` 才不会启动闪一下黑。
 * - `alwaysOnTop` 在 create 时给基础档，main 进程建完窗口再用
 *   `setAlwaysOnTop(true, 'screen-saver')` 升档 —— 这是唯一能压过全屏应用的档位，
 *   构造参数里给不了 level。
 * - `skipTaskbar` / `minimizable:false` / `maximizable:false`：浮窗不是"窗口"，不该出现在
 *   窗口列表里被用户切走。
 * - `backgroundThrottling: false`：浮窗不可见时 Chromium 会把定时器压到 1Hz，
 *   切回可见会有最多 1s 的歌词延迟 —— 歌词显示不能有这个抖动。
 * - `x/y` 只在有历史 bounds 时给：首次开窗让 Electron 按平台默认位置放（居中偏下）。
 *   但历史坐标**不保证还看得见** —— 拔掉外接显示器后 x:2400 会把窗口丢到一片空白区，
   而 `skipTaskbar` 又让用户没法从窗口列表捞回来，等于永久丢失浮窗。
   所以位置过一道 `deps.clampToVisibleDisplay`（main 侧用 `screen.getAllDisplays()` 实现），
   它返回 null = 坐标已失效 → 丢弃位置、**尺寸仍然沿用**（用户拉过的宽度不是白拉的），
   交给 OS 重新摆。未注入该依赖时退化为原行为，纯函数单测才能独立跑。
 */
export function overlayWindowOptions(
  prefs: DesktopLyricsPrefs,
  deps: {
    preloadPath: string;
    /**
     * 校验历史坐标是否还落在某个可见显示器上。返回 null = 坐标已失效（显示器被拔掉），
     * 此时丢弃 x/y、保留尺寸。缺省则不做校验。
     */
    clampToVisibleDisplay?: (b: DesktopLyricsBounds) => DesktopLyricsBounds | null;
  },
): BrowserWindowConstructorOptions {
  const b: DesktopLyricsBounds | null = prefs.bounds;
  const size = b
    ? { width: b.width, height: b.height }
    : { width: OVERLAY_DEFAULT_SIZE.width, height: OVERLAY_DEFAULT_SIZE.height };
  // 位置与尺寸分开处理：坐标失效只丢位置，不牵连用户拉过的宽高。
  const pos = b && deps.clampToVisibleDisplay ? deps.clampToVisibleDisplay(b) : b;

  return {
    width: size.width,
    height: size.height,
    ...(pos ? { x: pos.x, y: pos.y } : {}),
    minWidth: OVERLAY_MIN_SIZE.width,
    minHeight: OVERLAY_MIN_SIZE.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Maestro 桌面歌词',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: deps.preloadPath,
      backgroundThrottling: false,
      // 浮窗只渲染文字，关掉一堆没必要的能力
      spellcheck: false,
    },
  };
}
