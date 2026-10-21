/**
 * main.ts 执行级测试 —— 真的把 Electron main 进程**跑起来**（electron 全 mock），
 * 断言它真的注册了 IPC 通道、真的把内部 token 传给了 sidecar。
 *
 * 与 `ipc-surface.test.ts` / `preload.test.ts` 的分工：
 *   - `ipc-surface.test.ts` = **文本级**双向交叉校验（preload 用的通道 ↔ main
 *     注册的通道），保证"名字对得上"。
 *   - `preload.test.ts` = renderer 侧**执行级**（真调 API，断言通道/参数/退订）。
 *   - **本文件** = main 侧**执行级**：把 main 跑起来，断言
 *     ① 顶层注册的 ipcMain.on 通道真的注册了
 *     ② ready 之后注册的 ipcMain.handle 通道真的注册了（且**顺序**对）
 *     ③ handler 被 invoke 时**真的产生了效果**（不是空壳）
 *     ④ **sidecar 拿到的 MAESTRO_INTERNAL_TOKEN 是个随机 32 字节 hex**
 *        （安全相关：这是 CSRF 门禁的共享密钥，写死或为空 = 门禁形同虚设）
 *
 * Run: npx ts-node packages/electron/src/main.ipc-exec.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */

// ── electron 的假实现 ────────────────────────────────────────────
const reg = {
  on: [] as Array<{ channel: string; handler: (...a: unknown[]) => void }>,
  handle: [] as Array<{ channel: string; handler: (...a: unknown[]) => unknown }>,
  appOn: [] as Array<{ event: string; handler: (...a: unknown[]) => void }>,
};

class FakeWebContents {
  listeners: Array<{ channel: string; handler: (...a: unknown[]) => void }> = [];
  sent: Array<{ channel: string; args: unknown[] }> = [];
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
}

const fakeWindow = {
  webContents: new FakeWebContents(),
  on() {},
  once() {},
  show() {},
  hide() {},
  focus() {},
  isDestroyed: () => false,
  isVisible: () => true,
  setSize: (..._a: unknown[]) => {},
  getSize: () => [1280, 800],
  setMinimumSize: (..._a: unknown[]) => {},
  setPosition: (..._a: unknown[]) => {},
  getPosition: () => [0, 0],
  setAlwaysOnTop: (..._a: unknown[]) => {},
  setVisibleOnAllWorkspaces: (..._a: unknown[]) => {},
  setWindowButtonVisibility: (..._a: unknown[]) => {},
  setTitle: (..._a: unknown[]) => {},
  getTitle: () => 'Maestro',
  loadURL: (..._a: unknown[]) => {},
  loadFile: (..._a: unknown[]) => {},
  openDevTools: (..._a: unknown[]) => {},
};

const spawned: Array<{ args: unknown[]; env: Record<string, string> | undefined }> = [];
const openExternalCalls: string[] = [];

