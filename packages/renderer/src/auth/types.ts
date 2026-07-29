import type { MusicProvider } from '../api';

/**
 * Stable, machine-readable auth error codes. The server emits these in the
 * `error` field of 4xx/5xx JSON bodies; the renderer throws an {@link AuthError}
 * carrying one of these. UI never sees a raw "401 Unauthorized: ..." string —
 * it sees an actionable code with typed recovery actions.
 *
 * 命名：所有都以 `AUTH_` 开头，方便 grep。
 */
export type AuthErrorCode =
  | 'AUTH_CANCELLED'
  | 'AUTH_TIMEOUT'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'AUTH_PROTOCOL_MISSING'
  | 'AUTH_BACKEND_DOWN'
  | 'AUTH_UNKNOWN';

/**
 * One attempt of a login flow. Unique per `start` call so the reducer can
 * ignore late callbacks from a previous attempt when the user already
 * cancelled + restarted.
 */
export interface AuthAttempt {
  id: string;
  provider: MusicProvider;
  /** Wall-clock ms when the attempt started. Used for the 120s deadline. */
  startedAt: number;
}

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  provider: MusicProvider;
  /** attemptId of the failing attempt, for the reducer to correlate. */
  attemptId: string;
  /** Wall-clock ms when the failure was raised. */
  at: number;
}

export type AuthPhase =
  | { kind: 'idle' }
  | { kind: 'starting'; attempt: AuthAttempt }
  | { kind: 'waiting_user'; attempt: AuthAttempt }
  | { kind: 'validating'; attempt: AuthAttempt }
  | { kind: 'authenticated'; attempt: AuthAttempt }
  | {
      kind: 'failed';
      attempt: AuthAttempt;
      error: AuthError;
    }
  | { kind: 'cancelled'; attempt: AuthAttempt; reason: 'user' | 'timeout' };

/**
 * Per-attempt config. The 120s hard deadline lives in the hook layer (it
 * needs `setTimeout`); the reducer only knows about the attempt id + start
 * time. The hook decides when to dispatch a `cancel({ reason: 'timeout' })`.
 */
export const ATTEMPT_TIMEOUT_MS = 120_000;

/** Hard timeout for server-side validation probes (QQ / NetEase profile). */
export const VALIDATION_TIMEOUT_MS = 5_000;
