import { useEffect, useReducer, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  cancelSpotifyAuth,
  getAuthStatus,
  getAuthStatusExtended,
  getSpotifyStatus,
  loginNeteaseCookie,
  loginQqCookie,
  logout,
  redeemSpotifyCode,
  reportAuthEvent,
  setSpotifyClientId,
  startSpotify,
  type AuthStatus,
  type AuthUser,
} from '../api';
import type { MusicProvider } from '../api';
import { initialAuthState, reducer, type AuthState } from '../auth/reducer';
import { ATTEMPT_TIMEOUT_MS, type AuthAttempt, type AuthErrorCode } from '../auth/types';

/** True when running inside the Electron shell (not just a browser tab). */
const isElectron =
  typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

/** 24h — renderer's "stale credentials" probe interval. If lastValidatedAt
 *  is older than this, the next status fetch re-runs the guard call. */
const STALE_VALIDATION_MS = 24 * 60 * 60 * 1000;

/**
 * Auth for the current provider. Status fetch on provider change, QQ /
 * NetEase login (Electron cookie-capture, with a QR-modal fallback in a
 * plain browser), logout, and the manual-cookie success path.
 *
 * Architecture (auth-resilience spec, Phase 1):
 *  - Reducer-driven state machine (auth/reducer.ts) — one attempt at a
 *    time, attempt id guards late callbacks, 120s hard timeout.
 *  - Validates credentials with a 5s probe before persisting (server-side
 *    enforcement + UI confidence).
 *  - All auth errors flow through `AuthError` (typed) → reducer `fail`.
 *  - 10-min OAuth callback buffer: on mount, drain via
 *    `window.electronAPI.consumeOAuthCallback()` if available.
 */
