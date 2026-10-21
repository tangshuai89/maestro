/**
 * api.real.test.ts — **真** api.ts 的测试（不 mock api.ts 本身）。
 *
 * ## 为什么单独开一个文件
 *
 * renderer 现有的所有测试都用 `vi.mock('../api')` 把 api.ts **整个换掉** ——
 * 于是 api.ts 里那些**真正发请求的代码**一行都没被执行过：
 * `fetchWithToken`（token 注入 / credentials）、`json()`（错误体 → AuthError）、
 * 以及每个 API 函数的 URL / method / body 拼装。
 *
 * 后果：api.ts 的行覆盖只有 49.6%，而且**最要紧的那段（所有 renderer→server
 * 调用的必经之路）完全没测**。URL 拼错、token 没注入、401 变成 AUTH_UNKNOWN
 * 而不是 AUTH_EXPIRED —— 这类 bug 现有测试一个都抓不到。
 *
 * 本文件**不 mock api.ts**，只 stub `globalThis.fetch`，让真身跑起来。
 *
 * ## 注意
 *
 * `API_ORIGIN` 是**模块加载时**的快照（见 api.ts 的 resolveApiOrigin 注释），
 * 所以 `window.electronAPI` 必须在 import 之前摆好 → 这里用**动态 import**。
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── 先摆好 electronAPI，再动态 import 真 api.ts ────────────────────
(window as unknown as { electronAPI: unknown }).electronAPI = {
  apiBase: 'http://127.0.0.1:3200',
  internalToken: 'TEST-TOKEN',
};

const api = await import('./api');

interface FetchCall {
  url: string;
  init: RequestInit;
}

let calls: FetchCall[] = [];
let nextResponse: { ok: boolean; status: number; statusText?: string; body: unknown } = {
  ok: true,
  status: 200,
  body: {},
};

const origFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  nextResponse = { ok: true, status: 200, body: {} };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const bodyText =
      typeof nextResponse.body === 'string' ? nextResponse.body : JSON.stringify(nextResponse.body);
    return {
      ok: nextResponse.ok,
      status: nextResponse.status,
      statusText: nextResponse.statusText ?? '',
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

const lastCall = (): FetchCall => {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
};
const headerOf = (c: FetchCall, name: string): string | null =>
  new Headers(c.init.headers ?? {}).get(name);

describe('api.ts · fetchWithToken', () => {
  it('注入 X-Maestro-Token（CSRF 门禁的共享密钥）', () => {
    api.fetchWithToken('http://x/y');
    expect(headerOf(lastCall(), 'X-Maestro-Token')).toBe('TEST-TOKEN');
  });

  it('注入 credentials: include（session cookie 才会带上）', () => {
    api.fetchWithToken('http://x/y');
    expect(lastCall().init.credentials).toBe('include');
  });

  it('没配 token → 不注入该头（dev 模式，server 端 fallback permissive）', () => {
    (window as unknown as { electronAPI: { internalToken?: string } }).electronAPI.internalToken =
      undefined;
    api.fetchWithToken('http://x/y');
    expect(headerOf(lastCall(), 'X-Maestro-Token')).toBeNull();
  });

  it('保留调用方自己设的头（不覆盖）', () => {
    api.fetchWithToken('http://x/y', { headers: { 'Content-Type': 'application/json' } });
    expect(headerOf(lastCall(), 'Content-Type')).toBe('application/json');
  });
});

describe('api.ts · json() 的错误映射', () => {
  it('成功 → 直接返回解析后的 body', async () => {
    nextResponse = { ok: true, status: 200, body: { id: 't1', title: '歌' } };
    const r = await api.fetchNextTrack('qq');
    expect(r).toEqual({ id: 't1', title: '歌' });
  });

  it('错误体 {error:AUTH_EXPIRED} → 抛 AuthError，code 正确', async () => {
    nextResponse = {
      ok: false,
      status: 401,
      body: { error: 'AUTH_EXPIRED', message: '登录已过期' },
    };
    let err: unknown;
    try {
      await api.fetchNextTrack('qq');
    } catch (e) {
      err = e;
    }
    assertAuthError(err, 'AUTH_EXPIRED');
    expect((err as InstanceType<typeof api.AuthError>).status).toBe(401);
    expect((err as InstanceType<typeof api.AuthError>).message).toBe('登录已过期');
  });

  it('错误体的 error 是未知串 → 降级成 AUTH_UNKNOWN（不乱认）', async () => {
    nextResponse = { ok: false, status: 500, body: { error: 'WAT' } };
    let err: unknown;
    try {
      await api.fetchNextTrack('qq');
    } catch (e) {
      err = e;
    }
    assertAuthError(err, 'AUTH_UNKNOWN');
  });

  it('body 不是 JSON → AUTH_UNKNOWN + 原始文本当 message', async () => {
    nextResponse = { ok: false, status: 502, body: 'Bad Gateway' };
    let err: unknown;
    try {
      await api.fetchNextTrack('qq');
    } catch (e) {
      err = e;
    }
    assertAuthError(err, 'AUTH_UNKNOWN');
    expect((err as InstanceType<typeof api.AuthError>).message).toBe('Bad Gateway');
  });

  it('body 为空 + 无 statusText → message 退回 "status statusText"', async () => {
    nextResponse = { ok: false, status: 503, statusText: 'Service Unavailable', body: '' };
    let err: unknown;
    try {
      await api.fetchNextTrack('qq');
    } catch (e) {
      err = e;
    }
    expect((err as InstanceType<typeof api.AuthError>).message).toBe('503 Service Unavailable');
  });
});

describe('api.ts · 请求的 URL / method / body', () => {
  it('getApiOrigin() 取 main 推来的 sidecar 地址（每次求值，不吃模块快照）', () => {
    expect(api.getApiOrigin()).toBe('http://127.0.0.1:3200');
  });

  it('fetchNextTrack → GET /music/next?provider=...', async () => {
    nextResponse = { ok: true, status: 200, body: { id: 'x' } };
    await api.fetchNextTrack('netease');
    const c = lastCall();
    expect(c.url).toBe('http://127.0.0.1:3200/music/next?provider=netease');
    expect(c.init.method ?? 'GET').toBe('GET');
  });

  it('fetchNextTrack 带 preset → query 正确编码', async () => {
    nextResponse = { ok: true, status: 200, body: { id: 'x' } };
    await api.fetchNextTrack('deezer', 'rock & roll');
    expect(lastCall().url).toContain('&preset=rock%20%26%20roll');
  });

  it('toggleLike → POST + JSON body + trackId 进路径', async () => {
    nextResponse = { ok: true, status: 200, body: { success: true, liked: true } };
    await api.toggleLike('qq', 't/1');
    const c = lastCall();
    expect(c.init.method).toBe('POST');
    expect(c.url).toBe('http://127.0.0.1:3200/music/like/t%2F1?provider=qq');
    expect(JSON.parse(String(c.init.body))).toEqual({});
  });

  it('toggleLike 带 meta → body 里带上 meta', async () => {
    nextResponse = { ok: true, status: 200, body: { success: true, liked: false } };
    await api.toggleLike('qq', 't1', { title: '歌', artist: '人', duration: 100 });
    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      meta: { title: '歌', artist: '人', duration: 100 },
    });
  });

  it('saveRecoKey → POST /reco/key，body 带 apiKey', async () => {
    nextResponse = { ok: true, status: 200, body: { ok: true, tail: '...1234' } };
    await api.saveRecoKey('sk-12345678');
    const c = lastCall();
    expect(c.init.method).toBe('POST');
    expect(c.url).toBe('http://127.0.0.1:3200/reco/key');
    expect(JSON.parse(String(c.init.body))).toEqual({ apiKey: 'sk-12345678' });
  });

  it('getLibrary → 404 → 返回 null（不是抛错）', async () => {
    nextResponse = { ok: false, status: 404, body: { error: 'not_found' } };
    expect(await api.getLibrary()).toBeNull();
  });

  it('getLibrary → 200 → 返回库', async () => {
    nextResponse = { ok: true, status: 200, body: { items: [], sources: [] } };
    expect(await api.getLibrary()).toEqual({ items: [], sources: [] });
  });
});

function assertAuthError(err: unknown, code: string): void {
  expect(err).toBeInstanceOf(api.AuthError);
  expect((err as InstanceType<typeof api.AuthError>).code).toBe(code);
}

// 还原（测试进程结束前不影响别的文件，但保持干净）
globalThis.fetch = origFetch;
