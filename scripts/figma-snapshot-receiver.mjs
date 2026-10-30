#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — 快照接收器（本地 HTTP 服务）
//
// 干什么：接收 Figma 采集插件 POST 过来的快照 JSON，**校验后直接落盘**
//        到 `scripts/figma-snapshot.json`。
//
// 为什么要有这个（2026-10-30 实测）：
//   采集插件原本把 JSON 写进**剪贴板**，靠人肉 `pbpaste > …` 落盘。
//   实测在 Figma 桌面 App 里 `figma.clipboard.writeText` **直接失败**
//   （通知：「剪贴板写入失败，请从 console 复制 JSON」）⇒ 落盘链路断在最后一步。
//   ⇒ 换成 Figma 官方文档明确支持的另一条路：**本地开发服务器**。
//     manifest 的 `networkAccess.devAllowedDomains` 可以写
//     `http://localhost:<port>`（官方原文：「During development, the plugin
//     can access a local/development web server」）⇒ 零配额、零人工。
//
// 为什么不是「改成 showUI + navigator.clipboard」：
//   那条路还要人点按钮 + 人肉粘贴，只是把「复制」换成「复制」。本接收器**一步落盘**。
//
// 安全边界：
//   · 只接受**回环请求**（双栈监听 + 回环白名单）⇒ 局域网访问不到。
//   · 只接受 **POST /snapshot**，且**先校验后写** ⇒ 脏数据进不来。
//   · 落盘用「临时文件 + rename」⇒ 写到一半崩了也不会留下半个坏 JSON。
//
// 用法：
//   node scripts/figma-snapshot-receiver.mjs        # 启动（默认 localhost:4771）
//   FIGMA_SNAPSHOT_PORT=5000 node scripts/figma-snapshot-receiver.mjs
//
// ⚠️ 端口是**单一事实源**：DEFAULT_PORT 在本文件里；
//    插件产物与 manifest 里的域名/端口由 `scripts/figma-collect-plugin.mjs`
//    断言与本文件一致（漂移 ⇒ 生成器报错，不会悄悄生成对不上的插件）。
//
// 关联：scripts/figma-collect-plugin/plugin.src.js（采集插件）
//       · scripts/figma-snapshot-receiver.test.mjs（本文件的反向验证）
//       · docs/figma-contract-write-guide.md
// ─────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 端口的**单一事实源**（插件与 manifest 都必须对上，见文件头）。 */
export const DEFAULT_PORT = 4771;

/** 落盘目标（相对仓库根）。 */
export const SNAPSHOT_REL = 'scripts/figma-snapshot.json';

/** 单次请求体上限 —— 快照现在 ~32KB，给到 32MB 余量，挡住误发的大包。 */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// 校验（纯函数 · 可单独测）
// ─────────────────────────────────────────────────────────────

const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const NODE_ID = /^\d+:\d+$/;

/**
 * 校验一份快照是否值得落盘。
 *
 * ⚠️ 这些不变式与采集插件产出的是同一套（采集插件的测试也断言同样的三条）：
 *   ① counts.X 与数组长度逐一相等
 *      —— components ↔ components[]、screens ↔ screens[]、
 *         **motionEntries ↔ motion.spec[]**（motion 是个**对象**，
 *         条目在 `motion.spec` 里；`motion.rawLength` 是采集到的原始条数，
 *         与 `spec.length` 不是一回事，别拿它对账）
 *   ② capturedAt 是带时区的 ISO 时间戳
 *   ③ 每个节点有 name / nodeId（`数字:数字`）/ type
 *   —— 目的：**别让半截数据覆盖掉仓库里那份好快照**（快照是 figma:diff 的唯一输入，
 *      它坏了后面所有结论都错，而且现场看不出任何异常）。
 *
 * @returns {string[]} 错误列表（空数组 = 通过）
 */
