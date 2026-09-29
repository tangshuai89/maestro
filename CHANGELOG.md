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

### Fixed
- **P0/P1/P2/P3 全量审查修掉的 3 个阻塞**（2026-09-28，review → fix）：
  - **`afterPack-vmp.cjs` 调了不存在的入口**（`python3 -m castlabs_evs.vmp sign-pkg`
    —— castlabs-evs 只有 `evs-vmp` / `evs-account` 两个 CLI，没有 `python3 -m
    castlabs_evs` 的 `__main__`）。意味着**不带 `SKIP_VMP=1` 的 `npm run pack`
    必然抛 `No module named castlabs_evs`**，「0.2 逻辑已就绪」这句话本来是不
    成立的。现改为解析可执行文件路径（`EVS_VMP_BIN` → `~/.castlabs-evs-venv/bin/
    evs-vmp` → `~/.local/bin` → brew），找不到时抛带安装命令的可读错误。
  - **打包产物白屏**（跨 P0/P1/P2/P3 的地基 bug）：`vite.config.ts` 没设 `base`，
    prod 走 `mainWindow.loadFile()` = `file://`，vite 默认 `base='/'` 把产物入口
    写成 `src="/assets/main-*.js"` —— 绝对路径在 `file://` 下解析到**文件系统根**，
    index.html 和 lyrics.html（桌面歌词浮窗）一起白屏。`npm run dev` 走
    `loadURL(http://127.0.0.1:5173)` 所以永远测不出来，只有 `npm run pack` 的
    产物才命中——而打包冒烟一直卡在 EVS 凭据上从没真跑过。现加 `base: './'` +
    回归测试 `renderer/src/test/build-base.test.mjs`。
  - **桌面歌词锁定后无法解锁**（§7.2）：锁定态下浮窗把自己的齿轮藏了
    （`{!prefs.locked && ...}` + scss `display:none`），设置面板打不开，而
    `locked` **持久化**到 `userData/desktop-lyrics.json` —— 用户一旦锁上，
    退出重开照样锁死且依然无解，最后只能 Cmd+Q。修法：Tray 加「桌面歌词 · 锁定
    位置」勾选项（常驻入口；renderer 侧刻意不放，锁定时收不到鼠标事件）。
- **P2 Lite 模式 / P3 桌面歌词浮窗审查发现的 13 个缺陷**（2026-09-28 review → fix）：
  - **P2（#6.3）**：lite 下点 ✨ 被全屏 `RecoLoading` 接管（遮住三元素、且让
    `LiteView` 的 `recoRunning` 分支变生产不可达死代码）→ 渲染条件排除 lite，
    loading 交回内联 spinner，决策记进 `spec.md` §6 偏离 5；`overlayOpen` 补
    `authError` / `showCookieFallback`（原先 lite 下按一次 Esc 关两层）；Space 让位
    条件补 `BUTTON` / `role="button"`（空格的 click 是 keyup 合成的，keydown 的
    `preventDefault` 会吃掉，键盘用户只能按 Enter）；从 Settings 切到任何紧凑态自动
    关设置页（mini 下同样是全屏遮罩，同构一起修）；`LiteView.test.tsx` 的"只渲染三类
    元素"原是自证式断言，改成「可交互元素恰好 4 个」的可证伪契约；无 DeepSeek key
    时 ✨ 加 `is-unset` 虚线态；⛶ 退出键 `pointer-events` 随显隐切。
  - **P3（§7.2）**：`show()` → `showInactive()`（开浮窗不再抢主窗口焦点），接口里把
    `show()` 删掉让误用在类型上就被挡住；纯 resize 不落盘（Electron `moved` 只在
    拖动时发 → 拉大的尺寸退出即丢）→ `on()` 加 `'resized'` 与 `moved` 共用 debounce；
    多显示器还原 bounds 注入 `clampToVisibleDisplay`（按 `workArea` **相交**判可见，
    位置失效只丢 x/y 保留宽高）；overlay 专属的两个 IPC 通道补 sender 校验（preload
    是主窗口与浮窗共用的，不校验等于把「锁死用户浮窗」的权限开给任意 renderer）；
    `getStatus()` 补 `.catch`；浮窗加歌名行（`state.title/artist` 一直在契约里推但
    从没被读过）；浮窗不再引 Google Fonts（每次开窗一次外网请求 + 离线静默失败）。
