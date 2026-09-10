# D10 — Tasks

## Phase A — 仓库内（已完成）

- [x] **A1** `specs/d10-motion-spec/spec.md` — 范围 + JSON Schema + 验收
- [x] **A2** `specs/d10-motion-spec/tasks.md` — 任务跟踪
- [x] **A3** `specs/motion-spec.json` — 20 条完整动效规格（12 prototype + 3 轮播 + 5 ambient）
- [x] **A4** `specs/d10-motion-spec/fixture-description.md` — frame description 模板
- [x] **A5** 写 `scripts/figma-aether-v4-audit-d10.mjs`（REST + fixture 双模式）
- [x] **A6** 写 `scripts/figma-d10-fixture.js`（fixture 生成器）
- [x] **A7** `package.json` 加 `test:motion` + 接 `test:ci`

## Phase B — 用户跑（待 Figma 端写入）

- [ ] **B1** 用户把 `specs/d10-motion-spec/fixture-description.md` 里的 description 粘到 04 · Motion · MOTION SPEC frame（用 use_figma 写或手动粘贴）
- [ ] **B2** 跑 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d10.mjs` 校验
- [ ] **B3** 跑 `npm run test:ci` 跑通

## Phase C — 持续

- [ ] **C1** 任何新增动效的 PR 必含 spec 条目（PR template 加 checkbox）
- [ ] **C2** 与 D4 同步：spec 改了 → tokens 自动 export → SCSS diff
