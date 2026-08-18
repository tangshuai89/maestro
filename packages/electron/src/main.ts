import {
  app,
  // castLabs Electron fork：components 模块负责加载/校验 Widevine CDM。
  // 官方 electron 无此导出——本项目依赖已换成 github:castlabs/electron-releases。
  components,
  BrowserWindow,
  shell,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { runLoginWindow, type MinimalBrowserWindow } from './auth/login-window-runner';
import { oauthBuffer } from './auth/oauth-buffer';

// Pin the app name so userData / logs land under a stable, branded dir in
// BOTH dev and packaged mode (~/Library/Application Support/Maestro). Without
// this, dev would derive the name from the electron package.json (@maestro/…).
app.setName('Maestro');

const isDev = !app.isPackaged;

/**
 * Internal-token guard shared secret (Audit B1).
 *
 * Generated once per Electron launch (random 32 bytes hex). Passed to the
 * NestJS sidecar via the MAESTRO_INTERNAL_TOKEN env var so the server's
 * RequireInternalTokenGuard can verify `X-Maestro-Token` headers from the
 * renderer; also exposed to the renderer through preload's contextBridge
 * (window.electronAPI.internalToken) so api.ts can inject it on every
 * state-changing request.
 *
 * Why per-launch: tokens that persist across launches are an attractive
 * exfiltration target — anything that reads the user's profile dir gets
 * them. Per-launch means a token leak window is bounded to one app run.
 *
 * In dev mode (isDev === true) the renderer is served by Vite, not by
 * this Electron process — the sidecar still gets the token, but the
 * Vite-served renderer can't easily read it from preload (no preload
 * injected by Vite). Dev users can still hit the server: the guard
 * falls back to "permissive + warn" when MAESTRO_INTERNAL_TOKEN is empty
 * (i.e. when the sidecar is started outside Electron), so a manually-run
 * `npm run dev:server` still works. The token mechanism only arms when
 * Electron main is the sidecar's parent — production only.
 */
const maestroInternalToken = randomBytes(32).toString('hex');

let mainWindow: BrowserWindow | null = null;

/**
 * Runtime asset (icons) resolver. In dev, assets live in `packages/electron/build`
 * (one level up from the compiled `dist/`). In a packaged app they're copied to
 * `Resources/build/` via electron-builder extraResources.
 */
function assetPath(name: string): string {
  return isDev
    ? path.join(__dirname, '..', 'build', name)
    : path.join(process.resourcesPath, 'build', name);
}

/** Set true once the user really wants to quit (Cmd+Q / tray Quit), so the
 * window `close` handler stops hiding-to-tray and lets the app exit. */
let isQuitting = false;

// ── NestJS sidecar（packaged 模式） ────────────────────────────────────────

/** Sidecar 进程。dev 模式不启动（用户用 `npm run dev:server` 自己跑）。 */
let sidecar: ChildProcess | null = null;

/** Sidecar 端口，默认 3200；PORT env 可改。 */
const SIDECAR_PORT = Number(process.env.PORT ?? 3200);

/** 等端口就绪（轮询 :3200/music/deezer/editorials 之类的轻量 endpoint）。 */
async function waitForSidecar(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/music/deezer/editorials`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`sidecar not ready after ${timeoutMs}ms on :${port}`);
}

/** Spawn NestJS sidecar（packaged 模式）。 */
function startSidecar(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isDev) {
      // dev 模式：用户自己跑 `npm run dev:server`，别在这里再起一个
      resolve();
      return;
    }
    const serverEntry = path.join(
      process.resourcesPath,
      'server',
      'main.js',
    );
    console.log(`[main] spawning sidecar: ${serverEntry}`);
    // Persist under Electron's userData (~/Library/Application Support/Maestro
    // on macOS) so state + backups survive app updates and live in a stable,
    // user-discoverable place — not next to the read-only .app bundle. Backups
    // sit alongside state.json in a `backups/` subdir.
    const userData = app.getPath('userData');
    sidecar = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        // Electron 的 process.execPath 就是 node（在 packaged Electron 里
        // 也是），所以可以直接 spawn 它跑 .js。Mac 上在某些版本可能需要
        // ELECTRON_RUN_AS_NODE=1 才能当 node 用。
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(SIDECAR_PORT),
        STORAGE_DIR: path.join(userData, '.storage'),
        STORAGE_BACKUP_DIR: path.join(userData, 'backups'),
        MAESTRO_INTERNAL_TOKEN: maestroInternalToken,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    sidecar.stdout?.on('data', (b) => process.stdout.write(`[sidecar] ${b}`));
    sidecar.stderr?.on('data', (b) => process.stderr.write(`[sidecar-err] ${b}`));
    sidecar.on('error', (err) => {
      console.error('[main] sidecar spawn error:', err);
      reject(err);
    });
    sidecar.on('exit', (code) => {
      console.log(`[main] sidecar exited with code=${code}`);
      sidecar = null;
    });
    waitForSidecar(SIDECAR_PORT)
      .then(() => resolve())
      .catch(reject);
  });
}

/** 关闭 sidecar。app quit 时调。 */
function stopSidecar(): void {
  if (!sidecar) return;
  console.log('[main] killing sidecar');
  try {
    sidecar.kill('SIGTERM');
  } catch {
    // ignore
  }
  sidecar = null;
}

// ── Tray + media controls ────────────────────────────────────────────────────
//
// The tray menu drives playback by sending 'tray:command' to the renderer,
// which owns the actual player state (usePlayer). The renderer reports back its
// state via 'player:state' so the tray label/tooltip stay in sync. This keeps a
// single source of truth (no duplicate play logic in main).

let tray: Tray | null = null;

interface PlaybackState {
  isPlaying: boolean;
  title?: string;
  artist?: string;
}

let playbackState: PlaybackState = { isPlaying: false };

/** Bring the main window back from the tray (or recreate it if it was torn
 * down). Used by the tray "Show" item and by app `activate`. */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/** Send a transport command to the renderer's player. */
function sendTrayCommand(command: 'playpause' | 'next' | 'prev'): void {
  mainWindow?.webContents.send('tray:command', command);
}

/** Rebuild the tray context menu + tooltip from the current playback state. */
function refreshTray(): void {
  if (!tray) return;
  const { isPlaying, title, artist } = playbackState;
  const nowPlaying = title
    ? `${title}${artist ? ` — ${artist}` : ''}`
    : '未在播放';
  const menu = Menu.buildFromTemplate([
    { label: nowPlaying, enabled: false },
    { type: 'separator' },
    {
      label: isPlaying ? '暂停' : '播放',
      click: () => sendTrayCommand('playpause'),
    },
    { label: '上一首', click: () => sendTrayCommand('prev') },
    { label: '下一首', click: () => sendTrayCommand('next') },
    { type: 'separator' },
    { label: '显示主窗口', click: () => showMainWindow() },
    {
      label: '退出 Maestro',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(title ? `Maestro · ${nowPlaying}` : 'Maestro');
}

function createTray(): void {
  if (tray) return;
  const image = nativeImage.createFromPath(assetPath('trayTemplate.png'));
  // Template image → macOS auto-inverts it for light/dark menubars.
  image.setTemplateImage(true);
  tray = new Tray(image);
  refreshTray();
}

/** The QQ Music login window (kept alive hidden after success so we could
 *  proxy through its Chromium session later if QQ ever tightens anti-bot). */
let activeQqLoginWindow: BrowserWindow | null = null;

/** In-flight QQ login promise — shared by concurrent callers so we don't
 *  spawn two windows (race fix: between A's runLoginWindow start and the
 *  cached-result being set on the window, B's click could otherwise spawn
 *  a second BrowserWindow, orphaning A). */
let qqLoginInFlight: Promise<QqLoginResult> | null = null;

/** Stash the last captured login result on the BrowserWindow so a re-
 *  invoke from the renderer (login window already open + user clicks
 *  "login" again) resolves immediately without re-capturing. */
interface MaestroWindowExtras {
  __maestroLastResult?: unknown;
}

/** IPC response channel for cookie-based login (QQ Music). */
const QQ_LOGIN_CHANNEL = 'qq-login-result';

/** The NetEase login window (embedded-browser cookie capture). */
let activeNeteaseLoginWindow: BrowserWindow | null = null;

/** In-flight NetEase login promise (same race fix as QQ). */
let neteaseLoginInFlight: Promise<NeteaseLoginResult> | null = null;

/** IPC response channel for cookie-based login (NetEase). */
const NETEASE_LOGIN_CHANNEL = 'netease-login-result';

/** Cookie polling interval for the login window (cookie 'changed' events
 * don't always fire reliably across redirects). */
const POLL_INTERVAL_MS = 1500;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // Monster Beats 设计基准 1440×900：默认 1200×800（stage 缩放 ≈0.83），
    // 视觉完整且留出 macOS 交通灯余量；自由缩放靠 stage transform 适配。
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    // macOS traffic-light buttons live in the top-left. The renderer
    // titlebar reserves a 80px safe area on the left so it doesn't
    // overlap the system buttons (or the green fullscreen button when
    // the user hovers at the very top edge).
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#0f0f12',
    resizable: true,
    show: false,
    // macOS uses the app-bundle .icns; Win/Linux need an explicit window icon.
    icon: process.platform === 'darwin' ? undefined : assetPath('icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Spotify OAuth PKCE：renderer 里 window.open(authorizeUrl) 需要在
      // Electron 内创建子 BrowserWindow 而不是跳系统浏览器——这样才能共享
      // session cookie storage，使 login 完成后的 cookie 在主窗口 poll 时可见。
      nativeWindowOpen: true,
      // Widevine CDM 本身由 castLabs components 模块加载（见 app.whenReady）；
      // 这里的 autoplayPolicy 让 WPS 能在无用户手势时直接起播当前曲，
      // plugins 保持开启（无害，历史遗留）。
      plugins: true,
      autoplayPolicy: 'no-user-gesture-required',
    } as Electron.WebPreferences,
  });

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    // Open DevTools so users can see renderer console errors (e.g. audio
    // loading failures, network issues with the Deezer preview URL).
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererPath = path.join(process.resourcesPath, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);
  }

  // 一旦 renderer 加载完，把 sidecar URL + internal token 告诉它。renderer 用
  // 这个替换 hardcode 的 localhost:3200，确保 prod 模式下 fetch 走对地方；
  // 同时 api.ts 会把 token 注入到所有 state-changing 请求的 X-Maestro-Token
  // header 里，让 RequireInternalTokenGuard 放行。
  if (!isDev) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('sidecar-ready', {
        apiBase: `http://127.0.0.1:${SIDECAR_PORT}`,
        internalToken: maestroInternalToken,
      });
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Forward renderer console messages to the main process log so they
  // appear in the same stream as the NestJS / Electron output. DevTools
  // is detached so it isn't always visible; this makes debugging audio
  // and fetch issues much easier.
  mainWindow.webContents.on(
    'console-message',
    (_e: unknown, level: number, message: string, line: number, source: string) => {
      const tag = ['DBG', 'LOG', 'WARN', 'ERR'][level] ?? 'LOG';
      console.log(`[renderer ${tag}] ${message}  (${source}:${line})`);
    },
  );

  // window.open handler: Spotify OAuth 需要 Electron 子窗口（session cookie 共享），
  // 所以 allow 所有 popup；不需要的外部链接 renderer 走 shell.openExternal API。
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'allow' };
  });

  // Close-to-tray: hide the window instead of quitting so playback keeps
  // running in the background (macOS music-player convention). The app only
  // truly exits via Cmd+Q / tray "退出", which set isQuitting first.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── QQ Music login via embedded browser ────────────────────────────────────

