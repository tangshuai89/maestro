# Stability — Tasks

> 审计基线：2026-08-27（PR #66 文档对齐后核实）
> A 组 = 环境阻塞，B-G 组 = 测试覆盖缺口（与 specs/test-plan/tasks.md 交叉追踪）

## A. 环境/账号阻塞（代码已就位，缺凭据）

- [ ] **A1** Spotify Widevine license 500 修复
  - 买 Apple Developer Account（$99/年，1-3 天批，尽早提交）
  - `pip3 install --upgrade castlabs-evs` + `python3 -m castlabs_evs.account signup`（0 成本）
  - `python3 -m castlabs_evs.vmp sign-pkg <dist/mac-arm64/Maestro.app>` 签 dev 用 .app
  - `?wpsDebug=1` 重跑验证 license 返 200 + `hasTrack=true`
  - **代码已就位**：`packages/electron/afterPack-vmp.cjs` + `build.electronDist` 指 castLabs dist
  - 验收：Premium 登录 → 播完整曲目 + Spotify 桌面端可见 "maestro-xxxx" 设备 + token 1h 重连不掉播
  - 对应：`specs/spotify/tasks.md` #41-46

- [ ] **A2** `npm run pack` 端到端冒烟出 dmg
  - 先 `npm install` 恢复 7zip-bin 传递依赖
  - 无 EVS 凭据时 `SKIP_VMP=1 npm run pack` 先验打包管线
  - 有 EVS 后完整链：VMP sign → codesign → notarize → dmg
  - 对应：`specs/packaging/tasks.md` #16

## G. CI 收尾（先做基础设施，后续补测试自动受益）

- [x] **G2** `test:ci` 子命令（`--bail --reporter=spec`）
  - package.json 加 `"test:ci": "bash scripts/test.sh --ci"`
  - scripts/test.sh 支持 `--ci`（首个失败即退出 + spec 格式 `▸`/`✓` 前缀输出）
  - CI workflow 从 `npm test` 切到 `npm run test:ci`
  - 验收：`npm run test:ci` 在 CI 模式下跑通，196 passed, 0 failed

- [x] **G3** 覆盖率报告 + 阈值门禁（≥60% 行）
  - 装 c8（V8 原生覆盖率，零配置）
  - package.json 加 `"test:coverage": "bash scripts/test.sh --coverage"`
  - scripts/test.sh `--coverage` 模式：逐包 c8 包裹 → 合并报告 → lcov.info
  - CI workflow 加覆盖率步骤（`continue-on-error: true`，warn-only 阶段）
  - 当前覆盖率：server 52.95% 行（B 组测试补完后预计 ≥60%）
  - 门禁暂为 warn-only，B 组完成后切硬门禁

## D. Controller 路由补强（小工作量，快速清）

- [x] **D4** `/music/deezer/preset` 切换持久化 + 不存在 preset → 400
  - 新增 `PUT /music/deezer/preset` 端点（校验 + 持久化到 session.prefs）
  - DeezerMusicProvider 加 `isValidPreset` / `getPresetNames` static 方法
  - 测试：`packages/server/src/music/deezer-preset.test.ts`（7 用例全绿）

- [x] **D6** `/auth/*` controller + `RequireInternalTokenGuard` 校验
  - **修复生产 bug**：`config.ts` 读 `MASTERO_INTERNAL_TOKEN`（多了 R）→ guard 永远失效
  - 修正为 `MAESTRO_INTERNAL_TOKEN`（与 Electron main / guard 文档一致）
  - 扩展 `InProcessClient.call` 支持自定义 headers
  - 测试：`packages/server/src/auth/auth-guard.test.ts`（5 用例：dev/无header/错header/正确header/POST）

## C. Service 业务补强

- [x] **C1** `getNextTrack` 流控：refill 失败 → placeholder、queue 仍空 → 占位
  - 代码已就位（`music.service.ts:396-420`）：refill 失败 → placeholder、queue 空 → placeholder
  - 测试：`packages/server/src/music/get-next-track.test.ts`（6 用例：失败/空/正常/连续/形状/disliked）

## B. Provider 单测（锁住平台 API 解析回归）

- [ ] **B3** `deezer.provider.test.ts`（新建，~15 用例）
  - 各 preset editorial id 映射 / preview URL 提取 / 404 5xx 兜底

- [ ] **B4** `lyricsovh.provider.test.ts`（新建，~10 用例）
  - 命中 / 未命中 / 同步异步时间戳

- [ ] **B1** `qq.provider.test.ts` 扩展 7 → ~30 用例
  - search 命中/空结果/pay_play 推断/VIP 推断
  - fetchRadioBatch 8 seed 轮转
  - getStreamPath：vkey 过期 → 401 重取
  - getLyrics LRC 解析

- [ ] **B5** `spotify.test.ts` 扩展 12 → ~30 用例
  - OAuth 之外覆盖 search / like / fetchLiked / WPS tier 路由

- [ ] **B2** `netease.provider.test.ts`（新建，~25 用例）
  - search / getStreamPath / fetchLiked
  - VIP 推断 / csrfToken 刷新

## E. 跨包契约（堵"前后端 fuzzy key 漂移" — 架构约束最强调）

- [ ] **E1** `packages/common/src/contract.test.ts`（新建）
  - `normalizeKey(title, artist)` 在 server/renderer 同值
  - `displayKey(title, artist)` 在 server/renderer 同值
  - 10 组歌曲两端归一一致

- [ ] **E2** `packages/common/src/grouping.test.ts`（新建）
  - 同一 sources 列表 server `mergeLibrary` vs renderer `groupLibraryItems` 同 grouping
  - key、member 数、representative index 一致

## F. Renderer hooks/lib 补单测

- [ ] **F1** `usePlayer` 核心：tryUpgradeFromTrial、跨平台降级循环
- [ ] **F2** `useCoverArt` epoch 取消 / race
- [ ] **F4** `lib/spotify-wps.ts` SDK 初始化 / 错误传播
