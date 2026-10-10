/**
 * desktop-lyrics-controller.test.ts — 用假 BrowserWindow 验控制器状态机。
 *
 * 契约：
 *  1. setEnabled(true) 懒建窗 + did-finish-load 后才 show + 补发 prefs/state
 *  2. 关掉即 destroy；重复开关幂等（不重复建窗）
 *  3. 锁定 → setIgnoreMouseEvents(true, {forward:true})；hover 移入临时放行、移出恢复
 *  4. 浮窗改 prefs → 落盘 + 广播回浮窗（main 是唯一事实来源）
 *  5. 拖动 bounds 变化 debounce 后才落盘；dispose 会补一次落盘
 *  6. 只 resize（不 drag）同样落盘；6b. 浮窗显示走 showInactive，不抢主窗口焦点
 *  7. 历史坐标交给 clampToVisibleDisplay 校验；8. overlay 通道只认浮窗自己发的
 *
 * Run: npx ts-node packages/electron/src/desktop-lyrics/desktop-lyrics-controller.test.ts
 */
export {};
const assert = require('node:assert');
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';
import {
  DesktopLyricsController,
  OVERLAY_PREFS_CHANNEL,
  type ControllerDeps,
  type OverlayWindowLike,
} from './desktop-lyrics-controller';
import { loadPrefs, prefsPath } from './prefs';

interface FakeWindowState {
  destroyed: boolean;
  /** 被 show() 显示的次数 —— 应当恒为 0（会抢主窗口焦点），留着当回归哨兵 */
  shown: number;
  shownInactive: number;
  alwaysOnTop: Array<{ flag: boolean; level?: string }>;
  workspaces: Array<{ visible: boolean; onFullScreen?: boolean } | null>;
  ignoreEvents: Array<{ ignore: boolean; forward?: boolean }>;
  sent: Array<{ channel: string; payload: unknown }>;
  bounds: { x: number; y: number; width: number; height: number };
  setVisibleOnAllWorkspacesCalls: number;
}

interface Harness {
  dir: string;
  controllers: DesktopLyricsController[];
  windows: FakeWindowState[];
  opts: BrowserWindowConstructorOptions[];
  timers: Array<{ fn: () => void; cleared: boolean }>;
  /** 触发某窗口的 did-finish-load */
  finishLoad(i: number): void;
  /** 触发某窗口的 moved（模拟拖动） */
  moveWindow(i: number, bounds: Partial<FakeWindowState['bounds']>): void;
  /** 触发某窗口的 resized（模拟拉边）—— 与拖动走同一条落盘路径 */
  resizeWindow(i: number, bounds: Partial<FakeWindowState['bounds']>): void;
  /** 各窗口的 webContents 引用，用来验 sender 校验 */
  webContents: unknown[];
  close(i: number): void;
  runTimers(): void;
  sentTo(i: number, channel: string): unknown[];
}

function stubWindow(): OverlayWindowLike {
  return {
    isDestroyed: () => false,
    showInactive: () => undefined,
    destroy: () => undefined,
    getBounds: () => ({ x: 0, y: 0, width: 860, height: 160 }),
    setBounds: () => undefined,
    setAlwaysOnTop: () => undefined,
    setVisibleOnAllWorkspaces: () => undefined,
    setIgnoreMouseEvents: () => undefined,
    webContents: { send: () => undefined, on: () => undefined },
    on: () => undefined,
  };
}