interface QqLoginResult {
  /** Full "k=v; k=v" cookie header captured from the QQ login window. This is
   * the REAL QQ Music login state (qm_keyst / qqmusic_key / uin …) — NOT a
   * QQ Connect OAuth token. */
  cookie: string;
  /** Normalised numeric uin (leading 'o'/zeros stripped) for musicu.fcg. */
  uin?: string;
  /** All captured cookies, for debugging / forwarding. */
  extraCookies?: Record<string, string>;
}

/** QQ / QQ-Music cookies live across several *.qq.com hosts. */
const QQ_DOMAINS = ['.qq.com', '.y.qq.com', 'y.qq.com', 'qq.com'];

/** The cookie whose appearance means "QQ Music login just completed". Newer
 * web login sets `qm_keyst`; older flows set `qqmusic_key`. Either is enough. */
const QQ_LOGIN_MARKERS = ['qm_keyst', 'qqmusic_key'];

/** uin cookie looks like `o0361503867` — strip the leading `o` and zeros so
 * musicu.fcg's `uin` param is the bare QQ number. */
function normaliseUin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/^o/i, '').replace(/^0+/, '');
  return digits || undefined;
}

async function readQqCookies(win: BrowserWindow): Promise<{
  cookie: string;
  uin?: string;
  all: Record<string, string>;
  hasMarker: boolean;
}> {
  const all: Record<string, string> = {};
  const seen = new Set<string>();
  for (const domain of QQ_DOMAINS) {
    let cookies;
    try {
      cookies = await win.webContents.session.cookies.get({ domain });
    } catch {
      continue;
    }
    for (const c of cookies) {
      if (!c.name || seen.has(c.name)) continue;
      seen.add(c.name);
      if (c.expirationDate && c.expirationDate * 1000 < Date.now()) continue;
      all[c.name] = c.value;
    }
  }
  const cookie = Object.entries(all)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const uin = normaliseUin(all['uin'] ?? all['wxuin'] ?? all['p_uin']);
  const hasMarker = QQ_LOGIN_MARKERS.some((m) => Boolean(all[m]));
  return { cookie, uin, all, hasMarker };
}

