# Changelog

All notable changes to Maestro will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **`ISSUES.md` §3.5** root `package.json` `description` 更新为跨平台播放器
  （QQ / NetEase / Deezer / Spotify + DeepSeek AI），不再是过期的 QQ-only 描述。
- **`ISSUES.md` §4.1** `StorageService` 写凭据文件后 chmod 0o600：抽出
  `writeLocked()` 助手（writeFileSync + chmod），`scheduleWrite` / `flushSync`
  都走它；Windows 上 chmod 降级为 debug 日志，不阻塞写。文件：
  `packages/server/src/common/storage.ts`。
- **`ISSUES.md` §4.3** `MusicController.proxyAudio` 加 host 白名单
  （`ALLOWED_STREAM_HOSTS_EXACT` + `_SUFFIX` + `isStreamHostAllowed`），未知
  域返 403，避免 controller 被当 SSRF 开放代理。文件：
  `packages/server/src/music/music.controller.ts`。
- **`ISSUES.md` §3.7** Electron main 日志统一走 `logger`（`src/lib/logger.ts`）：
  main.ts 16 处 `console.*` 全部替换；logger 集中加 `[main]` 前缀，debug 默认
  隐藏（`ELECTRON_ENABLE_VERBOSE=1` 开启）；electron 包接入 ESLint
  `no-console: warn`（allow warn/error）。
- **`ISSUES.md` §5.1（partial）** `music.service.ts` 歌词块拆分：3481 → 3384 行。
  新增 `lyrics.service.ts`（getLyrics / getLyricsAggregated /
  getLyricsAvailability + 独立 lyricsCache），controller 歌词端点直注
  LyricsService；`getLyricsByName` 因依赖 `searchEquivalent` 留原位避免循环依赖。
- **`ISSUES.md` §3.1** `NeteaseMusicProvider.fetchSongUrl`: 防御性 `parseInt` + NaN
  校验，非数字 `songId` 早抛 `BadRequestException`，避免 `ids=[NaN]` 让网易云 API
  返 400。文件：`packages/server/src/music/netease.provider.ts`。
- **`ISSUES.md` §3.2** `QqMusicProvider.randomGuid`: `Math.random × 32` 改
  `crypto.randomBytes(16).toString('hex')`，128 bit 真随机。文件：
  `packages/server/src/music/qq.provider.ts`。
- **`ISSUES.md` §3.3** `QqMusicProvider.fetchRadioBatch`: Fisher-Yates 抽出为静态助手
  `shuffle(arr, rng)`，`fetchRadioBatch` 接受可选 `rng` 参数。文件：
  `packages/server/src/music/qq.provider.ts`。
- **`ISSUES.md` §2.11** `LikeSyncQueue.backoffMs`: 接受可选 `rng` 参数。文件：
  `packages/server/src/music/like-sync.queue.ts`。

### Added
- **`ISSUES.md` §5.2（partial）** `usePlayer.ts` 纯 helpers 拆出
  `usePlayer.helpers.ts`：1460 → 1348 行。FALLBACK_PRIORITY /
  getFullSongProviders / pickFallbackSource / pickUpgradeSource /
  parsePlayableQueue 等零 React 依赖决策函数独立成文件，主 hook re-export
  保持 import 路径不变。完整 3-hook 拆分（usePlaybackTransport / useFallback /
  useTrialUpgrade）有意不拆——主 hook 是 cohesive 设计，片段共享 refs/closures，
  强拆会重引入闭包陷阱，留待专项 PR + e2e。
- **`ISSUES.md` §1.2 / §3.8 ESLint hardening**（renderer / server / common 三包）：
  - `no-console: warn`（`allow: ['warn', 'error']`）—— 堵新 `console.log`，
    不误伤错误日志。
  - `@typescript-eslint/no-explicit-any: warn` —— 堵新 `as any`。
  - server 包首次接入 ESLint 配置 `eslint.config.mjs`（覆盖源码、排除
    `test.ts` / `spec.ts` / `test-helpers/` / `dist` / `node_modules`）。
  - common 包同样接入 ESLint。
  - 现有 `(t as any).unref?.()` 在 `session.ts:117` 已带 `eslint-disable-next-line`，
    新规则启用后该注释立即生效。
  文件：
  `packages/server/eslint.config.mjs` / `packages/renderer/eslint.config.js` /
  `packages/common/eslint.config.mjs`。
- **`ISSUES.md` §6.1 Test commands** —— 在 `README.md` / `README.zh-CN.md` /
  `README.ja.md` 三份 README 的「开发 / 開発」节后追加「Tests / 测试 / テスト」节，
  列出 `npm test` / `npm run typecheck` / `npm run lint` / `--watch` / `--ci` /
  `--coverage`，标注 sandbox 友好（e2e 不 listen 真端口，走 in-process HTTP）。
