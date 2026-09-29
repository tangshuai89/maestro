/**
 * ipc-contract.test.ts — 桌面歌词浮窗的 IPC 契约 + 解锁入口的**文本级**回归防护。
 *
 * 为什么需要这类"读源码"的测试：
 *   IPC 通道名拼错**不会报任何错**，只会静默失效（`ipcRenderer.send('x')`
 *   发到一个没人 `ipcMain.on('x')` 的频道，什么都不发生）。typecheck 与
 *   单元测试都覆盖不到——controller 的测试用的是直接调方法，绕过了通道名。
 *   这正是 P3 最大的盲区：7 个通道当时全靠人眼逐个核对。
 *
 * 同时守一条产品不变量：**锁定态必须存在浮窗之外的解锁出口**（Tray）。
 * 2026-09-28 修过一次真实事故——锁定后浮窗把自己的齿轮藏了，设置面板
 * 打不开，而 `locked` 又持久化到 userData/desktop-lyrics.json，导致用户
 * 退出重开依然解不开，只能 Cmd+Q。这条测试就是为了不让它再退化回去。
 *
 * Run: npx ts-node packages/electron/src/desktop-lyrics/ipc-contract.test.ts
 */
export {};
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// __dirname = packages/electron/src/desktop-lyrics → 上溯两级到 packages/electron
const ROOT = join(__dirname, '..', '..');
const mainSrc = readFileSync(join(ROOT, 'src', 'main.ts'), 'utf8');
const preloadSrc = readFileSync(join(ROOT, 'src', 'preload.ts'), 'utf8');
const controllerSrc = readFileSync(
  join(ROOT, 'src', 'desktop-lyrics', 'desktop-lyrics-controller.ts'),
  'utf8',
);

/**
 * IPC 有两个方向，**必须分开校验**（第一版把两边混在一起，误报了 3 条）：
 *   renderer → main：preload `send` / `invoke`，main 必须 `ipcMain.on` / `handle`
 *   main → renderer：preload `on`，main 必须 `webContents.send`（不注册！）
 */
