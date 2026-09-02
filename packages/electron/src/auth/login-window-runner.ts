import { BrowserWindow, type Cookie } from 'electron';

/**
 * Minimal shape of a webContents' session that the runner needs.
 * We narrow to this so the unit tests can pass a fake session object that
 * records `on('changed', ...)` and `off(...)` calls.
 */
export interface MinimalSession {
  cookies: {
    on(
      event: 'changed',
      listener: (
        event: unknown,
        cookie: Cookie,
        cause: string,
        removed: boolean,
      ) => void,
    ): void;
    off(
      event: 'changed',
      listener: (
        event: unknown,
        cookie: Cookie,
        cause: string,
        removed: boolean,
      ) => void,
    ): void;
  };
}

/**
 * Shape the runner needs from a BrowserWindow. Narrowed so unit tests can
 * supply a fake without booting Electron.
 */
export interface MinimalBrowserWindow {
  webContents: {
    session: MinimalSession;
    setWindowOpenHandler?: (h: (details: unknown) => { action: string }) => void;
  };
  isDestroyed(): boolean;
  hide?(): void;
  close?(): void;
  destroy?(): void;
  on?(event: 'closed', cb: () => void): void;
}

export interface LoginWindowConfig<T> {
  /** URL the login window loads (e.g. y.qq.com, music.163.com/login). */
  url: string;
  /** Display title for the login window. */
  title: string;
  /** Window dimensions. */
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** Cookie domains to inspect (e.g. ['.qq.com', '.y.qq.com']). */
  domains: string[];
  /**
   * Capture predicate. Called repeatedly (cookie 'changed' event + polling
   * fallback). Return a non-null T to short-circuit and resolve the
   * promise; return null to keep waiting.
   *
   * The predicate is also expected to filter out expired cookies and
   * de-dupe by name. The runner doesn't touch the cookie values.
   */
  capture: (win: MinimalBrowserWindow) => Promise<T | null>;
  /** Hard deadline (ms) for the whole attempt. Default 120 s. */
  deadlineMs?: number;
  /** Polling interval (ms) for the capture fallback. Default 1.5 s. */
  pollIntervalMs?: number;
  /**
   * Factory that creates a new BrowserWindow-like object. The runner
   * injects this so unit tests can supply a fake. The default uses
   * `new BrowserWindow(...)`.
   */
  createWindow: () => MinimalBrowserWindow;
  /**
   * After successful capture, hide (true) or close (false) the window.
   * QQ keeps the window alive for potential future proxying; NetEase
   * closes it because there's no follow-up use.
   */
  keepAliveAfterSuccess?: boolean;
  /**
   * Cookie listener filter. The runner only calls `capture` for cookies
   * whose domain matches one of `domains` and whose name is included in
   * `markerNames` (or all cookies if `markerNames` is empty).
   */
  markerNames?: string[];
  /** Optional logger. Defaults to console. */
  log?: (msg: string) => void;
}

const DEFAULT_DEADLINE_MS = 120_000;
const DEFAULT_POLL_MS = 1_500;

/**
 * Single-ownership runner for embedded login windows. The previous
 * implementation leaked `cookie 'changed'` listeners (one per call) and
 * never consistently cleared polling timers on the cancel path. This
 * runner guarantees:
 *
 *   1. cookie listener is registered exactly once per call, removed in
 *      `finally` even if `capture` throws.
 *   2. polling interval is cleared in `finally` even on timeout.
 *   3. window is closed (or hidden) in `finally` if not already.
 *   4. caller-supplied `createWindow` is the only place a window
 *      instance is born, so the unit test can pass a fake.
 *
 * Returns a Promise that resolves with the captured result, or rejects
 * with an Error whose `.code` is one of:
 *   - 'LOGIN_TIMEOUT'   — `deadlineMs` elapsed
 *   - 'LOGIN_CANCELLED' — window 'closed' before capture
 *   - 'LOGIN_FAILED'    — any other error from the capture / window path
 */
