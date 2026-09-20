# AGENTS.md

> AI coding agents (OpenCode / Claude Code / etc.) 的入口。
> **项目说明、技术栈、架构约束、Specs 规则、常用命令**全部见
> [`./CLAUDE.md`](./CLAUDE.md)——单一事实来源，避免双文件漂移。
> 本文件只保留 **opencode 专用命令**，因为 CLAUDE.md 故意不写。

## opencode 命令

| 命令 | 作用 |
|---|---|
| `/spec-implement <name>` | 按 `specs/<name>/` 实现该 spec |
| `/add-provider <platform>` | 新增一个音乐平台 provider（详见 `.opencode/skill/add-provider/SKILL.md`） |

> 命令背后具体步骤见 `.opencode/skill/<name>/SKILL.md`。
> 等价的 Claude Code slash-command 见 `.claude/workflows/`。

## 关键路径速查（CLAUDE.md 未列的 agent 实用指针）

| 用途 | 路径 |
|---|---|
| OpenCode agent 角色（git-commit / pr-reviewer / spec-reviewer / test-runner） | `.opencode/agent/*.md` |
| OpenCode skill 入口 | `.opencode/skill/<name>/SKILL.md` |
| Claude Code workflow | `.claude/workflows/*.md` |
| 设计简报 / SuperDesign 输入 | `.superdesign/` |
| 一次性快照 / 历史草稿（**勿当真值**） | `docs/_archive/`（审计/ISSUE/Figma 历史/QQ 数据快照均已归档） |
