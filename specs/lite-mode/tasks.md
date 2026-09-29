# Lite 播放模式（#6.3）— Tasks

## Phase 0 — spec

- [x] **P0-1** 落 `specs/lite-mode/spec.md`（含 4 条偏离说明）

## Phase 1 — 状态与存储

- [x] **P1-1** `lib/storage.ts`：`PlayerMode = 'theater' | 'mini' | 'lite'` +
  `STORAGE_KEYS.playerMode` + `readStoredPlayerMode` / `writeStoredPlayerMode`
- [x] **P1-2** `MiniPlayer.tsx` 移除本地 `PlayerMode` 导出；`Titlebar.tsx` 改从 storage 导入

## Phase 2 — LiteView 组件

- [x] **P2-1** `components/views/LiteView.tsx`：歌名块 / ◀▶ / ✨ + hover 显形 ⛶
- [x] **P2-2** `_lite-mode.scss` + `$z-layers['lite-view']` + `main.scss` 注册
- [x] **P2-3** `LiteView.test.tsx`：空态 / 三类元素 / 3 回调 / reco loading / 退出键

## Phase 3 — 接线

- [x] **P3-1** `App.tsx`：三态 state（走 storage）+ 条件渲染 + 根 class + 进 lite 关搜索
- [x] **P3-2** `App.tsx`：`⌘⇧L` 切 lite、`Esc` 回 theater、`Space` 播放/暂停（带输入框/浮层护栏）
- [x] **P3-3** `SettingsModal.tsx`「① 播放模式」节（完整 / 迷你 / 极简）+ props
- [x] **P3-4** `storage.test.mjs` 补 3 例；`SettingsModal.test.tsx` 补 prop 与 1 例

## Phase 4 — Electron 窗口

- [x] **P4-1** `preload.ts`：`reportPlayerMode` 收 `'lite'`
- [x] **P4-2** `main.ts`：`player:mode` 紧凑态机（theater ⇄ mini ⇄ lite），
      lite 480×300，红绿灯保留（lite 有退出键，不需要 mini 那种 hover 才显）

## Phase 5 — 门禁

- [x] **P5-1** `npm test`（全仓）绿
- [x] **P5-2** `npm run typecheck` + `npm run lint` 绿
- [x] **P5-3** `scan-hardcoded-colors --gate` 不破预算
- [x] **P5-4** `npm run build:renderer` + `build:electron` 通过
- [x] **P5-5a** 浏览器级验证（vite preview + Playwright，2026-09-28）：
      三类元素计数 = 3 · ⛶ hover 由 opacity 0 → 1 · `⌘⇧L` 双向切换且偏好落盘
      (`player-mode=lite|therater`) · `Esc` 回 theater · 480×300 与 1200×800 均正常
- [ ] **P5-5b** Electron 手测（需 `npm run dev`）：窗口收成 480×300 / 回 theater 还原
      bounds+maximized · mini ⇄ lite 互切不丢存档 · ✨ 真跑 DeepSeek 出歌可播 · 切换不中断音频
