# Test Plan — Tasks

按依赖顺序排列。每条任务都对应一个 PR 级别。

## Phase A — 修门禁（最高优先级，发布阻塞）

- [x] **A1** `like.e2e.test.ts` 改为 supertest
  - [x] 2026-08-18 完成：用 `src/test-helpers/in-process-http.ts` 自实现不 listen 的 HTTP helper（构造 fake IncomingMessage/ServerResponse，调 http.Server 的 request listener，绕过 sandbox 听端口限制）；13/13 项全绿，sandbox 默认权限下通过。
  - 用 `app.init() + app.getHttpServer()` 拿 server 实例
  - 不再 `app.listen(0)`
  - 受影响文件：`packages/server/src/music/like.e2e.test.ts`
  - 验收：`scripts/test.sh` 在 sandbox 默认权限下能跑完整轮 e2e

- [x] --NOTE-- **A2** `library-import.e2e.test.ts` 同样改 supertest
  - 2026-08-18 核查：library-import.e2e.test.ts **未使用** `app.listen(0)`，直接 stub provider 后调 service —— 无需改。A1 的 helper 也可选用，但当前实现已通过测试。
- [x] --NOTE-- **A3** `search-unified.e2e.test.ts` 同样改 supertest
  - 2026-08-18 核查：search-unified.e2e.test.ts 同上，未 listen。
- [x] --NOTE-- **A4** `lyrics-aggregate.e2e.test.ts` 同样改 supertest
  - 2026-08-18 核查：lyrics-aggregate.e2e.test.ts 同上，未 listen。
- [x] --NOTE-- **A5** 把所有 e2e 改完后，`scripts/test.sh` 加 `--require-escalated`
  - 2026-08-18 决议：取消 A5。music.controller.stream.test.ts 的 `srv.listen(0)` 是它测试的核心机制（验证 stream error listener），不能直接替成 in-process；改为 CI escalate 权限运行即可。
  标记检测（可选；不强求）

## Phase B — Provider L2 单测（覆盖度 +20%）

- [ ] **B1** `qq.provider.test.ts` 扩展到 ~30 用例
  - search 命中 / 空结果 / pay_play 推断 / VIP 推断
  - fetchRadioBatch 8 个 seed 轮转
  - getStreamPath：vkey 过期 -> 401 重取
  - getLyrics LRC 解析

- [ ] **B2** `netease.provider.test.ts`（新建，~25 用例）
  - search / getStreamPath / fetchLiked
  - VIP 推断 / csrfToken 刷新

- [ ] **B3** `deezer.provider.test.ts`（新建，~15 用例）
  - 各 preset editorial id 映射
  - preview URL 提取
  - 404 / 5xx 兜底

- [ ] **B4** `lyricsovh.provider.test.ts`（新建，~10 用例）
  - 命中 / 未命中 / 同步/异步时间戳

- [ ] **B5** `spotify.test.ts` 扩展到 ~30 用例
  - OAuth 之外覆盖 search / like / fetchLiked / WPS tier 路由

## Phase C — Service L3 边界补强

- [ ] **C1** `getNextTrack` 流控：refill 失败 -> placeholder、queue 仍空 -> 占位
- [ ] **C2** `findPlayableEquivalent` 优先级：qq 不可播 -> 跳 netease -> 跳 spotify -> null
- [ ] **C3** `markDisliked` / `dislikeMerged` 在 multi-source 下的合并
- [ ] **C4** `importLiked` 部分平台失败：importedAt 仍写入；sources 标 error
- [ ] **C5** `fanOutLike` 方向反转时 skip-enqueue 的边界

## Phase D — Controller L4 路由补强

- [ ] **D1** `/music/search` 输入清洗：XSS / 空 / 超长
- [ ] **D2** `/music/lyrics/aggregate` cache hit / miss
- [ ] **D3** `/music/library` 脏数据过滤（Deezer 误入 fanOut）
- [ ] **D4** `/music/deezer/preset` 切换持久化 + 不存在的 preset -> 400
- [ ] **D5** `/music/dislike/merged` 路由顺序（不被 `/dislike/:trackId` 截胡）
- [ ] **D6** `/auth/*` controller + `RequireInternalTokenGuard` 校验
  - 401 without token
  - 401 wrong token
  - 200 with correct token

## Phase E — 跨包契约 L5（堵「前后端 fuzzy key 漂移」）

- [ ] **E1** `packages/common/src/contract.test.ts`（新建）
  - `normalizeKey(title, artist)` 在 server/renderer 同值
  - `displayKey(title, artist)` 在 server/renderer 同值
  - 10 组歌曲两端归一一致

- [ ] **E2** `packages/common/src/grouping.test.ts`（新建）
  - 同一 sources 列表 server `mergeLibrary` vs renderer `groupLibraryItems`
    同 grouping（key、member 数、representative index）

## Phase F — Hooks/Lib L6（renderer 补单测，可选）

- [ ] **F1** `usePlayer` 核心：tryUpgradeFromTrial、跨平台降级循环
- [ ] **F2** `useCoverArt` epoch 取消 / race
- [ ] **F3** `lib/groupLibrary.ts` 多 COVER / 多 LIVE 折叠
- [ ] **F4** `lib/spotify-wps.ts` SDK 初始化 / 错误传播
- [ ] **F5** `lib/storage.ts` Provider/Quality 读写 + 缺字段兜底

## Phase G — CI 收尾

- [ ] **G1** GitHub Actions：`typecheck + lint + test` 三连
- [ ] **G2** `test:ci` 子命令（`--bail --reporter=spec`）
- [ ] **G3** 覆盖率（c8 / istanbul）报告 + 阈值门禁（≥60% 行）