- **P3 桌面歌词 IPC 契约回归测试扩到 6 项**——补一条「overlay 专属通道必须有 sender
  守卫」的**接线层**断言（controller 行为测了，但"main.ts 那两个 handler 真的调了它"
  此前只有代码本身保证，而这个仓的教训正是接线错不会报错、只静默失效）。
- **`reco.test` flaky 修复**——断言卡的是统计量 `hotCount >= 8`（期望 ~9.5），而
  `pickTasteSeeds` 不注入 `rng` 时用 `Math.random`，偶发抽到 7 就红（2026-09-28 全量
  `npm test` 炸过一次、单独重跑 5 次全绿）。现在注入 mulberry32(42)：断言强度不变，
  结果可复现。
- **`figma-code-connect.json` 补 SettingsModal 的两个 prop**（`playerMode` /
  `onChangePlayerMode`）——P2 加了 Settings「① 播放模式」节但没同步 Code Connect
  映射，`npm run test:ci` 里的 `figma-code-connect-validate` 是红的（109/110）。

### Added
- **#7.1 10 段均衡器 EQ**（`specs/audio-fx/`）—— 31/62/125/250/500/1k/2k/4k/8k/16k
  十段 peaking（Q=1）级联 + 8 个预置（平直/流行/摇滚/古典/人声/低音增强/高音增强/夜间）
  + 总开关，存本地偏好并进备份集，Settings 新增「② 音频」节。
  - `lib/audioFx.ts`：频段表 / 预置 / 归一（`normaliseGains` 把 localStorage 与备份
    导入的脏数据挡在 Web Audio 之外 —— NaN 增益 = 静音且**不报错**）。
  - `lib/eqChain.ts`：链构建与参数推送抽成**纯函数**。`usePlayer` 是大 hook，测它要拉
    React 运行时 + 假 `<audio>`，而 EQ 恰恰是"写错了不报错、只听起来不对"的地方
    （串错顺序 = 整体发糊、`.value =` = 每拖一下咔一声）。抽出来后用记录调用的假 ctx
    就能把连接顺序和参数写法钉死。
  - 建链只在 graph 建立时做一次，之后只改参数、**绝不重连**：EQ 节点提前建好
    （哪怕全 0 dB），重连会发生在正在出声的时刻。
  - 开关关闭 = 各频段 ramp 到 0 dB 而非 disconnect 真旁路（后者会咔哒），曲线保留在
    prefs 里、重新打开即恢复。
  - analyser 移到 EQ **之后**（声波环要反映用户听到的声音，不是 EQ 前的原始信号）；
    `f9 → destination` 与 `f9 → analyser` 并联，analyser 创建失败也不会静音。
  - UI 诚实标注适用范围：**Spotify WPS 路径不生效**（SDK 自己解码输出）。
- **crossfade（C 组）本轮不做**——`<audio>` 的 `src` 由 React 绑定，双元素方案要把
  src 改成命令式管理，会动到 P1/P2/P3 都依赖的"src 绑定"不变量，留作独立一轮。
- **ReplayGain 明确不做**（spec §5 三条理由）：`loudness` / `replayGain` / `gain_db`
  在 server types / renderer api / common 里零命中（没元数据可优先）；AnalyserNode
  拿到的是"已经播过的那几秒"而不是整轨响度（算法不成立）；动态增益与"记住我的音量"
  直接冲突。在没有元数据时宁可让用户自己拉滑块，也不要一个假的自动归一。

### Added
- **桌面歌词 IPC 契约回归测试**（`electron/src/desktop-lyrics/ipc-contract.test.ts`，
  6 项）—— IPC 通道名拼错**不会报任何错**，只会静默失效，typecheck 和单测都
  覆盖不到（controller 测试是直接调方法、绕过了通道名）。测试按方向分别校验
  （renderer→main 的 `send/invoke` vs main 侧 `ipcMain.on/handle`；main→renderer
  的 `on` vs `webContents.send`），并守住「锁定态必须存在浮窗之外的解锁出口」
  这条产品不变量 + preload 白名单的两条不同订阅路径边界。

