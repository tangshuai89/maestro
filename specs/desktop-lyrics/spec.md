# 桌面歌词浮窗 — 实施 spec（NEXT-ITERATION §7.2）

> 决策：独立透明置顶 `BrowserWindow`（不是应用内 overlay，也不用 `BrowserView`）。
> 入口三处：Titlebar 按钮 / Tray 勾选项 / 应用内 `⌘⇧D`。全局热键属 #7.3，本轮不做。

## 1. 范围

做：
- **浮窗**：透明、无边框、置顶（`screen-saver` 级）、不进 Dock/任务栏、`visibleOnAllWorkspaces`
- **双行歌词**：当前行（大、高亮）+ 下一行（小、弱化），随播放进度逐行跟随；行内进度条
- **样式可调**：字号（3 档）、配色（4 组预设）、描边开关、锁定开关 —— 存在浮窗自己的设置面板里
- **可拖动**：`-webkit-app-region: drag`；位置 + 尺寸持久化到 `userData/desktop-lyrics.json`
- **锁定 → 点击穿透**：`setIgnoreMouseEvents(true, { forward: true })`，鼠标移入自动恢复可交互（洛雪/WeMod 同款交互）
- **入口**：Titlebar `词` 按钮、Tray 「桌面歌词」勾选项、应用内 `⌘⇧L`
- **无歌词 / 暂停 / 切歌**：暂停显示 `‖` 标记；无歌词显示「暂无歌词」，浮窗不隐藏（保持位置）

不做（留给后续）：
- 桌面歌词的全局热键（#7.3 `globalShortcut`）
- 逐字卡拉 OK（karaoke）级高亮
- Windows / Linux 分支的置顶差异（代码留了 `process.platform` 判断，只在 mac 调 `setVisibleOnAllWorkspaces`）

## 2. 架构（谁持有状态）

```
主窗口 renderer (App/useDesktopLyrics)          main 进程                 浮窗 renderer
  ├ lyrics.lyrics + player.currentTime
  ├ 算 active/next 行（lib/lyrics.ts activeLineWindow）
  │  ── 'desktop-lyrics:state' (send) ──▶ DesktopLyricsController
  │                                        ├─ BrowserWindow（懒建/复用）
  │                                        ├─ prefs 持久化（JSON）
  └── 开关/状态回显 ◀── 'desktop-lyrics:changed' ──┤
                                                 └── 'desktop-lyrics:overlay:*'
                                                       ├ control: close/lock/prefs
                                                       └ hover: 锁定时穿透/恢复
```

- **播放状态、歌词数据只在主窗口存在**；浮窗是纯展示端，不碰 `<audio>`、不发请求。
- 浮窗 preload 复用同一个 `preload.js`，只是调另一组方法（`window.electronAPI.desktopLyrics.*`）。
- main 端逻辑抽成 `desktop-lyrics-controller.ts`，BrowserWindow 经工厂注入 → 单测不依赖 electron 运行时。

## 3. IPC 契约

| 方向 | channel | payload |
|---|---|---|
| 主窗口 → main | `desktop-lyrics:state` | `{ playing, current, next, progress, title, artist }` |
| 主窗口 → main | `desktop-lyrics:set-enabled` | `boolean` |
| main → 主窗口 | `desktop-lyrics:changed` | `{ enabled, locked }`（Tray / 浮窗锁定的回显） |
| 浮窗 → main | `desktop-lyrics:overlay:control` | `{ action: 'close' \| 'lock' \| 'prefs', locked?, prefs? }` |
| 浮窗 → main | `desktop-lyrics:overlay:hover` | `{ inside: boolean }` |
| main → 浮窗 | `desktop-lyrics:overlay:prefs` | `DesktopLyricsPrefs`（主进程是唯一事实来源，浮窗刷新后回写） |

所有 handler 都在 `app.whenReady()` 里注册（与既有 `ipcMain.handle` 同规，规避 main.ts Bug #1 时序坑）。
`SUBSCRIBABLE_CHANNELS` 白名单加 `desktop-lyrics:changed`。

## 4. 文件改动

**Electron（新建 `packages/electron/src/desktop-lyrics/`）**
- `prefs.ts` — `DesktopLyricsPrefs` / `DEFAULT_PREFS` / `normalisePrefs()` / `loadPrefs()` / `savePrefs()`（纯函数可测）
- `window-options.ts` — `overlayWindowOptions(prefs)` 纯函数（transparent/置顶/尺寸…）
- `desktop-lyrics-controller.ts` — 窗口生命周期 + 转发 + Tray 菜单项同步
- 各自 `.test.ts`

**Electron 改动**
- `main.ts` — 装配 controller、注册 IPC、Tray 加勾选项、`before-quit` 关窗
- `preload.ts` — `desktopLyrics` API 组 + 白名单

**Renderer（新建）**
- `lyrics.html` + `src/desktop-lyrics/main.tsx`（独立入口）
- `src/desktop-lyrics/DesktopLyricsOverlay.tsx` + `.test.tsx`
- `src/styles/desktop-lyrics.scss`（独立样式入口，只引 token 层 + 浮层样式）
- `src/lib/lyrics.ts` + `.test.mjs`（`activeLineWindow`，TheaterView 同步改用它）

**Renderer 改动**
- `vite.config.ts` — `rollupOptions.input` 加 `lyrics.html`
- `src/hooks/useDesktopLyrics.ts` — 主窗口侧推送 + 开关状态
- `App.tsx` / `Titlebar.tsx` — 接线 + `⌘⇧L`
- `styles/base/_tokens.scss` — 浮窗配色令牌（token 层是 scanner 豁免文件）

## 5. 视觉

```
        ♪ 你应该对我说谎                      ← 当前行，字号 --overlay-size，描边可选
          别管我怎么说                          ← 下一行，40% 不透明度
        ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░      ← 行内进度
                                        ⚙     ← hover 才出现（锁定时不可见）
```

- 窗口 860×160，`minWidth: 420` / `minHeight: 96`
- 背景全透明，只有文字 + 描边（`-webkit-text-stroke`）
- 入场 0.25s 淡入；换行 0.18s 位移淡入

## 6. 验收

- [ ] `npm test`（新增 5 个测试文件）绿
- [ ] `npm run typecheck` / `npm run lint` 绿
- [ ] `node scripts/scan-hardcoded-colors.mjs --gate` 不破预算（新文件 0 处硬编码）
- [ ] `npm run build:renderer` / `build:electron` 通过（多入口产物含 `lyrics.html`）
- [ ] 手测：开启后桌面出现置顶歌词随播放逐行高亮；可拖动 + 样式可调 + 重启恢复；
      锁定后点击穿透、hover 仍能打开设置；切歌 / 无歌词 / 暂停正确；Tray 勾选同步
