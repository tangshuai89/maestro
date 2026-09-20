# 测试计划入口

本目录是 Maestro 项目的测试规划文档：

- `spec.md` — 总览：测试策略（5 层）、现状基线、验收标准、改造路线图
- `tasks.md` — 按 Phase A→G 排好的可执行任务清单（每条都对应一个 PR 级别）

配套：
- `docs/_archive/audit-snapshots/ISSUES-2026-08-18.md` — 历史 issue 快照（已 ~1 月，大部分条目被后续 spec 消化）

执行：
```
npm run typecheck
npm run lint
npm test   # 在 sandbox 下需要 escalated 权限
```
