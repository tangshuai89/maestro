# D5 — Tasks

## Phase A — 仓库内工作（已完成）

- [x] **A1** `specs/d5-code-connect/spec.md` — 范围 + 验收 + schema 规范
- [x] **A2** `specs/d5-code-connect/tasks.md` — 任务跟踪
- [x] **A3** 写 `scripts/figma-code-connect-validate.mjs`（校验脚本）
- [x] **A4** 5 个 D1 映射 props 补全（基于 React Props 真实 schema）
- [x] **A5** 加 `npm run test:code-connect` + 接 `test:ci`
- [x] **A6** 跑 validate + typecheck + lint 全绿

## Phase B — D1 跑完后（用户操作）

- [ ] **B1** 用户在 Claude Code 跑完 D1 6 段，记录返回的 `createdNodeIds`（格式：SEG1=Search@id1, SEG2=Liked@id2, ...）
- [ ] **B2** 替换 `figma-code-connect.json` 里 6 个 `D1-PLACEHOLDER-N` → 真实 node_id
- [ ] **B3** 删 `_d1Status` 字段
- [ ] **B4** 跑 `node scripts/figma-code-connect-validate.mjs --strict` 确认
- [ ] **B5** 在 Figma UI 选中 6 个 frame → Dev Mode → Code Connect 面板应显示 react 路径
- [ ] **B6** 跑 `npm run test:ci` 跑通

## Phase C — 后续延后

- [ ] **C1** Figma 端给 5 个 modal 组件加独立 component set（替代 D1 6 frame 里的 raw panel 节点）—— worktree 单独 PR
- [ ] **C2** Card/Glass 槽位组件映射——v4 文档提过但剧场稿没建
- [ ] **C3** Pact/Spectral API schema 契约——D6/D7 阶段
