/**
 * Spotify provider 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/music/spotify.test.ts
 *
 * 不启动 nest、不调真实 Spotify API：测纯逻辑（PKCE 流程、token 刷新
 * 边界判断、字段映射 Web API → Track）。
 */
export {}; // 顶层 const 不与其他 .test.ts 冲突
const assert = require('node:assert');
const { SpotifyMusicProvider } = require('./spotify.provider');

// stub StorageService：resolveClientId 回退读它，这里恒返回 undefined，
// 所以"无 client_id → refresh 返 null"（测试 5）仍然成立。
const fakeStorage = { get: () => undefined, set: () => {} };
// stub RefreshCoordinator + SessionService for the new ctor signature.
const fakeCoordinator = { run: (_sid: string, fn: () => Promise<unknown>) => fn() };
const fakeSessions = { persistSpotify: () => undefined };
const svc = new SpotifyMusicProvider(
  fakeStorage as any,
  fakeCoordinator as any,
  fakeSessions as any,
);

// ── 1. PKCE start：authorizeUrl 包含所有 OAuth 参数 ────
{
  const r = svc.startAuth('test-client-id-123', 'http://localhost:3200/cb', 'sess-1');
  assert.ok(r.authorizeUrl.startsWith('https://accounts.spotify.com/authorize'));
  assert.ok(r.state.length > 16, 'state 应够随机');
  const u = new URL(r.authorizeUrl);
  assert.strictEqual(u.searchParams.get('client_id'), 'test-client-id-123');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://localhost:3200/cb');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('code_challenge'), '必须有 code_challenge');
  assert.ok(u.searchParams.get('scope'), '必须有 scope');
  console.log('✅ 1. PKCE start: URL 包含 client_id/redirect/scope/challenge');
}

