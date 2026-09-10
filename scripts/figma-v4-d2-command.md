# Figma v4-D2 落地指令 — 99 · Archive 顶部加 README frame

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
规范：`specs/d2-convergence/spec.md`（范围 + 验收）
构建脚本：`scripts/figma-aether-v4-archive-readme.js`（1 段 SEG1）
验收工具：`scripts/figma-aether-v4-audit.mjs`（跑 v4 原 23/25，确认 D2 不破坏）
父命令手册：`scripts/figma-v4-command.md`（v4-ABC 13 步 + D1 增量 + 此 D2 段）

## 任务

在 Figma `99 · Archive` 页**顶部**加一个 `Archive README` frame：
- 红色 4px outline（dashed）作为视觉警告
- 内容：「ARCHIVED — DO NOT EXTEND」+ 说明此页是 v3 Monster Beats 视觉稿作为设计基准保留
- 链接到 `03 · Screens · AETHER THEATER 剧场稿`（v4-ABC + D1 6 屏）

> 原因：D2 收敛（2026-09-10）删除 `MonsterBeatsView.tsx` 后，未来 contributor 打开 99 · Archive
> 可能误以为这是"待开发"页面。README frame 显式标注 ARCHIVED 状态避免误扩展。

## 前置条件

- v4-ABC 13 步已执行
- D1 6 屏已加（03 · Screens 有 10 个 frame）
- `99 · Archive` 页存在（v4 SEG0 归档时创建）

## Step 1 — 类型校验

```bash
node scripts/figma-v4-typecheck.mjs
```

必须 0 error（含 D2 SEG1）。

## Step 2 — Mock 冒烟

```bash
node scripts/figma-v4-smoke-d2.mjs
```

无需 FIGMA_TOKEN，mock 跑 D2 SEG1；必须全 PASS。

## Step 3 — 喂 use_figma（1 次调用）

| 步骤 | SEG | 目标 page | 内容 | 完成后验证 |
|---|---|---|---|---|
| D2-1 | SEG1 | 99 · Archive | Archive README frame | 截图 + 确认 y=-320（在所有 v3 frame 之上） |

参数：
- `currentPage` 不需要手切（脚本内自定位 `99 · Archive`）
- `code` 参数 = `scripts/figma-aether-v4-archive-readme.js` 里 `SEG1` 模板字符串内容（去掉外层 `` ` `` 包装）

## Step 4 — 验收

```bash
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit.mjs
```

确认 v4 23/25 基线不破（Archive README 是新 frame，不在原 audit 检查项；可能引起 Screen/ 计数变化但不影响核心 25 项）。

## Step 5 — 视觉确认

- 截图 99 · Archive 顶部，确认 Archive README frame 显眼（红色虚线 outline）
- 确认 README 文字正确（ARCHIVED — DO NOT EXTEND + 链接到 03 · Screens）

## 完成后

- 截图入 PR 描述
- 在 CHANGELOG.md 加 D2 收敛记录
