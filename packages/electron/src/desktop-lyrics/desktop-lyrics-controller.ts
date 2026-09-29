import type { BrowserWindowConstructorOptions } from 'electron';
import { overlayWindowOptions } from './window-options';
import {
  loadPrefs,
  normalisePrefs,
  savePrefs,
  type DesktopLyricsBounds,
  type DesktopLyricsPrefs,
} from './prefs';

/**
 * 桌面歌词浮窗控制器（NEXT-ITERATION §7.2）。
 *
 * 职责边界：**main 进程是浮窗偏好的唯一事实来源**。播放状态与歌词行由主窗口
 * renderer 推上来（`pushState`），controller 只做缓存 + 转发；浮窗自己改样式 /
 * 锁定位时回报（`handleOverlayControl`），controller 落盘并回广播。
 *
 * BrowserWindow 经 `deps.createWindow` 注入，所以这个模块不 import electron 运行时，
 * 单测用假窗口即可（见 desktop-lyrics-controller.test.ts）。
 */

/** 转发给浮窗的播放快照 —— 只含展示需要的东西，不传 <audio> 内部状态。 */
export interface DesktopLyricsState {
  playing: boolean;
  /** 当前行文本；null = 还没到第一句 / 无歌词 */
  current: string | null;
  /** 下一行文本（预告） */
  next: string | null;
  /** 当前行内进度 0..1 */
  progress: number;
  title?: string;
  artist?: string;
}

/** controller 用到的 BrowserWindow 子集（真实窗口天然满足）。 */
export interface OverlayWindowLike {
  isDestroyed(): boolean;
  /**
   * 刻意**只有** inactive 版本、没有 `show()`：浮窗是纯展示端，显示时不能把键盘焦点
   * 从主窗口抢走（用户在搜索框打字时点一下「词」按钮，输入焦点就没了；锁定后浮窗还是
   * click-through，抢来的焦点更是无处可用）。调用方想 show 就会在类型上被挡住。
   */
  showInactive(): void;
  destroy(): void;
  getBounds(): { x: number; y: number; width: number; height: number };
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver' | 'floating'): void;
  setVisibleOnAllWorkspaces?(visible: boolean, opts?: { visibleOnFullScreen?: boolean }): void;
  setIgnoreMouseEvents(ignore: boolean, opts?: { forward?: boolean }): void;
  webContents: {
    send(channel: string, payload: unknown): void;
    on(event: 'did-finish-load', cb: () => void): void;
    openDevTools?(opts?: { mode?: string }): void;
  };
  /**
   * `resized` 与 `moved` 同样要落盘：Electron **拖动才发 moved，纯 resize 不发**。
   * 只监听 moved 的话，用户把浮窗拉大后退出，尺寸就丢了（除非之后又拖了一下）。
   */
  on(event: 'moved' | 'resized' | 'closed', cb: () => void): void;
}

/** 浮窗要加载的入口：dev 走 Vite，prod 走打包后的 lyrics.html。 */
export type OverlayLoadTarget = { kind: 'url'; url: string } | { kind: 'file'; file: string };

export interface ControllerDeps {
  userDataDir: string;
  preloadPath: string;
  platform: string;
  createWindow: (opts: BrowserWindowConstructorOptions) => OverlayWindowLike;
  loadTarget: () => OverlayLoadTarget;
  /**
   * 还原历史坐标前的可见性校验（见 window-options.ts）。由 main 侧用
   * `screen.getAllDisplays()` 实现 —— 抽成注入点是本模块不 import electron 运行时的前提。
   * 缺省 = 不校验（单测跑在 ts-node 里，没有 electron 运行时）。
   */
  clampToVisibleDisplay?: (b: DesktopLyricsBounds) => DesktopLyricsBounds | null;
  /** 拖动/改尺寸时 debounce 落盘的定时器（测试可注入 fake）。 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  log?: (msg: string) => void;
}

/** 拖动过程中 bounds 变化很密，debounce 后再落盘。 */
const SAVE_DEBOUNCE_MS = 400;

export const OVERLAY_PREFS_CHANNEL = 'desktop-lyrics:overlay:prefs';

export interface DesktopLyricsSnapshot {
  enabled: boolean;
  locked: boolean;
}

export class DesktopLyricsController {
  private prefs: DesktopLyricsPrefs;
  private win: OverlayWindowLike | null = null;
  /** 最近一次 pushState 的内容：浮窗晚开（懒建）时要补发。 */
  private lastState: DesktopLyricsState | null = null;
  /** 锁定状态下因 hover 临时放行的窗口（此时不穿透）。 */
  private interactiveOverride = false;
  private saveTimer: unknown = null;
  private listeners = new Set<(s: DesktopLyricsSnapshot) => void>();
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: ControllerDeps) {
    this.prefs = loadPrefs(deps.userDataDir);
    // 上次退出时开着 → 本次也开（macOS 「重开上次状态」的心智）。
    // 注意 enabled 只在首次 setEnabled 时消费，窗口还是懒建的。
    this.setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.log = deps.log ?? (() => undefined);
  }

