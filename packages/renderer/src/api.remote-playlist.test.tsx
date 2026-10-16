/**
 * 远端歌单链接解析（specs/remote-playlist §Phase 5）。
 *
 * 覆盖 `parseRemotePlaylistInput`：用户多半是直接复制浏览器地址栏，所以要
 * 同时吃 URL（三个平台的域名）和裸 id；认不出的域名必须返回 null 而不是猜一个
 * 平台——从一个 QQ 链接推出一个 netease 请求只会得到一句莫名其妙的 404。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRemotePlaylist,
  listRemotePlaylists,
  parseRemotePlaylistInput,
  API_ORIGIN,
} from './api';

describe('parseRemotePlaylistInput', () => {
  it('解析 QQ 音乐歌单链接（含 ryqq 与 ryqq_v2 两种路径）', () => {
    expect(parseRemotePlaylistInput('https://y.qq.com/n/ryqq/playlist/8584177317')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
    expect(parseRemotePlaylistInput('https://y.qq.com/n/ryqq_v2/playlist/8584177317')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
  });

  it('解析网易云歌单链接', () => {
    expect(parseRemotePlaylistInput('https://music.163.com/#/playlist?id=1562085694')).toEqual({
      provider: 'netease',
      playlistId: '1562085694',
    });
    expect(parseRemotePlaylistInput('https://music.163.com/playlist/123456')).toEqual({
      provider: 'netease',
      playlistId: '123456',
    });
  });

  it('解析 Deezer 歌单链接（含 www. 前缀）', () => {
    expect(parseRemotePlaylistInput('https://www.deezer.com/playlist/1313621735')).toEqual({
      provider: 'deezer',
      playlistId: '1313621735',
    });
  });

  it('解析裸数字 id（默认按 QQ 处理）', () => {
    expect(parseRemotePlaylistInput('8584177317')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
    expect(parseRemotePlaylistInput('  8584177317  ')).toEqual({
      provider: 'qq',
      playlistId: '8584177317',
    });
  });

  it('解析 Spotify base62 id（虽未接入，但要让 UI 给出准确提示）', () => {
    // Spotify 歌单 id 不是数字。宽松解析它，是为了 modal 能回
    // 「Spotify 歌单读取尚未接入」而不是含糊的「认不出这个链接」。
    expect(
      parseRemotePlaylistInput('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    ).toEqual({ provider: 'spotify', playlistId: '37i9dQZF1DXcBWIGoYBM5M' });
  });

  it('无法识别的输入返回 null（不猜平台）', () => {
    expect(parseRemotePlaylistInput('')).toBeNull();
    expect(parseRemotePlaylistInput('   ')).toBeNull();
    expect(parseRemotePlaylistInput('随便写点什么')).toBeNull();
    // 未知域名——宁可 null，也不要静默路由到错平台
    expect(parseRemotePlaylistInput('https://example.com/playlist/123')).toBeNull();
    // 域名对但路径里没有数字 id
    expect(parseRemotePlaylistInput('https://y.qq.com/n/ryqq/playlist/')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 请求 URL 断言
//
// 上一轮踩过的坑：端点在 `music.controller.ts`（`@Controller('music')`），
// 但 api.ts 里少写了 `/music` 前缀。server 回 SPA 的 index.html，renderer
// 抛 `Unexpected token '<' … is not valid JSON` —— 错误信息完全看不出是
// 「路由写错了」还是「后端挂了」。纯函数测试抓不到这类，所以这里 mock fetch
// 直接断言最终 URL。
// ─────────────────────────────────────────────────────────────
describe('远端歌单请求 URL', () => {
  let calls: string[];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider: 'qq', supported: false, items: [] }),
        json: async () => ({ provider: 'qq', supported: false, items: [] }),
      } as any;
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('listRemotePlaylists 必须带 /music 前缀', async () => {
    await listRemotePlaylists('netease');
    expect(calls[0]).toBe(`${API_ORIGIN}/music/playlists?provider=netease`);
    expect(calls[0]).toContain('/music/playlists');
  });

  it('listRemotePlaylists 透传 limit', async () => {
    await listRemotePlaylists('netease', 30);
    expect(calls[0]).toBe(`${API_ORIGIN}/music/playlists?provider=netease&limit=30`);
  });

  it('getRemotePlaylist 必须带 /music 前缀 + encodeURIComponent 歌单 id', async () => {
    await getRemotePlaylist('qq', '8584177317');
    expect(calls[0]).toBe(`${API_ORIGIN}/music/playlists/qq/8584177317/tracks`);
  });

  it('getRemotePlaylist 透传 limit', async () => {
    await getRemotePlaylist('deezer', '1313621735', 500);
    expect(calls[0]).toBe(`${API_ORIGIN}/music/playlists/deezer/1313621735/tracks?limit=500`);
  });
});
