/**
 * App 内快捷键的**单一事实源**（specs/shortcut-cheatsheet/）。
 *
 * ## 为什么要有这个文件
 *
 * 快捷键之前散在 `App.tsx` 的三个 `keydown` effect 里（`⌘⇧M` / `⌘⇧L` /
 * `⌘⇧D` / `Space` / `Esc`），每个都是手写的
 * `if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm')`。
 * ⇒ 想做一个「快捷键速查面板」给用户看，就必须**把同一批键位抄第二遍** ——
 * 抄的那份迟早和实现漂移（改了实现忘了改面板 → 面板骗用户）。
 *
 * 所以这里把**键位判定**和**展示文案**放在一起：
 *  - `APP_SHORTCUTS` = 定义表（判定条件 + 描述 + 分组）
 *  - `matchesShortcut(e, def)` = 唯一的判定实现
 *  - `App.tsx` 的 keydown **调用** `matchesShortcut`（不再手写条件）
 *  - 快捷键面板**渲染** `APP_SHORTCUTS`（不再手抄一遍）
 *
 * ⇒ 面板和实现**物理上不可能漂移**：改键位只改这张表一处。
 *
 * ## 全局热键不在这里
 *
 * 全局热键（`⌃⌥Space` 等，App **不在前台**也能用）的真源在
 * `packages/electron/src/global-shortcuts.ts`（主进程），renderer 拿不到
 * 那个模块 → 走一条只读 IPC 通道 `shortcuts:global` 拉真实列表。
 * **不在这里复制一份** —— 复制 = 迟早漂移。
 */

/** 面板里的分组。 */
export type ShortcutGroup = '播放' | '界面' | '桌面';

/** 快捷键的判定条件（`KeyboardEvent` 视角）。 */
export interface ShortcutMatch {
  /**
   * 目标键（小写）。空格用 `' '`；`Escape` 用 `'escape'`。
   * 字母不区分大小写（`e.key.toLowerCase()`）。
   */
  key: string;
  /** 需要 ⌘（macOS）或 Ctrl（其它平台）—— 二选一即可。 */
  metaOrCtrl?: boolean;
  /** 需要 ⇧ Shift */
  shift?: boolean;
  /** 需要 ⌃ Control */
  ctrl?: boolean;
  /** 需要 ⌥ Alt */
  alt?: boolean;
}

export interface AppShortcut {
  /** 稳定 id（App.tsx 按 id 取定义，面板按 id 做 key） */
  id: string;
  /** 展示用键位串（macOS 符号） */
  keys: string;
  /** 判定条件 */
  match: ShortcutMatch;
  /** 面板上显示的一句话说明 */
  label: string;
  /** 分组 */
  group: ShortcutGroup;
  /**
   * 生效范围：
   *  - `'all'`：任何模式都生效
   *  - `'lite'`：**只在极简（lite）模式**生效
   */
  modes: 'all' | 'lite';
  /** 面板上的补充说明（可选） */
  note?: string;
}

/**
 * App 内快捷键定义表。
 *
 * ⚠️ **顺序即面板展示顺序**（按分组 → 组内按重要性）。
 */
export const APP_SHORTCUTS: AppShortcut[] = [
  {
    id: 'toggle-mini',
    keys: '⌘⇧M',
    match: { key: 'm', metaOrCtrl: true, shift: true },
    label: '迷你 / 完整界面切换',
    group: '界面',
    modes: 'all',
  },
  {
    id: 'toggle-lite',
    keys: '⌘⇧L',
    match: { key: 'l', metaOrCtrl: true, shift: true },
    label: '极简 / 完整界面切换',
    group: '界面',
    modes: 'all',
  },
  {
    id: 'exit-lite',
    keys: 'Esc',
    match: { key: 'escape' },
    label: '退出极简模式，回到完整界面',
    group: '界面',
    modes: 'lite',
  },
  {
    id: 'play-pause',
    keys: 'Space',
    match: { key: ' ' },
    label: '播放 / 暂停',
    group: '播放',
    modes: 'lite',
    note: '仅极简模式；焦点在输入框里时不生效（空格要用来打字）',
  },
  {
    id: 'toggle-desktop-lyrics',
    keys: '⌘⇧D',
    match: { key: 'd', metaOrCtrl: true, shift: true },
    label: '桌面歌词浮窗开关',
    group: '桌面',
    modes: 'all',
  },
];

/** 按 id 取定义（App.tsx 用）。 */
export const APP_SHORTCUT_BY_ID: Record<string, AppShortcut> = Object.fromEntries(
  APP_SHORTCUTS.map((s) => [s.id, s]),
);

/**
 * 判定一个 KeyboardEvent 是否命中某条快捷键。
 *
 * ⚠️ **只判键位** —— 「当前模式是否生效」「焦点是否在输入框」这些是
 * **上下文守卫**，由调用方在匹配**之后**再判（`App.tsx` 里就是这么做的）。
 * 把上下文塞进这个函数会让它没法单独测。
 */
export function matchesShortcut(e: KeyboardEvent, s: AppShortcut): boolean {
  const m = s.match;
  // 空格：有些布局下 `e.key` 是 ' '，有些是 'Space'（code 才是稳的）。
  if (m.key === ' ') {
    if (e.code !== 'Space' && e.key !== ' ') return false;
  } else if (e.key.toLowerCase() !== m.key) {
    return false;
  }
  if (m.metaOrCtrl && !(e.metaKey || e.ctrlKey)) return false;
  if (m.shift && !e.shiftKey) return false;
  if (m.ctrl && !e.ctrlKey) return false;
  if (m.alt && !e.altKey) return false;
  return true;
}

/** 面板分组顺序。 */
export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = ['播放', '界面', '桌面'];

/**
 * 把 Electron 的 accelerator 串转成 macOS 符号（展示用）。
 *
 * 例：`Control+Option+Right` → `⌃⌥→`。
 *
 * ⚠️ 这是**纯展示**的格式化（accelerator 本身还是 Electron 的格式），
 * 不是键位判定 —— 判定永远走 `matchesShortcut`。
 *
 * ⚠️ 方向键在 accelerator 里是 `Right` / `Left` / `Up` / `Down`
 *    （Electron 的名字，不是 DOM 的 `ArrowRight`）。两个都留着：
 *    旧串（万一别处还传）也能正常显示。
 */
export function formatAccelerator(accelerator: string): string {
  const map: Record<string, string> = {
    Control: '⌃',
    ControlOrCommand: '⌘',
    CommandOrControl: '⌘',
    CmdOrCtrl: '⌘',
    Command: '⌘',
    Cmd: '⌘',
    Option: '⌥',
    Alt: '⌥',
    Shift: '⇧',
    Right: '→',
    Left: '←',
    Up: '↑',
    Down: '↓',
    ArrowRight: '→',
    ArrowLeft: '←',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Escape: 'Esc',
    Enter: '⏎',
  };
  return accelerator
    .split('+')
    .map((part) => map[part] ?? part)
    .join('');
}

/** 按分组归拢（保持 `APP_SHORTCUTS` 的组内顺序）。 */
export function groupShortcuts(
  list: AppShortcut[] = APP_SHORTCUTS,
): Array<{ group: ShortcutGroup; items: AppShortcut[] }> {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    items: list.filter((s) => s.group === group),
  })).filter((g) => g.items.length > 0);
}
