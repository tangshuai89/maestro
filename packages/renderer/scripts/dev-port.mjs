/**
 * dev 端口的**单一事实来源**。
 *
 * ## 为什么是「vite 写、electron 读」而不是「两边各探测一次」
 *
 * 第一版让 vite 和 electron 各自跑一遍 `lsof` 探测，逻辑写得一模一样 ——
 * 结果实机直接黑屏（ERR_CONNECTION_REFUSED）：
 *
 *   进程1 vite   启动探测：5273 空闲        → 决定监听 5273
 *   进程2 electron 稍后探测：5273 已被 vite 占 → 决定连 5274
 *   → electron 连了个根本没人监听的 5274
 *
 * 两个进程探测的**时间点不同**，同端口在同一时刻的状态就不同，再一致的逻辑
 * 也会漂移。这是设计错误，不是边界情况。
 *
 * 所以：**vite 是权威方**（它才是真正 listen 的那个），启动时把实际端口写进
 * `.dev-port`，electron 读文件。electron 绝不自己猜。
 *
 * 写入是**原子**的（先写临时文件再 rename），避免 electron 读到写了一半的内容。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DEV_PORT = 5273;
const MAX_TRIES = 50;

const HERE = dirname(fileURLToPath(import.meta.url));
/** 端口文件放在 renderer 包根（electron 与 vite 都能定位到）。 */
export const DEV_PORT_FILE = join(HERE, '..', '.dev-port');

let exec = execFileSync;
/** 仅测试用：替换 lsof 执行器，传 null 还原。 */
export function __setExecForTest(impl) {
  exec = impl ?? execFileSync;
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
    // 它自己的提示（总比误判成被占用、把用户逼去设 RENDERER_PORT 更糟）。
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

/** 同步别名：语义更清楚（返回"空闲"）。 */
export function isDevPortFree(port) {
  return !isPortTaken(port);
}

/**
 * 解析 vite 实际会用的端口，并**写进端口文件**。
 *
 * @param configured vite 传给 server.port 的值（可能是 `strictPort:false`
 *        时的首选端口，不保证被采纳）
 * @param actual     vite 实际监听的端口 —— 拿得到就用它，权威
 */
export function resolveAndPublishDevPort(configured, actual) {
  const port =
    typeof actual === 'number' && actual > 0
      ? actual
      : configured || pickFreePort(DEFAULT_DEV_PORT);
  try {
    // 原子写：先写临时文件再 rename，避免 electron 读到写了一半的内容
    const tmp = `${DEV_PORT_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, String(port), 'utf8');
    renameSync(tmp, DEV_PORT_FILE);
  } catch {
    /* 写不进去不致命：electron 还有 RENDERER_PORT / 5273 兜底 */
  }
  return port;
}

/** 读端口文件（electron 用）。读不到返回 null。 */
export function readPublishedDevPort() {
  try {
    if (!existsSync(DEV_PORT_FILE)) return null;
    const n = Number(readFileSync(DEV_PORT_FILE, 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 清掉端口文件（vite 退出时调，避免留下过期值）。 */
export function clearPublishedDevPort() {
  try {
    if (existsSync(DEV_PORT_FILE)) unlinkSync(DEV_PORT_FILE);
  } catch {
    /* ignore */
  }
}
