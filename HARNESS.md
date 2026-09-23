# Harness 入口速查

> 三 harness（opencode / Claude Code / Codex）共用同一份项目事实入口
> [`CLAUDE.md`](./CLAUDE.md)（技术栈、架构约束、Specs 规则、常用命令）。
> 本文件只列 harness 专属的入口约定，避免来回切换时迷路或引用漂移。
>
> 维护原则：**harness 间同义引用必须完全一致**（如 `add-provider` 的
> command 与 SKILL 是 1:1 镜像）。改任何一份都要同步另一份，并更新本表。
> 改完跑 `grep -rn "packages/.*/src/" .opencode/ .claude/ AGENTS.md` 自查。

## 一图流

| Harness | slash 命令 / 自然语言 | sub-agent / workflow | 项目事实 | 配置 / MCP |
| --- | --- | --- | --- | --- |
| **opencode** | `.opencode/command/*.md` | `.opencode/agent/*.md` · `.opencode/skill/*/SKILL.md` | `CLAUDE.md` | `opencode.json` · `.opencode/plugin/*.ts` |
| **Claude Code** | `.claude/workflows/*.md` | — | `CLAUDE.md` | `.claude/settings.json` · `.mcp.json` |
| **Codex** | （无 slash 命令；直接读 `CLAUDE.md` + `specs/`） | `memories` feature 自管 | `CLAUDE.md` | `.codex/config.toml` · `.mcp.json` |

## 顶层入口文档

| 文件 | 谁读 | 内容 |
| --- | --- | --- |
| `CLAUDE.md` | **三个 harness 都读** | 技术栈、架构约束、Specs 规则、常用命令——**项目事实单一来源** |
| `AGENTS.md` | opencode + claude | 入口说明 + opencode 专用命令速查 + 关键路径 |
| `HARNESS.md`（本文件） | 三个 harness 都读 | harness 专属入口 + 路径引用纪律 |

> ⚠️ **`AGENTS.md` 与 `CLAUDE.md` 是同一份事实的两种入口**，故意不重复内容。
> 改 `CLAUDE.md` 时一般**不用**动 `AGENTS.md`；改 `AGENTS.md` 的「opencode 命令」
> 段时如果新增/删除了命令，要让 `CLAUDE.md` 不冲突。

## 路径引用纪律（harness 间必须一致）

跨包路径在所有 harness 的 SKILL / command / agent / workflow / README / 文档里
写法必须统一。事实由 `CLAUDE.md`「架构约束」段钉死：

| 文件 / 工具 | 唯一正确路径 | 常见错误 |
| --- | --- | --- |
| `MusicProvider` 接口 | `packages/common/src/provider.ts` | ❌ `packages/server/src/common/provider.ts` |
| `withTimeout` 工具 | `packages/common/src/timeout.ts` | ❌ `packages/server/src/common/timeout.ts` |
| 跨包归一工具（`fuzzyKey` / `stripFeatTags` / `stripParensContent` / `cjkUnify` 等） | `packages/common/src/normalizer.ts` | ❌ 在 server / renderer 各写一份 |
| provider 实现 | `packages/server/src/music/<platform>.provider.ts` | ❌ 写到 `packages/server/src/<platform>/` |
| 跨包类型 | `packages/common/src/<thing>.ts` | ❌ 散落在 server / renderer |

**自查命令**：

```bash
# 列出 harness 间所有 packages/*/src/ 引用
grep -rn "packages/[a-z]*/src/" .opencode/ .claude/ AGENTS.md HARNESS.md

# 列出所有 grep 命中，按文件分组；任何"看起来像路径但不在上面正确表里"的命中都要复查
```

## 改动某个 harness 入口时

1. **改 SKILL**：先确认同义 command（如 `.opencode/skill/<x>/SKILL.md` 与
   `.opencode/command/<x>.md`）—— 修改两份，或在 PR 描述里说清"为什么只改一份"
2. **改 workflow**（Claude）：单文件即可，无镜像
3. **改 agent 提示词**（opencode sub-agent）：单文件即可
4. **改 `CLAUDE.md`**：原则上不动 AGENTS.md / HARNESS.md；只在 harness 入口本身
   改了（如新增 harness 专属命令）时才同步本表
5. **改本表（HARNESS.md）**：确保表格与目录里实际存在的文件一一对应；用 `ls` 验

## 已知边界

- **Codex 没有项目级 slash 命令**——直接读 `CLAUDE.md` + 当前任务的 `specs/<x>/spec.md`
  即可。Codex 自己的 `memories` feature 会跨会话沉淀偏好，不需要单独维护
- **opencode plugin**（`.opencode/plugin/*.ts`）会在工具调用后被动跑（不是 prompt）
  —— 改了之后要重启 opencode 进程才生效
- **跨 harness 文档漂移历史**：见 `git log --grep "docs(readme)\|harness\|drift"`
  —— 之前的教训是 README.md / README.zh-CN.md / README.ja.md 漂移；现以
  `CLAUDE.md` 为单一事实入口
