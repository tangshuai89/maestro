/**
 * main.behavior.test.ts — Electron main 进程的**行为级**测试。
 *
 * 与既有测试的分工：
 *   - `ipc-surface.test.ts` = 文本级双向交叉校验（通道名对得上）
 *   - `preload.test.ts`     = renderer 侧执行级（真调 API）
 *   - `main.ipc-exec.test.ts`= main 侧**注册面**执行级（通道真的注册了 / token 是随机的）
 *   - **本文件**            = main 侧**行为**执行级：把 main 跑起来，**触发**那些
 *                              内部函数，断言它们真的产生了对用户可见的效果
 *
 * 之前 main.ts 的 25 个函数里只有 3 个被执行到（12% 函数覆盖）—— 因为
 * 「注册了通道」不等于「通道被调用后行为对」。本文件把窗口形态、托盘菜单、
 * 扫码登录捕获、deep link 路由这些**真会出 bug 的路径**跑一遍。
 *
 * 关键手法：
 *   ① `Module._load` 换成假的 `electron` + `node:child_process`
 *   ② **全局 `fetch` 打桩** —— main 的 `waitForSidecar` 用 fetch 轮询
 *      :3200；不打桩的话 `startSidecar()` 要等 30s 超时，后面的
 *      `createWindow()` 根本轮不到（这正是 createWindow 一直 0% 的原因）
 *   ③ `loadMain()` 清 require 缓存重复加载 = 一次「新的启动」
 *
 * Run: npx ts-node packages/electron/src/main.behavior.test.ts
 */
export {};
const assert = require('node:assert');
const { writeFileSync } = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

interface Rec {
  channel: string;
  handler: (...a: unknown[]) => void;
}
interface AppRec {
  event: string;
  handler: (...a: unknown[]) => void;
}
interface HRec {
  channel: string;
  handler: (...a: unknown[]) => unknown;
}
interface Cookie {
  name: string;
  value: string;
  domain: string;
  expirationDate?: number;
}

const reg = {
  on: [] as Rec[],
  handle: [] as HRec[],
  appOn: [] as AppRec[],
  windows: [] as FakeWindow[],
  trays: [] as FakeTray[],
  menuTemplate: [] as Array<Record<string, unknown>>,
  cookies: [] as Cookie[],
  removedCookies: [] as Array<{ url: string; name: string }>,
  /** 已注册的全局热键 accelerator（§7.3）。 */
  globalShortcuts: [] as string[],
  spawned: [] as Array<{ args: unknown[]; env?: Record<string, string> }>,
  killed: [] as string[],
  openExternalCalls: [] as string[],
  fetchCalls: [] as string[],
  /** 让 setIgnoreMouseEvents 抛错 → 控制器的 catch → main.ts 的 log 回调被调用 */
  throwOnSetIgnoreMouseEvents: false,
  /** 让 widevine components 探测失败 → main.ts 的 safeStr 分支被走到 */
  widevineFails: false,
};

/** 假 <audio>… 不对，是假 webContents。 */
class FakeWebContents {
  listeners: Rec[] = [];
  sent: Array<{ channel: string; args: unknown[] }> = [];
  session = {
    cookies: {
      get: async (q: { domain: string }): Promise<Cookie[]> =>
        reg.cookies.filter((c) => c.domain === q.domain),
      remove: async (url: string, name: string): Promise<void> => {
        reg.removedCookies.push({ url, name });
      },
      on: () => {},
      off: () => {},
    },
  };
  on(channel: string, handler: (...a: unknown[]) => void) {
    this.listeners.push({ channel, handler });
  }
  once(channel: string, handler: (...a: unknown[]) => void) {
    this.listeners.push({ channel, handler });
  }
  send(channel: string, ...args: unknown[]) {
    this.sent.push({ channel, args });
  }
  openDevTools() {}
  loadURL() {}
  loadFile() {}
  isDestroyed() {
    return false;
  }
  getURL() {
    return 'http://127.0.0.1:5273';
  }
  setWindowOpenHandler() {}
}

