/**
 * NeteaseAuthStrategy 单元测试（mock fetch）。
 *
 * 覆盖：
 *  - qrStart：unikey 成功/失败、QR 生成
 *  - qrCheck：各 code（800/801/802/803）、803 时 Set-Cookie 解析、
 *    MUSIC_U 缺失 → AUTH_INVALID、profile fetch 成功/失败/超时
 *  - loginWithCookie：MUSIC_U 校验、profile guard、VIP 状态
 *  - fetchProfile：code 200/301/其他、异常
 *  - fetchVipStatus：isVip/redVip/redVipLevel 各组合、失败
 *  - devLoginFromEnv
 *
 * 运行: npx ts-node src/auth/netease-auth.strategy.test.ts
 */
export {};
const assert = require('node:assert');
const QRCode = require('qrcode');

// ── mock fetch ────────────────────────────────────────────────
let mockResponses: Array<{ json: any; setCookies?: string[]; status?: number }> = [];
let fetchCallIndex = 0;
let fetchUrls: string[] = [];
let fetchDelay = 0;
(globalThis as any).fetch = async (url: string, opts: any) => {
  fetchUrls.push(url);
  if (fetchDelay > 0) await new Promise((r) => setTimeout(r, fetchDelay));
  const idx = Math.min(fetchCallIndex, mockResponses.length - 1);
  fetchCallIndex++;
  const mock = mockResponses[idx];
  if (!mock) return { json: () => Promise.resolve({}), text: () => Promise.resolve('{}'), headers: { getSetCookie: () => [] }, status: 200 } as any;
  const headers = new Map<string, string>();
  const setCookies = mock.setCookies ?? [];
  return {
    json: () => Promise.resolve(mock.json),
    text: () => Promise.resolve(JSON.stringify(mock.json)),
    status: mock.status ?? 200,
    headers: {
      getSetCookie: () => setCookies,
    },
  } as any;
};

function reset() {
  mockResponses = [];
  fetchCallIndex = 0;
  fetchUrls = [];
  fetchDelay = 0;
}

let passed = 0;
let failed = 0;
function ok(label: string) { console.log(`✅ ${label}`); passed++; }
function fail(label: string, msg: string) { console.log(`❌ ${label}\n   ${msg}`); failed++; }
async function test(label: string, fn: () => Promise<void>) {
  try { await fn(); ok(label); } catch (e: any) {
    fail(label, e?.message ?? String(e));
  }
}
function expect(label: string, cond: boolean, detail = '') {
  if (cond) ok(label); else fail(label, detail);
}

// Mock ConfigService
function makeConfig(neteaseMusicU?: string) {
  return { neteaseMusicU: neteaseMusicU ?? '' } as any;
}

const { NeteaseAuthStrategy } = require('./netease-auth.strategy');

