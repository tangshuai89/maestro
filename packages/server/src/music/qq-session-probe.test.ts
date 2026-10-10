/**
 * QQ 登录态探针单测（spec: specs/auth-resilience Phase 10 / tasks 0.4、0.5）。
 *
 * 重点锁两件事：
 *  1. 判据只看 purl / vkey 非空，**不解析任何错误码**
 *  2. 保守原则 —— 网络异常/超时/非 JSON 一律 alive:true（宁可漏报不可误报）
 *
 * 运行: npx ts-node packages/server/src/music/qq-session-probe.test.ts
 */
export {};
const assert = require('node:assert');

const { probeQqSessionUncached, SessionProbeCache } = require('./qq-session-probe');

const COOKIE = 'qqmusic_uin=123; qm_keyst=abc';
const UIN = '123';

function mockFetch(handler: (url: string, opts?: any) => any) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts?: any) => {
    const out = handler(String(url), opts);
    // 显式形态：handler 想要控制 Response 行为时自己给 { json|text|throw }
    if (out && typeof out === 'object' && ('json' in out || 'text' in out)) {
      return out as any;
    }
    // 特殊标记：模拟「QQ 返回 HTML 错误页」—— json() 会真的抛
    if (out === '__HTML__') {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as any;
    }
    return { ok: true, status: 200, json: async () => out } as any;
  }) as any;
  return () => {
    globalThis.fetch = real;
  };
}

// mock 条目必须带探针 songmid —— 实现按 songmid 精确过滤（PROBE_SONGMIDS
// 集合），不带 songmid 的条目会被当作"异常响应"忽略 → network_error。
const PROBE_A = '004Gq0xE1YC8xp'; // 晴天
const PROBE_B = '0002g2BF46I7K7'; // 演员
const PROBE_C = '003ypljX44Gq1I'; // 小情歌

const vkey = (...infos: Record<string, unknown>[]) => ({
  req_0: {
    data: {
      midurlinfo: infos.map((x, i) => ({
        songmid: [PROBE_A, PROBE_B, PROBE_C][i] ?? PROBE_A,
        ...x,
      })),
    },
  },
});