- **桌面歌词浮窗**（NEXT-ITERATION §7.2）——中文用户刚需：独立透明无边框置顶窗，
  随播放逐行高亮。spec `specs/desktop-lyrics/`。
  - **main 进程**（`packages/electron/src/desktop-lyrics/`）：`prefs.ts`（偏好归一 +
    `userData/desktop-lyrics.json` 原子落盘）、`window-options.ts`（透明/无边框/
    `skipTaskbar`/`backgroundThrottling:false` 的纯函数窗口配置）、
    `desktop-lyrics-controller.ts`（懒建窗口、`screen-saver` 档置顶、
    `visibleOnAllWorkspaces`、锁定点击穿透 + hover 放行、拖动位置 debounce 落盘）。
    BrowserWindow 经工厂注入，单测用假窗口，不依赖 electron 运行时。
  - **播放状态单向流**：主窗口 `hooks/useDesktopLyrics.ts` 算「当前行/下一行/
    行内进度」（进度按 5% 分桶去抖）→ main 转发 → 浮窗纯展示。浮窗**不碰
    `<audio>`、不请求后端**，所以开关浮窗不影响播放、Web Audio graph 不动。
  - **行号判定与 TheaterView 共用** `lib/lyrics.ts` 的 `activeLineWindow`
    （50ms 行首容差），杜绝"浮窗和面板错行"。
  - **第二个 HTML 入口** `lyrics.html` + 独立样式 `styles/desktop-lyrics.scss`
    （只引 token 层；4 组配色是 token 不是硬编码，scanner 预算 0）。
    产物 4kB JS + 8kB CSS，不拖主 bundle。
  - **样式可调**：字号 3 档 / 4 组配色（亮·暗·青·琥珀）/ 描边开关 / 锁定，
    都在浮窗 ⚙ 面板里；位置尺寸与偏好跨重启恢复。
  - **入口三处同源**：Titlebar `词` 按钮、`⌘⇧D`（`⌘⇧L` 归 lite 模式）、
    Tray「桌面歌词」勾选项 —— 任一处改动三处同步。
  - 测试：main 侧 3 个测试文件 + 浮窗组件 10 例 + `lib/lyrics` 17 例。
  - 未做：全局热键（`globalShortcut`）归 #7.3；逐字卡拉 OK 未做。
- **Lite 播放模式**（NEXT-ITERATION §6.3）——第三种播放视图 `lite`：整屏只有
  **歌名 + 上一首/下一首 + ✨ 智能推荐**，一条 spec 落地（`specs/lite-mode/`）。
  - `PlayerMode` 从 `'theater' | 'mini'` 扩为三态，类型与读写搬进
    `lib/storage.ts`（`STORAGE_KEYS.playerMode`），顺手进备份/还原集；
    键名仍是裸 `player-mode`，老用户已选的 theater/mini 不丢。
  - `components/views/LiteView.tsx`：只消费 `usePlayer` 已暴露的
    `handlePrev` / `handleSkip`，**不复制播放逻辑**；`<audio>` 常驻 App，
    切模式只换条件渲染分支 → Web Audio graph 不重建，往返切当前歌/队列/进度
    天然不丢。
  - ✨ 复用 `useReco.handleReco()`（与 TheaterView 同一入口）：无 DeepSeek key
    时走既有「弹 key 框」友好提示。
  - 三条切换路径：Settings 新增「① 播放模式」节（完整 / 迷你 / 极简三选一）、
    `⌘⇧L`、lite 内 hover 显形的 `⛶` 键；`Esc` 回 theater、`Space` 播放/暂停
    补键盘可达性（焦点在输入框 / 浮层打开时一律让位）。
  - Electron：`player:mode` 收 `'lite'`（`preload` 类型 + `main` 态机）——
    紧凑态从"只有 mini"泛化成 mini(600×104) / lite(480×300) 两种尺寸，
    **mini ⇄ lite 互切不再覆盖存档的 theater bounds**（原来只有一条分支）。
    lite 保留红绿灯（mini 那种 hover 才显的 pill 形态不适合小窗）。
  - lite 下 titlebar / 搜索面板不渲染（`SearchPanel` 挂载条件只看 `searchOpen`，
    进 lite 时顺带 `setSearchOpen(false)`），`.app.lite-mode` 走主题令牌背景
    而不是 `.theater-mode` 的深空黑。
  - 测试：`LiteView.test.tsx` 7 例（含"只渲染三类可视元素"白盒断言）、
    `storage.test.mjs` +7 例、`SettingsModal.test.tsx` +1 例（切模式回调）。