/**
 * Open a child window on y.qq.com, let the user log into QQ Music, and resolve
 * once the login-marker cookie (qm_keyst / qqmusic_key) appears. We keep the
 * window hidden-alive afterwards so its Chromium session could later proxy
 * requests if QQ ever tightens anti-bot.
 *
 * Unlike QQ Connect OAuth, this needs NO appid/secret and NO registered app —
 * we just capture the browser's own login cookies.
 */
function openQqLoginWindow(): Promise<QqLoginResult> {
  // Already-running window with a captured result → reuse.
  if (activeQqLoginWindow && !activeQqLoginWindow.isDestroyed()) {
    activeQqLoginWindow.show();
    activeQqLoginWindow.focus();
    const cached = (activeQqLoginWindow as BrowserWindow & MaestroWindowExtras)
      .__maestroLastResult as QqLoginResult | undefined;
    if (cached) return Promise.resolve(cached);
  }
  // Already-running window, no cached result yet → share the in-flight
  // promise so concurrent callers don't spawn a second BrowserWindow.
  if (qqLoginInFlight) return qqLoginInFlight;

  const created: BrowserWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    title: '登录 QQ 音乐',
    parent: mainWindow ?? undefined,
    modal: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  activeQqLoginWindow = created;
  // Attach the 'closed' listener BEFORE returning so even an immediate
  // close (e.g. user dismisses the window) doesn't leak the reference.
  created.on('closed', () => {
    if (activeQqLoginWindow === created) activeQqLoginWindow = null;
  });
  // Trigger the initial navigation. runLoginWindow's documented contract is
  // that the caller-provided createWindow is responsible for triggering the
  // load (see login-window-runner.ts:226). Our createWindow just returns
  // the pre-built window, so we must loadURL() here — otherwise the user
  // sees a blank window with no QQ login page.
  created.loadURL('https://y.qq.com/');

  qqLoginInFlight = runLoginWindow<QqLoginResult>({
    url: 'https://y.qq.com/',
    title: '登录 QQ 音乐',
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    domains: QQ_DOMAINS,
    markerNames: QQ_LOGIN_MARKERS,
    keepAliveAfterSuccess: true,
    createWindow: () => created as unknown as MinimalBrowserWindow,
    capture: async (win) => {
      const realWin = win as unknown as BrowserWindow;
      const { cookie, uin, all, hasMarker } = await readQqCookies(realWin);
      if (!hasMarker) return null;
      const result: QqLoginResult = { cookie, uin, extraCookies: all };
      console.log(
        `[qq-login] captured ${Object.keys(all).length} cookies, ` +
          `uin=${uin ?? '?'}, keys=[${Object.keys(all).join(',')}]`,
      );
      (realWin as BrowserWindow & MaestroWindowExtras).__maestroLastResult = result;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(QQ_LOGIN_CHANNEL, result);
      }
      return result;
    },
  }).finally(() => {
    qqLoginInFlight = null;
  });
  return qqLoginInFlight;
}

