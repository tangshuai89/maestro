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
  - ✅ **第三轮（2026-10-21，`f4125f6`）补分支决策**：新增
    `renderer/src/hooks/usePlayer.behavior.test.tsx`（27 条用例）——
    与 `usePlayer.hook.test.tsx` 的分工是「那份测主路径、这份测分支决策」：
    - 跨平台降级链：item 内其它平台源 → 切过去（且**保留 ❤ 态**、展示元数据不变）、
      服务端实时匹配（第二级）→ 切过去、全部试过 → 不降级直接报结构化失败
    - 失败分级：`paid-track` / `vip-locked` / `no-match` / `entitlement-expired`
      各自的判定来源（vipCategory 优先于服务端结论）、`autoSkip`（单曲队列不自跳）、
      `credential` 三态透传、`dismissFailure`
    - 30s 试听升级：残缺音频 → 同平台降标准音质重试（URL 变 `q=standard`）、
      跨平台有全曲源 → 升级换平台、别的平台全 VIP 锁 → 不换源
    - 队列：`playSearch` 剔不可播条目（unified/tracks 索引对齐）、`appendToQueue`
      追加不切歌、队列空时退化成从头播、`handlePrev` 循环回上一首
    - 音质/平台：`changeQuality`（URL 换 `q=` 且保留播放位置）、`selectSource` 落盘、
      `switchToProvider` 清队列、`resetForSwitch` 清播放态
    - WPS：Spotify + WPS 就绪 → **清空 audioUrl**（WPS 接管，不双声道）、
      WPS 未就绪 → 保留 30s 预览路径、`applyWpsProgress` 喂回时间轴
    - 封面：有封面 → `presentCover`、没封面 → `presentPlaceholder`
    - ⚠️ **同批修掉 1 条我自己写错的断言**：`playSearch` 指向不可播条目时，
      生产代码是**明确报错**「没有可播放的音源」而不是静默回退到别的歌 ——
      静默换歌比报错更糟（用户点了 A 结果在放 B）。生产行为是对的，断言改对。
    - ⚠️ **墙钟依赖**：兜底链有**故意的**墙钟成本（同源 transient 重试 800ms +
      卡死探测 1500ms ≈ 2.3s）→ 用假定时器手动推进，**23.4s → 392ms**，
      且与负载无关（理由同 H4 的两条 flaky）

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

