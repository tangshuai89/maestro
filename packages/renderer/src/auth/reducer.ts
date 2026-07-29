import type { MusicProvider } from '../api.ts';
import {
  ATTEMPT_TIMEOUT_MS,
  type AuthAttempt,
  type AuthError,
  type AuthErrorCode,
  type AuthPhase,
} from './types.ts';

/**
 * Reducer state. The phase describes the *login attempt*; the snapshot
 * describes the *current logged-in status*. They can be out of sync (e.g.
 * user is logged in to QQ, but currently in `idle` because we haven't
 * started a new attempt).
 */
export interface AuthState {
  /** Current provider (mirrors player.provider). Reducer doesn't care which
   *  one — actions carry `provider` and the hook filters. */
  provider: MusicProvider;
  /** Logged-in snapshot for the current provider (kept across attempts). */
  loggedIn: boolean;
  user: { nickname: string; avatarUrl: string } | null;
  /** Spotify tier cached from `/auth/spotify/status`. */
  tier?: 'premium' | 'free' | 'open' | null;
  /** Where the login attempt is right now. */
  phase: AuthPhase;
  /** Last error (sticky until next attempt starts). */
  error: AuthError | null;
  /** Whether the recovery panel is visible — derived from `phase === 'failed'`
   *  or a non-null `error`; the hook exposes it as a boolean for ergonomics. */
}

export type AuthAction =
  | { type: 'set_provider'; provider: MusicProvider }
  | { type: 'set_status'; loggedIn: boolean; user: AuthState['user']; tier?: AuthState['tier'] }
  | { type: 'start'; attempt: AuthAttempt; deadlineMs?: number }
  | { type: 'enter_waiting_user' }
  | { type: 'enter_validating' }
  | { type: 'succeed'; user: AuthState['user']; tier?: AuthState['tier'] }
  | { type: 'fail'; error: AuthError }
  | { type: 'cancel'; attemptId: string; reason: 'user' | 'timeout' }
  | { type: 'dismiss_error' };

/**
 * Pure reducer. Single source of truth for the auth state machine. The
 * hook only dispatches actions — every transition goes through here so
 * invalid transitions are impossible.
 *
 * Cancel semantics: `cancel` only takes effect if the current attempt id
 * matches. This prevents late `cancel`s from a previous attempt
 * stomping on a new one.
 */
export function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'set_provider':
      // Provider switched → drop any in-flight attempt and clear error. The
      // snapshot (loggedIn/user) is reset by the hook in the same effect.
      return { ...state, provider: action.provider, phase: { kind: 'idle' }, error: null };

    case 'set_status':
      return {
        ...state,
        loggedIn: action.loggedIn,
        user: action.user,
        tier: action.tier ?? state.tier,
      };

    case 'start': {
      const deadline = action.deadlineMs ?? ATTEMPT_TIMEOUT_MS;
      void deadline; // deadline is read by the hook; reducer just records the attempt.
      return {
        ...state,
        phase: { kind: 'starting', attempt: action.attempt },
        error: null,
      };
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
      // Late failure from a previous attempt? ignore.
      if (!isCurrentAttempt(state, action.error.attemptId)) return state;
      // Auth failure → snapshot is now stale. Flip loggedIn to false so the
      // UI doesn't keep showing a green badge while a red recovery panel is
      // up.
      const attempt = currentAttempt(state) ?? newAttempt(state.provider);
      return {
        ...state,
        loggedIn: false,
        user: null,
        phase: { kind: 'failed', attempt, error: action.error },
        error: action.error,
      };
    }

    case 'cancel': {
      if (!isCurrentAttempt(state, action.attemptId)) return state;
      const attempt = currentAttempt(state) ?? newAttempt(state.provider);
      return {
        ...state,
        phase: { kind: 'cancelled', attempt, reason: action.reason },
        error:
          action.reason === 'timeout'
            ? {
                code: 'AUTH_TIMEOUT',
                message: '登录超时（120s）',
                provider: state.provider,
                attemptId: action.attemptId,
                at: Date.now(),
              }
            : null,
      };
    }

    case 'dismiss_error':
      return { ...state, error: null, phase: { kind: 'idle' } };
  }
}

export function initialAuthState(provider: MusicProvider): AuthState {
  return {
    provider,
    loggedIn: false,
    user: null,
    tier: undefined,
    phase: { kind: 'idle' },
    error: null,
  };
}

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
  return { id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, provider, startedAt: Date.now() };
}

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (
    typeof value === 'string' &&
    (value === 'AUTH_CANCELLED' ||
      value === 'AUTH_TIMEOUT' ||
      value === 'AUTH_INVALID' ||
      value === 'AUTH_EXPIRED' ||
      value === 'AUTH_PROTOCOL_MISSING' ||
      value === 'AUTH_BACKEND_DOWN' ||
      value === 'AUTH_UNKNOWN')
  );
}
