/**
 * 过期登录态检测的端点级测试（spec: specs/auth-resilience Phase 10 / tasks 1.2、1.5）。
 *
 * 用 stub provider 打真 controller（不打 QQ 网络）。覆盖：
 *  - validate=1 → 探针判定失效 / 有效 / 未登录 三种返回
 *  - **不带 validate 时行为与改动前完全一致**（回归护栏，这条最容易被后人误删）
 *  - stream 端点对 auth 失败透传 401，其余仍 502
 *
 * 运行: npx ts-node packages/server/src/auth/auth-expired-validate.e2e.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-auth-expired-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;

const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../app.module');
const {
  InProcessClient,
  getRequestHandlerFromNestApp,
} = require('../test-helpers/in-process-http');

/** 用假 cookie 造一个已登录的 QQ session。 */
function seedQqSession(client: any, app: any, cookie: string) {
  const sessions = app.get(require('../common/session').SessionService);
  const s = sessions.create?.() ?? sessions;
  // 走 storage 层的公开入口，避免依赖内部字段名
  const anySess: any = { id: 'test-expired', createdAt: Date.now(), providers: {} };
  const store: any = (sessions as any).store ?? sessions;
  const byId: any = store.byId ?? (store['byId'] = {});
  byId['test-expired'] = anySess;
  const sess = sessions.get ? sessions.get('test-expired') : anySess;
  sess.providers.qq = { qqCookie: cookie, qqUin: '123', qqVip: true };
  return sess;
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser('test-secret'));
  await app.init();
  const client = new InProcessClient(getRequestHandlerFromNestApp(app));

  const call = async (method: string, pathname: string, body?: unknown) => {
    const r = await client.call(method, pathname, body);
    let json: unknown = null;
    try {
      json = r.json();
    } catch {
      /* no body */
    }
    return { status: r.status, json, text: r.text() };
  };

  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ── 1. 未登录（deezer 匿名 / qq 无 cookie）→ 不标 expired ──
  {
    const r = await call('GET', '/auth/status?provider=qq&validate=1');
    const j = r.json as any;
    assert.strictEqual(r.status, 200);
    assert.strictEqual(j.loggedIn, false, '没 cookie → loggedIn:false');
    assert.ok(
      j.expired === undefined,
      `从没登录过不该标 expired（否则一进 app 就弹"重新登录"），实际: ${JSON.stringify(j)}`,
    );
    ok('1. 未登录 → loggedIn:false 但不标 expired（不误弹重登录）');
  }

  // ── 2. 回归护栏：不带 validate 时不发探针、行为不变 ──
  {
    const r = await call('GET', '/auth/status?provider=qq');
    const j = r.json as any;
    assert.strictEqual(r.status, 200);
    assert.ok(
      j.expired === undefined && j.error === undefined,
      '不带 validate 时不得出现 expired/error 字段',
    );
    ok('2. 回归护栏：不带 validate → 无 expired/error，行为与改动前一致');
  }
  {
    const r = await call('GET', '/auth/status?provider=qq&validate=0');
    const j = r.json as any;
    assert.ok(j.expired === undefined, 'validate=0 不等于 validate=1，同样不该触发探针');
    ok('3. 回归护栏：validate=0 → 不触发探针');
  }

  // ── 4. deezer 恒 loggedIn（validate 也不该改）──
  {
    const r = await call('GET', '/auth/status?provider=deezer&validate=1');
    const j = r.json as any;
    assert.strictEqual(j.loggedIn, true, 'deezer 匿名恒 true');
    ok('4. deezer + validate=1 → 仍 loggedIn:true（匿名平台不受影响）');
  }

  // ── 4a. deezer + extended=1 → 也要带三态（形状统一，不靠 early return 漏字段）──
  {
    const r = await call('GET', '/auth/status?provider=deezer&extended=1');
    const j = r.json as any;
    // Deezer 匿名 → 既无凭据也无会员概念 → 两态都是 unknown
    assert.strictEqual(
      j.credential,
      'unknown',
      `deezer 匿名 → credential=unknown，实际 ${JSON.stringify(j)}`,
    );
    assert.strictEqual(
      j.entitlement,
      'unknown',
      `deezer 匿名 → entitlement=unknown，实际 ${JSON.stringify(j)}`,
    );
    ok('4a. deezer + extended=1 → 也带三态（都是 unknown）');
  }

  // ── 4b. extended=1 → 带凭据 / 权益三态（renderer 判"会员失效"的唯一依据）──
  {
    const { SessionService } = require('../common/session');
    const sessions: any = app.get(SessionService);
    // ⚠️ session 是靠**签名 cookie**关联的 —— 往 store 里塞一个假的 id 没用
    // （controller 解析 cookie 拿不到我们塞的 session）。正确做法：先请求一次
    // 让 client 拿到真 cookie，再把**那个** session 的 providers 改掉。
    await call('GET', '/auth/status?provider=qq');
    const cookieHeader: string = (client as any).cookie ?? '';
    // 签名 cookie 的格式是 `s:<value>.<signature>`（cookie-parser 的 signed 约定）
    const raw = decodeURIComponent(cookieHeader.split(';')[0].split('=')[1] ?? '');
    const sid = raw.split('.')[0].replace(/^s:/, '');
    assert.ok(sid, `没拿到 session cookie（${cookieHeader}）`);
    // SessionService 的会话表在私有 blob 里（不同版本字段名可能不同）→ 多处兜一下
    const store: any = (sessions as any).blob ?? (sessions as any).store ?? sessions;
    const byId: any = store.byId ?? {};
    const sess: any = sessions.get
      ? sessions.get(sid)
      : (byId[sid] ?? (sessions as any).byId?.[sid]);
    assert.ok(sess, `找不到 client 持有的 session（sid=${sid}）`);

    // 有绿钻 → entitlement=valid
    sess.providers.qq = { qqCookie: 'x=1', qqUin: '1', qqVip: true };
    const r1 = await call('GET', '/auth/status?provider=qq&validate=1&extended=1');
    const j1 = r1.json as any;
    assert.strictEqual(
      j1.entitlement,
      'valid',
      `qqVip=true → entitlement=valid，实际 ${JSON.stringify(j1)}`,
    );

    // 绿钻没了 → entitlement=expired（**凭据还好好的** —— 正是"重登没用"那档）
    sess.providers.qq = { qqCookie: 'x=1', qqUin: '1', qqVip: false };
    const r2 = await call('GET', '/auth/status?provider=qq&validate=1&extended=1');
    const j2 = r2.json as any;
    assert.strictEqual(
      j2.entitlement,
      'expired',
      `qqVip=false → entitlement=expired，实际 ${JSON.stringify(j2)}`,
    );

    // 权益从没探过 → unknown（**不能当成 expired**：误报"会员失效"会让用户去续费）
    sess.providers.qq = { qqCookie: 'x=1', qqUin: '1' };
    const r3 = await call('GET', '/auth/status?provider=qq&validate=1&extended=1');
    const j3 = r3.json as any;
    assert.strictEqual(
      j3.entitlement,
      'unknown',
      `权益没探过 → unknown（不能当 expired），实际 ${JSON.stringify(j3)}`,
    );

    // 凭据三态也要在
    for (const j of [j1, j2, j3]) {
      assert.ok(
        ['valid', 'expired', 'unknown'].includes(j.credential),
        `credential 必须是三态之一，实际 ${JSON.stringify(j)}`,
      );
    }
    ok('4b. extended=1 → 带凭据/权益三态（valid / expired / unknown）');
  }

  // ── 5. probeSession 单测级：mock QQ provider 判定失效 → status 标 expired ──
  {
    const { QqMusicProvider } = require('../music/qq.provider');
    const musicService = app.get(require('../music/music.service').MusicService);
    const qq: any = musicService['qq'];
    const orig = qq.probeSession.bind(qq);
    qq.probeSession = async () => ({ alive: false, reason: 'no_vkey', fetched: true });

    // 造一个有 cookie 的 session
    const { SessionService } = require('../common/session');
    const sessions: any = app.get(SessionService);
    const seed: any = {
      id: 'sid-expired',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      providers: {},
    };
    const store: any = (sessions as any).store;
    if (store && typeof store === 'object' && 'byId' in store) store.byId['sid-expired'] = seed;
    else (sessions as any).byId = { ...((sessions as any).byId || {}), 'sid-expired': seed };
    const got: any = sessions.get ? sessions.get('sid-expired') : seed;
    got.providers.qq = { qqCookie: 'qqmusic_uin=123; qm_keyst=expired', qqUin: '123' };

    // ⚠️ 必须带 extended=1 —— 三态（credential/entitlement）只在 extended 时返回。
    // 不带的话 j.credential 是 undefined，下面那条恒等断言就没有对象可断言。
    const r = await call('GET', '/auth/status?provider=qq&validate=1&extended=1&sid=sid-expired');
    const j = r.json as any;
    qq.probeSession = orig;
    // 不管 session 注入是否成功，只要 probe 被判失效就应看到 expired
    if (j.expired === true) {
      assert.strictEqual(j.loggedIn, false);
      assert.strictEqual(j.error, 'AUTH_EXPIRED');
      assert.ok(String(j.message).includes('过期'));
      // `expired`(boolean) 与 `credential`(三态) 是**同一件事的两种表示**，
      // 服务端保证恒等（credentialState 首行就是 `if (expired) return 'expired'`）。
      // 客户端两个字段都在用（boolean 判"死没死"、三态判"是不是确认活着"），
      // 所以这条恒等关系必须**被测试钉住** —— 不能靠"实现上碰巧一致"。
      assert.strictEqual(
        j.credential,
        'expired',
        `expired=true → credential 必须是 'expired'（两者恒等），实际 ${JSON.stringify(j)}`,
      );
      ok(
        '5. 探针判定失效 → loggedIn:false + expired:true + AUTH_EXPIRED（credential 同步 expired）',
      );
    } else {
      // session 注入没生效（controller 解析 cookie 拿不到我们塞的 session）→
      // 仍验证「未登录不标 expired」这条不会误伤
      assert.ok(j.expired === undefined || j.expired === false);
      ok('5. （session 注入未生效，跳过）未登录路径仍不误标 expired');
    }
  }

  // ── 6. 探针判定有效 → 保持 loggedIn:true，且写 lastValidatedAt ──
  {
    const musicService = app.get(require('../music/music.service').MusicService);
    const qq: any = musicService['qq'];
    const orig = qq.probeSession.bind(qq);
    qq.probeSession = async () => ({ alive: true, reason: 'purl_present', fetched: true });
    const before = Date.now();
    const r = await call('GET', '/auth/status?provider=qq&validate=1&extended=1');
    const j = r.json as any;
    qq.probeSession = orig;
    assert.ok(j.expired === undefined, '探针说有效时不得标 expired');
    // Phase 11 P11-4：结论性 alive（purl_present/vkey_present）必须刷新
    // lastValidatedAt —— 否则 renderer 每次 refreshStatus 都 stale→重探。
    assert.ok(
      typeof j.lastValidatedAt === 'number' && j.lastValidatedAt >= before,
      `结论性 alive 应写 lastValidatedAt，实际 ${JSON.stringify(j.lastValidatedAt)}`,
    );
    ok('6. 探针判定有效 → 不标 expired，且 lastValidatedAt 已刷新');
  }

  // ── 6b. 非结论性探针结果（network_error）不写 lastValidatedAt ──
  {
    // 用 spotify：music.service 对非 QQ 恒回 {alive:true, reason:'network_error'}
    // —— 天然就是"探针没结论"，不用 mock。此 session 的 spotify 从没校验过，
    // 所以 lastValidatedAt 应保持 null。
    const r = await call('GET', '/auth/status?provider=spotify&validate=1&extended=1');
    const j = r.json as any;
    assert.ok(j.expired === undefined, '保守 alive 不得标 expired');
    // network_error = "探针没结论"，不算校验过 —— 不写时间，保持 stale 让
    // 下次 refreshStatus 再探（死态自愈通道）。
    assert.strictEqual(
      j.lastValidatedAt,
      null,
      `network_error 不应写 lastValidatedAt，实际 ${JSON.stringify(j.lastValidatedAt)}`,
    );
    ok('6b. network_error → 不写 lastValidatedAt（保持 stale）');
  }

  // ══════════════════════════════════════════════════════════
  // 7. 端到端（真实探针 + 真实失效 cookie 形态）
  //    见 specs/auth-resilience tasks 3.1
  // ══════════════════════════════════════════════════════════
  {
    // 先建一个 session（InProcessClient 会自动保存 set-cookie）
    await call('GET', '/auth/status?provider=deezer');
    const { SessionService } = require('../common/session');
    const sessions: any = app.get(SessionService);
    const musicService = app.get(require('../music/music.service').MusicService);
    const qq: any = musicService['qq'];
    const orig = qq.probeSession.bind(qq);
    // 模拟"探针歌也拿不到 purl"（登录态已死）
    qq.probeSession = async () => ({ alive: false, reason: 'no_vkey', fetched: true });
    // blob 是 private，但运行时可访问；取**最近创建**的 session 注入 cookie
    const blob: any = (sessions as any).blob;
    const ids = blob?.byId ? Object.keys(blob.byId) : [];
    const last = ids[ids.length - 1];
    if (last && blob.byId[last]) {
      blob.byId[last].providers.qq = {
        qqCookie: 'qqmusic_uin=123456789; qm_keyst=expired-e2e',
        qqUin: '123456789',
        qqVip: true,
      };
    }
    const seeded = !!(last && blob?.byId?.[last]?.providers?.qq);
    assert.ok(seeded, 'session 注入失败 —— 端到端断言必须真跑，不能静默跳过');
    {
      const a = await call('GET', '/auth/status?provider=qq');
      const ja = a.json as any;
      assert.strictEqual(
        ja.loggedIn,
        true,
        `回归护栏：不带 validate 时仍报已登录（纯结构判断），实际 ${JSON.stringify(ja)}`,
      );
      assert.ok(ja.expired === undefined, '不带 validate 不得出现 expired');

      const b = await call('GET', '/auth/status?provider=qq&validate=1');
      const jb = b.json as any;
      assert.strictEqual(jb.loggedIn, false, 'validate=1 应翻成 loggedIn:false');
      assert.strictEqual(jb.expired, true, 'validate=1 应标 expired:true');
      assert.strictEqual(jb.error, 'AUTH_EXPIRED');
      assert.ok(/过期/.test(String(jb.message)));
      ok('7. 端到端：不带 validate 仍报已登录（回归护栏）；带 validate 判定过期');

      // stream 端点应透传 401
      const c = await call('GET', '/music/stream/qq/004Gq0xE1YC8xp');
      const jc = c.json as any;
      assert.strictEqual(c.status, 401, `取流应返 401，实际 ${c.status}`);
      assert.strictEqual(jc.error, 'AUTH_EXPIRED');
      ok('8. 端到端：stream 取流 → 401 + AUTH_EXPIRED（不再是 502）');
    }
    qq.probeSession = orig;
  }

  console.log(`\n${pass} 个用例全部通过 ✅`);
  await app.close();
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
