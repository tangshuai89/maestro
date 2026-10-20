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

- [x] **G2** `test:ci` 子命令（spec 格式输出 + 有失败即非零退出）
  - package.json 加 `"test:ci": "bash scripts/test.sh --ci"`
  - scripts/test.sh 支持 `--ci`（spec 格式 `▸`/`✓`/`✗` 前缀输出）
  - CI workflow 从 `npm test` 切到 `npm run test:ci`
  - 验收：`npm run test:ci` 在 CI 模式下跑通，全部测试文件通过
  - ⚠️ **2026-10-20 修正**：本项原来的验收只验了「全绿时跑通」，**没验
    「有失败时会不会红」** —— 而 `--ci` 当时是**永远绿**的：
    `OUTPUT=$(run_all 2>&1)` 是子 shell（`set +e` 让「首个失败即退出」没生效），
    且 `EXIT_CODE=$?` 取的是 `run_all` 末尾 `echo` 的状态（恒 0）。
    实测注入一个必失败文件，脚本照打印「all tests passed」且退出码 0 →
    CI workflow 的测试门禁形同虚设。已改为「跑完全部 → 收集失败清单 → 有失败
    则 `exit 1`」，`--coverage` 分支的 `|| true` 同样不再吞失败。
    **新增验收（故障注入实测）**：注入 1 个必失败文件 → 退出码 1 + 失败清单
    打印 + common/server/electron/renderer 四段全部执行（不再互相遮蔽）；
    移除注入 → 退出码 0。
  - 顺带修：CI 模式的 `✓` 标记原来无论成败都打（挂掉的文件在日志里看着是绿的），
    现在只对真通过的文件打 ✓

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

- [x] **B3** `deezer.provider.test.ts`（新建，18 用例）
  - isConfigured / getEditorials / getPresetNames / isValidPreset
  - search 命中/空/HTTP error / fetchRadioBatch valid/invalid preset/empty
  - getStreamPath valid/no preview / getLyrics synced/unsynced/null
  - toTrack title_short 优先

- [x] **B4** `lyricsovh.provider.test.ts`（新建，11 用例）
  - 空 artist/title / whitespace / hit multi-line / 404 / 500
  - empty lyrics / URL encoding / timeout（withTimeout 5s）

- [x] **B1** `qq.provider.test.ts` 扩展 7 → 33 用例
  - 保留原 7 个 computeGtk golden tests
  - 新增 26 个：search 命中/空/HTTP error/pay_play VIP 推断
  - fetchRadioBatch 种子轮转/空/HTTP error
  - getStreamPath 正常/高音质回退/无 purl
  - getLyrics LRC 解析/无歌词/HTTP error
  - isConfigured / like / unlike / fetchLiked 分页 / toTrack 字段映射

- [x] **B5** `spotify.test.ts` 扩展 12 → 30 用例
  - 保留原 12 个 OAuth PKCE tests
  - 新增 18 个：search 字段映射/空/401/多结果
  - fetchLiked 返回/空/HTTP error/分页
  - like 网络错误 / unlike 401 / getMeInfo premium/free/null
  - getValidAccessToken refresh / bindSessionId / cancelPendingFlows / exchangeCode

- [x] **B2** `netease.provider.test.ts`（新建，28 用例）
  - isConfigured / fetchRadioBatch 字段映射/301/500/空/count 截断
  - fetchLiked 3 步流程/未登录/无 uid/无歌单
  - search 字段映射/空/enrichment 补封面+vipLocked/enrichment 失败不阻塞
  - getStreamPath 正常/高音质回退/无 url
  - like/unlike 200/405 幂等 / fmTrash / getLyrics 有/无/code!=200
  - apiCall 非 JSON → throws

## E. 跨包契约（堵"前后端 fuzzy key 漂移" — 架构约束最强调）

- [x] **E1** `packages/common/src/contract.test.ts`（新建，23 用例）
  - 10 组真实歌曲验证 normalizeKey / displayKey 行为一致
  - 覆盖简繁、feat、Live/Remix 版本、英文艺名、大小写、日文假名
  - stripParensContent / stripTrailingMeta 稳定性

- [x] **E2** `packages/common/src/grouping.test.ts`（新建，22 用例）
  - server normalizeKey 分组 vs renderer displayKey 分组一致性
  - 同歌/简繁/feat/大小写 → 两端 group 数一致
  - Live/Remix → server 多组 / renderer 1 组（预期差异）
  - 混合场景 / 空列表 / stripParensContent + displayKey 链

## F. Renderer hooks/lib 补单测

- [x] **F1** `usePlayer` 核心：tryUpgradeFromTrial、跨平台降级循环
  - 提取纯函数：pickFallbackSource / pickUpgradeSource / getFullSongProviders
  - 测试 usePlayer.test.mjs：30 用例（常量/getFullSongProviders/pickFallback/pickUpgrade/降级链模拟）

