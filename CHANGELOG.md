# Changelog

All notable changes to Maestro will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
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
- `packages/server/src/music/netease.provider.test.ts`：新增 29 / 30 两项
  （非数字 songId 抛 BadRequestException、前导零数字串正常解析），28 → 30。
- `packages/server/src/music/qq.provider.test.ts`：新增 34 / 35 两项
  （`randomGuid` 32 hex char + 100 次唯一；Fisher-Yates 注入 rng → 顺序可重放），
  33 → 35。
- `packages/server/src/music/like-sync.queue.test.ts`：新增第 5 项
  （`backoffMs` 注入 rng → 精确值 4500 / 1500 / 32500），4 → 5。

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
