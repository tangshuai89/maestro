# docs/_archive

> 历史快照与废稿归档。**不在主文档树**——减少每轮 context 噪声、避免新读者误用。

## 规则

1. **不要在此目录写新东西**——只在归档时新增文件。
2. **不要改归档文件内容**（即使过期）——保持快照原貌，方便后续 diff 找历史。
3. **新读者请直接忽略本目录**——存在只是给"考古"留个去处。
4. **清理节奏**：每年（或大版本前）扫一次本目录，询问作者"可彻底删？"→ 真删。

## 子目录

| 目录 | 用途 |
|---|---|
| [`audit-snapshots/`](./audit-snapshots/) | 全仓审计/ISSUE 快照（带生成日期） |
| [`figma-history/`](./figma-history/) | Figma 设计稿早期版本（v1 / v2 / v3 已废，v4 是当前） |
| [`qq-data-snapshots/`](./qq-data-snapshots/) | QQ 红心 / 艺人映射的一次性导出 |

## SoT（不在本目录的当前权威）

- 设计系统契约：`docs/figma-driven-frontend.md`（Figma ↔ CSS 映射表）
- Figma 构建命令：`scripts/figma-v4-command.md`（v4-ABC 13 步主流程）
- 当前 spec：`specs/<feature>/{spec.md, tasks.md, design.md}`