function matchAll(src: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** main 侧注册的命令通道（renderer 能打进来的）。 */
function mainHandlers(): Set<string> {
  return new Set(matchAll(mainSrc, /ipcMain\.(?:on|handle)\(\s*'([^']+)'/g));
}

/**
 * main 侧推给 renderer 的通道。
 *
 * 来源有两处，都要扫：main.ts 里的 `webContents.send`（如 changed），
 * 以及 controller.ts 里的（开窗补发首帧 state / broadcastPrefs 的 overlay:prefs
 * —— 后者走 OVERLAY_PREFS_CHANNEL 常量，字面量不在 main.ts 里）。
 */
function mainSends(): Set<string> {
  return new Set(
    matchAll(mainSrc, /webContents\.send\(\s*'([^']+)'/g)
      .concat(matchAll(controllerSrc, /webContents\.send\(\s*'([^']+)'/g))
      .concat(
        matchAll(controllerSrc, /OVERLAY_PREFS_CHANNEL\s*=\s*'([^']+)'/g),
      ),
  );
}

/** preload 侧：发给 main 的（send / invoke）。 */
function preloadSends(): Set<string> {
  return new Set(
    matchAll(preloadSrc, /ipcRenderer\.(?:send|invoke)\(\s*'([^']+)'/g),
  );
}

/** preload 侧：订阅 main 推的（on）。 */
function preloadOns(): Set<string> {
  return new Set(matchAll(preloadSrc, /ipcRenderer\.on\(\s*'([^']+)'/g));
}

const handlers = mainHandlers();
const sends = mainSends();
const pSends = preloadSends();
const pOns = preloadOns();

const DL = (xs: Set<string>) => [...xs].filter((c) => c.startsWith('desktop-lyrics:')).sort();
const DL_SEND = DL(pSends); // renderer → main
const DL_ON = DL(pOns); // main → renderer

function main() {
  let passed = 0;
  let failed = 0;
  function check(label: string, fn: () => void) {
    try {
      fn();
      console.log(`✅ ${label}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${label}\n   ${(err as Error).message}`);
      failed++;
    }
  }

  check('1. renderer→main：preload 的 send/invoke 通道 main 全部注册', () => {
    for (const ch of DL_SEND) {
      assert.ok(
        handlers.has(ch),
        `preload 发了 "${ch}"，但 main.ts 没有 ipcMain.on/handle 注册它 —— ` +
          `通道名拼错不会报错，只会静默失效`,
      );
    }
    assert.ok(DL_SEND.length >= 4, `preload 只发了 ${DL_SEND.length} 个通道，疑似漏抽`);
  });

  check('2. main→renderer：preload 的 on 通道 main 全部有 send', () => {
    for (const ch of DL_ON) {
      assert.ok(
        sends.has(ch),
        `preload 监听了 "${ch}"，但 main 侧既没有 webContents.send 也没有 ` +
          `对应常量 —— 订阅永远不会触发`,
      );
    }
    assert.ok(DL_ON.length >= 3, `preload 只监听 ${DL_ON.length} 个通道，疑似漏抽`);
  });

  check('3. OVERLAY_PREFS_CHANNEL 常量与 preload 字面量一致', () => {
    const m = controllerSrc.match(/OVERLAY_PREFS_CHANNEL\s*=\s*'([^']+)'/);
    assert.ok(m, 'controller 里找不到 OVERLAY_PREFS_CHANNEL 定义');
    assert.ok(
      preloadSrc.includes(m![1]),
      `preload 监听的通道字符串与 controller 常量 ${m![1]} 不一致`,
    );
  });

  check('4. 🔴 锁定态存在浮窗之外的解锁出口（Tray）', () => {
    // 浮窗内不可靠（锁定时齿轮被 CSS + 条件渲染藏掉），Tray 是常驻入口
    assert.ok(
      /label:\s*'桌面歌词 · 锁定位置'/.test(mainSrc),
      'main.ts 的 Tray 菜单里找不到「桌面歌词 · 锁定位置」——' +
        '锁定后浮窗自己打不开设置面板，删掉这一项就等于永久锁死用户',
    );
    assert.ok(
      /action:\s*'lock'/.test(mainSrc),
      'Tray 的锁定项必须调 handleOverlayControl({ action: "lock" })',
    );
    // 勾选态切换后要重建菜单，否则关掉再开还是旧状态
    const trayAnchor = "label: '桌面歌词 · 锁定位置'";
    const trayBlock = mainSrc.slice(
      mainSrc.indexOf(trayAnchor),
      mainSrc.indexOf(trayAnchor) + 900,
    );
    assert.ok(
      trayBlock.includes('refreshTray()'),
      '锁定项 click 里要调 refreshTray() 重建勾选态',
    );
  });

  check('5. 白名单边界清晰：通用 on() 受白名单约束，专用桥接不受', () => {
    // preload 有两条不同的订阅路径，别混为一谈：
    //   a) 通用 `on(channel, cb)` 桥接 → 走 SUBSCRIBABLE_CHANNELS 校验（安全边界）
    //   b) desktopLyrics.onState / onPrefs → 直接 ipcRenderer.on，不经白名单
    //      （刻意为之：这两个是固定用途的窄桥，不接受任意 channel）
    const m = preloadSrc.match(
      /SUBSCRIBABLE_CHANNELS = new Set\(\[([\s\S]*?)\]\)/,
    );
    assert.ok(m, 'preload.ts 找不到 SUBSCRIBABLE_CHANNELS = new Set([...])');
    const allowlist = m![1];
    assert.ok(
      allowlist.includes('desktop-lyrics:changed'),
      'desktop-lyrics:changed 走通用 on() 桥接，必须在白名单里',
    );
    // 白名单校验必须真的在 on() 入口里生效（否则等于没设防）
    assert.ok(
      /if \(!SUBSCRIBABLE_CHANNELS\.has\(channel\)\)/.test(preloadSrc),
      'preload 的通用 on() 桥接里找不到白名单校验',
    );
    // 专用桥接不受白名单约束 → 它们不应被误加进白名单（加了反而说明走错路径）
    for (const ch of ['desktop-lyrics:state', 'desktop-lyrics:overlay:prefs']) {
      assert.ok(
        !allowlist.includes(ch),
        `${ch} 是专用桥接，不该出现在通用白名单里` +
          `（真要收紧就把专用桥接改走白名单校验，而不是加白名单）`,
      );
    }
  });

  check('6. overlay 专属通道有 sender 校验（preload 是双窗口共用的）', () => {
    // preload 是主窗口和浮窗**共用**的同一份桥，主窗口的
    // `electronAPI.desktopLyrics.control()` 走完全一样的代码路径。不校验 sender
    // 就等于把「关掉 / 锁死用户浮窗」的权限开给任意 renderer。
    // 判据：每个 overlay:* 通道的 handler 里必须出现 fromOverlay(...) 守卫。
    for (const ch of ['overlay:control', 'overlay:hover']) {
      const re = new RegExp(
        `ipcMain\\.on\\(\\s*'desktop-lyrics:${ch}'[\\s\\S]{0,700}?if \\(!fromOverlay\\(event\\.sender\\)\\) return;`,
      );
      assert.ok(
        re.test(mainSrc),
        `desktop-lyrics:${ch} 的 handler 里没有 sender 守卫 —— ` +
          `主窗口也能发这条通道`,
      );
    }
    assert.ok(
      /isOverlaySender\(sender: unknown\)/.test(controllerSrc),
      'controller 里应提供 isOverlaySender 供 main 校验',
    );
  });

  console.log(
    `\n${failed === 0 ? '🎉' : '⚠️ '} ipc-contract.test: ${passed} passed, ${failed} failed` +
      `\n   （renderer→main ${DL_SEND.length} 个：${DL_SEND.join(', ')}）` +
        `\n   （main→renderer ${DL_ON.length} 个：${DL_ON.join(', ')}）`,
  );
  if (failed > 0) process.exit(1);
}

main();
