/**
 * dev 模式下 renderer 的实际端口 —— **只读，不猜**。
 *
 * ## 为什么这里不做端口探测
 *
 * 第一版让本文件也跑一遍 lsof 探测，逻辑和 vite 侧写得一模一样，结果实机
 * 直接黑屏：
 *
 *   进程1 vite      启动探测：5173 空闲         → 监听 5173
 *   进程2 electron 稍后探测：5173 已被 vite 占  → 连 5174
 *   → ERR_CONNECTION_REFUSED，白屏/黑屏
 *
 * 两个进程探测的**时间点不同**，同一端口在不同时刻状态就不同；逻辑再一致也
 * 会漂移。所以 electron 侧**绝不自己猜**。
 *
 * 现在：vite（真正 listen 的那个）是权威方，启动时把实际端口原子写进
 * `packages/renderer/.dev-port`，本文件只读它。
 *
 * 优先级：
 *   1. `RENDERER_PORT` 环境变量（用户显式指定，最高优先）
 *   2. `.dev-port` 文件（vite 发布的实际端口）
 *   3. 5273 兜底（vite 没发布时的最后手段）
 *
 * 拿不到就退 3，并在日志里**明确提示**"没读到端口文件，窗口可能连不上" ——
 * 宁可让用户看到一句提示，不要静默连错端口。
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'path';

export const DEFAULT_DEV_PORT = 5273;

/** vite 发布端口文件的位置（packages/renderer/.dev-port）。 */
function portFilePath(): string {
  // 打包/编译后 __dirname = packages/electron/dist，故向上两级到包根再进 renderer。
  // src/ 运行时 __dirname = packages/electron/src，同样向上两级 → packages/。
  return path.resolve(__dirname, '..', '..', 'renderer', '.dev-port');
}

/** 读 vite 发布的实际端口；读不到返回 null。 */
export function readPublishedDevPort(): number | null {
  try {
    const f = portFilePath();
    if (!existsSync(f)) return null;
    const n = Number(readFileSync(f, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 解析 dev 端口。同步（electron main 启动时不能 await）。 */
export function devPort(): number {
  const explicit = Number(process.env.RENDERER_PORT);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const published = readPublishedDevPort();
  if (published) return published;
  console.warn(
    `[dev-port] 读不到 vite 发布的端口文件（${portFilePath()}），` +
      `回退到 ${DEFAULT_DEV_PORT}。若窗口黑屏/连不上，检查 renderer 是否已启动。`,
  );
  return DEFAULT_DEV_PORT;
}

/** dev 模式 renderer 的 base URL。 */
export function devRendererUrl(page = ''): string {
  return `http://127.0.0.1:${devPort()}${page}`;
}
