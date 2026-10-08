/**
 * dev 模式下 renderer 的实际端口（与 packages/renderer/vite.config.ts 同一套逻辑）。
 *
 * ## 为什么 electron 侧也要知道端口
 *
 * dev 模式主窗口走 `loadURL('http://127.0.0.1:5173')`。vite 撞到端口占用会
 * **静默**换端口，于是窗口打开的是**本机另一个 5173 前端** —— 页面看着正常，
 * 但登录态/播放行为莫名其妙，几乎无法从现象反推。
 *
 * 这里和 vite 用**完全相同**的探测规则，保证两边算出同一个端口：
 *  - `RENDERER_PORT` 显式指定 → 严格照用
 *  - 否则 5173 空闲就用 5173；被占则向上找，并在两边都打印醒目提示
 *
 * ⚠️ 规则必须与 `packages/renderer/scripts/dev-port.mjs` 保持一致。
 * 两边各算一次端口，一旦逻辑漂移就是「vite 在 A、electron 去 B」的玄学问题。
 */
import { execFileSync } from 'node:child_process';

export const DEFAULT_DEV_PORT = 5173;
const MAX_TRIES = 50;

function isPortTaken(port: number): boolean {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!out.trim()) return false;
    return out.includes(`:${port}(LISTEN)`) || out.includes(`:${port} `);
  } catch {
    return false; // lsof 不可用 → 保守当作空闲，交给 vite 自己撞墙
  }
}

/** 解析 dev 端口（同步；electron main 启动时不能 await）。 */
export function devPort(): number {
  const explicit = Number(process.env.RENDERER_PORT);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (!isPortTaken(DEFAULT_DEV_PORT)) return DEFAULT_DEV_PORT;
  for (let p = DEFAULT_DEV_PORT + 1; p < DEFAULT_DEV_PORT + MAX_TRIES; p++) {
    if (!isPortTaken(p)) {
      console.warn(
        `[dev-port] ${DEFAULT_DEV_PORT} 已被占用，renderer 实际使用 ${p}。` +
          `想固定端口：RENDERER_PORT=<端口> npm run dev`,
      );
      return p;
    }
  }
  return DEFAULT_DEV_PORT;
}

/** dev 模式 renderer 的 base URL。 */
export function devRendererUrl(page = ''): string {
  return `http://127.0.0.1:${devPort()}${page}`;
}
