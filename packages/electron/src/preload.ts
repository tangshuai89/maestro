import { contextBridge, ipcRenderer } from 'electron';

/**
 * Renderer ↔ main bridge. Only methods that *must* run in the main process
 * (opening windows, accessing native session cookies) live here. Everything
 * else (API calls, audio state) stays in the renderer.
 */

/** Allowlist of IPC channels the renderer can subscribe to.
 *  Anything not in this list is rejected — see B2 in docs/audit-2026-07-30.md
 *  for why a wildcard was a security hole (any renderer XSS could listen
 *  to future oauth/deeplink/secrets channels). Add new channels here
 *  explicitly when adding new IPC subscriptions. */
const SUBSCRIBABLE_CHANNELS = new Set([
  'sidecar-ready',
  'qq-login-result',
  'netease-login-result',
  'tray:command',
  'spotify:oauth-protocol',
  'console-message', // forwarded to main for debugging
]);

export interface QqLoginResult {
  /** Full "k=v; k=v" QQ Music login cookie header. */
  cookie: string;
  /** Normalised numeric uin for musicu.fcg. */
  uin?: string;
  extraCookies?: Record<string, string>;
}

export interface QqLoginResponse {
  success: boolean;
  cookie?: string;
  uin?: string;
  extraCookies?: Record<string, string>;
  error?: string;
}

export interface NeteaseLoginResponse {
  success: boolean;
  musicU?: string;
  csrfToken?: string;
  extraCookies?: Record<string, string>;
  error?: string;
}

/** Transport commands emitted by the macOS tray menu. */
export type TrayCommand = 'playpause' | 'next' | 'prev';

/** Playback state the renderer reports up so the tray stays in sync. */
export interface PlaybackState {
  isPlaying: boolean;
  title?: string;
  artist?: string;
}

const electronAPI = {
  platform: process.platform,

  /**
   * 后端 NestJS sidecar 的 base URL。prod 模式 main 进程 spawn 出 sidecar
   * 后会把真实 URL 通过 'sidecar-ready' 事件推过来；dev 模式 main 还没
   * 来得及 push 时为空字符串，renderer 此时用 import.meta.env 推导
   * （Vite proxy）。
   */
  apiBase: '' as string,

  /**
   * X-Maestro-Token 共享密钥：Electron main 每次启动生成一个随机 token，
   * 通过 sidecar-ready 事件推到 renderer。RequireInternalTokenGuard 在
   * server 侧验证 X-Maestro-Token header。dev 模式（无 Electron）下为空
   * 字符串，server 进入"宽松模式 + 警告日志"。
   */
  internalToken: '' as string,

  /**
   * 订阅 sidecar ready 事件。payload: { apiBase, internalToken }。
   * renderer 端拿到后写到 electronAPI.apiBase + internalToken，api.ts 的
   * fetch wrapper 会读 internalToken 注入到 X-Maestro-Token header。
   */
  onSidecarReady: (cb: (info: { apiBase: string; internalToken: string }) => void): (() => void) => {
    const handler = (_e: unknown, payload: { apiBase: string; internalToken: string }): void => {
      // 主进程发过来后写回 apiBase + internalToken，让所有 fetch 直接读到
      const apis = electronAPI as { apiBase: string; internalToken: string };
      apis.apiBase = payload.apiBase;
      apis.internalToken = payload.internalToken;
      cb(payload);
    };
    ipcRenderer.on('sidecar-ready', handler);
    return () => ipcRenderer.removeListener('sidecar-ready', handler);
  },

  /** Open a QQ Music login window; resolves when the login cookie is captured. */
  qqLogin: (): Promise<QqLoginResponse> => ipcRenderer.invoke('qq:login'),  /** Open a NetEase login window; resolves when the login cookie is captured. */
  neteaseLogin: (): Promise<NeteaseLoginResponse> =>
    ipcRenderer.invoke('netease:login'),

  /** Widevine CDM 就绪状态（Spotify WPS 全曲播放必需）。Renderer 在
   *  WPS 初始化失败时（"No supported keysystem was found"）用它排查。 */
  getWidevineStatus: (): Promise<{ ready: boolean; status: unknown }> =>
    ipcRenderer.invoke('widevine:status'),

  /** Subscribe to QQ login-completed events. */
  onQqLoginSuccess: (cb: (r: QqLoginResult) => void): (() => void) => {
    const handler = (_e: unknown, payload: QqLoginResult): void => cb(payload);
    ipcRenderer.on('qq-login-result', handler);
    return () => ipcRenderer.removeListener('qq-login-result', handler);
  },

  /**
   * Open a URL in the user's default browser. Used by Spotify OAuth — the
   * authorization URL needs to land in a real browser session, not inside
   * the Electron webview. The Electron docs warn that opening arbitrary
   * external URLs from a renderer is a security smell, so this is bridged
   * through main where shell.openExternal can validate / whitelist.
   */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:open-external', url),

  /**
   * Subscribe to tray transport commands ('playpause' | 'next' | 'prev').
   * The renderer maps them onto usePlayer actions. Returns an unsubscribe fn.
   */
  onTrayCommand: (cb: (command: TrayCommand) => void): (() => void) => {
    const handler = (_e: unknown, command: TrayCommand): void => cb(command);
    ipcRenderer.on('tray:command', handler);
    return () => ipcRenderer.removeListener('tray:command', handler);
  },

  /** Report current playback state to main so the tray label/tooltip sync. */
  reportPlaybackState: (state: PlaybackState): void =>
    ipcRenderer.send('player:state', state),

  /** Tell main we're in Electron so the renderer can branch its behaviour. */
  isElectron: true as const,

  /**
   * Whitelisted IPC subscription (B2 hardening — replaces the previous
   * `on(event, cb)` wildcard which let any channel be listened to).
   *
   * Channels NOT in SUBSCRIBABLE_CHANNELS are silently dropped. Add a new
   * channel there explicitly when introducing new IPC events.
   *
   * Callback receives `(payload)` — the IPC `event` arg is stripped, since
   * exposing the underlying Electron event object back to the renderer
   * would re-introduce a sandbox-escape surface.
   */
  onIpc: <T = unknown>(channel: string, cb: (payload: T) => void): (() => void) => {
    if (!SUBSCRIBABLE_CHANNELS.has(channel)) {
      console.warn(`[preload] refused to subscribe to non-allowlisted channel "${channel}"`);
      return () => undefined;
    }
    const handler = (_e: unknown, payload: T): void => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Pull the most recent (or pending) Spotify OAuth callback. Returns
   * `null` if no callback is buffered AND none arrives within 10 minutes.
   * The result can be either a successful {code, state, receivedAt} or an
   * error variant {error, state?, receivedAt} when the OAuth provider
   * redirected with ?error=... — used by `useAuth` to bail instead of
   * waiting the full 10 min on a denied authorization.
   * Used by `useAuth` to survive the "OS hands the URL before main window
   * is ready" race.
   */
  consumeOAuthCallback: (): Promise<
    | { code: string; state: string; receivedAt: number }
    | { error: string; state?: string; receivedAt: number }
    | null
  > => ipcRenderer.invoke('consume-oauth-callback'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Ambient type for renderer code
export type ElectronAPI = typeof electronAPI;