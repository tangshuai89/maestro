/**
 * 调试开关：开启 WPS 详细日志，定位「Premium 账户但仍卡 30s」之类问题。
 *
 * 开启方式（三选一）：
 *  1. URL 加 `?wpsDebug=1` —— 单次有效
 *  2. DevTools console 跑 `__wpsDebugOn()` / `__wpsDebugOff()` —— 立即生效
 *  3. console 跑 `localStorage.setItem('maestro:debug-wps', '1')` 然后 reload
 *     —— 持久化（所有下次启动都开）
 *
 * 开启后，spotify-wps.ts / useSpotifyWpsPlayer.ts / App.tsx / usePlayer.ts
 * 会在关键节点（enabled / tier / SDK ready / connect / fatal error /
 * presentTrack 决策等）输出 `[wps-debug][category]` 前缀的 console 日志。
 *
 * 关闭：`__wpsDebugOff()` 或 `localStorage.removeItem('maestro:debug-wps')`。
 *
 * 用法：开启后 DevTools console 里搜 `wps-debug` 看所有输出。
 */

const URL_FLAG = '1';
const LS_KEY = 'maestro:debug-wps';

/** 从 URL 或 localStorage 读 isWpsDebug（URL 优先）。 */
export function isWpsDebug(): boolean {
  const params = new URLSearchParams(window.location.search);
  const urlFlag = params.get('wpsDebug');
  if (urlFlag === URL_FLAG || urlFlag === 'true') return true;
  if (urlFlag === '0' || urlFlag === 'false') return false;
  try {
    return localStorage.getItem(LS_KEY) === URL_FLAG;
  } catch {
    return false;
  }
}

let bannered = false;
/** wpsDebug 开启时打一次 banner，让用户知道日志已启用 + 怎么关。 */
export function wpsDebugBanner(): void {
  if (!isWpsDebug() || bannered) return;
  bannered = true;
  console.log(
    '%c[wps-debug] 调试日志已启用。关：__wpsDebugOff() 或 location.href 不带 ?wpsDebug=1',
    'color:#0891b2;font-weight:bold',
  );
}

/**
 * 运行时强制打开（不依赖 URL / localStorage），方便在 DevTools console 临时开。
 * 模块级 isWpsDebug 用函数实现，每次调用都重新判断；此函数强制写 localStorage
 * + reload。
 */
export function __wpsDebugOn(): void {
  try {
    localStorage.setItem(LS_KEY, URL_FLAG);
  } catch {
    /* ignore */
  }
  console.log('[wps-debug] enabled; reloading…');
  location.reload();
}

export function __wpsDebugOff(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  console.log('[wps-debug] disabled; reloading…');
  location.reload();
}

// 暴露到 window 方便 DevTools console 直接调用
if (typeof window !== 'undefined') {
  (window as unknown as { __wpsDebugOn?: () => void }).__wpsDebugOn = __wpsDebugOn;
  (window as unknown as { __wpsDebugOff?: () => void }).__wpsDebugOff = __wpsDebugOff;
}

export function wpsLog(category: string, ...args: unknown[]): void {
  if (!isWpsDebug()) return;
  console.log(`[wps-debug][${category}]`, ...args);
}

export function wpsWarn(category: string, ...args: unknown[]): void {
  if (!isWpsDebug()) return;
  console.warn(`[wps-debug][${category}]`, ...args);
}

export function wpsError(category: string, ...args: unknown[]): void {
  if (!isWpsDebug()) return;
  console.error(`[wps-debug][${category}]`, ...args);
}
