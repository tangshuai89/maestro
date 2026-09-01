/**
 * In-process HTTP client for e2e tests.
 *
 * Why this exists:
 *   `app.listen(0)` opens a real TCP socket on 0.0.0.0 / ephemeral port.
 *   On sandboxed CI (no NET_BIND_SERVICE) that throws EPERM and aborts
 *   the whole `npm test` run. We don't need real sockets — we just need
 *   to drive the Express app through its handler function.
 *
 * What it does:
 *   - Takes the request handler extracted from `app.getHttpServer()`
 *     (the express `(req, res, next) => void` registered as 'request'
 *     listener on the underlying http.Server).
 *   - Constructs a fake `IncomingMessage` + `ServerResponse` and calls
 *     the handler directly. No socket, no listen(), no EPERM.
 *   - Emits `data` / `end` on the fake req so body-parser / cookie-parser
 *     actually run.
 *   - Intercepts `res.write` / `res.end` to collect the body (the
 *     internal `_writeRaw` never flushes without a real socket).
 *   - Returns `{ status, headers, json(), text() }` mirroring `fetch`.
 *
 * Limitations:
 *   - Streaming responses (chunked / SSE) are read fully into memory.
 *     OK for our controllers — none stream.
 *   - No keep-alive / pipelining (we don't use them in tests).
 *   - Cookies sent via res.setHeader('set-cookie', ...) are captured
 *     in `headers['set-cookie']`. Use `InProcessClient` for jar behaviour.
 *
 * Compatible with:
 *   - Express 4 (NestJS platform-express default).
 *   - cookie-parser: registered via `app.use(cookieParser(secret))`
 *     before `app.init()`.
 *   - body-parser / JSON middleware: pass `body` as object/string with
 *     the appropriate Content-Type header.
 */
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';

export interface InProcessRequest {
  method: string;
  /** Path with optional query, e.g. `/music/like/merged` or `/x?a=1`. */
  url: string;
  headers?: Record<string, string>;
  body?: string | object;
}

export interface InProcessResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: () => unknown;
  text: () => string;
}

/**
 * Minimal socket stand-in. `http.ServerResponse` requires `req.socket`
 * to exist but doesn't actually push bytes to it — we just need the
 * shape so internal node code doesn't crash.
 */
class DummySocket extends EventEmitter {
  remoteAddress = '127.0.0.1';
  remotePort = 12345;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(_b?: any, _e?: any, cb?: () => void): boolean { if (cb) cb(); return true; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  end(_b?: any, _e?: any, cb?: () => void): DummySocket { if (cb) cb(); return this; }
  destroy(): void { /* no-op */ }
  unref(): this { return this; }
  ref(): this { return this; }
  setKeepAlive(): this { return this; }
  setNoDelay(): this { return this; }
  setTimeout(): this { return this; }
}

/**
 * Build a fake IncomingMessage that satisfies what Express + body-parser
 * + cookie-parser need: `method`, `url`, `headers`, a socket reference.
 * Emits `data` + `end` so body-parser actually sees a body. (Using
 * Readable.push alone doesn't trigger emit because no consumer has
 * called .read() — body-parser attaches via stream.on('data', ...) which
 * does trigger emit, so emitting manually works.)
 */
function makeReq(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any {
  const dummyReq = new Readable({ read() { /* drain */ } });
  const req: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any = dummyReq;
  req.method = method;
  req.url = url;
  // HTTP headers are case-insensitive; Node lowercases them on the wire.
  // Normalize here so callers can use either form.
  const normHeaders: Record<string, string> = { host: '127.0.0.1' };
  for (const [k, v] of Object.entries(headers)) {
    normHeaders[k.toLowerCase()] = v;
  }
  req.headers = normHeaders;
  req.socket = new DummySocket();
  req.connection = req.socket;
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  // Body-parser expects content-length when the header is present. Set it
  // automatically when caller passes a body but forgot to set the header.
  if (body !== undefined && req.headers['content-length'] === undefined) {
    req.headers['content-length'] = String(Buffer.byteLength(body));
  }
  return { req, body };
}

/**
 * The 'request' listener registered by NestJS's http adapter.
 * It's the express app's `(req, res, next) => void` function.
 */
type RequestHandler = // eslint-disable-next-line @typescript-eslint/no-explicit-any
(req: any, res: any) => void;

/**
 * Send a request through the express handler and collect the response.
 *
 * Returns when `res.end()` is called by the handler. Body bytes are
 * collected by intercepting `res.write` / `res.end` (since the internal
 * `_writeRaw` never flushes without a real socket).
 */
export function inProcessRequest(
  handler: RequestHandler,
  req: InProcessRequest,
): Promise<InProcessResponse> {
  const { method, url, headers = {}, body } = req;
  const bodyStr =
    body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const { req: fakeReq } = makeReq(method, url, headers, bodyStr);
    // Node 22's ServerResponse constructor takes only (req). Internally
    // it grabs `req.socket` and uses it as the connection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = new http.ServerResponse(fakeReq);

    const chunks: Buffer[] = [];
    // Intercept write/end so we can capture the body. Internal node code
    // ultimately calls these on its way to flushing, so hooking here works
    // regardless of whether the underlying socket is real.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.write = function (chunk: any, ..._rest: any[]): boolean {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return true;
    };
    res.end = function (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chunk?: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ..._rest: any[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      // setImmediate so any post-end bookkeeping (cookieParser's res.end
      // chain, NestJS' exception filters) finishes first.
      setImmediate(() => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.getHeaders() as Record<string, string | string[] | undefined>,
          json: () => {
            try {
              return JSON.parse(text);
            } catch {
              throw new Error(
                `Not JSON: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`,
              );
            }
          },
          text: () => text,
        });
      });
      return res;
    };

    try {
      handler(fakeReq, res);
    } catch (err) {
      reject(err);
      return;
    }

    // Emit body after the handler has had a chance to attach 'data'
    // listeners (body-parser does this synchronously inside the middleware).
    if (bodyStr !== undefined) {
      fakeReq.emit('data', Buffer.from(bodyStr));
    }
    fakeReq.emit('end');
  });
}

/**
 * Convenience: extract the request handler from a NestJS app's underlying
 * http.Server. The handler is the single 'request' listener that
 * platform-express registers.
 */
export function getRequestHandlerFromNestApp(app: // eslint-disable-next-line @typescript-eslint/no-explicit-any
any): RequestHandler {
  const server = app.getHttpServer();
  const listeners = server.listeners('request') as RequestHandler[];
  if (listeners.length === 0) {
    throw new Error('No request listener registered on http.Server');
  }
  return listeners[0];
}

/**
 * Cookie-jar helper built on top of `inProcessRequest`. Tracks
 * `set-cookie` across calls so a single session stays consistent across
 * multiple requests — mirrors what the renderer used to do with the
 * real HTTP client.
 */
export class InProcessClient {
  private cookie = '';
  constructor(private readonly handler: RequestHandler) {}

  async call(
    method: string,
    pathname: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<InProcessResponse> {
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(extraHeaders ?? {}),
    };
    const r = await inProcessRequest(this.handler, {
      method,
      url: pathname,
      headers: reqHeaders,
      body: body === undefined ? undefined : (body as object),
    });
    const sc = r.headers['set-cookie'];
    if (sc) {
      const first = Array.isArray(sc) ? sc[0] : sc;
      // Keep just `name=value`, drop the rest of the attributes.
      this.cookie = first.split(';')[0];
    }
    return r;
  }
}
