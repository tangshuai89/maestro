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
                // cloudsearch/pc schema：ar/al/dt + 内联 privilege
                ar: [{ id: 1, name: '周杰伦' }],
                al: { id: 30, name: '魔杰座', picUrl: 'https://p.example.com/30.jpg' },
                dt: 223000,
                privilege: { id: 3001, pl: 320000, fee: 0 },
              },
            ],
          },
        };
      }
      return { code: 200, result: { songs: [] } };
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
    assert.ok(/p\.example\.com\/30\.jpg\?param=300y300/.test(t.coverUrl), '封面带缩放参数');
    assert.strictEqual(t.vipLocked, false);
    console.log('✅ 13. search: 正常返回 → tracks 字段映射（cloudsearch schema）');
  }

  // ── 14. search: 空结果 → 返回 [] ────────────────────────────────
  {
    const restore = mockFetch(() => ({ code: 200, result: { songs: [] } }));
    const tracks = await prov.search(SESSION, 'zzzz', 30);
    restore();
    assert.strictEqual(tracks.length, 0);
    console.log('✅ 14. search: 空结果 → 返回 []');
  }

  // ── 15. search: 内联 privilege 给 vipLocked + al.picUrl 给封面 ──
  // cloudsearch/pc 单曲自带 privilege 和封面，不再需要 v3 detail 补充请求。
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          {
            id: 4001,
            name: '夜曲',
            ar: [{ id: 1, name: '周杰伦' }],
            al: { id: 40, name: '十一月的萧邦', picUrl: 'https://enrich.example.com/40.jpg' },
            dt: 226000,
            privilege: { id: 4001, pl: 0, fee: 1 },
          },
        ],
      },
    }));
    const tracks = await prov.search(SESSION, '夜曲', 30);
    restore();
    assert.strictEqual(tracks.length, 1);
    const t = tracks[0];
    assert.ok(
      /enrich\.example\.com\/40\.jpg\?param=300y300/.test(t.coverUrl),
      `封面应带 ?param=300y300，实际 ${t.coverUrl}`,
    );
    assert.strictEqual(t.vipLocked, true, 'pl<=0 应标 vipLocked=true');
    console.log('✅ 15. search: 内联 privilege → vipLocked + al.picUrl → 封面');
  }

  // ── 15a. search: pl>0 但 fee=1（数字专辑）→ vipLocked=true ──────
  // 修「台北车站」类 bug：原代码只看 pl>0 错判成"已解锁"。
  // 数字专辑的 pl=128000 实际是 128kbps 30s 试听，必须锁。
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          {
            id: 7001,
            name: '数字专辑歌',
            ar: [{ id: 1, name: '某歌手' }],
            al: { id: 70, name: '数字专辑', picUrl: 'https://alb.example.com/70.jpg' },
            dt: 240000,
            privilege: { id: 7001, pl: 128000, fee: 1 },
          },
        ],
      },
    }));
    const tracks = await prov.search(SESSION, '数字专辑', 30);
    restore();
    assert.strictEqual(tracks.length, 1);
    assert.strictEqual(
      tracks[0].vipLocked,
      true,
      'pl=128000 但 fee=1（数字专辑）→ 锁（旧 bug：只看 pl>0 会错判解锁）',
    );
    console.log('✅ 15a. search pl=128000 + fee=1（数字专辑）→ vipLocked=true');
  }

  // ── 15b. search: pl>0 且 fee=0 → 不锁（保留旧行为，回归保护） ───
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          {
            id: 7002,
            name: '免费歌',
            ar: [{ id: 1, name: '某歌手' }],
            al: { id: 71, name: '某专辑', picUrl: 'https://alb.example.com/71.jpg' },
            dt: 200000,
            privilege: { id: 7002, pl: 320000, fee: 0 },
          },
        ],
      },
    }));
    const tracks = await prov.search(SESSION, '免费歌', 30);
    restore();
    assert.strictEqual(tracks[0].vipLocked, false, 'pl>0 且 fee=0 → 不锁（保留旧行为）');
    console.log('✅ 15b. search pl>0 + fee=0 → vipLocked=false（回归）');
  }

  // ── 15c. search: pl>0 + fee=8（VIP 付费单曲）→ 一律锁 ───────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          {
            id: 7003,
            name: 'VIP 单曲',
            ar: [{ id: 1, name: '某歌手' }],
            al: { id: 72, name: '某专辑', picUrl: 'https://alb.example.com/72.jpg' },
            dt: 220000,
            privilege: { id: 7003, pl: 999000, fee: 8 },
          },
        ],
      },
    }));
    const tracks = await prov.search(SESSION, 'VIP单曲', 30);
    restore();
    assert.strictEqual(
      tracks[0].vipLocked,
      true,
      'pl=999000 + fee=8（VIP 付费单曲）→ 一律锁',
    );
    console.log('✅ 15c. search pl>0 + fee=8 → vipLocked=true');
  }

  // ── 15d. search: privilege 缺失 → 非 VIP 兜底锁 ────────────────
  // 沿用旧 enrichment 的「未知 = 不能播」规则：privilege 缺失时非 VIP
  // 一律锁（保守）；SESSION 无 neteaseVip → 视为非 VIP → vipLocked=true。
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          {
            id: 7004,
            name: '权限缺失的歌',
            ar: [{ id: 1, name: '某歌手' }],
            al: { id: 73, name: '某专辑' },
            dt: 180000,
            // privilege 完全缺失
          },
        ],
      },
    }));
    const tracks = await prov.search(SESSION, '权限缺失', 30);
    restore();
    assert.strictEqual(tracks.length, 1, 'privilege 缺失不应阻塞 tracks');
    assert.strictEqual(
      tracks[0].vipLocked,
      true,
      'privilege 缺失 + 非 VIP session → 保守锁',
    );
    console.log('✅ 15d. search privilege 缺失 + 非 VIP → vipLocked=true（兜底）');
  }

  // ── 15e. search: privilege 缺失 → VIP session 不锁 ─────────────
  {
    const restore = mockFetch(() => ({
      code: 200,
      result: {
        songs: [
          { id: 7005, name: 'VIP 权限缺失歌', ar: [{ id: 1, name: '某歌手' }], dt: 180000 },
        ],
      },
    }));
    const tracks = await prov.search(
      { musicU: 'x', csrfToken: 'y', neteaseVip: true },
      'VIP权限缺失',
      30,
    );
    restore();
    assert.strictEqual(tracks[0].vipLocked, false, 'privilege 缺失 + VIP → 不锁');
    console.log('✅ 15e. search privilege 缺失 + VIP → vipLocked=false');
  }

  // ── 16. search: 非 200 code（405 风控）→ 显式抛错 ──────────────
  // 回归：/api/search/get/web 对登录态返回 {code:405,msg:"操作频繁"}，
  // 旧代码 result 缺失 → 静默当 0 首，用户看到"暂无结果"误以为歌不存在。
  {
    const restore = mockFetch(() => ({
      code: 405,
      msg: '操作频繁，请稍候再试',
    }));
    let threw = false;
    try {
      await prov.search(SESSION, '浓缩蓝鲸', 30);
    } catch (err) {
      threw = true;
      assert.ok(
        /405/.test((err as Error).message) && /操作频繁/.test((err as Error).message),
        `错误信息应带 code 和 msg，实际: ${(err as Error).message}`,
      );
    }
    restore();
    assert.ok(threw, 'code!==200 应抛错而不是返回 []');
    console.log('✅ 16. search: code=405（风控）→ 显式抛错，不静默空列表');
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

  // ── 29. fetchSongUrl: 非数字 songId → throws BadRequestException ──
  // ISSUES.md §3.1：旧实现 `Number('track-id-001') === NaN`，拼 ids=[NaN]
  // 网易云 API 必返 400 → controller 502。parseInt 校验失败应早抛。
  {
    const restore = mockFetch(() => ({ code: 200, data: [{ id: 1, url: 'x' }] }));
    let threw = false;
    try {
      await prov.getStreamPath(SESSION, 'track-id-001');
    } catch (e: any) {
      threw = true;
      assert.ok(
        /netease songId 必须可解析为数字/.test(e.message),
        `应抛 BadRequestException，实际: ${e.message}`,
      );
    } finally {
      restore();
    }
    assert.ok(threw, '非数字 songId 应抛 BadRequestException');
    console.log('✅ 29. fetchSongUrl: 非数字 songId → throws BadRequestException');
  }

  // ── 30. fetchSongUrl: 数字字符串（带前导零）→ 正常解析 ───────────
  // 防御性 cast 不应误杀合法数字字符串（parseInt 会剥前导零，API 接受）。
  // apiCall 用 application/x-www-form-urlencoded 转发 payload，所以
  // body 里 ids=`[6003]` 经 URLSearchParams 编码为 `ids=%5B6003%5D`。
  {
    let receivedIds: string | undefined;
    const restore = mockFetch((url, opts) => {
      const body = String((opts as any)?.body ?? '');
      // URL-encoded: ids=%5B6003%5D → 解码后 [6003]
      const m = body.match(/ids=([^&]*)/);
      if (m) {
        receivedIds = decodeURIComponent(m[1]);
      }
      return {
        code: 200,
        data: [{ id: 6003, url: 'http://x', br: 128000, size: 1 }],
      };
    });
    await prov.getStreamPath(SESSION, '06003');
    restore();
    assert.strictEqual(receivedIds, '[6003]', '前导零应被 parseInt 剥离');
    console.log('✅ 30. fetchSongUrl: 数字字符串（带前导零）→ 正常解析');
  }

  // ── 31. 超时缺席：fetch 永不 resolve → withTimeout 5s 后返回 null ──
  {
    const { withTimeout } = require('../common/timeout');
    const real = globalThis.fetch;
    (globalThis as any).fetch = async () => new Promise(() => {}); // 永不 resolve
    const start = Date.now();
    const r = await withTimeout(
      () => prov.search(SESSION, 'test', 20),
      5_000,
      () => {},
    );
    const elapsed = Date.now() - start;
    globalThis.fetch = real;
    assert.strictEqual(r, null, '挂起的 search 应在 5s 后被 withTimeout 兜底为 null');
    assert.ok(elapsed >= 4500 && elapsed < 7000, `应等待约 5s，实际 ${elapsed}ms`);
    console.log(`✅ 31. 超时缺席：fetch 永不 resolve → withTimeout 5s 后 null（${elapsed}ms）`);
  }

  // ── 32. fetchLiked 超时缺席 ──
  {
    const { withTimeout } = require('../common/timeout');
    const real = globalThis.fetch;
    (globalThis as any).fetch = async () => new Promise(() => {}); // 永不 resolve
    const start = Date.now();
    const r = await withTimeout(
      () => prov.fetchLiked(SESSION, 100),
      5_000,
      () => {},
    );
    const elapsed = Date.now() - start;
    globalThis.fetch = real;
    assert.strictEqual(r, null, '挂起的 fetchLiked 应在 5s 后被 withTimeout 兜底为 null');
    assert.ok(elapsed >= 4500 && elapsed < 7000, `应等待约 5s，实际 ${elapsed}ms`);
    console.log(`✅ 32. fetchLiked 超时缺席：withTimeout 5s 后 null（${elapsed}ms）`);
  }

  console.log('\n🎉 netease.provider.test 全部 36 项通过');
}

main().catch((err) => {
  console.error('❌ netease.provider.test 失败:', err);
  process.exit(1);
});