// ── NetEase login via embedded browser ─────────────────────────────────────
//
// NetEase risk control (QR-check code 8821) rejects server-side login polling:
// it accepts the phone scan but refuses to hand a login cookie to an untrusted
// server caller. The reliable desktop path is to let the user sign in inside a
// real Chromium window and capture MUSIC_U from its session — same shape as the
// QQ flow above.

interface NeteaseLoginResult {
  musicU: string;
  csrfToken?: string;
  /** All captured NetEase cookies, forwarded for parity with a real browser. */
  extraCookies?: Record<string, string>;
}

/** NetEase login cookies live on the music.163.com hosts. */
const NETEASE_DOMAINS = ['.music.163.com', 'music.163.com'];

/** A logged-out MUSIC_U placeholder is short; a real one is long. Wait for a
 * value that's clearly the post-login cookie. */
const MIN_MUSIC_U_LENGTH = 30;

async function readNeteaseCookies(win: BrowserWindow): Promise<{
  musicU?: string;
  csrf?: string;
  all: Record<string, string>;
}> {
  const all: Record<string, string> = {};
  let musicU: string | undefined;
  let csrf: string | undefined;
  const seen = new Set<string>();
  for (const domain of NETEASE_DOMAINS) {
    let cookies;
    try {
      cookies = await win.webContents.session.cookies.get({ domain });
    } catch {
      continue;
    }
    for (const c of cookies) {
      if (!c.name || seen.has(c.name)) continue;
      seen.add(c.name);
      if (c.expirationDate && c.expirationDate * 1000 < Date.now()) continue;
      all[c.name] = c.value;
      if (c.name === 'MUSIC_U' && c.value.length >= MIN_MUSIC_U_LENGTH) {
        musicU = c.value;
      }
      if (c.name === '__csrf') csrf = c.value;
    }
  }
  return { musicU, csrf, all };
}

