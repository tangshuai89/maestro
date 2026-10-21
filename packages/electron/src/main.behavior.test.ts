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
  spawned: [] as Array<{ args: unknown[]; env?: Record<string, string> }>,
  killed: [] as string[],
  openExternalCalls: [] as string[],
  fetchCalls: [] as string[],
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
    whenReady: async () => undefined,
    status: () => ({ ready: true }),
  },
  BrowserWindow: class {
    /** 底层假窗口；所有方法都转发到它（箭头函数字段，this 固定是这个实例）。 */
    readonly w = new FakeWindow();
    static getAllWindows(): FakeWindow[] {
      return reg.windows;
    }
    constructor(public opts: unknown) {
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

  globalThis.fetch = origFetch;
  Module._load = origLoad;
  console.log(`\n🎉 main.behavior.test: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