- [x] **F2** `useCoverArt` epoch 取消 / race
  - 导出 applyCoverImage 供直接测试
  - 测试 useCoverArt.test.mjs：16 用例（成功/epoch bail/fetch 失败 fallback/proxy URL/连续调用/bitmap.close）

- [x] **F4** `lib/spotify-wps.ts` SDK 初始化 / 错误传播
  - 测试 spotify-wps.test.mjs：25 用例（API surface/subscribe/ready/connect/play/disconnect/fatal events/reconnect）

## H. 覆盖率盲区（2026-10-20 全量评估实测）

> 评估方式：`npm run test:coverage` 跑出 lcov，按**行/函数**双口径核对，
> 再回到源码确认「测试到底调了什么」。
> 结论：测试**体量**够，但**有效性**有洞 —— 有核心模块的测试文件看着很大，
> 实际一行核心逻辑都没执行。
>
> **2026-10-20 16:00 复测**（另一并行 session 落地 `90ddf5f` 之后）：
> H2 / H3 已闭合；H1 的**测试**已补但**测不出来**（被 H6 挡住）；
> H6 实测影响远大于预估 —— 不是 1pp 的口径微调，是 **~24pp** 的语义差。

- [x] **H1** `renderer/src/hooks/usePlayer.ts` 行覆盖 **5.3%**（115/2155，未覆盖段连续 116–2155）
  - 根因：`usePlayer.test.mjs` 的 99 项断言只调用了 `usePlayer.ts` **导出的纯函数**
    （`pickFallbackSource` / `shouldTransientRetry` / `parsePlayableQueue` …），
    **从未调用 `usePlayer` 这个 hook 本身** → 2040 行 hook 体一行没跑
  - 这就是 F1 的真实边界：F1 提取纯函数并测了纯函数，hook 编排层仍是黑的
  - ✅ **测试已补**（`90ddf5f`）：新增 `renderer/src/hooks/usePlayer.hook.test.tsx`
    （280 行 / 6 条主干：playSearch 装载+清错、不可播明确报错、播放暂停切换、
    队列前进、❤ 调 fanOutLike、`<audio>` error → 兜底链耗尽 → 结构化 failure）
  - ✅ **H6 落地后可测了**：复测 `usePlayer.ts` **行 38.8% / 函数 35.8%**
    （从「测不出来的 5.3%」变成真实数字）—— 6 条主干确实跑到了 hook 体
  - ⚠️ **仍 <60%**，剩下的 1400 行是 hook 编排的分支（各 provider 兜底、
    音质切换、队列编辑、crossfade 接线…）没被覆盖
  - 剩余：继续补 hook 分支；验收：`usePlayer.ts` 行覆盖 ≥60%，且断言的是
    **编排行为**（队列推进 / 切歌 / 兜底链 / 试听升级），不是断言纯函数

- [x] **H2** `server/src/reco/reco.service.ts` 行覆盖 **11.1%**、函数覆盖 **4.7%**（5/107）
  - 根因：`reco.test.ts`（1401 行）只调了 `svc.setApiKey()` 和 `svc.status()`，
    **从未调用** `run()` / `evaluate()` / `recordSignals()` / `callDeepSeekForParse()`
    —— 也就是 DeepSeek 推荐主链路一次没执行
  - ✅ **已闭合**（另一并行 session 的 `reco/` 新增 `eval-genre.ts` /
    `genre-seeds.ts` / `nl-intent-retrieval.ts` + 对应测试）：
    复测 **行 84.6%（1587/1876）、函数 91.5%（43/47）**，
    `run()` / `evaluate()` / `recordSignals()` / `callDeepSeekForParse()` 均已执行

- [x] **H3** `server/src/music/entitlement.ts` 函数覆盖 **0%** —— `classifyPlaybackFailure`
  - 文件自己的注释就写着「纯函数，白盒可测」，但没有任何测试调过它
  - 这是「凭据失效 / 权益失效 / 无版权」三态判定的入口，直接决定用户看到哪种提示
  - ✅ **已闭合**（`90ddf5f` 新增 `server/src/music/entitlement.classify.test.ts`，
    100 行 / 8 条白盒：重登 > 会员失效 > 换歌 > 不知道）：
    复测 **行 100%（70/70）、函数 100%（2/2）**
  - 遗留（不算覆盖问题）：该函数在**生产链路里仍零调用点** ——
    renderer 侧另有一套 `PlayFailure.reason` 分级，两套语义要接线

- [ ] **H4** renderer 9 个核心 hook 无任何测试
  - `useAuth`(700 行) / `useReco` / `useLyrics` / `usePlaylist` / `useVolume` /
    `useTheme` / `useDeezerEditorials` / `useSpotifyWpsPlayer` / `useDesktopLyrics`
  - 11 个核心 hook 里只有 `useCoverArt` + `usePlayer` 有测试（且 usePlayer 见 H1）
  - 另：`LikedLibraryModal`(548) / `NLPlaylistModal`(374) / `RemotePlaylistModal`(271) 无组件测试