async function main() {
  // ── 1. qrStart：成功 ─────────────────────────────────────────
  reset();
  mockResponses = [{ json: { code: 200, unikey: 'test-unikey-123' } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrStart();
    expect('1. qrStart key = "test-unikey-123"', result.key === 'test-unikey-123');
    expect('1b. qrStart qrUrl 含 codekey', result.qrUrl.includes('codekey=test-unikey-123'));
    expect('1c. qrStart qrImg 是 data URL', result.qrImg.startsWith('data:image/'));
  }

  // ── 2. qrStart：code != 200 → BadRequest ─────────────────────
  reset();
  mockResponses = [{ json: { code: 500 } }];
  await test('2. qrStart code=500 → BadRequest', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrStart(), (e: any) => {
      return e.message?.includes('netease qr unikey failed');
    });
  });

  // ── 3. qrStart：无 unikey → BadRequest ───────────────────────
  reset();
  mockResponses = [{ json: { code: 200 } }];
  await test('3. qrStart 无 unikey → BadRequest', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrStart(), (e: any) => {
      return e.message?.includes('netease qr unikey failed');
    });
  });

  // ── 4. qrCheck：code 801（等待扫码）──────────────────────────
  reset();
  mockResponses = [{ json: { code: 801, message: '等待扫码' } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('4. qrCheck 801 → code=801', result.code === 801);
    expect('4b. qrCheck 801 → message', result.message === '等待扫码');
    expect('4c. qrCheck 801 → 无 session', result.session === undefined);
  }

  // ── 5. qrCheck：code 800（过期）──────────────────────────────
  reset();
  mockResponses = [{ json: { code: 800, message: '二维码过期' } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('5. qrCheck 800 → code=800', result.code === 800);
  }

  // ── 6. qrCheck：code 802（已扫码待确认）──────────────────────
  reset();
  mockResponses = [{ json: { code: 802 } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('6. qrCheck 802 → code=802', result.code === 802);
  }

  // ── 7. qrCheck：803 成功 + profile + vip ─────────────────────
  reset();
  mockResponses = [
    // qrCheck response
    {
      json: { code: 803, message: '登录成功' },
      setCookies: ['MUSIC_U=test-music-u-12345; Path=/; HttpOnly', '__csrf=test-csrf; Path=/'],
    },
    // profile response
    {
      json: {
        code: 200,
        profile: { userId: 123, nickname: '测试用户', avatarUrl: 'https://p.com/avatar.jpg' },
        account: { id: 123, userName: 'test_user' },
      },
    },
    // vip response
    {
      json: { code: 200, data: { isVip: true, redVipLevel: 8 } },
    },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('7. qrCheck 803 → code=803', result.code === 803);
    expect('7b. qrCheck 803 → message="登录成功"', result.message === '登录成功');
    expect('7c. session.musicU = "test-music-u-12345"', result.session?.musicU === 'test-music-u-12345');
    expect('7d. session.csrfToken = "test-csrf"', result.session?.csrfToken === 'test-csrf');
    expect('7e. session.nickname = "测试用户"', result.session?.nickname === '测试用户');
    expect('7f. session.avatarUrl', result.session?.avatarUrl === 'https://p.com/avatar.jpg');
    expect('7g. session.neteaseVip = true', result.session?.neteaseVip === true);
  }

  // ── 8. qrCheck：803 但无 MUSIC_U → AUTH_INVALID ──────────────
  reset();
  mockResponses = [
    { json: { code: 803 }, setCookies: ['__csrf=test-csrf; Path=/'] },
  ];
  await test('8. 803 无 MUSIC_U → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrCheck('test-key'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 9. qrCheck：803 + MUSIC_U 但 profile 失败 → AUTH_INVALID ─
  reset();
  mockResponses = [
    { json: { code: 803 }, setCookies: ['MUSIC_U=test-music-u; Path=/'] },
    { json: { code: 301 } }, // cookie expired
  ];
  await test('9. 803 profile code=301 → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrCheck('test-key'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 10. qrCheck：803 + profile 成功 + vip 失败（best-effort）──
  reset();
  mockResponses = [
    { json: { code: 803 }, setCookies: ['MUSIC_U=test-music-u; Path=/'] },
    { json: { code: 200, profile: { userId: 1, nickname: 'User', avatarUrl: '' } } },
    { json: { code: 500 } }, // vip fetch fails
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('10. vip 失败 → neteaseVip=undefined', result.session?.neteaseVip === undefined);
  }

  // ── 11. loginWithCookie：MUSIC_U 太短 → AUTH_INVALID ─────────
  reset();
  await test('11. MUSIC_U 太短 → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.loginWithCookie('short'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 12. loginWithCookie：成功 ────────────────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'Cookie用户', avatarUrl: '/av.jpg' } } },
    { json: { code: 200, data: { isVip: false, redVipLevel: 0 } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345', 'csrf-token');
    expect('12. session.musicU', session.musicU === 'test-music-u-12345');
    expect('12b. session.csrfToken = "csrf-token"', session.csrfToken === 'csrf-token');
    expect('12c. session.nickname = "Cookie用户"', session.nickname === 'Cookie用户');
    expect('12d. session.neteaseVip = false', session.neteaseVip === false);
  }

  // ── 13. loginWithCookie：profile 失败 → AUTH_INVALID ─────────
  reset();
  mockResponses = [{ json: { code: 301 } }];
  await test('13. loginWithCookie profile 301 → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.loginWithCookie('test-music-u-12345'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 14. loginWithCookie：无 csrfToken ────────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'User', avatarUrl: '' } } },
    { json: { code: 200, data: { isVip: true } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('14. 无 csrfToken → csrfToken=""', session.csrfToken === '');
    expect('14b. neteaseVip = true', session.neteaseVip === true);
  }

  // ── 15. fetchProfile：code 200 无 profile → null ─────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: null } },
    { json: { code: 200, data: { isVip: false } } },
  ];
  await test('15. code=200 profile=null → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.loginWithCookie('test-music-u-12345'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 16. fetchVipStatus：redVip = true ────────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
    { json: { code: 200, data: { redVip: true } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('16. redVip=true → neteaseVip=true', session.neteaseVip === true);
  }

  // ── 17. fetchVipStatus：redVipLevel > 0 ──────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
    { json: { code: 200, data: { redVipLevel: 9 } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('17. redVipLevel=9 → neteaseVip=true', session.neteaseVip === true);
  }

  // ── 18. fetchVipStatus：code != 200 → null ───────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
    { json: { code: 403 } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('18. vip code=403 → neteaseVip=undefined', session.neteaseVip === undefined);
  }

  // ── 19. fetchVipStatus：data=null → null ─────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
    { json: { code: 200, data: null } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('19. vip data=null → neteaseVip=undefined', session.neteaseVip === undefined);
  }

  // ── 20. fetchProfile：nickname fallback 到 account.userName ───
  //     `??` 只在 null/undefined 时 fallback，空串不触发
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: null as any, avatarUrl: '' }, account: { id: 1, userName: 'fallback_user' } } },
    { json: { code: 200, data: { isVip: false } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('20. nickname=null → fallback to userName', session.nickname === 'fallback_user');
  }

  // ── 21. fetchProfile：avatarUrl fallback ─────────────────────
  reset();
  mockResponses = [
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: undefined } } },
    { json: { code: 200, data: { isVip: false } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const session = await strategy.loginWithCookie('test-music-u-12345');
    expect('21. avatarUrl=undefined → ""', session.avatarUrl === '');
  }

  // ── 22. qrCheck：profile fetch 超时 → AUTH_INVALID ───────────
  reset();
  fetchDelay = 6000;
  mockResponses = [
    { json: { code: 803 }, setCookies: ['MUSIC_U=test-music-u; Path=/'] },
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
  ];
  await test('22. profile 超时 → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrCheck('test-key'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });
  fetchDelay = 0;

  // ── 23. devLoginFromEnv：无 env → null ───────────────────────
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    expect('23. devLoginFromEnv 无 env → null', strategy.devLoginFromEnv() === null);
  }

  // ── 24. devLoginFromEnv：有 env → session ────────────────────
  {
    const strategy = new NeteaseAuthStrategy(makeConfig('env-music-u-12345'));
    const session = strategy.devLoginFromEnv();
    expect('24. devLoginFromEnv 有 env → session', session !== null);
    expect('24b. session.musicU = "env-music-u-12345"', session?.musicU === 'env-music-u-12345');
    expect('24c. session.nickname = "Dev User"', session?.nickname === 'Dev User');
    expect('24d. session.csrfToken = ""', session?.csrfToken === '');
  }

  // ── 25. qrCheck：fetch URL 正确 ──────────────────────────────
  reset();
  mockResponses = [{ json: { code: 801 } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await strategy.qrCheck('my-key');
    expect('25. qrCheck URL 含 /api/login/qrcode/client/login', fetchUrls[0].includes('/api/login/qrcode/client/login'));
  }

  // ── 26. qrStart：fetch URL 正确 ──────────────────────────────
  reset();
  mockResponses = [{ json: { code: 200, unikey: 'k' } }];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await strategy.qrStart();
    expect('26. qrStart URL 含 /api/login/qrcode/unikey', fetchUrls[0].includes('/api/login/qrcode/unikey'));
  }

  // ── 27. qrCheck：803 Set-Cookie 解析（多 cookie）──────────────
  reset();
  mockResponses = [
    {
      json: { code: 803 },
      setCookies: [
        'MUSIC_U=abc123; Path=/; HttpOnly; Secure',
        '__csrf=xyz; Path=/',
        'NMTID=123; Path=/',
      ],
    },
    { json: { code: 200, profile: { userId: 1, nickname: 'U', avatarUrl: '' } } },
    { json: { code: 200, data: { isVip: false } } },
  ];
  {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    const result = await strategy.qrCheck('test-key');
    expect('27. 多 Set-Cookie → MUSIC_U 正确解析', result.session?.musicU === 'abc123');
    expect('27b. __csrf 正确解析', result.session?.csrfToken === 'xyz');
  }

  // ── 28. qrCheck：803 无 getSetCookie 方法 → 空 → AUTH_INVALID ─
  reset();
  mockResponses = [
    { json: { code: 803 }, setCookies: [] },
  ];
  await test('28. 803 无 Set-Cookie → AUTH_INVALID', async () => {
    const strategy = new NeteaseAuthStrategy(makeConfig());
    await assert.rejects(() => strategy.qrCheck('test-key'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  console.log(`\n🎉 netease-auth.strategy.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