const fakeElectron = {
  app: {
    setName: () => {},
    getPath: () => '/tmp/maestro-test-userdata',
    getVersion: () => '0.0.0-test',
    // 生产模式：dev 模式下 main **不**起 sidecar（用户自己跑 npm run dev:server），
    // 而 sidecar 正是 MAESTRO_INTERNAL_TOKEN 的接收方 → 要验 token 必须 packaged。
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
    dock: { hide: () => {}, show: () => {} },
    focus: () => {},
    addRecentDocument: () => {},
  },
  components: {
    whenReady: async () => undefined,
    status: () => ({ ready: true }),
  },
  BrowserWindow: class {
    constructor(public opts: unknown) {}
    webContents = fakeWindow.webContents;
    on = fakeWindow.on;
    once = fakeWindow.once;
    show = fakeWindow.show;
    hide = fakeWindow.hide;
    focus = fakeWindow.focus;
    isDestroyed = fakeWindow.isDestroyed;
    isVisible = fakeWindow.isVisible;
    setSize = fakeWindow.setSize;
    getSize = fakeWindow.getSize;
    setMinimumSize = fakeWindow.setMinimumSize;
    setPosition = fakeWindow.setPosition;
    getPosition = fakeWindow.getPosition;
    setAlwaysOnTop = fakeWindow.setAlwaysOnTop;
    setVisibleOnAllWorkspaces = fakeWindow.setVisibleOnAllWorkspaces;
    setWindowButtonVisibility = fakeWindow.setWindowButtonVisibility;
    setTitle = fakeWindow.setTitle;
    getTitle = fakeWindow.getTitle;
    loadURL = fakeWindow.loadURL;
    loadFile = fakeWindow.loadFile;
    openDevTools = fakeWindow.openDevTools;
  },
  shell: {
    openExternal: async (url: string) => {
      openExternalCalls.push(url);
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
  Tray: class {
    constructor(public img: unknown) {}
    setToolTip() {}
    setContextMenu() {}
    on() {}
  },
  Menu: {
    buildFromTemplate: (t: unknown) => t,
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

// 生产模式下 sidecar 路径 = path.join(process.resourcesPath, 'server', 'main.js')
(process as unknown as { resourcesPath: string }).resourcesPath = '/tmp/maestro-fake-resources';

// ── 把 electron / child_process 换成假实现，再 require main ───────
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return fakeElectron;
  if (request === 'node:child_process') {
    return {
      spawn: (cmd: string, args: string[], opts: { env?: Record<string, string> }) => {
        spawned.push({ args: [cmd, ...args], env: opts?.env });
        return { on: () => {}, kill: () => {}, pid: 1234, stdout: null, stderr: null };
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

/**
 * 加载 main.ts（可重复调用 —— 每次都是一次"新的启动"）。
 * 重复加载要清 require 缓存，否则拿到的是同一个模块实例、token 也不会变。
 */
function loadMain(): void {
  delete require.cache[require.resolve('./main')];
  reg.on.length = 0;
  reg.handle.length = 0;
  reg.appOn.length = 0;
  spawned.length = 0;
  require('./main');
}

loadMain();

let passed = 0;
let failed = 0;
async function check(label: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

function handlerOf(channel: string) {
  const h = reg.handle.find((x) => x.channel === channel);
  assert.ok(h, `没有注册 handle('${channel}')`);
  return h!.handler;
}

async function main() {
  // ── 1. 顶层注册的 ipcMain.on 通道 ────────────────────────────
  await check('1. 顶层注册了播放器/窗口的 ipcMain.on 通道', () => {
    const channels = reg.on.map((x) => x.channel);
    for (const expected of ['player:state', 'player:mode', 'window-buttons:visibility']) {
      assert.ok(
        channels.includes(expected),
        `顶层没注册 ipcMain.on('${expected}')（实际：${channels.join(', ')}）`,
      );
    }
  });

  await check('1b. ready 之后注册了桌面歌词的 ipcMain.on 通道', async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const channels = reg.on.map((x) => x.channel);
    for (const expected of [
      'desktop-lyrics:state',
      'desktop-lyrics:set-enabled',
      'desktop-lyrics:overlay:hover',
    ]) {
      assert.ok(
        channels.includes(expected),
        `没注册 ipcMain.on('${expected}')（实际：${channels.join(', ')}）`,
      );
    }
  });

  await check('2. app 事件监听注册了（second-instance / open-url）', () => {
    const events = reg.appOn.map((x) => x.event);
    assert.ok(events.includes('second-instance'), '没注册 second-instance');
    assert.ok(events.includes('open-url'), '没注册 open-url');
  });

  // ── 2. ready 之后注册的 ipcMain.handle 通道 ───────────────────
  await check('3. app ready 之后注册了 handle 通道', async () => {
    // 放行 whenReady 的 then 链（真 Electron 里 handler 是在 ready 之后注册的，
    //  见 main.ts 的 Bug #1 兜底注释）
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const channels = reg.handle.map((x) => x.channel);
    for (const expected of [
      'qq:login',
      'netease:login',
      'consume-oauth-callback',
      'shell:open-external',
      'widevine:status',
    ]) {
      assert.ok(
        channels.includes(expected),
        `ready 后没注册 handle('${expected}')（实际：${channels.join(', ')}）`,
      );
    }
  });

  // ── 3. handler 真被 invoke 时产生效果 ───────────────────────
  await check('4. shell:open-external：合法 url → 真的调 shell.openExternal', async () => {
    openExternalCalls.length = 0;
    await handlerOf('shell:open-external')({}, 'https://music.163.com/song?id=1');
    assert.deepStrictEqual(openExternalCalls, ['https://music.163.com/song?id=1']);
  });

  await check('5. shell:open-external：非 http(s) → 抛错（不放行任意协议）', async () => {
    openExternalCalls.length = 0;
    let threw = false;
    try {
      await handlerOf('shell:open-external')({}, 'file:///etc/passwd');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'file:// 应该被拒绝');
    assert.strictEqual(openExternalCalls.length, 0, '被拒的 url 不能真的打开');
  });

  await check('6. widevine:status：返回 ready + status', async () => {
    const r = (await handlerOf('widevine:status')({})) as { ready?: boolean };
    assert.strictEqual(r.ready, true, 'components.whenReady 成功后 ready 应为 true');
  });

  // ── 4. sidecar 拿到的内部 token ─────────────────────────────
  await check('7. sidecar 带着随机的 MAESTRO_INTERNAL_TOKEN 启动（CSRF 门禁的共享密钥）', () => {
    assert.ok(spawned.length > 0, 'sidecar 没有被 spawn');
    const env = spawned[spawned.length - 1].env;
    assert.ok(env, 'spawn 没带 env');
    const token = env!.MAESTRO_INTERNAL_TOKEN;
    assert.ok(token, 'env 里没有 MAESTRO_INTERNAL_TOKEN');
    assert.match(token, /^[0-9a-f]{64}$/, `token 应是 32 字节 hex（实际长度 ${token?.length}）`);
  });

  await check('8. 两次启动的 token 不一样（不是写死的常量）', async () => {
    const first = spawned[spawned.length - 1]?.env?.MAESTRO_INTERNAL_TOKEN;
    assert.ok(first, '第一次启动没拿到 token');
    // 再"启动"一次 —— 必须是**新**的 token（写死常量 = CSRF 门禁形同虚设）
    loadMain();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const second = spawned[spawned.length - 1]?.env?.MAESTRO_INTERNAL_TOKEN;
    assert.ok(second, '第二次启动没拿到 token');
    assert.notStrictEqual(second, first, '两次启动的 token 相同 → 是写死的常量');
  });

  Module._load = origLoad; // 还原 electron 模块加载（测试全程都要是假的）
  console.log(`\n🎉 main.ipc-exec.test: ${passed} passed, ${failed} failed`);
  // 显式退出：main 的 whenReady 链里还有一个「等 sidecar 上线」的 30s 轮询
  // （假 sidecar 不会真的监听 3200），那与本测试无关，别让它拖住进程。
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
