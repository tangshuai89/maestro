/**
 * 回归测试：ensureQqVip 在「VIP 探测返回 false」时必须先用登录态探针复核——
 * cookie 失效 / 接口抖动也会让 VIP 曲返回空 purl，不能把「登录过期」误记成
 * 「非会员」并持久化 qqVip=false。
 *
 * 背景 bug（2026-10-14 报障）：QQ cookie 掉线后搜索时 probeVipAccess 返回
 * false → qqVip=false 落库 → 所有 QQ 歌曲标 vipLocked → selectBestSource
 * 直接选 Deezer/Spotify 30s 预览 → 永远走不到 getStreamPath 的 AUTH_EXPIRED
 * 分支，用户只见 30s 试听、不见「请重新登录」。
 *
 * 直接 new MusicService + stub provider（不打真实网络），用 `(svc as any)`
 * 调私有方法 ensureQqVip。
 *
 * 运行: npx ts-node src/music/qq-vip-probe-guard.test.ts
 */
export {};
const assert = require('node:assert');

const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');

const fakeStorage = {
  get: () => undefined,
  set: () => {},
};

const lyricsOvh = { getLyrics: async () => null };
const netease = { search: async () => [] };
const deezer = { search: async () => [] };
const spotify = { search: async () => [] };
const match = {};
const likeSync = {
  registerProcessor: () => {},
  registerDiscoverResolver: () => {},
  enqueue: () => {},
};

function makeService(qq: any, sessions?: any) {
  const lyricsService = new LyricsService(qq, netease, deezer, lyricsOvh);
  return new MusicService(
    fakeStorage,
    qq,
    netease,
    deezer,
    spotify,
    lyricsOvh,
    lyricsService,
    match,
    likeSync,
    sessions,
  );
}

function makeSession(): any {
  return {
    id: 'sess-vip-guard',
    createdAt: Date.now(),
    providers: { qq: { qqCookie: 'qm_keyst=test; euin=1' } },
  };
}

async function main() {
  let passed = 0;
  let failed = 0;
  function ok(label: string) {
    console.log(`✅ ${label}`);
    passed++;
  }
  function fail(label: string, msg: string) {
    console.log(`❌ ${label}\n   ${msg}`);
    failed++;
  }

  // ── 1. vip=false + 登录态探针判死 → 不写 qqVip ─────────────────────
  // 这是本次 bug 的核心：掉线 cookie 打 VIP 曲 → 空 purl → vip=false，
  // 但登录态探针同时判死（alive:false）。此时**不得**落 qqVip=false——
  // 否则后续搜索全部 vipLocked，过期状态被永久掩盖。
  {
    const calls: any[] = [];
    const sessions = {
      setProvider: (_s: any, _p: string, data: any) => calls.push(data),
    };
    const qq = {
      probeVipAccess: async () => false,
      probeSession: async () => ({ alive: false, reason: 'no_vkey', fetched: true }),
    };
    const svc = makeService(qq, sessions);
    const session = makeSession();
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(session.providers.qq.qqVip, undefined, '探针判死时 qqVip 不得写入内存对象');
    assert.strictEqual(calls.length, 0, '探针判死时不得调 sessions.setProvider');
    ok('1. vip=false + 探针判死 → qqVip 不写（保持 undefined，过期留给主链路暴露）');
  }

  // ── 2. vip=false + 登录态探针 alive → 写 qqVip=false ───────────────
  // 对照组：真·非会员账号。探针确认会话还活着 → vip=false 是真实结论，写库。
  {
    const calls: any[] = [];
    const sessions = {
      setProvider: (_s: any, _p: string, data: any) => calls.push(data),
    };
    const qq = {
      probeVipAccess: async () => false,
      probeSession: async () => ({ alive: true, reason: 'has_vkey', fetched: true }),
    };
    const svc = makeService(qq, sessions);
    const session = makeSession();
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(calls.length, 1, 'alive 时应调一次 setProvider');
    assert.deepStrictEqual(calls[0], { qqVip: false }, '写入的应是 { qqVip: false }');
    ok('2. vip=false + 探针 alive → qqVip=false 正常持久化（真·非会员不受影响）');
  }

  // ── 3. vip=true → 不跑登录探针，直接写 qqVip=true ──────────────────
  // 有 VIP 权限本身就证明 cookie 有效，不需要多余的登录态复核。
  {
    const calls: any[] = [];
    const sessions = {
      setProvider: (_s: any, _p: string, data: any) => calls.push(data),
    };
    let probeSessionCalled = false;
    const qq = {
      probeVipAccess: async () => true,
      probeSession: async () => {
        probeSessionCalled = true;
        return { alive: true, reason: 'has_vkey', fetched: true };
      },
    };
    const svc = makeService(qq, sessions);
    const session = makeSession();
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(probeSessionCalled, false, 'vip=true 时不应再跑登录探针');
    assert.deepStrictEqual(calls[0], { qqVip: true });
    ok('3. vip=true → 跳过登录探针，直接写 qqVip=true');
  }

  // ── 4. vip=undefined（探测失败）→ 不写，下次重试 ───────────────────
  {
    const calls: any[] = [];
    const sessions = {
      setProvider: (_s: any, _p: string, data: any) => calls.push(data),
    };
    const qq = {
      probeVipAccess: async () => undefined,
      probeSession: async () => {
        throw new Error('should_not_be_called');
      },
    };
    const svc = makeService(qq, sessions);
    const session = makeSession();
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(session.providers.qq.qqVip, undefined);
    assert.strictEqual(calls.length, 0);
    ok('4. vip=undefined（网络失败）→ 不写 qqVip，下次搜索重试');
  }

  // ── 5. qqVip 已知 → ensureQqVip 整体跳过（零开销）──────────────────
  {
    let vipProbeCalled = false;
    const qq = {
      probeVipAccess: async () => {
        vipProbeCalled = true;
        return false;
      },
      probeSession: async () => ({ alive: true, reason: 'has_vkey', fetched: true }),
    };
    const svc = makeService(qq);
    const session = makeSession();
    session.providers.qq.qqVip = true; // 已持久化
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(vipProbeCalled, false, 'qqVip 已知时不得重复探测');
    ok('5. qqVip 已知 → 跳过整个探测（不重复请求）');
  }

  // ── 6. 未登录（无 qqCookie）→ 跳过 ────────────────────────────────
  {
    let vipProbeCalled = false;
    const qq = {
      probeVipAccess: async () => {
        vipProbeCalled = true;
        return false;
      },
      probeSession: async () => ({ alive: false, reason: 'no_cookie', fetched: false }),
    };
    const svc = makeService(qq);
    const session = { id: 's', createdAt: 0, providers: {} };
    await (svc as any).ensureQqVip(session);
    assert.strictEqual(vipProbeCalled, false);
    ok('6. 无 qqCookie → ensureQqVip 跳过');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