class FakeWindow {
  webContents = new FakeWebContents();
  winListeners: Rec[] = [];
  shown = 0;
  shownInactive = 0;
  focused = 0;
  hidden = 0;
  destroyed = false;
  normalBounds = { x: 100, y: 200, width: 1200, height: 800 };
  boundsCalls: Array<Record<string, unknown>> = [];
  minSizeCalls: Array<[number, number]> = [];
  lightPosCalls: unknown[] = [];
  lightVisCalls: boolean[] = [];
  maximized = false;
  fullScreen = false;
  /** 窗口构造参数（main.ts 传给 BrowserWindow 的 opts）—— 桌面歌词的位置
   *  夹取结果（x/y 在不在）只能从这里看。 */
  opts: unknown = undefined;

  on(channel: string, handler: (...a: unknown[]) => void) {
    this.winListeners.push({ channel, handler });
  }
  once(channel: string, handler: (...a: unknown[]) => void) {
    this.winListeners.push({ channel, handler });
  }
  show() {
    this.shown++;
  }
  hide() {
    this.hidden++;
  }
  focus() {
    this.focused++;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.shown > 0;
  }
  setSize() {}
  getSize() {
    return [1200, 800];
  }
  setMinimumSize(w: number, h: number) {
    this.minSizeCalls.push([w, h]);
  }
  setPosition() {}
  getPosition() {
    return [0, 0];
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  // 桌面歌词控制器要用的这两个（main.ts 传给控制器的接线回调
  // —— loadTarget / clampToVisibleDisplay / log —— 只有控制器真的建起浮窗、
  // 真的出过错时才会被调用 → 之前 main.ts 的这几个函数是 0 覆盖）。
  showInactive() {
    this.shownInactive++;
  }
  setIgnoreMouseEvents(..._a: unknown[]) {
    if (reg.throwOnSetIgnoreMouseEvents) throw new Error('passthrough boom');
  }
  setWindowButtonVisibility(v: boolean) {
    this.lightVisCalls.push(v);
  }
  setWindowButtonPosition(p: unknown) {
    this.lightPosCalls.push(p);
  }
  setTitle() {}
  getTitle() {
    return 'Maestro';
  }
  loadURL() {}
  loadFile() {}
  openDevTools() {}
  getNormalBounds() {
    return { ...this.normalBounds };
  }
  isMaximized() {
    return this.maximized;
  }
  isFullScreen() {
    return this.fullScreen;
  }
  setBounds(b: Record<string, unknown>) {
    this.boundsCalls.push(b);
  }
  maximize() {}
  unmaximize() {}
  setFullScreen(v: boolean) {
    this.fullScreen = v;
  }
  destroy() {
    this.destroyed = true;
  }
  close() {
    this.destroyed = true;
  }
}

class FakeTray {
  toolTip = '';
  menu: unknown = null;
  constructor(public img: unknown) {
    reg.trays.push(this);
  }
  setToolTip(t: string) {
    this.toolTip = t;
  }
  setContextMenu(m: unknown) {
    this.menu = m;
  }
  on() {}
}

const fakeElectron = {
  app: {
    setName: () => {},
    getPath: () => '/tmp/maestro-test-userdata',
    getVersion: () => '0.0.0-test',
    // packaged 模式才会起 sidecar（sidecar 才是 MAESTRO_INTERNAL_TOKEN 的接收方）
    isPackaged: true,
    on: (event: string, handler: (...a: unknown[]) => void) => {
      reg.appOn.push({ event, handler });
    },
    whenReady: () => Promise.resolve(),
    quit: () => {},
    requestSingleInstanceLock: () => true,
    disableHardwareAcceleration: () => {},
    commandLine: { appendSwitch: () => {} },
    setAsDefaultProtocolClient: () => true,
    removeAsDefaultProtocolClient: () => true,
    isDefaultProtocolClient: () => true,
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setBadgeCount: () => {},
    setAppUserModelId: () => {},
    setAboutPanelOptions: () => {},
    dock: { hide: () => {}, show: () => {}, setIcon: () => {} },
    focus: () => {},
    addRecentDocument: () => {},
  },
  components: {
    whenReady: async () => {
      if (reg.widevineFails) throw new Error('widevine boom');
      return undefined;
    },
    status: () => ({ ready: true }),
  },
  // 全局热键（§7.3）：main 启动时会注册一组 accelerator。假实现记录注册表，
  // 让测试能断言"注册了什么 / 有没有误注册媒体键"。
  globalShortcut: {
    register: (accelerator: string, _cb: () => void): boolean => {
      reg.globalShortcuts.push(accelerator);
      return true;
    },
    unregister: (accelerator: string): void => {
      reg.globalShortcuts = reg.globalShortcuts.filter((a) => a !== accelerator);
    },
    unregisterAll: (): void => {
      reg.globalShortcuts = [];
    },
    isRegistered: (accelerator: string): boolean => reg.globalShortcuts.includes(accelerator),
  },
  BrowserWindow: class {
    /** 底层假窗口；所有方法都转发到它（箭头函数字段，this 固定是这个实例）。 */
    readonly w = new FakeWindow();
    static getAllWindows(): FakeWindow[] {
      return reg.windows;
    }
    constructor(public opts: unknown) {
      this.w.opts = opts;
      reg.windows.push(this.w);
    }
    get webContents() {
      return this.w.webContents;
    }
    on = (c: string, h: (...a: unknown[]) => void) => this.w.on(c, h);
    once = (c: string, h: (...a: unknown[]) => void) => this.w.once(c, h);
    show = () => this.w.show();
    hide = () => this.w.hide();
    focus = () => this.w.focus();
    isDestroyed = () => this.w.isDestroyed();
    isVisible = () => this.w.isVisible();
    setSize = (..._a: unknown[]) => this.w.setSize();
    getSize = () => this.w.getSize();
    setMinimumSize = (a: number, b: number) => this.w.setMinimumSize(a, b);
    setPosition = () => this.w.setPosition();
    getPosition = () => this.w.getPosition();
    setAlwaysOnTop = () => this.w.setAlwaysOnTop();
    setVisibleOnAllWorkspaces = () => this.w.setVisibleOnAllWorkspaces();
    showInactive = () => this.w.showInactive();
    setIgnoreMouseEvents = (...a: unknown[]) => this.w.setIgnoreMouseEvents(...a);
    setWindowButtonVisibility = (v: boolean) => this.w.setWindowButtonVisibility(v);
    setWindowButtonPosition = (p: unknown) => this.w.setWindowButtonPosition(p);
    setTitle = () => this.w.setTitle();
    getTitle = () => this.w.getTitle();
    loadURL = () => this.w.loadURL();
    loadFile = () => this.w.loadFile();
    openDevTools = () => this.w.openDevTools();
    getNormalBounds = () => this.w.getNormalBounds();
    isMaximized = () => this.w.isMaximized();
    isFullScreen = () => this.w.isFullScreen();
    setBounds = (b: Record<string, unknown>) => this.w.setBounds(b);
    maximize = () => this.w.maximize();
    unmaximize = () => this.w.unmaximize();
    setFullScreen = (v: boolean) => this.w.setFullScreen(v);
    destroy = () => this.w.destroy();
    close = () => this.w.close();
  },
  shell: {
    openExternal: async (url: string) => {
      reg.openExternalCalls.push(url);
    },
  },
  ipcMain: {
    on: (channel: string, handler: (...a: unknown[]) => void) => {
      reg.on.push({ channel, handler });
    },
    handle: (channel: string, handler: (...a: unknown[]) => unknown) => {
      reg.handle.push({ channel, handler });
    },
    removeHandler: () => {},
  },
  Tray: FakeTray,
  Menu: {
    buildFromTemplate: (t: Array<Record<string, unknown>>) => {
      reg.menuTemplate = t;
      return t;
    },
    setApplicationMenu: () => {},
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, setTemplateImage: () => {} }),
    createEmpty: () => ({ isEmpty: () => true }),
  },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  session: { defaultSession: { cookies: { get: async () => [] } } },
};

