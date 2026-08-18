# 测试计划（Test Plan）— Maestro

> 生成时间：2026-08-18
> 运行环境：macOS，sandbox=workspace-write（听端口受限）
> 测试命令：`npm test`（脚本：`scripts/test.sh`，自动发现 `packages/*/src/**/*.test.ts`）

## 0. 目标

把现有 24 个测试文件、~455 个用例梳理成体系化的测试计划；找出目前测试未覆盖
的关键路径与潜在缺陷，把每一项风险落到可执行用例上，使
`npm run typecheck && npm run lint && npm test` 成为可信的发布门禁。

## 1. 现状（基线测量）

### 1.1 测试文件清单

| # | 包 | 文件 | 用例数 | 状态 |
|---|---|---|---|---|
| 1 | common | `artistAlias.test.ts` | 36 | OK |
| 2 | common | `normalizer.test.ts` | 178 | OK |
| 3 | server/auth | `reducer.test.ts` | 13 | OK |
| 4 | server/auth | `refresh-coordinator.test.ts` | 5 | OK |
| 5 | server/common | `storage.test.ts` | 6 | OK |
| 6 | server/match | `fuzzy.test.ts` | 10 | OK |
| 7 | server/match | `match.test.ts` | 24 | OK |
| 8 | server/music | `cross-platform-match.e2e.test.ts` | 35 | OK |
| 9 | server/music | `groupLibrary.test.ts` | 33 | OK |
| 10 | server/music | `library-badge-merge.e2e.test.ts` | 8 | OK |
| 11 | server/music | `library-import.e2e.test.ts` | 3 | OK |
| 12 | server/music | `like-sync.queue.purge.test.ts` | 3 | OK |
| 13 | server/music | `like-sync.queue.test.ts` | 4 | OK |
| 14 | server/music | `like.e2e.test.ts` | 13 | OK |
| 15 | server/music | `music.controller.stream.test.ts` | 3 | OK |
| 16 | server/music | `search-unified.e2e.test.ts` | 2 | OK |
| 17 | server/music | `search.test.ts` | 17 | OK |
| 18 | server/music | `qq.provider.test.ts` | 12 | OK |
| 19 | server/music | `translit.test.ts` | 8 | OK |
| 20 | server/music | `lyrics-aggregate.e2e.test.ts` | — | OK |
| 21 | server/music | `spotify.test.ts` | — | OK |
| 22 | server/reco | `reco.test.ts` | 23 | OK |
| 23 | electron | `login-window-runner.test.ts` | 9 | OK |
| 24 | electron | `oauth-buffer.test.ts` | 12 | OK |

> **基线结论**：`npm test` 在 escalated 权限下 24/24 文件全绿，~455 个用例
> 全部通过。sandbox 默认权限下 `like.e2e.test.ts` 因 `listen EPERM` 失败——
> 见 [docs/ISSUES.md](../../docs/ISSUES.md) §3.1。

### 1.2 覆盖率热力图（粗估）

```
packages/
|-- common/                     *****  覆盖充分（normalizer 178 + alias 36）
|
|-- server/
|   |-- common/                 ***    storage / session 有测试，guards / backup / lyrics 缺
|   |-- auth/                   ***    reducer/refresh 有，strategy/controller 缺
|   |-- match/                  ****   fuzzy/match 双层有
|   |-- music/                  ***
|   |     qq.provider.test     **     仅 g_tk 计算；search/fetchRadio/stream 没单测
|   |     spotify.test          **     仅 OAuth+refresh 部分；search/like/WPS 没单测
|   |     deezer.provider       *      零测试
|   |     netease.provider      *      零测试
|   |     lyricsovh.provider    *      零测试
|   |     music.service.ts      **     业务大文件（3078 行），仅靠 e2e 兜底
|   |     music.controller.ts   **     仅 stream 3 用例；其他路由无测试
|   |-- reco/                   ****   reco.test 23 项充分
|
|-- electron/                   **
|   |-- auth/                   ****   login-window-runner / oauth-buffer 双覆盖
|   |-- main.ts                 *      零测试
|   |-- preload.ts              *      零测试
|
|-- renderer/
    |-- api.ts                  **     通过 e2e 间接
    |-- hooks/*                 *      usePlayer/useCoverArt 等关键 hook 零单测
    |-- lib/*                 *      groupLibrary/storage/spotify-wps 等零单测
    |-- components/*            *      UI 零测试
```

## 2. 测试策略（5 层）

### 2.1 L1 — Pure unit（无 IO）

覆盖目标：纯函数、归一、匹配、状态机。

**已有**：common 全部、match 全部、auth reducer。

**待补**：
- `packages/server/src/common/lyrics.ts`（`parseLrc`）
- `packages/server/src/music/qq-crypto.ts`（剩余 encrypt/decrypt 路径）
- `packages/server/src/common/session.ts`（cookie 解析、tier 推断）
- `packages/server/src/music/search.util.ts`（bestSource 选取 / dedup）

### 2.2 L2 — Provider unit（mock fetch）

每个 provider 一个 `*.provider.test.ts`，用 `undici` `MockAgent` 覆盖
search/like/getStreamPath 等。

