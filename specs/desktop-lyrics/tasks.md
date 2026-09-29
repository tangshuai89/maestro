# 桌面歌词浮窗 — Tasks（NEXT-ITERATION §7.2）

## Phase 1 — main 进程（窗口 + prefs）

- [x] **D1** `prefs.ts`：`DesktopLyricsPrefs` + `normalisePrefs()` + JSON 读写
- [x] **D2** `window-options.ts`：透明/置顶/尺寸/穿透的纯函数窗口配置
- [x] **D3** `desktop-lyrics-controller.ts`：懒建窗口、state 转发、lock/hover/prefs、关闭清理
- [x] **D4** 单测：`prefs.test.ts` / `window-options.test.ts` / `desktop-lyrics-controller.test.ts`
- [x] **D5** `main.ts` 装配 + IPC 注册 + Tray「桌面歌词」勾选项 + `before-quit` 关窗
- [x] **D6** `preload.ts`：`desktopLyrics` API 组 + `SUBSCRIBABLE_CHANNELS` 白名单

## Phase 2 — 浮窗 renderer

- [x] **D7** `lib/lyrics.ts` `activeLineWindow()` + 单测（TheaterView 同步复用）
- [x] **D8** `lyrics.html` + `desktop-lyrics/main.tsx` 入口 + vite 多入口
- [x] **D9** `DesktopLyricsOverlay.tsx`：双行 / 行内进度 / 无歌词 / 暂停 / 设置面板（字号·配色·描边·锁定·关闭）
- [x] **D10** `desktop-lyrics.scss` + `_tokens.scss` 浮窗令牌（scanner 0 硬编码）
- [x] **D11** `DesktopLyricsOverlay.test.tsx`

## Phase 3 — 主窗口接线

- [x] **D12** `useDesktopLyrics.ts`：行变化才推 IPC（进度 5% 分桶去抖 ≈ 250ms 一跳）
- [x] **D13** `App.tsx` / `Titlebar.tsx` 接线 + `⌘⇧D`（`⌘⇧L` 已被 lite 模式占用）

## Phase 4 — 门禁与手测

- [x] **D14** `npm test` / `typecheck` / `lint` / `scan-hardcoded-colors --gate` / `build:renderer` / `build:electron`
- [ ] **D15** 手测：置顶逐行高亮 / 拖动 + 重启恢复 / 样式调节 / 锁定穿透 + hover 恢复 /
      切歌·无歌词·暂停 / Tray 与 Titlebar 勾选同步 / 多显示器
- [ ] **D16** 打包模式（`npm run pack`）验证浮窗资源路径 `lyrics.html` 落在 `Resources/renderer/`

> 偏离说明：全局热键（`globalShortcut` 开关浮窗）按 #7.3 排期，本轮只做应用内 `⌘⇧D`。
> 快捷键避让：`⌘⇧L` 归 lite 模式（§6.3）、`⌘⇧M` 归 mini，桌面歌词取 `⌘⇧D`。
