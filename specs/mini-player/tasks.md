# Mini Player — Tasks

## Phase 0 — 决策与 spec 落位（已完成）

- [x] **P0-1** 确认应用内浮层 / `Cmd+Shift+M` / 560px / 只做 Phase 1（2026-09-23）
- [x] **P0-2** `docs/mini-player-mode-spec.md` §10 记录决策；建 `specs/mini-player/`

## Phase 1 — MiniPlayer 浮层骨架（已完成，待手测）

- [x] **P1-1** `_variables.scss`：`$z-layers` 加 `'mini-player': 50`；`main.scss` 注册 `_mini-player.scss`
- [x] **P1-2** `components/mini/MiniPlayer.tsx`：封面/标题/歌手-专辑/进度条(click-seek)/时间/5 按钮(prev·play·next·like·expand)
- [x] **P1-3** `styles/components/_mini-player.scss`：fixed 底部浮层 + glass 配方 + `.app.mini-mode` 覆写（padding 0、`.bg-layer` opacity 0.2）+ mount slide-up
- [x] **P1-4** `Titlebar.tsx`：`playerMode` + `onTogglePlayerMode` props + 切换按钮（▭/⛶）
- [x] **P1-5** `App.tsx`：`playerMode` state + `localStorage['player-mode']` 持久化 + `Cmd+Shift+M` keydown + `.mini-mode` 根 class + 条件渲染
- [x] **P1-6** `components/mini/MiniPlayer.test.tsx`：8 例全绿（空态/渲染/5 callback/seek/liked/loading）
- [x] **P1-7** 门禁：`npm test`（全仓）+ `typecheck` + `lint` + `scan-hardcoded-colors --gate` + `build:renderer` 全绿
- [x] **P1-8** 窗口缩放：preload `reportPlayerMode` + main `player:mode` handler（保存/恢复 bounds、minSize 切换、居中收缩、fullscreen/maximized 处理）+ `.mini-mode` titlebar 精简
- [x] **P1-9** Apple Music 化：窗口 `titleBarStyle: 'hiddenInset'`（红绿灯叠内容，无原生标题栏）；mini 窗口 600×104 时 pill 撑满窗口（`@media max-height:220px` + `inset:6px` + 整条 `-webkit-app-region:drag`）；点封面=展开；进度条双侧 `当前/-剩余` 时间
- [ ] **P1-10** 手测：`npm run dev` → theater↔mini 音频不中断、窗口收缩/还原动画、红绿灯落位、拖拽、快捷键、重启恢复 mode

> 偏离说明：设计 spec §4 草图里的「队列」按钮未实现 —— 现有代码没有独立队列视图，
> ❤ 库弹窗已走 titlebar。如要补，先定队列 UI 再加。

## Phase 2 — 角色叠加层（待 Figma 稿，本轮不做）

- [ ] 芙宁娜角色（OpenGameArt CC0 资源 + license 标注）`lib/characters/`
- [ ] `CharacterOverlay` + 状态动画 + `<1100px` 隐藏
- [ ] `CharacterOverlay.test.tsx`

## Phase 3 — 集成与打磨

- [ ] `npm run test:ci` 全绿
- [ ] 手测验收（spec §5）
- [ ] 可选 `visual:test`