  // ── 状态读取 ────────────────────────────────────────────────────────────

  get enabled(): boolean {
    return this.prefs.enabled;
  }

  get locked(): boolean {
    return this.prefs.locked;
  }

  snapshot(): DesktopLyricsSnapshot {
    return { enabled: this.prefs.enabled, locked: this.prefs.locked };
  }

  getPrefs(): DesktopLyricsPrefs {
    return { ...this.prefs };
  }

  /** Tray / 主窗口 renderer 订阅开关与锁定态的变化。 */
  onChanged(cb: (s: DesktopLyricsSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emitChanged(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch {
        /* 单个订阅者抛错不能拖垮其它人 */
      }
    }
  }

  // ── 开关 ────────────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    if (enabled === this.prefs.enabled && (enabled ? !!this.window() : true)) return;
    this.prefs.enabled = enabled;
    if (enabled) {
      // 上次是开着退出的：沿用上次的锁定态开窗，别突然开始挡鼠标。
      this.ensureWindow();
      this.persist();
      this.emitChanged();
    } else {
      this.closeWindow();
      this.persist();
      this.emitChanged();
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.prefs.enabled);
    return this.prefs.enabled;
  }

  /** app 退出前调用：停掉 debounce 定时器再落一次盘（拖动中退出不能丢位置）。 */
  dispose(): void {
    if (this.saveTimer !== null) {
      this.clearTimeoutFn(this.saveTimer);
      this.saveTimer = null;
    }
    this.closeWindow();
    this.persist();
  }

  // ── 播放状态转发 ────────────────────────────────────────────────────────

  pushState(state: DesktopLyricsState): void {
    const progress = Number.isFinite(state.progress)
      ? Math.min(1, Math.max(0, state.progress))
      : 0;
    this.lastState = { ...state, progress };
    const win = this.window();
    if (win) win.webContents.send('desktop-lyrics:state', this.lastState);
  }

  // ── 浮窗回报 ────────────────────────────────────────────────────────────

  /**
   * 浮窗设置面板的动作：
   * - `close`：关掉浮窗（等价 setEnabled(false)）
   * - `lock`：切锁定（点击穿透）
   * - `prefs`：改字号 / 配色 / 描边
   */
  handleOverlayControl(msg: {
    action: 'close' | 'lock' | 'prefs';
    locked?: boolean;
    prefs?: Partial<DesktopLyricsPrefs>;
  }): void {
    switch (msg.action) {
      case 'close':
        this.setEnabled(false);
        return;
      case 'lock':
        this.prefs.locked = Boolean(msg.locked);
        // 锁定的一瞬设置面板会整块卸载，mouseleave 大概率不会再来 ——
        // 不清掉 hover 放行的话窗口会停在"可交互"，等于没锁。
        this.interactiveOverride = false;
        this.applyMousePassthrough();
        this.persist();
        this.broadcastPrefs();
        this.emitChanged();
        return;
      case 'prefs': {
        if (!msg.prefs) return;
        this.prefs = normalisePrefs({ ...this.prefs, ...msg.prefs, enabled: this.prefs.enabled, locked: this.prefs.locked, bounds: this.prefs.bounds });
        this.persist();
        this.broadcastPrefs();
        return;
      }
    }
  }

  /**
   * 判断某个 ipc 事件是否来自浮窗自己。
   *
   * preload 是主窗口和浮窗**共用**的同一个桥，所以主窗口的
   * `window.electronAPI.desktopLyrics.control()` 同样能发 `close` / `lock` ——
   * 任何能跑 renderer 代码的地方都能把用户的浮窗锁死或关掉。只认 webContents 引用
   * 相等：浮窗自己发的照常通过（同一 webContents），别的 renderer 一律拒。
   */
  isOverlaySender(sender: unknown): boolean {
    const win = this.window();
    return !!win && (win.webContents as unknown) === sender;
  }