- **多源歌词合并去重**（NEXT-ITERATION §4「多源歌词聚合」）——歌词从
  first-hit-wins 改成真正的**并集**：并行拉 QQ / NetEase / Deezer 的候选源，
  按优先级把各自缺的那几行并进来，文本重复的按 400ms 时间容差去重。
  - `packages/server/src/common/lyrics.ts`：新增纯函数 `mergeLyricSources`
    （不碰网络，可白盒测试）+ `lyricLineKey`（全角/标点/繁简归一，
    复用 `@maestro/common` 的 `cjkUnify`，与 catalog 匹配同一条流水线）。
  - **时间轴对齐**：低优先级源的偏移用「共同词 delta 的众数」估计（不是中位数
    ——副歌重复会产生离群 delta，中位数会被拖偏）。对齐后的行落回主时间轴，
    两源各自独有的一行都能补进来。
  - **错位源整源丢弃**：系统性偏移 > 3s（不同录音 / 人声裁剪不同）→ 整源
    `rejected`，绝不污染时间轴；单锚点不下结论（误判会整源丢内容）。
  - **纯文本源不参与合并**：lyrics.ovh / Deezer 无时间戳落不进时间轴，只在
    「一个 synced 源都没有」时兜底（第三方调用口径不变）。
  - `lyrics.service.ts`：`getLyricsAggregated` 默认并行合并，返回新增
    `mergedFrom` / `added` / `dropped` / `rejected`；`?merge=0` 保留旧快路径。
  - TheaterView 加 `MERGED · QQ+NETEASE (+n)` 徽章（`th-lyric-tag--merged`）。
  - 测试：`lyrics.test.ts` +13 项（并集/去重/副歌重复/对齐/错位/纯文本/上限/
    脏数据），`lyrics-aggregate.e2e.test.ts` 重写为 merge + 快路径双模式。
- **歌词分享图接线 + 无歌词引导**（NEXT-ITERATION §4 收尾）——`downloadLyricsImage`
  写了但全仓零 import，本轮把它接进 AETHER 剧场。
  - `lib/lyricsShare.ts` 新增纯函数 `sliceLyricsWindow` / `lyricsImageFileName`：
    **以用户点的那一行为中心**取 40 行窗口（原来永远从第 1 行截，点长歌第 80 行
    导出的图里根本没有那句），命中行图上加粗 + accent + 左侧竖条。
  - `App.tsx` 持副作用（`downloadLyricsImage` + 状态机 `idle/working/done/error`
    → 2.4s 回落），`TheaterView` 纯展示传 `onExportLyrics(highlightText?)`。
  - 无歌词态：接上一直没 UI 的「换个源找歌词」（server `/music/lyrics/search`
    早就存在）+ 新增「去网易云提交歌词 ↗」（链搜索页带歌名歌手）。
  - 测试：`lyricsShare.test.mjs` 9 项纯逻辑 + `TheaterView.test.tsx` 7 项交互。