export function validateSnapshot(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return ['顶层不是对象'];
  }
  for (const k of ['pages', 'components', 'screens']) {
    if (!Array.isArray(obj[k])) errors.push(`${k} 不是数组`);
  }
  // motion 是**对象**（{ spec[], version, rawLength }），不是数组。
  if (!obj.motion || typeof obj.motion !== 'object' || Array.isArray(obj.motion)) {
    errors.push('motion 不是对象（应为 { spec[], version, rawLength }）');
  } else if (!Array.isArray(obj.motion.spec)) {
    errors.push('motion.spec 不是数组');
  }
  if (typeof obj.capturedAt !== 'string' || !ISO_TZ.test(obj.capturedAt)) {
    errors.push(`capturedAt 不是带时区的 ISO 时间戳：${JSON.stringify(obj.capturedAt)}`);
  }
  if (typeof obj.fileKey !== 'string' || !obj.fileKey.trim()) {
    errors.push('fileKey 缺失');
  }
  const counts = obj.counts;
  if (!counts || typeof counts !== 'object') {
    errors.push('counts 缺失');
  } else {
    for (const [ck, ak] of [
      ['components', 'components'],
      ['screens', 'screens'],
      ['motionEntries', 'motion.spec'],
    ]) {
      const arr = ak === 'motion.spec' ? obj.motion?.spec : obj[ak];
      if (typeof counts[ck] !== 'number') {
        errors.push(`counts.${ck} 不是数字`);
      } else if (Array.isArray(arr) && counts[ck] !== arr.length) {
        errors.push(`counts.${ck}=${counts[ck]} 与 ${ak}.length=${arr.length} 不一致`);
      }
    }
  }
  for (const ak of ['components', 'screens']) {
    if (!Array.isArray(obj[ak])) continue;
    obj[ak].forEach((n, i) => {
      if (!n || typeof n !== 'object') {
        errors.push(`${ak}[${i}] 不是对象`);
        return;
      }
      if (typeof n.name !== 'string' || !n.name.trim()) errors.push(`${ak}[${i}] 缺 name`);
      if (typeof n.nodeId !== 'string' || !NODE_ID.test(n.nodeId)) {
        errors.push(`${ak}[${i}] nodeId 非法：${JSON.stringify(n.nodeId)}`);
      }
      if (typeof n.type !== 'string' || !n.type.trim()) errors.push(`${ak}[${i}] 缺 type`);
    });
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────
// 格式化（prettier 优先）
// ─────────────────────────────────────────────────────────────

/**
 * 把快照对象格式化成**仓库里 JSON 的统一格式**。
 *
 * ⚠️ 必须过 prettier：仓库的 pre-commit 钩子会对暂存文件跑 `prettier --write`
 *    ⇒ 直接写 `JSON.stringify(obj, null, 2)` 会被钩子改写 ⇒ 产生脏 diff，
 *    而且「我写的」与「钩子写的」字节不同 ⇒ 下次再采集时 diff 会莫名其妙地大。
 *    （实测：JSON.stringify 直出 32787 字节，prettier 格式化后 31721 字节。）
 *
 * @param {object} obj 快照对象
 * @param {string} targetPath 目标文件真实路径（用来取仓库的 prettier 配置）
 * @returns {Promise<string>} 格式化后的文本（自带结尾换行）
 */
export async function formatSnapshot(obj, targetPath) {
  // ⚠️ **必须喂展开形态**（`JSON.stringify(obj, null, 2)`），不能喂紧凑形态：
  //    prettier 有条启发式 ——「对象的首行后面有换行 ⇒ 保持展开」。
  //    喂紧凑 JSON 时所有对象都没有首行换行 ⇒ prettier 会把放得下的对象**压成一行**
  //    ⇒ 输出与仓库里那份（经 pre-commit 钩子 prettier --write 过的）**形状不同**
  //    ⇒ 换一次快照就冒出整片无关 diff。
  //    喂展开形态 ⇒ prettier 保持与仓库现状同款 ⇒ 零无关 diff。
  const raw = JSON.stringify(obj, null, 2);
  try {
    const { default: prettier } = await import('prettier');
    const cfg = (await prettier.resolveConfig(targetPath)) ?? {};
    const out = await prettier.format(raw, { ...cfg, parser: 'json' });
    return out.endsWith('\n') ? out : out + '\n';
  } catch (e) {
    // prettier 不可用（没装依赖 / 解析失败）⇒ 退到直出，但要说清楚。
    console.warn(
      `⚠️ prettier 不可用（${String(e && e.message ? e.message : e)}）` +
        ` ⇒ 用 JSON.stringify 直出；提交时 pre-commit 钩子会再格式化一次。`,
    );
    return JSON.stringify(obj, null, 2) + '\n';
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP 服务
// ─────────────────────────────────────────────────────────────

/**
 * 判断来源地址是不是**回环**（本机）。
 *
 * ⚠️ 为什么需要它：为了让 `http://localhost:4771` 在任何解析顺序下都通，
 *    接收器得**双栈**监听（`::` 同时接 IPv4/IPv6）⇒ 但那样也会把端口开到
 *    局域网上。⇒ 用这个白名单把非回环的请求**拒掉**（403）。
 *
 * @param {string|undefined} addr socket.remoteAddress
 * @returns {boolean}
 */
export function isLoopback(addr) {
  if (!addr) return false;
  const a = String(addr).toLowerCase();
  // ::ffff:127.0.0.1 是 IPv4 映射写法（双栈 socket 看到的 IPv4 客户端）
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

function cors(res) {
  // 插件跑在沙箱 iframe 里（origin 可能是 null）⇒ 必须回 CORS 头才读得到响应。
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  cors(res);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rejectBody(new Error(`请求体超过 ${limit} 字节`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

/**
 * 建接收器（不监听）—— 测试用它拿到 server 自己 listen(port=0)。
 *
 * ⚠️ **默认双栈监听（不指定 host）**：Figma 的 manifest 只认
 *    `http://localhost:<port>`（官方文档的示例写法；**IP 形式会被 manifest
 *    校验器直接拒绝**：「'http://127.0.0.1:4771' must be a valid URL」）。
 *    而 `localhost` 在不同系统/解析顺序下可能落到 `::1` 或 `127.0.0.1`
 *    ⇒ 只绑一个族会时灵时不灵 ⇒ 双栈都接。
 *    代价是端口会开到局域网 ⇒ 由 `isLoopback` 白名单把非回环请求**拒掉**。
 *
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {string} [opts.host] 不传 = 双栈（`::`）
 * @param {string} [opts.target] 落盘绝对路径
 * @param {(msg:string)=>void} [opts.log]
 */
export function createReceiver(opts = {}) {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host; // undefined ⇒ 双栈
  const target = opts.target ?? resolve(ROOT, SNAPSHOT_REL);
  const log = opts.log ?? console.log;

  const server = createServer((req, res) => {
    (async () => {
      // ⚠️ 只放回环请求进来（双栈监听的代价）。
      if (!isLoopback(req.socket?.remoteAddress)) {
        sendJson(res, 403, { ok: false, error: '只接受本机回环请求' });
        return;
      }

      const url = (req.url ?? '').split('?')[0];

      if (req.method === 'OPTIONS') {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, { ok: true, target });
        return;
      }

      if (req.method !== 'POST' || url !== '/snapshot') {
        sendJson(res, 404, { ok: false, error: `未知路由 ${req.method} ${url}` });
        return;
      }

      let raw;
      try {
        raw = await readBody(req);
      } catch (e) {
        sendJson(res, 413, { ok: false, error: String(e && e.message ? e.message : e) });
        return;
      }

      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        sendJson(res, 400, {
          ok: false,
          error: `JSON 解析失败：${String(e && e.message ? e.message : e)}`,
        });
        return;
      }

      const errors = validateSnapshot(obj);
      if (errors.length) {
        // ⚠️ **不落盘**：脏数据绝不能覆盖仓库里那份好快照。
        log(`❌ 快照校验失败（${errors.length} 项），未落盘：`);
        for (const e of errors.slice(0, 10)) log(`   · ${e}`);
        sendJson(res, 400, { ok: false, error: '快照校验失败', errors });
        return;
      }

      const text = await formatSnapshot(obj, target);

      // 原子落盘：先写临时文件再 rename ⇒ 中途崩了不会留半个坏 JSON。
      const tmp = `${target}.tmp`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, target);

      const counts = obj.counts ?? {};
      log(
        `✅ 已落盘 ${target.replace(ROOT + '/', '')}` +
          ` —— 组件 ${counts.components} · 屏 ${counts.screens} · 动效 ${counts.motionEntries}` +
          ` · 采集于 ${obj.capturedAt}`,
      );
      sendJson(res, 200, {
        ok: true,
        target: target.replace(ROOT + '/', ''),
        capturedAt: obj.capturedAt,
        counts,
      });
    })().catch((e) => {
      sendJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
    });
  });

  return { server, port, host, target, log };
}

/** 启动接收器（CLI 模式用）。 */
export function startReceiver(opts = {}) {
  const recv = createReceiver(opts);
  return new Promise((resolveStart, rejectStart) => {
    recv.server.once('error', rejectStart);
    const onReady = () => {
      const addr = recv.server.address();
      const shown = typeof addr === 'object' && addr ? addr.port : recv.port;
      recv.log('');
      recv.log(`📡 AETHER 快照接收器已启动`);
      recv.log(`   监听：http://localhost:${shown}/snapshot`);
      recv.log(`   落盘：${recv.target.replace(ROOT + '/', '')}`);
      recv.log('');
      recv.log('   ⇒ 现在去 Figma 桌面 App：Design 模式 → Plugins → Development →');
      recv.log('     AETHER Snapshot Collector（跑一次就会自动落盘）');
      recv.log('   ⇒ Ctrl-C 退出');
      resolveStart(recv);
    };
    // ⚠️ **不指定 host** ⇒ Node 绑 `::`（双栈）⇒ `localhost` 落到 ::1 或
    //    127.0.0.1 都通（Figma 的 manifest 只认 `http://localhost:<port>`，
    //    IP 形式会被它的校验器拒掉）。非回环请求由 isLoopback 白名单挡掉。
    if (recv.host) recv.server.listen(recv.port, recv.host, onReady);
    else recv.server.listen(recv.port, onReady);
  });
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const port = Number(process.env.FIGMA_SNAPSHOT_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`❌ 端口非法：${process.env.FIGMA_SNAPSHOT_PORT}`);
    process.exit(2);
  }
  startReceiver({ port })
    .then(() => {
      // 端口被占用时给一句人话（EADDRINUSE）。
    })
    .catch((e) => {
      if (e && e.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${port} 已被占用 —— 是不是已经开着一个接收器了？`);
      } else {
        console.error(`❌ 接收器启动失败：${String(e && e.message ? e.message : e)}`);
      }
      process.exit(1);
    });
}