- [x] **H4** renderer 核心 hook / 组件零测试 —— **hook 全补完 + 组件层全补完（17/17）**

  - ✅ **hook 全部补完（9 个）**：
    - 第一轮（2026-10-20，72 条用例）：`useVolume` / `useTheme` / `useDeezerEditorials` /
      `useLyrics` / `useDesktopLyrics` / `usePlaylist` / `useReco` / `useSpotifyWpsPlayer`
      —— 用 `renderHook` 驱动真实 hook，断言**契约**而非实现细节。复测覆盖率
      100% / 100% / 100% / 100% / 100% / 100% / 99.5% / 83.9%
    - 第二轮（2026-10-21，39 条用例）：`useAuth`(700 行，reducer + 定时器 + 协议处理)
  - ✅ **组件层补 17 个（148 条用例，2026-10-21）**：
    - 第一轮（75 条）：`components/ui/*`（Button / Dialog / Input / Tooltip / textarea）+
      `components/layout/*`（SourceMenu / QualityMenu / DeezerPresetSelect）+
      `components/modals/*`（LikedLibraryModal / NLPlaylistModal）
    - 第二轮（73 条）：`common/PlayerNotice`（13，**失败分级 UI** ——
      五种 reason 的文案必须**互不相同**，这是"分级"的全部意义）+
      `common/RecoLoading`（8，阶段按已耗时推进，不无脑循环）+
      `layout/Titlebar`（12，条件渲染 + 各按钮回调）+
      `modals/NeteaseCookieModal`（12，扫码轮询 803/800/802 三态 + 手动 Cookie 兜底）+
      `modals/RemotePlaylistModal`（17，解析 → 读取 → 播放/追加/存本地歌单 + 错误翻中文）+
      `source-select/SourceSelect`（7，Spotify 档位文案）+
      `__sandbox/ButtonSmoke`（4，Radix 编译链烟囱）
  - ⚠️ **同批修掉 2 条墙钟依赖的 flaky**（`usePlayer.hook.test.tsx`）：
    「会员已失效」和「凭据已过期」两条还留在**真定时器**上（兜底链 800ms +
    1500ms），高负载下被拖过 vitest 默认 5s → 超时。改成假定时器手动推进时钟
    → 整个文件从「超时 5s」变成 **145ms**，且与负载无关（同批已修的那条
    「兜底链耗尽」是同样的改法）
  - ⚠️ **覆盖 ≠ 已接线**：`useVolume` 补了 8 条契约用例之后仍然是**死代码** ——
    hook 写好、测试也有了，但**从来没被调用过**（界面上没有音量控件，音量偏好
    也不推给任何 `<audio>`）。2026-10-21 才真正接上（`useVolume(slots, track)` →
    `App.tsx` → `SettingsModal`），并顺带修掉 3 个**测试脆弱性**（EQ 测试按位置
    取滑块 → 插入音量滑块后索引整体错位）。
  - ⚠️ 两条 flaky 都是**真门禁**才浮出来的（旧门禁下被 `|| true` + 恒 0 退出码吞掉）：
    ① `usePlayer.hook.test.tsx` 兜底链用例的墙钟依赖 → 改假定时器
    ② `music.controller.e2e` 的**真实网络依赖**（文件头写着"不依赖真实音乐平台
    网络"—— 那是许愿不是事实）→ 全打桩 + 加一道网络陷阱（fetch 一调用就抛 +
    计数，结束断言零真实网络请求）

- [x] **H5** `electron/src/main.ts` + `preload.ts` 零覆盖 —— **已补执行级测试**
  - `3f7373a` 先加了 `electron/src/ipc-surface.test.ts`（5 条**全量通道面**契约：
    renderer→main / main→renderer / 白名单方向 / 白名单生效），但只断言通道名，
    **不执行实现** → 行覆盖仍 0
  - 2026-10-21 补**执行级**测试（19 条）：`preload.test.ts`（真调 API，断言通道/
    参数/退订 —— 白名单外的通道**被拒绝**，不注册监听）+ `main.ipc-exec.test.ts`
    （真跑 main，断言 IPC 注册与内部 token —— 两次启动 token 不一样，不是写死的常量）

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