  /**
   * 锁定态下的 hover 反馈：鼠标移入 → 临时恢复可交互（用户要点设置面板），
   * 移出 → 重新穿透。
   */
  handleOverlayHover(inside: boolean): void {
    if (!this.prefs.locked) return;
    const next = Boolean(inside);
    if (next === this.interactiveOverride) return;
    this.interactiveOverride = next;
    this.applyMousePassthrough();
  }

  // ── 窗口生命周期 ────────────────────────────────────────────────────────

  private window(): OverlayWindowLike | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  private ensureWindow(): OverlayWindowLike | null {
    const existing = this.window();
    if (existing) {
      existing.showInactive();
      return existing;
    }
    const opts = overlayWindowOptions(this.prefs, {
      preloadPath: this.deps.preloadPath,
      clampToVisibleDisplay: this.deps.clampToVisibleDisplay,
    });
    const win = this.deps.createWindow(opts);
    this.win = win;

    // 置顶升档：构造参数里的 alwaysOnTop 只是基础档，screen-saver 才压得住全屏应用。
    win.setAlwaysOnTop(true, 'screen-saver');
    // macOS：跨 Space 跟随 + 全屏应用之上可见（其它平台没有这个概念，调了会抛）。
    if (this.deps.platform === 'darwin' && win.setVisibleOnAllWorkspaces) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    this.applyMousePassthrough();

    win.on('moved', () => this.onWindowGeometryChanged());
    win.on('resized', () => this.onWindowGeometryChanged());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    win.webContents.on('did-finish-load', () => {
      // 页面就绪后再显示：避免透明窗口先闪一个空框。
      const live = this.window();
      if (!live || !this.prefs.enabled) return;
      live.showInactive();
      this.broadcastPrefs();
      if (this.lastState) live.webContents.send('desktop-lyrics:state', this.lastState);
    });

    this.loadInto(win, this.deps.loadTarget());
    return win;
  }

  private loadInto(win: OverlayWindowLike, target: OverlayLoadTarget): void {
    const w = win as OverlayWindowLike & {
      loadURL?(url: string): void;
      loadFile?(file: string): void;
    };
    if (target.kind === 'url') w.loadURL?.(target.url);
    else w.loadFile?.(target.file);
  }

  private closeWindow(): void {
    const win = this.window();
    if (!win) return;
    this.win = null;
    this.interactiveOverride = false;
    try {
      win.destroy();
    } catch (err) {
      this.log(`desktop-lyrics: destroy failed: ${(err as Error).message}`);
    }
  }

  // ── 锁定 / 穿透 ─────────────────────────────────────────────────────────

  /**
   * 锁定 = `setIgnoreMouseEvents(true, { forward: true })`。forward 必须开：
   * 否则 renderer 收不到 mousemove，就没法在鼠标移入时反过来解除穿透（洛雪同款交互）。
   */
  private applyMousePassthrough(): void {
    const win = this.window();
    if (!win) return;
    const ignore = this.prefs.locked && !this.interactiveOverride;
    try {
      win.setIgnoreMouseEvents(ignore, { forward: true });
    } catch (err) {
      this.log(`desktop-lyrics: setIgnoreMouseEvents failed: ${(err as Error).message}`);
    }
  }

  private broadcastPrefs(): void {
    const win = this.window();
    if (!win) return;
    win.webContents.send(OVERLAY_PREFS_CHANNEL, this.getPrefs());
  }

  // ── 位置持久化 ──────────────────────────────────────────────────────────

  /** 拖动或改尺寸都会走这里：debounce 后把当前位置/尺寸落盘。 */
  private onWindowGeometryChanged(): void {
    const win = this.window();
    if (!win) return;
    const b = win.getBounds();
    this.prefs.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    if (this.saveTimer !== null) this.clearTimeoutFn(this.saveTimer);
    this.saveTimer = this.setTimeoutFn(() => {
      this.saveTimer = null;
      this.persist();
    }, SAVE_DEBOUNCE_MS);
  }

  private persist(): void {
    savePrefs(this.deps.userDataDir, this.prefs);
  }
}
