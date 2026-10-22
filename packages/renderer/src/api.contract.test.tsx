/**
 * api.ts 的**契约测试**（表驱动）。
 *
 * ## 为什么用表驱动而不是一条一个 it
 *
 * api.ts 有 70 个导出函数，绝大多数形状相同：`fetchWithToken(URL, init)` →
 * `json(res)`。真正会出 bug 的不是"函数体长什么样"，而是**这个函数到底
 * 请求了哪个 URL、用什么 method、body 装了什么**——拼错一个字符就是
 * 404，method 写错就是 405，参数漏传就是"服务端收到 undefined"。
 *
 * 逐个写 it 会写成 70 段高度重复的样板；表驱动把"契约"直接摆成一张表，
 * **新增一个 API 函数时补一行表格 = 补一条契约**，覆盖不漏。
 *
 * ## 与 api.real.test.tsx 的分工
 *
 * 那份测**错误路径**（AuthError 映射、404 → null、body 解析）；这份测
 * **请求契约**（URL / method / body / query）。两份合起来才是 api.ts 的
 * 完整必经之路。
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ── 先摆好 electronAPI，再动态 import 真 api.ts ────────────────────
(window as unknown as { electronAPI: unknown }).electronAPI = {
  apiBase: 'http://127.0.0.1:3200',
  internalToken: 'TEST-TOKEN',
};

const api = await import('./api');
type CrossPlatformLikeTotal = import('./api').CrossPlatformLikeTotal;

interface FetchCall {
  url: string;
  init: RequestInit;
}

let calls: FetchCall[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
      // 默认体给 `{items: []}`：searchTracks / searchOne / fetchAlbumTracks
      // 都要读 `res.items` 再 map，空数组最省事（不 map 就会抛 TypeError）。
      json: async () => ({ items: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

const lastCall = (): FetchCall => {
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
};
const methodOf = (c: FetchCall): string => c.init.method ?? 'GET';
const bodyOf = (c: FetchCall): unknown => JSON.parse(String(c.init.body ?? '{}'));

/** 断言一次请求的契约：method + URL 片段 + 可选 body 片段。 */
async function expectRequest(
  fn: () => Promise<unknown>,
  expected: { method?: string; url: string; body?: Record<string, unknown> },
): Promise<void> {
  await fn();
  const c = lastCall();
  if (expected.method) expect(methodOf(c)).toBe(expected.method);
  expect(c.url).toContain(expected.url);
  if (expected.body) {
    const b = bodyOf(c) as Record<string, unknown>;
    for (const [k, v] of Object.entries(expected.body)) {
      expect(b[k]).toEqual(v);
    }
  }
}

