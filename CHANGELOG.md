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
- **推荐延迟包 + 行为信号闭环**（`specs/reco-deepseek/spec.md` v2.1 段）——
  实测「推荐要等好久」后按耗时账逐段砍，并把"只有红心"补成真实行为信号。
  - **候选池阶段并发化**（`reco/candidate-pool.ts`）：原「相邻艺人查询 → 主干深挖
    → 相邻艺人搜索 → 电台」四段串行改为单一 `TaskPool` 边查边搜，相邻艺人一查到
    就追加任务；结果仍按入队序展开（网络快慢不影响候选顺序）。
  - **LLM 输出封顶 + prompt 瘦身**：挑选路径 `max_tokens=900`（生成 1500）；
    prompt 只列前 40 条候选（池子全量供补位），口味采样 60 → 40 行。
  - **候选池缓存**（`reco.service.ts`）：按 `(session, 库规模, 主干)` 缓存 10 分钟，
    exclude 变化就地过滤——连点/续播第二次几乎瞬回；key 刻意不含信号指纹，
    否则每播一首就失效、边听边点推荐时缓存永远打不中。
  - **分阶段耗时可观测**：日志一行给出 `池/LLM/填源/合计` 毫秒；响应新增
    `timings` 字段（含 `cachedPool`）。
  - **`reco/signals.ts`（新）+ `POST /api/reco/signal`**：播放 / 完播 / 早切 /
    红心 / 踩 / 种子六类信号（权重 + 21 天半衰期 + 30s 防抖 + 500 条上限），
    只落本机 `.storage`；`usePlayer` 五处自动上报（fire-and-forget，失败静默）。
  - **负反馈闭环**：跳过/踩过的歌当库内歌排除，信号分 ≤ -6 的艺人整位拉黑；
    信号（有界：正分 ≤ +10，负分最多把权重压到 0）折进口味档案主干排序。
  - **以歌为种子**：`POST /reco/run` 支持 `seed`，候选围绕该艺人 + 其相邻艺人展开，
    TheaterView 新增「像《歌名》一样」入口；该点击记成强正信号。
  - **RecoLoading 文案**按真实耗时推阶段（不再 2.4s 循环回第一句）+ 已等待秒数。
- **DeepSeek 推荐 v2：检索 + 重排**（`specs/reco-deepseek/spec.md` v2 段）——
  把"模型凭空生成歌名"换成"从真实目录里挑"，并让口味主干不再每轮漂移。
  - `packages/server/src/reco/taste-profile.ts`（新）：艺人亲和度（多艺人拆分 +
    `normalizeKey` 归一）+ **稳定 anchors**（同会话内不随 run 变化）+ 亲和度加权
    种子采样（70% 贴口味 / 30% 长尾探索，替代 v1.1 的全库均匀随机）。
  - `packages/server/src/reco/candidate-pool.ts`（新）：目录锚定候选池——主干深挖
    （库外曲目）、相邻艺人（Deezer `/artist/{id}/related`，平台侧协同过滤）、
    平台 FM/榜单（网易云私人 FM / QQ 电台 / Deezer 榜单）三源合并，带剔库/坏版本/
    时长/非目标艺人/单艺人上限与来源统计。
  - `packages/server/src/reco/version-filter.ts`（新）：把 `VERSION_BAD` /
    `VERSION_SOFT` / 时长判据从 RecoService 抽成共享纯函数，候选池与填源同口径。
  - RecoService 主路径改为「挑选 + 排序」：`buildSelectPrompt` + `parseSelection`
    做**下标白名单**校验（模型给下标、系统取真实条目，幻觉无从进入队列）；
    候选池不足或挑选失败自动回退 v1.1 自由生成，推荐不因此报错。
  - 多样性：同一归一艺人 ≤ 2 首（候选池与最终装配两道）。
  - `POST /api/reco/run` 响应新增 `mode` / `candidateCount` / `candidateOrigins`
    便于对比新旧路径效果（向后兼容可选字段）。
  - `MusicService.findRelatedArtists` / `fetchRecoRadioCandidates`：reco 专用取数，
    单平台失败/超时一律 fail-soft 成空数组，不阻塞推荐。
- **Figma D2 收敛** —— `99 · Archive` 页顶部加 `Archive README` frame（红色 4px 虚线框 +
  ⚠ BASELINE — DO NOT EXTEND + 指向 `03 · Screens` 的链接），防止 contributor 误以为
  这页是待开发页面而在上面扩新屏。脚本 `scripts/figma-aether-v4-archive-readme.js`
  （幂等，可重跑）+ 手册 `scripts/figma-v4-d2-command.md` + mock 冒烟
  `scripts/figma-v4-smoke-d2.mjs`（10/10）。
  - **文案按实跑核实结果改写**：spec 原稿假定该页装的是 v3 Monster Beats 视觉稿，实际
    是 **AETHER THEATER 宇宙剧场 A / B / C 三版探索稿**（v4 视觉基准，
    `figma-aether-v4-screens.js` 就是照 A 稿画的，见 `figma-v4-command.md` L10）。
    照原稿写会把 v4 基准页错标成 v3 死稿。
  - 新增变量 `Color/semantic/status-error`（别名 → `Color/primitive/heart-red`）。
    此前 D1 `Screen/AuthError/Full` 与 D2 README 都引用了这个**不存在**的变量名，
    `varColor` 回退成品红哨兵 `#FF00FF`；D1 AuthError 的 `alert-panel` 描边已就地改绑
    （保留 node id `478:2`，不重建，避免 `figma-code-connect.json` 映射失效）。
  - 代码/文档侧的双视觉收敛（`MonsterBeatsView` 残留清理）此前已完成，见
    `specs/d2-convergence/spec.md` §0。
- **Figma D1** —— `03 · Screens` 补 6 个 Modal/Full 屏（Search / Liked / Settings /
  RecoKey / AuthError / EmptyState），画在 y=1000 第二行，与 v4-ABC 的 12 屏不重叠。
  每屏带隐藏 `AI_CONTRACT` TEXT 子节点（FRAME 无 `description` 属性）。
  验收 `scripts/figma-aether-v4-audit-d1.mjs` 18/18；`figma-code-connect.json`
  6 个 `D1-PLACEHOLDER-N` 已换成真实 node id。
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
- `packages/server/src/reco/reco.test.ts`：新增 37–45（候选池并发下顺序确定 /
  候选池缓存命中 + timings + `max_tokens` / prompt 候选行数上限 / 信号
  清洗防抖衰减 / 信号进口味档案 / 负样本排除 / 艺人拉黑 / 种子模式端到端），
  36 → 45。
- `packages/server/src/reco/reco.controller.e2e.test.ts`：新增 9–11
  （`POST /reco/signal` 脏数据 → 2xx + stored=0 / 合法单条 / 批量含脏数据），
  10 → 13。
- `packages/server/src/reco/reco.test.ts`：新增 26–36（艺人亲和度归一 / 加权种子 /
  anchors 稳定 / 候选池过滤 / 候选池 fail-soft / `parseSelection` 下标白名单 /
  `fillFromPool` 补位 / 艺人上限 / 挑选 prompt 契约 / run() 挑选主路径端到端 /
  run() 候选池为空回退自由生成），25 → 36。
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
