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

type Waiter = {
  resolve: (cb: BufferedOAuthEntry | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class OAuthCallbackBuffer {
  // Single slot for "callback already buffered, no consumer yet".
  // When set, the next consume() returns it immediately.
  private pending: BufferedOAuthEntry | null = null;
  // FIFO queue of consumers awaiting a push. Drained in order on push()
  // /pushError(). Replaces the previous single-consumer field — that one
  // overwrote concurrent callers (e.g. React Strict Mode would mount
  // twice; the first mount's Promise leaked forever, never resolving).
  // With a queue every concurrent consume() gets the same entry, all
  // Promises settle, none leak.
  private readonly waiters: Waiter[] = [];

  /**
   * Called from main process's `app.on('open-url', ...)` handler. If
   * there are any queued consumers, drain the queue by resolving every
   * one with the new entry (FIFO). Otherwise buffer (within TTL).
   * Replaces any older pending entry — Spotify starts a single OAuth
   * flow at a time, so the newest callback wins for subsequent
   * consumers.
   */
  push(code: string, state: string): void {
    const cb: BufferedCallback = { code, state, receivedAt: Date.now() };
    this.deliver(cb);
  }

  /** Push an OAuth error (user denied / provider rejection). */
  pushError(error: string, state: string | undefined, _url: string): void {
    const e: BufferedError = { error, state, receivedAt: Date.now() };
    this.deliver(e);
  }

  /** Drain **only the FIFO head** waiter with `entry`, else buffer
   *  `entry` for the next consume(). pending is cleared by consume() on
   *  the capture path; deliver() doesn't touch it.
   *
   * T9 (consistency-fixes F2)：每次 push 只 resolve 一个 waiter。
   * 历史行为是「drain all waiters」——同一 OAuth PKCE code 被多个并发
   * consume() 拿到后各自调 /auth/spotify/redeem，第二次 redeem 因 Spotify
   * 服务端 one-shot 校验返 invalid_grant。FIFO-head-only 让多余的
   * consume() 继续等下一次 push（避免同一个 code 被消费多次）。
   */
  private deliver(entry: BufferedOAuthEntry): void {
    if (this.waiters.length > 0) {
      const head = this.waiters.shift()!;
      clearTimeout(head.timer);
      head.resolve(entry);
      return;
    }
    this.pending = entry;
  }

  /**
   * Called from preload's `consumeOAuthCallback()` IPC. If a buffered
   * callback exists and is still within TTL, returns it AND clears the
   * slot — concurrent callers that arrive after the synchronous return
   * will block on the next push (so OAuth codes are not double-used).
   *
   * When concurrent callers race (e.g. React Strict Mode double-mount),
   * all callers that arrive while pending is set get the entry. The first
   * one in clears the slot; subsequent synchronous ones see pending=null
   * and enqueue instead.
   */
  consume(): Promise<BufferedOAuthEntry | null> {
    if (this.pending) {
      if (Date.now() - this.pending.receivedAt > TTL_MS) {
        this.pending = null;
        return Promise.resolve(null);
      }
      // Capture-and-clear so follow-up consume()s block on the next
      // push (one-shot OAuth code semantics). Race note: if a second
      // consume() runs in the same microtask and also sees pending, both
      // return the same entry. In practice the renderer code path only
      // has one consume() per login flow, so this is fine.
      const out = this.pending;
      this.pending = null;
      return Promise.resolve(out);
    }
    return new Promise<BufferedOAuthEntry | null>((resolve) => {
      // Per-waiter TTL fallback so a renderer that registered too late
      // doesn't sit waiting forever. unref so it doesn't block exit.
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, TTL_MS);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref?: () => void }).unref?.();
      }
      this.waiters.push({
        resolve: (cb) => {
          if (!cb) {
            resolve(null);
            return;
          }
          if (Date.now() - cb.receivedAt > TTL_MS) {
            resolve(null);
            return;
          }
          resolve(cb);
        },
        timer,
      });
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