- **`ISSUES.md` §6.2 CHANGELOG.md`**（本文件）。

### Tests
- `storage.test.ts`：新增 7 / 8（写入后 mode = 0o600、历史 0o644 被收紧），6 → 8。
- `music.controller.allowlist.test.ts`：新增 10 项（QQ / NetEase / Spotify /
  Deezer exact + suffix / SSRF / 非 http(s) / 非法 URL / suffix 误匹配 /
  case-insensitive）。
- `electron/src/lib/logger.test.ts`：新增 3 项（前缀透传 + debug 默认隐藏 +
  verbose 开启）。
- 9 个直接 `new MusicService` 的测试文件补 `lyricsService` 构造参数
  （lyrics-aggregate / library-import / library-badge-merge /
  liked-cache-consistency / cross-platform-match / search-unified /
  get-next-track / per-session-lock / stale-canonicalid-guard）。
- `packages/server/src/music/netease.provider.test.ts`：新增 29 / 30 两项
  （非数字 songId 抛 BadRequestException、前导零数字串正常解析），28 → 30。
- `packages/server/src/music/qq.provider.test.ts`：新增 34 / 35 两项
  （`randomGuid` 32 hex char + 100 次唯一；Fisher-Yates 注入 rng → 顺序可重放），
  33 → 35。
- `packages/server/src/music/like-sync.queue.test.ts`：新增第 5 项
  （`backoffMs` 注入 rng → 精确值 4500 / 1500 / 32500），4 → 5。

### Fixed
- **Stability round 1**: `searchEquivalent` 同 key 并发请求 coalescing
  —— 读 cache miss → await 远端 → 写 cache 在 await 间断开，让 like sync 与
  VIP 升级并发时各自打后端。仿 RefreshCoordinator 加 inflight map，N 个
  awaiter 共享同一 Promise，失败透传 cache 不写。新增 5 项回归测试
  （串行命中 / 并发 10 共享 / 失败透传 + 清理 / 不同 key 不互并 / inflight
  完成后清零）。文件：packages/server/src/music/music.service.ts +
  `search-equivalent-coalesce.test.ts`。
- **Stability round 2**:
  - `SessionService` reaperTimer 缺 onModuleDestroy 清理：`nest start --watch`
    热重载场景下每次重载都加一个 setInterval，N 次重载后 N 个 eviction 并行跑。
    修：加 reaperTimer 字段 + onModuleDestroy 显式 clearInterval（正常退出
    靠 unref，热重载靠 destroy）。文件：packages/server/src/common/session.ts。
  - `LyricsService.getLyrics` 同 searchEquivalent 的 cache race：getLyricsAvailability
    顺序扫每个源时同 key 各自打后端。仿 searchEquivalent 加 inflight map。
    新增 3 项回归测试。文件：packages/server/src/music/lyrics.service.ts +
    `lyrics-coalesce.test.ts`。
  - `music.service.ts` 调 `spotify.like/unlike` 裸 await：toggleLike 走
    LikeSyncQueue 8s hard timeout 兜底（最坏用户点 ❤ 卡 8s 不响应）。
    加 `withTimeout(5s)` 与 search/fetch 统一超时档。文件：
    `packages/server/src/music/music.service.ts`。

## [2026-09-03] - Pre-CHANGELOG baseline

Phase 0–5 + 前端架构重构（PR #13）+ Spotify v2 全曲播放 + ❤ 写回（PR #34–#39）+
版本标签 + 别名表合并（PR #52）+ WPS 诊断（PR #53）+ ❤ 角标按歌数显示（PR #54）+
红心合并修复（PR #55）+ AETHER 剧场视图（PR #56）+ 歌词解析修复（`d014cf4`）+
一致性修复 T1-T10（`b7a54e8`，推荐红心短暂显示修复 `0f9a4b8` 等）均已合入。

完整的 4 平台能力端到端：登录、搜索、radio、跨平台 match、统一库、DeepSeek
推荐、跨平台 fan-out ❤、AETHER 剧场主界面、Spotify WPS 路径完整。

已知阻塞：Spotify Premium 全曲播放卡在 Widevine license server 500
（castLabs fork `+wvcus` 用 dev VMP 签名被生产 license 拒）—— 详见
`docs/NEXT-ITERATION.md` §0「Apple Developer + castLabs EVS 落地」。

历史 PR / commit hash 的完整追踪参见 `git log --oneline` / `git log --grep`。