export async function runLoginWindow<T>(
  cfg: LoginWindowConfig<T>,
): Promise<T> {
  const deadline = cfg.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const pollMs = cfg.pollIntervalMs ?? DEFAULT_POLL_MS;
  const log = cfg.log ?? ((m) => console.log(`[login-window] ${m}`));
  const markerNames = cfg.markerNames ?? [];

  let win: MinimalBrowserWindow | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let resolved = false;
  let cookieListener: ((e: unknown, c: Cookie, cause: string, removed: boolean) => void) | null = null;
  // T9 (consistency-fixes F3)：capture() 是否在途。用户关窗时如果
  // capture() 已拿到结果但 resolve 还没跑（microtask 间隙），旧实现
  // 直接 fail('LOGIN_CANCELLED') 把已捕到的 cookie 丢弃。capturing
  // 旗位让 'closed' 监听在 capture() resolve 后再 fail（成功）或
  // fail（真没捕到）。
  let capturing = false;

  return new Promise<T>((resolve, reject) => {
    function cleanup(): void {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      if (win && !win.isDestroyed()) {
        try {
          if (resolved && cfg.keepAliveAfterSuccess) {
            win.hide?.();
          } else {
            win.close?.();
          }
        } catch {
          /* ignore */
        }
      }
      if (win && cookieListener) {
        try {
          win.webContents.session.cookies.off('changed', cookieListener);
        } catch {
          /* ignore */
        }
        cookieListener = null;
      }
    }

    function fail(err: Error): void {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(err);
    }

    function succeed(result: T): void {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    }

    try {
      win = cfg.createWindow();
    } catch (err) {
      fail(wrapError('LOGIN_FAILED', `createWindow: ${(err as Error).message}`));
      return;
    }

    win.webContents.setWindowOpenHandler?.(() => ({ action: 'allow' }));

    const tryCapture = async (): Promise<void> => {
      if (resolved || !win || win.isDestroyed()) return;
      capturing = true;
      try {
        const out = await cfg.capture(win);
        if (out != null) succeed(out);
      } catch (err) {
        fail(wrapError('LOGIN_FAILED', (err as Error).message));
      } finally {
        capturing = false;
      }
    };

    cookieListener = (
      _e: unknown,
      cookie: Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (resolved) return;
      if (removed) return;
      const domain = cookie.domain ?? '';
      // Domain match must be suffix-based, NOT substring. Old code did
      // `domain.includes(d.replace(/^\./, ''))` which accepted lookalike
      // hosts like 'attacker-y.qq.com' (substring contains 'y.qq.com')
      // and would try to capture cookies set on those domains — the
      // cookie capture runs on every page load, so a redirect to a
      // lookalike would have leaked the user's session into the wrong
      // session blob. Now: exact match OR suffix match (cookie belongs to
      // the registered domain or one of its subdomains).
      //
      // Electron's Cookie.domain has a leading dot ('.y.qq.com'). Strip
      // both sides before comparing so the match is purely suffix-based.
      const matchesDomain = cfg.domains.some((d) => {
        const want = d.replace(/^\./, ''); // strip leading dot from cfg
        const got = domain.replace(/^\./, ''); // and from cookie
        return got === want || got.endsWith('.' + want);
      });
      if (!matchesDomain) return;
      if (markerNames.length > 0 && !markerNames.includes(cookie.name)) return;
      void tryCapture();
    };

    try {
      win.webContents.session.cookies.on('changed', cookieListener);
    } catch (err) {
      fail(wrapError('LOGIN_FAILED', `cookies.on: ${(err as Error).message}`));
      return;
    }

    pollTimer = setInterval(() => {
      void tryCapture();
    }, pollMs);

    deadlineTimer = setTimeout(() => {
      fail(wrapError('LOGIN_TIMEOUT', `login window timed out after ${deadline}ms`));
    }, deadline);

    win.on?.('closed', () => {
      if (resolved) return;
      // T9 F3：关窗时如果 capture() 在途（microtask 间隙）→ 等它落定。
      // capture 成功（已捕到 cookie）→ succeed；capture 失败/返回 null
      // → fail 'LOGIN_CANCELLED'。
      if (capturing) {
        setImmediate(() => {
          if (!resolved) fail(wrapError('LOGIN_CANCELLED', 'login window closed'));
        });
      } else {
        fail(wrapError('LOGIN_CANCELLED', 'login window closed'));
      }
    });

    // Electron's BrowserWindow doesn't expose a "loaded" hook here; we
    // call loadURL synchronously after construction. The caller-provided
    // createWindow is responsible for triggering the load (so the fake
    // can simulate it).
    log(`opened ${cfg.title} (deadline=${deadline}ms, poll=${pollMs}ms)`);
  });
}

function wrapError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}
