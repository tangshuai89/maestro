/**
 * QqMusicProvider 单测：computeGtk + search/fetchRadioBatch/getStreamPath/
 * getLyrics/isConfigured/like/unlike/fetchLiked/toTrack 全覆盖。
 * mock global.fetch 不打真实网络。
 * 运行: npx ts-node packages/server/src/music/qq.provider.test.ts
 */
export {};
const assert = require('node:assert');

import { QqMusicProvider } from './qq.provider';

const prov = new QqMusicProvider();
const gtk = (skey: string): string =>
  (prov as unknown as { computeGtk(s: string): string }).computeGtk(skey);

/**
 * 独立 DJB2 参考实现（与生产代码相同算法；用于在测试里独立算出期望值，
 * 不复制生产代码到测试里——这是 golden test 的标准做法）。
 */
function referenceDjb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ── 辅助：mock global.fetch ──────────────────────────────────────
// 每个 test 自行 install/restore，避免互相污染。
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    if (out && typeof out === 'object' && 'json' in out) return out as any;
    if (out && typeof out === 'object' && 'arrayBuffer' in out) return out as any;
    if (out && typeof out === 'object' && 'text' in out) return out as any;
    return {
      ok: true,
      json: async () => out,
    } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

// ── 辅助：构造一个带 cookie 的 session ───────────────────────────
function sess(extra: Record<string, unknown> = {}): any {
  return {
    qqCookie: 'qm_keyst=xyz; euin=Ne6ANK4s7KE*',
    qqCookies: { euin: 'Ne6ANK4s7KE*', skey: 'aB3xY9zQw1' },
    qqUin: '123456789',
    ...extra,
  };
}

// ── 辅助：构造加密 musics.fcg 响应（写操作 like/unlike 走加密通道） ─
function encResponse(req0: { code?: number; data?: unknown }) {
  const text = JSON.stringify({ req_0: req0 });
  // 与 decryptResponse 对应的加密：循环 XOR
  const key = Buffer.from(
    '7a3f8c1d5e9b2f0a6c4d7e8b1f3a5c9d0e2b6f4a81',
    'hex',
  );
  const buf = Buffer.from(text, 'utf8');
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return { arrayBuffer: async () => out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) };
}