/**
 * Open a child window on music.163.com/login, let the user sign in (the
 * NetEase page's own QR, phone, or password — all in a real browser NetEase
 * trusts), and resolve once MUSIC_U appears in the window's session cookies.
 */
function openNeteaseLoginWindow(): Promise<NeteaseLoginResult> {
  if (activeNeteaseLoginWindow && !activeNeteaseLoginWindow.isDestroyed()) {
    activeNeteaseLoginWindow.show();
    activeNeteaseLoginWindow.focus();
    const cached = (activeNeteaseLoginWindow as BrowserWindow & MaestroWindowExtras)
      .__maestroLastResult as NeteaseLoginResult | undefined;
    if (cached) return Promise.resolve(cached);
  }
  if (neteaseLoginInFlight) return neteaseLoginInFlight;

  const created: BrowserWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    title: '登录网易云音乐',
    parent: mainWindow ?? undefined,
    modal: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  activeNeteaseLoginWindow = created;
  created.on('closed', () => {
    if (activeNeteaseLoginWindow === created) activeNeteaseLoginWindow = null;
  });
  // See QQ flow — same contract: createWindow returns the pre-built window,
  // so we trigger loadURL() here. Without this, the window opens to a blank
  // page and the user can never reach the NetEase login form.
  created.loadURL('https://music.163.com/login');

  neteaseLoginInFlight = runLoginWindow<NeteaseLoginResult>({
    url: 'https://music.163.com/login',
    title: '登录网易云音乐',
    width: 1000,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    domains: NETEASE_DOMAINS,
    markerNames: ['MUSIC_U'],
    keepAliveAfterSuccess: true,
    createWindow: () => created as unknown as MinimalBrowserWindow,
    capture: async (win) => {
      const realWin = win as unknown as BrowserWindow;
      const { musicU, csrf, all } = await readNeteaseCookies(realWin);
      if (!musicU) return null;
      const result: NeteaseLoginResult = {
        musicU,
        csrfToken: csrf,
        extraCookies: all,
      };
      console.log(
        `[netease-login] captured MUSIC_U (len=${musicU.length}), ` +
          `${Object.keys(all).length} cookies`,
      );
      (realWin as BrowserWindow & MaestroWindowExtras).__maestroLastResult = result;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(NETEASE_LOGIN_CHANNEL, result);
      }
      return result;
    },
  }).finally(() => {
    neteaseLoginInFlight = null;
  });
  return neteaseLoginInFlight;
}

