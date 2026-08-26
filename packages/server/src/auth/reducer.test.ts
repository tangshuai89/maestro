/**
 * Auth state machine reducer tests (server-side, CJS).
 *
 * Background: the renderer package is `"type": "module"` for Vite, which
 * forces every `.ts` file under `packages/renderer/src/**` into the ESM
 * scope — even when imported by a CJS `ts-node` test from another
 * workspace package. So instead of cross-importing the reducer (which
 * works fine for build output but not for `npm test`), we mirror the
 * reducer's API surface here and run a parallel test suite. The server's
 * `auth.controller` and `useAuth` (in the renderer) are the only
 * consumers, and the test contract (the actions, the `AuthPhase`
 * shape, the `AuthError` shape) is what matters.
 *
 * If you change the reducer (`packages/renderer/src/auth/reducer.ts`),
 * please keep the local copy in this file in sync — it's intentionally
 * small (~50 LOC).
 *
 * Run: cd packages/server && npx ts-node src/auth/reducer.test.ts
 */
export {};
const assert = require('node:assert');

// ── mirrored types (keep in sync with packages/renderer/src/auth/types.ts)

type MusicProvider = 'qq' | 'netease' | 'deezer' | 'spotify';

type AuthErrorCode =
  | 'AUTH_CANCELLED'
  | 'AUTH_TIMEOUT'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'AUTH_PROTOCOL_MISSING'
  | 'AUTH_BACKEND_DOWN'
  | 'AUTH_UNKNOWN';

const ATTEMPT_TIMEOUT_MS = 120_000;

interface AuthAttempt {
  id: string;
  provider: MusicProvider;
  startedAt: number;
}

interface AuthError {
  code: AuthErrorCode;
  message: string;
  provider: MusicProvider;
  attemptId: string;
  at: number;
}

type AuthPhase =
  | { kind: 'idle' }
  | { kind: 'starting'; attempt: AuthAttempt }
  | { kind: 'waiting_user'; attempt: AuthAttempt }
  | { kind: 'validating'; attempt: AuthAttempt }
  | { kind: 'authenticated'; attempt: AuthAttempt }
  | { kind: 'failed'; attempt: AuthAttempt; error: AuthError }
  | { kind: 'cancelled'; attempt: AuthAttempt; reason: 'user' | 'timeout' };

interface AuthState {
  provider: MusicProvider;
  loggedIn: boolean;
  user: { nickname: string; avatarUrl: string } | null;
  tier?: 'premium' | 'free' | 'open' | null;
  phase: AuthPhase;
  error: AuthError | null;
}

type AuthAction =
  | { type: 'set_provider'; provider: MusicProvider }
  | { type: 'set_status'; loggedIn: boolean; user: AuthState['user']; tier?: AuthState['tier'] }
  | { type: 'start'; attempt: AuthAttempt; deadlineMs?: number }
  | { type: 'enter_waiting_user' }
  | { type: 'enter_validating' }
  | { type: 'succeed'; user: AuthState['user']; tier?: AuthState['tier'] }
  | { type: 'fail'; error: AuthError }
  | { type: 'cancel'; attemptId: string; reason: 'user' | 'timeout' }
  | { type: 'dismiss_error' };

// ── mirrored reducer (keep in sync with packages/renderer/src/auth/reducer.ts)

