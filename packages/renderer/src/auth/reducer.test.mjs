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

  console.log('\n🎉 reducer.test.mjs: all 14 cases passed');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
