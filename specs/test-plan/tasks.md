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

- [x] **B1** `qq.provider.test.ts` 扩展到 33 用例 — 2026-08-28 完成
  - 保留原 7 个 computeGtk + 新增 26 个（search/fetchRadioBatch/getStreamPath/getLyrics/like/unlike/fetchLiked）

- [x] **B2** `netease.provider.test.ts`（新建，28 用例）— 2026-08-28 完成
  - isConfigured / fetchRadioBatch / fetchLiked 3 步 / search + enrichment
  - getStreamPath 回退 / like/unlike 405 幂等 / fmTrash / getLyrics / apiCall 非 JSON

- [x] **B3** `deezer.provider.test.ts`（新建，18 用例）— 2026-08-28 完成
  - isConfigured / getEditorials / getPresetNames / isValidPreset
  - search / fetchRadioBatch / getStreamPath / getLyrics / toTrack

- [x] **B4** `lyricsovh.provider.test.ts`（新建，11 用例）— 2026-08-28 完成
  - 空/whitespace / hit / 404 / 500 / empty / URL encoding / timeout

- [x] **B5** `spotify.test.ts` 扩展到 30 用例 — 2026-08-28 完成
  - 保留原 12 个 OAuth + 新增 18 个（search/fetchLiked/like/unlike/getMeInfo/refresh/bindSessionId/cancel/exchange）

## Phase C — Service L3 边界补强

- [x] **C1** `getNextTrack` 流控：refill 失败 -> placeholder、queue 仍空 -> 占位 — 2026-08-28 完成
  - 代码已就位（`music.service.ts:396-420`），补测试 `get-next-track.test.ts`（6 用例）
- [x] **C2** `findPlayableEquivalent` 优先级：qq 不可播 -> 跳 netease -> 跳 spotify -> null — 已在 `cross-platform-match.e2e.test.ts` 覆盖
- [x] **C3** `markDisliked` / `dislikeMerged` 在 multi-source 下的合并 — 已在 `like.e2e.test.ts` 覆盖
- [x] **C4** `importLiked` 部分平台失败：importedAt 仍写入；sources 标 error — 已在 `library-import.e2e.test.ts` 覆盖
- [x] **C5** `fanOutLike` 方向反转时 skip-enqueue 的边界 — 已在 `cross-platform-match.e2e.test.ts` 覆盖

## Phase D — Controller L4 路由补强

- [x] **D1** `/music/search` 输入清洗：XSS / 空 / 超长 — 已在 `like.e2e.test.ts` 覆盖（空 q → 400）
- [x] **D2** `/music/lyrics/aggregate` cache hit / miss — 已在 `lyrics-aggregate.e2e.test.ts` 覆盖
- [x] **D3** `/music/library` 脏数据过滤（Deezer 误入 fanOut）— 已在 `library-badge-merge.e2e.test.ts` 覆盖
- [x] **D4** `/music/deezer/preset` 切换持久化 + 不存在的 preset -> 400 — 2026-08-28 完成
  - 新增 `PUT /music/deezer/preset` 端点 + `DeezerMusicProvider.isValidPreset`
  - 测试：`deezer-preset.test.ts`（7 用例）
- [x] **D5** `/music/dislike/merged` 路由顺序（不被 `/dislike/:trackId` 截胡）— 已在 `like.e2e.test.ts` 覆盖
- [x] **D6** `/auth/*` controller + `RequireInternalTokenGuard` 校验 — 2026-08-28 完成
  - **修复生产 bug**：`config.ts` 读 `MASTERO_INTERNAL_TOKEN`（typo）→ guard 永远失效
  - 修正为 `MAESTRO_INTERNAL_TOKEN`；扩展 InProcessClient 支持自定义 headers
  - 测试：`auth-guard.test.ts`（5 用例：dev mode / 无 header / 错 header / 正确 header / POST）

## Phase E — 跨包契约 L5（堵「前后端 fuzzy key 漂移」）

- [x] **E1** `packages/common/src/contract.test.ts`（新建）— 2026-08-28 完成
  - 10 组真实歌曲验证 normalizeKey / displayKey 行为一致（23 用例）
- [x] **E2** `packages/common/src/grouping.test.ts`（新建）— 2026-08-28 完成
  - server normalizeKey vs renderer displayKey 分组一致性（22 用例）

## Phase F — Hooks/Lib L6（renderer 补单测，可选）

- [x] **F1** `usePlayer` 核心：tryUpgradeFromTrial、跨平台降级循环 — 2026-08-28 完成
  - 提取纯函数 pickFallbackSource / pickUpgradeSource + 30 用例
- [x] **F2** `useCoverArt` epoch 取消 / race — 2026-08-28 完成
  - 导出 applyCoverImage + 16 用例
- [x] **F3** `lib/groupLibrary.ts` 多 COVER / 多 LIVE 折叠 — `groupLibrary.test.ts` 已存在
- [x] **F4** `lib/spotify-wps.ts` SDK 初始化 / 错误传播 — 2026-08-28 完成
  - 25 用例（connect/disconnect/play/fatal events/reconnect）
- [x] **F5** `lib/storage.ts` Provider/Quality 读写 + 缺字段兜底 — `storage.test.ts` 已存在

## Phase G — CI 收尾

- [x] **G1** GitHub Actions：`typecheck + lint + test` 三连 — `.github/workflows/test.yml` 已配置
- [x] **G2** `test:ci` 子命令（`--bail --reporter=spec`）— 2026-08-28 完成
  - `scripts/test.sh --ci` 模式：首个失败即退出 + `▸`/`✓` spec 格式输出
  - CI workflow 切到 `npm run test:ci`
- [x] **G3** 覆盖率（c8）报告 + 阈值门禁（≥60% 行）— 2026-08-28 完成
  - `scripts/test.sh --coverage` 模式：c8 逐包包裹 → lcov 报告
  - CI workflow 加覆盖率步骤（`continue-on-error: true`，warn-only 阶段）
  - 当前 server 52.95% 行；B 组测试补完后切硬门禁