// ── 2. exchangeCode: invalid state → 400 ──────────────────
void (async () => {
{
  try {
    await svc.exchangeCode({}, 'code', 'never-issued', 'http://cb', 'sess-1');
    assert.fail('应该抛错');
  } catch (e: any) {
    assert.ok(/invalid_state/.test(e.message), '应抛 invalid_state');
    console.log('✅ 2. exchangeCode: invalid state 拒绝');
  }
}

// ── 3. isConfigured: 没 session 字段 → false ─────────────
{
  assert.strictEqual(svc.isConfigured(undefined), false);
  assert.strictEqual(svc.isConfigured({}), false);
  console.log('✅ 3. isConfigured: 无 token = false');
}

// ── 4. isConfigured: 有 token → true ─────────────────────
{
  const session = {
    spotify: {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 1_000_000,
    },
  };
  assert.strictEqual(svc.isConfigured(session), true);
  console.log('✅ 4. isConfigured: 有 token = true');
}

// ── 5. getValidAccessToken: 过期 token 应触发 refresh ─────
{
  // 我们不打真实 fetch，验"逻辑路径会调 refresh"——通过把 expiresAt
  // 设到 0 触发。
  const session = {
    spotify: {
      accessToken: 'expired',
      refreshToken: 'r',
      expiresAt: 0, // 已过期
    },
  };
  const tok: string | null = await svc.getValidAccessToken(session);
  // 没有 SPOTIFY_CLIENT_ID env，refresh 内部会返回 null
  assert.strictEqual(tok, null, '无 client_id 时 refresh 返 null');
  console.log('✅ 5. getValidAccessToken: 过期无 client_id 返 null');
}

// ── 6. getValidAccessToken: 未过期直接返回 ──────────────
{
  const session = {
    spotify: {
      accessToken: 'still-valid',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
    },
  };
  const tok: string | null = await svc.getValidAccessToken(session);
  assert.strictEqual(tok, 'still-valid');
  console.log('✅ 6. getValidAccessToken: 未过期直接返回');
}

// ── 7. saveToken: 写回 session ──────────────────────────
{
  const before = { nickname: 'foo' };
  const tok = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 1234,
  };
  const after = svc.saveToken(before, tok);
  assert.strictEqual(after.nickname, 'foo', '原字段保留');
  assert.deepStrictEqual(after.spotify, tok, 'spotify 字段写入');
  assert.notStrictEqual(after, before, '不可变（immutable）');
  console.log('✅ 7. saveToken: 写 spotify 字段 + 保留其他');
}

// ── 8. like: PUT /v1/me/library 正确 (v2 ❤ 写回验证) ─────
{
  // 注入 fetch mock：只关心它被以正确方法/URL/header 调用一次。
  // 新端点 (Save Items to Library) 用 ?uris=spotify:track:{id} 形式——不在
  // JSON body 里，body 应当为空或 undefined。
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('', { status: 200 });
  }) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const r = await svc.like(session as any, 'track-abc-123');
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls.length, 1, 'like() 只调一次 fetch');
    const c = calls[0];
    assert.strictEqual(c.url, 'https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Atrack-abc-123');
    assert.strictEqual(c.init.method, 'PUT');
    const headers = c.init.headers as Record<string, string>;
    assert.strictEqual(headers['Authorization'], 'Bearer valid-tok');
    // 新端点不用 Content-Type: application/json 也不带 body。
    assert.strictEqual(c.init.body, undefined);
    console.log('✅ 8. like: PUT /v1/me/library?uris=spotify:track:{id} 带 Bearer');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 9. unlike: DELETE /v1/me/library 同上 (v2 ❤ 写回验证) ─
{
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('', { status: 200 });
  }) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const r = await svc.unlike(session as any, 'track-xyz-789');
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls.length, 1);
    const c = calls[0];
    assert.strictEqual(c.url, 'https://api.spotify.com/v1/me/library?uris=spotify%3Atrack%3Atrack-xyz-789');
    assert.strictEqual(c.init.method, 'DELETE');
    assert.strictEqual(c.init.body, undefined);
    console.log('✅ 9. unlike: DELETE /v1/me/library 同 like 但 method=DELETE');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 10. like: 401 / 非 2xx → success=false ─────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{"error":{"status":401,"message":"token expired"}}', {
      status: 401,
    })) as typeof fetch;
  try {
    const session = {
      spotify: {
        accessToken: 'expired',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const r = await svc.like(session as any, 'track-1');
    assert.strictEqual(r.success, false, '非 2xx 应返 success=false');
    console.log('✅ 10. like: 401 → success=false（不抛）');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 11. getValidTokenForRenderer: 未登录 → null ────────
{
  const r = await svc.getValidTokenForRenderer({} as any);
  assert.strictEqual(r, null, '空 session 应返 null');
  console.log('✅ 11. getValidTokenForRenderer: 无 session = null');
}

// ── 12. getValidTokenForRenderer: 有效 token 带 tier ─────
{
  const r = await svc.getValidTokenForRenderer({
    spotify: {
      accessToken: 'good',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
      tier: 'premium',
    },
  } as any);
  assert.ok(r, '应有返回');
  assert.strictEqual(r!.accessToken, 'good');
  assert.strictEqual(r!.tier, 'premium', 'tier 应透传');
  console.log('✅ 12. getValidTokenForRenderer: 透传 accessToken + tier');
}

// ── 13. search: 命中结果字段映射 ────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: {
          items: [
            {
              id: 't1',
              name: 'Test Song',
              artists: [
                { id: 'a1', name: 'Artist A' },
                { id: 'a2', name: 'Artist B' },
              ],
              album: {
                id: 'al1',
                name: 'Album X',
                images: [{ url: 'http://img', width: 300, height: 300 }],
              },
              duration_ms: 180000,
              preview_url: 'http://preview',
            },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.search(session as any, 'test');
    assert.strictEqual(results.length, 1);
    const t = results[0];
    assert.strictEqual(t.id, 't1');
    assert.strictEqual(t.title, 'Test Song');
    assert.strictEqual(t.artist, 'Artist A / Artist B');
    assert.strictEqual(t.album, 'Album X');
    assert.strictEqual(t.coverUrl, 'http://img');
    assert.strictEqual(t.duration, 180);
    console.log('✅ 13. search: 命中结果字段映射（id/title/artist/album/coverUrl/duration）');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 14. search: 空结果 ──────────────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ tracks: { items: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.search(session as any, 'nothing-matches');
    assert.strictEqual(results.length, 0);
    console.log('✅ 14. search: 空结果返回空数组');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 15. search: 401 → throws ────────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    await svc.search(session as any, 'test');
    assert.fail('应该抛错');
  } catch (e: any) {
    assert.ok(/spotify_auth_failed/.test(e.message), '应抛 spotify_auth_failed');
    console.log('✅ 15. search: 401 → throws spotify_auth_failed');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 16. search: 多结果保持顺序 ──────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        tracks: {
          items: [
            { id: 't1', name: 'Song 1', artists: [{ id: 'a1', name: 'A' }], album: { name: 'Al' }, duration_ms: 1000 },
            { id: 't2', name: 'Song 2', artists: [{ id: 'a2', name: 'B' }], album: { name: 'Bl' }, duration_ms: 2000 },
            { id: 't3', name: 'Song 3', artists: [{ id: 'a3', name: 'C' }], album: { name: 'Cl' }, duration_ms: 3000 },
          ],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.search(session as any, 'multi');
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].id, 't1');
    assert.strictEqual(results[1].id, 't2');
    assert.strictEqual(results[2].id, 't3');
    console.log('✅ 16. search: 多结果保持 API 返回顺序');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 17. fetchLiked: 返回 liked tracks ───────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        items: [
          { added_at: '2024-01-01', track: { id: 't1', name: 'Liked Song', artists: [{ id: 'a1', name: 'A' }], album: { name: 'Al' }, duration_ms: 5000 } },
        ],
        next: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.fetchLiked(session as any);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 't1');
    assert.strictEqual(results[0].liked, true, 'liked 应为 true');
    console.log('✅ 17. fetchLiked: 返回 liked tracks（liked=true）');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 18. fetchLiked: 空 ──────────────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ items: [], next: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.fetchLiked(session as any);
    assert.strictEqual(results.length, 0);
    console.log('✅ 18. fetchLiked: 空结果返回空数组');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 19. fetchLiked: HTTP error → 返回空（不抛） ─────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.fetchLiked(session as any);
    assert.strictEqual(results.length, 0, 'HTTP error 应返空数组不抛');
    console.log('✅ 19. fetchLiked: HTTP error → 返回空数组（不抛）');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 20. fetchLiked: 分页（next cursor） ─────────────────
{
  let callCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({
          items: [
            { added_at: '2024-01-01', track: { id: 't1', name: 'Song 1', artists: [{ id: 'a', name: 'A' }], album: { name: 'Al' }, duration_ms: 1000 } },
          ],
          next: 'https://api.spotify.com/v1/me/tracks?offset=50&limit=50',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        items: [
          { added_at: '2024-01-02', track: { id: 't2', name: 'Song 2', artists: [{ id: 'b', name: 'B' }], album: { name: 'Bl' }, duration_ms: 2000 } },
        ],
        next: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const results = await svc.fetchLiked(session as any);
    assert.strictEqual(results.length, 2, '应合并两页');
    assert.strictEqual(results[0].id, 't1');
    assert.strictEqual(results[1].id, 't2');
    assert.strictEqual(callCount, 2, '应请求两次');
    console.log('✅ 20. fetchLiked: 分页（next cursor）合并两页');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 21. like: 网络错误 → 抛错 ───────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    let threw = false;
    try {
      await svc.like(session as any, 'track-1');
    } catch (e: any) {
      threw = true;
      assert.ok(/fetch failed/.test(e.message), '应抛 fetch failed');
    }
    assert.ok(threw, '网络错误应抛错');
    console.log('✅ 21. like: 网络错误 → 抛错（非 success=false）');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 22. unlike: 401 → success=false ─────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const r = await svc.unlike(session as any, 'track-1');
    assert.strictEqual(r.success, false, '401 应返 success=false');
    console.log('✅ 22. unlike: 401 → success=false');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 23. getMeInfo: premium tier ─────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ id: 'user-1', display_name: 'Premium User', product: 'premium' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const info = await svc.getMeInfo(session as any);
    assert.ok(info, '应返回 info');
    assert.strictEqual(info!.tier, 'premium');
    assert.strictEqual(info!.id, 'user-1');
    assert.strictEqual(info!.displayName, 'Premium User');
    console.log('✅ 23. getMeInfo: premium tier');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 24. getMeInfo: free tier ────────────────────────────
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ id: 'user-2', display_name: 'Free User', product: 'free' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'valid-tok',
        refreshToken: 'r',
        expiresAt: Date.now() + 60_000,
      },
    };
    const info = await svc.getMeInfo(session as any);
    assert.ok(info);
    assert.strictEqual(info!.tier, 'free');
    console.log('✅ 24. getMeInfo: free tier');
  } finally {
    globalThis.fetch = origFetch;
  }
}

// ── 25. getMeInfo: 无 token → null ──────────────────────
{
  const info = await svc.getMeInfo({} as any);
  assert.strictEqual(info, null, '无 token 应返 null');
  console.log('✅ 25. getMeInfo: 无 token → null');
}

// ── 26. getValidAccessToken: 过期 + 有 client_id → refresh ─
{
  const origFetch = globalThis.fetch;
  process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        access_token: 'refreshed-tok',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'expired',
        refreshToken: 'old-refresh',
        expiresAt: 0,
      },
    };
    const tok = await svc.getValidAccessToken(session as any);
    assert.strictEqual(tok, 'refreshed-tok', '应返回刷新后的 token');
    console.log('✅ 26. getValidAccessToken: 过期 + 有 client_id → refresh 成功');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.SPOTIFY_CLIENT_ID;
  }
}