- [x] **H9** 两条 TS 转换管线的覆盖数据在 c8 合并时**互相吞掉** —— 门禁读到的
      覆盖率**可能只是其中一边**

  这条是 2026-10-21 补 H8 的测试时**撞出来的**（新写的 `lyricsShare.canvas.test.tsx`
  明明 9/9 全过，覆盖率却纹丝不动）。挖下去发现是一整类缺陷。

  **机制**：仓库里有两条互不兼容的 TS 转换管线会覆盖**同一个**源文件：
  - `.test.mjs` → `node` + 自实现 ESM loader（node 自己的 type-stripping）
  - `.test.tsx` → `vitest` + vite/esbuild 转换

  两份产物原本进**同一个** c8 temp 目录。c8 生成报告时按 URL 合并它们
  （`@bcoe/v8-coverage` 的 `mergeScriptCovs`）—— 而那个合并是按**字节偏移**
  匹配函数的。两份的偏移基于**不同的转换后源码**，对不上 → 同一份文件被拆成
  两组互不相认的函数条目 → 只有一组能对上 c8 手里的 source map →
  **另一组的覆盖被整份丢弃**。

  **实测**（`renderer/src/lib/lyricsShare.ts`，171 行）：

  | 来源                 | 行覆盖      |
  | -------------------- | ----------- |
  | 只跑 `.test.mjs`     | 71/171      |
  | 只跑 `.test.tsx`     | 167/171     |
  | **合并后（修复前）** | **67/171**  |
  | **正确值（并集）**   | **171/171** |

  ⚠️ **哪一边胜出不可预测**：`api.ts` 是 vitest 赢、`lyricsShare.ts` 是 node 赢。
  而门禁阈值（≥60% 行覆盖）就建立在这组数字上 —— 也就是说**门禁读到的可能是
  任意一边的值**，不是真实覆盖。这比「数字不准」严重：它让阈值判定不可信。

  **影响面**：renderer 有 **10 个源文件**同时被两条管线覆盖
  （`api.ts` / `hooks/usePlayer.ts` / `lib/lyricsShare.ts` / `lib/storage.ts` /
  `lib/audioFx.ts` / `lib/audioSlots.ts` / `lib/backup-crypto.ts` /
  `lib/spotify-wps.ts` / `auth/types.ts` / `auth/relogin-grace.ts`）。

  **修法**（已落地）：
  - 两条管线**各写各的 temp 目录**（`coverage/.tmp-node` / `coverage/.tmp-vitest`）
  - 各自出 lcov，再在 **lcov 文本层**取**并集**（`scripts/merge-lcov.js`）：
    lcov 是**行级**格式（`DA:<line>,<hits>`），**不依赖字节偏移** → 两边天然可比；
    「这行有没有被执行」是布尔语义 → 并集 = `max(hits_a, hits_b)`
  - 文本报告从合并后的 lcov 重算（`scripts/lcov-summary.js`）——
    `c8 report` 只能读 temp 目录，读不出合并结果
  - ⚠️ **两侧 report 的路径基准必须一致**（都用仓库根 + 绝对 `--src`），
    否则 `SF:` 前缀不同 → 合并时变成两个不同的文件 → 并集失效
  - ⚠️ **新鲜度标记搬出 `coverage/`**（`$PWD/.coverage-collected-at`）：
    采集开头会 `rm -rf coverage/`，标记放里面会被自己删掉 → 复用永远失效；
    但反过来标记活到采集结束才写 → 采集中途被 kill 时旧标记还在 →
    误判「数据新鲜」→ 拿半截数据当完整的用。所以**采集开始就删、结束才写**。
  - ⚠️ **函数覆盖的合并是「按名字去重」**：两条管线的函数**划分粒度不同**
    （同一文件 node 侧 75 条 FN 记录、vitest 侧 149 条，函数名交集 75/75），
    按 `(行号,名字)` 合并会把同一个函数数两遍；按名字去重后分母才接近真实
    函数数。**行覆盖不受此影响**（两边的 DA 行号一致，都是 TS 源码行号）。

  **实测效果**（同一份代码，全量采集，`5878ebc`）：

  | 指标                              | 修复前          | 修复后                 |
  | --------------------------------- | --------------- | ---------------------- |
  | **总行覆盖**                      | 84.96%          | **89.86%**             |
  | `renderer/src/lib/lyricsShare.ts` | 39.2%（67/171） | **100%**（171/171）    |
  | `renderer/src/api.ts`             | 80.8%           | **98.1%**（1766/1800） |
  | `renderer/src/hooks/usePlayer.ts` | 47.4%           | **87.8%**（1918/2184） |
  | `renderer/src/lib/storage.ts`     | —               | **95.3%**（222/233）   |

  条目数 **141 保持不变**（`--all` 语义未丢）、门禁绿、无失败文件。
  ⚠️ 修复前那 4.9pp 的差**不是新测试的功劳**（新测试只贡献了 H8 那部分），
  主要是**原本被吞掉的覆盖被找回来了** —— 这正是这个缺陷的严重性所在：
  之前的数字是**系统性偏低**的。

