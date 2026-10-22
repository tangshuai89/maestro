/**
 * `proxyAudio` 的**真身**行为测试（2026-10-21）。
 *
 * ## 为什么这个文件存在
 *
 * `music.controller.ts` 的 `proxyAudio`（899-1001）是**所有平台音频流的必经之路**：
 *
 *   renderer <audio src="/music/stream/qq/xxx">
 *     → GET /music/stream/:provider/:trackId
 *       → musicService.getStreamUrl() 拿上游 URL
 *         → proxyAudio() 转发到上游 CDN
 *
 * 而它此前**一行都没被测过**（lcov: 899-1001 连续 102 行未覆盖）。
 * 原因有二，都不是"忘了测"：
 *
 *  1. `music.controller.allowlist.test.ts` 只测了白名单**纯函数**
 *     （`isStreamHostAllowed`）—— 测的是判据，不是调用方。
 *  2. `music.controller.stream.test.ts` 把 `proxyAudio` 的模式**复制到测试里**
 *     跑（该文件头自己写着 "Simulates the post-fix `proxyAudio` pattern"）——
 *     **测的是副本，不是真身**。真身改了，副本照样绿。
 *
 * ## 这块坏了会怎样
 *
 * | 分支                       | 坏了的症状                                       |
 * | -------------------------- | ------------------------------------------------ |
 * | Range 头转发（931-932）    | seek 失效，大 FLAC/MP3 拖不动                     |
 * | 206 部分响应（936/976）    | 拖动进度条直接崩                                 |
 * | CORS 头（967）             | **整个声波环失效**（analyser 读不到样本）        |
 * | 上游 502 + 诊断日志        | 上游挂了只看到 code=4，排查要卡两小时             |
 * | 非音频 content-type 告警   | 运营商拦截页伪装成音频，**静默播不出来**          |
 * | stream error listener      | CDN reset → **Node 整个进程死**（unhandled）     |
 * | `res.on('close')` destroy  | 换歌还在拉上游 quota                             |
 *
 * 它同时是 **SSRF 边界**（防把 controller 当开放代理）。
 *
 * ## 测法：打真身，不打副本
 *
 * - **上游**用本地 http server（真 socket）—— `fetch` 打的是真 URL，
 *   走真实的 undici 响应体路径（`Readable.fromWeb` 的输入）。
 * - **响应**自己收集：Nest 的 `@Res()` 走 `res` 对象，需要能捕获
 *   **流式 chunk**。现成的 `InProcessClient` 明确不支持流式
 *   （"Streaming responses are read fully into memory"）—— 但它会把
 *   `res.write` / `res.end` 拦下来收集字节，**对流式够用**（分块收集），
 *   所以这里复用它的 `inProcessRequest` 思路，但自己实现一个能记录
 *   "写了几次、每次多少字节" 的版本（要断言 Range/206 的分块行为）。
 * - **网络陷阱**：本文件**故意**要出网（打本地 server）→ 不能用
 *   `music.controller.e2e.test.ts` 那种"任何 fetch 就炸"的陷阱。
 *   改用**白名单式陷阱**：只允许打本地 server，其它 URL 一律炸。
 *
 * 运行: npx ts-node src/music/music.controller.proxy-audio.test.ts
 */
export {};
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { Readable } = require('node:stream');

/* eslint-disable @typescript-eslint/no-var-requires */

// ── 临时 storage（别污染真实 state.json）────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-proxy-audio-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;

// ── 断言小工具 ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function expect(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}${detail ? '\n   ' + detail : ''}`);
  }
}

// ── 本地上游（假 CDN）────────────────────────────────────────────────
interface Upstream {
  port: number;
  origin: string;
  close: () => Promise<void>;
  /** 收到过的请求头（用来断言 Range 转发） */
  seenHeaders: Array<Record<string, string | string[] | undefined>>;
}

type UpstreamHandler = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
) => void;