function harness(over: Partial<ControllerDeps> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dlc-'));
  const controllers: DesktopLyricsController[] = [];
  const windows: FakeWindowState[] = [];
  const opts: BrowserWindowConstructorOptions[] = [];
  const timers: Array<{ fn: () => void; cleared: boolean }> = [];
  const loadCbs: Array<() => void> = [];
  const movedCbs: Array<() => void> = [];
  const resizedCbs: Array<() => void> = [];
  const closedCbs: Array<() => void> = [];
  const webContentsRefs: unknown[] = [];

  const c = new DesktopLyricsController({
    userDataDir: dir,
    preloadPath: '/tmp/preload.js',
    platform: 'darwin',
    createWindow: (o) => {
      const st: FakeWindowState = {
        destroyed: false,
        shown: 0,
        shownInactive: 0,
        alwaysOnTop: [],
        workspaces: [],
        ignoreEvents: [],
        sent: [],
        bounds: { x: 100, y: 200, width: 860, height: 160 },
        setVisibleOnAllWorkspacesCalls: 0,
      };
      windows.push(st);
      opts.push(o);
      const win: OverlayWindowLike = {
        isDestroyed: () => st.destroyed,
        showInactive: () => {
          st.shownInactive++;
        },
        destroy: () => {
          st.destroyed = true;
        },
        getBounds: () => ({ ...st.bounds }),
        setBounds: (b) => {
          st.bounds = { ...b };
        },
        setAlwaysOnTop: (flag, level) => {
          st.alwaysOnTop.push({ flag, level });
        },
        setVisibleOnAllWorkspaces: (visible, o2) => {
          st.workspaces.push({ visible, onFullScreen: o2?.visibleOnFullScreen });
        },
        setIgnoreMouseEvents: (ignore, o2) => {
          st.ignoreEvents.push({ ignore, forward: o2?.forward });
        },
        webContents: {
          send: (channel, payload) => {
            st.sent.push({ channel, payload });
          },
          on: (_e, cb) => {
            loadCbs.push(cb);
          },
        },
        on: (e, cb) => {
          if (e === 'moved') movedCbs.push(cb);
          else if (e === 'resized') resizedCbs.push(cb);
          else closedCbs.push(cb);
        },
      };
      // 假窗口额外实现真实 BrowserWindow 上有的 show()：controller 若哪天改回
      // 调 show()，这里会被计数，下面第 6b 条断言立刻变红。
      (win as unknown as { show: () => void }).show = () => {
        st.shown++;
      };
      webContentsRefs.push(win.webContents);
      return win;
    },
    loadTarget: () => ({ kind: 'url', url: 'http://127.0.0.1:5273/lyrics.html' }),
    setTimeoutFn: (fn) => {
      const t = { fn, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeoutFn: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    ...over,
  });
  controllers.push(c);
  return {
    dir,
    controllers,
    windows,
    opts,
    timers,
    webContents: webContentsRefs,
    finishLoad: (i) => loadCbs[i]?.(),
    moveWindow: (i, b) => {
      Object.assign(windows[i].bounds, b);
      movedCbs[i]?.();
    },
    resizeWindow: (i, b) => {
      Object.assign(windows[i].bounds, b);
      resizedCbs[i]?.();
    },
    close: (i) => closedCbs[i]?.(),
    runTimers: () => {
      for (const t of timers) if (!t.cleared) t.fn();
    },
    sentTo: (i, channel) =>
      windows[i].sent.filter((s) => s.channel === channel).map((s) => s.payload),
  };
}

function withHarness(fn: (h: Harness) => void, over: Partial<ControllerDeps> = {}): void {
  const h = harness(over);
  try {
    fn(h);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
}

const STATE = { playing: true, current: '你应该对我说谎', next: '别管我怎么说', progress: 0.42 };

// ── 1. 开窗生命周期 ───────────────────────────────────────────────────────

withHarness((h) => {
  const c = h.controllers[0];
  assert.strictEqual(c.enabled, false, '默认关闭');
  c.pushState(STATE); // 浮窗还没开就先推状态
  assert.strictEqual(h.windows.length, 0, '关闭时不开窗（省 GPU）');

  c.setEnabled(true);
  assert.strictEqual(h.windows.length, 1, '开启后建窗');
  assert.strictEqual(h.windows[0].shownInactive, 0, 'did-finish-load 之前不 show（避免空框闪一下）');
  assert.deepStrictEqual(
    h.windows[0].alwaysOnTop[0],
    { flag: true, level: 'screen-saver' },
    '置顶升到 screen-saver 档（构造参数只给基础档）',
  );
  assert.deepStrictEqual(
    h.windows[0].workspaces,
    [{ visible: true, onFullScreen: true }],
    'macOS 跨 Space + 全屏之上',
  );
  assert.strictEqual(h.opts[0].transparent, true, '透明窗配置下发');

  h.finishLoad(0);
  assert.strictEqual(h.windows[0].shownInactive, 1, '加载完才显示');
  assert.strictEqual(h.sentTo(0, OVERLAY_PREFS_CHANNEL).length, 1, '下发初始 prefs');
  assert.strictEqual(h.sentTo(0, 'desktop-lyrics:state').length, 1, '补发开窗前推来的状态');

  c.setEnabled(true);
  assert.strictEqual(h.windows.length, 1, '重复开启幂等，不重复建窗');

  c.setEnabled(false);
  assert.strictEqual(h.windows[0].destroyed, true, '关闭即 destroy');
});

// 非 darwin 不调 setVisibleOnAllWorkspaces（该 API 在 Win/Linux 抛）
withHarness(
  (h) => {
    h.controllers[0].setEnabled(true);
    assert.strictEqual(h.windows[0].workspaces.length, 0, '非 mac 不碰跨 Space API');
  },
  { platform: 'win32' },
);

// ── 2. 状态转发 ───────────────────────────────────────────────────────────

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  h.finishLoad(0);
  c.pushState(STATE);
  const last = h.sentTo(0, 'desktop-lyrics:state').pop();
  assert.deepStrictEqual(last, STATE, '原样转发');
  c.pushState({ ...STATE, progress: 5 });
  assert.strictEqual(
    (h.sentTo(0, 'desktop-lyrics:state').pop() as { progress: number }).progress,
    1,
    'progress 夹到 1',
  );
  c.pushState({ ...STATE, progress: NaN });
  assert.strictEqual(
    (h.sentTo(0, 'desktop-lyrics:state').pop() as { progress: number }).progress,
    0,
    'NaN progress 归 0',
  );
});

// ── 3. 锁定 / 点击穿透 ────────────────────────────────────────────────────

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  assert.strictEqual(h.windows[0].ignoreEvents.pop()?.ignore, false, '默认不穿透');

  c.handleOverlayControl({ action: 'lock', locked: true });
  const locked = h.windows[0].ignoreEvents.pop();
  assert.strictEqual(locked?.ignore, true, '锁定 → 穿透');
  assert.strictEqual(locked?.forward, true, 'forward 必须开，否则 hover 收不到事件解不了穿透');

  c.handleOverlayHover(true);
  assert.strictEqual(h.windows[0].ignoreEvents.pop()?.ignore, false, 'hover 移入临时放行');
  c.handleOverlayHover(true);
  assert.strictEqual(h.windows[0].ignoreEvents.length, 0, '重复 hover 不重复下发');
  c.handleOverlayHover(false);
  assert.strictEqual(h.windows[0].ignoreEvents.pop()?.ignore, true, '移出恢复穿透');

  // 锁定时面板整块卸载 → mouseleave 不再来，必须主动清掉 hover 放行
  c.handleOverlayHover(true);
  c.handleOverlayControl({ action: 'lock', locked: true });
  assert.strictEqual(h.windows[0].ignoreEvents.pop()?.ignore, true, '锁定时清掉 hover 放行，重新穿透');

  // 未锁定时 hover 不该改任何东西
  c.handleOverlayControl({ action: 'lock', locked: false });
  h.windows[0].ignoreEvents.length = 0;
  c.handleOverlayHover(true);
  assert.strictEqual(h.windows[0].ignoreEvents.length, 0, '未锁定不处理 hover');

  // 锁定态回传给订阅者（Titlebar / Tray 用）
  const seen: Array<{ enabled: boolean; locked: boolean }> = [];
  c.onChanged((s) => seen.push(s));
  c.handleOverlayControl({ action: 'lock', locked: true });
  assert.strictEqual(seen.length, 1, '锁定变化广播一次');
  assert.strictEqual(seen[0].locked, true);
});