- [ ] **H7** 第 7/8 层空白：**E2E 全链路**与**稳定性压测**都不存在
  - Playwright 只覆盖 3 个视图（无凭据首屏 / 剧场三档密度 / ButtonSmoke），
    没有一条「登录 → 搜索 → 播放 → 收藏」的跨包链路
  - `visual.yml` 靠 `paths` 过滤触发，**改后端不跑**
  - 无任何并发/长稳脚本：`music.service.ts` 的 `mergeLibrary`、provider 并发 fan-out、
    like-sync 队列都没验证过

- [x] **H11** 覆盖率阈值门禁在 90% 的水位上**等于不存在** —— 换成 diff 粒度

  这条是 2026-10-21 评估「下一个值得补强的是哪里」时算出来的：

  | 场景                                 | 全局覆盖率 | 门禁结果 |
  | ------------------------------------ | ---------: | -------- |
  | 新增 100 行零覆盖代码                 |    89.65%   | ✅ 仍过  |
  | 新增 500 行零覆盖代码                 |    88.82%   | ✅ 仍过  |
  | 新增 1000 行零覆盖代码                |    87.81%   | ✅ 仍过  |
  | `proxyAudio` 整块失去覆盖             |    87.57%   | ✅ 仍过  |
  | **需要多少行零覆盖才跌破 60% 阈值**   | **21324 行** | —       |

  仓库自己的 workflow 注释早就写了这件事（`test.yml`：「一个 PR 把某个文件从
  80% 拉到 0%，全局仍然过」），但当时的结论是「挪到每日定时跑」—— 那只是
  **不看**了，不是**修好**了。

  - ✅ **已补**（`c293e5e` + `3760622`，新增 `scripts/coverage-diff-gate.js`）：
    **判据换成「本次 PR 新增/修改的代码行必须被执行过」**
    - 拿 `git diff -U0 <base>...HEAD` 的新增行号 ∩ lcov 的 `DA:<line>,<hits>`，
      落在交集且 `hits=0` 的行 = 「这次改的代码，测试从没跑到」
    - 注释 / 类型声明 / 空行**不在** DA 记录里 → 天然跳过
    - 新增文件从没被任何测试 import → 全部可执行行都算未覆盖 → 拦
    - 兜底判据：**PR 触碰的文件整体覆盖率 0% → 拦**（抓「PR 删掉了该文件的
      测试」—— 那种情况不产生新增行，判据 1 抓不到）
  - ✅ **不需要 base 分支的覆盖率基线**：它问的是「你这次写的代码有没有被
    跑到」，不是「比上次差多少」→ 不用跑两遍套件（+18 分钟）、不用存基线
    快照（持续 diff 噪音，且基线本身可能已经偏低）。
  - ✅ **不额外花时间**：`test:ci` 本来就是**插桩**跑的（PR 上就在跑）→
    lcov 已存在 → 「过没过」和「覆盖多少」来自**同一次执行**（不会自相矛盾）。
  - ⚠️ **三条数据完整性护栏**（都是「宁可明确报错退出 2，不硬判」）：
    1. **lcov 路径基准不对**（从包目录内采集 → `SF:` 是 `src/...` 而不是
       `packages/<包>/src/...`）→ 基准不对时文件路径对不上 diff → 每个文件
       都被当成「新增文件从未被 import」→ 一堆误报
    2. **lcov 不完整**（改动涉及的包没被采集）→ 半份 lcov 会让另外那些包的
       文件整个不在 lcov 里 → 全部可执行行都算未覆盖
    3. **lcov 混了多轮采集**（同一文件出现多次）→ 静默合并会让后一轮的 0
       覆盖把前一轮盖掉 → 门禁拿到的数字是错的
    另外：**拿不到 base ref 时明确失败**（退出 2），**不静默放过** ——
    静默放过 = 门禁形同虚设（这正是旧门禁的毛病）。
  - ✅ **端到端验证**（真实 PR 场景）：

    | 场景                            | 结果                     |
    | ------------------------------- | ------------------------ |
    | 改生产代码 + **没写测试**       | ❌ 拦下，精确报出 6 行   |
    | 改生产代码 + **补了测试**       | ✅ 通过                   |
    | 只加测试文件                    | ✅ 通过                   |
    | lcov 不完整 / 基准不对 / 混多轮 | ❌ 明确报错退出 2         |
    | 拿不到 base ref                | ❌ 明确报错退出 2         |

  - ✅ **自测调真身**（`judgeAddedLines` 是共享函数，主流程和自测都调它）：
    最初自测里另写了一份实现，结果把主流程的 `hits === 0` 改成 `false` 自测
    毫无反应 —— **测的是副本**（和 H10 的 `proxyAudio` 同款坑）。修掉后
    **4 个变异点全部被自测抓到**。
  - ⚠️ **局限（诚实说明）**：行覆盖只说明**这行被执行过**，不说明**这行的
    逻辑被断言过**。`if (x) { y(); }` 里新增一行 `y()` 而没断言 `y` 的效果，
    行覆盖也是 1。要更强的保证得靠 mutation testing —— 那个太慢，放不进
    PR 门禁。

