# Figma v4-D1 落地指令 — Modal/Full 屏幕（喂给 Claude Code / use_figma）

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
规范：`specs/d1-screens/spec.md`（范围 + 验收）+ `specs/d1-screens/design.md`（每屏 AI CONTRACT 草稿）
构建脚本：`scripts/figma-aether-v4-screens-d1.js`（6 段 SEG1-6）
验收工具：`scripts/figma-aether-v4-audit-d1.mjs`（需要 FIGMA_TOKEN）
父命令手册：`scripts/figma-v4-command.md`（v4-ABC 13 步 + 此 D1 增量）

## 任务

在 v4-ABC 剧场稿基础上，**给 03 · Screens 补 6 个 frame**：
- `Screen/Search/Modal`（modal 弹层）
- `Screen/Liked/Modal`（modal 列表）
- `Screen/Settings/Full`（全屏）
- `Screen/RecoKey/Modal`（modal 表单）
- `Screen/AuthError/Full`（全屏错误恢复）
- `Screen/EmptyState/Full`（空态）

全部用 02 页 v4 已建 11 组件集 + 8 SVG icon + `Scene/Backdrop` 实例组装，**不引新组件**。

## 前置条件

- v4-ABC 13 步已执行（`figma-aether-v4-{foundations,icons,components,screens,motion,snapshot}.js` 全跑通）
- 02 页有这 11 组件集：`Ring/Sound`/`Hologram/Cover`/`Lyrics/Line`/`Core/Play`/`Button/Icon`/`Badge/Platform`/`Tag/Stat`/`Ring/Progress`/`Card/Neural`/`Controls/Transport`/`Button/Like`
- 02 页有 `Scene/Backdrop` 组件
- 02 页有 8 个 SVG icon 组件：`Icon/Prev`/`Icon/Next`/`Icon/Play`/`Icon/Pause`/`Icon/Shuffle`/`Icon/Repeat`/`Icon/Heart`/`Icon/Search`

## Step 0 — 现状快照

1. 跑 `node scripts/figma-aether-v4-snapshot.js SEG1` 确认 02 页 11 组件集 + Scene/Backdrop 都在
2. 截图当前 03 · Screens 页（应见 Playing/Paused/Buffering/SourceSelect 4 帧）

## Step 1 — 类型校验

```bash
node scripts/figma-v4-typecheck.mjs
```

必须 0 error 才能继续。

## Step 2 — Mock 冒烟

```bash
node scripts/figma-v4-smoke-d1.mjs
```

无需 FIGMA_TOKEN，mock 跑 6 段；必须全 PASS（6/6 + 12 断言）。失败立刻停下，不要喂 use_figma。

## Step 3 — 喂 use_figma（6 次独立调用）

每次调用：
- `currentPage` 不需要手切（脚本内自定位 `03 · Screens`）
- `code` 参数 = `scripts/figma-aether-v4-screens-d1.js` 里 `SEG{N}` 模板字符串内容（去掉外层 `` ` `` 包装）
- 每次调用 ≤10 逻辑操作（D1 每段 40-60 节点，单段可能触沙箱 50KB 上限；若报操作数/超时错，按 SPEC 段内分区拆 2 段重跑）

| 步骤 | SEG | 目标 page | 创建 frame | 完成后验证 |
|---|---|---|---|---|
| 1 | SEG1 | 03 · Screens | Screen/Search/Modal | 截图 modal 弹层 + 确认 x=1480 |
| 2 | SEG2 | 03 · Screens | Screen/Liked/Modal | 截图 列表行 + 确认 x=2960 |
| 3 | SEG3 | 03 · Screens | Screen/Settings/Full | 截图 3 section + 确认 x=4440 |
| 4 | SEG4 | 03 · Screens | Screen/RecoKey/Modal | 截图 表单 + 确认 x=5920 |
| 5 | SEG5 | 03 · Screens | Screen/AuthError/Full | 截图 错误码 tag + 5 按钮 + 确认 x=7400 |
| 6 | SEG6 | 03 · Screens | Screen/EmptyState/Full | 截图 居中 illustration + CTA + 确认 x=8880 |

每步完成后：
- 用 get_screenshot 验证视觉与 v4-ABC 一致
- 保留返回的 createdNodeIds 供后续引用

## Step 4 — 验收

```bash
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit-d1.mjs
```

全 PASS 才算完成。FAIL 项按报告修。

**D1 阈值**（与原 v4-audit 不同）：
- 03 页自有填充变量绑定率 ≥ **70%**（modal 屏更简单，阈值比 v4 高）
- 03 页实例内填充变量绑定率 ≥ **30%**（与 v4 一致）
- 6 屏都含 `AI_CONTRACT` TEXT 子节点（`visible=false`），内容含 `AI_CONTRACT:` / `react:` / `a11y:`
  ——FRAME 没有 `description` 属性，别再往 `screen.description` 写
- 6 屏与 03 页其他 Screen frame 无包围盒重叠（脚本内强约束：x=1480/2960/4440/5920/7400/8880，**y=1000**；
  y=0 那一行已被 v4-ABC 的 12 屏占满 x 0→17160）

## Step 5 — 回归原 v4 审计

```bash
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit.mjs
```

确认 D1 没破坏 v4-ABC 23/25 的基线（应该是 23/25 → 24+/25，组件集 + 屏幕数 + 变量数都会涨，但 PASS 项不能掉）。

## 沙箱规则（与 v4 同）

1. DROP_SHADOW 必须 `blendMode: 'NORMAL'`；LAYER_BLUR/BACKGROUND_BLUR 不接受 blendMode
2. `figma.createComponent()` 自动落到 currentPage（每次调用重置为第一页）——段内必须自定位 `03 · Screens` 后再创建
3. `setValueForMode` 只收裸值：COLOR 传 {r,g,b,a}；VARIABLE_ALIAS 带 type 字段
4. interactions 无法通过插件 API 写入（v4 已知限制）——D1 屏幕间跳转的 prototype wiring 不在 D1 范围，留 D3 手动

## 完成后

- 截图 6 个新 frame 入 PR 描述
- 在 figma-code-connect.json 加 4-5 个新映射（Modal / RecoKeyModal / SettingsModal / LikedLibraryModal / SearchPanel）——非强制但建议同步

## 不在 D1 范围

- 新增组件（避免又一轮 components SEG 回归）
- 原型连线（12 条 prototype wiring，Figma UI 手动）
- 1280/1920 尺寸帧（D9 后续）
- 视觉双世界收敛（D2 独立决策）
