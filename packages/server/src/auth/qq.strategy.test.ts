/**
 * QqAuthStrategy 单元测试（mock fetch）。
 *
 * 覆盖：
 *  - loginWithCookie：cookie 校验（太短/无 key）、profile fetch 成功/失败/超时
 *  - isConfigured
 *  - detectVip（通过 fetchProfile 间接覆盖各 VIP 字段组合）
 *  - fetchProfile：uin 缺失、空响应、非 JSON、结构变化
 *
 * 运行: npx ts-node src/auth/qq.strategy.test.ts
 */
export {};
const assert = require('node:assert');
const { QqAuthStrategy } = require('./qq.strategy');

// ── mock fetch ────────────────────────────────────────────────
let mockResponse: { text: string } | null = null;
let fetchUrl = '';
let fetchOpts: any = null;
let fetchDelay = 0;
(globalThis as any).fetch = async (url: string, opts: any) => {
  fetchUrl = url;
  fetchOpts = opts;
  if (fetchDelay > 0) await new Promise((r) => setTimeout(r, fetchDelay));
  if (mockResponse) return { text: () => Promise.resolve((mockResponse as any).text) } as any;
  return { text: () => Promise.resolve('') } as any;
};

function reset() {
  mockResponse = null;
  fetchUrl = '';
  fetchOpts = null;
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

const strategy = new QqAuthStrategy();

async function main() {
  // ── 1. loginWithCookie：cookie 太短 → AUTH_INVALID ───────────
  reset();
  await test('1. cookie 太短 → BadRequest', async () => {
    await assert.rejects(() => strategy.loginWithCookie('short'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 2. loginWithCookie：空 cookie → AUTH_INVALID ──────────────
  reset();
  await test('2. 空 cookie → BadRequest', async () => {
    await assert.rejects(() => strategy.loginWithCookie(''), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 3. loginWithCookie：无 uin → profile fetch 返回 null → AUTH_INVALID
  reset();
  mockResponse = { text: JSON.stringify({ req_0: { data: { map_userinfo: { '123': { nick: 'Test' } } } } }) };
  await test('3. 无 uin → fetchProfile 返回 null → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 4. loginWithCookie：profile fetch 成功 ────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: {
        data: {
          map_userinfo: {
            '123456': {
              nick: '测试用户',
              headpic: 'https://y.gtimg.cn/avatar.jpg',
              isVip: 1,
            },
          },
        },
      },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345; uin=123456', '123456');
    expect('4. profile 成功 → session.qqCookie', session.qqCookie === 'qm_keyst=abc12345; uin=123456');
    expect('4b. session.nickname = "测试用户"', session.nickname === '测试用户');
    expect('4c. session.avatarUrl', session.avatarUrl === 'https://y.gtimg.cn/avatar.jpg');
    expect('4d. session.qqVip = true', session.qqVip === true);
    expect('4e. session.qqUin = "123456"', session.qqUin === '123456');
  }

  // ── 5. loginWithCookie：profile 无 nick → fetchProfile 返回 null → AUTH_INVALID
  //     （first?.nick 是 falsy guard，无 nick 不会返回 profile）
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { headpic: '/avatar.jpg' } } } },
    }),
  };
  await test('5. 无 nick → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 6. loginWithCookie：profile 无 headpic → 用 avatar 字段 ──
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'Test', avatar: '/av.jpg' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('6. 无 headpic → 用 avatar 字段', session.avatarUrl === '/av.jpg');
  }

  // ── 7. detectVip：isVip = 0 → false ───────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', isVip: 0 } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('7. isVip=0 → qqVip=false', session.qqVip === false);
  }

  // ── 8. detectVip：isVip = true → true ─────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', isVip: true } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('8. isVip=true → qqVip=true', session.qqVip === true);
  }

  // ── 9. detectVip：ivip = 2 → true ─────────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', ivip: 2 } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('9. ivip=2 → qqVip=true', session.qqVip === true);
  }

  // ── 10. detectVip：svip = "yes" → true ────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', svip: 'yes' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('10. svip="yes" → qqVip=true', session.qqVip === true);
  }

  // ── 11. detectVip：is_green = "false" → false ─────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', is_green: 'false' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('11. is_green="false" → qqVip=false', session.qqVip === false);
  }

  // ── 12. detectVip：无任何 VIP 字段 → undefined ─────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('12. 无 VIP 字段 → qqVip=undefined', session.qqVip === undefined);
  }

  // ── 13. fetchProfile：非 JSON 响应 → null → AUTH_INVALID ──────
  reset();
  mockResponse = { text: 'not json at all' };
  await test('13. 非 JSON → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 14. fetchProfile：空响应 → null → AUTH_INVALID ────────────
  reset();
  mockResponse = { text: '' };
  await test('14. 空响应 → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 15. fetchProfile：JSON 但无 req_0 → null ──────────────────
  reset();
  mockResponse = { text: JSON.stringify({ code: 500 }) };
  await test('15. JSON 无 req_0 → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 16. fetchProfile：map_userinfo 空 → null ──────────────────
  reset();
  mockResponse = { text: JSON.stringify({ req_0: { data: { map_userinfo: {} } } }) };
  await test('16. map_userinfo 空 → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });

  // ── 17. fetchProfile：fetch URL 正确 ──────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({ req_0: { data: { map_userinfo: { '123': { nick: 'T' } } } } }),
  };
  {
    await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('17. fetch URL 含 musicu.fcg', fetchUrl.includes('musicu.fcg'));
    expect('17b. fetch method = POST', fetchOpts.method === 'POST');
    expect('17c. fetch headers 含 Cookie', fetchOpts.headers.Cookie === 'qm_keyst=abc12345');
    expect('17d. fetch body 含 uin', fetchOpts.body.includes('"123"'));
  }

  // ── 18. isConfigured ──────────────────────────────────────────
  {
    expect('18. isConfigured(undefined) → false', strategy.isConfigured(undefined) === false);
    expect('18b. isConfigured({qqCookie:"x"}) → true', strategy.isConfigured({ qqCookie: 'x' } as any) === true);
    expect('18c. isConfigured({}) → false', strategy.isConfigured({} as any) === false);
  }

  // ── 19. loginWithCookie：无 qm_keyst/qqmusic_key（仍允许，只是 warn）
  reset();
  mockResponse = {
    text: JSON.stringify({ req_0: { data: { map_userinfo: { '123': { nick: 'T' } } } } }),
  };
  {
    // cookie 有长度但无 qm_keyst/qqmusic_key → 仍尝试 profile
    const session = await strategy.loginWithCookie('uin=12345678; other=abc', '123');
    expect('19. 无 login key 但 profile 成功 → 仍入 session', session.nickname === 'T');
  }

  // ── 20. fetchProfile 超时（5s）→ AUTH_INVALID ─────────────────
  reset();
  fetchDelay = 6000;
  mockResponse = {
    text: JSON.stringify({ req_0: { data: { map_userinfo: { '123': { nick: 'T' } } } } }),
  };
  await test('20. profile fetch 超时 → AUTH_INVALID', async () => {
    await assert.rejects(() => strategy.loginWithCookie('qm_keyst=abc12345', '123'), (e: any) => {
      return e.response?.error === 'AUTH_INVALID';
    });
  });
  fetchDelay = 0;

  // ── 21. extraCookies 透传 ─────────────────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({ req_0: { data: { map_userinfo: { '123': { nick: 'T' } } } } }),
  };
  {
    const extra = { qm_keyst: 'abc', uin: '123', other: 'val' };
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123', extra);
    expect('21. extraCookies 透传', session.qqCookies === extra);
  }

  // ── 22. detectVip：yellow_vip = 1 → true ──────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', yellow_vip: 1 } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('22. yellow_vip=1 → qqVip=true', session.qqVip === true);
  }

  // ── 23. detectVip：lvip = "1" → true ──────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', lvip: '1' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('23. lvip="1" → qqVip=true', session.qqVip === true);
  }

  // ── 24. detectVip：green = "no" → false ───────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({
      req_0: { data: { map_userinfo: { '123': { nick: 'T', green: 'no' } } } },
    }),
  };
  {
    const session = await strategy.loginWithCookie('qm_keyst=abc12345', '123');
    expect('24. green="no" → qqVip=false', session.qqVip === false);
  }

  // ── 25. fetchProfile body 结构正确 ────────────────────────────
  reset();
  mockResponse = {
    text: JSON.stringify({ req_0: { data: { map_userinfo: { '999': { nick: 'T' } } } } }),
  };
  {
    await strategy.loginWithCookie('qm_keyst=abc12345', '999');
    const body = JSON.parse(fetchOpts.body);
    expect('25. body.comm.ct = 24', body.comm.ct === 24);
    expect('25b. body.req_0.module = userInfo.BaseUserInfoServer', body.req_0.module === 'userInfo.BaseUserInfoServer');
    expect('25c. body.req_0.param.vec_uin = ["999"]', JSON.stringify(body.req_0.param.vec_uin) === '["999"]');
  }

  console.log(`\n🎉 qq.strategy.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