- [x] **H8** renderer 的「必经之路」被整体 mock 掉 —— **api.ts 真身从未被执行**

  这条不是"覆盖率偏低"，是**门禁在骗自己**：renderer 现有的每一份测试都用
  `vi.mock('../api')` 把 api.ts 整个换掉。于是

  - `fetchWithToken`（token 注入 / `credentials: include`）—— **零执行**
  - `json()`（错误体 → `AuthError` + code 映射）—— **零执行**
  - 70 个 API 函数各自的 URL / method / body 拼装 —— **零执行**

  后果很具体：URL 拼错（少个 `/music` 前缀）→ 服务端回 SPA 的 index.html →
  renderer 报 `Unexpected token '<'`；401 没映射成 `AUTH_EXPIRED` → 登录过期
  弹成"未知错误"；token 没注入 → CSRF 门禁 403。**这三类 bug 现有测试一个都抓不到**，
  因为它们全在被 mock 掉的那段里。

  - ✅ **已补（2026-10-21，`f4125f6`）**，两份互补：
    - `renderer/src/api.real.test.tsx`（17 条）—— **不 mock api.ts**，只 stub
      `globalThis.fetch`，让真身跑起来。测**错误路径**：token 注入 / credentials /
      保留调用方自己的头、AuthError 映射（`AUTH_EXPIRED` / 未知 error 降级成
      `AUTH_UNKNOWN` / body 非 JSON / 空 body 退回 `status statusText`）、
      `getLibrary` 的 404→null。
      ⚠️ 必须是 `.test.tsx` 且用**动态 import**：`API_ORIGIN` 是模块加载时的
      快照，`window.electronAPI` 必须先摆好；且 renderer 的 vitest 只 include
      `.test.tsx` 模式，`api.ts` 用了 `import.meta.env` → ts-node 加载不了。
    - `renderer/src/api.contract.test.tsx`（28 条）—— **表驱动**测**请求契约**：
      每个 API 函数一行，断言 method / URL / body。表驱动而不是一条一个 it，
      是因为 70 个函数形状相同、真正会出 bug 的是「请求了哪个 URL」；
      **新增一个 API 函数时补一行表格 = 补一条契约**，覆盖不漏。
      顺带钉住两个真实踩过的坑：远端歌单的第二个 query 参数分隔符必须是 `&`
      （写成 `?` → limit 被静默丢掉）、`parseRemotePlaylistInput` 的各平台链接形态。
  - ⚠️ **本轮同时补上 `lyricsShare.ts` 的 canvas 路径**（41.5% → 目标 ~100%）：
    唯一未覆盖段是 `downloadLyricsImage`（72-171）。happy-dom 的
    `getContext('2d')` 返回 **null**、`createImageBitmap` 不存在 → 全部打桩，
    断言**渲染意图**（画了哪几行、用什么字体、封面走不走 `/music/cover-proxy`、
    下载文件名对不对）而非像素。单独成 `.test.tsx`（renderer vitest 只 include
    该模式），与 `lyricsShare.test.mjs`（node 直跑的纯函数档）互补。
  - ⚠️ **`App.tsx` 仍 0%（741 行 composition layer）—— 故意不补**：
    它不产出业务逻辑，只把十几个 hook 的返回值接到组件 props 上。要测就得
    mock 掉整个 hook 层（等于把要测的东西也 mock 掉了），**测出来的只是
    "React 没崩"**。真要盯接线，正确的位置是 H7 的 E2E 全链路（登录 → 搜索 →
    播放 → 收藏），那里天然跨包、也天然验证接线。

