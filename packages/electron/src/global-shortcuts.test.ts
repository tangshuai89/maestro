/**
 * `global-shortcuts` 单测 —— 全局热键（App 不在前台也能控制播放）。
 *
 * ## 这个测试守的是什么
 *
 * ① **没有注册任何媒体键** —— 这是最重要的一条。媒体键归
 *    `navigator.mediaSession`；注册成 `globalShortcut` 会关掉 Chromium 自己的
 *    媒体键处理 → 媒体键表现为"有时双触发、有时失灵"。
 *    ⇒ 这条**由代码里的守卫 + 这条用例**双重守住。
 * ② 注册了**哪几个** accelerator（清单断言）—— 防止手滑多注册/写错。
 * ③ 触发 → 发出**正确的命令**（不是"注册了就算"）。
 * ④ 退出 → 全部注销。
 *
 * Run: npx ts-node packages/electron/src/global-shortcuts.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  GLOBAL_SHORTCUTS,
  FORBIDDEN_MEDIA_KEYS,
  registerGlobalShortcuts,
  unregisterGlobalShortcuts,
} = require('./global-shortcuts');

/** 假 globalShortcut：记录注册表，测试直接触发回调。 */
function makeFakeShortcutApi() {
  const registered = new Map<string, () => void>();
  const api = {
    registered,
    register(accelerator: string, callback: () => void): boolean {
      registered.set(accelerator, callback);
      return true;
    },
    unregister(accelerator: string): void {
      registered.delete(accelerator);
    },
    unregisterAll(): void {
      registered.clear();
    },
    isRegistered(accelerator: string): boolean {
      return registered.has(accelerator);
    },
  };
  return api;
}

function makeDeps() {
  const globalShortcut = makeFakeShortcutApi();
  const sent: string[] = [];
  let lyricsToggles = 0;
  const warnings: string[] = [];
  const deps = {
    globalShortcut,
    sendCommand: (command: string) => {
      sent.push(command);
    },
    toggleDesktopLyrics: () => {
      lyricsToggles++;
    },
    warn: (m: string) => {
      warnings.push(m);
    },
  };
  return { deps, sent, globalShortcut, warnings, lyricsToggles: () => lyricsToggles };
}

function main() {
  // ── 1. 注册清单：正好 6 条，且不含任何媒体键 ────────────────────
  {
    const { deps, globalShortcut, warnings } = makeDeps();
    const registered = registerGlobalShortcuts(deps);

    assert.strictEqual(registered.length, 6, `应注册 6 条，实际 ${registered.length}`);
    assert.deepStrictEqual(
      registered.sort(),
      [
        'Control+Option+ArrowDown',
        'Control+Option+ArrowLeft',
        'Control+Option+ArrowRight',
        'Control+Option+ArrowUp',
        'Control+Option+D',
        'Control+Option+Space',
      ],
      '注册的 accelerator 清单与预期不符',
    );
    assert.strictEqual(globalShortcut.registered.size, 6, '注册表里应有 6 条');
    assert.strictEqual(warnings.length, 0, `不该有告警，实际：${warnings.join(' | ')}`);
    console.log('✅ 1. 注册了 6 条全局热键，清单与预期一致');
  }

  // ── 2. 🛡️ 守卫：**一个媒体键都不能注册** ────────────────────────
  {
    const { deps, globalShortcut } = makeDeps();
    registerGlobalShortcuts(deps);
    for (const accel of globalShortcut.registered.keys()) {
      assert.ok(
        !(FORBIDDEN_MEDIA_KEYS as readonly string[]).includes(accel),
        `注册了媒体键 ${accel} —— 会关掉 Chromium 自己的媒体键处理`,
      );
    }
    // 反向再验一次：把清单里的某条换成媒体键 → 必须被代码里的守卫挡掉
    const orig = GLOBAL_SHORTCUTS[0].accelerator;
    GLOBAL_SHORTCUTS[0].accelerator = 'MediaPlayPause';
    try {
      const d2 = makeDeps();
      const reg2 = registerGlobalShortcuts(d2.deps);
      assert.ok(!reg2.includes('MediaPlayPause'), '守卫失效：媒体键被注册了');
      assert.ok(
        d2.warnings.some((w: string) => w.includes('MediaPlayPause')),
        '守卫应该给出告警说明为什么跳过',
      );
      assert.ok(!d2.globalShortcut.registered.has('MediaPlayPause'), '媒体键不应该出现在注册表里');
    } finally {
      GLOBAL_SHORTCUTS[0].accelerator = orig;
    }
    console.log('✅ 2. 🛡️ 媒体键零注册，且守卫会挡下试图注册媒体键的改动');
  }

  // ── 3. 触发 → 发出正确的命令 ───────────────────────────────────
  {
    const { deps, globalShortcut, sent } = makeDeps();
    registerGlobalShortcuts(deps);
    const fire = (accel: string) => {
      const cb = globalShortcut.registered.get(accel);
      assert.ok(cb, `快捷键没注册：${accel}`);
      cb!();
    };

    fire('Control+Option+Space');
    fire('Control+Option+ArrowRight');
    fire('Control+Option+ArrowLeft');
    fire('Control+Option+ArrowUp');
    fire('Control+Option+ArrowDown');
    assert.deepStrictEqual(
      sent,
      ['playpause', 'next', 'prev', 'volumeup', 'volumedown'],
      '发出的命令与预期不符',
    );
    console.log('✅ 3. 5 条播放快捷键发出正确命令');
  }

  // ── 4. 桌面歌词开关 → 调 toggleDesktopLyrics ───────────────────
  {
    const { deps, globalShortcut, lyricsToggles } = makeDeps();
    registerGlobalShortcuts(deps);
    globalShortcut.registered.get('Control+Option+D')!();
    assert.strictEqual(lyricsToggles(), 1, '桌面歌词开关应被调用一次');
    console.log('✅ 4. 桌面歌词快捷键直接调主进程的 controller');
  }

  // ── 5. 退出 → 全部注销 ──────────────────────────────────────────
  {
    const { deps, globalShortcut } = makeDeps();
    const registered = registerGlobalShortcuts(deps);
    unregisterGlobalShortcuts(deps, registered);
    assert.strictEqual(globalShortcut.registered.size, 0, '退出后应全部注销');
    console.log('✅ 5. 退出时全部注销');
  }

  // ── 6. 已被占用的快捷键 → 跳过（不覆盖别人的） ──────────────────
  {
    const { deps, globalShortcut, warnings, sent } = makeDeps();
    globalShortcut.register('Control+Option+Space', () => {});
    const registered = registerGlobalShortcuts(deps);
    assert.ok(!registered.includes('Control+Option+Space'), '已被占用的快捷键不该被注册');
    assert.ok(
      warnings.some((w: string) => w.includes('已被占用')),
      '应该提示「已被占用」',
    );
    assert.strictEqual(sent.length, 0, '被跳过的快捷键不该发命令');
    console.log('✅ 6. 已被占用的快捷键被跳过并告警');
  }

  console.log('\n🎉 global-shortcuts.test 全部 6 项通过');
}

main();
