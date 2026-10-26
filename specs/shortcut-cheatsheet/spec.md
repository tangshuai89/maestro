# 快捷键速查面板

## 做什么

App 里已经有一堆快捷键，但**用户不知道它们存在** —— 只能靠"试出来"。

功能盘点里这条是 P3（成本 0.5 天）：`快捷键速查面板 · App 内有 3 处 keydown
监听 · 已经有快捷键了，但用户不知道有哪些`。

## 现状（实测，master `0bb5860`）

**App 内（renderer，3 个 `keydown` effect）**

| 键位    | 作用                                                | 位置      |
| ------- | --------------------------------------------------- | --------- |
| `⌘⇧M`   | 迷你 / 完整界面切换                                 | `App.tsx` |
| `⌘⇧L`   | 极简 / 完整界面切换                                 | `App.tsx` |
| `⌘⇧D`   | 桌面歌词浮窗开关                                    | `App.tsx` |
| `Space` | 播放 / 暂停（**仅极简模式**；焦点在输入框时不生效） | `App.tsx` |
| `Esc`   | 退出极简模式，回到完整界面（**仅极简模式**）        | `App.tsx` |

**全局热键（electron 主进程，App **不在前台**也能用，#128 落的）**

| 键位          | 作用             |
| ------------- | ---------------- |
| `⌃⌥Space`     | 播放 / 暂停      |
| `⌃⌥→` / `⌃⌥←` | 下一首 / 上一首  |
| `⌃⌥↑` / `⌃⌥↓` | 音量 ±5%         |
| `⌃⌥D`         | 桌面歌词浮窗开关 |

**媒体键**（耳机线控 / 键盘 / macOS 锁屏控制）走 `navigator.mediaSession`
（`useMediaSession.ts`）—— **不是** globalShortcut。

## 关键设计：两段真源，物理上不可能漂移

如果只是「把快捷键抄一份到面板里」，改实现忘了改面板 → **面板骗用户**。
所以：

| 段           | 真源                                                                     | 面板怎么拿到                     |
| ------------ | ------------------------------------------------------------------------ | -------------------------------- |
| App 内快捷键 | **新建** `packages/renderer/src/lib/shortcuts.ts` 的 `APP_SHORTCUTS`     | 直接 import（同进程）            |
| 全局热键     | 主进程 `packages/electron/src/global-shortcuts.ts` 的 `GLOBAL_SHORTCUTS` | 只读 IPC 通道 `shortcuts:global` |
| 媒体键       | `navigator.mediaSession`                                                 | 说明文字（不是键位表）           |

- `APP_SHORTCUTS` 每条带**判定条件**（`match`）+ 描述 + 分组。
- `matchesShortcut(e, def)` 是**唯一**的判定实现。
- **`App.tsx` 的 3 个 keydown 改成调 `matchesShortcut`**（不再手写
  `(e.metaKey||e.ctrlKey) && e.shiftKey && e.key.toLowerCase()==='m'`）。
- **面板渲染 `APP_SHORTCUTS`**（不再手抄一遍）。
- ⇒ 改键位只改这张表一处；面板和实现**不可能**漂移。

全局热键**不在 renderer 抄一份** —— 主进程那份才是真源，走 IPC 把**数据**递出去。

## 验收标准

- [ ] Titlebar 加「⌨ 快捷键」按钮 → 打开速查面板
- [ ] 面板分三段：App 内快捷键（按 播放/界面/桌面 分组）/ 全局热键 / 媒体键说明
- [ ] App 内快捷键的条目**等于** `APP_SHORTCUTS`（不多不少不少）
- [ ] 全局热键**从主进程拉取**（`window.electronAPI.getGlobalShortcuts()`），
      renderer 不硬编码；浏览器 dev（无 electronAPI）不崩并给说明
- [ ] `App.tsx` 的 3 处 keydown 判定**改用** `matchesShortcut`
- [ ] 媒体键单列一段，说明它走 `navigator.mediaSession` 而不是 globalShortcut
      （以及为什么：注册成 globalShortcut 会关掉 Chromium 自己的媒体键处理）
- [ ] 单测：- `lib/shortcuts.test.ts`：判定（⌘⇧M / Ctrl+⇧+M / Space / Esc /
      不匹配）+ 定义表完整性（id 唯一）+ 分组 + accelerator 格式化 - `components/modals/ShortcutModal.test.tsx`：面板条目 == 定义表；
      全局热键来自 IPC；无 electronAPI 不崩；媒体键段存在 - `Titlebar.test.tsx`：按钮点了会打开面板
- [ ] `ipc-surface` 门禁自动覆盖新通道 `shortcuts:global`
      （preload invoke ↔ main handle 双向核对）
- [ ] `npm run typecheck && npm run lint && npm test` 全绿
- [ ] 覆盖率 diff 门禁绿（本次改动的代码全部被执行过）
- [ ] 变异验证：把 `matchesShortcut` 换成「永远不命中」→ 门禁必须红

## 局限（如实说明）

- 面板**只列得出「已注册的」快捷键**，不能改（第一版不做自定义）。
  #128 的 `global-shortcuts.ts` 注释也写明「第一版，固定一组，不做配置 UI」。
- 媒体键没法列成键位表 —— 它们由系统/硬件决定，不是 App 定义的键。
- 浏览器 dev 模式（无 Electron）没有全局热键 → 面板会明说，而不是假装有。