export function useAuth(
  provider: MusicProvider | null,
  loadNextTrack: () => void,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  const [state, dispatch] = useReducer(
    reducer,
    provider ?? 'qq',
    initialAuthState,
  );
  /** Browser-fallback flag: when running outside Electron (or without the
   *  native cookie-capture IPC), NetEase login can't capture MUSIC_U from a
   *  child Chromium window. We surface the QR/modal flow instead. */
  const [showCookieFallback, setShowCookieFallback] = useState(false);
  /** Per-attempt cancellation: deadline timer + abort flag. The hook owns
   *  the side effects; the reducer owns the state. */
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const attemptStartedRef = useRef<number>(0);
  const consumedProtocolRef = useRef(false);

  function clearDeadline(): void {
    if (deadlineRef.current) {
      clearTimeout(deadlineRef.current);
      deadlineRef.current = null;
    }
  }

  function startDeadline(attempt: AuthAttempt): void {
    clearDeadline();
    attemptIdRef.current = attempt.id;
    attemptStartedRef.current = attempt.startedAt;
    deadlineRef.current = setTimeout(() => {
      // Hard timeout. Dispatch cancel and let the in-flight code see
      // attemptId mismatch (so its post-await dispatch is ignored).
      void cancelCurrentAttempt('timeout');
    }, ATTEMPT_TIMEOUT_MS);
  }

  async function cancelCurrentAttempt(reason: 'user' | 'timeout'): Promise<void> {
    const id = attemptIdRef.current;
    if (!id) return;
    // Spotify: also clear server-side pending flow.
    if (state.provider === 'spotify' && reason === 'user') {
      try {
        await cancelSpotifyAuth();
      } catch {
        /* best-effort */
      }
    }
    dispatch({ type: 'cancel', attemptId: id, reason });
    clearDeadline();
    attemptIdRef.current = null;
    void reportAuthEvent({
      provider: state.provider,
      attemptId: id,
      outcome: 'cancel',
      durationMs: Date.now() - attemptStartedRef.current,
      errorCode: reason === 'timeout' ? 'AUTH_TIMEOUT' : 'AUTH_CANCELLED',
    });
  }

  function newAttemptId(): AuthAttempt {
    return {
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      provider: state.provider,
      startedAt: Date.now(),
    };
  }

  function reportOutcome(outcome: 'ok' | 'fail', errorCode?: AuthErrorCode): void {
    const id = attemptIdRef.current;
    if (!id) return;
    void reportAuthEvent({
      provider: state.provider,
      attemptId: id,
      outcome,
      durationMs: Date.now() - attemptStartedRef.current,
      errorCode,
    });
  }

  // ── Provider change → reset phase + fetch status ─────────────────────────
  useEffect(() => {
    if (!provider) return;
    dispatch({ type: 'set_provider', provider });
    // If an attempt is in-flight, cancel it (provider switch implies user
    // is done with it).
    if (attemptIdRef.current) void cancelCurrentAttempt('user');
    consumedProtocolRef.current = false;
    void refreshStatus(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function refreshStatus(p: MusicProvider): Promise<void> {
    try {
      const status = await getAuthStatus(p);
      let tier: AuthState['tier'] = status.tier;
      if (p === 'spotify' && status.loggedIn) {
        try {
          const s = await getSpotifyStatus();
          tier = s.tier;
        } catch {
          /* keep undefined */
        }
      }
      dispatch({ type: 'set_status', loggedIn: status.loggedIn, user: status.user, tier });
      // Stale credential check (server hint).
      if (status.loggedIn) {
        try {
          const ext = await getAuthStatusExtended(p);
          if (
            ext.lastValidatedAt != null &&
            Date.now() - ext.lastValidatedAt > STALE_VALIDATION_MS
          ) {
            // Re-probe by re-issuing status; server will re-validate as
            // part of the same request.
            const fresh = await getAuthStatusExtended(p);
            if (!fresh.loggedIn) {
              dispatch({
                type: 'fail',
                error: {
                  code: 'AUTH_EXPIRED',
                  message: '会话已过期，请重新登录',
                  provider: p,
                  attemptId: 'stale-probe',
                  at: Date.now(),
                },
              });
            }
          }
        } catch {
          /* ignore — best-effort probe */
        }
      }
    } catch (e) {
      // The provider status fetch itself can fail if backend is down. We
      // surface the error via the legacy setError pipe (shared error
      // panel) so the user knows to retry.
      setError((e as Error).message);
    }
  }

  // ── One-shot OAuth callback drain (Electron) ─────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI;
    if (!api?.consumeOAuthCallback || consumedProtocolRef.current) return;
    consumedProtocolRef.current = true;
    void (async () => {
      const pending = await api.consumeOAuthCallback();
      if (!pending) return; // nothing buffered
      // The pending entry is { code, state, receivedAt }.
      // We don't auto-trigger a login here — the user still needs to be on
      // Spotify source. App.tsx's onSelect(source=spotify) flows through
      // the normal handleSpotifyLogin; the buffering was just to survive
      // the window-not-ready race.
      void pending;
    })();
  }, []);

  // ── Login flows ──────────────────────────────────────────────────────────

  const handleNeteaseLogin = async () => {
    if (attemptIdRef.current) return; // already in flight
    setError(null);
    const attempt = newAttemptId();
    dispatch({ type: 'start', attempt });
    startDeadline(attempt);
    dispatch({ type: 'enter_waiting_user' });

    try {
      if (!isElectron || !window.electronAPI?.neteaseLogin) {
        // Browser fallback: open QR modal via parent component.
        setShowCookieFallback(true);
        // External code path will call handleCookieFallbackSuccess on success
        // or handleCancel on cancel.
        return;
      }
      const result = await window.electronAPI.neteaseLogin();
      if (!result.success || !result.musicU) {
        const code: AuthErrorCode =
          result.error === 'login_cancelled' ? 'AUTH_CANCELLED' : 'AUTH_UNKNOWN';
        throw makeAuthError(code, result.error ?? '登录失败', attempt, state.provider);
      }
      dispatch({ type: 'enter_validating' });
      const r = await loginNeteaseCookie(
        result.musicU,
        result.csrfToken,
        result.extraCookies,
      );
      if (r.success) {
        dispatch({ type: 'succeed', user: r.user });
        loadNextTrack();
        reportOutcome('ok');
        clearDeadline();
        attemptIdRef.current = null;
      }
    } catch (e) {
      const err = e as Error & { code?: AuthErrorCode };
      const code: AuthErrorCode = (err.code as AuthErrorCode) ?? 'AUTH_UNKNOWN';
      dispatch({
        type: 'fail',
        error: {
          code,
          message: err.message,
          provider: state.provider,
          attemptId: attempt.id,
          at: Date.now(),
        },
      });
      reportOutcome('fail', code);
      clearDeadline();
      attemptIdRef.current = null;
    }
  };

  const handleQqLogin = async () => {
    if (attemptIdRef.current) return;
    if (!isElectron || !window.electronAPI?.qqLogin) {
      setError('QQ 音乐登录需要在桌面 App 中进行(浏览器无法捕获登录 cookie)');
      return;
    }
    setError(null);
    const attempt = newAttemptId();
    dispatch({ type: 'start', attempt });
    startDeadline(attempt);
    dispatch({ type: 'enter_waiting_user' });

    try {
      const result = await window.electronAPI.qqLogin();
      if (!result.success || !result.cookie) {
        const code: AuthErrorCode =
          result.error === 'login_cancelled' ? 'AUTH_CANCELLED' : 'AUTH_UNKNOWN';
        throw makeAuthError(code, result.error ?? '登录已取消', attempt, state.provider);
      }
      dispatch({ type: 'enter_validating' });
      const r = await loginQqCookie(result.cookie, result.uin, result.extraCookies);
      if (r.success) {
        dispatch({ type: 'succeed', user: r.user });
        loadNextTrack();
        reportOutcome('ok');
        clearDeadline();
        attemptIdRef.current = null;
      }
    } catch (e) {
      const err = e as Error & { code?: AuthErrorCode };
      const code: AuthErrorCode = (err.code as AuthErrorCode) ?? 'AUTH_UNKNOWN';
      dispatch({
        type: 'fail',
        error: {
          code,
          message: err.message,
          provider: state.provider,
          attemptId: attempt.id,
          at: Date.now(),
        },
      });
      reportOutcome('fail', code);
      clearDeadline();
      attemptIdRef.current = null;
    }
  };

  const handleSpotifyLogin = async () => {
    if (attemptIdRef.current) return;
    setError(null);
    const attempt = newAttemptId();
    dispatch({ type: 'start', attempt });
    startDeadline(attempt);
    dispatch({ type: 'enter_waiting_user' });

    try {
      const status = await getSpotifyStatus();
      if (!status.hasClientId) {
        let id: string | null = null;
        try {
          id = window.prompt(
            '需要先在 Spotify Developer 后台创建应用，拿到 client_id 后粘到这里：\n' +
              '（https://developer.spotify.com/dashboard → Create app）',
          );
        } catch {
          throw makeAuthError(
            'AUTH_INVALID',
            '未配置 Spotify client_id。请在 .env 中设置 SPOTIFY_CLIENT_ID=',
            attempt,
            state.provider,
          );
        }
        if (!id || !id.trim()) {
          throw makeAuthError(
            'AUTH_CANCELLED',
            '已取消：未填 Spotify client_id',
            attempt,
            state.provider,
          );
        }
        await setSpotifyClientId(id.trim());
      }
      if (isElectron && window.electronAPI?.openExternal) {
        const { authorizeUrl } = await startSpotify('maestro://spotify-callback');
        await window.electronAPI.openExternal(authorizeUrl);
        // Wait for the OAuth callback (buffered or live). The buffer may
        // already have a value from before the window was ready.
        const pending =
          (await window.electronAPI?.consumeOAuthCallback?.()) ?? null;
        // OAuth error variant (user denied / provider rejection): bail
        // immediately rather than waiting the full 10 min.
        if (pending && 'error' in pending) {
          throw makeAuthError(
            'AUTH_CANCELLED',
            `Spotify 登录被拒绝：${pending.error}`,
            attempt,
            state.provider,
          );
        }
        let code: string;
        let stateVal: string;
        if (pending && 'code' in pending && pending.code && pending.state) {
          code = pending.code;
          stateVal = pending.state;
        } else {
          const result = await new Promise<{ code: string; state: string }>(
            (resolve) => {
              const handler = (...args: unknown[]) => {
                const data = args[0] as { code: string; state: string };
                window.electronAPI!.removeListener('spotify:oauth-protocol', handler);
                resolve(data);
              };
              window.electronAPI!.on('spotify:oauth-protocol', handler);
            },
          );
          code = result.code;
          stateVal = result.state;
        }
        dispatch({ type: 'enter_validating' });
        const redeemed = await redeemSpotifyCode(code, stateVal);
        if (redeemed.ok) {
          const s = await getSpotifyStatus();
          dispatch({
            type: 'succeed',
            user: {
              nickname: redeemed.profile.displayName,
              avatarUrl: '',
            },
            tier: s.tier,
          });
          loadNextTrack();
          reportOutcome('ok');
          clearDeadline();
          attemptIdRef.current = null;
        } else {
          throw makeAuthError('AUTH_INVALID', 'Spotify 登录失败：redeem 失败', attempt, state.provider);
        }
        return;
      }
      // Browser fallback: window.open + 90s polling.
      const { authorizeUrl } = await startSpotify();
      window.open(authorizeUrl, '_blank', 'noopener');
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await getSpotifyStatus();
        if (s.loggedIn) {
          const full = await getAuthStatus('spotify');
          dispatch({
            type: 'succeed',
            user: full.user,
            tier: s.tier,
          });
          loadNextTrack();
          reportOutcome('ok');
          clearDeadline();
          attemptIdRef.current = null;
          return;
        }
      }
      throw makeAuthError('AUTH_TIMEOUT', 'Spotify 登录超时（90s），请重试', attempt, state.provider);
    } catch (e) {
      const err = e as Error & { code?: AuthErrorCode };
      const code: AuthErrorCode = (err.code as AuthErrorCode) ?? 'AUTH_UNKNOWN';
      dispatch({
        type: 'fail',
        error: {
          code,
          message: err.message,
          provider: state.provider,
          attemptId: attempt.id,
          at: Date.now(),
        },
      });
      reportOutcome('fail', code);
      clearDeadline();
      attemptIdRef.current = null;
    }
  };

  const handleLogout = async () => {
    if (!provider) return;
    try {
      await logout(provider);
    } catch {
      /* best-effort */
    }
    dispatch({
      type: 'set_status',
      loggedIn: false,
      user: null,
    });
  };

  const handleCookieFallbackSuccess = (user: AuthUser) => {
    if (attemptIdRef.current) {
      dispatch({ type: 'succeed', user });
      loadNextTrack();
      reportOutcome('ok');
      clearDeadline();
      attemptIdRef.current = null;
    }
  };

  const handleCancel = () => {
    if (attemptIdRef.current) void cancelCurrentAttempt('user');
  };

  const handleRetry = () => {
    dispatch({ type: 'dismiss_error' });
    // Trigger the relevant login flow based on provider.
    if (provider === 'netease') void handleNeteaseLogin();
    else if (provider === 'qq') void handleQqLogin();
    else if (provider === 'spotify') void handleSpotifyLogin();
  };

  const resetAuth = () => {
    if (attemptIdRef.current) void cancelCurrentAttempt('user');
    dispatch({
      type: 'set_status',
      loggedIn: false,
      user: null,
    });
  };

  // Back-compat: App.tsx still reads auth.{loggedIn, user, tier} and
  // loggingIn / showCookieFallback. The reducer-driven state provides
  // these through `state`.
  return {
    auth: {
      provider: state.provider,
      loggedIn: state.loggedIn,
      user: state.user,
      tier: state.tier,
    } as AuthStatus,
    loggingIn:
      state.phase.kind === 'starting' ||
      state.phase.kind === 'waiting_user' ||
      state.phase.kind === 'validating',
    showCookieFallback,
    setShowCookieFallback,
    handleNeteaseLogin,
    handleQqLogin,
    handleSpotifyLogin,
    handleLogout,
    handleCookieFallbackSuccess,
    handleCancel,
    handleRetry,
    handleDismissError: () => dispatch({ type: 'dismiss_error' }),
    resetAuth,
    /** New: full reducer state for the AuthErrorPanel. */
    authError: state.error,
    authPhase: state.phase,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function makeAuthError(
  code: AuthErrorCode,
  message: string,
  attempt: AuthAttempt,
  provider: MusicProvider,
): Error & { code: AuthErrorCode } {
  const e = new Error(message) as Error & { code: AuthErrorCode };
  e.code = code;
  void attempt;
  void provider;
  return e;
}
