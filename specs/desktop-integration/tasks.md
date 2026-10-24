# 桌面系统集成 — Tasks

> 关联：`specs/desktop-integration/spec.md` · 来源：`NEXT-ITERATION.md` §7.3

## Phase A — 规格与现状核实

- [x] **A1** `specs/desktop-integration/spec.md` — 范围 + 三条关键决策 + 验收标准
- [x] **A2** `specs/desktop-integration/tasks.md` — 任务跟踪（本文件）
- [x] **A3** 实测现状：`mediaSession` / `globalShortcut` / `MPNowPlayingInfoCenter` /
      `electron-updater` 在 `packages/renderer/src` + `packages/electron/src` 的命中数
      **全是 0**（不是"没找到"，是"没有"）
- [x] **A4** 核实 Chromium 的 media session 在 macOS 上接的就是
      `MPNowPlayingInfoCenter`（真实 Electron 案例佐证）→ **P0 从 4 项压成 2 项**
- [x] **A5** 核实"媒体键注册成 globalShortcut 会关掉 Chromium 自己的处理"
      → 决策 2：**媒体键只走 mediaSession 一条路**

## Phase B — renderer：`navigator.mediaSession`

- [x] **B1** `packages/renderer/src/hooks/useMediaSession.ts` —— hook
  - [x] `metadata`（title / artist / album / artwork）
  - [x] `playbackState`（playing / paused / none）
  - [x] `setPositionState`（duration / position / playbackRate，节流）
  - [x] 7 个 action handler（play / pause / previoustrack / nexttrack /
        seekbackward / seekforward / seekto）+ stop
  - [x] handler **只注册一次**，用 ref 读最新状态（否则每次切歌重注册会丢事件）
  - [x] `navigator.mediaSession` 不存在 → 优雅降级（不抛）
- [x] **B2** `packages/renderer/src/hooks/useMediaSession.test.tsx` —— 单测
  - [x] metadata 正确组装
  - [x] playbackState 随播放状态翻转
  - [x] setPositionState 被调用且参数正确
  - [x] **每个 action handler 真的调到了对应的播放命令**
  - [x] 没有 `navigator.mediaSession` 时不抛
- [x] **B3** `packages/renderer/src/App.tsx` 接线（挂在 `usePlayer` 状态上）

## Phase C — electron：`globalShortcut`

- [x] **C1** `packages/electron/src/global-shortcuts.ts` —— 注册/注销 + 快捷键表
  - [x] **只注册非媒体键**（决策 2 的守卫）
  - [x] 复用 `sendTrayCommand`（零新增 IPC 通道）
  - [x] 桌面歌词开关 → 主进程直接调 `DesktopLyricsController.toggle()`
  - [x] 退出时全部 `unregister`
- [x] **C2** `packages/electron/src/global-shortcuts.test.ts` —— 单测
  - [x] 断言注册了哪几个快捷键（清单）
  - [x] **断言没有注册任何媒体键**
  - [x] 触发 → 发出正确命令
  - [x] 退出 → 全部注销
- [x] **C3** `packages/electron/src/main.ts` 接线（`app.whenReady` 注册 / `before-quit` 注销）
- [x] **C4** `TrayCommand` → `PlaybackCommand` 类型改名 + 扩展
      （`volumeup` / `volumedown`），**通道名 `tray:command` 不动**

## Phase D — 门禁与验收

- [x] **D1** **变异验证**：
  - [x] 把任一 action handler 里的调用去掉 → 对应用例**必须红**
  - [x] 把"不注册媒体键"的守卫去掉 → 对应用例**必须红**
- [x] **D2** `npm run typecheck` / `npm run lint` / `npm test` 全绿
- [x] **D3** 覆盖率 diff 门禁绿（本次新增行必须被执行过）
- [ ] **D4** 手测清单（**只有 1 条**）：插带媒体键的耳机 → ⏯/⏭/⏮ 响应 +
      控制中心显示歌名封面 + `⌘⇧Space` 在后台能暂停
- [x] **D5** `NEXT-ITERATION.md` §7.3 改成「已交付」+ `CHANGELOG.md`

## 不在本 spec 范围

- ❌ **自动更新**（`electron-updater`）—— 要 GitHub Releases feed + **签名构建**
  才有意义 → 等 §0 的 Apple Dev + EVS 落地后单独立 spec
- ❌ Windows / Linux 的系统媒体集成 —— 等出那几个平台的包
- ❌ 自定义快捷键配置 UI —— 先给固定一组
- ❌ 原生 `MPNowPlayingInfoCenter` 模块 —— mediaSession 已经覆盖
