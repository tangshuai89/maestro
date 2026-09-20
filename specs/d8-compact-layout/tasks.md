# D8 — Tasks

## Phase A — 现状实测（已完成）

- [x] **A1** 量 1440 稿各块几何 → 得出"最小可用宽度 1330px"（封面簇 670 + 歌词 560 + 边距 60）
- [x] **A2** 核对窗口尺寸：默认 1200×800、最小宽 960（`electron/src/main.ts:286`）
- [x] **A3** 统计字号分布：7 处 8–10px 小字 → 算出各窗口档位下的实际可读性
- [x] **A4** 确认 1920 档无需设计帧（缩放 1.29×，显示更大更清楚）
- [x] **A5** 确认 `.superdesign/shot-A-{1280,1920}.png` 是窗口截图、`shot-A.png` 是 1440×900@2x，
      不是设计帧 —— 原计划的"尺寸帧"没有可对齐的产物

## Phase B — Figma 紧凑变体（已完成）

- [x] **B1** `Screen/NowPlaying` 克隆 `state=Playing` → `state=Playing, density=narrow`（`518:1881`，960×800）
- [x] **B2** 砍 `sound-rings` 与 `neural-suggestions`（用户认可）
- [x] **B3** 歌词只留当前行（Tag/Stat + 当前行）
- [x] **B4** 原生尺寸纵向堆叠：封面 480×500 @ (240,70) · 进度环 300×340 @ (330,140) ·
      歌词 560×80 @ (200,596) · 控制条 264×72 @ (348,690)
- [x] **B5** 给原有三变体补 `density=regular`（同集合变体属性需一致）
- [x] **B6** 碰撞自检：仅剩 `star-orbit ∩ hologram`（与 1440 稿同一层级关系）
- [x] **B7** 顺带修 `Ring/Progress` 的 `progress-arc` 噪声方框描边（三个变体一起）

## Phase C — 代码（已完成）

- [x] **C1** `lib/theaterLayout.ts`：`theaterDensity` / `canvasScale` / `lyricWindow` / `CANVAS`
- [x] **C2** 单测 `lib/theaterLayout.test.mjs` → **20/20**（含 1920 放大、极矮窗口不塌、三档歌词窗口）
- [x] **C3** `TheaterView.tsx`：`data-density` + density 感知的 `canvasScale` + `lyricWindow()`
- [x] **C4** `_theater.scss`：`.th-canvas[data-density='narrow']` 紧凑档规则（含隐藏声波环/推荐卡）
- [x] **C5** `npm run build:renderer` / `typecheck` / `lint` 全绿

## Phase D — 待人工

- [ ] **D1** `npm run dev` 拖窗口过 960 / 1200 / 1920 三档，确认紧凑档间距与字号
- [ ] **D2** （可选）1200 档若仍觉挤 → 推荐卡减到 2 张