// ── 4. 浮窗改 prefs ───────────────────────────────────────────────────────

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  h.finishLoad(0);
  h.moveWindow(0, { x: 50, y: 60 });
  h.runTimers();
  c.handleOverlayControl({ action: 'prefs', prefs: { fontScale: 1.5, palette: 'cyan', stroke: false } });
  const sent = h.sentTo(0, OVERLAY_PREFS_CHANNEL).pop() as { fontScale: number; palette: string; stroke: boolean };
  assert.strictEqual(sent.fontScale, 1.5, '字号回广播');
  assert.strictEqual(sent.palette, 'cyan');
  assert.strictEqual(sent.stroke, false);
  const onDisk = JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8'));
  assert.strictEqual(onDisk.fontScale, 1.5, '字号落盘');
  assert.strictEqual(onDisk.palette, 'cyan');

  // 越界值归一；且浮窗不能顺手改掉 enabled/locked/bounds
  c.handleOverlayControl({
    action: 'prefs',
    prefs: { fontScale: 99, enabled: false, locked: false, bounds: { x: 0, y: 0, width: 1, height: 1 } },
  });
  const after = c.getPrefs();
  assert.strictEqual(after.fontScale <= 1.8, true, 'fontScale 夹紧');
  assert.strictEqual(after.enabled, true, '浮窗不能通过 prefs 关掉自己');
  assert.deepStrictEqual(after.bounds, { x: 50, y: 60, width: 860, height: 160 }, '浮窗不能通过 prefs 改位置尺寸');

  // close 等价于 setEnabled(false)
  c.handleOverlayControl({ action: 'close' });
  assert.strictEqual(c.enabled, false, 'close 关窗');
  assert.strictEqual(h.windows[0].destroyed, true);
  assert.strictEqual(loadPrefs(h.dir).enabled, false, '关闭态落盘');
});