- **推荐离线评测基座**（`specs/reco-deepseek/spec.md` v2.2 段）——留一法把库里
  一部分红心歌藏起来，看推荐能不能把它们找回来，让"变好了吗"有数字可依。
  - `packages/server/src/reco/eval.ts`（新，纯函数）：留出切分（rng 可注入 → 同 seed
    可复现）、`recall` / `MRR`、**同艺人 vs 新艺人分档**（同艺人天然虚高，新艺人才是
    泛化能力）、多样性、多轮平均、人读报告、与基线对比。
  - **指标分两层**：`poolRecall`（藏起来的歌有没有进候选池 = 检索层）与
    `recallAtK`（有没有真推给用户 = 选择层）——直接指出损失在哪一段。
  - `RecoService.evaluate`：跑**真实**流水线（统一搜索 + 相邻艺人 + 电台），
    `noCache` 保证评测不污染产品的候选池缓存、也不写推荐历史；
    `pool` 模式（默认，零 token）与 `llm` 模式（完整流水线）可选。
  - `POST /api/reco/eval` + CLI `npm run reco:eval`（`--holdout/--count/--runs/--seed/
    --mode/--json/--save/--compare/--session/--storage`）；CLI 只读 `state.json`
    （直接从 blob 取会话，不经 SessionService，不写业务数据）。
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
- `packages/server/src/reco/eval.test.ts`（新）：5 组口径测试（切分不重叠/可复现/
  至少留 1 首训练、召回与 MRR 含 Top-K 截断与空输入、同艺人分档、多样性、
  多轮平均 + 报告格式 + 基线对比升降标注）。
- `packages/server/src/reco/reco.test.ts`：新增 46/47（`evaluate()` 能真的把藏起来的
  歌找回来且同 seed 可复现；检索全空时各项指标必须为 0，防假阳性），45 → 47。
- `packages/server/src/reco/reco.test.ts`：新增 37–45（候选池并发下顺序确定 /
  候选池缓存命中 + timings + `max_tokens` / prompt 候选行数上限 / 信号
  清洗防抖衰减 / 信号进口味档案 / 负样本排除 / 艺人拉黑 / 种子模式端到端），
  36 → 45。
- `packages/server/src/reco/reco.controller.e2e.test.ts`：新增 9–11
  （`POST /reco/signal` 脏数据 → 2xx + stored=0 / 合法单条 / 批量含脏数据），
  10 → 13；再补 12（`POST /reco/eval` 空库 → 400 library_empty），13 → 14。
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

### Added (2026-09-03 → 2026-09-23)
- **Mini Player P1**（commit `71205ae`，spec `specs/mini-player/spec.md`）：
  Apple Music 式底部浮层 + 主窗口跟随缩放（theater → 620×170），`Cmd+Shift+M`
  切换，`<audio>` 不重建（Web Audio graph 保持），mode 持久化到 localStorage。
  新组件：`packages/renderer/src/components/mini/MiniPlayer.tsx` +
  `packages/renderer/src/styles/components/_mini-player.scss`（~257 行）。
- **Settings 完整化 + 渠道优先级 + 源连接健康**（PR #88，commit `a108b39`）：
  独立 Settings modal，按 Figma `03/Screen/Settings` 还原 AETHER 全屏风格
  （`c472b05`）。`packages/renderer/src/components/settings/` 4 组件：
  `AccountsList` · `ChannelPriorityList`（拖拽排序）· `LibraryManager` ·
  `SourceHealthSection`（每平台最近 24h 拉取成功率）。
- **D 系列收尾**（D1 / D2 / D4 / D5_NEW / D7 / D8 / D10 / D11，
  见 `docs/d-series-status.md`）：
  - **D8** 桌面尺寸适配（`3d77586`）：三档 density（1440 / 1200 / 960）
    + 内容减法，原 1920 档方案改写为 transform:scale 1.29×。
  - **D10** MOTION SPEC 载体纠偏（`bcc09fe`）：FRAME 无 `description`
    属性，改用隐藏 TEXT 子节点 `MOTION_SPEC`。
  - **D11** Playwright 视觉回归 CI（`fa16e95`）：6 张基线 + 门禁双向
    自检；容差从 0.1% 调到 0.5%（跨机器文字 AA 噪声 0.29–0.39%，
    真漂移 0.69% 仍能命中，`f3f1f71`）；跳过判据改读 `package.json`
    防假绿（`ee14874`）。
  - **D5_NEW** 10 个新 component set 落地（`0738966`）：strict 110/110，
    24 个 set / 28 变体。
  - **D7** NowPlaying 三屏改变体结构完成（`6110e21`），连线手工收尾。
  - **D4** token ↔ SCSS 双向漂移门禁（`2b36fcb` · `faad44b`）：单一映射 +
    CI 离线腿 + MCP 只读段。
