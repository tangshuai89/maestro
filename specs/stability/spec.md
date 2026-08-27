# Stability — 稳定性提升专项

> 目标：清掉审计后确认的剩余稳定性缺口，让项目达到"可发版"质量基线。
> 审计基线：2026-08-27，4 路 subagent 逐条对照代码与文档后核实。
> PR #66 已修正文档滞后（29 项补勾 + 3 处路径修正），本 spec 只列**真正没做**的项。

## 范围

两类：

1. **环境/账号阻塞**（A 组）— 代码已就位，缺外部凭据，非代码 bug
2. **测试覆盖缺口**（B-G 组）— `specs/test-plan/tasks.md` 审计后确认仍未做的 15 项

## 不在范围

- NEXT-ITERATION.md 里的功能/体验计划（Settings、Lite 模式、歌词聚合、EQ、桌面歌词、NL 歌单等）— 那些是功能迭代，不是稳定性
- 已修的 bug（`cross-platform-match.e2e.test.ts:250` 的 BUG 注释是已修行为留档）

## 验收标准

- A 组：A1 EVS 签名后 Premium 播整曲成功；A2 `npm run pack` 出 dmg
- B-G 组：15 项全部勾选，`npm test` 全绿，覆盖率 ≥60% 行（G3 落地后）
- 整体：`npm run typecheck && npm run lint && npm test` 全绿

## 执行顺序建议

按"小工作量优先、快速清缺口"排序：

1. **G2 + G3**（CI 子命令 + 覆盖率门禁）— 先搭好基础设施，后续补测试自动受益
2. **D4 + D6 + C1**（controller 路由 + service 流控，3 项小工作量）
3. **B3 + B4**（deezer + lyricsovh provider 单测，文件小）
4. **E1 + E2**（跨包契约测试 — 架构约束最强调的"前后端 key 不漂移"）
5. **B1 + B5 + B2**（provider 单测扩展/新建，锁住平台 API 解析回归）
6. **F1 + F2 + F4**（renderer hooks 测试，最后补）

## 风险

- A1 Apple Dev 审批 1-3 天，**尽早提交申请**，不阻塞 B-G 组并行推进
- B2 netease provider 涉及 csrfToken 刷新逻辑，单测需 mock 较多
- E1/E2 跨包契约测试需同时引用 server + renderer 的归一实现，注意 workspace 依赖路径
- F 组 renderer hooks 测试需 jsdom 环境，确认 `scripts/test.sh` 能发现并运行
