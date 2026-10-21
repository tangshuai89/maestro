/**
 * preload 执行级测试 —— **真的调用** preload 暴露的每个 API，断言它发出的是
 * 哪个 IPC 通道、带什么参数、退订是否真的解绑。
 *
 * 与 `ipc-surface.test.ts` 的分工（别混淆）：
 *   - `ipc-surface.test.ts` = **文本级**：grep 源码里的通道名，做双向交叉校验
 *     （preload 用的通道 ↔ main 注册的通道）。它保证"名字对得上"。
 *   - **本文件** = **执行级**：把 electron mock 掉，真调一遍 API，断言
 *     "invoke 的是不是这个通道、参数对不对、退订有没有解绑"。它保证
 *     "**调用真的发出去了**" —— 名字对了但参数写错、或者退订没解绑，文本级
 *     测试全都发现不了。
 *
 * 覆盖的行为契约：
 *  1. 每个 API 打到**正确的通道**（invoke / send 用对方式）
 *  2. 参数原样带过去（url / state / mode / visible / 消息体）
 *  3. 订阅类 API 注册监听、回调能收到 payload、**退订真的解绑**
 *  4. `onIpc` 的白名单：不在白名单的通道**被拒绝**（不注册监听）
 *  5. `onSidecarReady` 会把 apiBase / internalToken 写回 electronAPI
 *     （renderer 的 api.ts 靠它拿到 sidecar 地址）
 *
 * Run: npx ts-node packages/electron/src/preload.test.ts
 */
export {};
const assert = require('node:assert');

/** electron 的假实现：记录所有 invoke / send / on / removeListener。 */
const calls = {
  invoke: [] as Array<{ channel: string; args: unknown[] }>,
  send: [] as Array<{ channel: string; args: unknown[] }>,
  listeners: [] as Array<{ channel: string; handler: (...a: unknown[]) => void }>,
  removed: [] as Array<{ channel: string; handler: (...a: unknown[]) => void }>,
};

const fakeIpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => {
    calls.invoke.push({ channel, args });
    return Promise.resolve({ ok: true });
  },
  send: (channel: string, ...args: unknown[]) => {
    calls.send.push({ channel, args });
  },
  on: (channel: string, handler: (...a: unknown[]) => void) => {
    calls.listeners.push({ channel, handler });
  },
  removeListener: (channel: string, handler: (...a: unknown[]) => void) => {
    calls.removed.push({ channel, handler });
  },
};

let exposed: Record<string, any> = {};

/* eslint-disable @typescript-eslint/no-var-requires */
const { ipcRenderer, contextBridge } = require('electron');

/** electron 模块的替身必须在 require('electron') 之前装上。 */
const Module = require('node:module');
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      ipcRenderer: fakeIpcRenderer,
      contextBridge: {
        exposeInMainWorld: (key: string, api: unknown) => {
          exposed = api as Record<string, any>;
        },
      },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

require('./preload');
Module._load = origLoad;

function reset() {
  calls.invoke.length = 0;
  calls.send.length = 0;
  calls.listeners.length = 0;
  calls.removed.length = 0;
}

function lastInvoke(channel: string) {
  const hit = calls.invoke.filter((c) => c.channel === channel);
  return hit.length ? hit[hit.length - 1] : null;
}
function lastSend(channel: string) {
  const hit = calls.send.filter((c) => c.channel === channel);
  return hit.length ? hit[hit.length - 1] : null;
}

let passed = 0;
let failed = 0;
/** check 支持 async 回调 —— 断言必须**等**完，否则失败会被漏到 Promise 里
 *  （第一版就栽在这：断言在 async 函数里 reject，测试却报"全绿"）。 */
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

