# D5 — Tasks

> ⛔ **2026-10-24 归档本 spec 的待做项（Phase B / C 共 9 条）**
>
> **为什么归档**：这 9 条**全是 Figma 文件里的写操作**（跑 `use_figma` 段替换
> `D1-PLACEHOLDER-N` 为真实 node_id、在 Figma 端建 component set、把旧稿
> 提升成组件）—— **它们不产生任何 app 功能**，产出物是「设计稿与代码对齐」。
> 对个人开发者项目，ROI 递减到不值得占用「待办清单」这个位置。
>
> **为什么现在做**：盘点时发现待办清单里 60+ 条里有 32 条属于这一类
> （d5-code-connect 9 + d6-description-template 7 + figma-legacy-retrofit 16），
> **清单长度本身在稀释真待办的可见度** —— 真待办被埋在 32 条设计债里。
>
> **阻塞状态（如需复活再核）**：这些操作要走 Figma **写**权限 ——
> 云端 MCP 的 `use_figma` / `upload_assets` 在 Starter 团队有 20 次/月限额
> （2026-10-23 实测）。本仓没有 FIGMA_TOKEN（需用户自带）。
>
> **怎么复活**：把下面的 `[~]` 改回 `[ ]` 即可。仓库内的工具链**都还在**且是好的：
> `scripts/figma-code-connect-validate.mjs`（`npm run test:code-connect`，已接进 `test:ci`）、
> `scripts/figma-aether-v4-audit.mjs` 等 —— 缺的只是「有写权限的 Figma 账号」。

## Phase A — 仓库内工作（已完成）

- [x] **A1** `specs/d5-code-connect/spec.md` — 范围 + 验收 + schema 规范
- [x] **A2** `specs/d5-code-connect/tasks.md` — 任务跟踪
- [x] **A3** 写 `scripts/figma-code-connect-validate.mjs`（校验脚本）
- [x] **A4** 5 个 D1 映射 props 补全（基于 React Props 真实 schema）
- [x] **A5** 加 `npm run test:code-connect` + 接 `test:ci`
- [x] **A6** 跑 validate + typecheck + lint 全绿

## Phase B — D1 跑完后（用户操作）

- [~] **B1** 用户在 Claude Code 跑完 D1 6 段，记录返回的 `createdNodeIds`（格式：SEG1=Search@id1, SEG2=Liked@id2, ...）
- [~] **B2** 替换 `figma-code-connect.json` 里 6 个 `D1-PLACEHOLDER-N` → 真实 node_id
- [~] **B3** 删 `_d1Status` 字段
- [~] **B4** 跑 `node scripts/figma-code-connect-validate.mjs --strict` 确认
- [~] **B5** 在 Figma UI 选中 6 个 frame → Dev Mode → Code Connect 面板应显示 react 路径
- [~] **B6** 跑 `npm run test:ci` 跑通

## Phase C — 后续延后

- [~] **C1** Figma 端给 5 个 modal 组件加独立 component set（替代 D1 6 frame 里的 raw panel 节点）—— worktree 单独 PR
- [~] **C2** Card/Glass 槽位组件映射——v4 文档提过但剧场稿没建
- [~] **C3** Pact/Spectral API schema 契约——D6/D7 阶段
