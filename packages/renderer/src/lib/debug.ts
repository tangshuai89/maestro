/**
 * 调试开关：URL 加 `?wpsDebug=1` 开启 WPS 详细日志。
 *
 * 开启后，spotify-wps.ts / useSpotifyWpsPlayer.ts / App.tsx / usePlayer.ts
 * 会在关键节点（enabled / tier / SDK ready / connect / fatal error /
 * presentTrack 决策等）输出 `[wps-debug][category]` 前缀的 console 日志，
 * 用于诊断「Premium 账户但仍播 30s」之类 WPS 路径不生效的问题。
 *
 * 关闭：去掉 URL 参数即可（不持久化，每次启动重新生效）。
 *
 * 用法：打开应用时 URL 末尾加 `?wpsDebug=1` 然后重启（或在 SourceSelect
 * 阶段重启一次）。DevTools console 里搜 `wps-debug` 看所有输出。
 */

const params = new URLSearchParams(window.location.search);
const flag = params.get('wpsDebug');
export const isWpsDebug: boolean = flag === '1' || flag === 'true';

let bannered = false;
/** wpsDebug 开启时打一次 banner，让用户知道日志已启用 + 怎么关。 */
export function wpsDebugBanner(): void {
  if (!isWpsDebug || bannered) return;
  bannered = true;
  console.log(
    '%c[wps-debug] 调试日志已启用（?wpsDebug=1）。复制 URL 去掉该参数即可关闭。',
    'color:#0891b2;font-weight:bold',
  );
}

export function wpsLog(category: string, ...args: unknown[]): void {
  if (!isWpsDebug) return;
  console.log(`[wps-debug][${category}]`, ...args);
}

export function wpsWarn(category: string, ...args: unknown[]): void {
  if (!isWpsDebug) return;
  console.warn(`[wps-debug][${category}]`, ...args);
}

export function wpsError(category: string, ...args: unknown[]): void {
  if (!isWpsDebug) return;
  console.error(`[wps-debug][${category}]`, ...args);
}
