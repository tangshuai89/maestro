# Maestro

跨平台音乐播放器（Electron + React + NestJS），聚合网易云/QQ 音乐/Deezer/Spotify，DeepSeek 做 AI 推荐。

## 技术栈

- 桌面壳: Electron
- 前端: React + TypeScript + Vite
- 后端: NestJS (跑在 Electron main process 里)
- 包管理: npm workspaces (`packages/common`, `packages/server`, `packages/renderer`, `packages/electron`)
- AI: DeepSeek API（用户自带 Key，存在本地）

## 架构约束

- 每个音乐平台一个 provider 类，实现 `MusicProvider` 接口（`packages/server/src/common/provider.ts`）
- provider 放 `packages/server/src/music/` 目录（如 `qq.provider.ts`, `netease.provider.ts`, `deezer.provider.ts`, `spotify.provider.ts`）
- 去重/合并/业务逻辑放 `packages/server/src/music/music.service.ts`，不放 controller
- 外部 API 调用统一用内置 `fetch`（不引 axios，减少打包依赖）。搜索/元数据类
  调用套 `packages/server/src/common/timeout.ts` 的 `withTimeout`（单平台 5s，超时即缺席不阻塞其他
  平台）；音频/封面字节代理是流式的，**不设整体超时**（否则会掐断正在播放的歌）
- 类型定义放各自模块的 `types.ts`，共用类型放 `packages/common/src/`
- 前端状态管理用 React hooks + context，不引入 Redux
- 所有平台凭据和 API Key 存在本地，不上传任何服务器（也没有服务器）
- **用户数据（`library:*` / `music:*` / `playlists:*` / `reco:*`）按 session id 分片存在
  `.storage/state.json`**。session 由**签名 cookie**（`mb_session`，`SESSION_SECRET` 签）
  认；cookie 一旦没带上（应用重启、渲染层 origin 变化、secret 变了），服务端就**新建
  session 并用 `Set-Cookie` 覆盖旧 cookie** → 用户的 ❤ 库/红心/推荐历史**在当前会话里
  全部"人间蒸发"**（数据还在磁盘上，只是挂在旧 session 名下）。
  - 排查这类"数据不见了"：**先看磁盘上数据还在不在**（`library:<旧id>`），再比对
    当前 session id 与数据的 session id 是否一致——**不要**直接当成"数据丢了"去重导。
  - 用户可见症状：`GET /reco/status` → `librarySize: 0`；NL 歌单 → `library_empty`。
  - dev 的 `packages/server/.env` 与打包版（`~/Library/Application Support/Maestro/.storage`）
    是**两套独立存储**，两者互不可见。
- 日志用 NestJS Logger，不用 `console.log`
- **跨包归一工具**（fuzzy key / stripFeatTags / stripParensContent / cjkUnify 等）
  必须放 `packages/common/src/normalizer.ts`——server `mergeLibrary` 和 renderer
  `groupLibraryItems` 共用，确保弹窗徽章 = server 实际合并结果。**禁止**在两端
  各写一份独立实现（独立迭代会导致前后端 key 漂移）。
- **用户意图必须作用在"检索层"（候选集），不能只写进 prompt**——当候选池是
  硬目录约束时，prompt 里的软提示等于没有：模型面对 40 首全是流行，它变不出
  爵士。NL 歌单的流派要变成**检索种子**（流派 → 代表艺人 → 平台真实目录），
  LLM 只负责在已符合风格的候选里策展。详见 `specs/nl-intent-retrieval/`。
- **改 NL 检索（`packages/server/src/reco/**`）必须先跑离线评测并把对比数字
  贴进 PR 说明**——`npm run reco:eval:offline`（0 元 / 0 网络 / 确定性，PR 门禁
  主体）。纯度下降就是回归，不接受"看起来还行"。改完还要跑
  `npm run reco:eval:genre`（花钱，真实链路）做最终确认。
  **评测自己的准则**：门禁必须能主动抓出坏改动（`eval-invariants.test.ts` 里的
  反向验证就是干这个的）——一个永远绿的门禁等于没有门禁。
  详见 `specs/eval-driven-nl/`。

## Specs 规则

写任何代码前，先检查 `specs/` 目录下是否有对应功能的 spec 文件。
如果有，严格按 spec 中的验收标准实现，不偏离。
实现完成后逐条勾选 `tasks.md` 中的任务。
如果 spec 下有 `design.md`，优先读它理解技术方案再动手。

## 常用命令

| 命令                        | 用途                                             |
| --------------------------- | ------------------------------------------------ |
| `npm run dev`               | 启动完整开发环境（server + renderer + electron） |
| `npm run build`             | 构建全部三个包                                   |
| `npm test`                  | 跑测试                                           |
| `npm run lint`              | 跑 lint                                          |
| `npm run typecheck`         | TypeScript 类型检查                              |
| `npm run reco:eval`         | 推荐离线评测（留一法，不花钱）                   |
| `npm run reco:eval:genre`   | NL 歌单风格纯度评测（花钱，真实链路）            |
| `npm run reco:eval:offline` | NL 检索离线回放评测（不花钱，PR 门禁主体）       |