async function startUpstream(handler: UpstreamHandler): Promise<Upstream> {
  const seenHeaders: Array<Record<string, string | string[] | undefined>> = [];
  const srv = http.createServer((req, res) => {
    seenHeaders.push({ ...req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    // ⚠️ listen 失败必须**显式 reject** —— 否则 listen 的 error 回调不触发
    // 时这个 Promise 永远挂着，测试卡到超时（实测踩过：
    // `music.controller.stream.test.ts` 的 hardExit 8s + 零输出）。
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = srv.address() as { port: number };
  return {
    port: addr.port,
    origin: `http://127.0.0.1:${addr.port}`,
    seenHeaders,
    close: () =>
      new Promise<void>((resolve) => {
        srv.closeAllConnections?.();
        srv.close(() => resolve());
      }),
  };
}

// ── 网络陷阱：只允许打本地 server ──────────────────────────────────
//
// 本文件必须能出网（打本地上游），所以不能用 e2e 那种"任何 fetch 就炸"的
// 陷阱。改成**白名单式**：本地 server 放行，其它一律拦下。
//
// ⚠️ 拦下的方式刻意**不是抛异常**，而是**记录 + 抛**：
//   - 只抛的话，SSRF 防护一旦被破坏，测试会死在"打到了 169.254.169.254"这种
//     **网络事故**上，而不是死在"期望 403 实际发了请求"这个**断言**上 ——
//     报错信息指向错的方向，人会先去查网络而不是查防护。
//   - 所以先记进 `blockedRequests`，再抛 —— 断言层能读到"本来不该发的请求
//     列表"，给出准确的失败信息。
const allowedOrigins = new Set<string>();
const blockedRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(String(input));
  if (allowedOrigins.has(url.origin)) {
    return realFetch(input, init);
  }
  blockedRequests.push(url.href);
  throw new Error(`测试里不允许访问非本地上游：${url.href}`);
}) as unknown as typeof globalThis.fetch;

// ── 流式响应收集器 ─────────────────────────────────────────────────
//
// Nest 的 `@Res()` 让 controller 直接操作 express 的 `res`。要断言
// 「上游 206 分块是不是真的分块传下来了」，必须能记录**每次 write 的
// 大小**（而不只是拼起来的总字节）。
//
// ⚠️ **必须用真的 `http.ServerResponse`**，不能手搓一个假对象：
// `proxyAudio` 最后一行是 `upstreamReadable.pipe(res)` —— Node 的
// `Readable.pipe` 要求 dest 是真正的 Writable（会用 `dest.once('drain')`
// / `dest.emit('pipe')` / `dest.on('unpipe')`）。手搓的对象缺 `once` →
// `TypeError: dest.once is not a function`（实测踩过）。
//
// 做法照抄 `test-helpers/in-process-http.ts` 已验证的方案：真 ServerResponse
// + 假 socket，只覆写 `write` / `end` 来捕获字节（内部 `_writeRaw` 没有
// 真 socket 时不会 flush，但我们的覆写已经截住了）。
interface CapturedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  /** 每次 write 的字节数（顺序） */
  writes: number[];
  ended: boolean;
}

/** 最小 socket 替身：`http.ServerResponse` 需要 `req.socket` 存在。 */
class DummySocket extends (require('node:events').EventEmitter as any) {
  remoteAddress = '127.0.0.1';
  remotePort = 12345;
  write(_b?: any, _e?: any, cb?: () => void): boolean {
    if (cb) cb();
    return true;
  }
  end(_b?: any, _e?: any, cb?: () => void): DummySocket {
    if (cb) cb();
    return this;
  }
  destroy(): void {
    /* no-op */
  }
  unref(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  setKeepAlive(): this {
    return this;
  }
  setNoDelay(): this {
    return this;
  }
  setTimeout(): this {
    return this;
  }
}

function makeCapturingRes(): {
  res: any;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = {
    // HTTP 默认状态码是 200 —— 不少 controller 成功路径**不显式**调
    // res.status()（比如 coverProxy 的流式成功路径）。所以初值必须是 200，
    // 否则「没设状态码」会被误判成「状态码是 0」。
    status: 200,
    headers: {},
    body: Buffer.alloc(0),
    writes: [],
    ended: false,
  };
  const chunks: Buffer[] = [];

  // 假 req：ServerResponse 构造时只要 req.socket。
  const fakeReq: any = new (require('node:stream').Readable)({
    read() {
      /* drain */
    },
  });
  fakeReq.method = 'GET';
  fakeReq.url = '/music/stream/qq/test';
  fakeReq.headers = { host: '127.0.0.1' };
  fakeReq.socket = new DummySocket();
  fakeReq.connection = fakeReq.socket;

  const res: any = new (require('node:http').ServerResponse)(fakeReq);

  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const origSetHeader = res.setHeader.bind(res);
  res.write = function (chunk: any, ...rest: any[]): boolean {
    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buf);
      captured.writes.push(buf.length);
    }
    return origWrite(chunk, ...rest);
  };
  res.end = function (chunk?: any, ...rest: any[]): any {
    if (chunk !== undefined && chunk !== null) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buf);
      captured.writes.push(buf.length);
    }
    captured.ended = true;
    captured.body = Buffer.concat(chunks);
    return origEnd(chunk, ...rest);
  };
  // 状态码 / 头：原生 ServerResponse **没有** `status()` / `json()`
  // （那是 express 加的）。所以这里自己实现，不 bind 原生方法。
  res.status = function (code: number) {
    captured.status = code;
    res.statusCode = code;
    return res;
  };
  res.setHeader = function (name: string, value: any) {
    captured.headers[String(name).toLowerCase()] = value;
    origSetHeader(name, value);
    return res;
  };
  // json()：Nest 的 res 是 express 的（带 json），原生没有 → 补一个。
  res.json = function (payload: unknown) {
    captured.headers['content-type'] = 'application/json';
    const buf = Buffer.from(JSON.stringify(payload));
    chunks.push(buf);
    captured.writes.push(buf.length);
    captured.ended = true;
    captured.body = Buffer.concat(chunks);
    return res;
  };

  return { res, captured };
}

