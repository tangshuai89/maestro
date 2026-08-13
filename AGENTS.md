# AGENTS.md

> Project context for AI coding agents (OpenCode, Claude Code, etc.).
> 写任何代码前先读 `specs/` 下对应功能的 `spec.md`，按验收标准实现。

## 项目

跨平台音乐播放器（Electron + React + NestJS），聚合网易云/QQ 音乐/Deezer/Spotify，DeepSeek 做 AI 推荐。

## 技术栈

- 桌面壳: Electron
- 前端: React + TypeScript + Vite
- 后端: NestJS (跑在 Electron main process 里)
- 包管理: npm workspaces (`packages/common`, `packages/server`, `packages/renderer`, `packages/electron`)
- AI: DeepSeek API（用户自带 Key，存在本地）

## 架构约束（硬性，违反即被打回）

- 每个音乐平台一个 provider 类，实现 `MusicProvider` 接口（`packages/common/src/provider.ts`）
- provider 放对应包的 `music/` 目录（如 `packages/server/src/music/qq.provider.ts`）
- 去重/合并/业务逻辑放 `music/music.service.ts`，**不放** controller
- 外部 API 调用统一用内置 `fetch`（不引 axios）。搜索/元数据类调用套
  `packages/common/src/timeout.ts` 的 `withTimeout`（单平台 5s，超时即缺席
  不阻塞其他平台）；音频/封面字节代理是**流式**的，**不设整体超时**（否则
  会掐断正在播放的歌）
- 类型定义放各自模块的 `types.ts`，共用类型放 `packages/common/src/`
- 前端状态管理用 React hooks + context，**不引入 Redux**
- 所有平台凭据和 API Key 存在本地，**不上传任何服务器**（也没有服务器）
- 日志用 NestJS Logger，**不用** `console.log`
- **跨包归一工具**（`fuzzyKey` / `stripFeatTags` / `stripParensContent` /
  `cjkUnify` 等）必须放 `packages/common/src/normalizer.ts`——server 的
  `mergeLibrary` 和 renderer 的 `groupLibraryItems` 共用，确保弹窗徽章 =
  server 实际合并结果。**禁止**在两端各写一份独立实现。

## Specs 规则（最重要的流程）

写任何代码前：

1. 检查 `specs/` 目录下是否有对应功能的 spec 文件
2. 有则**严格按** `spec.md` 中的验收标准实现，不偏离
3. 如果有 `design.md`，先读它理解技术方案再动手
4. 实现完成后**逐条勾选** `tasks.md` 中的任务
5. 跑 `npm run typecheck && npm run lint && npm test` 全绿

可直接使用的 opencode 命令：

| 命令 | 作用 |
|---|---|
| `/spec-implement <name>` | 按 `specs/<name>/` 实现该 spec |
| `/add-provider <platform>` | 新增一个音乐平台 provider |

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动完整开发环境（server + renderer + electron） |
| `npm run build` | 构建全部三个包 |
| `npm test` | 跑测试（`scripts/test.sh` 自动发现 `packages/*/src/**/*.test.ts`） |
| `npm test -- --watch` | 改文件自动重跑 |
| `npm run lint` | 全包 lint（renderer 走 eslint；其它包暂无 lint 规则） |
| `npm run typecheck` | TypeScript 类型检查（全 workspaces） |

## 关键路径速查

| 用途 | 路径 |
|---|---|
| 跨包归一工具 | `packages/common/src/normalizer.ts` |
| 跨包统一类型/接口 | `packages/common/src/` |
| Provider 接口 | `packages/common/src/provider.ts` |
| Provider 实现 | `packages/server/src/music/*.provider.ts` |
| 业务合并/去重 | `packages/server/src/music/music.service.ts` |
| 前端分组展示 | `packages/renderer/src/lib/groupLibrary.ts` |
| Specs 入口 | `specs/<feature>/spec.md` + `tasks.md`(+ `design.md`) |