async function main() {
  await check('0. preload 通过 contextBridge 暴露了 electronAPI', () => {
    assert.ok(exposed, 'contextBridge.exposeInMainWorld 没被调用');
    assert.strictEqual(typeof exposed.qqLogin, 'function');
    assert.strictEqual(typeof exposed.onIpc, 'function');
  });

  // ── 1. invoke 类：通道 + 参数 ───────────────────────────────
  await check(
    '1. qqLogin / neteaseLogin / getWidevineStatus / consumeOAuthCallback → 对应通道',
    async () => {
      reset();
      await exposed.qqLogin();
      await exposed.neteaseLogin();
      await exposed.getWidevineStatus();
      await exposed.consumeOAuthCallback();
      const channels = calls.invoke.map((c) => c.channel);
      assert.deepStrictEqual(channels, [
        'qq:login',
        'netease:login',
        'widevine:status',
        'consume-oauth-callback',
      ]);
    },
  );

  await check('2. openExternal → shell:open-external + 原样带 url', async () => {
    reset();
    await exposed.openExternal('https://music.163.com/song?id=1');
    const hit = lastInvoke('shell:open-external');
    assert.ok(hit, '没有 invoke shell:open-external');
    assert.deepStrictEqual(hit!.args, ['https://music.163.com/song?id=1']);
  });

  // ── 2. send 类（fire-and-forget）────────────────────────────
  await check(
    '3. reportPlaybackState / reportPlayerMode / setWindowButtonsVisible → send + 参数',
    () => {
      reset();
      exposed.reportPlaybackState({ playing: true, title: '歌' } as never);
      exposed.reportPlayerMode('mini' as never);
      exposed.setWindowButtonsVisible(false);
      assert.deepStrictEqual(lastSend('player:state')!.args, [{ playing: true, title: '歌' }]);
      assert.deepStrictEqual(lastSend('player:mode')!.args, ['mini']);
      assert.deepStrictEqual(lastSend('window-buttons:visibility')!.args, [false]);
    },
  );

  // ── 3. 桌面歌词那组 ─────────────────────────────────────────
  await check('4. desktopLyrics.* → 各自的通道 + 参数', async () => {
    reset();
    exposed.desktopLyrics.pushState({ line: 'x' } as never);
    exposed.desktopLyrics.setEnabled(true);
    exposed.desktopLyrics.control({ action: 'lock' } as never);
    exposed.desktopLyrics.hover(true);
    assert.ok(lastSend('desktop-lyrics:state'), 'pushState 没发 desktop-lyrics:state');
    assert.deepStrictEqual(lastSend('desktop-lyrics:set-enabled')!.args, [true]);
    assert.deepStrictEqual(lastSend('desktop-lyrics:overlay:control')!.args, [{ action: 'lock' }]);
    assert.deepStrictEqual(lastSend('desktop-lyrics:overlay:hover')!.args, [{ inside: true }]);
    await exposed.desktopLyrics.getStatus();
    assert.ok(lastInvoke('desktop-lyrics:status'), 'getStatus 没 invoke desktop-lyrics:status');
  });

  // ── 4. 订阅类：注册 / 回调 / 退订 ───────────────────────────
  await check('5. onTrayCommand：注册监听 → 回调收到 payload → 退订解绑', () => {
    reset();
    const got: unknown[] = [];
    const off = exposed.onTrayCommand((cmd: unknown) => got.push(cmd));
    assert.strictEqual(calls.listeners.length, 1);
    assert.strictEqual(calls.listeners[0].channel, 'tray:command');
    // 模拟 main 推事件
    calls.listeners[0].handler({}, 'playpause');
    assert.deepStrictEqual(got, ['playpause']);
    off();
    assert.strictEqual(calls.removed.length, 1);
    assert.strictEqual(calls.removed[0].channel, 'tray:command');
    assert.strictEqual(calls.removed[0].handler, calls.listeners[0].handler);
  });

  await check(
    '6. onQqLoginSuccess / desktopLyrics.onChanged|onState|onPrefs：同样注册+退订',
    () => {
      reset();
      const offs = [
        exposed.onQqLoginSuccess(() => {}),
        exposed.desktopLyrics.onChanged(() => {}),
        exposed.desktopLyrics.onState(() => {}),
        exposed.desktopLyrics.onPrefs(() => {}),
      ];
      const channels = calls.listeners.map((l) => l.channel);
      assert.deepStrictEqual(channels, [
        'qq-login-result',
        'desktop-lyrics:changed',
        'desktop-lyrics:state',
        'desktop-lyrics:overlay:prefs',
      ]);
      for (const off of offs) off();
      assert.strictEqual(calls.removed.length, 4, '四个订阅都该解绑');
    },
  );

  // ── 5. onSidecarReady：写回 apiBase / internalToken ───────────
  await check('7. onSidecarReady：回调触发后 electronAPI 被写上 apiBase / internalToken', () => {
    reset();
    let got: unknown = null;
    const off = exposed.onSidecarReady((info: unknown) => {
      got = info;
    });
    const handler = calls.listeners.find((l) => l.channel === 'sidecar-ready');
    assert.ok(handler, '没注册 sidecar-ready 监听');
    handler!.handler({}, { apiBase: 'http://127.0.0.1:3200', internalToken: 'tok' });
    assert.deepStrictEqual(got, { apiBase: 'http://127.0.0.1:3200', internalToken: 'tok' });
    // 关键：renderer 的 api.ts 就是靠这两个字段拿 sidecar 地址和内部 token
    assert.strictEqual(exposed.apiBase, 'http://127.0.0.1:3200');
    assert.strictEqual(exposed.internalToken, 'tok');
    off();
    assert.strictEqual(calls.removed.length, 1);
  });

  // ── 6. onIpc 的白名单边界 ───────────────────────────────────
  await check('8. onIpc：白名单内的通道可订阅', () => {
    reset();
    const off = exposed.onIpc('tray:command', () => {});
    assert.strictEqual(calls.listeners.length, 1);
    assert.strictEqual(calls.listeners[0].channel, 'tray:command');
    off();
  });

  await check('9. onIpc：白名单外的通道**被拒绝**（不注册监听）', () => {
    reset();
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => warnings.push(a.join(' '));
    let off: (() => void) | undefined;
    try {
      off = exposed.onIpc('secrets:deepseek', () => {});
    } finally {
      console.warn = warn;
    }
    assert.strictEqual(calls.listeners.length, 0, '非白名单通道不应注册监听');
    assert.ok(
      warnings.some((w) => w.includes('secrets:deepseek')),
      '应该 warn 出来（说明是被有意拒绝的，不是静默）',
    );
    assert.strictEqual(typeof off, 'function', '被拒绝时也要返回一个可调用的退订函数');
    off!();
  });

  console.log(`\n🎉 preload.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
