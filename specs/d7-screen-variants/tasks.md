# D7 — Tasks

## Phase A — 现状核查（已完成）

- [x] **A1** 读 03 页顶层：18 个 `Screen/` FRAME，其中 NowPlaying 系 6 个（3 播放态 + 3 降级态）
- [x] **A2** 读三屏顶层图层名 → **跨屏一致**（8 个同名子层），Smart Animate 前提已满足
- [x] **A3** 扫仓库硬引用 `314:2 / 314:1045 / 314:1237` → **0 处**（改 id 安全）
- [x] **A4** 审计阈值核查：`MIN_SCREENS = 4`（18→15 不破门禁）；绑定率按整页统计，不受影响
- [x] **A5** REST 盘点连线分布 → **03 页无 frame 级连线**，连线都在屏幕内部实例上（改类型不毁手连线）

## Phase B — 转换（已完成）

- [x] **B1** `figma.createComponentFromNode` ×3 + `combineAsVariants` → 组件集 `Screen/NowPlaying`（`516:1884`）
- [x] **B2** 变体命名 `state=Playing|Paused|Buffering`，定位 (0,0)（原 Playing 位置）
- [x] **B3** 写 AI_CONTRACT description（含 Smart Animate 图层名清单）
- [x] **B4** 回读：3 变体 / 子节点 8·8·9 不变 / 15 个 Screen frame 剩余

## Phase C — 验证（已完成）

- [x] **C1** REST 连线数：转换前 57 → 转换后 57（`?depth=7`，逐页相同）——**一条没丢**
- [x] **C2** `figma-aether-v4-audit.mjs` → 34/36，与基线逐项一致
- [x] **C3** 文档更正：`docs/prototype-wiring-checklist.md` 顶部加 2026-09-20 状态更正
      （旧 frame 路径读作变体；第 10-12 条与 A/B/C 目前在文件里并不存在）

## Phase D — 需人工/后续

- [ ] **D1** 在 Figma UI 手连 3 条 Smart Animate（Playing↔Paused↔Buffering）+ 3 条 AFTER_TIMEOUT 轮播
- [ ] **D2** （可选）把 NoLyrics / TrialFallback / RecoUnconfigured 也并入同一组件集
      （变体数会到 6；需先确认它们与三播放态的图层名一致性）