- [ ] **H5** `electron/src/main.ts` + `preload.ts` 零覆盖
  - `preload.ts` 暴露约 30 个 IPC channel，只有 `desktop-lyrics:*` 有
    `ipc-contract.test.ts` 守着；其余 channel 无契约保护

- [x] **H6** 覆盖率数字口径失真（**门禁本身在骗人**）—— 实测影响 **~24pp**，不是 1pp

  这是 H 组里**最该先做**的一条，因为它决定了 H1/H4 的验收能不能量化。
  **2026-10-20 已落地**（`scripts/test.sh` 的 `--coverage` 分支重写）。

  **缺陷 1：`.test.tsx` 根本不进覆盖率**
  原实现只 glob `*.test.ts` / `*.test.mjs` → **17 个 `.test.tsx`（含
  `usePlayer.hook.test.tsx`）在覆盖率模式下压根不执行**。
  连带后果：**`.tsx` 源文件也没被插桩**（`--extension .ts` 只认 `.ts`），
  于是 `TheaterView.tsx`(1022 行，**有 25 个通过的组件测试**) /
  `SearchPanel.tsx`(712) / `SettingsModal.tsx`(588) / `AlbumResults.tsx`(580)
  这些**测得很好的组件**，在覆盖率报告里是 0%。
  → 直接导致 H1 补了 6 条 renderHook 断言，覆盖率却纹丝不动停在 5.3%。

  **缺陷 2：分母 = 「被某个测试 import 过的文件」，不是「所有源文件」**
  从没被任何测试 import 的源文件 **既不计分子也不计分母**，被静默排除。
  实测：renderer 72 个源文件，**报告里只有 24 个，48 个消失**；
  electron 9 → 7（`main.ts` / `preload.ts` 缺席）；server 55 → 50。
  ⚠️ 关键：c8 的 `--all` 必须加在**报告步骤**上，只加在采集步骤无效 ——
  c8 report 默认只输出「V8 覆盖率里实际出现过的文件」，没被 import 过的文件
  根本不在 V8 覆盖率里。实测：报告步骤不带 `--all` → 111 条目；
  带上 → **141 条目**，缺的那些以 0% 出现。

  **缺陷 3：`common/dist` 与 `common/src` 双计** → 虚高 0.98pp（次要）

  **落地后的实测口径对比**：

  | 口径                              | 结果                                                  |
  | --------------------------------- | ----------------------------------------------------- |
  | 修复前（报告自报，失真）          | 85.63%（111 条目）                                    |
  | 修复前（手工估算诚实口径）        | 61.67%                                                |
  | **修复后（脚本自报 = 诚实口径）** | **72.19% 行 / 80.42% 分支 / 74.79% 函数（141 条目）** |

  72.19% 之所以**高于**手工估算的 61.67%：`.test.tsx` 进来后，那些本来就测得好的
  组件（`TheaterView.tsx` 98.2%、`SearchPanel.tsx` 91.3%、`settings/` 97.7%）
  终于计入了分子，收益盖过了「未 import 文件按 0% 计」的损失。

  **改法（已落地）**：
  - coverage 分支纳入 `.test.tsx`（c8 包 vitest，worker 继承 NODE_V8_COVERAGE，
    实测能吃到 `.tsx` 覆盖数据）
  - c8 插桩加 `--extension .tsx`
  - 采集**与报告**两步都加 `--all --src <每个包的 src>`
  - `--exclude` 排除 `**/dist/**` / `**/*.d.ts` / 测试文件自身
  - 新增提示：「本次有 N 个测试文件失败 → 覆盖率偏低」。**失败的文件不产生
    （或只产生部分）覆盖数据**，于是「某个测试文件跑不起来」会伪装成
    「这块代码没测」—— 实测踩过：`reco.test.ts` 跑不起来时，
    `reco.service.ts` 覆盖率从 80.27% 塌成 11.1%，看着像天大的覆盖洞，
    其实只是那个测试文件没跑成。**覆盖率是二手结论**；指认「核心逻辑没测」
    之前，先确认那个测试文件本身是绿的。

  **验收**：报告里的 `All files` 与「真实执行到的源码 ÷ 全部源文件」一致 ✅
  （141 条目；`usePlayer.ts` 从测不出来的 5.3% 变成可测的 38.8%）

- [ ] **H7** 第 7/8 层空白：**E2E 全链路**与**稳定性压测**都不存在
  - Playwright 只覆盖 3 个视图（无凭据首屏 / 剧场三档密度 / ButtonSmoke），
    没有一条「登录 → 搜索 → 播放 → 收藏」的跨包链路
  - `visual.yml` 靠 `paths` 过滤触发，**改后端不跑**
  - 无任何并发/长稳脚本：`music.service.ts` 的 `mergeLibrary`、provider 并发 fan-out、
    like-sync 队列都没验证过