// ── 5. 拖动落盘 debounce ──────────────────────────────────────────────────

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  h.finishLoad(0);
  h.moveWindow(0, { x: 300, y: 420, width: 700, height: 200 });
  h.moveWindow(0, { x: 310, y: 430 });
  assert.strictEqual(JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds, null, 'debounce 期间还没落盘');
  assert.strictEqual(h.timers.filter((t) => !t.cleared).length, 1, '前一个定时器被取消，只留一个待跑');
  h.runTimers();
  const bounds = JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds;
  assert.deepStrictEqual(bounds, { x: 310, y: 430, width: 700, height: 200 }, '落盘最后一次位置');

  // 拖动中直接退出：dispose 要把位置补落盘，不能丢
  h.moveWindow(0, { x: 12, y: 34 });
  c.dispose();
  assert.deepStrictEqual(
    JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds,
    { x: 12, y: 34, width: 700, height: 200 },
    'dispose 补落盘',
  );
  assert.strictEqual(h.windows[0].destroyed, true, 'dispose 关窗');
});

// ── 6. 只 resize（不拖动）也要落盘 ─────────────────────────────────────────
// Electron **拖动才发 moved，纯 resize 不发**。只挂 moved 的话，用户把浮窗拉大后
// 退出，尺寸就丢了（除非他之后又随手拖了一下）。

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  h.finishLoad(0);

  h.resizeWindow(0, { width: 1180, height: 260 });
  assert.strictEqual(
    JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds,
    null,
    'resize 也走 debounce，期间不落盘',
  );
  h.runTimers();
  assert.deepStrictEqual(
    JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds,
    { x: 100, y: 200, width: 1180, height: 260 },
    '只触发 resized（没触发 moved）也要把新尺寸落盘',
  );

  // resize 与拖动共用同一个 debounce 定时器：交替触发只留一个待跑
  h.resizeWindow(0, { width: 1200 });
  h.moveWindow(0, { x: 300 });
  h.runTimers();
  assert.deepStrictEqual(
    JSON.parse(readFileSync(prefsPath(h.dir), 'utf-8')).bounds,
    { x: 300, y: 200, width: 1200, height: 260 },
    'moved/resized 共用一个 debounce，落盘取最后一次几何',
  );
});

// ── 6b. 浮窗显示必须走 showInactive ───────────────────────────────────────
// show() 会把键盘焦点从主窗口抢走：用户在搜索框打字时点一下 Titlebar 的「词」按钮，
// 输入焦点就没了；锁定后浮窗还是 click-through，抢来的焦点更是无处可用。

withHarness((h) => {
  const c = h.controllers[0];
  c.setEnabled(true);
  h.finishLoad(0);
  assert.strictEqual(h.windows[0].shown, 0, '全程不得调用 show()（会抢主窗口焦点）');

  // 窗口已在时再 setEnabled 走重显路径，同样不能是 show()
  c.setEnabled(false);
  c.setEnabled(true);
  h.finishLoad(1);
  assert.strictEqual(h.windows[1].shown, 0, '重建后也不得调用 show()');
  assert.strictEqual(h.windows[1].shownInactive, 1, '重建后用 showInactive 显示');
});