(process as unknown as { resourcesPath: string }).resourcesPath = '/tmp/maestro-fake-resources';

// ── 把 electron / child_process 换成假实现，再 require main ───────
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return fakeElectron;
  if (request === 'node:child_process') {
    return {
      spawn: (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
        reg.spawned.push({ args: [cmd, ...args], env: opts?.env });
        return {
          on: () => {},
          kill: (sig: string) => {
            reg.killed.push(sig);
          },
          pid: 1234,
          stdout: null,
          stderr: null,
        };
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

/**
 * ② 全局 fetch 打桩 —— main 的 `waitForSidecar` 用 fetch 轮询 :3200。
 * 不打桩的话 startSidecar() 要轮询满 30s 才抛错，**后面的 createWindow()
 * 根本轮不到**（这正是 createWindow 长期 0% 的直接原因）。
 */
const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  reg.fetchCalls.push(String(url));
  return { ok: true, status: 200 } as unknown as Response;
}) as unknown as typeof fetch;

function resetRegs(): void {
  reg.on.length = 0;
  reg.handle.length = 0;
  reg.appOn.length = 0;
  reg.windows.length = 0;
  reg.trays.length = 0;
  reg.menuTemplate = [];
  reg.cookies = [];
  reg.removedCookies = [];
  reg.spawned = [];
  reg.killed = [];
  reg.openExternalCalls = [];
  reg.fetchCalls = [];
}

/** 加载 main.ts（每次都是一次「新的启动」）。 */
function loadMain(): void {
  delete require.cache[require.resolve('./main')];
  resetRegs();
  require('./main');
}

/** app.whenReady() 的 then 链是异步的 → 让它落定。 */
async function flushReady(times = 25): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

let passed = 0;
let failed = 0;
async function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

function onOf(channel: string) {
  const h = reg.on.find((x) => x.channel === channel);
  assert.ok(h, `没有注册 ipcMain.on('${channel}')`);
  return h!.handler;
}
function handlerOf(channel: string) {
  const h = reg.handle.find((x) => x.channel === channel);
  assert.ok(h, `没有注册 ipcMain.handle('${channel}')`);
  return h!.handler;
}
function appHandlerOf(event: string) {
  const h = reg.appOn.find((x) => x.event === event);
  assert.ok(h, `没有注册 app.on('${event}')`);
  return h!.handler;
}
function menuItem(label: string): Record<string, unknown> {
  const item = reg.menuTemplate.find((i) => i.label === label);
  assert.ok(item, `托盘菜单里没有「${label}」`);
  return item!;
}

async function main(): Promise<void> {
  // 预置一份**屏外**的浮窗坐标（x=5000 超过 1920 宽的显示器）：
  //   → main.ts 的 clampToVisibleDisplay 必然被调用（没有 bounds 就不调）
  //   → 它返回 null → 窗口选项里**不带 x/y**（坐标失效只丢位置、保留尺寸）
  //   → 这就是「拔掉外接显示器后浮窗不会被摆到空白区」那条逻辑的可观测后果。
  try {
    writeFileSync(
      '/tmp/maestro-test-userdata/desktop-lyrics.json',
      JSON.stringify({
        enabled: false,
        locked: false,
        bounds: { x: 5000, y: 200, width: 860, height: 160 },
      }),
      'utf-8',
    );
  } catch {
    /* 写不了就跳过这条断言，不让测试因为环境问题红 */
  }

  loadMain();
  await flushReady();

  // ── 1. 启动后主窗口与托盘都建起来了 ──────────────────────────
  await check('1. ready 之后主窗口建好了（createWindow 真的跑了）', () => {
    assert.ok(reg.windows.length >= 1, '没有 BrowserWindow 被创建');
    const w = reg.windows[0];
    assert.strictEqual(w.shown, 0, '窗口初始不该是 show 过的（show:false）');
  });

  await check('2. ready 之后托盘建好了（createTray 真的跑了）', () => {
    assert.strictEqual(reg.trays.length, 1, `托盘数量应为 1，实际 ${reg.trays.length}`);
    assert.ok(reg.trays[0].toolTip.length > 0, '托盘没设 tooltip');
  });

  await check('3. sidecar 被 spawn，waitForSidecar 的探针走的是 fetch', () => {
    assert.ok(reg.spawned.length > 0, 'sidecar 没被 spawn');
    assert.ok(
      reg.fetchCalls.some((u) => u.includes('/music/deezer/editorials')),
      `sidecar 探针没发出去：${reg.fetchCalls.join(', ')}`,
    );
  });

  // ── 2. 播放器状态 → 托盘提示 ─────────────────────────────────
  await check('4. player:state → 托盘 tooltip 跟着歌名/艺人走', () => {
    onOf('player:state')({}, { isPlaying: true, title: '平凡之路', artist: '朴树' });
    assert.strictEqual(reg.trays[0].toolTip, 'Maestro · 平凡之路 — 朴树');
  });

  await check('5. 托盘菜单：播放中显示「暂停」，菜单项点击 → 派发 tray:command', () => {
    const item = menuItem('暂停');
    assert.ok(item, '菜单里应有「暂停」');
    (item.click as () => void)();
    const sent = reg.windows[0].webContents.sent.filter((s) => s.channel === 'tray:command');
    assert.strictEqual(sent.length, 1, `应派发 1 次 tray:command，实际 ${sent.length}`);
    assert.strictEqual(sent[0].args[0], 'playpause');
  });

  await check('6. 托盘菜单「下一首」→ tray:command next', () => {
    (menuItem('下一首').click as () => void)();
    const sent = reg.windows[0].webContents.sent.filter((s) => s.channel === 'tray:command');
    assert.strictEqual(sent[sent.length - 1].args[0], 'next');
  });

  await check('7. 托盘菜单「显示主窗口」→ 窗口 show + focus', () => {
    const w = reg.windows[0];
    const before = { shown: w.shown, focused: w.focused };
    (menuItem('显示主窗口').click as () => void)();
    assert.strictEqual(w.shown, before.shown + 1, '窗口没有 show');
    assert.strictEqual(w.focused, before.focused + 1, '窗口没有 focus');
  });

  // ── 3. 播放模式 → 窗口形态 ───────────────────────────────────
  await check('8. player:mode=mini → 窗口收成 600×104 并水平居中', () => {
    const w = reg.windows[0];
    onOf('player:mode')({}, 'mini');
    assert.deepStrictEqual(w.minSizeCalls.at(-1), [460, 96], 'mini 的最小尺寸应是 460×96');
    const b = w.boundsCalls.at(-1) as { x: number; y: number; width: number; height: number };
    assert.strictEqual(b.width, 600, 'mini 宽度应是 600');
    assert.strictEqual(b.height, 104, 'mini 高度应是 104');
    assert.strictEqual(b.y, 200, 'mini 不该动 y（标题栏留在原位）');
    // 水平居中：x = 原 x + (原宽 - 新宽)/2 = 100 + (1200-600)/2 = 400
    assert.strictEqual(b.x, 400, 'mini 应水平居中');
  });

  await check('9. player:mode=mini → 红绿灯收起来（macOS 移到窗口外）', () => {
    const w = reg.windows[0];
    if (process.platform === 'darwin') {
      assert.deepStrictEqual(w.lightPosCalls.at(-1), { x: -100, y: -100 });
      assert.strictEqual(w.lightVisCalls.at(-1), false);
    } else {
      // 非 macOS：setLightsVisible 直接 return，**不该**动原生按钮
      assert.strictEqual(w.lightPosCalls.length, 0, '非 macOS 不该动红绿灯');
    }
  });

  await check('10. player:mode=theater → 恢复原 bounds + 最小尺寸', () => {
    const w = reg.windows[0];
    onOf('player:mode')({}, 'theater');
    assert.deepStrictEqual(w.minSizeCalls.at(-1), [960, 640], 'theater 最小尺寸应是 960×640');
    const b = w.boundsCalls.at(-1) as { width: number; height: number };
    assert.strictEqual(b.width, 1200, 'theater 应恢复原宽度');
    assert.strictEqual(b.height, 800, 'theater 应恢复原高度');
  });

  await check('11. window-buttons:visibility=false → 红绿灯移出窗口', () => {
    const w = reg.windows[0];
    onOf('window-buttons:visibility')({}, false);
    if (process.platform === 'darwin') {
      assert.deepStrictEqual(w.lightPosCalls.at(-1), { x: -100, y: -100 });
      assert.strictEqual(w.lightVisCalls.at(-1), false);
    }
  });

  // ── 4. QQ 扫码登录 → cookie 捕获 + uin 归一化 ──────────────────
  await check('12. qq:login → 捕获 qm_keyst + uin 归一化（去 o 前缀和前导零）', async () => {
    reg.cookies = [
      { name: 'qm_keyst', value: 'MUSICKEY', domain: '.qq.com' },
      { name: 'uin', value: 'o0361503867', domain: '.qq.com' },
    ];
    const r = (await handlerOf('qq:login')({})) as {
      success: boolean;
      cookie: string;
      uin?: string;
    };
    assert.strictEqual(r.success, true, `qq:login 失败：${JSON.stringify(r)}`);
    assert.ok(r.cookie.includes('qm_keyst=MUSICKEY'), '没捕获到 qm_keyst');
    // 'o0361503867' → 去 'o' → '0361503867' → 去前导零 → '361503867'
    assert.strictEqual(r.uin, '361503867', `uin 归一化不对：${r.uin}`);
  });

  await check('13. qq:login 前先清掉旧的 qm_keyst / qqmusic_key（防首轮抓过期票据）', async () => {
    const names = reg.removedCookies.map((c) => c.name);
    assert.ok(names.includes('qm_keyst'), `没清 qm_keyst：${names.join(',')}`);
    assert.ok(names.includes('qqmusic_key'), `没清 qqmusic_key：${names.join(',')}`);
  });

  // ── 5. 网易云扫码登录 → MUSIC_U 捕获 ──────────────────────────
  await check('14. netease:login → 捕获 MUSIC_U（长度够才算登录态）', async () => {
    reg.cookies = [
      { name: 'MUSIC_U', value: 'X'.repeat(40), domain: '.music.163.com' },
      { name: '__csrf', value: 'csrf-token', domain: '.music.163.com' },
    ];
    const r = (await handlerOf('netease:login')({})) as {
      success: boolean;
      musicU?: string;
      csrfToken?: string;
    };
    assert.strictEqual(r.success, true, `netease:login 失败：${JSON.stringify(r)}`);
    assert.strictEqual(r.musicU, 'X'.repeat(40), '没捕获到 MUSIC_U');
    assert.strictEqual(r.csrfToken, 'csrf-token', '没捕获到 __csrf');
  });

  // ── 6. deep link 路由 ────────────────────────────────────────
  await check('15. open-url 带 code+state → 推给 renderer + 进 oauth buffer', () => {
    const w = reg.windows[0];
    const before = w.webContents.sent.length;
    appHandlerOf('open-url')(
      { preventDefault: () => {} },
      'maestro://spotify-callback?code=C1&state=S1',
    );
    const sent = w.webContents.sent.slice(before);
    const oauth = sent.find((s) => s.channel === 'spotify:oauth-protocol');
    assert.ok(oauth, `没推 spotify:oauth-protocol：${sent.map((s) => s.channel).join(',')}`);
    assert.deepStrictEqual(oauth!.args[0], { code: 'C1', state: 'S1' });
  });

  await check('16. open-url 带 error → 推 error（不让 renderer 干等）', () => {
    const w = reg.windows[0];
    const before = w.webContents.sent.length;
    appHandlerOf('open-url')(
      { preventDefault: () => {} },
      'maestro://spotify-callback?error=access_denied&state=S2',
    );
    const sent = w.webContents.sent.slice(before);
    const oauth = sent.find((s) => s.channel === 'spotify:oauth-protocol');
    assert.ok(oauth, '没推 spotify:oauth-protocol');
    assert.deepStrictEqual(oauth!.args[0], { error: 'access_denied', state: 'S2' });
  });

  await check('17. consume-oauth-callback → 能取回刚推入的回调', async () => {
    // ⚠️ consume() 是 **async** —— 必须 await，否则拿到的是 Promise（JSON 化成 {}）
    const r = (await handlerOf('consume-oauth-callback')({})) as {
      code?: string;
      state?: string;
      error?: string;
    };
    assert.ok(r, 'consume 返回空');
    assert.ok(
      r.code === 'C1' || r.error === 'access_denied',
      `buffer 内容不对：${JSON.stringify(r)}`,
    );
  });

  // ── 7. 退出路径 ──────────────────────────────────────────────
  await check('18. before-quit → sidecar 收 SIGTERM（等落盘）', () => {
    appHandlerOf('before-quit')();
    assert.ok(reg.killed.includes('SIGTERM'), `sidecar 没收到 SIGTERM：${reg.killed.join(',')}`);
  });

  await check('19. window-all-closed → sidecar 也被收掉', async () => {
    // 上一个用例的 before-quit 已经把 sidecar 收掉并置 null（stopSidecar 早退，
    // 这是**正确**行为）→ 要验这条路径得重新起一次 main。
    loadMain();
    await flushReady();
    assert.ok(reg.spawned.length > 0, '重新启动后 sidecar 没被 spawn');
    const before = reg.killed.length;
    appHandlerOf('window-all-closed')();
    assert.ok(reg.killed.length > before, 'window-all-closed 没收 sidecar');
  });

  // ── 7.5 全局热键（§7.3）：main 真的注册了，且**没有**误注册媒体键 ──
  //
  // 「媒体键注册成 globalShortcut 会关掉 Chromium 自己的媒体键处理」→
  // 媒体键必须只走 renderer 的 navigator.mediaSession。
  // 这条断言在**主进程这一层**再守一次（`global-shortcuts.test.ts` 守的是
  // 模块层）：万一以后有人绕过模块直接在 main.ts 里注册媒体键，这里会红。
  await check('19b. 全局热键已注册，且一个媒体键都没有', () => {
    assert.ok(reg.globalShortcuts.length > 0, '全局热键一条都没注册');
    const mediaKeys = [
      'MediaPlayPause',
      'MediaNextTrack',
      'MediaPreviousTrack',
      'MediaStop',
      'MediaRewind',
      'MediaFastForward',
    ];
    for (const accel of reg.globalShortcuts) {
      assert.ok(
        !mediaKeys.includes(accel),
        `主进程注册了媒体键 ${accel} —— 会关掉 Chromium 自己的媒体键处理`,
      );
    }
  });

  await check('19c. before-quit → 全局热键全部注销', () => {
    const before = reg.globalShortcuts.length;
    assert.ok(before > 0, '前置状态不对：没有已注册的全局热键');
    appHandlerOf('before-quit')();
    assert.strictEqual(
      reg.globalShortcuts.length,
      0,
      `退出后应全部注销，还剩 ${reg.globalShortcuts.join(',')}`,
    );
  });

  // ── 8. 桌面歌词浮窗：main.ts ↔ 控制器 的接线 ──────────────────
  //
  // main.ts 把 5 个**本地闭包**传给 DesktopLyricsController（loadTarget /
  // clampToVisibleDisplay / log / fromOverlay / safeStr）。它们只有在控制器
  // **真的建起浮窗**、**真的收到浮窗消息**时才会被调用 —— 所以「注册了通道」
  // 不等于「接线被验证过」。之前这几个函数在 main.ts 里是 0 覆盖。
  await check('20. 托盘「桌面歌词」→ 浮窗真的建起来了（loadTarget 走到了）', () => {
    const before = reg.windows.length;
    const item = menuItem('桌面歌词');
    const click = item.click as ((i?: unknown) => void) | undefined;
    assert.ok(typeof click === 'function', '托盘「桌面歌词」没有 click 处理');
    (click as (i?: unknown) => void)();
    assert.ok(reg.windows.length > before, '浮窗没建出来');
    // 浮窗建出来后是「已加载才显示」→ 先不显示，等 did-finish-load
    const overlay = reg.windows[reg.windows.length - 1];
    assert.strictEqual(overlay.shownInactive, 0, '加载完之前不该 show（避免空框闪一下）');
  });

  await check('21. 浮窗消息只认浮窗自己（别的 renderer 不能锁死用户浮窗）', () => {
    const overlay = reg.windows[reg.windows.length - 1];
    const onControl = onOf('desktop-lyrics:overlay:control');
    const onHover = onOf('desktop-lyrics:overlay:hover');

    // ① 不是浮窗自己 → 忽略（preload 是主窗口和浮窗共用的桥，不校验 sender
    //    等于把「关掉 / 锁死用户浮窗」的权限开给任意 renderer）
    onControl({ sender: { notTheOverlay: true } }, { action: 'close' });
    onHover({ sender: { notTheOverlay: true } }, { inside: true });
    assert.ok(!overlay.destroyed, '非浮窗的 close 不该把浮窗关掉');

    // ② 浮窗自己 → 生效
    onControl({ sender: overlay.webContents }, { action: 'lock', locked: true });
    onHover({ sender: overlay.webContents }, { inside: true });
    // 锁定态不关窗（只是切点击穿透）
    assert.ok(!overlay.destroyed, 'lock 不该关窗');
  });

  await check('22. 浮窗加载完成 → 才显示（did-finish-load 之后才 showInactive）', () => {
    const overlay = reg.windows[reg.windows.length - 1];
    // 触发浮窗 webContents 的 did-finish-load
    const load = overlay.webContents.listeners.find((l) => l.channel === 'did-finish-load');
    assert.ok(load, '浮窗没有监听 did-finish-load');
    load!.handler();
    assert.strictEqual(overlay.shownInactive, 1, '加载完才显示');
  });

  await check('23. 浮窗的历史坐标在屏外 → 丢弃位置、保留尺寸（clampToVisibleDisplay 生效）', () => {
    const overlay = reg.windows[reg.windows.length - 1];
    const opts = (overlay as unknown as { opts?: Record<string, unknown> }).opts;
    assert.ok(opts, '没有拿到窗口构造参数');
    // 屏外坐标 → 不下发 x/y（但尺寸还在）
    assert.strictEqual(opts!.x, undefined, '屏外坐标不该下发');
    assert.strictEqual(opts!.y, undefined, '屏外坐标不该下发');
    assert.strictEqual(opts!.width, 860, '尺寸要保留（用户拉过的宽度不是白拉的）');
  });

  await check('24. 穿透设置出错 → 只告警不崩（控制器的 log 回调）', () => {
    reg.throwOnSetIgnoreMouseEvents = true;
    try {
      const overlay = reg.windows[reg.windows.length - 1];
      // 浮窗自己发的锁定消息（只有浮窗自己发才算）→ 走 applyMousePassthrough
      onOf('desktop-lyrics:overlay:control')(
        { sender: overlay.webContents },
        { action: 'lock', locked: true },
      );
      assert.ok(!overlay.destroyed, '出错也不该把浮窗弄丢');
    } finally {
      reg.throwOnSetIgnoreMouseEvents = false;
    }
  });

  await check('25. widevine 探测失败 → 不阻塞启动（safeStr 分支）', async () => {
    reg.widevineFails = true;
    try {
      loadMain();
      await flushReady();
      assert.ok(reg.windows.length > 0, 'widevine 挂了也要把主窗口建起来');
    } finally {
      reg.widevineFails = false;
    }
  });

  globalThis.fetch = origFetch;
  Module._load = origLoad;
  console.log(`\n🎉 main.behavior.test: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
