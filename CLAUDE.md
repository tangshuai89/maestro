# Musicbox

跨平台音乐播放器（Electron + React + NestJS），聚合网易云/QQ 音乐/Deezer，DeepSeek 做 AI 推荐。

## 技术栈

- 桌面壳: Electron
- 前端: React + TypeScript + Vite
- 后端: NestJS (跑在 Electron main process 里)
- 包管理: npm workspaces (`packages/server`, `packages/renderer`, `packages/electron`)
- AI: DeepSeek API（用户自带 Key，存在本地）

## 架构约束

- 每个音乐平台一个 provider 类，实现 `MusicProvider` 接口（`common/provider.ts`）
- provider 放 `music/` 目录（如 `qq.provider.ts`, `netease.provider.ts`, `deezer.provider.ts`）
- 去重/合并/业务逻辑放 `music/music.service.ts`，不放 controller
- 所有外部 API 调用走 `axios`，超时 5 秒
- 类型定义放各自模块的 `types.ts`，共用类型放 `common/`
- 前端状态管理用 React hooks + context，不引入 Redux
- 所有平台凭据和 API Key 存在本地，不上传任何服务器（也没有服务器）
- 日志用 NestJS Logger，不用 `console.log`

## Specs 规则

写任何代码前，先检查 `specs/` 目录下是否有对应功能的 spec 文件。
如果有，严格按 spec 中的验收标准实现，不偏离。
实现完成后逐条勾选 `tasks.md` 中的任务。
如果 spec 下有 `design.md`，优先读它理解技术方案再动手。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动完整开发环境（server + renderer + electron） |
| `npm run build` | 构建全部三个包 |
| `npm test` | 跑测试 |
| `npm run lint` | 跑 lint |
| `npm run typecheck` | TypeScript 类型检查 |