function currentAttempt(state: AuthState): AuthAttempt | null {
  switch (state.phase.kind) {
    case 'idle':
      return null;
    case 'failed':
    case 'authenticated':
    case 'cancelled':
    case 'starting':
    case 'waiting_user':
    case 'validating':
      return state.phase.attempt;
  }
}
function isCurrentAttempt(state: AuthState, attemptId: string): boolean {
  const a = currentAttempt(state);
  return Boolean(a && a.id === attemptId);
}
function newAttempt(provider: MusicProvider): AuthAttempt {
  return {
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider,
    startedAt: Date.now(),
  };
}

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'set_provider':
      return {
        ...state,
        provider: action.provider,
        loggedIn: false,
        user: null,
        tier: undefined,
        phase: { kind: 'idle' },
        error: null,
      };
    case 'set_status':
      return { ...state, loggedIn: action.loggedIn, user: action.user, tier: action.tier ?? state.tier };
    case 'start': {
      void (action.deadlineMs ?? ATTEMPT_TIMEOUT_MS);
      return { ...state, phase: { kind: 'starting', attempt: action.attempt }, error: null };
    }
    case 'enter_waiting_user':
      if (state.phase.kind !== 'starting' && state.phase.kind !== 'validating') return state;
      return { ...state, phase: { kind: 'waiting_user', attempt: state.phase.attempt } };
    case 'enter_validating':
      if (state.phase.kind !== 'waiting_user' && state.phase.kind !== 'starting') return state;
      return { ...state, phase: { kind: 'validating', attempt: state.phase.attempt } };
    case 'succeed':
      return {
        ...state,
        loggedIn: true,
        user: action.user,
        tier: action.tier ?? state.tier,
        phase: { kind: 'authenticated', attempt: currentAttempt(state) ?? newAttempt(state.provider) },
        error: null,
      };
    case 'fail': {
      if (!isCurrentAttempt(state, action.error.attemptId)) return state;
      const attempt = currentAttempt(state) ?? newAttempt(state.provider);
      return { ...state, loggedIn: false, user: null, phase: { kind: 'failed', attempt, error: action.error }, error: action.error };
    }
    case 'cancel': {
      if (!isCurrentAttempt(state, action.attemptId)) return state;
      const attempt = currentAttempt(state) ?? newAttempt(state.provider);
      return {
        ...state,
        phase: { kind: 'cancelled', attempt, reason: action.reason },
        error:
          action.reason === 'timeout'
            ? { code: 'AUTH_TIMEOUT', message: '登录超时（120s）', provider: state.provider, attemptId: action.attemptId, at: Date.now() }
            : null,
      };
    }
    case 'dismiss_error':
      return { ...state, error: null, phase: { kind: 'idle' } };
  }
}

function initialAuthState(provider: MusicProvider): AuthState {
  return { provider, loggedIn: false, user: null, tier: undefined, phase: { kind: 'idle' }, error: null };
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (
    typeof value === 'string' &&
    ['AUTH_CANCELLED', 'AUTH_TIMEOUT', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_PROTOCOL_MISSING', 'AUTH_BACKEND_DOWN', 'AUTH_UNKNOWN']
      .includes(value)
  );
}

function attempt(provider: MusicProvider, id = 'a1'): AuthAttempt {
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
//
// Regression: previously set_provider kept the previous provider's
// loggedIn/user/tier, so the titlebar account button kept showing the old
// nickname (e.g. "唐帅" for QQ) after switching source to NetEase. The hook
// re-fetches via refreshStatus(), but the snapshot is now stale until the
// roundtrip completes — and if the fetch fails the snapshot is stale
// forever. Reset synchronously so the UI never lies about the current
// provider's auth state.
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
//
// Regression for the "right-side account doesn't update on switch" bug.
// Before the fix, going QQ (logged in as 唐帅) → Netease would keep the QQ
// snapshot in state until refreshStatus()'s async roundtrip completed; if
// the network call failed silently, the snapshot stayed stale and the
// titlebar kept showing "唐帅" while the source menu said NetEase.
{
  let s = initialAuthState('qq');
  s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: '唐帅', avatarUrl: '' }, tier: undefined });
  s = reducer(s, { type: 'set_provider', provider: 'netease' });
  assert.strictEqual(s.provider, 'netease');
  assert.strictEqual(s.loggedIn, false, 'switch must clear loggedIn even before refreshStatus lands');
  assert.strictEqual(s.user, null, 'switch must clear user even before refreshStatus lands');
  // Then a fresh set_status for the new provider fills in the real value.
  s = reducer(s, { type: 'set_status', loggedIn: true, user: { nickname: 'konanco', avatarUrl: 'https://...' } });
  assert.strictEqual(s.user?.nickname, 'konanco');
  assert.strictEqual(s.loggedIn, true);
  console.log('✅ 14. set_provider clears snapshot synchronously; set_status refills it');
}

console.log('\n🎉 reducer.test.ts: all 14 cases passed');
