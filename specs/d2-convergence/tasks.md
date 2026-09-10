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

- [x] **C1** 跑 `scripts/figma-v4-typecheck.mjs`（无 FIGMA_TOKEN 也能跑）
- [x] **C2** 跑 `scripts/figma-v4-smoke-d2.mjs`（mock 端到端，0 FIGMA_TOKEN）
- [x] **C3** 喂 `scripts/figma-v4-d2-command.md` 给 Claude Code + use_figma 跑
- [x] **C4** 截图 99 · Archive 顶部确认 Archive README frame 存在
- [x] **C5** 跑 `node scripts/figma-aether-v4-audit.mjs` 确认 v4 23/25 不破

## Phase D — 后续

- [ ] **D1** 视觉回归保护（Playwright 截图 baseline）—— 升级到 D6 阶段 5 或独立 P3 PR
- [ ] **D2** （可选）AETHER 主题令牌补漏——观察 TheatherView 还有没有 hardcoded 颜色遗漏

## Phase C 执行记录（2026-09-10）

**前提被推翻**：spec / command.md 都写「99 · Archive = v3 Monster Beats 视觉稿」，
实跑读出来这页装的是 **AETHER THEATER 宇宙剧场 A / B / C 三版探索稿**
（x=1540 / 3140 / 4740, y=0），也就是 v4 的视觉基准——`figma-aether-v4-screens.js`
头部写明「布局基准：99 · Archive 页 AETHER THEATER · A」，`figma-v4-command.md` L10
也写「以 AETHER THEATER（ABC 剧场稿，99 · Archive 页）为视觉基准」。
按原文案写会把 v4 基准页永久标成「v3 死稿」，与「避免误扩展」的目的相反。
经确认后 README 文案整体改写为 BASELINE 口径。

真跑另外撞到 4 个问题，已连脚本一起修：

1. **`readme.description` 写在 FRAME 上** —— 与 D1 同一个坑（`description` 只在
   `COMPONENT` / `COMPONENT_SET` 上）。改存 `visible=false` 的 `ARCHIVE_README`
   TEXT 子节点；`figma-v4-smoke-d2.mjs` 的 mock 也补上了「非 COMPONENT 写 description 抛错」。
2. **`Color/semantic/status-error` 这个变量不存在** —— `varColor` 回退品红哨兵
   `{r:1,g:0,b:1}`，README 的 4px 描边 / ⚠ / 标题全渲染成品红。**同一个 bug 也在 D1 的
   `Screen/AuthError/Full` 上**（`alert-panel` 描边，因为是 stroke 不进 fills 统计，
   18/18 审计抓不到）。经确认新建 `Color/semantic/status-error` 别名 → `Color/primitive/heart-red`，
   并就地改绑 D1 的描边（保留 node id `478:2`）。
3. **`JetBrains Mono` 没有 `Semi Bold`** —— 只有 Bold / Medium / ExtraBold，而共用的
   `textNode` helper 硬编码 `bold ? 'Semi Bold' : 'Regular'`，mono+bold 必炸。
   改成按字族取加粗名（`{ Inter: 'Semi Bold', 'JetBrains Mono': 'Bold' }`），
   `figma-aether-v4-screens-d1.js` 的 6 份同名 helper 一并修（D1 没有 mono+bold 调用，
   属潜伏 bug，输出不变，无需重跑）。
4. **`readme.fills = []`** —— Archive 页画布是 Figma 默认浅灰，而文字全用暗色主题的
   `text-dim` / `text-muted`，整块几乎看不见。改绑 `Color/primitive/bg-top`
   （`Scene/Backdrop` 的渐变 stop 本来就直接绑 bg-top / bg-bottom，跟文件既有做法一致）。

另加一处健壮性：99 · Archive 是非当前页，`page.children` 可能只部分水合，
幂等清理会漏 → 改用 `await figma.getNodeByIdAsync(pageMeta.id)` 强制水合，重跑不会叠两份。

**验收**
- `figma-v4-typecheck.mjs` 17/17 · `figma-v4-smoke-d2.mjs` 10/10 · `figma-v4-smoke-d1.mjs` 24/24
- `figma-aether-v4-audit.mjs` **34/36**（1 FAIL + 1 SKIP，与 D2 之前完全一致，基线未破；
  FAIL 是 03 页 v4-ABC 遗留屏的硬编码填充，SKIP 是 PAT 缺 `file_variables` scope）
- `figma-aether-v4-audit-d1.mjs` **18/18**（D2 未影响 D1）
- `Archive README` node id `489:2`，截图 `/tmp/maestro-d2-screens/archive-readme.png`