describe('api.ts · 请求契约（表驱动）', () => {
  it('本地歌单 CRUD', async () => {
    await expectRequest(() => api.listPlaylists(), {
      method: 'GET',
      url: 'http://127.0.0.1:3200/library/playlists',
    });
    await expectRequest(() => api.createPlaylist({ name: 'n', tracks: [] }), {
      method: 'POST',
      url: 'http://127.0.0.1:3200/library/playlists',
      body: { name: 'n' },
    });
    await expectRequest(() => api.patchPlaylist('p 1', { name: 'x' }), {
      method: 'PATCH',
      url: 'http://127.0.0.1:3200/library/playlists/p%201',
      body: { name: 'x' },
    });
    await expectRequest(() => api.deletePlaylist('p1'), {
      method: 'DELETE',
      url: 'http://127.0.0.1:3200/library/playlists/p1',
    });
  });

  it('远端歌单：provider 在 query 首位，limit 用 & 接（不能是 ?）', async () => {
    // ⚠️ 这条是真实踩过的坑：第二个 query 参数分隔符写成 ? → limit 被静默丢掉。
    await expectRequest(() => api.listRemotePlaylists('netease', 30), {
      method: 'GET',
      url: '/music/playlists?provider=netease&limit=30',
    });
    expect(lastCall().url).not.toContain('netease?limit');

    await expectRequest(() => api.getRemotePlaylist('qq', '8584177317', 50), {
      method: 'GET',
      url: '/music/playlists/qq/8584177317/tracks?limit=50',
    });
  });

  it('远端歌单：playlistId 特殊字符要编码', async () => {
    await expectRequest(() => api.getRemotePlaylist('qq', 'a/b?c'), {
      url: '/music/playlists/qq/a%2Fb%3Fc/tracks',
    });
  });

  it('红心：fan-out / detect / dislike', async () => {
    await expectRequest(
      () =>
        api.fanOutLike('m1', [{ platform: 'qq', trackId: 't1' }], true, {
          title: '歌',
          artist: '人',
          duration: 100,
        }),
      {
        method: 'POST',
        url: '/music/like/merged',
        body: { mergedId: 'm1', liked: true },
      },
    );
    await expectRequest(() => api.detectLiked('m1', [{ platform: 'qq', trackId: 't1' }]), {
      method: 'POST',
      url: '/music/like/detect',
      body: { mergedId: 'm1' },
    });
    await expectRequest(() => api.dislike('qq', 't1'), {
      method: 'POST',
      url: '/music/dislike/t1?provider=qq',
    });
    await expectRequest(() => api.dislikeMerged('m1', [{ platform: 'qq', trackId: 't1' }]), {
      method: 'POST',
      url: '/music/dislike/merged',
      body: { mergedId: 'm1' },
    });
    await expectRequest(() => api.getLiked('qq'), {
      method: 'GET',
      url: '/music/liked?provider=qq',
    });
  });

  it('红心数：POST /music/track/likeCount，body 带 platform+trackId', async () => {
    await expectRequest(() => api.fetchTrackLikeCount('netease', 't1'), {
      method: 'POST',
      url: '/music/track/likeCount',
      body: { platform: 'netease', trackId: 't1' },
    });
  });

  it('登录态：三个 status 变体的 query 不同（extended / validate）', async () => {
    await expectRequest(() => api.getAuthStatus('qq'), {
      url: '/auth/status?provider=qq',
    });
    expect(lastCall().url).not.toContain('extended');
    await expectRequest(() => api.getAuthStatusExtended('qq'), {
      url: '/auth/status?provider=qq&extended=1',
    });
    await expectRequest(() => api.getAuthStatusValidated('qq'), {
      url: '/auth/status?provider=qq&validate=1&extended=1',
    });
  });

  it('Spotify OAuth：start / cancel / redeem / status / token / me / client-id', async () => {
    await expectRequest(() => api.startSpotify(), {
      method: 'POST',
      url: '/auth/spotify/start',
      body: {},
    });
    await expectRequest(() => api.startSpotify('maestro://cb'), {
      method: 'POST',
      url: '/auth/spotify/start',
      body: { redirectUri: 'maestro://cb' },
    });
    await expectRequest(() => api.cancelSpotifyAuth(), {
      method: 'POST',
      url: '/auth/spotify/cancel',
    });
    await expectRequest(() => api.redeemSpotifyCode('c d', 's&t'), {
      method: 'GET',
      url: '/auth/spotify/redeem?code=c%20d&state=s%26t',
    });
    await expectRequest(() => api.getSpotifyStatus(), { url: '/auth/spotify/status' });
    await expectRequest(() => api.getSpotifyToken(), { url: '/auth/spotify/token' });
    await expectRequest(() => api.getSpotifyMe(), { url: '/auth/spotify/me' });
    await expectRequest(() => api.setSpotifyClientId('cid'), {
      method: 'POST',
      url: '/auth/spotify/client-id',
      body: { clientId: 'cid' },
    });
  });

  it('登录事件上报 / 登出 / QQ cookie 登录 / 网易云 cookie 登录', async () => {
    await expectRequest(
      () =>
        api.reportAuthEvent({
          provider: 'qq',
          attemptId: 'a1',
          outcome: 'ok',
          durationMs: 12,
        }),
      { method: 'POST', url: '/auth/event', body: { attemptId: 'a1', outcome: 'ok' } },
    );
    await expectRequest(() => api.logout('qq'), { url: '/auth/logout?provider=qq' });
    await expectRequest(() => api.loginQqCookie('ck', 'uin1', { a: 'b' }), {
      method: 'POST',
      url: '/auth/qq/cookie',
      body: { cookie: 'ck', uin: 'uin1', extraCookies: { a: 'b' } },
    });
    await expectRequest(() => api.loginNeteaseCookie('MUSIC_U', 'csrf1'), {
      method: 'POST',
      url: '/auth/netease/cookie',
      body: { musicU: 'MUSIC_U', csrfToken: 'csrf1' },
    });
  });

  it('网易云扫码登录两步', async () => {
    await expectRequest(() => api.startNeteaseQr(), {
      method: 'POST',
      url: '/auth/netease/qr/start',
    });
    await expectRequest(() => api.checkNeteaseQr('k 1'), {
      url: '/auth/netease/qr/check?key=k%201',
    });
  });

  it('搜索：tracks / unified / one 的 provider+query', async () => {
    await expectRequest(() => api.searchTracks('qq', 'a b'), {
      url: '/music/search?provider=qq&q=a%20b',
    });
    // searchUnified 的签名是 (q, page, pageSize) —— 统一搜索不带 provider
    await expectRequest(() => api.searchUnified('x', 2, 30), {
      url: '/music/search?q=x&page=2&pageSize=30',
    });
    await expectRequest(() => api.searchOne('netease', 'y'), {
      url: 'provider=netease',
    });
  });

  it('专辑：搜索 / 拉曲目 / fan-out 收藏 / 单平台收藏', async () => {
    await expectRequest(() => api.searchAlbums('a b', 2, 30), {
      url: '/music/albums/search?q=a+b&page=2&pageSize=30',
    });
    await expectRequest(() => api.fetchAlbumTracks('qq', 'al/1'), {
      url: '/music/albums/qq/al%2F1/tracks',
    });
    await expectRequest(
      () => api.fanOutAlbumSave('m1', [{ platform: 'qq', albumId: 'a1' }], true),
      {
        method: 'POST',
        url: '/music/album/save/merged',
        body: { mergedAlbumId: 'm1', saved: true },
      },
    );
    await expectRequest(() => api.toggleAlbumSave('qq', 'a1', true), {
      method: 'POST',
      url: '/music/album/save/a1?provider=qq&saved=true',
    });
  });

  it('等价源匹配：excludeId 进 trackId query', async () => {
    await expectRequest(
      () => api.findEquivalentSource('qq', { title: '歌', artist: '人', duration: 100 }, 'old1'),
      { url: '/music/equivalents?' },
    );
    expect(lastCall().url).toContain('trackId=old1');
  });

  it('推荐：status / run / key 的增删 / 渠道优先级', async () => {
    await expectRequest(() => api.fetchRecoStatus(), { url: '/reco/status' });
    await expectRequest(() => api.runReco({ count: 5 }), {
      method: 'POST',
      url: '/reco/run',
      body: { count: 5 },
    });
    await expectRequest(() => api.saveRecoKey('sk-1'), {
      method: 'POST',
      url: '/reco/key',
      body: { apiKey: 'sk-1' },
    });
    await expectRequest(() => api.resetRecoKey(), { method: 'POST', url: '/reco/key' });
    await expectRequest(() => api.getChannelPriority(), { url: '/music/channel-priority' });
    await expectRequest(() => api.setChannelPriority(['qq', 'netease']), {
      method: 'PUT',
      url: '/music/channel-priority',
      body: { priority: ['qq', 'netease'] },
    });
    await expectRequest(() => api.resetChannelPriority(), {
      method: 'DELETE',
      url: '/music/channel-priority',
    });
  });

  it('NL 歌单：parse-intent 走统一 json 出口', async () => {
    await expectRequest(() => api.parseIntent('来点爵士'), {
      method: 'POST',
      url: '/reco/parse-intent',
      body: { text: '来点爵士' },
    });
  });

  it('库：import / library / 清理', async () => {
    await expectRequest(() => api.importLibrary(), {
      method: 'POST',
      url: '/music/library/import',
    });
    await expectRequest(() => api.getLibrary(), { url: '/music/library' });
    await expectRequest(() => api.clearProviderLibrary('qq'), {
      method: 'POST',
      url: '/music/library/qq/clear',
    });
    await expectRequest(() => api.clearAllLibraries(), {
      method: 'DELETE',
      url: '/music/library',
    });
  });

  it('歌词：主接口带 provider+trackId，可选 title/artist/sources/merge', async () => {
    await expectRequest(() => api.fetchLyrics('qq', 't1'), {
      url: '/music/lyrics?provider=qq&trackId=t1',
    });
    await expectRequest(
      () =>
        api.fetchLyrics('qq', 't1', {
          title: '歌',
          artist: '人',
          sources: [{ platform: 'netease', trackId: 'n1' }],
          merge: false,
        }),
      { url: 'merge=0' },
    );
    expect(lastCall().url).toContain('sources=');
    expect(lastCall().url).toContain('title=');
  });

  it('歌词：可用性探测 / 按歌名找歌词', async () => {
    await expectRequest(() => api.fetchLyricsAvailability([{ platform: 'qq', trackId: 't1' }]), {
      url: '/music/lyrics/availability?sources=',
    });
    await expectRequest(() => api.fetchLyricsByName('歌', '人', 100), {
      url: '/music/lyrics/search?title=',
    });
  });

  it('备份：快照 / 导入 / 触发 / 信息', async () => {
    await expectRequest(() => api.getStateSnapshot(), { url: '/storage/state' });
    await expectRequest(() => api.importState({ a: 1 }), {
      method: 'POST',
      url: '/storage/import',
      body: { stateJson: { a: 1 } },
    });
    await expectRequest(() => api.triggerBackup(), { method: 'POST', url: '/storage/backup' });
    await expectRequest(() => api.getBackupInfo(), { url: '/storage/info' });
  });

  it('平台健康度 / 全平台登录态', async () => {
    await expectRequest(() => api.fetchSourceHealth(), { url: '/music/source-health' });
    calls = [];
    // fetchAuthStatusAll 是**逐平台循环**调 status（不是单个批量端点）→
    // 4 个平台 = 4 次请求，且都带 extended=1。
    await api.fetchAuthStatusAll();
    expect(calls.length).toBe(4);
    for (const c of calls) {
      expect(c.url).toContain('/auth/status?provider=');
      expect(c.url).toContain('extended=1');
    }
  });

  it('Deezer 编辑精选', async () => {
    await expectRequest(() => api.fetchDeezerEditorials(), { url: '/music/deezer/editorials' });
  });
});

