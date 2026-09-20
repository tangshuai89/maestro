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

- [x] **B1** 跑 SEG1 + SEG2 —— 2026-09-20 由 Codex 直接通过 Figma MCP `use_figma` 执行
      （OAuth 已通，不需要 PAT）。**跑之前先修掉 3 个真 bug，见下方执行记录。**
- [x] **B2** 收集 10 个 component set nodeId：
      `Modal/Shell=514:72` · `Modal/ErrorPanel=514:88` · `Modal/RecoLoading=514:97` ·
      `SourceChip=514:110` · `Layout/QualityMenu=514:120` · `Layout/SourceMenu=515:82` ·
      `Layout/DeezerPresetSelect=515:92` · `Screen/SourceSelect=515:133` ·
      `Titlebar=515:161` · `Modal/NeteaseCookie=515:192`
- [x] **B3** 注入完成（TBD-FIGMA → 真实 nodeId，`_status` 统一 D1_DONE，删 `_note`）
- [x] **B4** `figma-code-connect-validate.mjs --strict` → **110/110 PASS**
- [x] **B5** `figma-aether-v4-audit.mjs` → **34/36（1 FAIL + 1 SKIP）**，与 D2/D10 基线逐项一致，未破
- [x] **B6** 视觉抽查：`get_screenshot(515:133)` — SourceSelect 两个变体渲染正常
      （empty 4 张卡 + 标题；ready 态 Q 卡描边转 `status-sync` 绿），无品红、无错位。
      10 个 set 的全量截图未做（如需入 PR 描述可再跑）

## Phase C — 后续

- [ ] **C1** v4 audit `EXPECTED_SETS` 加 10 个 D5_NEW 组件名（防未来误删）
- [ ] **C2** 任何新建组件的 PR 必含 component-specs.md 更新 + strict audit PASS

## Phase B 执行记录（2026-09-20）

**跑之前先只读探测，抓到 3 个会让整段回滚的真 bug**（mock 全都测不出来）：

1. **引用了不存在的变量**：`Layout/QualityMenu` 的 high 态描边写 `varFill('Color/semantic/accent-soft')`，
   而文件里**没有**这个变量 → `varColor` 回退**品红哨兵** `{r:1,g:0,b:1}`。
   这是 D2 踩过的同一个坑。修法：改用 `{ ...ACCENT, opacity: 0.55 }`（accent 变量 + 55% 透明度）。
   顺带**没有**去新建该变量 —— 那会让生成层多出 `--accent-soft` 并覆盖手写的 Plexamp 蓝（见 D4）。
2. **`setProperties` 打在 COMPONENT 上**：`node.setProperties: no such property 'setProperties' on
   COMPONENT node`（实测）——该方法只属于 INSTANCE，且 Figma 会让**整段事务回滚**。
   两处（QualityMenu / SourceMenu）都改成只用 `addComponentProperty` 的默认值。
3. **`componentPropertyReferences` 设置早于 `appendChild`**：违反 v4-command.md §沙箱实测规则 3
   （必须先挂进组件树 → 再 addComponentProperty → 最后设引用）。ErrorPanel 两处顺序已调正。

**mock 同构化**（三处，否则下次还会漏）：

- 变量清单不再手写，直接读 `scripts/figma-tokens-dump.json`（真实文件的 dump）
- `setProperties` 加类型守卫：非 INSTANCE 抛与真实 API 相同的错
- `componentPropertyReferences` 加守卫：节点还没挂进组件树就赋值 → 抛错
- 新增断言「无品红哨兵」，把"引用了不存在的变量"变成可见失败

**注入器修复**：`figma-code-connect-inject.mjs` 原来用 `JSON.stringify(map, null, 2)` 整文件重写，
把内联对象全部展开 —— 10 个字段的替换变成 **477 行 diff**（376 insertions / 101 deletions），
正踩中仓库 commit 规范点名的"混入格式化"。改成定点文本替换后同样内容只有 **21 行 diff**，
strict 仍 110/110。

**跑完回读校验**：24 个 component set（14 旧 + 10 新）、28 变体、description 全含 AI_CONTRACT、
品红哨兵 0 处。
