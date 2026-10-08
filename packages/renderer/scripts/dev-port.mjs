/**
 * dev 端口探测（配套 vite.config.ts 的 server.port）。
 *
 * ## 为什么需要
 *
 * vite 遇到端口占用会**静默**换到 5174/5175…（`strictPort: false`），
 * 而 `packages/electron/src/main.ts` 里 dev 模式的 `loadURL` 写死了
 * `http://127.0.0.1:5173`。本机同时跑着别的 5173 前端时，实际后果是：
 * 窗口打开的是**隔壁项目**，而 `/music` `/auth` 请求又经 vite 代理转到
 * 本项目的 3200 —— 页面能渲染、登录态却莫名其妙，几乎无法从现象反推原因。
 *
 * 所以做两件事：
 *  1. 启动前探测占用，给出**明确**的实际端口并打印醒目提示
 *  2. 支持 RENDERER_PORT 显式指定（此时严格照用，占用就报错而非静默改）
 *
 * 全部走 `node:child_process` 的**同步** API —— vite.config.ts 是同步求值，
 * 没法 await。探测只在 dev 启动时跑一次，开销可忽略。
 */
import { execFileSync as realExecFileSync } from 'node:child_process';

export const DEFAULT_DEV_PORT = 5173;
const MAX_TRIES = 50;

/**
 * 实际执行器。测试会通过 `__setExecForTest` 替换掉它 —— 直接 monkey-patch
 * `node:child_process` 无效（ESM import 拿到的是不可变的绑定）。
 */
let exec = realExecFileSync;

/** 仅测试用：替换 lsof 执行器，传 null 还原。 */
export function __setExecForTest(impl) {
  exec = impl ?? realExecFileSync;
}

/** 同步判断本机端口是否已被占用（lsof 不可用时返回 false，交给 vite 兜底）。 */
export function isPortTaken(port) {
  try {
    const out = exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const text = typeof out === 'string' ? out : String(out ?? '');
    if (!text.trim()) return false;
    return text.includes(`:${port}(LISTEN)`) || text.includes(`:${port} `);
  } catch {
    // lsof 没装 / 权限不足：保守返回"未占用"，让 vite 自己去撞墙并给出
    // 它自己的提示（总比误判成被占用、把用户推到去设 RENDERER_PORT 更糟）。
    return false;
  }
}

/** 从 `from` 起向上找第一个空闲端口。 */
export function pickFreePort(from, maxTries = MAX_TRIES) {
  for (let p = from; p < from + maxTries; p++) {
    if (!isPortTaken(p)) return p;
  }
  return from; // 实在找不到就还回起点，交给 vite 报错
}

/** 同步别名：vite.config.ts 用这个（语义更清楚：返回"空闲"）。 */
export function isDevPortFree(port) {
  return !isPortTaken(port);
}
