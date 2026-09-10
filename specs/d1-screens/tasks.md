# D1 — Tasks（按依赖顺序）

## Phase A — 写交付物（已完成）

- [x] **A1** `specs/d1-screens/spec.md` — 范围 + 验收 + 不在范围
- [x] **A2** `specs/d1-screens/design.md` — 6 屏的 AI CONTRACT description 草稿
- [x] **A3** `scripts/figma-aether-v4-screens-d1.js` — 6 段 use_figma code
- [x] **A4** `scripts/figma-v4-d1-command.md` — 执行手册
- [x] **A5** `scripts/figma-aether-v4-audit-d1.mjs` — audit 增量（AI CONTRACT 字段 + 6 frame 存在性 + 组件实例化率）
- [x] **A6** `scripts/figma-v4-smoke-d1.mjs` — smoke 增量（mock 跑 6 段）
- [x] **A7** 更新 `scripts/figma-v4-command.md` 加 D1 步骤表
- [x] **A8** 更新 `docs/figma-driven-frontend.md` §9 加 D1 状态

## Phase B — 跑通（用户在自己环境执行）

- [x] **B1** 跑 `node scripts/figma-v4-typecheck.mjs`（类型校验 D1 脚本）
- [x] **B2** 跑 `node scripts/figma-v4-smoke-d1.mjs`（mock 跑 6 段；无需 Figma）
- [x] **B3** 跑 `node scripts/figma-v4-d1-command.md`（在 Claude Code + use_figma MCP 喂命令稿）
  - 用户环境要求：Claude Code + figma-remote MCP（已配 .mcp.json），FIGMA_TOKEN 有 file_variables scope
  - 6 段顺序：SEG1 Search → SEG2 Liked → SEG3 Settings → SEG4 RecoKey → SEG5 AuthError → SEG6 EmptyState
- [x] **B4** 跑 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d1.mjs` 验收
  - 必须全 PASS 才算完成
  - FAIL 项按报告修
- [x] **B5** 跑 `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit.mjs`（原 v4 审计回归）
  - 确认 D1 没破坏 v4 已有 23/25

## Phase C — 验收后

- [x] **C1** 在 03 · Screens 截图 6 个新 frame 确认视觉与 v4-ABC 一致
- [x] **C2** D5 已顺带做掉：figma-code-connect.json 6 个 D1-PLACEHOLDER-N 换成真实 node id（466:2 / 467:2 / 476:2 / 477:2 / 478:2 / 479:2）
- [ ] **C2b** （可选）D5 平行 PR：补 5 个 Code Connect 映射（Modal / RecoKeyModal / SettingsModal / LikedLibraryModal / SearchPanel）——不在 D1 范围
- [ ] **C3** （可选）D3 平行 PR：用 AI CONTRACT 里的 transition 矩阵做 12 条 prototype wirings（需 Figma UI 手动）——不在 D1 范围

## Phase B 执行记录（2026-09-10）

真实跑 use_figma 时踩到 4 个 mock 没覆盖的问题，已连同脚本一起修：

1. **`FRAME` 没有 `description` 属性** — 只有 `COMPONENT`/`COMPONENT_SET` 有（PublishableMixin）。
   AI_CONTRACT 改存到 frame 下 `visible=false` + `fills=[]` 的 `AI_CONTRACT` TEXT 子节点；
   `audit-d1.mjs` 同步改为 `f.description || 子节点 characters`（仍兼容将来升级成 COMPONENT）。
2. **x 坐标撞车** — 脚本假设 03 页只有 4 屏，实际有 12 屏占满 y=0 行（x 0→17160）。
   6 屏改画 y=1000 第二行；`audit-d1.mjs` 的「x 不冲突」升级成真实包围盒相交检测。
3. **`Button/Text` 没有 `ghost` tone** — 真实 variant 只有 `default|accent|danger` × `default|hover|disabled`。
   `ghost` 改 `default`；`findVariant` 找不到时改抛带清单的错，不再返回 undefined。
   顺带把 AuthError 的 `FATAL // AUTH_TIMEOUT` tag 从 `cyan` 换成已有的 `red` tone。
4. **`Button/Text` 没有 TEXT 组件属性** — label 烘死在各 variant 的文本层里，`setProperties` 写不进去，
   9 个按钮全渲染成组件默认值。改成直接覆盖实例文本；因为实例内不能改 `x`/`y`
   （`cannot be overridden in an instance: relative-transform`），长文案靠加宽实例本身来对齐。
   另修 SEG3 的 spacer：`resize()` 会把 `layoutSizing*` 重置回 FIXED，必须先 resize 再设 FILL。

5. **绑定率阈值口径** — `audit-d1.mjs` 原来按整页统计「自有填充绑定 ≥70%」。03 页除了 D1 的 6 屏，
   还有 v4-ABC 的 12 屏，其中 Search/Library/Settings/Error/RecoLoading 5 屏填充全硬编码（0 绑定），
   整页只有 29–42%，会把 D1 判 FAIL。门禁改为只卡 D1 的 6 屏（实测自有 14/14 = 100%、
   实例内 378/384 = 98%），整页数字仍打印为信息项，遗留债留给 D2 收敛。

`figma-v4-smoke-d1.mjs` 的 mock 已对齐真实文件（variant 清单、`description` 在非 COMPONENT 上抛错、
Tag/Stat 的 TEXT 组件属性 vs Button/Text 的烘死文本），并加了「Button/Text 自定义文案已覆盖」断言，
24/24 通过。

## 验收结果（2026-09-10）

**B4 `audit-d1.mjs` — 18/18 全 PASS**
- 6 屏存在 + 6 个 AI_CONTRACT（355–542 字符，标签齐）
- D1 6 屏自有填充绑定 100% (14/14)、实例内 98% (378/384)
- 6 屏与 03 页其他屏无包围盒重叠

**B5 `audit.mjs` v4 回归 — 34/36（1 FAIL + 1 SKIP），基线未破**
- 基线 23/25（2 项非 PASS）→ 现 34/36（同样 2 项非 PASS）；PASS 数从 23 涨到 34 是因为屏幕从 4 涨到 18
- SKIP「变量接口可访问」= PAT 缺 `file_variables` scope（Enterprise 功能），与 D1 无关
- FAIL「03 页自有填充绑定 ≤30% 未绑定」= 实际未绑定 58% (129/224)，**遗留债，非 D1 引入**：
  全深度核对下来 D1 6 屏 49 个自有填充 **0 未绑定**，未绑定全部来自 v4-ABC 的
  Search/Library/Settings/Error/RecoLoading（`wordmark`/`kicker`/`LIBRARY // LIKED`/`1,284` 等硬编码文本填充）。
  D1 反而把比例从 61% 拉到 58%。这条收敛归 **D2**。
