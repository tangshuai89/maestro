/**
 * dev 模式下 renderer 的实际端口 —— **只读，不猜**。
 *
 * ## 为什么这里不做端口探测
 *
 * 第一版让本文件也跑一遍 lsof 探测，逻辑和 vite 侧写得一模一样，结果实机
 * 直接黑屏：
 *
 *   进程1 vite      启动探测：5273 空闲         → 监听 5273
 *   进程2 electron 稍后探测：5273 已被 vite 占  → 连 5274
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

/**
 * 等 vite 把实际端口写进 `.dev-port`（Phase 11 P11-6）。
 *
 * 为什么需要等：`npm run dev` 里 electron 只比 vite 晚 `sleep 3` 启动，
 * 冷启动 / 慢机器 / vite 依赖重新 optimize 时，3s 内端口文件还没写，
 * 同步的 `devPort()` 只能回退到 DEFAULT_DEV_PORT —— vite 若顺延到
 * 5274+，窗口连到一个没人监听的端口（Phase 10 黑屏的同款形态）。
 *
 * 行为：每 `intervalMs` 读一次端口文件，读到即返回；`timeoutMs` 仍没有 →
 * 兜底 `devPort()`（= RENDERER_PORT > 文件 > 5273 + warn）。显式
 * `RENDERER_PORT` 时立即返回，不等文件（用户指定优先）。
 */
export async function waitForDevPort(
  timeoutMs = 30_000,
  intervalMs = 150,
  read: () => number | null = readPublishedDevPort,
): Promise<number> {
  const explicit = Number(process.env.RENDERER_PORT);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const start = Date.now();
  for (;;) {
    const published = read();
    if (published) return published;
    if (Date.now() - start >= timeoutMs) {
      console.warn(
        `[dev-port] 等 vite 端口文件超时（${timeoutMs}ms），` +
          `回退 ${devPort()}。若窗口连不上，确认 vite 已启动。`,
      );
      return devPort();
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** dev 模式 renderer 的 base URL。 */
export function devRendererUrl(page = ''): string {
  return `http://127.0.0.1:${devPort()}${page}`;
}
