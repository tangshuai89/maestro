import type { TrayCommand } from './preload';

/**
 * 全局热键（App **不在前台**也能控制播放）。
 *
 * ## ⚠️ 媒体键**不能**注册成全局热键 —— 这是本文件最重要的一条约束
 *
 * Electron 在 macOS 上把媒体键实现成 `globalShortcut`，走的是**同一条**
 * remote command center 通道（就是 `MPNowPlayingInfoCenter` 那条）。
 * **一旦注册，就会占住通道并关掉 Chromium 自己的媒体键处理** → 页面的
 * `navigator.mediaSession` 再也收不到 `seek` 等远程命令。
 *
 * ⇒ 媒体键**只走 `navigator.mediaSession` 一条路**（见
 * `packages/renderer/src/hooks/useMediaSession.ts`）。
 * 两套都注册 = 互相打架，症状是"媒体键有时双触发、有时完全失灵"。
 *
 * 这个约束**由代码守住**（`registerGlobalShortcuts` 会拒绝媒体键），不只靠
 * 约定 —— 单测里有一条专门的守卫用例。
 *
 * ## 修饰键为什么是 `Control+Option`（⌃⌥）
 *
 * App **内部**已经有 `⌘⇧M` / `⌘⇧D` / `⌘⇧L` 三个快捷键（mini / 桌面歌词 /
 * lite）。全局热键如果也用 `⌘⇧`，App 聚焦时**两个 handler 会同时触发**
 * （全局的和 App 内的）→ 切两次 = 白切。
 *
 * `⌃⌥` 是 macOS 惯例的**应用级全局热键**修饰键，和 App 内的 `⌘⇧` 不撞。
 */

/** Electron `globalShortcut` 的子集（注入进来，便于单测）。 */
export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
  isRegistered(accelerator: string): boolean;
}

export interface GlobalShortcutDeps {
  /** electron 的 `globalShortcut` */
  globalShortcut: GlobalShortcutApi;
  /** 发播放命令给 renderer —— 复用托盘那条 `tray:command` 通道 */
  sendCommand: (command: TrayCommand) => void;
  /**
   * 桌面歌词浮窗开关。**主进程拥有这个窗口**（`DesktopLyricsController`），
   * 所以这里直接调 controller，不绕 renderer；切换后 main 会把新状态
   * 通过既有的 `desktop-lyrics:changed` 通道推给 renderer → UI 自动同步。
   */
  toggleDesktopLyrics: () => void;
  /** 注册失败 / 冲突时的告警出口（默认静默） */
  warn?: (message: string) => void;
}

/**
 * **禁止注册**的媒体键清单。
 *
 * 见文件头：注册它们会关掉 Chromium 自己的媒体键处理。
 */
export const FORBIDDEN_MEDIA_KEYS = [
  'MediaPlayPause',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'MediaRewind',
  'MediaFastForward',
] as const;

/** 一条快捷键 = 一个 accelerator + 一个动作。 */
export interface ShortcutSpec {
  accelerator: string;
  /** 说明（注册失败时打日志用） */
  label: string;
  run: (deps: GlobalShortcutDeps) => void;
}

/**
 * **Electron 认的修饰键**（见 Electron 文档的 `Accelerator` 段）。
 *
 * ⚠️ 这些是 **accelerator 串**里的名字，不是 `KeyboardEvent.key`。
 *    `KeyboardEvent.key` 用的是 DOM 名字（`ArrowRight`），accelerator 用的是
 *    Electron 自己的名字（`Right`）—— **混用会让 `register` 直接抛异常**。
 */
const VALID_MODIFIERS = new Set([
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'CommandOrControl',
  'CmdOrCtrl',
  'Alt',
  'Option',
  'AltGr',
  'Shift',
  'Super',
  'Meta',
]);

/**
 * **Electron 认的主键**。
 *
 * ⚠️ 方向键是 `Up` / `Down` / `Left` / `Right`（**不是** `ArrowUp` 等）。
 */
const VALID_KEYS = new Set([
  ...'0123456789'.split(''),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Esc',
  'VolumeUp',
  'VolumeDown',
  'VolumeMute',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'MediaPlayPause',
  'PrintScreen',
  ...Array.from({ length: 10 }, (_, i) => `num${i}`),
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
]);

/**
 * 这个 accelerator 串 Electron 认不认？
 *
 * ## 为什么需要这个函数（2026-10-26 实测）
 *
 * `globalShortcut.register` 遇到**认不出的 accelerator** 是**抛异常**，不是
 * 返回 false：
 *
 *     TypeError: Error processing argument at index 0, conversion failure from
 *     Control+Option+ArrowRight
 *
 * 而注册发生在主进程的 async 上下文里 → **未捕获的 promise rejection** →
 * **主进程直接挂掉**（症状：`npm run dev` 起不来，App 一启动就崩，
 * "Network service crashed or was terminated"）。
 *
 * ⇒ 光靠 `register` 的返回值（false = 注册失败）**兜不住**这种错 ——
 *    得在**调用之前**就拦住（这里），并且调用本身还要 try/catch（双保险）。
 *
 * 真正的根因是**键名写错**：accelerator 用的是 Electron 的名字
 * （`Right` / `Left` / `Up` / `Down`），不是 DOM 的 `KeyboardEvent.key`
 * （`ArrowRight` / …）。这个白名单就是把那两类名字挡在外面。
 */