// ── 27. getValidAccessToken: refresh 失败 → null ─────────
{
  const origFetch = globalThis.fetch;
  process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
  globalThis.fetch = (async () =>
    new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch;

  try {
    const session = {
      spotify: {
        accessToken: 'expired',
        refreshToken: 'bad-refresh',
        expiresAt: 0,
      },
    };
    const tok = await svc.getValidAccessToken(session as any);
    assert.strictEqual(tok, null, 'refresh 失败应返 null');
    console.log('✅ 27. getValidAccessToken: refresh 失败 → null');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.SPOTIFY_CLIENT_ID;
  }
}

// ── 28. bindSessionId: 绑定后 refresh 走 coordinator ─────
{
  const recordedSids: string[] = [];
  const recordingCoordinator = {
    run: (sid: string, fn: () => Promise<unknown>) => {
      recordedSids.push(sid);
      return fn();
    },
  };
  const svc2 = new SpotifyMusicProvider(
    fakeStorage as any,
    recordingCoordinator as any,
    fakeSessions as any,
  );
  const session = {
    spotify: {
      accessToken: 'expired',
      refreshToken: 'r',
      expiresAt: 0,
    },
  };
  svc2.bindSessionId(session as any, 'sess-bound-123');

  const origFetch = globalThis.fetch;
  process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ access_token: 'new-tok', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;

  try {
    const tok = await svc2.getValidAccessToken(session as any);
    assert.strictEqual(tok, 'new-tok');
    assert.strictEqual(recordedSids.length, 1, 'coordinator.run 应被调一次');
    assert.strictEqual(recordedSids[0], 'sess-bound-123', 'sessionId 应透传');
    console.log('✅ 28. bindSessionId: 绑定后 refresh 走 coordinator 带 sessionId');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.SPOTIFY_CLIENT_ID;
  }
}

// ── 29. cancelPendingFlows: 清除 pending ────────────────
{
  const r1 = svc.startAuth('cid', 'http://cb', 'sess-cancel');
  const removed = svc.cancelPendingFlows('sess-cancel');
  assert.strictEqual(removed, 1, '应清除 1 个 flow');
  try {
    await svc.exchangeCode({}, 'code', r1.state, 'http://cb', 'sess-cancel');
    assert.fail('应该抛错');
  } catch (e: any) {
    assert.ok(/invalid_state/.test(e.message), '清除后 exchangeCode 应拒绝');
    console.log('✅ 29. cancelPendingFlows: 清除 pending 后 exchangeCode 拒绝');
  }
}

// ── 30. exchangeCode: 成功换 token + 拉 /me ─────────────
{
  const origFetch = globalThis.fetch;
  process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
  const r = svc.startAuth('test-client-id', 'http://localhost:3200/cb', 'sess-30');
  globalThis.fetch = (async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'exchanged-tok',
          refresh_token: 'exchanged-refresh',
          expires_in: 3600,
          scope: 'user-library-modify streaming',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (urlStr.endsWith('/me')) {
      return new Response(
        JSON.stringify({ id: 'user-30', display_name: 'Test User 30', product: 'premium' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;

  try {
    const session: Record<string, unknown> = {};
    const result = await svc.exchangeCode(
      session as any,
      'auth-code',
      r.state,
      'http://localhost:3200/cb',
      'sess-30',
    );
    assert.strictEqual(result.token.accessToken, 'exchanged-tok');
    assert.strictEqual(result.token.refreshToken, 'exchanged-refresh');
    assert.strictEqual(result.token.tier, 'premium');
    assert.strictEqual(result.profile.id, 'user-30');
    assert.strictEqual(result.profile.displayName, 'Test User 30');
    console.log('✅ 30. exchangeCode: 成功换 token + 拉 /me 拿 tier');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.SPOTIFY_CLIENT_ID;
  }
}

console.log('\n🎉 spotify.test 全部 30 项通过');
})();