**已有**：`qq.provider.test`（仅 g_tk 计算）、`spotify.test`（仅 OAuth）。

**待补**：
- `qq.provider.test`：search 命中 / 空结果 / pay_play 标记 / fetchRadioBatch /
  getStreamPath（vkey 过期 -> 401 重取）/ getLyrics
- `netease.provider.test`：search / getStreamPath / fetchLiked / VIP 推断
- `deezer.provider.test`：search / preview URL 解析 / 各 preset
- `lyricsovh.provider.test`：fetch + LRC 解析
- `spotify.provider.test` 扩展：search / like / fetchLiked / WPS tier
  路由（premium/free）

### 2.3 L3 — Service e2e（不 listen）

`music.service.ts` 的核心业务方法用 NestJS `Test.createTestingModule`
起容器但不开 HTTP，针对每一段业务打桩 provider。

**已有**：cross-platform-match、groupLibrary、library-badge-merge、
library-import、like-sync.queue、search-unified、lyrics-aggregate。

**待补**：
- `getNextTrack` 流控（refill 失败 -> placeholder / queue 仍空 -> 占位）
- `markDisliked` / `dislikeMerged` 在不同 platform 集合下的合并
- `findPlayableEquivalent` 的 priority 边界（qq 不可播 -> 跳 netease）
- `importLiked` 中失败平台不污染 importedAt
- `getLyricsAggregated` 的缓存命中 / miss
- `fanOutLike` 中方向反转 + skip-enqueue 的边界

### 2.4 L4 — Controller e2e（listen 0 或 supertest）

**已有**：like.e2e.test.ts（13 用例）、music.controller.stream.test（3 用例）、
library-import.e2e.test.ts（3 用例）。

**待补**：
- `/music/search` 输入清洗（XSS 字符 / 空串 / 超长）
- `/music/lyrics/aggregate` cache hit
- `/music/library` 漏掉 fanOut / 脏数据
- `/music/deezer/preset` 切换持久化
- `/music/dislike/merged` 路由顺序
- `/auth/*` controller + guard（`RequireInternalTokenGuard` 校验）

### 2.5 L5 — 跨包契约

AGENTS.md 硬约束：「跨包归一工具必须在 `packages/common/src/normalizer.ts`，
server 的 `mergeLibrary` 和 renderer 的 `groupLibraryItems` 共用」。需要
一组**契约测试**，从两端发同样的输入，断言归一结果一致。

**待补**：`specs/test-plan/contract.test.ts`：
- 同一首歌在 server normalizeKey 与 renderer displayKey 同值
- 同一组 sources 在 server mergeLibrary 与 renderer groupLibraryItems
  同 grouping（key/member 数/representative 选取）

## 3. 测试执行规范

### 3.1 三连门禁

```
npm run typecheck   # 必须 0 error
npm run lint        # 必须 0 error
npm test            # 必须 0 fail
```

### 3.2 sandbox 听端口问题

`like.e2e.test.ts` 调 `app.listen(0)`，sandbox 默认禁止听端口。两种修法：

- **短期（推荐）**：CI / 本机使用 escalated 权限跑 `npm test`。
- **长期**：把 `app.listen(0)` 改成走 `app.getHttpServer()` 直接挂
  supertest agent，无需真实端口（见 §5 改造）。

### 3.3 计时敏感用例

`like-sync.queue.test.ts` 的退避测试每次 ~33s；`search.test.ts` 触发
kuromoji 首次预热 ~2s。所有依赖时钟 / 网络的用例必须可注入 fake timer
或 fake clock，禁止 hard sleep。

### 3.4 Console 输出

测试用例内禁用 `console.log/error`，统一走 NestJS `Logger` 或
`process.stdout.write`，避免污染 CI 日志。

## 4. 验收标准

### 4.1 通过门槛（DoD）

- [ ] `npm test` 在 sandbox 默认权限下全绿（不再 EPERM）。
- [ ] 上述 L2/L3 待补条目**至少完成 70%**。
- [ ] L5 契约测试至少 5 用例全绿。
- [ ] 每个 provider 至少有一个 happy path + 一个 5s 超时缺席 单测。
- [ ] 每个公共 controller 路由至少一个 200 + 一个 4xx e2e。

### 4.2 失败门槛

- 任何用例 skip / todo 必须有 issue 关联，否则 CI 拒绝 merge。

## 5. 改造路线图（建议）

1. **修 EPERM**：`like.e2e.test.ts` 改为 supertest；新增
   `controller-supertest.shim.ts`。
2. **新增 L2**：qq/netease/deezer/lyricsovh 四个 provider 补单测。
3. **新增 L5**：跨包契约测试，堵住 server/renderer 归一漂移。
4. **新增 L3 边界**：`findPlayableEquivalent`、`fanOutLike` 反转边界、
   `importLiked` 失败平台污染。
5. **新增 L4 路由**：`/auth/*`、搜索清洗、preset 路由的 e2e。
6. **（可选）L6**：Playwright 端到端，覆盖渲染层 + electron 启动。
