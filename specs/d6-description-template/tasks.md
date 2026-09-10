# D6 — Tasks

## Phase A — 仓库内（已完成）

- [x] **A1** `specs/d6-description-template/spec.md` — 范围 + 验收 + audit 检查项
- [x] **A2** `specs/d6-description-template/tasks.md` — 任务跟踪
- [x] **A3** `specs/d6-description-template/template.md` — AI CONTRACT 模板标准（可复用 snippet）
- [x] **A4** 写 `scripts/figma-aether-v4-audit-d6.mjs`（REST + fixture 双模式）
- [x] **A5** 写 fixture 模式（用 D1 6 屏 description 手写 fixture）
- [x] **A6** `scripts/figma-v4-command.md` 加 description 强制段
- [x] **A7** `package.json` 加 `test:description` + 接 `test:ci`

## Phase B — 用户跑（待 D1 真跑完后）

- [ ] **B1** 用户在 Claude Code 跑完 D1 + 验证 D1 6 屏 description 已写 AI_CONTRACT
- [ ] **B2** 跑 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d6.mjs` 检查 v4-ABC 14 个组件 description
- [ ] **B3** 如 FAIL，按报告补 description 模板段（手动或 use_figma 跑补丁段）
- [ ] **B4** 跑 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit.mjs` 回归

## Phase C — 持续

- [ ] **C1** Figma 端给 v4-ABC 14 个组件补 description（v4-command.md 模板）—— use_figma 段脚本
- [ ] **C2** 任何新建组件的 PR 必含 description 模板审计（PR template 加 checkbox）
- [ ] **C3** D5_NEW 10 个组件建好后也跑 audit-d6 确认合规