describe('api.ts · 边界与降级行为', () => {
  it('fetchLyricsAvailability 传空数组 → 不发请求（直接 false）', async () => {
    expect(await api.fetchLyricsAvailability([])).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('fetchLyricsByName 缺 title/artist → 不发请求（直接 null）', async () => {
    expect(await api.fetchLyricsByName('', '人', 100)).toBeNull();
    expect(await api.fetchLyricsByName('歌', '', 100)).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('reportRecoSignal 缺 title/artist → 不发请求（fire-and-forget 也不该打）', () => {
    api.reportRecoSignal({ type: 'play', title: '', artist: '人' });
    api.reportRecoSignal({ type: 'play', title: '歌', artist: '' });
    expect(calls.length).toBe(0);
  });

  it('reportRecoSignal 正常 → POST /reco/signal', () => {
    api.reportRecoSignal({ type: 'skip', title: '歌', artist: '人', progress: 20 });
    expect(calls.length).toBe(1);
    expect(lastCall().url).toContain('/reco/signal');
    expect(methodOf(lastCall())).toBe('POST');
    expect(bodyOf(lastCall())).toEqual({
      type: 'skip',
      title: '歌',
      artist: '人',
      progress: 20,
    });
  });

  it('reportRecoSignal 上报失败 → 静默吞掉（不抛）', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(() => api.reportRecoSignal({ type: 'play', title: '歌', artist: '人' })).not.toThrow();
    // 给 promise 一个 tick，确认 rejection 被 catch 住而不是变成 unhandled
    await new Promise((r) => setTimeout(r, 0));
  });

  it('parseRemotePlaylistInput：裸数字 id / 各平台链接 / 认不出的域名', () => {
    // 裸 id → 默认 QQ
    expect(api.parseRemotePlaylistInput('8584177317')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
    // 网易云 hash 形态（地址栏默认）
    expect(api.parseRemotePlaylistInput('https://music.163.com/#/playlist?id=1562085694')).toEqual({
      provider: 'netease',
      playlistId: '1562085694',
    });
    // 网易云 path 形态
    expect(api.parseRemotePlaylistInput('https://music.163.com/playlist/123456')).toEqual({
      provider: 'netease',
      playlistId: '123456',
    });
    // QQ path 形态
    expect(api.parseRemotePlaylistInput('https://y.qq.com/n/ryqq/playlist/8584177317')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
    // Spotify 的 id 是 base62 非数字 → 单独宽松分支
    expect(
      api.parseRemotePlaylistInput('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    ).toEqual({ provider: 'spotify', playlistId: '37i9dQZF1DXcBWIGoYBM5M' });
    // 认不出的域名 → null（让调用方提示改用裸 id）
    expect(api.parseRemotePlaylistInput('https://example.com/playlist/123')).toBeNull();
    // 空串 → null
    expect(api.parseRemotePlaylistInput('   ')).toBeNull();
  });

  it('recomputeCrossPlatformLikeTotal：只算 qq/netease 的 likeCount', () => {
    const item: {
      sources: Array<{
        platform: string;
        likeCount?: { count: number; display: string; source: 'qq' | 'netease' };
      }>;
      crossPlatformLikeTotal?: CrossPlatformLikeTotal;
    } = {
      sources: [
        { platform: 'qq', likeCount: { count: 12, display: '12', source: 'qq' } },
        { platform: 'netease', likeCount: { count: 8, display: '8', source: 'netease' } },
        { platform: 'deezer' },
      ],
    };
    api.recomputeCrossPlatformLikeTotal(item);
    expect(item.crossPlatformLikeTotal?.count).toBe(20);
    expect(item.crossPlatformLikeTotal?.display).toBe('12 + 8');
    // parts 与 display 同源但逐项切分（HUD 要把上标插回每个数字后面）
    expect(item.crossPlatformLikeTotal?.parts).toEqual([
      { platform: 'qq', display: '12' },
      { platform: 'netease', display: '8' },
    ]);
  });

  it('recomputeCrossPlatformLikeTotal：没有可算的桶 → 删掉该字段', () => {
    const item: {
      sources: Array<{
        platform: string;
        likeCount?: { count: number; display: string; source: 'qq' | 'netease' };
      }>;
      crossPlatformLikeTotal?: CrossPlatformLikeTotal;
    } = {
      sources: [{ platform: 'deezer' }],
      crossPlatformLikeTotal: {
        count: 1,
        display: '1',
        platforms: ['qq'],
        parts: [],
      },
    };
    api.recomputeCrossPlatformLikeTotal(item);
    expect(item.crossPlatformLikeTotal).toBeUndefined();
  });
});
