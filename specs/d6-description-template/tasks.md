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

## Phase B 执行记录（2026-09-20）—— audit-d6 目前是**假警报**

D5_NEW 建完 10 个组件集后按要求跑了 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d6.mjs`，
结果是 **0/150 通过、150 项 FAIL**。逐条看下来这是脚本自身两个 bug，不是文件不合规：

1. **载体读错**：脚本只读 `n.description`，但 FRAME 上**没有**这个属性（实测
   `'description' in frame === false`）——`README — AI CONTRACT` / `Archive README` /
   `MOTION SPEC` 三处的 AI_CONTRACT 都挂在**隐藏 TEXT 子节点**里（D1/D2/D10 的既有做法）。
   `audit-d1.mjs` 早就写成「`description` || 子节点 characters」两种都读，audit-d6 没跟上。
2. **范围过宽**：它把 COMPONENT_SET 里的**每个变体**也当独立目标（`Tag/Stat` 一个集就贡献 12 个），
   于是 150 个目标里绝大多数是变体。D6 的口径是"v4-ABC **14 个组件（集）**"，
   不该按变体逐个要求 description。

**还没修**（本轮范围是 D5_NEW）：修法照 audit-d1 的现成模式 ——
`const carrierOf = (n) => n.description || (n.children || []).find(c => c.type === 'TEXT' && /AI_CONTRACT|README|MOTION_SPEC/.test(c.name))?.characters || ''`
+ `walk()` 里对 `COMPONENT` 加 `parentIsSet` 判断。修完再跑，才是 C2/C3 的可信门禁。