// ── 7. 历史坐标先过 clampToVisibleDisplay ─────────────────────────────────
// 注入点缺失时行为不变（单测跑在 ts-node 里，没有 electron 运行时）——
// 这条保证 controller 仍然是「不 import electron 运行时」的纯逻辑层。

{
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dlc-clamp-'));
  try {
    const file = prefsPath(dir);
    writeFileSync(
      file,
      JSON.stringify({ ...loadPrefs(dir), bounds: { x: 2400, y: 80, width: 900, height: 200 } }),
      'utf-8',
    );
    const seen: unknown[] = [];
    const mk = (clamp?: (b: { x: number; y: number; width: number; height: number }) => unknown) => {
      const captured: BrowserWindowConstructorOptions[] = [];
      const c = new DesktopLyricsController({
        userDataDir: dir,
        preloadPath: '/tmp/preload.js',
        platform: 'darwin',
        createWindow: (o) => {
          captured.push(o);
          return stubWindow();
        },
        loadTarget: () => ({ kind: 'url', url: 'http://127.0.0.1:5273/lyrics.html' }),
        clampToVisibleDisplay: clamp as never,
      });
      c.setEnabled(true);
      return captured[0];
    };

    // 显示器都拔了 → 位置丢弃、尺寸保留
    const dropped = mk((b) => {
      seen.push(b);
      return null;
    });
    assert.deepStrictEqual(seen[0], { x: 2400, y: 80, width: 900, height: 200 }, 'clamp 拿得到落盘的原坐标');
    assert.strictEqual(dropped?.x, undefined, '坐标失效 → 不下发 x（否则窗口丢进空白区）');
    assert.strictEqual(dropped?.width, 900, '坐标失效仍保留用户拉过的宽度');

    // 屏幕还在 → 原样还原
    const kept = mk((b) => b);
    assert.strictEqual(kept?.x, 2400, '坐标仍可见 → 原样还原');
    assert.strictEqual(kept?.y, 80);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 8. overlay 通道只认浮窗自己 ───────────────────────────────────────────
// preload 是主窗口和浮窗共用的同一份桥，主窗口调 desktopLyrics.control() 走的
// 路径与浮窗完全一样。不校验 sender = 把「关掉 / 锁死用户浮窗」的权限开给任意 renderer。

withHarness((h) => {
  const c = h.controllers[0];
  assert.strictEqual(c.isOverlaySender(h.webContents[0] ?? {}), false, '浮窗未建 → 一律拒（浮窗不存在时不存在合法 sender）');

  c.setEnabled(true);
  assert.strictEqual(c.isOverlaySender(h.webContents[0]), true, '浮窗自己发的放行');
  assert.strictEqual(c.isOverlaySender({ id: '主窗口的 webContents' }), false, '别的 renderer 拒');
  assert.strictEqual(c.isOverlaySender(undefined), false);
  assert.strictEqual(c.isOverlaySender(null), false);

  c.setEnabled(false);
  assert.strictEqual(c.isOverlaySender(h.webContents[0]), false, '浮窗已销毁 → 旧 sender 也不再放行');
});

// 上次开着退出 → 本次启动仍是开着
{
  const dir = mkdtempSync(join(tmpdir(), 'maestro-dlc-restart-'));
  try {
    const first = new DesktopLyricsController({
      userDataDir: dir,
      preloadPath: '/tmp/preload.js',
      platform: 'darwin',
      createWindow: () => stubWindow(),
      loadTarget: () => ({ kind: 'url', url: 'http://127.0.0.1:5273/lyrics.html' }),
    });
    first.setEnabled(true);
    first.dispose();
    assert.strictEqual(loadPrefs(dir).enabled, true, '退出时把开启态落盘');

    const second = new DesktopLyricsController({
      userDataDir: dir,
      preloadPath: '/tmp/preload.js',
      platform: 'darwin',
      createWindow: () => stubWindow(),
      loadTarget: () => ({ kind: 'url', url: 'http://127.0.0.1:5273/lyrics.html' }),
    });
    assert.strictEqual(second.enabled, true, '下次启动仍是开着');
    assert.strictEqual(second.locked, false, '锁定态不跨重启恢复（避免一启动就挡鼠标）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('✓ desktop-lyrics/desktop-lyrics-controller.test.ts');
