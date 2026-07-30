/**
 * Buffer for the Spotify OAuth `maestro://` protocol callback. The OS
 * hands the URL to the Electron app via `app.on('open-url', ...)` at any
 * moment — including before the main window's webContents is ready (or
 * while it's being recreated after a window-close). The previous
 * implementation used a 1 s setTimeout to retry, which dropped the
 * callback if the main window was destroyed for longer.
 *
 * This buffer holds the latest callback for up to 10 minutes; the
 * renderer pulls it via `consumeOAuthCallback()` IPC. The 10-min cap
 * matches the PKCE flow TTL (so a stale callback never lands on a
 * different flow).
 */
const TTL_MS = 10 * 60_000;

export interface BufferedCallback {
  code: string;
  state: string;
  receivedAt: number;
}

/** Error variant when the OAuth provider rejected the user (e.g.
 *  `?error=access_denied`). The renderer can use `error` to surface a
 *  friendly message and bail out of the 10-min wait. */
export interface BufferedError {
  error: string;
  state?: string;
  receivedAt: number;
}

export type BufferedOAuthEntry = BufferedCallback | BufferedError;

function isErrorEntry(e: BufferedOAuthEntry | null): e is BufferedError {
  return !!e && typeof (e as BufferedError).error === 'string';
}

export class OAuthCallbackBuffer {
  private pending: BufferedOAuthEntry | null = null;
  private consumer: ((cb: BufferedOAuthEntry | null) => void) | null = null;

  /**
   * Called from main process's `app.on('open-url', ...)` handler. If a
   * consumer is already registered, flushes immediately; otherwise
   * buffers (within TTL). Replaces any older pending entry — Spotify
   * starts a single OAuth flow at a time, so the newest callback wins.
   */
  push(code: string, state: string): void {
    const cb: BufferedCallback = { code, state, receivedAt: Date.now() };
    if (this.consumer) {
      const c = this.consumer;
      this.consumer = null;
      this.pending = null;
      c(cb);
      return;
    }
    this.pending = cb;
  }

  /** Push an OAuth error (user denied / provider rejection). */
  pushError(error: string, state: string | undefined, _url: string): void {
    const e: BufferedError = { error, state, receivedAt: Date.now() };
    if (this.consumer) {
      const c = this.consumer;
      this.consumer = null;
      this.pending = null;
      c(e);
      return;
    }
    this.pending = e;
  }

  /**
   * Called from preload's `consumeOAuthCallback()` IPC. If a buffered
   * callback exists and is still within TTL, returns it and clears the
   * buffer. Otherwise returns null. Registers a one-shot consumer that
   * will receive the next push (useful when the renderer starts before
   * the OS hands the URL).
   */
  consume(): Promise<BufferedOAuthEntry | null> {
    if (this.pending) {
      if (Date.now() - this.pending.receivedAt > TTL_MS) {
        this.pending = null;
        return Promise.resolve(null);
      }
      const out = this.pending;
      this.pending = null;
      return Promise.resolve(out);
    }
    return new Promise((resolve) => {
      // Auto-expire the consumer after TTL so a renderer that registered
      // a consumer too late doesn't sit waiting forever.
      this.consumer = (cb) => {
        if (!cb) {
          resolve(null);
          return;
        }
        if (Date.now() - cb.receivedAt > TTL_MS) {
          resolve(null);
          return;
        }
        resolve(cb);
      };
      // Set a TTL fallback in case no push ever arrives.
      setTimeout(() => {
        if (this.consumer) {
          this.consumer(null);
          this.consumer = null;
        }
      }, TTL_MS).unref?.();
    });
  }

  /** Test / diagnostics: peek without consuming. */
  peek(): BufferedOAuthEntry | null {
    if (!this.pending) return null;
    if (Date.now() - this.pending.receivedAt > TTL_MS) {
      this.pending = null;
      return null;
    }
    return this.pending;
  }

  /** True if the current pending entry is an error (vs. a success code). */
  hasError(): boolean {
    return isErrorEntry(this.pending);
  }
}

export const oauthBuffer = new OAuthCallbackBuffer();
export { TTL_MS as OAUTH_BUFFER_TTL_MS };
