# D2 — Tasks

## Phase A — 文档清理（已完成）

- [x] **A1** `specs/d2-convergence/spec.md` — 范围 + 验收
- [x] **A2** `specs/d2-convergence/tasks.md` — 任务跟踪
- [x] **A3** 改 `packages/renderer/src/App.tsx` L203-205 注释
- [x] **A4** 改 `.superdesign/init/theme.md` —— 删"Two visual worlds"段
- [x] **A5** 改 `.superdesign/init/components.md` L531-532
- [x] **A6** 改 `.superdesign/init/extractable-components.md` —— 6 处引用 + 类前缀说明
- [x] **A7** 改 `docs/figma-driven-frontend.md` §5/§9
- [x] **A8** 写 `scripts/figma-aether-v4-archive-readme.js`（Figma 段 0 段）
- [x] **A9** 写 `scripts/figma-v4-d2-command.md`（执行手册）

## Phase B — 验证（已跑）

- [x] **B1** `git grep` 无残留
- [x] **B2** `find` 无 monster-* 文件
- [x] **B3** `npm run typecheck` + `npm run lint` 0 error

## Phase C — Figma Archive README（用户在 Claude Code 跑）

- [ ] **C1** 跑 `scripts/figma-v4-typecheck.mjs`（无 FIGMA_TOKEN 也能跑）
- [ ] **C2** 跑 `scripts/figma-v4-smoke-d2.mjs`（mock 端到端，0 FIGMA_TOKEN）
- [ ] **C3** 喂 `scripts/figma-v4-d2-command.md` 给 Claude Code + use_figma 跑
- [ ] **C4** 截图 99 · Archive 顶部确认 Archive README frame 存在
- [ ] **C5** 跑 `node scripts/figma-aether-v4-audit.mjs` 确认 v4 23/25 不破

## Phase D — 后续

- [ ] **D1** 视觉回归保护（Playwright 截图 baseline）—— 升级到 D6 阶段 5 或独立 P3 PR
- [ ] **D2** （可选）AETHER 主题令牌补漏——观察 TheatherView 还有没有 hardcoded 颜色遗漏