- [x] **H10** 播放链路枢纽 `proxyAudio` 零覆盖 —— **每首歌必经，却一行没测**

  这条是 2026-10-21 评估「下一个值得补强的是哪里」时，按**未覆盖连续段**
  （而不是覆盖率百分比）挖出来的。

  `music.controller.ts` 的 `proxyAudio`（899-1001）是**所有平台音频流的必经之路**：

      renderer <audio src="/music/stream/qq/xxx">
                → GET /music/stream/:provider/:trackId
                  → musicService.getStreamUrl() 拿上游 URL
                    → proxyAudio() 转发到上游 CDN

  它此前 **899-1001 连续 102 行零覆盖**。

  **为什么一直没被发现** —— 不是"忘了测"，是**测错了对象**：
  - `music.controller.allowlist.test.ts` 只测白名单**纯函数**
    （`isStreamHostAllowed`）—— 测的是**判据**，不是**调用方**
  - `music.controller.stream.test.ts` 把 `proxyAudio` 的模式**复制到测试里**跑
    （该文件头自己写着 "Simulates the post-fix `proxyAudio` pattern"）——
    **测的是副本，不是真身**。真身改了，副本照样绿。
  - 唯一一次真打 `/music/stream` 的 e2e（`auth-expired-validate.e2e.test.ts`
    第 321 行）只覆盖「上游抛 401 → 透传」这一条路径。

  **这块坏了会怎样**：

  | 分支                           | 坏了的症状                                   |
  | ------------------------------ | -------------------------------------------- |
  | Range 头转发（931-932）        | seek 失效，大 FLAC/MP3 拖不动                |
  | 206 部分响应（936/976）        | 拖动进度条直接崩                             |
  | CORS 头（967）                 | **整个声波环失效**（analyser 读不到样本）    |
  | 上游 502 + 诊断日志（942-952） | 上游挂了只看到 code=4，**排查要卡两小时**    |
  | 非音频 content-type 告警       | 运营商拦截页伪装成音频，**静默播不出来**     |
  | stream error listener（988）   | CDN reset → **Node 整个进程死**（unhandled） |
  | `res.on('close')` destroy      | 换歌还在拉上游 quota                         |

  它同时是 **SSRF 边界**（防把 controller 当开放代理）。

  - ✅ **已补**（`a37bdeb`，新增 `music.controller.proxy-audio.test.ts`，32 条）：
    - **打真身**：上游用**本地 http server**（真 socket）→ `fetch` 走真实
      undici 响应体路径；响应侧用**真 `http.ServerResponse`** + 假 socket，
      只覆写 `write`/`end` 捕获字节
    - ⚠️ **响应替身不能用手搓对象**：`Readable.pipe` 要求 dest 是真 Writable
      （会调 `dest.once('drain')`）→ 手搓对象报
      `TypeError: dest.once is not a function`（实测踩过）
    - ⚠️ **pipe 是异步的**：`await proxyAudio()` 返回时数据还在管道里 →
      断言 body 前必须等 res 的 `finish` 事件
    - **网络陷阱用白名单式**（只放行本地 origin）：本文件必须能出网（打本地上游），
      不能用 e2e 那种"任何 fetch 就炸"的陷阱
    - **SSRF 那条显式切 `NODE_ENV=production`**：dev 模式是**故意放行**非白名单
      host 的（Bug #4 Level 2），不切 production 测不到真正的 403 边界
    - 顺带补上 `coverProxy`（1093-1161）—— **同一个模式**（白名单 → fetch →
      `fromWeb().pipe()`），e2e 只测到 400/403，流式成功路径和 502 全裸
  - ✅ **变异测试证明不是假测试**（**17 个变异点全部被抓到**）：

    | 变异                  | 结果                                      |
    | --------------------- | ----------------------------------------- |
    | 删 CORS 头            | ❌ 1. CORS 头                             |
    | 不转发 Range          | ❌ 2. Range 转发                          |
    | 206 改写成 200        | ❌ 2. 状态码透传 206                      |
    | 502 改 500            | ❌ 3. 上游失败 502                        |
    | 关掉 SSRF 检查        | ❌ 4. 三条全红（精确报「泄漏 1 个请求」） |
    | 删 close handler      | ❌ 6. upstream 被 destroy                 |
    | 改 error listener 名  | 💥 **进程非零退出**（UND_ERR_SOCKET）     |
    | 删 coverProxy CORS    | ❌ 8c. CORS 头                            |
    | 删 coverProxy 缓存头  | ❌ 8c. 缓存头                             |
    | coverProxy 502 改 500 | ❌ 8d. 上游失败 502                       |
    | qq Referer 改错       | ❌ 9a. qq 用 y.qq.com 的 Referer          |
    | netease Referer 改错  | ❌ 9d. netease 用 music.163.com 的        |
    | deezer Referer 改错   | ❌ 9e. deezer 用 deezer.com 的            |
    | spotify Referer 改错  | ❌ 9e. spotify 用 open.spotify.com 的     |
    | 非法 q= 不降级        | ❌ 9b. 非法 q= 降级成 standard            |
    | mm= 被丢掉            | ❌ 9c. mm= 透传给 service                 |
    | 401 被压成 502        | ❌ 9f. 上游 401 → 透传 401                |

    特别值得记的是「关掉 SSRF 检查」那条：最初的实现下，防护一坏，测试会死在
    "打到了 169.254.169.254"这种**网络事故**上，而不是死在"期望 403 实际发了
    请求"这个**断言**上 → 报错信息把人引向查网络而不是查防护。改成**先记录
    再抛**，断言层能读出「本来不该发的请求列表」，失败信息才指得准。

  - ✅ **端点层也补上**（`18b8258`，32 → 43 条）：前 8 组直接调
    `controller.proxyAudio()` —— 覆盖到「转发」这一步。但**路由层**还有一段
    没测（`stream()` 方法 820-898）：provider 分支（各平台各自的 Referer）、
    `q=` 音质解析（非法值降级 standard）、`mm=` mediaMid 透传、上游 401
    → 端点层透传。现在走**完整 HTTP 路由**（用现成的
    `getRequestHandlerFromNestApp` 拿 Nest 的 express handler + 自己造
    带流式捕获的 req/res）。
  - ⚠️ **CI 的 EPERM skip 保护**（`18b8258`，必须）：这些测试必须真 socket
    （要模拟上游 CDN reset / 客户端断连 / Range 206），绑不上本地端口就没法跑。
    `music.controller.stream.test.ts` 在 CI 上就踩过这个坑（EPERM → 当时靠
    hardExit 兜底 exit 1 + 零输出，把 test.sh 整段掐断 —— electron/renderer
    测试因此永远跑不到）。现在：listen 失败 → **显式 skip + 干净退出 0**。
    实测（把 listen 换成抛 EACCES）：打印 skip、退出码 0 —— 不红 CI。
    不 skip 的话，CI 上这个文件一失败，server 段就红了 —— 而它红了不代表
    代码有问题，只代表环境没权限。
  - 实测：`music.controller.ts` 从 **77.33%（979/1266）→ 87.84%（1112/1266）**；
    899-1001 段从 **0 行 → 97 行覆盖**；生产代码**零改动**（只新增测试文件）。