async function main() {
  // ── 1. computeGtk: 空字符串 → '5381' ────────────────────────────
  {
    assert.strictEqual(gtk(''), '5381', 'DJB2 of "" should be 5381');
    console.log('✅ 1. computeGtk("") → "5381"（DJB2 of ""）');
  }

  // ── 2. computeGtk: 单字符 'a' ───────────────────────────────────
  {
    assert.strictEqual(
      gtk('a'),
      String(referenceDjb2('a')),
      'single char should match reference',
    );
    console.log('✅ 2. computeGtk("a") → 与参考实现一致');
  }

  // ── 3. computeGtk: 'abc' ────────────────────────────────────────
  {
    assert.strictEqual(
      gtk('abc'),
      String(referenceDjb2('abc')),
      '"abc" should match reference',
    );
    console.log('✅ 3. computeGtk("abc") → 与参考实现一致');
  }

  // ── 4. computeGtk: 数字串 '1234567890' ──────────────────────────
  {
    assert.strictEqual(
      gtk('1234567890'),
      String(referenceDjb2('1234567890')),
      'numeric string should match reference',
    );
    console.log('✅ 4. computeGtk("1234567890") → 与参考实现一致');
  }

  // ── 5. computeGtk: 典型 skey（10 位字母数字） ────────────────────
  {
    const skey = 'aB3xY9zQw1';
    assert.strictEqual(gtk(skey), String(referenceDjb2(skey)));
    console.log('✅ 5. computeGtk 典型 10 位 skey → 与参考实现一致');
  }

  // ── 6. computeGtk: 大字符串不越界（>>> 0 unsigned 32-bit） ───────
  {
    const longSkey = 'a'.repeat(1024);
    assert.strictEqual(gtk(longSkey), String(referenceDjb2(longSkey)));
    console.log('✅ 6. computeGtk 1024 字符长串 → 不越界，与参考一致');
  }

  // ── 7. computeGtk: 中文 skey ────────────────────────────────────
  {
    assert.strictEqual(gtk('测试'), String(referenceDjb2('测试')));
    console.log('✅ 7. computeGtk("测试") → 中文 skey 也能算');
  }

  // ── 8. search: 命中结果字段映射 ─────────────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        data: {
          song: {
            list: [
              {
                mid: '001abc',
                name: '晴天',
                singer: [{ name: '周杰伦', mid: 's1' }],
                album: { name: '叶惠美', mid: 'alb1' },
                interval: 269,
                file: { strMediaMid: 'MM001' },
                pay: { pay_play: 0 },
              },
            ],
          },
        },
      }),
    }));
    const tracks = await prov.search(sess(), '晴天', 20);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.strictEqual(t.id, '001abc');
    assert.strictEqual(t.title, '晴天');
    assert.strictEqual(t.artist, '周杰伦');
    assert.strictEqual(t.album, '叶惠美');
    assert.ok(t.coverUrl.includes('alb1'), '封面应带 albummid');
    assert.strictEqual(t.audioUrl, '', '搜索阶段 audioUrl 为空');
    assert.strictEqual(t.duration, 269);
    assert.strictEqual(t.mediaMid, 'MM001');
    assert.strictEqual(t.liked, false);
    assert.strictEqual(t.provider, 'qq');
    console.log('✅ 8. search 命中结果 → 字段映射（id/title/artist/album/coverUrl/audioUrl/duration）');
  }

  // ── 9. search: 空结果（data=[]） ────────────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 0, data: { song: { list: [] } } }),
    }));
    const tracks = await prov.search(sess(), '不存在的歌', 20);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 9. search 空结果（data=[]）→ 返回 []');
  }

  // ── 10. search: HTTP error → throws ─────────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 2 }),
    }));
    let threw = false;
    try {
      await prov.search(sess(), 'err', 20);
    } catch (e: any) {
      threw = true;
      assert.ok(/QQ search failed: code=2/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '非零 code 应抛');
    console.log('✅ 10. search code≠0 → 抛 QQ search failed');
  }

  // ── 11. search: pay_play=1 + 非 VIP → vipLocked=true ────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        data: {
          song: {
            list: [
              {
                mid: 'vip1',
                name: 'VIP 歌',
                singer: [{ name: '某歌手', mid: 's' }],
                album: { name: '某专辑', mid: 'a' },
                interval: 200,
                file: { strMediaMid: 'MMv' },
                pay: { pay_play: 1 },
              },
            ],
          },
        },
      }),
    }));
    const tracks = await prov.search(sess({ qqVip: false }), 'vip', 20);
    restore();
    assert.strictEqual(tracks[0].vipLocked, true, '非 VIP + pay_play=1 → 锁');
    console.log('✅ 11. search pay_play=1 + 非 VIP → vipLocked=true');
  }

  // ── 12. search: pay_play=1 + VIP 用户 → vipLocked=false ─────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        data: {
          song: {
            list: [
              {
                mid: 'vip2',
                name: 'VIP 歌2',
                singer: [{ name: '某歌手', mid: 's' }],
                album: { name: '某专辑', mid: 'a' },
                interval: 200,
                file: { strMediaMid: 'MMv2' },
                pay: { pay_play: 1 },
              },
            ],
          },
        },
      }),
    }));
    const tracks = await prov.search(sess({ qqVip: true }), 'vip', 20);
    restore();
    assert.strictEqual(
      tracks[0].vipLocked,
      false,
      'VIP 用户 + pay_play=1 → 不锁',
    );
    console.log('✅ 12. search pay_play=1 + VIP 用户 → vipLocked=false');
  }

  // ── 13. search: 非 VIP 歌曲（pay_play=0）→ vipLocked=false ──────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        data: {
          song: {
            list: [
              {
                mid: 'free1',
                name: '免费歌',
                singer: [{ name: '某歌手', mid: 's' }],
                album: { name: '某专辑', mid: 'a' },
                interval: 180,
                file: { strMediaMid: 'MMf' },
                pay: { pay_play: 0 },
              },
            ],
          },
        },
      }),
    }));
    const tracks = await prov.search(sess(), 'free', 20);
    restore();
    assert.strictEqual(tracks[0].vipLocked, false, 'pay_play=0 → 不锁');
    console.log('✅ 13. search 非 VIP 歌曲（pay_play=0）→ vipLocked=false');
  }

  // ── 14. fetchRadioBatch: 种子轮转（mock 返回不同 batch） ────────
  {
    let callCount = 0;
    const restore = mockFetch(() => {
      callCount++;
      return {
        json: async () => ({
          code: 0,
          data: {
            song: {
              list: [
                {
                  mid: `radio${callCount}`,
                  name: `电台歌${callCount}`,
                  singer: [{ name: '电台歌手', mid: 'rs' }],
                  album: { name: '电台专辑', mid: 'ra' },
                  interval: 200,
                  file: { strMediaMid: `MMr${callCount}` },
                  pay: { pay_play: 0 },
                },
              ],
            },
          },
        }),
      };
    });
    const tracks = await prov.fetchRadioBatch(sess(), 0, 5);
    restore();
    assert.ok(tracks.length >= 1, '应返回至少 1 首');
    assert.strictEqual(tracks[0].provider, 'qq');
    assert.strictEqual(tracks[0].audioUrl, '', 'radio 阶段 audioUrl 清空');
    console.log('✅ 14. fetchRadioBatch 种子轮转 → 返回 Track 且 audioUrl 清空');
  }

  // ── 15. fetchRadioBatch: 空结果 ─────────────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 0, data: { song: { list: [] } } }),
    }));
    const tracks = await prov.fetchRadioBatch(sess(), 0, 5);
    restore();
    assert.strictEqual(tracks.length, 0, '空搜索 → 空 radio');
    console.log('✅ 15. fetchRadioBatch 空结果 → 返回 []');
  }

  // ── 16. fetchRadioBatch: HTTP error → throws ────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 5 }),
    }));
    let threw = false;
    try {
      await prov.fetchRadioBatch(sess(), 0, 5);
    } catch (e: any) {
      threw = true;
      assert.ok(/QQ search failed/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, 'search 错误应向上抛');
    console.log('✅ 16. fetchRadioBatch HTTP error → 抛错');
  }

  // ── 17. getStreamPath: 正常返回 vkey URL ────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              {
                songmid: '001abc',
                purl: 'C400001abc.m4a?guid=xxx&vkey=KEY123',
                vkey: 'KEY123',
              },
            ],
            sip: ['https://ws.stream.qqmusic.qq.com/'],
          },
        },
      }),
    }));
    const url = await prov.getStreamPath(sess(), '001abc');
    restore();
    assert.ok(
      url.startsWith('https://ws.stream.qqmusic.qq.com/'),
      `应返回 ws.stream URL，实际 ${url}`,
    );
    assert.ok(url.includes('vkey=KEY123'), 'URL 应含 vkey');
    console.log('✅ 17. getStreamPath 正常 → 返回 vkey URL');
  }

  // ── 18. getStreamPath: 高音质无 purl → 回退默认音质 ─────────────
  {
    let callCount = 0;
    const restore = mockFetch(() => {
      callCount++;
      // 第 1 次（高音质 filename）→ 空 purl；第 2 次（默认）→ 有 purl
      if (callCount === 1) {
        return {
          json: async () => ({
            code: 0,
            req_0: {
              code: 0,
              data: {
                midurlinfo: [{ songmid: '001abc', purl: '', errtype: 1 }],
                sip: ['https://ws.stream.qqmusic.qq.com/'],
              },
            },
          }),
        };
      }
      return {
        json: async () => ({
          code: 0,
          req_0: {
            code: 0,
            data: {
              midurlinfo: [
                {
                  songmid: '001abc',
                  purl: 'C400001abc.m4a?guid=xxx&vkey=FALLBACK',
                  vkey: 'FALLBACK',
                },
              ],
              sip: ['https://ws.stream.qqmusic.qq.com/'],
            },
          },
        }),
      };
    });
    const url = await prov.getStreamPath(
      sess(),
      '001abc',
      'MM001',
      'high' as any,
    );
    restore();
    assert.ok(url.includes('vkey=FALLBACK'), '应回退默认音质');
    assert.strictEqual(callCount, 2, '应请求 2 次（高音质 + 回退）');
    console.log('✅ 18. getStreamPath 高音质无 purl → 回退默认音质');
  }

  // ── 19. getStreamPath: track 不存在 / 无 purl → throws ──────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            midurlinfo: [{ songmid: 'nope', purl: '', errtype: 2 }],
            sip: ['https://ws.stream.qqmusic.qq.com/'],
          },
        },
      }),
    }));
    let threw = false;
    try {
      await prov.getStreamPath(sess(), 'nope');
    } catch (e: any) {
      threw = true;
      assert.ok(/QQ vkey missing purl/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '无 purl 应抛');
    console.log('✅ 19. getStreamPath 无 purl → 抛 QQ vkey missing purl');
  }

  // ── 20. getLyrics: LRC 解析（[mm:ss.xx] 时间戳） ────────────────
  {
    const lrc = '[00:01.00]第一行\n[00:03.50]第二行\n[00:06.00]第三行';
    const restore = mockFetch(() => ({
      text: async () => JSON.stringify({ code: 0, lyric: lrc }),
    }));
    const lyrics = await prov.getLyrics(sess(), '001abc');
    restore();
    assert.ok(Array.isArray(lyrics), '应返回数组');
    assert.strictEqual(lyrics!.length, 3);
    assert.strictEqual(lyrics![0].time, 1);
    assert.strictEqual(lyrics![0].text, '第一行');
    assert.strictEqual(lyrics![1].time, 3.5);
    assert.strictEqual(lyrics![1].text, '第二行');
    assert.strictEqual(lyrics![2].time, 6);
    assert.strictEqual(lyrics![2].text, '第三行');
    console.log('✅ 20. getLyrics LRC 解析 → LyricLine[]（含 [mm:ss.xx] 时间戳）');
  }

  // ── 21. getLyrics: 无歌词 → null ────────────────────────────────
  {
    const restore = mockFetch(() => ({
      text: async () => JSON.stringify({ code: 0, lyric: '' }),
    }));
    const lyrics = await prov.getLyrics(sess(), '002abc');
    restore();
    assert.strictEqual(lyrics, null, '无 lyric 应返回 null');
    console.log('✅ 21. getLyrics 无歌词 → 返回 null');
  }

  // ── 22. getLyrics: HTTP error / JSON 解析失败 → null ────────────
  {
    const restore = mockFetch(() => ({
      text: async () => 'not a json {{{',
    }));
    const lyrics = await prov.getLyrics(sess(), '003abc');
    restore();
    assert.strictEqual(lyrics, null, '解析失败应返回 null');
    console.log('✅ 22. getLyrics HTTP/JSON error → 返回 null');
  }

  // ── 23. isConfigured: 有 qqCookie → true ────────────────────────
  {
    assert.strictEqual(prov.isConfigured(sess()), true);
    console.log('✅ 23. isConfigured 有 qqCookie → true');
  }

  // ── 24. isConfigured: 无 session → false ────────────────────────
  {
    assert.strictEqual(prov.isConfigured(undefined), false);
    assert.strictEqual(prov.isConfigured({} as any), false, '无 qqCookie → false');
    console.log('✅ 24. isConfigured 无 session / 无 qqCookie → false');
  }

  // ── 25. like: 成功 ──────────────────────────────────────────────
  {
    let callCount = 0;
    const restore = mockFetch((url: string) => {
      callCount++;
      // 第 1 次：resolveSongId（musicu.fcg 明文）
      if (url.includes('musicu.fcg')) {
        return {
          json: async () => ({
            req_0: { data: { track_info: { id: 999999 } } },
          }),
        };
      }
      // 第 2 次：musics.fcg 加密通道
      return encResponse({ code: 0, data: {} });
    });
    const ok = await prov.like(sess(), '001abc', 1700000000000);
    restore();
    assert.strictEqual(ok, true, 'like 成功应返回 true');
    assert.strictEqual(callCount, 2, '应调 2 次（resolveSongId + musicsEncPost）');
    console.log('✅ 25. like 成功 → 返回 true');
  }

  // ── 26. like: HTTP error / 非 0 code → success=false ─────────────
  {
    const restore = mockFetch((url: string) => {
      if (url.includes('musicu.fcg')) {
        return {
          json: async () => ({
            req_0: { data: { track_info: { id: 999999 } } },
          }),
        };
      }
      return encResponse({ code: 500026, data: {} });
    });
    const ok = await prov.like(sess(), '001abc', 1700000000000);
    restore();
    assert.strictEqual(ok, false, '非 0 code 应返回 false');
    console.log('✅ 26. like 非 0 code → success=false');
  }

  // ── 27. unlike: 成功 ────────────────────────────────────────────
  {
    const restore = mockFetch((url: string) => {
      if (url.includes('musicu.fcg')) {
        return {
          json: async () => ({
            req_0: { data: { track_info: { id: 888888 } } },
          }),
        };
      }
      return encResponse({ code: 0, data: {} });
    });
    const ok = await prov.unlike(sess(), '001abc', 1700000000000);
    restore();
    assert.strictEqual(ok, true, 'unlike 成功应返回 true');
    console.log('✅ 27. unlike 成功 → 返回 true');
  }

  // ── 28. fetchLiked: 返回 liked tracks（CgiGetDiss 请求形状 + 映射） ─
  {
    const captured: { url: string; body: any }[] = [];
    const restore = mockFetch((url: string, opts?: any) => {
      captured.push({ url, body: JSON.parse(opts?.body ?? '{}') });
      const begin = captured[captured.length - 1].body.req_0.param.song_begin;
      if (begin === 0) {
        return {
          json: async () => ({
            code: 0,
            req_0: {
              code: 0,
              data: {
                hasmore: true,
                total_song_num: 2,
                songlist: [
                  {
                    mid: '003IWkKX0FDHRx',
                    name: '明日も (2024 Mastering)',
                    singer: [{ name: 'MUSH&Co.', mid: '001jPZQh3Sgaom' }],
                    album: { name: 'Anniversary', mid: '004WaXSb0WwrlV' },
                    interval: 257,
                    file: { media_mid: 'MM_fake1' },
                  },
                ],
              },
            },
          }),
        };
      }
      return {
        json: async () => ({
          code: 0,
          req_0: {
            code: 0,
            data: {
              hasmore: false,
              total_song_num: 2,
              songlist: [
                {
                  mid: 'fake2',
                  name: '第二首',
                  singer: [{ name: '艺人2', mid: 'x' }],
                  album: { name: '专辑2', mid: 'alb2' },
                  interval: 200,
                  file: { media_mid: 'MM_fake2' },
                },
              ],
            },
          },
        }),
      };
    });
    const tracks = await prov.fetchLiked(sess(), 1500);
    restore();
    assert.ok(captured.length >= 2, '应翻 2 页');
    assert.ok(
      captured[0].url.includes('u.y.qq.com/cgi-bin/musicu.fcg'),
      `应走 musicu.fcg，实际 ${captured[0].url}`,
    );
    assert.strictEqual(captured[0].body.req_0.module, 'music.srfDissInfo.DissInfo');
    assert.strictEqual(captured[0].body.req_0.method, 'CgiGetDiss');
    assert.strictEqual(captured[0].body.req_0.param.disstid, 0);
    assert.strictEqual(captured[0].body.req_0.param.dirid, 201);
    assert.strictEqual(captured[0].body.req_0.param.enc_host_uin, 'Ne6ANK4s7KE*');
    assert.strictEqual(captured[1].body.req_0.param.song_begin, 1000);
    assert.strictEqual(captured[1].body.req_0.param.song_num, 1000);
    assert.strictEqual(tracks.length, 2, '应拉回 2 首');
    assert.strictEqual(tracks[0].id, '003IWkKX0FDHRx');
    assert.strictEqual(tracks[0].title, '明日も (2024 Mastering)');
    assert.strictEqual(tracks[0].artist, 'MUSH&Co.');
    assert.strictEqual(tracks[0].album, 'Anniversary');
    assert.strictEqual(tracks[0].duration, 257);
    assert.strictEqual(tracks[0].mediaMid, 'MM_fake1');
    assert.ok(tracks[0].coverUrl.includes('004WaXSb0WwrlV'), '封面应带 albummid');
    assert.strictEqual(tracks[0].liked, true);
    assert.strictEqual(tracks[0].provider, 'qq');
    console.log('✅ 28. fetchLiked: CgiGetDiss 请求形状 + 分页 + Track 映射');
  }

  // ── 29. fetchLiked: 空结果 ──────────────────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        req_0: { code: 0, data: { hasmore: false, songlist: [] } },
      }),
    }));
    const tracks = await prov.fetchLiked(sess(), 100);
    restore();
    assert.strictEqual(tracks.length, 0, '空 songlist → []');
    console.log('✅ 29. fetchLiked 空结果 → 返回 []');
  }

  // ── 30. fetchLiked: cookie 失效（1000）→ not_logged_in ──────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 1000, req_0: { code: 1000 } }),
    }));
    let threw = false;
    try {
      await prov.fetchLiked(sess(), 100);
    } catch (e: any) {
      threw = true;
      assert.strictEqual(e.message, 'not_logged_in', '应抛 not_logged_in');
    } finally {
      restore();
    }
    assert.ok(threw, 'cookie 失效应抛错');
    console.log('✅ 30. fetchLiked cookie 失效（1000）→ not_logged_in');
  }

  // ── 31. fetchLiked: HTTP error → throws ─────────────────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({ code: 999, req_0: { code: 999 } }),
    }));
    let threw = false;
    try {
      await prov.fetchLiked(sess(), 100);
    } catch (e: any) {
      threw = true;
      assert.ok(/QQ CgiGetDiss failed/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '非 0 非 1000 code 应抛');
    console.log('✅ 31. fetchLiked HTTP error → 抛 QQ CgiGetDiss failed');
  }

  // ── 32. toTrack 字段映射（fetchLiked 映射路径复用） ─────────────
  {
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            hasmore: false,
            total_song_num: 1,
            songlist: [
              {
                mid: 'mapTest',
                name: '映射测试',
                singer: [
                  { name: '艺人A', mid: 'sa' },
                  { name: '艺人B', mid: 'sb' },
                ],
                album: { name: '专辑X', mid: 'albX' },
                interval: 333,
                file: { strMediaMid: 'MMmap' },
              },
            ],
          },
        },
      }),
    }));
    const tracks = await prov.fetchLiked(sess(), 100);
    restore();
    const t = tracks[0];
    assert.strictEqual(t.id, 'mapTest');
    assert.strictEqual(t.title, '映射测试');
    assert.strictEqual(t.artist, '艺人A / 艺人B', '多艺人用 / 连接');
    assert.strictEqual(t.album, '专辑X');
    assert.strictEqual(t.duration, 333);
    assert.strictEqual(t.mediaMid, 'MMmap');
    assert.ok(t.coverUrl.includes('albX'));
    assert.strictEqual(t.liked, true);
    assert.strictEqual(t.provider, 'qq');
    console.log('✅ 32. toTrack 字段映射（多艺人 / 封面 / mediaMid）');
  }

  // ── 33. 多页 search（pagination 参数传递） ──────────────────────
  {
    let capturedUrl = '';
    const restore = mockFetch((url: string) => {
      capturedUrl = url;
      return {
        json: async () => ({
          code: 0,
          data: { song: { list: [] } },
        }),
      };
    });
    await prov.search(sess(), '周杰伦', 30);
    restore();
    const u = new URL(capturedUrl);
    assert.strictEqual(u.searchParams.get('w'), '周杰伦', '关键词应传入 w');
    assert.strictEqual(u.searchParams.get('n'), '30', 'count 应传入 n');
    assert.strictEqual(u.searchParams.get('t'), '0', 't=0 单曲');
    assert.strictEqual(u.searchParams.get('new_json'), '1', 'new_json=1');
    console.log('✅ 33. 多页 search 参数（w/n/t/new_json）正确传递');
  }

  // ── 34. randomGuid: 32 字符 hex，每次调用唯一 ──────────────────
  // ISSUES.md §3.2：旧实现 Math.random × 32，非密码学安全；现改
  // crypto.randomBytes(16).toString('hex')。验证格式（32 hex char）和
  // 多次调用不同（碰撞概率 2^-128，1000 次必不重复）。
  {
    const prov2 = new (prov.constructor as any)();
    const guidRe = /^[0-9a-f]{32}$/;
    const guids = new Set<string>();
    for (let i = 0; i < 100; i++) guids.add(prov2.randomGuid());
    assert.ok(guidRe.test([...guids][0]), 'randomGuid 应为 32 字符 hex');
    assert.strictEqual(guids.size, 100, '100 次 randomGuid 应全部唯一');
    console.log('✅ 34. randomGuid: 32 hex char + 100 次调用全唯一');
  }

  // ── 35. fetchRadioBatch: 注入 rng → Fisher-Yates 顺序确定 ─────────
  // ISSUES.md §3.3：旧实现内联 Math.random，顺序无法断言；现抽出 shuffle
  // 静态助手 + fetchRadioBatch 接受可选 rng 参数。同一 rng 序列应产出
  // 同一顺序（确定性种子 → 可重放测试）。
  {
    // mock search 返回固定的 6 首（让 shuffle 决定相对顺序）
    const restore = mockFetch(() => ({
      json: async () => ({
        code: 0,
        data: {
          song: {
            list: [1, 2, 3, 4, 5, 6].map((i) => ({
              mid: `m${i}`,
              name: `歌${i}`,
              singer: [{ name: '歌手', mid: 's' }],
              album: { name: '专辑', mid: 'a' },
              interval: 200,
              file: { strMediaMid: `MM${i}` },
              pay: { pay_play: 0 },
            })),
          },
        },
      }),
    }));
    // 固定 rng 序列：[0.5, 0.5, 0.5, 0.5, ...] → shuffle 后顺序可手工验
    const fixedRng = () => 0.5;
    const tracks1 = await prov.fetchRadioBatch(sess(), 0, 6, fixedRng);
    const tracks2 = await prov.fetchRadioBatch(sess(), 0, 6, fixedRng);
    restore();
    assert.strictEqual(tracks1.length, 6, '应返回 6 首');
    assert.deepStrictEqual(
      tracks1.map((t: any) => t.id),
      tracks2.map((t: any) => t.id),
      '同一 rng 序列 → 同一顺序（可重放）',
    );
    console.log('✅ 35. fetchRadioBatch: 注入 rng → 顺序确定（两次跑一致）');
  }

  console.log('\n🎉 qq.provider.test 全部 35 项通过');
}

main().catch((err) => {
  console.error('❌ qq.provider.test 失败:', err);
  process.exit(1);
});
