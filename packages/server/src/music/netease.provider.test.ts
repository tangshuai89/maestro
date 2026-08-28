/**
 * NeteaseMusicProvider 单测：isConfigured / fetchRadioBatch / fetchLiked /
 * search / getStreamPath / like / unlike / fmTrash / getLyrics / apiCall
 * 全覆盖，mock globalThis.fetch 不打真实网络。
 * 运行: npx ts-node packages/server/src/music/netease.provider.test.ts
 */
export {};
const assert = require('node:assert');

const { NeteaseMusicProvider } = require('./netease.provider');

const prov = new NeteaseMusicProvider();

// ── 辅助：mock globalThis.fetch ──────────────────────────────────────
// netease 的 apiCall 走 res.text() 再 JSON.parse（不是 res.json()），
// 所以 mock 返回的对象必须提供 text() 而非 json()。
// handler 返回的裸对象会被自动包成 { ok, text }。
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    if (out && typeof out === 'object' && 'text' in out) return out as any;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(out),
    } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

// 标准测试 session
const SESSION: any = { musicU: 'test-music-u', csrfToken: 'test-csrf' };

async function main() {
  // ── 1. isConfigured: 有 musicU → true ───────────────────────────
  {
    assert.strictEqual(
      prov.isConfigured({ musicU: 'abc' } as any),
      true,
    );
    console.log('✅ 1. isConfigured: 有 musicU → true');
  }

  // ── 2. isConfigured: 无 session → false ─────────────────────────
  {
    assert.strictEqual(prov.isConfigured(undefined), false);
    console.log('✅ 2. isConfigured: 无 session → false');
  }

  // ── 3. isConfigured: 空 session → false ─────────────────────────
  {
    assert.strictEqual(prov.isConfigured({} as any), false);
    console.log('✅ 3. isConfigured: 空 session → false');
  }

  // ── 4. fetchRadioBatch: 正常返回 → tracks 字段映射 ──────────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      data: [
        {
          id: 1001,
          name: '晴天',
          artists: [{ id: 1, name: '周杰伦' }, { id: 2, name: '方文山' }],
          album: { id: 10, name: '叶惠美', picUrl: 'https://p.example.com/10.jpg' },
          duration: 269000,
        },
      ],
    }));
    const tracks = await prov.fetchRadioBatch(SESSION, 3);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.strictEqual(t.id, '1001');
    assert.strictEqual(t.provider, 'netease');
    assert.strictEqual(t.title, '晴天');
    assert.strictEqual(t.artist, '周杰伦 / 方文山');
    assert.strictEqual(t.album, '叶惠美');
    assert.strictEqual(t.coverUrl, 'https://p.example.com/10.jpg');
    assert.strictEqual(t.duration, 269);
    assert.strictEqual(t.liked, false);
    console.log('✅ 4. fetchRadioBatch: 正常返回 → tracks 字段映射');
  }

  // ── 5. fetchRadioBatch: code=301 → throws BadRequestException ───
  {
    const restore = mockFetch(() => ({ code: 301 }));
    let threw = false;
    try {
      await prov.fetchRadioBatch(SESSION, 3);
    } catch (e: any) {
      threw = true;
      assert.ok(/登录已过期/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, 'code=301 应抛');
    console.log('✅ 5. fetchRadioBatch: code=301 → throws BadRequestException');
  }

  // ── 6. fetchRadioBatch: code=500 → throws ───────────────────────
  {
    const restore = mockFetch(() => ({ code: 500 }));
    let threw = false;
    try {
      await prov.fetchRadioBatch(SESSION, 3);
    } catch (e: any) {
      threw = true;
      assert.ok(/code=500/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, 'code=500 应抛');
    console.log('✅ 6. fetchRadioBatch: code=500 → throws');
  }

  // ── 7. fetchRadioBatch: 空数据 → 返回 [] ────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200, data: [] }));
    const tracks = await prov.fetchRadioBatch(SESSION, 3);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 7. fetchRadioBatch: 空数据 → 返回 []');
  }

  // ── 8. fetchRadioBatch: count 截断 ──────────────────────────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      data: [
        { id: 1, name: 'A', artists: [], album: {}, duration: 1000 },
        { id: 2, name: 'B', artists: [], album: {}, duration: 2000 },
        { id: 3, name: 'C', artists: [], album: {}, duration: 3000 },
        { id: 4, name: 'D', artists: [], album: {}, duration: 4000 },
        { id: 5, name: 'E', artists: [], album: {}, duration: 5000 },
      ],
    }));
    const tracks = await prov.fetchRadioBatch(SESSION, 2);
    restore();
    assert.strictEqual(tracks.length, 2, '应截断到 count=2');
    assert.strictEqual(tracks[0].id, '1');
    assert.strictEqual(tracks[1].id, '2');
    console.log('✅ 8. fetchRadioBatch: count 截断');
  }

  // ── 9. fetchLiked: 未登录 → 返回 [] ─────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 301 }));
    const tracks = await prov.fetchLiked({} as any, 100);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 9. fetchLiked: 未登录 → 返回 []');
  }

  // ── 10. fetchLiked: 正常 3 步流程 → 返回 tracks ─────────────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) {
        // account → uid
        return { code: 200, account: { id: 999 }, profile: {} };
      }
      if (callIdx === 2) {
        // playlist → specialType=5
        return {
          code: 200,
          playlist: [
            { id: 555, name: '我喜欢的音乐', specialType: 5, creator: { userId: 999 } },
          ],
        };
      }
      // detail → tracks
      return {
        code: 200,
        playlist: {
          tracks: [
            {
              id: 2001,
              name: '七里香',
              ar: [{ id: 1, name: '周杰伦' }],
              al: { id: 20, name: '七里香', picUrl: 'https://p.example.com/20.jpg' },
              dt: 299000,
            },
          ],
        },
      };
    });
    const tracks = await prov.fetchLiked(SESSION, 1000);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.strictEqual(t.id, '2001');
    assert.strictEqual(t.title, '七里香');
    assert.strictEqual(t.artist, '周杰伦');
    assert.strictEqual(t.album, '七里香');
    assert.strictEqual(t.coverUrl, 'https://p.example.com/20.jpg');
    assert.strictEqual(t.duration, 299);
    assert.strictEqual(t.liked, true, 'fetchLiked 的歌应标记 liked=true');
    console.log('✅ 10. fetchLiked: 正常 3 步流程 → 返回 tracks');
  }

  // ── 11. fetchLiked: 无 uid → 返回 [] ────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200, account: {}, profile: {} }));
    const tracks = await prov.fetchLiked(SESSION, 100);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 11. fetchLiked: 无 uid → 返回 []');
  }

  // ── 12. fetchLiked: 无"我喜欢的音乐"歌单 → 返回 [] ──────────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) return { code: 200, account: { id: 999 } };
      return {
        code: 200,
        playlist: [{ id: 100, name: '随便听听', specialType: 0, creator: { userId: 999 } }],
      };
    });
    const tracks = await prov.fetchLiked(SESSION, 100);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 12. fetchLiked: 无"我喜欢的音乐"歌单 → 返回 []');
  }

  // ── 13. search: 正常返回 → tracks 字段映射 ──────────────────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) {
        return {
          code: 200,
          result: {
            songs: [
              {
                id: 3001,
                name: '稻香',
                artists: [{ id: 1, name: '周杰伦' }],
                album: { id: 30, name: '魔杰座', picUrl: 'https://p.example.com/30.jpg' },
                duration: 223000,
              },
            ],
          },
        };
      }
      // enrichment → 空覆盖（验证不阻塞）
      return { code: 200, songs: [], privileges: [] };
    });
    const tracks = await prov.search(SESSION, '稻香', 30);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.strictEqual(t.id, '3001');
    assert.strictEqual(t.title, '稻香');
    assert.strictEqual(t.artist, '周杰伦');
    assert.strictEqual(t.album, '魔杰座');
    assert.strictEqual(t.duration, 223);
    console.log('✅ 13. search: 正常返回 → tracks 字段映射');
  }

  // ── 14. search: 空结果 → 返回 [] ────────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200, result: { songs: [] } }));
    const tracks = await prov.search(SESSION, 'zzzz', 30);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 14. search: 空结果 → 返回 []');
  }

  // ── 15. search: enrichment 补封面 + vipLocked ───────────────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) {
        return {
          code: 200,
          result: {
            songs: [
              {
                id: 4001,
                name: '夜曲',
                artists: [{ id: 1, name: '周杰伦' }],
                album: { id: 40, name: '十一月的萧邦' },
                duration: 226000,
              },
            ],
          },
        };
      }
      // enrichment → 补封面 + pl=0 (vipLocked)
      return {
        code: 200,
        songs: [{ id: 4001, al: { id: 40, name: '十一月的萧邦', picUrl: 'https://enrich.example.com/40.jpg' } }],
        privileges: [{ id: 4001, pl: 0, fee: 1 }],
      };
    });
    const tracks = await prov.search(SESSION, '夜曲', 30);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.ok(
      /enrich\.example\.com\/40\.jpg\?param=300y300/.test(t.coverUrl),
      `enrichment 封面应带 ?param=300y300，实际 ${t.coverUrl}`,
    );
    assert.strictEqual(t.vipLocked, true, 'pl<=0 应标 vipLocked=true');
    console.log('✅ 15. search: enrichment 补封面 + vipLocked');
  }

  // ── 16. search: enrichment 失败不阻塞（仍返回 tracks） ──────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) {
        return {
          code: 200,
          result: {
            songs: [
              {
                id: 5001,
                name: '青花瓷',
                artists: [{ id: 1, name: '周杰伦' }],
                album: { id: 50, name: '我很忙', picUrl: 'https://p.example.com/50.jpg' },
                duration: 238000,
              },
            ],
          },
        };
      }
      // enrichment → 非 JSON 响应触发抛错，但 search 应吞掉
      return { text: async () => '<<<html>not json</html>>>', ok: true, status: 200 };
    });
    const tracks = await prov.search(SESSION, '青花瓷', 30);
    restore();
    assert.strictEqual(tracks.length, 1, 'enrichment 失败不应阻塞 search');
    assert.strictEqual(tracks[0].title, '青花瓷');
    console.log('✅ 16. search: enrichment 失败不阻塞（仍返回 tracks）');
  }

  // ── 17. getStreamPath: 正常返回 url ─────────────────────────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      data: [{ id: 6001, url: 'https://stream.example.com/6001.mp3', br: 128000, size: 4000 }],
    }));
    const url = await prov.getStreamPath(SESSION, '6001', 'standard');
    restore();
    assert.strictEqual(url, 'https://stream.example.com/6001.mp3');
    console.log('✅ 17. getStreamPath: 正常返回 url');
  }

  // ── 18. getStreamPath: 高音质无 url → 回退标准音质 ──────────────
  {
    let callIdx = 0;
    const restore = mockFetch(() => {
      callIdx++;
      if (callIdx === 1) {
        // exhigh 无 url
        return { code: 200, data: [{ id: 6002, url: null, br: 0, size: 0 }] };
      }
      // standard 有 url
      return {
        code: 200,
        data: [{ id: 6002, url: 'https://stream.example.com/6002-std.mp3', br: 128000, size: 4000 }],
      };
    });
    const url = await prov.getStreamPath(SESSION, '6002', 'high');
    restore();
    assert.strictEqual(url, 'https://stream.example.com/6002-std.mp3', '应回退标准音质');
    console.log('✅ 18. getStreamPath: 高音质无 url → 回退标准音质');
  }

  // ── 19. getStreamPath: 标准音质也无 url → throws ────────────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      data: [{ id: 6003, url: null, br: 0, size: 0 }],
    }));
    let threw = false;
    try {
      await prov.getStreamPath(SESSION, '6003', 'standard');
    } catch (e: any) {
      threw = true;
      assert.ok(/stream url missing/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '标准音质也无 url 应抛');
    console.log('✅ 19. getStreamPath: 标准音质也无 url → throws');
  }

  // ── 20. like: code=200 → true ───────────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200 }));
    const ok = await prov.like(SESSION, '7001');
    restore();
    assert.strictEqual(ok, true);
    console.log('✅ 20. like: code=200 → true');
  }

  // ── 21. like: code=405（操作频繁）→ true（幂等成功） ────────────
  // 注：provider 把 405 视为幂等成功返回 true（避免 LikeSyncQueue 重试）
  {
    const restore = mockFetch(() => ({ code: 405, message: '操作频繁，请稍候再试' }));
    const ok = await prov.like(SESSION, '7002');
    restore();
    assert.strictEqual(ok, true, '405 应视为幂等成功返回 true');
    console.log('✅ 21. like: code=405（操作频繁）→ true（幂等成功）');
  }

  // ── 22. unlike: code=200 → true ─────────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200 }));
    const ok = await prov.unlike(SESSION, '7003');
    restore();
    assert.strictEqual(ok, true);
    console.log('✅ 22. unlike: code=200 → true');
  }

  // ── 23. unlike: code=405 → true（幂等成功） ─────────────────────
  {
    const restore = mockFetch(() => ({ code: 405, message: '操作频繁，请稍候再试' }));
    const ok = await prov.unlike(SESSION, '7004');
    restore();
    assert.strictEqual(ok, true, '405 应视为幂等成功返回 true');
    console.log('✅ 23. unlike: code=405 → true（幂等成功）');
  }

  // ── 24. fmTrash: code=200 → true ────────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200 }));
    const ok = await prov.fmTrash(SESSION, '7005');
    restore();
    assert.strictEqual(ok, true);
    console.log('✅ 24. fmTrash: code=200 → true');
  }

  // ── 25. getLyrics: 有 lyric → parseLrc 返回 LyricLine[] ─────────
  {
    const lrc = '[00:01.00]第一行\n[00:03.50]第二行\n[00:06.00]第三行';
    const restore = mockFetch(() => ({ code: 200, lyric: lrc }));
    const lyrics = await prov.getLyrics(SESSION, '8001');
    restore();
    assert.ok(Array.isArray(lyrics), '应返回数组');
    assert.strictEqual(lyrics!.length, 3);
    assert.strictEqual(lyrics![0].time, 1);
    assert.strictEqual(lyrics![0].text, '第一行');
    assert.strictEqual(lyrics![1].time, 3.5);
    assert.strictEqual(lyrics![1].text, '第二行');
    assert.strictEqual(lyrics![2].time, 6);
    assert.strictEqual(lyrics![2].text, '第三行');
    console.log('✅ 25. getLyrics: 有 lyric → parseLrc 返回 LyricLine[]');
  }

  // ── 26. getLyrics: 无 lyric → null ──────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200 }));
    const lyrics = await prov.getLyrics(SESSION, '8002');
    restore();
    assert.strictEqual(lyrics, null, '无 lyric 字段应返回 null');
    console.log('✅ 26. getLyrics: 无 lyric → null');
  }

  // ── 27. getLyrics: code!=200 但有 lyric 字段 → 仍解析 ───────────
  {
    const lrc = '[00:02.00]Hello';
    const restore = mockFetch(() => ({ code: 404, lyric: lrc }));
    const lyrics = await prov.getLyrics(SESSION, '8003');
    restore();
    assert.ok(Array.isArray(lyrics), '有 lyric 字段就应解析，不管 code');
    assert.strictEqual(lyrics!.length, 1);
    assert.strictEqual(lyrics![0].time, 2);
    assert.strictEqual(lyrics![0].text, 'Hello');
    console.log('✅ 27. getLyrics: code!=200 但有 lyric 字段 → 仍解析');
  }

  // ── 28. apiCall: 非 JSON 响应 → throws BadRequestException ──────
  // 通过 fetchRadioBatch 触发 apiCall，返回非 JSON 文本
  {
    const restore = mockFetch(() => ({
      ok: true,
      status: 200,
      text: async () => '<<<html>not json</html>>>',
    }));
    let threw = false;
    try {
      await prov.fetchRadioBatch(SESSION, 3);
    } catch (e: any) {
      threw = true;
      assert.ok(/非 JSON/.test(e.message), e.message);
    } finally {
      restore();
    }
    assert.ok(threw, '非 JSON 响应应抛 BadRequestException');
    console.log('✅ 28. apiCall: 非 JSON 响应 → throws BadRequestException');
  }

  console.log('\n🎉 netease.provider.test 全部 28 项通过');
}

main().catch((err) => {
  console.error('❌ netease.provider.test 失败:', err);
  process.exit(1);
});