/** 触发 res 的 'close'（模拟客户端断开） */
function fireClose(res: any): void {
  res.emit('close');
}

/**
 * 等流式响应真正落完。
 *
 * ⚠️ `proxyAudio` 最后是 `upstreamReadable.pipe(res)` —— pipe 是**异步**的，
 * `await proxyAudio(...)` 返回时数据还在管道里没写出来。所以断言 body 之前
 * 必须等 res 的 'finish' 事件（写完的信号）。
 *
 * 这里同时兜一个超时：万一 pipe 卡住（上游不结束），不能让测试挂死。
 */
function waitForFinish(res: any, captured: CapturedResponse, timeoutMs = 3000): Promise<void> {
  if (captured.ended) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    res.on('finish', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * 走**完整 HTTP 路由**打一个请求（不是直接调 controller 方法）。
 *
 * 用现成的 `getRequestHandlerFromNestApp` 拿 Nest 的 express handler，
 * 自己造 req/res（带流式捕获）→ 覆盖路由层 + 参数解析 + controller 逻辑。
 *
 * 为什么要多这一层：直接调 `controller.proxyAudio()` 只覆盖到「转发」这一步；
 * 路由层的 provider 分支（各平台的 Referer）、`q=` 音质解析、`mm=` 透传
 * 全在 `stream()` 方法里，不走路由就测不到。
 */
async function httpGet(
  handler: (req: any, res: any) => void,
  url: string,
  headers: Record<string, string> = {},
): Promise<CapturedResponse> {
  const { res, captured } = makeCapturingRes();
  const fakeReq: any = new (require('node:stream').Readable)({
    read() {
      /* drain */
    },
  });
  fakeReq.method = 'GET';
  fakeReq.url = url;
  const normHeaders: Record<string, string> = { host: '127.0.0.1' };
  for (const [k, v] of Object.entries(headers)) normHeaders[k.toLowerCase()] = v;
  fakeReq.headers = normHeaders;
  fakeReq.socket = new DummySocket();
  fakeReq.connection = fakeReq.socket;
  fakeReq.httpVersion = '1.1';
  fakeReq.httpVersionMajor = 1;
  fakeReq.httpVersionMinor = 1;

  handler(fakeReq, res);
  await waitForFinish(res, captured);
  return captured;
}

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const cookieParser = require('cookie-parser');
  const { AppModule } = require('../app.module');
  const { MusicController } = require('./music.controller');
  const { MusicService } = require('./music.service');
  const { getRequestHandlerFromNestApp } = require('../test-helpers/in-process-http');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();

  const controller: any = app.get(MusicController);
  const musicService: any = app.get(MusicService);
  const requestHandler = getRequestHandlerFromNestApp(app);

  // ── 桩掉 getStreamUrl：让 controller 拿到我们指定的上游 URL ────────
  //
  // 为什么桩 service 而不是桩 provider：proxyAudio 拿到的 url 来自
  // `musicService.getStreamUrl()`，桩这一层最贴近真实调用形状
  // （provider 层还牵扯 session/quality/mediaMid 一堆参数）。
  let upstreamUrl = '';
  musicService.getStreamUrl = async () => upstreamUrl;

  // ── 1. 成功路径：200 + 完整转发 + CORS 头 ───────────────────────
  {
    const up = await startUpstream((req, res) => {
      const body = Buffer.from('FAKEAUDIOBYTES');
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(body.length),
      });
      res.end(body);
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/test.mp3`;

    const { res, captured } = makeCapturingRes();
    await controller.proxyAudio(
      upstreamUrl,
      { 'User-Agent': 'test' },
      { headers: {} } as any,
      res,
      'qq',
    );
    await waitForFinish(res, captured);

    expect('1. 成功路径：状态码透传 200', captured.status === 200, `实际 ${captured.status}`);
    expect(
      '1. 成功路径：body 完整转发',
      captured.body.toString() === 'FAKEAUDIOBYTES',
      `实际 ${JSON.stringify(captured.body.toString())}`,
    );
    expect(
      '1. 成功路径：CORS 头（声波环靠它读样本）',
      captured.headers['access-control-allow-origin'] === '*',
      `实际 ${JSON.stringify(captured.headers['access-control-allow-origin'])}`,
    );
    expect(
      '1. 成功路径：Content-Type 透传',
      captured.headers['content-type'] === 'audio/mpeg',
      `实际 ${JSON.stringify(captured.headers['content-type'])}`,
    );
    expect(
      '1. 成功路径：Accept-Ranges: bytes（seek 的前提）',
      captured.headers['accept-ranges'] === 'bytes',
      `实际 ${JSON.stringify(captured.headers['accept-ranges'])}`,
    );
    expect(
      '1. 成功路径：Content-Length 透传',
      captured.headers['content-length'] === '14',
      `实际 ${JSON.stringify(captured.headers['content-length'])}`,
    );
    expect('1. 成功路径：响应已结束', captured.ended === true);
    await up.close();
  }

  // ── 2. Range 头转发（seek 的前提）────────────────────────────────
  {
    const up = await startUpstream((req, res) => {
      const body = Buffer.from('PARTIAL');
      res.writeHead(206, {
        'Content-Type': 'audio/mpeg',
        'Content-Range': 'bytes 0-6/100',
        'Content-Length': String(body.length),
      });
      res.end(body);
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/range.mp3`;

    const { res, captured } = makeCapturingRes();
    await controller.proxyAudio(
      upstreamUrl,
      {},
      { headers: { range: 'bytes=0-6' } } as any,
      res,
      'qq',
    );
    await waitForFinish(res, captured);

    expect(
      '2. Range 转发：Range 头送到了上游',
      up.seenHeaders[0]?.range === 'bytes=0-6',
      `上游收到 ${JSON.stringify(up.seenHeaders[0]?.range)}`,
    );
    expect('2. Range 转发：状态码透传 206', captured.status === 206, `实际 ${captured.status}`);
    expect(
      '2. Range 转发：Content-Range 透传',
      captured.headers['content-range'] === 'bytes 0-6/100',
      `实际 ${JSON.stringify(captured.headers['content-range'])}`,
    );
    expect('2. Range 转发：body 完整', captured.body.toString() === 'PARTIAL');
    await up.close();
  }

  // ── 3. 上游 502 → 结构化错误 + 不吞日志 ─────────────────────────
  {
    const up = await startUpstream((req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<html>blocked</html>');
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/denied.mp3`;

    const { res, captured } = makeCapturingRes();
    await controller.proxyAudio(upstreamUrl, {}, { headers: {} } as any, res, 'qq');

    expect('3. 上游失败：状态码 502', captured.status === 502, `实际 ${captured.status}`);
    let body: any = null;
    try {
      body = captured.body.toString() ? JSON.parse(captured.body.toString()) : null;
    } catch {
      body = null;
    }
    expect(
      '3. 上游失败：body 含 error=audio_upstream_failed',
      body?.error === 'audio_upstream_failed',
      `实际 ${JSON.stringify(body)}`,
    );
    expect(
      '3. 上游失败：body 带上游 status（排查要用）',
      body?.status === 403,
      `实际 ${JSON.stringify(body?.status)}`,
    );
    await up.close();
  }

  // ── 4. SSRF 防护：生产模式拒绝非白名单 host ──────────────────────
  //
  // ⚠️ 这一条必须显式设 NODE_ENV=production —— dev 模式是**故意放行**
  // 非白名单 host 的（Bug #4 Level 2：上游 CDN 域名变更不该阻断开发）。
  // 不切 production 就测不到真正的 403 边界。
  //
  // ⚠️ 断言拆成两半（而不是只看状态码）：防护坏掉时，请求会**真的发出去**
  //（目标是云 metadata endpoint 169.254.169.254）→ 被网络陷阱拦下并抛异常。
  // 如果只断言状态码，异常会直接冒出来、测试死在异常上，看不出"是防护坏了"。
  // 所以这里 catch 住异常，再分别断言「403」和「一个请求都没发出去」。
  {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const before = blockedRequests.length;
    try {
      const { res, captured } = makeCapturingRes();
      let threw: unknown = null;
      try {
        await controller.proxyAudio(
          'http://169.254.169.254/latest/meta-data/',
          {},
          { headers: {} } as any,
          res,
          'qq',
        );
      } catch (e) {
        threw = e;
      }
      const leaked = blockedRequests.slice(before);

      expect(
        '4. SSRF 防护：生产模式非白名单 host → 403',
        captured.status === 403,
        `实际 ${captured.status}${threw ? `（并抛出了 ${(threw as Error).message}）` : ''}`,
      );
      let body: any = null;
      try {
        body = captured.body.toString() ? JSON.parse(captured.body.toString()) : null;
      } catch {
        body = null;
      }
      expect(
        '4. SSRF 防护：error=stream_host_not_allowed',
        body?.error === 'stream_host_not_allowed',
        `实际 ${JSON.stringify(body)}`,
      );
      expect(
        '4. SSRF 防护：一个请求都没发出去（防护在 fetch 之前就拦住了）',
        leaked.length === 0,
        `泄漏了 ${leaked.length} 个请求：${JSON.stringify(leaked)}`,
      );
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
    }
  }

  // ── 5. SSRF 防护：白名单 host 放行（纯函数层已测，这里测真身放行）──
  {
    const up = await startUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end('OK');
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/ok.mp3`;

    // 强制走"白名单命中"路径：把本地 host 塞进白名单不方便（private static），
    // 所以这里测的是 dev bypass 放行 —— 同样是"最终发出去了"这个结果。
    const { res, captured } = makeCapturingRes();
    await controller.proxyAudio(upstreamUrl, {}, { headers: {} } as any, res, 'qq');
    expect(
      '5. dev bypass：非白名单 host 放行（本地 host，dev 模式）',
      captured.status === 200,
      `实际 ${captured.status}`,
    );
    await up.close();
  }

  // ── 6. 客户端断开 → destroy upstream（别再拉 quota）──────────────
  {
    let upstreamDestroyed = false;
    const up = await startUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      // 保持连接开着，等客户端断开
      res.write('PARTIAL');
      res.on('close', () => {
        upstreamDestroyed = true;
      });
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/keepalive.mp3`;

    const { res } = makeCapturingRes();
    const p = controller.proxyAudio(upstreamUrl, {}, { headers: {} } as any, res, 'qq');
    // 等一下让 pipe 建立起来
    await new Promise((r) => setTimeout(r, 50));
    fireClose(res);
    await p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    expect(
      '6. 客户端断开：upstream 被 destroy（别再拉 quota）',
      upstreamDestroyed,
      '上游连接未被关闭',
    );
    await up.close();
  }

  // ── 7. 上游中途 reset → 不挂进程（error listener 生效）──────────
  //
  // 这条是**回归护栏**：没有 error listener 时 undici 的 body 抛错 →
  // unhandled → **Node 整个进程死**。测试里表现为进程退出码非 0。
  {
    const up = await startUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.write('HALF');
      // 立刻 destroy socket → 等价于 CDN 突然 reset
      setTimeout(() => res.socket?.destroy(), 10);
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/reset.mp3`;

    const { res, captured } = makeCapturingRes();
    let threw: unknown = null;
    try {
      await controller.proxyAudio(upstreamUrl, {}, { headers: {} } as any, res, 'qq');
    } catch (e) {
      threw = e;
    }
    // 关键：不能抛出未捕获的异常。允许「正常结束」或「被 catch 住」。
    expect(
      '7. 上游 reset：没有未捕获异常冒出来（否则进程会死）',
      threw === null,
      `抛出了 ${(threw as Error)?.message}`,
    );
    await up.close();
  }

  // ── 8. coverProxy：同一套流式结构，同样零覆盖 ─────────────────────
  //
  // `coverProxy`（1093-1161）和 `proxyAudio` 是同一个模式：白名单 → fetch
  // → `Readable.fromWeb(body).pipe(res)` + error listener + close destroy。
  // e2e 里只测到了它的 400/403（缺 url / 非法 url / 非白名单 host），
  // **流式成功路径和 502 完全没测** —— 同样的洞，同样会静默失败。
  //
  // ⚠️ coverProxy 的白名单**没有 dev bypass**（不像 proxyAudio）→ 只能打
  // 白名单内的 host。本地 server 的 127.0.0.1 不在白名单 → 只能测 403 分支；
  // 成功路径要测，就得临时把本地 host 加进白名单（它是 private static，
  // 运行时可改 —— 测试专用，不改生产代码）。
  {
    // ── 8a. 非白名单 host → 403 ────────────────────────────────
    {
      const { res, captured } = makeCapturingRes();
      await controller.coverProxy('https://evil.com/img.jpg', res);
      expect(
        '8a. coverProxy 非白名单 host → 403',
        captured.status === 403,
        `实际 ${captured.status}`,
      );
      let body: any = null;
      try {
        body = captured.body.toString() ? JSON.parse(captured.body.toString()) : null;
      } catch {
        body = null;
      }
      expect(
        '8a. coverProxy 403 带 host（排查要知道是哪个）',
        body?.error === 'host_not_allowed' && body?.host === 'evil.com',
        `实际 ${JSON.stringify(body)}`,
      );
    }

    // ── 8b. 缺 url → 400 / 非法 url → 400 ─────────────────────
    {
      const { res, captured } = makeCapturingRes();
      await controller.coverProxy(undefined, res);
      expect('8b. coverProxy 缺 url → 400', captured.status === 400, `实际 ${captured.status}`);
    }
    {
      const { res, captured } = makeCapturingRes();
      await controller.coverProxy('not-a-url', res);
      expect('8b. coverProxy 非法 url → 400', captured.status === 400, `实际 ${captured.status}`);
    }
    {
      const { res, captured } = makeCapturingRes();
      await controller.coverProxy('file:///etc/passwd', res);
      expect(
        '8b. coverProxy 非 http(s) 协议 → 400',
        captured.status === 400,
        `实际 ${captured.status}`,
      );
    }

    // ── 8c. 白名单内 host → 流式成功路径 ──────────────────────
    //
    // 把本地 host 临时塞进白名单（private static，运行时可改）。
    // 这是测试专用手段 —— 不改生产代码，只是让「白名单命中」这条路径能被驱动。
    {
      const up = await startUpstream((req, res) => {
        const body = Buffer.from('PNGBYTES');
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(body.length),
        });
        res.end(body);
      });
      allowedOrigins.add(up.origin);
      // ⚠️ 白名单存的是**纯 hostname**（`parsed.hostname` 不含端口）
      const host = '127.0.0.1';
      const allowedHosts = (controller.constructor as any).ALLOWED_COVER_HOSTS as Set<string>;
      allowedHosts.add(host);
      try {
        const { res, captured } = makeCapturingRes();
        await controller.coverProxy(`${up.origin}/cover.jpg`, res);
        await waitForFinish(res, captured);

        expect(
          '8c. coverProxy 白名单命中 → 200',
          captured.status === 200,
          `实际 ${captured.status}`,
        );
        expect(
          '8c. coverProxy body 完整转发',
          captured.body.toString() === 'PNGBYTES',
          `实际 ${JSON.stringify(captured.body.toString())}`,
        );
        expect(
          '8c. coverProxy CORS 头（canvas 读像素的前提）',
          captured.headers['access-control-allow-origin'] === '*',
          `实际 ${JSON.stringify(captured.headers['access-control-allow-origin'])}`,
        );
        expect(
          '8c. coverProxy Content-Type 透传',
          captured.headers['content-type'] === 'image/jpeg',
          `实际 ${JSON.stringify(captured.headers['content-type'])}`,
        );
        expect(
          '8c. coverProxy 缓存头（封面 URL 稳定，1h 缓存安全）',
          captured.headers['cache-control'] === 'public, max-age=3600',
          `实际 ${JSON.stringify(captured.headers['cache-control'])}`,
        );
      } finally {
        allowedHosts.delete(host);
        await up.close();
      }
    }

    // ── 8d. 上游 502 → 结构化错误 ─────────────────────────────
    {
      const up = await startUpstream((req, res) => {
        res.writeHead(404);
        res.end('nope');
      });
      allowedOrigins.add(up.origin);
      // ⚠️ 白名单存的是**纯 hostname**（`parsed.hostname` 不含端口）
      const host = '127.0.0.1';
      const allowedHosts = (controller.constructor as any).ALLOWED_COVER_HOSTS as Set<string>;
      allowedHosts.add(host);
      try {
        const { res, captured } = makeCapturingRes();
        await controller.coverProxy(`${up.origin}/missing.jpg`, res);
        expect('8d. coverProxy 上游失败 → 502', captured.status === 502, `实际 ${captured.status}`);
        let body: any = null;
        try {
          body = captured.body.toString() ? JSON.parse(captured.body.toString()) : null;
        } catch {
          body = null;
        }
        expect(
          '8d. coverProxy 502 带上游 status',
          body?.error === 'upstream_failed' && body?.status === 404,
          `实际 ${JSON.stringify(body)}`,
        );
      } finally {
        allowedHosts.delete(host);
        await up.close();
      }
    }
  }

  // ── 9. 端点层：走完整 HTTP 路由（provider 分支 / Referer / 音质解析）──
  //
  // 前面 8 组直接调 `controller.proxyAudio()` —— 覆盖到「转发」这一步。
  // 但**路由层**还有一段没测：provider 分支（各平台各自的 Referer）、
  // `q=` 音质解析（非法值降级 standard）、`mm=` mediaMid 透传。
  // 那一段在 `stream()` 方法里（820-898），不走路由就测不到。
  {
    // 记录 getStreamUrl 收到了什么参数
    const calls: Array<{
      provider: string;
      trackId: string;
      opts?: { mediaMid?: string; quality?: string };
    }> = [];
    musicService.getStreamUrl = async (
      _session: unknown,
      provider: string,
      trackId: string,
      opts?: { mediaMid?: string; quality?: string },
    ) => {
      calls.push({ provider, trackId, opts });
      return upstreamUrl;
    };

    const up = await startUpstream((req, res) => {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end('ROUTEBYTES');
    });
    allowedOrigins.add(up.origin);
    upstreamUrl = `${up.origin}/stream/qq/route.mp3`;

    // ── 9a. qq → Referer y.qq.com + quality 解析 ───────────────
    {
      calls.length = 0;
      const r = await httpGet(requestHandler, '/music/stream/qq/track-1?q=high');
      expect('9a. 端点层：qq 请求成功', r.status === 200, `实际 ${r.status}`);
      expect(
        '9a. 端点层：provider 归一化成 qq',
        calls[0]?.provider === 'qq',
        `实际 ${calls[0]?.provider}`,
      );
      expect(
        '9a. 端点层：q=high 透传给 service',
        calls[0]?.opts?.quality === 'high',
        `实际 ${calls[0]?.opts?.quality}`,
      );
      expect(
        '9a. 端点层：qq 用 y.qq.com 的 Referer',
        up.seenHeaders.at(-1)?.referer === 'https://y.qq.com/',
        `实际 ${up.seenHeaders.at(-1)?.referer}`,
      );
    }

    // ── 9b. 非法 q= → 降级 standard（不是透传垃圾值）──────────
    {
      calls.length = 0;
      await httpGet(requestHandler, '/music/stream/qq/track-2?q=hacked');
      expect(
        '9b. 端点层：非法 q= 降级成 standard',
        calls[0]?.opts?.quality === 'standard',
        `实际 ${calls[0]?.opts?.quality}`,
      );
    }

    // ── 9c. mm= mediaMid 透传 ─────────────────────────────────
    {
      calls.length = 0;
      await httpGet(requestHandler, '/music/stream/qq/track-3?mm=MID123');
      expect(
        '9c. 端点层：mm= 透传给 service',
        calls[0]?.opts?.mediaMid === 'MID123',
        `实际 ${calls[0]?.opts?.mediaMid}`,
      );
    }

    // ── 9d. netease → 用 music.163.com 的 Referer ─────────────
    {
      calls.length = 0;
      await httpGet(requestHandler, '/music/stream/netease/track-4');
      expect(
        '9d. 端点层：netease 用 music.163.com 的 Referer',
        up.seenHeaders.at(-1)?.referer === 'https://music.163.com/',
        `实际 ${up.seenHeaders.at(-1)?.referer}`,
      );
    }

    // ── 9e. deezer / spotify → 各自的 Referer ─────────────────
    {
      await httpGet(requestHandler, '/music/stream/deezer/track-5');
      expect(
        '9e. 端点层：deezer 用 deezer.com 的 Referer',
        up.seenHeaders.at(-1)?.referer === 'https://www.deezer.com/',
        `实际 ${up.seenHeaders.at(-1)?.referer}`,
      );
      await httpGet(requestHandler, '/music/stream/spotify/track-6');
      expect(
        '9e. 端点层：spotify 用 open.spotify.com 的 Referer',
        up.seenHeaders.at(-1)?.referer === 'https://open.spotify.com/',
        `实际 ${up.seenHeaders.at(-1)?.referer}`,
      );
    }

    // ── 9f. 上游抛 401 → 端点层透传 401（不压成 502）──────────
    //
    // 这条在 auth-expired-validate.e2e 里测过一次（真实 provider 抛），
    // 这里用桩复现同一契约 —— 401 必须**原样透传**，否则 renderer 拿到的
    // 是 502 → 只能看到 code=4 → 用户永远看不到"请重新登录"。
    {
      musicService.getStreamUrl = async () => {
        const err: any = new Error('AUTH_EXPIRED');
        err.getResponse = () => ({ error: 'AUTH_EXPIRED', message: '登录已过期' });
        throw err;
      };
      const r = await httpGet(requestHandler, '/music/stream/qq/track-7');
      expect('9f. 端点层：上游 401 → 透传 401', r.status === 401, `实际 ${r.status}`);
      let body: any = null;
      try {
        body = r.body.toString() ? JSON.parse(r.body.toString()) : null;
      } catch {
        body = null;
      }
      expect(
        '9f. 端点层：401 body 带 AUTH_EXPIRED',
        body?.error === 'AUTH_EXPIRED',
        `实际 ${JSON.stringify(body)}`,
      );
    }

    await up.close();
  }

  console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} proxy-audio: ${passed} passed, ${failed} failed`);
  await app.close();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  // ⚠️ **sandbox / 无 NET_BIND_SERVICE 环境必须显式 skip，不能当失败**。
  //
  // 这些测试必须真 socket（要模拟上游 CDN reset / 客户端断连 / Range 206），
  // 绑不上本地端口就没法跑。`music.controller.stream.test.ts` 在 CI 上就踩过
  // 这个坑（EPERM → 当时靠 hardExit 兜底 exit 1 + 零输出，把 test.sh 整段
  // 掐断 —— electron/renderer 测试因此永远跑不到）。
  //
  // 所以：**显式 skip + 干净退出 0**。不 skip 的话，CI 上这个文件一失败，
  // server 段就红了 —— 而它红了不代表代码有问题，只代表环境没权限。
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? '';
  if (code === 'EPERM' || code === 'EACCES' || /EPERM|EACCES/.test(msg)) {
    console.log(
      '⚠️ skip: 当前环境无 bind 端口权限（EPERM/EACCES），' +
        'proxy-audio / coverProxy 语义测试跳过；CI 有权限时正常执行',
    );
    process.exit(0);
  }
  console.error('\n❌ 失败:', e);
  process.exit(1);
});
