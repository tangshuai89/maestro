/**
 * 跨平台 ❤ 累加（specs/cross-platform-likes）端到端测试。
 *
 * 为什么补这个：功能早已落地（types / provider / searchUnified fire-and-forget /
 * HUD 上标），但**一条测试都没有**——出问题时只能靠手点。本文件锁三层：
 *   A. provider 层：QQ SongFavRead / 网易云 song/detail 的字段映射与错误路径
 *   B. service 层：fillLikeCountsForItems 的填充口径 + 缓存档位 + 超时降级
 *   C. 缓存不变量：干净缺席（null）也缓存、失败不缓存、跨 session 不串号
 *
 * 全部 mock fetch / stub provider，不打真实网络。
 * 运行: npx ts-node src/music/cross-platform-likes.e2e.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { QqMusicProvider } = require('./qq.provider');
const { NeteaseMusicProvider } = require('./netease.provider');
const { recomputeCrossPlatformLikeTotal } = require('./search.util');

let passed = 0;
let failed = 0;
async function check(label: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

// ── 辅助：mock global.fetch ──────────────────────────────────────
function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; opts?: any }> = [];
  globalThis.fetch = (async (url: any, opts?: any) => {
    calls.push({ url: String(url), opts });
    return { ok: true, json: async () => handler(String(url), opts) } as any;
  }) as any;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

function src(platform: string, trackId: string, likeCount?: any): any {
  return { platform, trackId, hasCopyright: true, ...(likeCount ? { likeCount } : {}) };
}

function item(...sources: any[]): any {
  return {
    id: 'item-1',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    coverUrl: '',
    duration: 269,
    versionType: 'studio',
    versions: [],
    sources,
    bestSource: sources[0]?.platform ?? null,
  };
}

/** 构造一个只有 likeCount 相关方法被 stub 的 MusicService（其余依赖全 no-op）。 */
function makeService(handlers: {
  qq?: (trackId: string) => Promise<any>;
  netease?: (trackId: string) => Promise<any>;
}) {
  const calls = { qq: [] as string[], netease: [] as string[] };
  const qq = {
    search: async () => [],
    getTrackFavCount: async (_s: any, trackId: string) => {
      calls.qq.push(trackId);
      return handlers.qq ? handlers.qq(trackId) : null;
    },
  };
  const netease = {
    search: async () => [],
    getTrackLikeCount: async (_s: any, trackId: string) => {
      calls.netease.push(trackId);
      return handlers.netease ? handlers.netease(trackId) : null;
    },
  };
  const noop = { search: async () => [], fetchLiked: async () => [] };
  const svc = new MusicService(
    { get: () => undefined, set: () => {}, delete: () => {} } as any,
    qq as any,
    netease as any,
    noop as any,
    noop as any,
    noop as any,
    {} as any,
    {} as any,
    { registerProcessor: () => {}, registerDiscoverResolver: () => {}, enqueue: () => {} } as any,
  );
  return { svc, calls };
}

