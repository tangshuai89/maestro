/**
 * 自动更新状态机的单测（specs/auto-update）。
 *
 * 守的是**状态怎么流转**，不是 electron-updater 本身 —— 后者由 main 侧适配，
 * 这里用一个假 bridge 驱动。
 *
 * 变异验证：把「同名函数的去重」…… ⇒（本文件对应的变异是）把
 * `progress` 事件的百分比换算去掉（直接透传 0..1 的小数）→ 断言 2c 必须红。
 *
 * Run: npx ts-node packages/electron/src/updater.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { createUpdater, loadElectronUpdater, createElectronUpdaterBridge } = require('./updater');
import type { UpdateState } from './updater';

type Handler = (payload: never) => void;

function makeBridge() {
  const handlers = new Map<string, Handler>();
  const calls = { check: 0, install: 0, checkError: null as Error | null };
  const bridge = {
    handlers,
    calls,
    /** 让 check() 成功/失败 */
    setCheckError(e: Error | null) {
      calls.checkError = e;
    },
    async check(): Promise<void> {
      calls.check++;
      if (calls.checkError) throw calls.checkError;
    },
    on(event: string, cb: Handler) {
      handlers.set(event, cb);
    },
    install() {
      calls.install++;
    },
    /** 手动触发一个底层事件 */
    emit(event: string, payload: unknown) {
      const cb = handlers.get(event);
      assert.ok(cb, `没有注册事件 ${event}`);
      (cb as (p: unknown) => void)(payload);
    },
  };
  return bridge;
}

