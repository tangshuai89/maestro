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
 * 快捷键表（第一版，固定一组，不做配置 UI）。
 *
 * 全部用 `⌃⌥`（Control+Option）—— 与 App 内的 `⌘⇧` 系列不撞。
 */
export const GLOBAL_SHORTCUTS: ShortcutSpec[] = [
  {
    accelerator: 'Control+Option+Space',
    label: '播放 / 暂停',
    run: (d) => d.sendCommand('playpause'),
  },
  {
    accelerator: 'Control+Option+ArrowRight',
    label: '下一首',
    run: (d) => d.sendCommand('next'),
  },
  {
    accelerator: 'Control+Option+ArrowLeft',
    label: '上一首',
    run: (d) => d.sendCommand('prev'),
  },
  {
    accelerator: 'Control+Option+ArrowUp',
    label: '音量 +5%',
    run: (d) => d.sendCommand('volumeup'),
  },
  {
    accelerator: 'Control+Option+ArrowDown',
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
    const ok = deps.globalShortcut.register(spec.accelerator, () => spec.run(deps));
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
