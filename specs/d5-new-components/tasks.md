# D5_NEW — Tasks

## Phase A — 仓库内（已完成）

- [x] **A1** `specs/d5-new-components/spec.md` — 范围 + 10 组件规格 + 验收
- [x] **A2** `specs/d5-new-components/tasks.md` — 任务跟踪
- [x] **A3** `specs/d5-new-components/component-specs.md` — 每组件详细规格（含 layout / auto-layout / tokens 绑定 / variant props）
- [x] **A4** `scripts/figma-aether-v4-components-d5.js` — 2 段 use_figma SEG1 + SEG2
- [x] **A5** `scripts/figma-v4-d5-new-command.md` — 执行手册
- [x] **A6** `scripts/figma-v4-smoke-d5-new.mjs` — mock 端到端（28 变体 / 10 set）
- [x] **A7** `scripts/figma-code-connect-inject.mjs` — TBD-FIGMA → 真实 nodeId 自动注入器

## Phase B — 用户在 Claude Code 跑

- [ ] **B1** 跑 Phase A.4 的 2 段 use_figma（SEG1 + SEG2）
- [ ] **B2** 收集返回的 10 个 createdNodeIds
- [ ] **B3** 跑 `node scripts/figma-code-connect-inject.mjs --ids=ID1,ID2,...,ID10` 替换 10 个 TBD-FIGMA
- [ ] **B4** 跑 `node scripts/figma-code-connect-validate.mjs --strict` 确认 110/110
- [ ] **B5** 跑 `node scripts/figma-aether-v4-audit.mjs` 确认 v4 23/25 不破
- [ ] **B6** 截图 02 · Components 顶部新 10 个 component set 入 PR 描述

## Phase C — 后续

- [ ] **C1** v4 audit `EXPECTED_SETS` 加 10 个 D5_NEW 组件名（防未来误删）
- [ ] **C2** 任何新建组件的 PR 必含 component-specs.md 更新 + strict audit PASS