async function main() {
  let passed = 0;
  let failed = 0;
  function ok(label: string) {
    console.log(`✅ ${label}`);
    passed++;
  }
  function fail(label: string, msg: string) {
    console.log(`❌ ${label}\n   ${msg}`);
    failed++;
  }
  function expect(label: string, cond: unknown, detail = '') {
    if (cond) ok(label);
    else fail(label, detail);
  }

  // ── 1. 初始状态 + 订阅立刻收到当前状态 ──────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    expect('1. 初始状态是 idle', u.getState().kind === 'idle', JSON.stringify(u.getState()));

    const seen: string[] = [];
    u.subscribe((s: UpdateState) => seen.push(s.kind));
    expect(
      '1b. 订阅时立刻收到当前状态',
      seen.length === 1 && seen[0] === 'idle',
      JSON.stringify(seen),
    );
  }

  // ── 2. check() → checking → available ──────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    const kinds: string[] = [];
    u.subscribe((s: UpdateState) => kinds.push(s.kind));

    const p = u.check();
    expect(
      '2. check() 立刻进入 checking',
      u.getState().kind === 'checking',
      JSON.stringify(u.getState()),
    );
    bridge.emit('available', { version: '1.2.0', notes: '修了几个 bug' });
    await p;
    expect(
      '2b. available 事件 → available 状态',
      u.getState().kind === 'available',
      JSON.stringify(u.getState()),
    );
    const st = u.getState() as { kind: string; version: string; notes?: string };
    expect('2c. 版本号带上了', st.version === '1.2.0', JSON.stringify(st));
    expect('2d. 更新说明带上了', st.notes === '修了几个 bug', JSON.stringify(st));
    // 订阅时先推一次当前状态（idle）⇒ 完整序列是 idle → checking → available
    expect(
      '2e. 状态序列是 idle → checking → available',
      kinds.join(',') === 'idle,checking,available',
      kinds.join(','),
    );
  }

  // ── 3. not-available / progress / downloaded ────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    bridge.emit('not-available', { version: '1.0.0' });
    expect(
      '3. not-available 事件 → not-available',
      u.getState().kind === 'not-available',
      JSON.stringify(u.getState()),
    );

    bridge.emit('progress', { percent: 0.42 });
    const dl = u.getState() as { kind: string; percent: number };
    expect('3b. progress 事件 → downloading', dl.kind === 'downloading', JSON.stringify(dl));
    expect('3c. 0..1 的小数换算成百分比（0.42 → 42）', dl.percent === 42, String(dl.percent));

    bridge.emit('progress', { percent: 1.5 }); // 越界
    const dl2 = u.getState() as { percent: number };
    expect('3d. 越界的百分比被夹到 100', dl2.percent === 100, String(dl2.percent));

    bridge.emit('downloaded', { version: '1.2.0' });
    const rd = u.getState() as { kind: string; version: string };
    expect('3e. downloaded 事件 → ready（等重启安装）', rd.kind === 'ready', JSON.stringify(rd));
    expect('3f. ready 带版本号', rd.version === '1.2.0', JSON.stringify(rd));
  }

  // ── 4. check() 抛错 → error ────────────────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    bridge.setCheckError(new Error('No published versions on GitHub'));
    const st = await u.check();
    expect('4. check() 抛错 → error 状态', st.kind === 'error', JSON.stringify(st));
    expect(
      '4b. error 带上了原始错误信息',
      (st as { message: string }).message.includes('No published versions'),
      JSON.stringify(st),
    );
  }

  // ── 5. error 事件 ──────────────────────────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    bridge.emit('error', { message: 'network down' });
    expect(
      '5. error 事件 → error 状态',
      u.getState().kind === 'error',
      JSON.stringify(u.getState()),
    );
  }

  // ── 6. install() → 调 bridge.install ───────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    u.install();
    expect(
      '6. install() 调了底层 install',
      bridge.calls.install === 1,
      String(bridge.calls.install),
    );
  }

  // ── 7. 退订后不再收到 ──────────────────────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    const seen: string[] = [];
    const off = u.subscribe((s: UpdateState) => seen.push(s.kind));
    off();
    bridge.emit('available', { version: '9.9.9' });
    expect('7. 退订后不再收到状态', seen.length === 1, JSON.stringify(seen));
  }

  // ── 8. setUnsupported（dev / 未打包 / 依赖缺失）────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    u.setUnsupported('开发模式不检查更新');
    const st = u.getState() as { kind: string; reason: string };
    expect('8. setUnsupported → unsupported', st.kind === 'unsupported', JSON.stringify(st));
    expect('8b. unsupported 带原因', st.reason.includes('开发模式'), JSON.stringify(st));
  }

  // ── 9. 多个订阅者都收到 ────────────────────────────────────────
  {
    const bridge = makeBridge();
    const u = createUpdater(bridge);
    const a: string[] = [];
    const b: string[] = [];
    u.subscribe((s: UpdateState) => a.push(s.kind));
    u.subscribe((s: UpdateState) => b.push(s.kind));
    bridge.emit('available', { version: '1.0.1' });
    expect('9. 多个订阅者都收到事件', a.length === 2 && b.length === 2, `${a.length}/${b.length}`);
  }

  // ── 11. 适配层：electron-updater 的事件名/载荷 → 我们的形状 ────
  {
    const handlers = new Map<string, (arg: unknown) => void>();
    const calls = { install: [] as unknown[][] };
    const auto = {
      async checkForUpdates() {
        return undefined;
      },
      on(event: string, cb: (arg: unknown) => void) {
        handlers.set(event, cb);
      },
      quitAndInstall(...args: unknown[]) {
        calls.install.push(args);
      },
    };
    const bridge = createElectronUpdaterBridge(auto);
    const u = createUpdater(bridge);

    // ⚠️ **别再订阅一次** `available` —— 那会把 createUpdater 内部注册的
    //    同一个 electron 事件 handler 覆盖掉（Map.set）⇒ 状态机收不到事件。
    expect(
      '11a. createUpdater 内部已经注册了 electron 的 update-available',
      handlers.has('update-available'),
      [...handlers.keys()].join(','),
    );

    // update-available 的载荷（{version, releaseNotes}）→ {version, notes}
    handlers.get('update-available')!({ version: '2.0.0', releaseNotes: 'notes here' });
    expect(
      '11b. releaseNotes 被规整成 notes',
      (u.getState() as { notes?: string }).notes === 'notes here',
      JSON.stringify(u.getState()),
    );

    // download-progress 的 percent 是 0..1 的小数
    handlers.get('download-progress')!({ percent: 0.25 });
    expect(
      '11c. download-progress → downloading 25%',
      (u.getState() as { percent?: number }).percent === 25,
      JSON.stringify(u.getState()),
    );

    // error 载荷可能是 Error 对象
    handlers.get('error')!(new Error('boom'));
    expect(
      '11d. error 载荷是 Error 对象也能取到 message',
      (u.getState() as { message?: string }).message === 'boom',
      JSON.stringify(u.getState()),
    );

    u.install();
    expect(
      '11e. install → quitAndInstall(true, true)（静默 + 装完重开）',
      calls.install.length === 1 && calls.install[0][0] === true && calls.install[0][1] === true,
      JSON.stringify(calls.install),
    );
  }

  // ── 12. 加载不到 electron-updater ⇒ null（App 照常启动）────────
  {
    expect(
      '12. loader 抛错 ⇒ null（缺依赖不炸）',
      loadElectronUpdater(() => {
        throw new Error('Cannot find module electron-updater');
      }) === null,
    );
    expect('12b. 加载到的模块没有 autoUpdater ⇒ null', loadElectronUpdater(() => ({})) === null);
    const fake = {
      checkForUpdates: async () => undefined,
      on: () => undefined,
      quitAndInstall: () => undefined,
    };
    expect(
      '12c. 加载到 autoUpdater ⇒ 返回它',
      loadElectronUpdater(() => ({ autoUpdater: fake })) === fake,
    );
    expect(
      '12d. 模块直接导出 autoUpdater（没有 autoUpdater 包装）也能用',
      loadElectronUpdater(() => fake) === fake,
    );
  }

  console.log(`\n🎉 updater.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ updater.test 失败:', e);
  process.exit(1);
});
