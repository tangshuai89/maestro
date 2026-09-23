# Mini Player 模式 — P1 实施 spec

> 设计源：`docs/mini-player-mode-spec.md`（含完整愿景、角色叠加层规划、Figma 交付物清单）。
> 本文件只覆盖 **Phase 1：mini 浮层骨架（无角色）**。角色叠加层（Phase 2+）待 Figma 稿后单独迭代。
> 决策已于 2026-09-23 确认：应用内浮层 / `Cmd+Shift+M` / 宽 `min(560px, 100%-48px)` / 本次只做 Phase 1。

## 1. 范围

做：
- `playerMode: 'theater' | 'mini'` 状态（App 层），顶栏按钮 + `Cmd+Shift+M` 快捷键切换
- `<MiniPlayer />` 底部悬浮播控条：封面 / 标题 / 歌手-专辑 / 进度条（点击 seek）/ 时间 / prev·play·next·like·expand
- `.mini-mode` 根 class：TheaterView 卸载、MiniPlayer mount；`.bg-layer` 降为 `opacity 0.2`
- **窗口缩放**（2026-09-23 追加）：切 mini 时主窗口收缩成 620×170 悬浮条（Apple Music miniPlayer 形态），回 theater 恢复切入前 bounds/maximized/fullscreen。renderer `reportPlayerMode` → main `player:mode` IPC
- mini 窗口下 titlebar 只留 mode 切换按钮（其余入口的浮层都比 mini 窗口大，须先展开）
- mode 持久化：`localStorage['player-mode']`，下次启动恢复（窗口也随 effect 首跑收缩）
- 完整单测

不做（设计 spec §8 已列）：角色叠加层、独立 BrowserWindow、mini 下歌词/推荐卡、节拍动画。

## 2. 技术约束（已核实）

- **`<audio>` 不重建**：App.tsx L306-315 常驻（`createMediaElementSource` 每元素只能调一次）。切 mode 只换条件渲染分支 → Web Audio graph 不断。
- **usePlayer 不改**：`playing`/`loading`/`track.liked`/`currentTime`/`duration`/`handlePlayPause`/`handleSkip`/`handlePrev`/`seek`/`handleLike` 均已暴露。
- **快捷键**：App 级 `keydown` 监听是新增（现有 keydown 都只在 modal 内）。`Cmd+Shift+M`，避开 macOS `Cmd+M` 最小化。
- **token 门禁**：`test:ci` 含 `scan-hardcoded-colors --gate`，新文件预算 = 0 → `_mini-player.scss` / `MiniPlayer.tsx` 只允许 `var(--token)` + `color-mix(var…)`，不写任何 `#hex`/`rgb()`/`hsl()` 字面量。
- **z-index**：新增 `$z-layers` 条目 `'mini-player': 50`（低于 search-overlay 60 / titlebar 100）。
- **封面**：`track.coverUrl` 直接 `<img>`（跨域渲染无需 CORS）；失败/缺失 → `placeholderCover()` 渐变 + `♪`（该 lib 已在 scanner 豁免名单）。

## 3. 文件改动

新建：
- `components/mini/MiniPlayer.tsx` — 浮层组件（`export type PlayerMode`）
- `components/mini/MiniPlayer.test.tsx` — vitest 单测
- `styles/components/_mini-player.scss` — 浮层样式 + `.app.mini-mode` 覆写

改动：
- `App.tsx` — playerMode state + 持久化 + 快捷键 + 条件渲染 + 根 class
- `components/layout/Titlebar.tsx` — `playerMode` / `onTogglePlayerMode` props + 切换按钮
- `styles/abstracts/_variables.scss` — `$z-layers` 加 `'mini-player': 50`
- `styles/main.scss` — `@use 'components/mini-player'`

## 4. 视觉

```
┌──────────────────────────────────────────────────────────┐
│ [cover] 标题                  ⏮  ▶/⏸  ⏭  ♥  ⤢          │
│  40×40  歌手 — 专辑                                       │
│         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  1:23/3:45   │
└──────────────────────────────────────────────────────────┘
   fixed bottom:24px · width:min(560px,100%-48px) · 高约64px
```

- 玻璃拟态沿用 `.glass-card` 配方（cover-accent tint + border + backdrop-blur + shadow）
- 进度条 `fill` = `var(--accent-live)`（跟随封面色，与既有进度条/音量条一致）
- liked 态 = `var(--status-liked)`（与 `.th-like.is-liked` 一致）
- 时间用 `'JetBrains Mono'`（与 `.th-time` 一致）
- mount 时 slide-up 入场（`var(--ease-out)`，~0.35s）

## 5. 验收

- [ ] `npm test`（含新 MiniPlayer.test.tsx）绿
- [ ] `npm run typecheck` / `npm run lint` 绿
- [ ] `node scripts/scan-hardcoded-colors.mjs --gate` 不破预算
- [ ] `npm run build:renderer` 通过
- [ ] 手测：theater↔mini 切换音频不中断；快捷键生效；重启恢复 mode