// ── IPC wiring ──────────────────────────────────────────────────────────────

ipcMain.handle('qq:login', async () => {
  try {
    const result = await openQqLoginWindow();
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('netease:login', async () => {
  try {
    const result = await openNeteaseLoginWindow();
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

/**
 * Renderer pulls the latest buffered Spotify OAuth callback. Returns
 * `null` if nothing buffered or the buffered entry has aged out (10 min).
 * Renderer calls this on mount; if the main process hasn't received a
 * callback yet, the call hangs until one arrives (or the TTL elapses).
 */
ipcMain.handle('consume-oauth-callback', () => oauthBuffer.consume());

/**
 * Open URL in the OS default browser (Spotify OAuth authorizeUrl, etc.).
 * Renderer hands the URL through main rather than calling shell.openExternal
 * directly because Electron's renderer-side window.open has different
 * semantics across platforms.
 */
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('openExternal: only http(s) URLs are allowed');
  }
  await shell.openExternal(url);
});

/** Renderer → main: current playback state, so the tray label/tooltip reflect
 * what's actually playing. Fire-and-forget (ipcRenderer.send). */
ipcMain.on('player:state', (_event, state: PlaybackState) => {
  playbackState = {
    isPlaying: Boolean(state?.isPlaying),
    title: state?.title,
    artist: state?.artist,
  };
  refreshTray();
});

// ── App lifecycle ───────────────────────────────────────────────────────────

// Widevine 由 castLabs fork 的 components 模块提供（见 app.whenReady 里的
// components.whenReady()）。无需 enable-features 之类的 flag——vanilla Chromium
// 的 EME 开关拿不到 CDM，那条老路已删。

// Spotify OAuth：注册 maestro:// 自定义协议，回调时 macOS / Windows 调起 app
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('maestro', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('maestro');
}

// Single-instance lock: 如果用户再点一次 dock / .app 触发第二次进程（macOS
// 在主进程刚启动还没就绪时偶发；或在已经有实例的情况下启动第二个 .app），
// 第二次启动会拿到 false，直接退出。第二次启动收到的 open-url / argv 也
// 会通过 'second-instance' 事件路由到第一个进程，由它接管回调处理。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv /*, cwd */) => {
    // 把第二个实例的 argv 里可能夹带的 maestro:// URL 也喂给 oauthBuffer，
    // 防止 macOS 把 deep-link 发给了"那个我们刚 quit 的"第二进程。
    const incomingUrl = argv.find((a) => a.startsWith('maestro://'));
    if (incomingUrl) handleDeepLink(incomingUrl);
    showMainWindow();
  });
}

