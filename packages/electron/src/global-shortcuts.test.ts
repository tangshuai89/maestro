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
  isValidAccelerator,
} = require('./global-shortcuts');

/**
 * 假 globalShortcut：记录注册表，测试直接触发回调。
 *
 * ⚠️ **它必须模仿 electron 的真实行为**：认不出的 accelerator 是**抛异常**，
 *    不是返回 false。
 *
 *    真实 electron：`TypeError: Error processing argument at index 0,
 *    conversion failure from Control+Option+ArrowRight`
 *
 *    之前的替身「什么都收」→ 2026-10-26 之前的一版把方向键写成了 DOM 的
 *    `ArrowRight`（electron 根本不认）→ 注册时抛异常 → 主进程里未捕获
 *    rejection → **App 起不来**，而单测一直是绿的。
 *
 *    ⇒ 替身现在按 `isValidAccelerator` 判：**非法就抛**。
 *    这条测试因此能守住「accelerator 必须是 electron 认的写法」。
 */
function makeFakeShortcutApi() {
  const registered = new Map<string, () => void>();
  const api = {
    registered,
    register(accelerator: string, callback: () => void): boolean {
      if (!isValidAccelerator(accelerator)) {
        throw new TypeError(
          `Error processing argument at index 0, conversion failure from ${accelerator}`,
        );
      }
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
        'Control+Option+D',
        'Control+Option+Down',
        'Control+Option+Left',
        'Control+Option+Right',
        'Control+Option+Space',
        'Control+Option+Up',
      ],
      '注册的 accelerator 清单与预期不符',
    );
    assert.strictEqual(globalShortcut.registered.size, 6, '注册表里应有 6 条');
    assert.strictEqual(warnings.length, 0, `不该有告警，实际：${warnings.join(' | ')}`);
    console.log('✅ 1. 注册了 6 条全局热键，清单与预期一致');
  }

  // ── 1b. 🛡️ 每个 accelerator 都必须是 electron 认的写法 ──────────
  //
  // 2026-10-26 实测的坑：方向键写成了 DOM 的 `ArrowRight`（electron 认的是
  // `Right`）→ `register` 抛异常 → 主进程未捕获 rejection → **App 起不来**。
  // 这条用例把「键名写错」当场挡住（假替身会像 electron 一样抛）。
  {
    for (const spec of GLOBAL_SHORTCUTS) {
      assert.ok(
        isValidAccelerator(spec.accelerator),
        `accelerator 不是 electron 认的写法：${spec.accelerator}（${spec.label}）`,
      );
    }
    // 反向验一次：DOM 的方向键名必须被判非法
    for (const bad of [
      'Control+Option+ArrowRight',
      'Control+Option+ArrowLeft',
      'Control+Option+ArrowUp',
      'Control+Option+ArrowDown',
    ]) {
      assert.ok(
        !isValidAccelerator(bad),
        `${bad} 应该被判为非法（electron 认的是 Right/Left/Up/Down）`,
      );
    }
    console.log('✅ 1b. 全部 accelerator 都是合法写法；DOM 的 Arrow* 名字被判非法');
  }

  // ── 1c. 🛡️ 非法 accelerator 只能被**跳过**，不能掀翻主进程 ────────
  {
    const { deps, globalShortcut, warnings } = makeDeps();
    // 把其中一条换成 electron 不认的写法（模拟手滑 / 未来改坏）
    const orig = GLOBAL_SHORTCUTS[1].accelerator;
    GLOBAL_SHORTCUTS[1].accelerator = 'Control+Option+ArrowRight';
    try {
      const registered = registerGlobalShortcuts(deps);
      assert.ok(
        !registered.includes('Control+Option+ArrowRight'),
        '非法 accelerator 不该出现在已注册清单里',
      );
      assert.ok(
        warnings.some((w: string) => w.includes('ArrowRight')),
        '跳过非法 accelerator 时应该给出告警',
      );
      // 其余 5 条照常注册 —— 一条坏的不该拖垮全部
      assert.strictEqual(registered.length, 5, `其余 5 条应照常注册，实际 ${registered.length}`);
    } finally {
      GLOBAL_SHORTCUTS[1].accelerator = orig;
    }
    console.log('✅ 1c. 非法 accelerator 被跳过 + 告警，其余热键照常注册（不掀翻主进程）');
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
    fire('Control+Option+Right');
    fire('Control+Option+Left');
    fire('Control+Option+Up');
    fire('Control+Option+Down');
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

  // ── 7. 注册**失败**（register 返回 false）→ 跳过 + 告警 ─────────
  {
    const { deps, globalShortcut, warnings } = makeDeps();
    globalShortcut.register = (): boolean => false; // 模拟注册失败
    const registered = registerGlobalShortcuts(deps);
    assert.strictEqual(registered.length, 0, '注册失败的快捷键不该算成功');
    assert.strictEqual(globalShortcut.registered.size, 0, '注册表应为空');
    assert.ok(
      warnings.some((w: string) => w.includes('注册失败')),
      '应该提示「注册失败」',
    );
    console.log('✅ 7. 注册失败 → 跳过并告警');
  }

  // ── 8. 注销时抛错 → 吞掉（退出期注销失败无所谓）─────────────────
  {
    const { deps, globalShortcut } = makeDeps();
    const registered = registerGlobalShortcuts(deps);
    globalShortcut.unregister = (): void => {
      throw new Error('boom');
    };
    // 不该抛出去 —— 退出路径不能因为注销失败而崩
    unregisterGlobalShortcuts(deps, registered);
    console.log('✅ 8. 注销抛错被吞掉（退出路径不崩）');
  }

  console.log('\n🎉 global-shortcuts.test 全部 8 项通过');
}

main();
