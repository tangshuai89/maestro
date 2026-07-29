/**
 * Auth state machine reducer tests (Node assert + ts-node).
 * Run: cd packages/renderer && npx ts-node src/auth/reducer.test.ts
 *
 * 渲染端是 Vite + ESNext + "type":"module"——ts-node 通过显式 .ts 后缀
 * 解析（renderer's tsconfig 已开启 allowImportingTsExtensions）。
 */
import assert from 'node:assert';

import {
  initialAuthState,
  reducer,
  isAuthErrorCode,
  type AuthState,
} from './reducer.ts';
import { ATTEMPT_TIMEOUT_MS, type AuthAttempt } from './types.ts';

function attempt(provider: AuthState['provider'], id = 'a1'): AuthAttempt {
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

// ── 2. set_provider resets phase + error ────────────────────
{
  let s = initialAuthState('qq');
  s = reducer(s, {
    type: 'fail',
    error: {
      code: 'AUTH_INVALID',
      message: 'x',
      provider: 'qq',
      attemptId: 'a1',
      at: 1,
    },
  });
  s = reducer(s, { type: 'set_provider', provider: 'netease' });
  assert.strictEqual(s.provider, 'netease');
  assert.strictEqual(s.phase.kind, 'idle');
  assert.strictEqual(s.error, null);
  console.log('✅ 2. set_provider: phase=idle, error cleared');
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

// ── 4. starting -> waiting_user -> validating -> succeed ───
{
  let s = initialAuthState('qq');
  const a = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, { type: 'enter_waiting_user' });
  assert.strictEqual(s.phase.kind, 'waiting_user');
  s = reducer(s, { type: 'enter_validating' });
  assert.strictEqual(s.phase.kind, 'validating');
  s = reducer(s, {
    type: 'succeed',
    user: { nickname: 'alice', avatarUrl: '' },
  });
  assert.strictEqual(s.phase.kind, 'authenticated');
  assert.strictEqual(s.loggedIn, true);
  assert.strictEqual(s.user?.nickname, 'alice');
  assert.strictEqual(s.error, null);
  console.log('✅ 4. full path: starting -> waiting_user -> validating -> authenticated');
}

// ── 5. fail flips loggedIn=false even if snapshot was true ─
{
  let s = initialAuthState('spotify');
  s = reducer(s, {
    type: 'set_status',
    loggedIn: true,
    user: { nickname: 'old', avatarUrl: '' },
    tier: 'premium',
  });
  const a = attempt('spotify', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, { type: 'enter_waiting_user' });
  s = reducer(s, {
    type: 'fail',
    error: {
      code: 'AUTH_EXPIRED',
      message: 'refresh_token revoked',
      provider: 'spotify',
      attemptId: 'a1',
      at: 1,
    },
  });
  assert.strictEqual(s.phase.kind, 'failed');
  assert.strictEqual(s.loggedIn, false, 'loggedIn must flip to false on fail');
  assert.strictEqual(s.user, null);
  assert.strictEqual(s.error?.code, 'AUTH_EXPIRED');
  assert.strictEqual(s.tier, 'premium', 'tier sticky until next set_status');
  console.log('✅ 5. fail: loggedIn flipped to false, error sticky, tier sticky');
}

// ── 6. late failure from a previous attempt is ignored ─────
{
  let s = initialAuthState('qq');
  const a1 = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a1 });
  s = reducer(s, { type: 'enter_waiting_user' });
  // User cancels (a1) and restarts (a2):
  s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'user' });
  const a2 = attempt('qq', 'a2');
  s = reducer(s, { type: 'start', attempt: a2 });
  s = reducer(s, { type: 'enter_waiting_user' });
  // Late failure from a1 lands:
  s = reducer(s, {
    type: 'fail',
    error: {
      code: 'AUTH_INVALID',
      message: 'late',
      provider: 'qq',
      attemptId: 'a1',
      at: 2,
    },
  });
  assert.strictEqual(s.phase.kind, 'waiting_user', 'state should be a2, not failed');
  assert.strictEqual(s.error, null, 'late error must not be recorded');
  console.log('✅ 6. late failure from previous attempt: ignored');
}