## I. 存储与备份卫生（2026-10-20 实测发现）

> 起因：另一并行 session 实测用户机器上的 `state.json`（5.55MB）与
> `.storage/backups/`（7 份 × 8.9MB = 62MB 明文凭据副本），
> 挖出三个**真实存在**的问题。已在本分支落地。

- [x] **I1** 孤儿键 GC —— 会话没了，数据键还留着
  - 现象：会话被 TTL 回收后，`sessions` blob 里那条没了，可
    `music:<id>` / `library:<id>` / `playlists:<id>` 还躺在 store 里没人管。
    实测 48 个 `music:` 键里 **46 个是孤儿**，state.json 里 1.9MB / 5.55MB 是纯垃圾，
    而且会被**原样抄进每一份备份**。
  - 修法：`StorageService.gcSessionScoped(liveIds)` 按「session id 是否还在
    `sessions.byId` 里」回收；`SessionService.evictExpired()` 每次都调一次
    （**幂等**，老版本遗留的孤儿在升级后第一次启动就会被扫掉）。
  - 语义边界（重要）：只在**有 sessions blob** 时回收。没有 blob 说明会话全没了，
    此时不删 —— 那些键可能被一次「导入备份」复活（`POST /storage/import` 能把
    sessions blob 连同数据一起带回来），保守起见不碰。
  - 对用户可见的影响：会话过期后 ♤ 库本来就**已经不可达**（没有会话继承机制，
    新会话是新 id），平台账号里的红心才是真源（`importLiked` 可重新导入）；
    早先的备份快照仍然保有这份数据，**恢复路径没断**。
  - 验收：storage.test.ts 新增 2 组（只回收死会话的键 / 幂等）；
    session.test.ts 新增 2 组（过期会话连带回收 / 启动清理历史孤儿）✅