/** fire-and-forget 的填充没有返回值——轮询等它落定。 */
async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function main() {
  // ═══ A. provider 层 ═══════════════════════════════════════════════
  const qq = new QqMusicProvider();
  // resolveSongId 走真实签名链路（QQ 加密 CGI），这里直接桩掉：mid → 数字 songId。
  (qq as any).resolveSongId = async (_s: any, songmid: string) =>
    songmid === 'bad-mid' ? null : 97773;
  const ne = new NeteaseMusicProvider();

  await check('A1. QQ getTrackFavCount：m_numbers 精确数 + m_show UI 串（"5700w+"）', async () => {
    const m = mockFetch(() => ({
      code: 0,
      result: { code: 0, data: { m_numbers: { 97773: 1000001 }, m_show: { 97773: '5700w+' } } },
    }));
    try {
      const r = await qq.getTrackFavCount({} as any, '0039MnYb0qxYhV');
      assert.deepStrictEqual(r, { count: 1000001, display: '5700w+' });
      assert.ok(m.calls[0].url.includes('musicu.fcg'), '应打 musicu.fcg');
    } finally {
      m.restore();
    }
  });

  await check(
    'A2. QQ getTrackFavCount：缺 m_show → display 回退 count.toLocaleString()',
    async () => {
      const m = mockFetch(() => ({
        code: 0,
        result: { code: 0, data: { m_numbers: { 97773: 1234 } } },
      }));
      try {
        const r = await qq.getTrackFavCount({} as any, '0039MnYb0qxYhV');
        assert.strictEqual(r?.count, 1234);
        assert.strictEqual(r?.display, (1234).toLocaleString());
      } finally {
        m.restore();
      }
    },
  );

  await check(
    'A3. QQ getTrackFavCount：result.code≠0 / count 非数字 → null（不伪造 0）',
    async () => {
      const m1 = mockFetch(() => ({ code: 0, result: { code: 500003, data: {} } }));
      try {
        assert.strictEqual(await qq.getTrackFavCount({} as any, 'mid'), null);
      } finally {
        m1.restore();
      }
      const m2 = mockFetch(() => ({
        code: 0,
        result: { code: 0, data: { m_numbers: { 97773: '很多' }, m_show: {} } },
      }));
      try {
        assert.strictEqual(await qq.getTrackFavCount({} as any, 'mid'), null);
      } finally {
        m2.restore();
      }
    },
  );

  await check('A4. QQ getTrackFavCount：mid 解析不出 songId → null 且不打网络', async () => {
    const m = mockFetch(() => assert.fail('解析失败时不该打网络'));
    try {
      assert.strictEqual(await qq.getTrackFavCount({} as any, 'bad-mid'), null);
      assert.strictEqual(m.calls.length, 0);
    } finally {
      m.restore();
    }
  });

  await check('A5. 网易云 getTrackLikeCount：likedCount → count + 千分位 display', async () => {
    const m = mockFetch(() => ({ code: 200, songs: [{ id: 186016, likedCount: 1173 }] }));
    try {
      const r = await ne.getTrackLikeCount({ musicU: 'x' } as any, '186016');
      assert.strictEqual(r?.count, 1173);
      assert.strictEqual(r?.display, (1173).toLocaleString());
      assert.ok(m.calls[0].url.includes('/api/song/detail?ids='), '应打 song/detail');
    } finally {
      m.restore();
    }
  });

  await check(
    'A6. 网易云 getTrackLikeCount：code≠200 / songs 空 / 无 likedCount → null',
    async () => {
      const cases: any[] = [
        { code: 301, songs: [{ likedCount: 5 }] },
        { code: 200, songs: [] },
        { code: 200, songs: [{ id: 1 }] },
      ];
      for (const body of cases) {
        const m = mockFetch(() => body);
        try {
          assert.strictEqual(await ne.getTrackLikeCount({ musicU: 'x' } as any, '1'), null);
        } finally {
          m.restore();
        }
      }
    },
  );

  await check('A7. 网易云 getTrackLikeCount：fetch 抛错 → 吞掉返回 null（fail-soft）', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as any;
    try {
      assert.strictEqual(await ne.getTrackLikeCount({ musicU: 'x' } as any, '1'), null);
    } finally {
      globalThis.fetch = real;
    }
  });

  // ═══ B. service 层：填充口径 ═══════════════════════════════════════
  const session = { id: 'sess-a', createdAt: 1, providers: {} };

  await check(
    'B1. fillLikeCountsForItems：QQ + 网易云都填上，并重算 crossPlatformLikeTotal',
    async () => {
      const { svc, calls } = makeService({
        qq: async () => ({ count: 1000001, display: '5700w+' }),
        netease: async () => ({ count: 2500, display: '2,500' }),
      });
      const it = item(src('qq', 'q-1'), src('netease', 'n-1'));
      svc.fillLikeCountsForItems(session, [it]);
      await waitFor(() => it.crossPlatformLikeTotal !== undefined);
      assert.deepStrictEqual(it.sources[0].likeCount, {
        count: 1000001,
        display: '5700w+',
        source: 'qq',
      });
      assert.strictEqual(it.sources[1].likeCount.source, 'netease');
      assert.strictEqual(it.crossPlatformLikeTotal.count, 1002501);
      assert.deepStrictEqual(it.crossPlatformLikeTotal.platforms, ['qq', 'netease']);
      assert.deepStrictEqual(calls.qq, ['q-1']);
      assert.deepStrictEqual(calls.netease, ['n-1']);
    },
  );

  await check('B2. fillLikeCountsForItems：Deezer / Spotify 不发请求（无 ❤ 字段）', async () => {
    const { svc, calls } = makeService({});
    const it = item(src('deezer', 'd-1'), src('spotify', 's-1'));
    svc.fillLikeCountsForItems(session, [it]);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(calls, { qq: [], netease: [] });
    assert.strictEqual(it.crossPlatformLikeTotal, undefined);
  });

  await check('B3. fillLikeCountsForItems：已有 likeCount 的 source 不重复拉', async () => {
    const { svc, calls } = makeService({ qq: async () => ({ count: 9, display: '9' }) });
    const it = item(src('qq', 'q-1', { count: 42, display: '42', source: 'qq' }));
    svc.fillLikeCountsForItems(session, [it]);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(calls.qq, [], '已有值不该再打接口');
    assert.strictEqual(it.sources[0].likeCount.count, 42, '原值不被覆盖');
  });

  await check(
    'B4. fillLikeCountsForItems：provider 全返回 null → likeCount 留 undefined 且不崩',
    async () => {
      const { svc } = makeService({ qq: async () => null, netease: async () => null });
      const it = item(src('qq', 'q-2'), src('netease', 'n-2'));
      svc.fillLikeCountsForItems(session, [it]);
      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(it.sources[0].likeCount, undefined, 'null ≠ 0，不能写 0');
      assert.strictEqual(it.crossPlatformLikeTotal, undefined);
    },
  );

  await check(
    'B5. fillLikeCountsForItems：provider throw（Promise.allSettled 兜住）不冒泡',
    async () => {
      const { svc } = makeService({
        qq: async () => {
          throw new Error('boom');
        },
      });
      const it = item(src('qq', 'q-3'), src('netease', 'n-3'));
      svc.fillLikeCountsForItems(session, [it]);
      await new Promise((r) => setTimeout(r, 150));
      assert.strictEqual(it.crossPlatformLikeTotal, undefined);
    },
  );

  await check('B6. 缓存：第二次填充不再打网络（命中 1h 档）', async () => {
    const { svc, calls } = makeService({
      qq: async () => ({ count: 1000001, display: '5700w+' }),
    });
    const a = item(src('qq', 'q-cache'));
    svc.fillLikeCountsForItems(session, [a]);
    await waitFor(() => a.sources[0].likeCount !== undefined);
    const b = item(src('qq', 'q-cache'));
    svc.fillLikeCountsForItems(session, [b]);
    await waitFor(() => b.sources[0].likeCount !== undefined);
    assert.deepStrictEqual(calls.qq, ['q-cache'], '第二次应走缓存');
    assert.strictEqual(b.crossPlatformLikeTotal.count, 1000001, '缓存命中同步落地');
  });

  await check('B7. 缓存：干净缺席（null）也缓存——缺席是稳定事实，别每次重打', async () => {
    const { svc, calls } = makeService({ netease: async () => null });
    const a = item(src('netease', 'n-absent'));
    svc.fillLikeCountsForItems(session, [a]);
    await new Promise((r) => setTimeout(r, 150));
    const b = item(src('netease', 'n-absent'));
    svc.fillLikeCountsForItems(session, [b]);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(calls.netease, ['n-absent'], '缺席只该打一次');
    assert.strictEqual(b.sources[0].likeCount, undefined);
  });

  await check('B8. 缓存不串号：另一个 session 的同一 trackId 会重新拉', async () => {
    const { svc, calls } = makeService({ qq: async () => ({ count: 7, display: '7' }) });
    const other = { id: 'sess-b', createdAt: 2, providers: {} };
    const a = item(src('qq', 'q-shared'));
    svc.fillLikeCountsForItems(session, [a]);
    await waitFor(() => a.sources[0].likeCount !== undefined);
    const b = item(src('qq', 'q-shared'));
    svc.fillLikeCountsForItems(other, [b]);
    await waitFor(() => b.sources[0].likeCount !== undefined);
    assert.deepStrictEqual(calls.qq, ['q-shared', 'q-shared'], 'key 含 sessionId，必须各拉一次');
  });

  await check('B9. 缓存容量：超出上限时 FIFO 淘汰，不无界增长', async () => {
    const { svc } = makeService({ qq: async () => ({ count: 1, display: '1' }) });
    const many = Array.from({ length: 600 }, (_, i) => item(src('qq', `q-flood-${i}`)));
    svc.fillLikeCountsForItems({ id: 'sess-flood', providers: {} } as any, many);
    await waitFor(() => many.filter((it) => it.sources[0].likeCount !== undefined).length > 20);
    const size = (svc as any).likeCountCache.size;
    assert.ok(size <= 512, `缓存应被淘汰到上限内（实际 ${size}）`);
  });

  await check('B10. 缓存失败档：provider reject 不写缓存（下一轮还能重试）', async () => {
    let attempts = 0;
    const { svc, calls } = makeService({
      qq: async () => {
        attempts++;
        if (attempts === 1) throw new Error('transient');
        return { count: 5, display: '5' };
      },
    });
    const a = item(src('qq', 'q-retry'));
    svc.fillLikeCountsForItems({ id: 'sess-retry', providers: {} } as any, [a]);
    await new Promise((r) => setTimeout(r, 150));
    const b = item(src('qq', 'q-retry'));
    svc.fillLikeCountsForItems({ id: 'sess-retry', providers: {} } as any, [b]);
    await waitFor(() => b.sources[0].likeCount !== undefined);
    assert.strictEqual(calls.qq.length, 2, '失败不该被缓存住');
    assert.strictEqual(b.sources[0].likeCount.count, 5);
  });

  await check('B11. 重算口径与 provider 无关：直接调 recompute 即可（service 不重复实现）', () => {
    const it = item(
      src('qq', 'q-1', { count: 3, display: '3', source: 'qq' }),
      src('netease', 'n-1', { count: 4, display: '4', source: 'netease' }),
    );
    recomputeCrossPlatformLikeTotal(it);
    assert.strictEqual(it.crossPlatformLikeTotal?.count, 7);
  });

  console.log(`\n🎉 cross-platform-likes.e2e: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ cross-platform-likes.e2e 失败:', err);
  process.exit(1);
});