- **token-adoption 专题**（`04a4c24` · `6319635` · `aa0fcd0` · `628ea84`）：
  - 棘轮门禁：每替换一批降低新文件硬编码预算，`scan-hardcoded-colors
    --gate` 进 `test:ci`。
  - S3-3 / S3-5 两批替换：88 + 240 处 alpha 派生值换 token（配方 srgb）。
  - Settings token-adoption 二次补强（`628ea84`）：6 处直换 token + budget
    给品牌识别色扩 9 处。
- **离线评测基座**（`specs/reco-deepseek/spec.md` v2.2）：
  `packages/server/src/reco/eval.ts`（留一法）+ `POST /api/reco/eval` +
  CLI `npm run reco:eval`。指标分 `poolRecall`（检索层）与 `recallAtK`
  （选择层），同艺人 vs 新艺人分档 + 多样性 + 多轮平均 + 基线对比。
- **推荐延迟包 + 行为信号闭环**（`specs/reco-deepseek/spec.md` v2.1）：
  - 候选池并发化（`reco/candidate-pool.ts` TaskPool 边查边搜）。
  - LLM 输出封顶 `max_tokens=900` + prompt 候选行数 60→40。
  - 候选池缓存 10 分钟（key 不含信号指纹，否则连续点 ❤ 时永远打不中）。
  - `reco/signals.ts` + `POST /api/reco/signal`：播放 / 完播 / 早切 /
    红心 / 踩 / 种子六类信号（21 天半衰期）。
- **SourceChip 重设计 + 数字专辑状态角标**（`faacf65` · `9c4daaa`）：
  品牌 logo + 平台 brand 强背景色；chip 末尾 `[P]` / `[NP]` 标已购 / 未购。
- **剧场推荐卡跟随队列位置 + 种子胶囊底部遮挡修复**（`e1d2535`）。

### Fixed (2026-09-03 → 2026-09-23)
- **跨脚本元数据合并**（PR #87，commit `3c09fd8`）：搜索侧严口径——
  `buildUnifiedItems({crossScriptMerge:true})`，CJK ↔ 拉丁 script
  （如「寂寞，好了」+ Deezer 罗马音）在搜索链路下合并；library import
  走宽口径不变。详见 `docs/cross-script-matching.md`。
- **付费内容 vipLocked 检测 + 跨平台 fallback 跳过 vipLocked 候选**
  （`d30c3e5` · `10a5a77` · `fa91734` · `d926904`）：
  - `QqMusicProvider.detectQqVipLocked` 补 `price_track/price_album/pay_month` 识别。
  - `MusicService.findPlayableEquivalent` 跳过 vipLocked 候选防跨平台
    fallback 死循环。
  - 修：QQ 绿钻可播曲目不再误判为 vipLocked → 全锁时正确逃 Deezer 30s
    预览（`d926904`）。
  - 网易云搜索迁移 `cloudsearch/pc` 端点（`d30c3e5`）。
- **单平台行点击静默无效 + 综合搜索相关性排序**（`40ef7a7`）。
- **剧场下半屏纵向链联立定位 + 音质标签脱出播放键光晕**（`03957a3`）。
- **`30S TRIAL` 标签移出标题带**（`c306295`）：长歌名下不再被压住。
- **`usePlayer` D3 守护收紧**（`66e1a32`）：首次打开已 ❤ 的歌不再被守护误杀。
- **日语查询尾标点 strip**（`48c1789`）：搜索查询去掉 `。`/`!`/`?` 等结尾句号。
- **剧场死 CSS 清理**（`d00cfc3`）：`.th-lyric--prev/--next`、
  `.th-reco-running` 移除。
- **`ISSUES.md` 归档与跨引用修复**（`a8bb7d6`）：7 份过时文档归档。
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