export function isValidAccelerator(accelerator: string): boolean {
  if (!accelerator) return false;
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!VALID_KEYS.has(key)) return false;
  return modifiers.every((m) => VALID_MODIFIERS.has(m));
}

/**
 * 快捷键表（第一版，固定一组，不做配置 UI）。
 *
 * 全部用 `⌃⌥`（Control+Option）—— 与 App 内的 `⌘⇧` 系列不撞。
 *
 * ⚠️ 方向键写的是 **`Right` / `Left` / `Up` / `Down`**（Electron 的名字），
 *    **不是** `ArrowRight` 等 DOM 名字 —— 后者会让 `register` 抛异常，
 *    在主进程里变成未捕获 rejection ⇒ App 起不来（2026-10-26 实测）。
 */
export const GLOBAL_SHORTCUTS: ShortcutSpec[] = [
  {
    accelerator: 'Control+Option+Space',
    label: '播放 / 暂停',
    run: (d) => d.sendCommand('playpause'),
  },
  {
    accelerator: 'Control+Option+Right',
    label: '下一首',
    run: (d) => d.sendCommand('next'),
  },
  {
    accelerator: 'Control+Option+Left',
    label: '上一首',
    run: (d) => d.sendCommand('prev'),
  },
  {
    accelerator: 'Control+Option+Up',
    label: '音量 +5%',
    run: (d) => d.sendCommand('volumeup'),
  },
  {
    accelerator: 'Control+Option+Down',
    label: '音量 −5%',
    run: (d) => d.sendCommand('volumedown'),
  },
  {
    accelerator: 'Control+Option+D',
    label: '桌面歌词浮窗开关',
    run: (d) => d.toggleDesktopLyrics(),
  },
];

/**
 * 注册全部全局热键。
 *
 * @returns 实际注册成功的 accelerator 列表（用于退出时注销）
 */
export function registerGlobalShortcuts(deps: GlobalShortcutDeps): string[] {
  const registered: string[] = [];
  // 防御：electron 没这个 API（或测试替身没实现）→ 直接不注册，别让 App 起不来。
  if (!deps.globalShortcut || typeof deps.globalShortcut.register !== 'function') {
    deps.warn?.('globalShortcut 不可用，跳过全局热键注册');
    return registered;
  }
  for (const spec of GLOBAL_SHORTCUTS) {
    // 🛡️ 守卫 1：媒体键一律拒绝（见文件头的约束说明）。
    if ((FORBIDDEN_MEDIA_KEYS as readonly string[]).includes(spec.accelerator)) {
      deps.warn?.(
        `跳过 ${spec.accelerator}（${spec.label}）：媒体键归 navigator.mediaSession，` +
          `注册成 globalShortcut 会关掉 Chromium 自己的媒体键处理`,
      );
      continue;
    }
    // 守卫 2：已被别的 App / 本进程占用 → 跳过，不覆盖。
    if (deps.globalShortcut.isRegistered(spec.accelerator)) {
      deps.warn?.(`跳过 ${spec.accelerator}（${spec.label}）：已被占用`);
      continue;
    }
    // 守卫 3：accelerator 必须是 Electron 认的格式。
    //
    // ⚠️ **必须在调用之前拦**：Electron 对认不出的 accelerator 是**抛异常**
    // （"conversion failure from ..."），而这里在主进程的 async 上下文里 →
    // 未捕获 rejection → **主进程挂掉**（2026-10-26 实测：`npm run dev` 起不来）。
    if (!isValidAccelerator(spec.accelerator)) {
      deps.warn?.(
        `跳过 ${spec.accelerator}（${spec.label}）：不是合法的 Electron accelerator` +
          `（方向键用 Right/Left/Up/Down，不是 ArrowRight/…）`,
      );
      continue;
    }
    // 双保险：就算白名单漏了某种写法，Electron 抛的异常也不能掀翻主进程。
    let ok = false;
    try {
      ok = deps.globalShortcut.register(spec.accelerator, () => spec.run(deps));
    } catch (e) {
      deps.warn?.(
        `快捷键 ${spec.accelerator}（${spec.label}）注册抛错：${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      continue;
    }
    if (ok) {
      registered.push(spec.accelerator);
    } else {
      deps.warn?.(`快捷键 ${spec.accelerator}（${spec.label}）注册失败`);
    }
  }
  return registered;
}

/** 注销已注册的全局热键。 */
export function unregisterGlobalShortcuts(
  deps: Pick<GlobalShortcutDeps, 'globalShortcut'>,
  registered: string[],
): void {
  for (const accelerator of registered) {
    try {
      deps.globalShortcut.unregister(accelerator);
    } catch {
      // 退出期注销失败无所谓
    }
  }
}