async function main() {
  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ── 1. purl 非空 → alive ──────────────────────────────────
  {
    const restore = mockFetch(() => vkey({ purl: 'C400abc.m4a', vkey: 'V1' }));
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true);
    assert.strictEqual(r.reason, 'purl_present');
    assert.strictEqual(r.fetched, true);
    ok('1. purl 非空 → alive (purl_present)');
  }

  // ── 2. purl 空但 vkey 非空 → 仍 alive（不要误报过期）─────
  {
    const restore = mockFetch(() => vkey({ purl: '', vkey: 'V1', errtype: '' }));
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true, 'vkey 有就是 QQ 认这个登录态');
    assert.strictEqual(r.reason, 'vkey_present');
    ok('2. purl 空 / vkey 非空 → alive（避免把「这首歌受限」误报成过期）');
  }

  // ── 3. 两者皆空 → 判定失效 ──────────────────────────────
  {
    const restore = mockFetch(() => vkey({ purl: '', vkey: '', errtype: '', result: 104003 }));
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, false);
    assert.strictEqual(r.reason, 'no_vkey');
    ok('3. purl / vkey 皆空 → 判定失效 (no_vkey)');
  }

  // ── 4. 保守：网络异常 / 非 JSON / 结构缺失 → alive ────────
  {
    for (const [label, impl] of [
      [
        'fetch throw',
        () => {
          throw new Error('ECONNRESET');
        },
      ],
      ['返回 HTML 错误页(json 抛)', () => '__HTML__'],
      ['结构缺失 midurlinfo', () => ({ req_0: { data: {} } })],
      ['req_0 整个缺失', () => ({})],
    ] as [string, () => any][]) {
      const restore = mockFetch(impl as any);
      let r: any = null;
      try {
        r = await probeQqSessionUncached(COOKIE, UIN);
      } catch {
        r = null;
      }
      restore();
      // fetch throw 会冒出来，调用方负责兜；这里只保证"不该被判成 no_vkey"
      assert.ok(
        r === null || r.alive === true,
        `${label} 不得被判成登录失效，实际: ${JSON.stringify(r)}`,
      );
    }
    ok('4. 网络异常 / 非 JSON / 结构缺失 → 不误报失效（保守）');
  }

  // ── 5. 无 cookie / uin → 未登录，不是"过期" ─────────────
  {
    const a = await probeQqSessionUncached('', UIN);
    assert.strictEqual(a.alive, false);
    assert.strictEqual(a.reason, 'no_cookie');
    assert.strictEqual(a.fetched, false, '没凭据不该发请求');
    const b = await probeQqSessionUncached(COOKIE, '');
    assert.strictEqual(b.alive, false);
    assert.strictEqual(b.reason, 'no_cookie');
    ok('5. 无 cookie / uin → no_cookie（未登录 ≠ 过期）');
  }

  // ── 6. 判据不依赖错误码：result 任意值但有 purl 就 alive ──
  {
    const restore = mockFetch(() =>
      vkey({ purl: 'x.m4a', vkey: 'V', errtype: 1000, result: 99999 }),
    );
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true, '有 purl 就该 alive，不看 errtype/result');
    ok('6. 判据不依赖错误码（errtype/result 任意值，有 purl 即 alive）');
  }

  // ── 7. 多歌共识：任一探针歌存活 → alive（Phase 11 P11-1）────
  {
    // 模拟「探针歌 A 被下架/转 VIP」：A、C 皆空，B 出 purl → 仍 alive。
    const restore = mockFetch(() =>
      vkey(
        { songmid: PROBE_A, purl: '', vkey: '', result: 104003 },
        { songmid: PROBE_B, purl: 'x.m4a', vkey: 'V', result: 0 },
        { songmid: PROBE_C, purl: '', vkey: '', result: 104003 },
      ),
    );
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true, '一首探针歌存活即 alive，单首受限不能判死会话');
    assert.strictEqual(r.reason, 'purl_present');
    ok('7. 多歌共识：A/C 空 + B 有 purl → alive（单首受限不误报）');
  }

  // ── 8. 多歌共识：三首皆空 → no_vkey ────────────────────────
  {
    const restore = mockFetch(() =>
      vkey(
        { songmid: PROBE_A, purl: '', vkey: '', result: 104003 },
        { songmid: PROBE_B, purl: '', vkey: '', result: 104003 },
        { songmid: PROBE_C, purl: '', vkey: '', result: 104003 },
      ),
    );
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, false);
    assert.strictEqual(r.reason, 'no_vkey');
    ok('8. 多歌共识：三首皆空 → 判定失效 (no_vkey)');
  }

  // ── 9. 多歌共识：只有 vkey 的探针歌救场 → vkey_present ────
  {
    const restore = mockFetch(() =>
      vkey(
        { songmid: PROBE_A, purl: '', vkey: '' },
        { songmid: PROBE_B, purl: '', vkey: 'V9' },
        { songmid: PROBE_C, purl: '', vkey: '' },
      ),
    );
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true);
    assert.strictEqual(r.reason, 'vkey_present');
    ok('9. 多歌共识：仅 vkey 非空 → alive (vkey_present)');
  }

  // ── 10. 响应里没有探针歌条目 → 探针故障，保守 alive ────────
  {
    const restore = mockFetch(() => ({
      req_0: { data: { midurlinfo: [{ songmid: 'OTHER_MID', purl: '', vkey: '' }] } },
    }));
    const r = await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.strictEqual(r.alive, true, '探针歌零回声 = 探针没读懂响应，不得判死');
    assert.strictEqual(r.reason, 'network_error');
    ok('10. 响应无探针歌条目 → network_error（保守 alive）');
  }

  // ── 11. 批量请求体：一次请求打了全部探针歌 ─────────────────
  {
    let sentMids: string[] = [];
    const restore = mockFetch((_url, opts) => {
      sentMids = JSON.parse(opts.body).req_0.param.songmid;
      return vkey({ songmid: PROBE_A, purl: 'x.m4a', vkey: 'V' });
    });
    await probeQqSessionUncached(COOKIE, UIN);
    restore();
    assert.deepStrictEqual(sentMids, [PROBE_A, PROBE_B, PROBE_C],
      '应一次请求批量打 3 首探针歌（不增请求数）');
    ok('11. 单次请求批量携带 3 个探针 songmid');
  }

  // ══════════════════════════════════════════════════════
  // 缓存
  // ══════════════════════════════════════════════════════
  {
    const cache = new SessionProbeCache(10 * 60 * 1000);
    let calls = 0;
    const fn = async () => {
      calls++;
      return { alive: true, reason: 'purl_present', fetched: true } as const;
    };
    const a = await cache.resolve('s1', fn);
    const b = await cache.resolve('s1', fn);
    assert.strictEqual(calls, 1, '第二次应命中缓存，不发请求');
    assert.strictEqual(a.fetched, true);
    assert.strictEqual(b.fetched, false, '命中缓存时 fetched=false');
    ok('12. 缓存命中不发请求（fetched=false）');
  }
  {
    // TTL 过期 → 重探
    let now = 1_000_000;
    const cache = new SessionProbeCache(1000, () => now);
    let calls = 0;
    const fn = async () => {
      calls++;
      return { alive: true, reason: 'purl_present' as const, fetched: true };
    };
    await cache.resolve('s1', fn);
    now += 500; // 未过期
    await cache.resolve('s1', fn);
    assert.strictEqual(calls, 1, 'TTL 内不重探');
    now += 600; // 已过期（>1000）
    await cache.resolve('s1', fn);
    assert.strictEqual(calls, 2, 'TTL 过期后应重探');
    ok('13. TTL 过期后重探');
  }
  {
    // 不同 session 隔离
    const cache = new SessionProbeCache(10 * 60 * 1000);
    let a = 0,
      b = 0;
    await cache.resolve('s1', async () => {
      a++;
      return { alive: true, reason: 'purl_present', fetched: true };
    });
    await cache.resolve('s2', async () => {
      b++;
      return { alive: false, reason: 'no_vkey', fetched: true };
    });
    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);
    assert.strictEqual(cache.size, 2, '两个 session 各自缓存');
    ok('14. 不同 session 缓存隔离');
  }
  {
    // 并发单飞：同 key 同时 resolve 只发一个请求
    const cache = new SessionProbeCache(10 * 60 * 1000);
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { alive: true, reason: 'purl_present' as const, fetched: true };
    };
    const [x, y, z] = await Promise.all([
      cache.resolve('s1', slow),
      cache.resolve('s1', slow),
      cache.resolve('s1', slow),
    ]);
    assert.strictEqual(calls, 1, '并发同 key 只发一个请求（单飞）');
    assert.strictEqual(x.alive, true);
    assert.strictEqual(y.alive, true);
    assert.strictEqual(z.alive, true);
    ok('15. 并发同 key 单飞（播放失败的多条兜底路径不会连打 QQ）');
  }

  console.log(`\n${pass} 个用例全部通过 ✅`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
