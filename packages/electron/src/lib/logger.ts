/**
 * Electron main 进程最小 logger。
 *
 * ISSUES.md §3.7: AGENTS.md 主张「日志用 NestJS Logger，不用 console.log」，
 * 但 Electron main 不在 NestJS 进程里——直接用 console 风格 OK，但调用点
 * 应统一走本 logger，便于：
 *   - 集中加 [main] 前缀
 *   - 测试时 mock（单测可替换 logger 收输出）
 *   - 未来切换到 electron-log 时只改这里一处
 *
 * 故意保持简单：现阶段只是 console 的薄包装（带前缀）。不引入 electron-log
 * 依赖，避免给打包链路再加一个 native 模块。
 *
 * ESLint: 本文件是 console.* 的合法封装点——log/debug 是被 no-console 规则
 * 默认禁的，warn/error 是 allowed。每个 console.* 调用前加 disable-next-line，
 * 让本文件成为唯一可豁免点。
 */

const PREFIX = '[main]';

function fmt(args: unknown[]): unknown[] {
  return [PREFIX, ...args];
}

export const logger = {
  /** 流程信息（启动 sidecar / deep link / 路径变更等）。 */
  log(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.log(...fmt(args));
  },
  /** 非致命异常（重试可恢复 / 兜底分支）。 */
  warn(...args: unknown[]): void {
    console.warn(...fmt(args));
  },
  /** 致命 / 用户可见错误。 */
  error(...args: unknown[]): void {
    console.error(...fmt(args));
  },
  /** 调试级（生产默认隐藏，dev 可通过 ELECTRON_ENABLE_VERBOSE=1 打开）。 */
  debug(...args: unknown[]): void {
    if (process.env.ELECTRON_ENABLE_VERBOSE !== '1') return;
    // eslint-disable-next-line no-console
    console.log(...[PREFIX, '[debug]', ...args]);
  },
};