/** Parse a maestro:// deep link and route to oauthBuffer or log an error.
 *  Extracted so 'open-url' (macOS) and 'second-instance' argv (Win/Linux)
 *  share one implementation. */
function handleDeepLink(url: string): void {
  console.log('[main] deep link:', url);
  try {
    const parsed = new URL(url.replace(/\/\?/, '?'));
    // OAuth error: Spotify may redirect with ?error=access_denied&state=...
    // instead of code+state. Surface to the renderer so it doesn't hang
    // on consumeOAuthCallback() forever.
    const error = parsed.searchParams.get('error');
    const state = parsed.searchParams.get('state');
    if (error) {
      oauthBuffer.pushError(error, state ?? undefined, url);
      console.log(`[main] oauth-buffer: pushed error=${error}`);
      return;
    }
    const code = parsed.searchParams.get('code');
    if (!code || !state) {
      console.error('[main] deep link 缺 code 或 state，忽略:', url);
      return;
    }
    oauthBuffer.push(code, state);
    console.log('[main] oauth-buffer: pushed callback');
  } catch (err) {
    console.error('[main] deep link parse failed:', err);
  }
}

// 协议 URL 回调：OS 把 maestro://spotify-callback?code=...&state=... 递进来
// 走 oauthBuffer：renderer 端通过 consumeOAuthCallback() IPC 拉取；这样即使
// main 窗口未就绪（或正被 recreate）也不会丢回调。10 min TTL 与 PKCE flow 一致。
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.whenReady().then(async () => {
  // 0. 等 Widevine CDM 就绪。castLabs fork 内置 CDM + VMP 签名；Spotify Web
  //    Playback SDK 靠 EME/Widevine 解密整首曲流，必须在建窗口前 whenReady，
  //    否则 renderer 里 SDK 抢先初始化会报 initialization_error → 退回 30s 预览。
  //    没有 Premium 也能验证组件本身就绪（status 里 Widevine=ready/registered）。
  let widevineReady = false;
  let widevineStatus: unknown = null;
  try {
    await components.whenReady();
    widevineReady = true;
    widevineStatus = components.status();
    console.log('[main] widevine components ready:', widevineStatus);
  } catch (err) {
    // 组件加载失败不阻塞启动——非 Spotify 源照常用，Spotify 自动退回 30s 预览。
    // 把 detail 也 stringify 出来（默认 devtools 只显示 [Object]）。
    const safeStr = (v: unknown): string => {
      try { return JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? String(val) : val); }
      catch { return String(v); }
    };
    console.error(
      '[main] widevine components failed (Spotify 全曲不可用，退回 30s 预览):',
      safeStr(err),
    );
  }
  // Renderer 端 WPS 初始化失败时（"No supported keysystem was found"）用来
  // 排查：Widevine CDM 在本机到底 ready 没。让 renderer 也能看到 main 端
  // 状态，不用切到 npm run dev 启动终端。
  ipcMain.handle('widevine:status', () => ({
    ready: widevineReady,
    status: widevineStatus,
  }));

  // 1. 启动 sidecar（prod 模式才有），等它就绪
  try {
    await startSidecar();
  } catch (err) {
    console.error('[main] failed to start sidecar:', err);
    // 不阻塞窗口打开——前端能展示一个错误面板，比黑屏好
  }

  // 2. 打开主窗口
  createWindow();

  // 3. 托盘常驻 + 自定义 Dock 图标（dev 也生效，方便验证图标）
  createTray();
  if (process.platform === 'darwin') {
    try {
      app.dock?.setIcon(nativeImage.createFromPath(assetPath('icon.png')));
    } catch (err) {
      console.warn('[main] dock.setIcon failed:', err);
    }
  }

  app.on('activate', () => {
    // Clicking the Dock icon re-shows the (possibly hidden) window.
    showMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopSidecar();
});

app.on('window-all-closed', () => {
  stopSidecar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