- [x] **I2** 备份文件权限 0644 → 0600（**明文凭据同机可读**）
  - 现象：`state.json` 每次写都 chmod 0o600（storage.ts 里写明了「QQ cookie /
    网易云 MUSIC_U / Spotify token 全是明文」），但**备份路径没收紧** ——
    备份文件是 umask 默认的 **0644 = 同机其他用户可读**，备份目录 0755。
  - 修法：备份目录 0700、备份文件 0600（`mkdir`/`writeFile` 的 mode 只在创建时
    生效，所以两边都再 chmod 一次，覆盖「已存在」的情况）；Windows 上 chmod
    失败按 best-effort 降级（和 storage.ts 同一套处理）。
  - 验收：backup e2e 新增 2 组断言（文件 0600 / 目录 0700）✅

- [x] **I3** 「每日备份」被 dev 热重载刷成「最近 7 次重启」+ 备份体积
  - 现象：`onModuleInit` 每次进程启动都写一份备份。dev 的 `nest start --watch`
    每次热重载都重启 → 保留的 7 份全成了「最近 7 次重启」，真正的每日备份被挤掉。
  - 修法：启动时若 24h 内已有备份就跳过（`manual` / `daily` 不受影响）；
    备份文件名时间戳加到**毫秒**（原来只到秒，同一秒内两次备份会撞名互相覆盖）；
    备份内容不缩进（`null, 2` 会把 5.5MB 膨胀到 8.9MB，+60%；备份是给机器还原的，
    需要人看时 `jq . backup-xxx.json`）。
  - 预期效果：单份备份 8.9MB → ~3.4MB，7 份合计 62MB → ~24MB
  - 验收：backup e2e 新增 3 组（合法 JSON + 不缩进 / 手动备份不受拦截 /
    startup 有近期备份时跳过）✅
