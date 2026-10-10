// reducer.test.mjs — tests for the auth state machine reducer from ./reducer.ts
//
// This test imports the REAL renderer source (not a hand-copied duplicate).
// The old server-side copy (packages/server/src/auth/reducer.test.ts) mirrored
// the reducer's API surface — if the renderer source drifted, the copy-test
// still passed, giving false confidence.  Now we import the actual reducer /
// initialAuthState / isAuthErrorCode from ./reducer.ts and ATTEMPT_TIMEOUT_MS
// from ./types.ts via an inline ESM loader.
//
// Run: node src/auth/reducer.test.mjs

import { register } from 'node:module';
import * as assert from 'node:assert';

// ── inline loader: .ts extension resolution + .js→.ts rewrite ───────────
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.endsWith('.ts')) {
    const ext = extname(specifier);
    if (!ext) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    } else if (ext === '.js') {
      try { return await nextResolve(specifier.slice(0, -3) + '.ts', context); } catch {}
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);
  if (url.endsWith('.ts') && result.source) {
    const src = String(result.source);
    if (src.includes('import.meta.env')) {
      const patched = src.replace(/import\\.meta\\.env/g, '({DEV:false,PROD:true})');
      return { format: result.format, url, source: patched };
    }
  }
  return result;
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

async function main() {
  const { reducer, initialAuthState, isAuthErrorCode } = await import('./reducer.ts');
  const { ATTEMPT_TIMEOUT_MS } = await import('./types.ts');

  function attempt(provider, id = 'a1') {
    return { id, provider, startedAt: 1000 };
  }

  // ── 1. initial state ────────────────────────────────────────
  {
    const s = initialAuthState('qq');
    assert.strictEqual(s.loggedIn, false);
    assert.strictEqual(s.user, null);
    assert.strictEqual(s.phase.kind, 'idle');
    assert.strictEqual(s.error, null);
    console.log('✅ 1. initial state: idle, logged out, no error');
  }

  // ── 2. set_provider resets phase + error AND clears snapshot ──────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: '唐帅', avatarUrl: '' }, tier: undefined });
    s = reducer(s, {
      type: 'fail',
      error: { code: 'AUTH_INVALID', message: 'x', provider: 'qq', attemptId: 'a1', at: 1 },
    });
    s = reducer(s, { type: 'set_provider', provider: 'netease' });
    assert.strictEqual(s.provider, 'netease');
    assert.strictEqual(s.phase.kind, 'idle');
    assert.strictEqual(s.error, null);
    assert.strictEqual(s.loggedIn, false, 'snapshot must reset on provider switch');
    assert.strictEqual(s.user, null, 'snapshot.user must reset on provider switch');
    console.log('✅ 2. set_provider: phase=idle, error cleared, snapshot reset');
  }

  // ── 3. start -> starting ───────────────────────────────────
  {
    let s = initialAuthState('qq');
    const a = attempt('qq', 'a1');
    s = reducer(s, { type: 'start', attempt: a });
    assert.strictEqual(s.phase.kind, 'starting');
    if (s.phase.kind !== 'starting') throw new Error('narrow');
    assert.strictEqual(s.phase.attempt.id, 'a1');
    console.log('✅ 3. start -> starting');
  }

  // ── 4. full path ───────────────────────────────────────────
  {
    let s = initialAuthState('qq');
    const a = attempt('qq', 'a1');
    s = reducer(s, { type: 'start', attempt: a });
    s = reducer(s, { type: 'enter_waiting_user' });
    assert.strictEqual(s.phase.kind, 'waiting_user');
    s = reducer(s, { type: 'enter_validating' });
    assert.strictEqual(s.phase.kind, 'validating');
    s = reducer(s, { type: 'succeed', user: { nickname: 'alice', avatarUrl: '' } });
    assert.strictEqual(s.phase.kind, 'authenticated');
    assert.strictEqual(s.loggedIn, true);
    assert.strictEqual(s.user?.nickname, 'alice');
    assert.strictEqual(s.error, null);
    console.log('✅ 4. full path: starting -> waiting_user -> validating -> authenticated');
  }

  // ── 5. fail flips loggedIn=false ──────────────────────────
  {
    let s = initialAuthState('spotify');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'old', avatarUrl: '' }, tier: 'premium' });
    const a = attempt('spotify', 'a1');
    s = reducer(s, { type: 'start', attempt: a });
    s = reducer(s, { type: 'enter_waiting_user' });
    s = reducer(s, { type: 'fail', error: { code: 'AUTH_EXPIRED', message: 'refresh_token revoked', provider: 'spotify', attemptId: 'a1', at: 1 } });
    assert.strictEqual(s.phase.kind, 'failed');
    assert.strictEqual(s.loggedIn, false);
    assert.strictEqual(s.user, null);
    assert.strictEqual(s.error?.code, 'AUTH_EXPIRED');
    assert.strictEqual(s.tier, 'premium');
    console.log('✅ 5. fail: loggedIn=false, error sticky, tier sticky');
  }

  // ── 6. late failure ignored ────────────────────────────────
  {
    let s = initialAuthState('qq');
    const a1 = attempt('qq', 'a1');
    s = reducer(s, { type: 'start', attempt: a1 });
    s = reducer(s, { type: 'enter_waiting_user' });
    s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'user' });
    const a2 = attempt('qq', 'a2');
    s = reducer(s, { type: 'start', attempt: a2 });
    s = reducer(s, { type: 'enter_waiting_user' });
    s = reducer(s, { type: 'fail', error: { code: 'AUTH_INVALID', message: 'late', provider: 'qq', attemptId: 'a1', at: 2 } });
    assert.strictEqual(s.phase.kind, 'waiting_user');
    assert.strictEqual(s.error, null);
    console.log('✅ 6. late failure from previous attempt: ignored');
  }

  // ── 7. cancel timeout ──────────────────────────────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'start', attempt: attempt('qq', 'a1') });
    s = reducer(s, { type: 'enter_waiting_user' });
    s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'timeout' });
    assert.strictEqual(s.phase.kind, 'cancelled');
    if (s.phase.kind !== 'cancelled') throw new Error('narrow');
    assert.strictEqual(s.phase.reason, 'timeout');
    assert.strictEqual(s.error?.code, 'AUTH_TIMEOUT');
    console.log('✅ 7. cancel(timeout): error=AUTH_TIMEOUT');
  }

  // ── 8. cancel user ─────────────────────────────────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'start', attempt: attempt('qq', 'a1') });
    s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'user' });
    assert.strictEqual(s.phase.kind, 'cancelled');
    assert.strictEqual(s.error, null);
    console.log('✅ 8. cancel(user): no error surfaced');
  }

  // ── 9. dismiss_error ───────────────────────────────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'start', attempt: attempt('qq', 'a1') });
    s = reducer(s, { type: 'fail', error: { code: 'AUTH_INVALID', message: 'x', provider: 'qq', attemptId: 'a1', at: 1 } });
    s = reducer(s, { type: 'dismiss_error' });
    assert.strictEqual(s.phase.kind, 'idle');
    assert.strictEqual(s.error, null);
    console.log('✅ 9. dismiss_error: back to idle');
  }

  // ── 10. enter_waiting_user from idle ignored ───────────────
  {
    const s0 = initialAuthState('qq');
    const s1 = reducer(s0, { type: 'enter_waiting_user' });
    assert.strictEqual(s1.phase.kind, 'idle');
    console.log('✅ 10. enter_waiting_user from idle: ignored');
  }

  // ── 11. isAuthErrorCode ────────────────────────────────────
  {
    assert.strictEqual(isAuthErrorCode('AUTH_INVALID'), true);
    assert.strictEqual(isAuthErrorCode('AUTH_PROTOCOL_MISSING'), true);
    assert.strictEqual(isAuthErrorCode('nope'), false);
    assert.strictEqual(isAuthErrorCode(42), false);
    assert.strictEqual(isAuthErrorCode(null), false);
    console.log('✅ 11. isAuthErrorCode: known codes accepted, others rejected');
  }

  // ── 12. succeed after fail ─────────────────────────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'start', attempt: attempt('qq', 'a1') });
    s = reducer(s, { type: 'fail', error: { code: 'AUTH_INVALID', message: 'x', provider: 'qq', attemptId: 'a1', at: 1 } });
    s = reducer(s, { type: 'succeed', user: { nickname: 'alice', avatarUrl: '' } });
    assert.strictEqual(s.phase.kind, 'authenticated');
    assert.strictEqual(s.loggedIn, true);
    assert.strictEqual(s.error, null);
    console.log('✅ 12. succeed after fail: clears error, loggedIn=true');
  }

  // ── 13. ATTEMPT_TIMEOUT_MS ─────────────────────────────────
  {
    assert.strictEqual(ATTEMPT_TIMEOUT_MS, 120_000);
    console.log('✅ 13. ATTEMPT_TIMEOUT_MS = 120_000');
  }

  // ── 14. switch providers never leaks snapshot ───────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: '唐帅', avatarUrl: '' }, tier: undefined });
    s = reducer(s, { type: 'set_provider', provider: 'netease' });
    assert.strictEqual(s.provider, 'netease');
    assert.strictEqual(s.loggedIn, false, 'switch must clear loggedIn even before refreshStatus lands');
    assert.strictEqual(s.user, null, 'switch must clear user even before refreshStatus lands');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'konanco', avatarUrl: 'https://...' } });
    assert.strictEqual(s.user?.nickname, 'konanco');
    assert.strictEqual(s.loggedIn, true);
    console.log('✅ 14. set_provider clears snapshot synchronously; set_status refills it');
  }

  // ── 15. mark_expired：登录态事后被判过期（Phase 10）───────
  //
  // 复现 2026-10-08 的线上症状：后端 validate 探针已判定过期、日志都打了，
  // 前端却毫无反应。根因是过期检测复用了 `fail`，而 `fail` 有
  // isCurrentAttempt 门控 —— 此刻 phase 已是 authenticated，currentAttempt
  // 返回上次登录的 attempt id，外部传的 'stale-probe' 永远匹配不上，
  // 整个 state 原样返回（静默丢弃）。
  {
    // 先走完一次登录
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'start', attempt: { id: 'a_login_1', provider: 'qq', startedAt: Date.now() } });
    s = reducer(s, { type: 'enter_validating' });
    s = reducer(s, { type: 'succeed', user: { nickname: '唐帅', avatarUrl: '' } });
    assert.strictEqual(s.phase.kind, 'authenticated');
    assert.strictEqual(s.loggedIn, true);

    // 旧做法：fail + 外部 attemptId → 被静默丢弃（这就是 bug）
    const dropped = reducer(s, {
      type: 'fail',
      error: { code: 'AUTH_EXPIRED', message: '登录已过期', provider: 'qq', attemptId: 'stale-probe', at: Date.now() },
    });
    assert.strictEqual(
      dropped.error, null,
      'fail + 外部 attemptId 会被 isCurrentAttempt 丢弃（这正是线上症状的根因）',
    );
    assert.strictEqual(dropped.loggedIn, true, '被丢弃时 loggedIn 不变');

    // 新做法：mark_expired → 生效
    const after = reducer(s, {
      type: 'mark_expired',
      error: { code: 'AUTH_EXPIRED', message: '登录已过期，请重新登录', provider: 'qq', attemptId: 'stale-probe', at: Date.now() },
    });
    assert.ok(after.error, 'mark_expired 必须落 error（AuthErrorPanel 靠它渲染）');
    assert.strictEqual(after.error.code, 'AUTH_EXPIRED');
    assert.strictEqual(after.loggedIn, false, 'loggedIn 翻 false，避免仍显示绿色已登录徽章');
    assert.strictEqual(after.user, null, 'user 清空');
    assert.strictEqual(after.phase.kind, 'failed', 'phase 翻 failed');
    console.log('✅ 15. mark_expired 生效；对照 fail+外部 attemptId 会被丢弃');
  }

  // ── 16. mark_expired 幂等：重复到达结果一致 ──────────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'x', avatarUrl: '' } });
    const err = { code: 'AUTH_EXPIRED', message: '过期', provider: 'qq', attemptId: 'p1', at: 1 };
    const once = reducer(s, { type: 'mark_expired', error: err });
    const twice = reducer(once, { type: 'mark_expired', error: err });
    assert.strictEqual(twice.error?.code, 'AUTH_EXPIRED');
    assert.strictEqual(twice.loggedIn, false);
    assert.strictEqual(twice.phase.kind, 'failed');
    console.log('✅ 16. mark_expired 幂等（useAuth 与 usePlayer 可能各触发一次）');
  }

  // ── 17. dismiss_error 能清掉 mark_expired 留下的面板 ─────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'x', avatarUrl: '' } });
    s = reducer(s, { type: 'mark_expired', error: { code: 'AUTH_EXPIRED', message: '过期', provider: 'qq', attemptId: 'p1', at: 1 } });
    assert.ok(s.error, '前置：error 已置位');
    s = reducer(s, { type: 'dismiss_error' });
    assert.strictEqual(s.error, null, 'dismiss 后 error 清空 → 面板关闭');
    console.log('✅ 17. dismiss_error 能清掉 mark_expired 留下的面板');
  }

  // ── 18. mark_valid：mark_expired 的逆转移（Phase 11 P11-3）─────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: '唐帅', avatarUrl: '' } });
    s = reducer(s, {
      type: 'mark_expired',
      error: { code: 'AUTH_EXPIRED', message: '过期', provider: 'qq', attemptId: 'p1', at: 1 },
    });
    assert.strictEqual(s.loggedIn, false, '前置：已标过期');
    assert.strictEqual(s.phase.kind, 'failed');

    // 探针回活 → mark_valid 撤销过期态
    s = reducer(s, { type: 'mark_valid', user: { nickname: '唐帅', avatarUrl: '' } });
    assert.strictEqual(s.error, null, 'mark_valid 清掉 error → 面板关闭');
    assert.strictEqual(s.loggedIn, true, 'loggedIn 恢复');
    assert.strictEqual(s.user?.nickname, '唐帅', 'user 从 validated 响应恢复');
    assert.strictEqual(s.phase.kind, 'idle', 'phase 回 idle');
    console.log('✅ 18. mark_valid 撤销 mark_expired（恢复 loggedIn/user/idle）');
  }

  // ── 19. mark_valid 不清非 AUTH_EXPIRED 的 error ─────────────
  {
    // AUTH_INVALID 来自一次真实失败的登录尝试 —— 「探针说活着」不该把它清掉。
    let s = initialAuthState('qq');
    s = reducer(s, {
      type: 'mark_expired',
      error: { code: 'AUTH_EXPIRED', message: '过期', provider: 'qq', attemptId: 'p1', at: 1 },
    });
    // 手动换成另一种 error（模拟随后又有别的错误置位）
    s = { ...s, error: { code: 'AUTH_INVALID', message: '凭据无效', provider: 'qq', attemptId: 'x', at: 2 } };
    const after = reducer(s, { type: 'mark_valid', user: null });
    assert.strictEqual(after, s, '非 AUTH_EXPIRED error → mark_valid 必须 no-op');
    assert.strictEqual(after.error.code, 'AUTH_INVALID');
    console.log('✅ 19. mark_valid 不清非 AUTH_EXPIRED error');
  }

  // ── 20. mark_valid 幂等：无 error / 重复到达 → no-op ────────
  {
    let s = initialAuthState('qq');
    s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'x', avatarUrl: '' } });
    const same = reducer(s, { type: 'mark_valid', user: null });
    assert.strictEqual(same, s, '无 error 时 mark_valid no-op（不改变 loggedIn）');

    // mark_expired → mark_valid → 再一次 mark_valid：第二次仍是 no-op
    s = reducer(s, {
      type: 'mark_expired',
      error: { code: 'AUTH_EXPIRED', message: '过期', provider: 'qq', attemptId: 'p1', at: 1 },
    });
    s = reducer(s, { type: 'mark_valid', user: { nickname: 'x', avatarUrl: '' } });
    const twice = reducer(s, { type: 'mark_valid', user: null });
    assert.strictEqual(twice, s, '重复 mark_valid 幂等');
    console.log('✅ 20. mark_valid 幂等（无 error 时 no-op）');
  }

  console.log('\n🎉 reducer.test.mjs: all 20 cases passed');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