// ── 7. cancel with reason=timeout sets AUTH_TIMEOUT error ──
{
  let s = initialAuthState('qq');
  const a = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, { type: 'enter_waiting_user' });
  s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'timeout' });
  assert.strictEqual(s.phase.kind, 'cancelled');
  if (s.phase.kind !== 'cancelled') throw new Error('narrow');
  assert.strictEqual(s.phase.reason, 'timeout');
  assert.strictEqual(s.error?.code, 'AUTH_TIMEOUT');
  console.log('✅ 7. cancel(timeout): error=AUTH_TIMEOUT');
}

// ── 8. cancel with reason=user keeps error null ────────────
{
  let s = initialAuthState('qq');
  const a = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, { type: 'cancel', attemptId: 'a1', reason: 'user' });
  assert.strictEqual(s.phase.kind, 'cancelled');
  assert.strictEqual(s.error, null);
  console.log('✅ 8. cancel(user): no error surfaced');
}

// ── 9. dismiss_error returns to idle ───────────────────────
{
  let s = initialAuthState('qq');
  const a = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, {
    type: 'fail',
    error: {
      code: 'AUTH_INVALID',
      message: 'x',
      provider: 'qq',
      attemptId: 'a1',
      at: 1,
    },
  });
  s = reducer(s, { type: 'dismiss_error' });
  assert.strictEqual(s.phase.kind, 'idle');
  assert.strictEqual(s.error, null);
  console.log('✅ 9. dismiss_error: back to idle');
}

// ── 10. enter_waiting_user from idle is ignored ────────────
{
  const s0 = initialAuthState('qq');
  const s1 = reducer(s0, { type: 'enter_waiting_user' });
  assert.strictEqual(s1.phase.kind, 'idle', 'cannot enter waiting_user from idle');
  console.log('✅ 10. enter_waiting_user from idle: ignored');
}

// ── 11. isAuthErrorCode: known vs unknown ──────────────────
{
  assert.strictEqual(isAuthErrorCode('AUTH_INVALID'), true);
  assert.strictEqual(isAuthErrorCode('AUTH_TIMEOUT'), true);
  assert.strictEqual(isAuthErrorCode('AUTH_PROTOCOL_MISSING'), true);
  assert.strictEqual(isAuthErrorCode('not_a_code'), false);
  assert.strictEqual(isAuthErrorCode(42), false);
  assert.strictEqual(isAuthErrorCode(null), false);
  console.log('✅ 11. isAuthErrorCode: known codes accepted, others rejected');
}

// ── 12. succeed clears error and stays authenticated ───────
{
  let s = initialAuthState('qq');
  const a = attempt('qq', 'a1');
  s = reducer(s, { type: 'start', attempt: a });
  s = reducer(s, {
    type: 'fail',
    error: {
      code: 'AUTH_INVALID',
      message: 'x',
      provider: 'qq',
      attemptId: 'a1',
      at: 1,
    },
  });
  s = reducer(s, {
    type: 'succeed',
    user: { nickname: 'alice', avatarUrl: '' },
  });
  assert.strictEqual(s.phase.kind, 'authenticated');
  assert.strictEqual(s.loggedIn, true);
  assert.strictEqual(s.error, null);
  console.log('✅ 12. succeed after fail: clears error, loggedIn=true');
}

// ── 13. ATTEMPT_TIMEOUT_MS is 120s ─────────────────────────
{
  assert.strictEqual(ATTEMPT_TIMEOUT_MS, 120_000);
  console.log('✅ 13. ATTEMPT_TIMEOUT_MS = 120_000');
}

console.log('\n🎉 reducer.test.ts: all 13 cases passed');
