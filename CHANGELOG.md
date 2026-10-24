# Changelog

All notable changes to Maestro will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **refactor(tokens): D4-C5「让 token 真正被用起来」批 2 —— 38 处硬编码色值换成真实
  令牌消费**（spec: `specs/token-adoption` S3-10，2026-10-20）

  上游 S3 系列（PR #92 那批）把硬编码从 **507 → 140** 压下来了，但**留下的那 140 处
  恰好是"语义双关"的**——platform 品牌色、SVG `stopColor`、alpha 派生 rgba、背景深空色
  这几组当年被有意跳过（当时没有把握判定该落哪个语义）。本批按上下文逐个定案。

  - **platform 徽标色 8 处** → `var(--platform-qq/netease/deezer/spotify)`
    （`TheaterView.tsx` 的 `PLATFORM_META` 4 处 + `_liked-modal.scss` 的 `.lib-badge-*` 4 处）
    —— 顺带让 `--platform-deezer` **第一次有了消费者**（此前 57 个 token 里它零消费）
  - **背景深空色 `#02020a` 13 处 / 7 文件** → `var(--primitive-bg-bottom)`；
    `#0a0518` 2 处 → `var(--primitive-bg-top)`
  - **霓虹青 `#00e5ff` 7 处** → `var(--accent)`；**电光紫 `#5b2bff`** → `var(--accent-purple)`；
    **酸紫 `#b57bff` 3 处** → `var(--ai)`；**`#3b82f6`** → `var(--accent-blue)`（此前零消费）
  - **`#ffffff`（SVG `stopColor`）** → `var(--white)`
  - **`rgba(0,229,255,0.5)`（`.th-scan-arc` 的 `stroke`）** → `stroke="var(--accent)"` +
    `strokeOpacity={0.5}` —— 纯色 + 元素级 alpha，与 `rgba()` paint 数学等价
  - **shadcn bridge 的玻璃层 2 处** → 改引用 `var(--glass-stroke)` / `var(--glass-fill-strong)`。
    **单向引用无循环**（bridge 在 `_tokens.generated.scss` 之后加载），且顺手消掉了该文件头
    注释里"改 generated hex 后必须手动同步本文件 HSL"的维护债
  - **`providerLogos.tsx` 12 处补豁免** —— S3-8 早已写明"与 providerLogos.tsx 12 处同源，
    品牌识别不是设计令牌"，但实际没进 exempt 名单（另外 3 个同源文件进了）。补豁免时
    理由单独写：它用的是**官方品牌色**（网易云 `#e60026` / Spotify `#1db954`），与另外
    3 个文件用的 AETHER provider 色**不是同值**，不能共用一句话

  **账本**：硬编码 **140 → 90 处**（`--write-budget` 重新生成，**棘轮只降不升**；
  `_source-select.scss` / `tokens-bridge.scss` / `_base.scss` 归零后移出预算表）；
  生成层令牌消费率 **24/57 (42%) → 27/57 (47%)**；颜色类零消费从 5 个降到 **3 个**
  （`--text-muted` / `--success` / `--accent-warm`）。

  **验证**（全部为"同值/等价替换"的硬证据）：
  - `tokens:check` 绿（57 token 与 Figma dump 一致）
  - `typecheck` 绿 · `lint` 0 error · `token-integrity` 9/9 绿
  - vitest（TheaterView / SettingsModal / SearchPanel）85/85 绿
  - **`visual:test` 7/7 绿且一处基线未动** —— 4 档 density + 2 档 SourceSelect + shadcn smoke
  - **嵌套 var 专项验证**：`.th-badge.is-active` 用的
    `color-mix(in srgb, var(--badge) 25%, transparent)`，而 `--badge` 现在是
    `var(--platform-qq)`（嵌套 var）—— 这正是 spec §2 警告过的 alpha 配方雷区。
    Chrome 实测嵌套与字面量 computed 值**逐位相同**
    （`color(srgb 1 0.85098 0.239216 / 0.25)`），alpha 0.25 正确解析，已排除

  **剩余**（记为 S3-11 / S3-12）：Tailwind 默认色阶批（`_liked-modal.scss` 36 处 +
  `_settings-modal.scss` 9 处等，**属 shadcn Phase 2 批 1，不是 AETHER 令牌**，两个专题
  撞在同一批文件上须合并做）；provider 健康状态色 / AI 理由色（设计稿里没有这套语义，
  需先拍板归属）。

- **fix(album): 网易云专辑详情解锁 —— 展开卡片不再红字「album detail not supported」**
  （2026-10-20 用户报障：专辑行展开后报 `album detail not supported on netease`）

  **根因不是「网易云不支持」，是「没登录」**。`specs/album-search` 当年把
  `POST /api/album/{id}` 的 `code:-462 "请绑定手机后再试哦~"` 记成"IP 级反爬"
  —— 那个结论混着**未登录**这个变量（对照实验 4 header 变体 × 6 次全是在无
  cookie 下打的）。spec 自己的结语其实写了"需登录态，本机无登录会话无法验证"。

  2026-10-20 用真实登录态复测：`POST /api/album/{id}` → `code=200`、songs 完整
  （实测「最后的水族馆」21 首 / 2 碟，字段全对）。**端点没问题，缺的是登录态。**

  - `netease.provider.ts` 新增 `getAlbumTracks()`：映射 id/name/artists/
    duration(ms)/`no`（**碟内**曲序）/`disc`（"01"→碟号 1）/fee
  - 付费判定只能靠 `song.fee`（专辑端点**不返回 privilege**，单曲搜索才返回）：
    `fee>0`（数字专辑/付费单曲/试听）→ 标 vipLocked（与单曲搜索同口径，实测
    两端 fee 都是 8）；`fee=0` → **不标锁**（乐观）—— 反过来"非 VIP 一律标锁"
    会让整张专辑全变不可播、专辑 tab 直接废掉；`album.paid=true`（已买下整张
    专辑）→ 不标锁
  - 未登录 → 明确提示「请先登录网易云」（**不甩 code 给用户看**）；服务端那条
    英文 `album detail not supported on <p>` 改成中文（它会原样透到界面上）
  - **UI 多平台回退**：展开专辑时逐个平台试，第一个拉不到就换下一个源 ——
    以前只用代表源（`sources[0]`），那个平台一失败整张卡片就废了。现在只要
    **有一个**平台能给曲目，卡片就能用
  - 测试：provider 单测 +4 条（字段映射 / -462→提示登录 / 空专辑 / paid=true），
    renderer +2 条（多平台回退 / 全失败保留中文提示）；真实登录态端到端验过
    21 首全对

- **feat(album): 专辑跨平台 fan-out —— 点 ❤ 把「收藏专辑」同步到所有支持的平台**
  （spec: specs/album-fanout，2026-10-20）

  专辑搜索结果里点 ❤ → 把"收藏这张专辑"写进所有**有收藏专辑能力且已登录**的
  平台；再点一次取消。v1 真正落地的是**网易云**（QQ 无收藏专辑 API、Deezer 无
  per-user album save、Spotify 未实现专辑搜索 → 拿不到 albumId，只留接口位）。

  **写接口**（`netease.provider.ts` 的 `saveAlbum`）：

  - `POST /api/album/sub`（alg=itembased + id + sub=true|false），复用 provider
    既有的 `apiCall` —— appver / csrf_token / `__csrf` cookie / `X-Real-IP`
    四件套是网易云写接口不被 -460 风控拦的前提（与红心同族）
  - `code=405`「操作频繁」= 目标态已达成 → **视为幂等成功**（否则重试会白白
    退避 7 次 / 64s）
  - 端点提为常量 `NETEASE_ALBUM_SUB_ENDPOINT`：真伪以登录态实测为准，失败日志
    打 code + message，实测不符时一行可改

  **能力判定用 feature detection，不用静态 `hasAlbumSaveApi` 标志位**：
  `common/provider.ts` 里 `MusicProvider` 只是字符串 union、没有 interface 可扩展；
  且静态标志位会与"方法真的实现了"漂移（改方法名/删实现时标志位不会跟着变），
  于是"声称支持但调用会崩"。改为 `album-types.ts` 的可选方法接口
  `AlbumSaveProvider`。

  **三条语义**（都写进测试）：

  1. 结构性跳过（平台没能力 / 未登录）→ **不写 state**。写了就是假收藏污染 +
     角标虚高（"3❤" 其实只有 1 个平台）
  2. 单平台失败不阻塞其它 → 整体 `success` 恒 true，失败平台不进 `fannedOutTo`
  3. 取消方向**只**反写 state 里记过的 platform + albumId → 幂等，且不会动
     用户原本在别的平台单独收藏过的同一张专辑

  **状态**：`state.json` 新增 `albumFanOut` =
  `{ mergedAlbumId: [{platform, albumId}] }`。⚠️ 比 spec 原稿多存 `albumId` ——
  取消收藏要靠它反写，只存平台名撤不掉（track 侧 `FanOutEntry` 存 `trackId`
  是同一个教训）。老 state 文件无此字段时按空处理，不炸。

  **跨平台补齐**：统一专辑的 `sources` 只含"搜到了该专辑的平台" —— 搜「范特西」
  网易云没命中就没有 albumId，收藏写不进去。新增
  `findAlbumEquivalentOnPlatform()`：用专辑名 + 艺人去目标平台再搜一次，用
  album-search 已有的 `albumsProbablySame` 判等价 + **year 冲突守卫**（双方
  年份已知且不等 → 拒，挡住再版/豪华版）。⚠️ **没有新建第二套归一口径** ——
  spec 原稿要新建的 `normalizeAlbumKey` / `mergeAlbumLibrary` /
  `findEquivalentAlbum` 与 album-search 已上线的合并逻辑重复，两套 key 口径
  必然漂移（CLAUDE.md 明令禁止）。

  **端点**：`POST /music/album/save/merged` + `POST /music/album/save/:albumId`。
  ⚠️ 前者必须声明在后者之前 —— Express 按声明顺序匹配，否则 `album/save/merged`
  被 `album/save/:albumId` 截胡（`like/merged` vs `like/:trackId` 已踩过同一个
  坑，e2e 专门锁了这条）。`sources` 只在收藏方向必需；取消方向按服务端记录反写。

  **UI**（`AlbumResults.tsx`）：专辑行右侧加 ❤ 按钮（点收藏/再点取消，乐观
  更新 + 失败回滚），已收藏时显示 ♥ + **真实平台数**角标；点 ❤ 不会触发行展开
  （`stopPropagation`）。没有可收藏的平台时给明确提示，不静默失败。

  **失败隔离（review 必修）**：平台写接口 / 搜索接口**可能抛**（`withTimeout`
  不吞 rejection —— `Promise.race` 直接传播；网易云 `apiCall` 在网络失败 /
  响应非 JSON 时抛 `BadRequestException`，`searchAlbums` 在 `code!=200` 时抛）。
  抛出点在 `saveState` 之前 → 已成功的平台丢失落账 → **远端收藏了但本地无
  记录**（孤儿，角标不亮、merged 撤不掉）。现在写调用与等价查找都 catch →
  降级成"这个平台没写成"，整体 `success` 仍为 true。

  **远端写不进 state 锁**（review 中优先级）：三阶段执行 —— 规划（无锁，含
  网络：定向等价查找）→ 远端写（无锁）→ 落账（锁内，纯内存）。否则一次收藏
  最坏 ≈10s 会把该 session 其它 state 写路径（❤ / 踩 / queue refill）全排队
  （track 侧特意把远端写推队列就是躲这个）。

  **mergedId 漂移归一**（review 中优先级）：专辑 mergedId =
  `merged-${normalizeKey(代表源.title, 代表源.artist)}`，而**代表源会变**
  （QQ 缺席时 rep 变 Deezer）→ 同一张专辑两条记录 → 旧条成孤儿。按
  platform+albumId 重合扫 `albumFanOut` 归一（照 track 侧 `canonicalMergedId`）。

  **trackCount 分歧守卫**（review 中优先级，写路径正确性）：同名 + 同艺人 +
  同年份但曲目数差 >50% = EP vs LP / 豪华版 → **不是同一张专辑**。sources
  现在带 `trackCount`（用该平台自己报的那个，不是合并中位数），阈值复用
  `album.util` 的 `TRACK_COUNT_DIVERGENCE`（不另立一份）。

  另外：平台参数改**严格校验**（未知 → 400，不再被 `normalizeProvider` 静默
  兜底成 'qq'）；`albumFanOut` 加 LRU 上限（1000，照 `fanOut` 口径）；同平台
  entry 的 albumId 会更新（否则 unsave 撤旧 id、新的成远端孤儿）；单平台端点
  `toggleAlbumSave` 明确标注为 **raw / 不落账**（拿不到统一专辑键 → 角标不亮、
  不能用 merged 撤）。

  **二轮 review 残留**（三条，全部处置）：

  - 同平台可能挂**多条不同 albumId**（平台侧换专辑 id，每条都是真实写过的
    远端对象）→ plan/落账按 `platform:albumId` pair 去重、取消逐条撤；
    `fannedOutTo` 取消方向 = 该平台**全部撤干净**才计入（撤一半角标不灭）
  - plan（锁外快照）与落账（锁内）之间的并发窗口写明为**有意取舍** ——
    落账按"实际撤成功的 pair"摘条目，end state 自洽不产孤儿；消掉窗口要把
    网络 I/O 塞回锁里（最坏 ≈10s 堵全部 state 写），不值
  - 搜索角标改**两路注入**：`item.id` 精确 key + sources 的
    `platform:albumId` 与任一记录重合 —— 兜住 mergedId 漂移后记录留在老
    key 下、新 key 角标不亮的场景（track 侧 library `ptToFanOutKeys` 同思路）

  测试：服务端白盒 19 条 + e2e 6 条 + renderer vitest 11 条 = 36 条；变异验证
  四轮（不写 `albumFanOut` → 红；取消方向改用请求 sources 反写 → 红；去掉
  异常隔离 → 红；远端写挪回锁内 → 红）。

- **fix(player): QQ 取不到流时零兜底 → 界面卡在「等待播放」**（2026-10-19 报障）

  报障现象：启动后不播放，进度条 `00:00`、HUD 显示 READY、没有任何报错。

  **先分清责任**：用 provider 直连 QQ 复现，证实「取不到流」是**既有上游行为**，
  与本仓库改动无关，且是**逐首**的——《演员》能拿到 purl，《晴天》《天外来物》
  拿不到（同账号同时间）。真正的缺陷是应用对这种情况**一条兜底都没有**。

  三处修法：

  - **transient 重试加次数上限**（`shouldTransientRetry`）。旧实现是
    「重试成功后把 guard 清零」，而 `play()` 在坏源上照样 resolve → 清零 →
    下一个 `error` 又满足条件 → 「error → 重试 → resolve → 清零 → 再 error」
    无限循环，永远走不到跨平台兜底。改成按本首歌累加次数（`presentTrack` 重置）。
  - **重试后加卡死探测**（`isPlaybackStalled`）。`play()` resolve 只代表浏览器
    接受了播放请求，不代表出了声：坏源上进度永远停在 0。起一个 1.5s 探测定时器，
    到点还在 `00:00` 就走兜底，不让界面停在「等待播放」。
  - **radio 路径也能兜底**（`shouldSearchEquivalent`）。`tryFallbackSource`
    第一行原本是 `if (!unified || !cur) return false` —— QQ 电台 track 由服务端
    单平台生成、没有 unified，于是直接被踢出兜底链。而 `findEquivalentSource`
    只吃 `{title, artist, duration}`，radio track 一样有。同时把跨 await 的竞态
    守卫从「只比 unified id」换成 **song epoch**：radio 路径下 id 前后都是
    `undefined`，旧守卫等于没有（切歌了旧结果照样生效）。
  - 顺带：radio 兜底加了「同歌只换一次源」的闸，否则换源后 `presentTrack` 会把
    「已搜过」标记清成 false，可能 qq↔netease 无限来回换。
  - **QQ 探针日志带 purl 比例**。`alive=true reason=purl_present` 极具误导性：
    判定是「3 首探针歌里有 1 首能出流就算活」（保守优先，怕误报登录过期），
    于是「探针说活着」和「用户点的歌一首都放不了」可以同时成立——排查当天
    我自己就被这句带偏过。现在日志打 `purl=1/3`。判定口径不变（保守是对的），
    只是把区别显示出来。

  测试：策略纯函数 11 条（`usePlayer.test.mjs` 51–61）+ 接线契约 8 条
  （`playbackFallback.test.mjs`，源码层守「兜底没被删」）+ 探针比例 3 条。
  三次变异验证：去掉重试上限 → 2 条红；恢复 unified 早退 → F1 红；删掉
  radio 兜底闸的读/写任一侧 → F3 红。**纯函数测不到接线**（第二次变异暴露的
  盲区），所以必须有源码契约那一层——和上次 `<audio>` src 那次同一类错误。

- **fix(player): 交叉淡入淡出接线引入的回归 —— 切音质 / 试听降标准后卡在 00:00**
  （crossfade 的下一个 commit 修的，2026-10-19 报障）

  - **根因**：crossfade 要求"旧歌留在原元素继续播"，所以 `<audio>` 的 `src`
    从 React 绑定（`src={track.audioUrl}`）改成了命令式装载。这条隐式契约是
    「**改 audioUrl 必须同时真的装载元素**」——而有两处旧代码只写
    `setTrack({...prev, audioUrl})`，靠的正是 React 绑定去加载。改成命令式后
    它们只改了 React 状态、元素纹丝不动 → 用户看到「降了标准音质，但歌还是
    00:00 不出声」。
  - **受影响路径**：`handleTrialDetected` 的「VIP 试听降到标准音质同平台重试」、
    Settings 的 `changeQuality`（QQ / 网易云切音质）。两处都补了
    `reloadActiveWithUrl(url)`。
  - **为什么全部测试都绿**：纯逻辑（决策 / 调度）是对的，断的是"接线"——
    单元测试根本碰不到 DOM 与元素的 src。补了
    `src/hooks/audioSrcBinding.test.mjs` 从**源码层**守这条契约：凡改
    audioUrl 的地方附近必须有命令式装载、两个 `<audio>` 不得绑 src、
    reload 不得动 `wantPlay`。变异验证（删掉一处调用）能让它变红。
  - 顺带说明：报障日志里的 `QQ GetVkey 无 purl` 是 QQ 侧没给播放 URL（VIP
    锁），应用降标准重试是既有行为——只是降下去之后没真去加载，才表现为卡死。

- **交叉淡入淡出 crossfade**（`specs/audio-fx` C 组）——切歌时前后两首重叠渐变，
  时长 1–8s 可选、**默认关闭**。做法：

  - **A/B 双 `<audio>` 常驻**（`lib/audioSlots.ts`）。淡变的本质是"旧歌留在原元素
    继续播"，所以两个元素缺一不可。为了不让"当前播放元素"这层隐含假设散落
    在 20 处调用点里，槽位之上包了一层只读代理 —— `audioRef.current` 照旧写，
    但每次读都返回当前活跃元素，crossfade 开关对调用方完全透明。
  - **src 改成命令式装载**（`lib/crossfadeRunner.ts` 的 `load()`）。React 绑定
    `src` 会在切歌瞬间把新 URL 甩到同一个元素上、掐断正在淡出的歌；连带删掉
    App 里那个「track.audioUrl 变 → audio.load()」的 effect。
  - **每槽一条 Web Audio 链**：`source → EQ×10 → fadeGain → analyser →
destination`。`createMediaElementSource` 每元素只能调一次且不共享，所以两条
    链必须分开建；fadeGain 夹在 EQ 与 analyser 之间，淡出时声波环跟着暗。
  - **淡变一律 `setTargetAtTime`**：不用 `linearRampToValueAtTime`——后者被暂停
    或连切打断时会把增益**停在半路**，留下一条永远走不完的 ramp。

  测试 21 条 + 变异验证。过程中照出三个真洞：

  - 连按 ⏭ 的护栏判据写错（用"有没有淡变在跑"而不是"还有没有元素没闭嘴"）：
    连按第 2 次硬切时把标记清了，第 3 次又去 crossfade，新歌装进正在收声的
    旧槽 → ~120ms **双声叠加**，正是 spec 明令禁止的。
  - `!(sec > 0)` 挡不住 `Infinity`（脏 localStorage）→ 时间常数变 Infinity，
    淡变永远走不完。
  - Settings 里 `useVolume` 其实是死代码：`maestro:volume` 偏好从来没被推给
    任何元素（`audio.volume` 全仓零赋值），**音量滑块目前不出声**。不在本轮
    范围，已记进 `specs/audio-fx/tasks.md` 待单独一轮。

  ⚠️ **本轮没有真机验证过听感** —— 21 条测试都是假元素 + 假 gain，钉的是"调了
  哪些 API、顺序对不对"，不是"好不好听"。

- **跨平台 ❤ 累加（cross-platform-likes）补齐欠账**——功能早已上线但**一条测试都没有**，
  且 spec 的两条验收其实没实现。本轮三件事：

  1. **likeCount 缓存（真缺）**：此前每次搜索都重打 QQ `SongFavRead` / 网易云
     `song/detail` 公开接口。现在挂在 `music.service.likeCountCache`——
     key = `sessionId|platform|trackId`，命中/干净缺席 1h、失败 30s、FIFO 上限 512。
     放 service 而非 provider：key 含 sessionId，而 provider 是跨 session 单例，
     放 provider 会让 A 用户命中 B 用户的缓存条目。
  2. **HUD 上标位置修正（渲染偏离 spec）**：此前渲染成 `5700w+ + 2,500¹²`——
     两个上标粘在末尾，等于失去指代对象；spec 要的是 `5700w+¹ + 2,500²`。
     `crossPlatformLikeTotal` 加 `parts` 字段（逐项切分，顺序 = sources 序），
     HUD 按 parts 逐项渲染，老数据无 `parts` 时兜回单块 display。
  3. **33 条测试**：provider 字段映射与错误路径（QQ `m_numbers`/`m_show`、
     网易云 `likedCount`）、service 填充口径 + 缓存三档 + 跨 session 不串号、
     前端 HUD 四条验收 + 回落链。
  - 测试做过**变异验证**：短路缓存读 → 2 条红；cacheKey 去掉 sessionId → 1 条红；
    HUD 改回"上标粘末尾" → 2 条红。跑绿不算数，变异能红才算有牙齿。
  - `patchLibraryWithSources` 补上填充；`importLiked` **刻意不填**——一次几百首
    会把公开接口打爆，而库弹窗走 `getLibrary`（已填 + 缓存兜底），效果等价。

- **三语 README 语言纯度 CI 门禁**（`scripts/check-readme-i18n.mjs`，接进
  `npm run test:i18n` 与 `npm run test:ci`）—— README.md 出现未豁免汉字 /
  README.zh-CN.md 出现假名 / README.ja.md 出现简体词即非零退出。三份 README 靠
  人工同步必然漂移：2026-10-16 实测 README.md 混入 43 行中文（目录树注释 +
  整个 Roadmap），而中文版一直是干净的 —— 没被发现正是因为没有任何检查会失败。

  - **豁免刻意收窄**：一行必须能**逐个汉字片段**对上白名单（语言名 / UI 按钮
    字面值 / 指向中文 spec 的原文标题），而不是整行放行；另支持行尾
    `<!-- i18n-allow -->` 逐行豁免。围栏代码块内不检查（代码注释里的中文是
    有意义的技术信息）。
  - **日文判据用「词」不用「字」**：实现时踩过一次坑 —— 用简体**单字**集合做
    规则，结果把日语合法的 音楽/出力/状態/保存/日本語… 误报成 43 处。误报率高
    的规则等于没有规则。可靠判据是「日语对同一概念用不同汉字」：音楽≠音乐、
    状態≠状态、設定≠設定，而 保存=保存（日语同形）不能禁。
  - **脚本自带 9 例注入式自测**（`--self-test`）：往内存里的 README 注入违规
    内容断言能抓到，并断言「合法同形字 / 白名单项 / 代码块 / 豁免标记」不误报。
    「通过」的检查脚本可能只是因为规则写错而永远通过，自测是必需品。
  - `--gate` 非零退出、`--json` 机器可读。

- **远端歌单读取**（`specs/remote-playlist/`）——从平台歌单链接导入队列，按需实时读、
  **不落盘、不做跨平台合并**（镜像而非导入：远端歌单是用户排好的有序列表，走
  `mergeLibrary` 的集合语义会把顺序打散、重复项折叠）。三个 provider 能力实测解锁：

  | 平台   | 能力                 | 依据                                                    |
  | ------ | -------------------- | ------------------------------------------------------- |
  | 网易云 | 列目录 + 读歌单      | 复用既有 `fetchLiked` 三步链路，只放开 id               |
  | QQ     | 仅读（给定 disstid） | `music.srfDissInfo.DissInfo/CgiGetDiss`，227 首实测全量 |
  | Deezer | 仅公开歌单           | 匿名可用，490 首实测去重一致；用户歌单需 OAuth，不做    |

  实测排掉的坑（全部写进 spec 与代码注释）：
  - **QQ `disstid` 必须传数字**，传字符串回 `code=10004` 且错误信息不提示类型
  - **QQ「列我的歌单」实测封死**：8 个候选 `module.method` 全 `500003/860100001`，
    对照实验（同时刻同 cookie 打已知可用路径 `code=0`）排除风控误判 → 只实现读
  - **Deezer 对不存在的歌单回 HTTP 200** + body `error.code=800`，不是 404
  - Spotify / Deezer 的「列目录」不可用 → 契约拆成
    `PlaylistListerProvider` / `PlaylistReaderProvider` 两个**各自独立可选**的
    interface，允许只实现一半（否则 QQ 会被整判为「不支持」）

  新增端点 `GET /music/playlists?provider=`、`GET /music/playlists/:provider/:id/tracks`，
  后者同时返回 **1:1 保序、不合并**的 `items: UnifiedSearchItem[]`
  （`playlistTracksToUnifiedItems`）供队列播放器直接消费 —— 刻意不用
  `buildUnifiedItems`，它按歌名折叠同名条目会让 227 首变 225 首，测试钉死这一点。

- **renderer 三个「必经之路」低覆盖洞补齐**（2026-10-21，`f4125f6`）

  不是"覆盖率偏低"的问题，是**门禁在骗自己** —— 详见 `specs/stability/tasks.md` H8。

  - **`api.ts` 49.6% → 真身从未被执行**：renderer 每一份测试都用
    `vi.mock('../api')` 把 api.ts 整个换掉，于是 `fetchWithToken`（token 注入 /
    `credentials: include`）、`json()`（错误体 → `AuthError` + code 映射）、
    以及 70 个 API 函数各自的 URL/method/body 拼装**一行都没跑过**。
    后果很具体：URL 少个 `/music` 前缀 → 服务端回 SPA 的 index.html →
    renderer 报 `Unexpected token '<'`；401 没映射成 `AUTH_EXPIRED` → 登录过期
    弹成"未知错误"。**这三类 bug 现有测试一个都抓不到。**
    补两份互补的：`api.real.test.tsx`（不 mock 真身，只 stub `globalThis.fetch`，
    测错误路径）+ `api.contract.test.tsx`（**表驱动**测请求契约 —— 每个 API
    函数一行，新增函数时补一行表格 = 补一条契约，覆盖不漏）。
  - **`usePlayer.ts` 39.2% → 补分支决策**：新增 `usePlayer.behavior.test.tsx`
    （27 例）覆盖跨平台降级链、失败分级（`paid-track`/`vip-locked`/`no-match`/
    `entitlement-expired` 各自的判定来源）、30s 试听升级、队列增删、音质/平台切换、
    WPS 接管、封面占位。⚠️ 兜底链有**故意的**墙钟成本（同源重试 800ms +
    卡死探测 1500ms）→ 用假定时器手动推进，**23.4s → 392ms** 且与负载无关。
  - **`lyricsShare.ts` 41.5% → 补 canvas 渲染路径**：唯一未覆盖段是
    `downloadLyricsImage`（72-171）。happy-dom 的 `getContext('2d')` 返回 **null**、
    `createImageBitmap` 不存在 → 全部打桩，断言**渲染意图**（画了哪几行、用什么
    字体、封面走不走 `/music/cover-proxy`、下载文件名对不对）而非像素。
  - ⚠️ **顺带修正 1 条我自己写错的断言**：`playSearch` 指向不可播条目时，
    生产代码是**明确报错**「没有可播放的音源」而不是静默回退到别的歌 ——
    静默换歌比报错更糟（用户点了 A 结果在放 B）。**生产行为是对的，断言改对。**
  - ⚠️ **`App.tsx` 仍 0%（741 行 composition layer）—— 故意不补**：它不产出业务
    逻辑，只把十几个 hook 的返回值接到组件 props 上；要测就得把整个 hook 层
    mock 掉（等于把要测的东西也 mock 掉），测出来的只是"React 没崩"。
    盯接线的正确位置是 H7 的 E2E 全链路（登录 → 搜索 → 播放 → 收藏）。
  - ⚠️ **顺带挖出并修掉一个更严重的缺陷（见下条）**。

- **覆盖率门禁读到的数字可能只是「其中一边」—— 两条转换管线的覆盖数据互相吞掉**
  （2026-10-21）

  补上面那批测试时撞出来的：新写的 `lyricsShare.canvas.test.tsx` 明明 9/9
  全过，覆盖率却纹丝不动。挖下去发现是一整类缺陷。

  **机制**：仓库里有两条互不兼容的 TS 转换管线会覆盖**同一个**源文件 ——
  `.test.mjs` 走 `node` + 自实现 ESM loader（node 自己的 type-stripping），
  `.test.tsx` 走 `vitest` + vite/esbuild。两份产物原本进**同一个** c8 temp
  目录，c8 出报告时按 URL 合并它们（`@bcoe/v8-coverage` 的 `mergeScriptCovs`）
  —— 而那个合并是按**字节偏移**匹配函数的。两份的偏移基于**不同的转换后源码**，
  对不上 → 同一份文件被拆成两组互不相认的函数条目 → 只有一组能对上 c8 手里的
  source map → **另一组的覆盖被整份丢弃**。

  | `renderer/src/lib/lyricsShare.ts`（171 行） | 行覆盖      |
  | ------------------------------------------- | ----------- |
  | 只跑 `.test.mjs`                            | 71/171      |
  | 只跑 `.test.tsx`                            | 167/171     |
  | **合并后（修复前）**                        | **67/171**  |
  | **正确值（并集）**                          | **171/171** |

  ⚠️ **哪一边胜出不可预测**（`api.ts` 是 vitest 赢、`lyricsShare.ts` 是 node 赢），
  而门禁阈值（≥60% 行覆盖）就建立在这组数字上 —— 门禁读到的可能是**任意一边**。
  这比"数字不准"严重：它让阈值判定不可信。影响面 = renderer **10 个源文件**
  同时被两条管线覆盖。

  **修法**：两条管线各写各的 temp 目录 → 各自出 lcov → 在 **lcov 文本层**取
  **并集**（lcov 是行级格式，不依赖字节偏移，两边天然可比；「这行有没有被执行」
  是布尔语义 → 并集 = `max(hits_a, hits_b)`）。新增 `scripts/merge-lcov.js`
  （合并器）与 `scripts/lcov-summary.js`（从合并后的 lcov 重算文本报告 ——
  `c8 report` 只能读 temp 目录，读不出合并结果）。

  顺带修掉两个由拆分引出的坑：
  - **新鲜度标记搬出 `coverage/`**（`$PWD/.coverage-collected-at`）—— 采集开头
    会 `rm -rf coverage/`，标记放里面会被自己删掉 → 复用永远失效；反过来
    标记活到采集结束才写 → 采集中途被 kill 时旧标记还在 → 误判"数据新鲜"
    → 拿半截数据当完整的用。所以**采集开始就删、结束才写**。
  - **两侧 report 的路径基准必须一致**（都用仓库根 + 绝对 `--src`），否则
    `SF:` 前缀不同 → 合并时变成两个不同的文件 → 并集失效。

  **实测效果**（同一份代码，全量采集）：

  | 指标                              | 修复前 | 修复后     |
  | --------------------------------- | ------ | ---------- |
  | **总行覆盖**                      | 84.96% | **89.86%** |
  | `renderer/src/lib/lyricsShare.ts` | 39.2%  | **100%**   |
  | `renderer/src/api.ts`             | 80.8%  | **98.1%**  |
  | `renderer/src/hooks/usePlayer.ts` | 47.4%  | **87.8%**  |
  | `renderer/src/lib/storage.ts`     | —      | **95.3%**  |

  条目数 141 保持不变（`--all` 语义未丢）、门禁绿、无失败文件。
  ⚠️ 那 4.9pp 的差**不是新测试的功劳**，主要是**原本被吞掉的覆盖被找回来了**
  —— 之前的数字是**系统性偏低**的。

  ⚠️ **2026-10-24 补注（别被这张表误导）**：表里 `api.ts 98.1%` / `usePlayer.ts
87.8%` 是**当时那个合并口径**下的值。那个口径后来被判定为**不可信**——它把
  node 侧（`.test.mjs`）的真覆盖**整份替换**掉了（实测 24 个文件、568 条行命中
  被丢），且当时还认为 node 侧行号是错位的。H16 修正后（行级并集 + 分母只算
  真实代码行）这些数字**重新可信**，但值也变了：`api.ts` 真值 **99.4%**、
  `usePlayer.ts` **97.2%**、`lyricsShare.ts` **100%**、`storage.ts` **95.6%**
  （2026-10-24 master 采集实测）。详见 `### Tests` 段的 H16 条目。

- **播放链路枢纽 `proxyAudio` 零覆盖 —— 每首歌必经，却一行没测**（2026-10-21）

  `music.controller.ts` 的 `proxyAudio`（899-1001）是**所有平台音频流的必经之路**：

      renderer <audio src="/music/stream/qq/xxx">
        → GET /music/stream/:provider/:trackId
          → musicService.getStreamUrl() 拿上游 URL
            → proxyAudio() 转发到上游 CDN

  它此前 **899-1001 连续 102 行零覆盖**。而且不是"忘了测"，是**测错了对象**：
  - `music.controller.allowlist.test.ts` 只测白名单**纯函数** —— 测的是判据，
    不是调用方
  - `music.controller.stream.test.ts` 把 `proxyAudio` 的模式**复制到测试里**跑
    （文件头自己写着 "Simulates the post-fix `proxyAudio` pattern"）——
    **测的是副本，不是真身**。真身改了，副本照样绿。

  这块坏了会怎样：Range 头不转发 → seek 失效；206 不透传 → 拖进度条崩；
  CORS 头缺失 → **整个声波环失效**（analyser 读不到样本）；上游 502 无诊断日志
  → 只看到 code=4，排查卡两小时；非音频 content-type 无告警 → 运营商拦截页
  伪装成音频、静默播不出来；stream error listener 缺失 → CDN reset →
  **Node 整个进程死**。它同时是 **SSRF 边界**（防把 controller 当开放代理）。

  **新增** `packages/server/src/music/music.controller.proxy-audio.test.ts`（32 条），
  **打真身**：上游用本地 http server（真 socket）→ `fetch` 走真实 undici 响应体
  路径；响应侧用**真 `http.ServerResponse`** + 假 socket，只覆写 `write`/`end`
  捕获字节。顺带补上 `coverProxy`（同一个模式，e2e 只测到 400/403，流式成功
  路径和 502 全裸）。

  **17 个变异点全部被抓到**（证明不是假测试）：删 CORS 头 / 不转发 Range /
  206 改 200 / 502 改 500 / 关掉 SSRF 检查 / 删 close handler / 改 error
  listener 名（→ 进程非零退出）/ 删 coverProxy CORS / 删缓存头 / 502 改 500 /
  四个平台的 Referer 各改错一次 / 非法 `q=` 不降级 / `mm=` 被丢掉 / 401 被压成 502。

  另补**端点层**（32 → 43 条）：走完整 HTTP 路由（`getRequestHandlerFromNestApp`
  拿 Nest 的 express handler），覆盖 provider 分支的 Referer、`q=` 音质解析、
  `mm=` 透传、401 端点层透传。

  ⚠️ 加了 **CI 的 EPERM skip 保护**：这些测试必须真 socket（要模拟上游 CDN
  reset / 客户端断连 / Range 206），绑不上本地端口就没法跑。仓库里
  `music.controller.stream.test.ts` 在 CI 上就踩过这个坑（EPERM → 靠 hardExit
  兜底 exit 1 + 零输出，把 test.sh 整段掐断）。现在 listen 失败 → 显式 skip
  - 干净退出 0 —— 不 skip 的话 CI 上这个文件一失败，server 段就红了，而它红了
    不代表代码有问题，只代表环境没权限。

  实测：`music.controller.ts` 从 **77.33%（979/1266）→ 87.84%（1112/1266）**，
  899-1001 段从 **0 行 → 97 行覆盖**；生产代码**零改动**（只新增测试文件）。

- **test(e2e): 跨包全链路 E2E —— 搜索 → 播放 → 收藏 → 角标 → 刷新后仍在**
  （H7 第 7 层，2026-10-22）

  九层评估里**唯一还空着的一层**。之前仓库里有三种测试，但**没有一种能跨过包**：

  | 已有手段                  | 覆盖到哪                                  | 缺什么                                  |
  | ------------------------- | ----------------------------------------- | --------------------------------------- |
  | Playwright 视觉回归       | 只有 3 个视图，**API 在网络层被 stub 掉** | 验不了「链路通不通」                    |
  | server 的 `*.e2e.test.ts` | in-process HTTP 调内部 handler            | **没有 renderer 参与** → 验不了跨包契约 |
  | renderer 的 hook 测试     | 把 `../api` 整个 mock 掉                  | 验不了 server 返回的形状对不对          |

  新增：
  - `packages/server/src/e2e/fake-provider.ts` + `e2e-server.ts` —— 起**真 NestJS**
    （真路由 / 真控制器 / 真存储 / 真音频代理），只把**平台本身**换成假 provider。
    **零产品代码改动**：provider 是 Nest 单例 → 直接替换实例上的方法。
  - `tests/e2e/fullchain.spec.mjs` —— 浏览器里跑**真的出厂产物**（vite preview
    起 dist），对着真后端走完「搜索 → 播放 → 收藏 → 跨平台角标 → 刷新后仍在」
    - 「搜索无结果 → 明确空态」。
  - `playwright.e2e.config.mjs` + `.github/workflows/e2e.yml` —— 独立于视觉回归
    （那个只在渲染器路径变更时触发，**改后端不跑**）；E2E 在 server / renderer /
    electron / common 任一路径变更时都跑。

  断言全部钉在**跨包事实**上（「真的打到了 server 且返回 2xx」「收藏刷新后还在」）
  而不是组件细节。

  ⚠️ 实测踩到的五个坑（都写进了代码注释）：
  1. **会话 cookie 必须同站** —— 页面 `127.0.0.1:4173`、API `localhost:3200`
     是**跨站** → server 的 `SameSite=Lax` cookie **不发送** → 每个请求都是新
     session → 收藏写进用完即弃的 session → 「刷新后红心还在」永远失败，
     **看起来像产品 bug**。修法：注入 `window.electronAPI.apiBase`（生产环境
     本来就靠 preload 推它）指向同站地址。
  2. **`window.electronAPI` 替身必须完整** —— App 里
     `window.electronAPI?.reportPlayerMode(mode)` 的 `?.` 只保护「对象为 null」，
     **不保护「方法不存在」** → 少一个方法就是 TypeError → effect 抛错 →
     **整个页面空白**。
  3. **E2E 音频长度 = 假歌元数据长度** —— 短了会「播完自动切下一首」；短太多
     （>45s）会被 `isResidualAudio` 判成「30s 试听」触发降级链。
  4. **假 provider 的 `probeSession` 必须返回 `{alive:true}`** —— 少 `alive`
     → server 判「登录已过期」→ renderer 弹**登录错误面板**（`.aep-root`
     fixed inset 0 + z-index 200）→ 整个界面被盖住、点不动。
  5. **NestJS 的 `@Post` 默认返 201**（不是 200）—— 断言「2xx」而不是写死 200。

  顺带：**测试基建不进覆盖率分母** —— `src/test/`（vitest setup）与 `src/e2e/`
  （E2E 基建）都是**夹具**不是出厂代码，单测套件永远不 import 它们 → 必然 0%
  → 白拉低全局数字。c8 与 vitest 两边都加了 exclude（与「硬编码颜色门禁不扫
  测试文件」同一原则）。

- **fix(test): 覆盖率数据缺失时**不再出报告**、批处理 flaky 不再被吞**（2026-10-22）

  这两条是**「门禁在骗人」级别**的缺陷 —— 都是本轮跑全量采集时实测撞出来的。

  1. **组件测试批量失败 → 覆盖率数据整体消失，而 run 仍然绿**
     - 现象：`Tooltip.test.tsx` 在高负载下 flaky（批量里挂、单跑绿）→ test.sh
       退化成「逐个归因」→ **逐个跑不带插桩** → `coverage/.vitest` 根本没写 →
       报告里 renderer 的组件文件**全是 0%** → **全局覆盖率从 88% 塌到 65%**，
       而阈值 60% **照样过** → 一份在骗人的报告，run 还是绿的。
     - 修法（三条一起）：
       a. 逐个归因之后，**插桩模式下补跑一次带覆盖率的批量** → 数据能救回来；
       b. **批量失败但逐个都过 = flaky → 明确记进失败清单**（run 变红）——
       flaky 的危害正在于此，不该悄悄消失；
       c. 报告阶段**硬校验**：renderer 那一半覆盖率数据缺失 → **报错退出、
       不出报告**（而不是拿半截数据算一个偏低的数）。
       报错走 stderr —— `REPORT=$(c8_report)` 会把 stdout 吞进变量，
       消息印在变量里用户根本看不见（实测踩到）。
  2. **`Tooltip.test.tsx` 的 flaky 本身**：Radix 的关闭链路是「trigger 的**原生**
     pointerleave → setState(grace area) → React effect 挂上 document 的
     pointermove 监听 → 监听里判出界 → onClose」。**挂监听是后续任务** → 机器
     负载高时它比测试里那行 `fireEvent.pointerMove` 更晚 → 没人接 → 提示永远
     不关 → 1s 超时直接红（且只在 CI 高负载时红）。
     修法：把 `pointerMove` 放进 `waitFor` 里**重试** → 断言语义不变（「最终会关」），
     但与负载无关。

- **test(renderer): `usePlayer.ts` 第二轮补测 —— 未覆盖行 120 → 66，语句覆盖
  94.58% → 97.36%**（2026-10-22）

  第一轮补完主路径后剩下的 120 行逐段看过：大部分是**纯 `console.warn` 诊断
  分支**（行为上没有可观测差异 → 不追），值得测的是**真竞态 / 真故障态**。补的：

  | 补的洞                               | 覆盖的未覆盖段            | 用户可见症状                  |
  | ------------------------------------ | ------------------------- | ----------------------------- |
  | **卡死探测**（重试后仍不出声）       | 320-322 / 1589-1614       | 界面卡在「等待播放」          |
  | **电台在途时切 provider**            | 1362-1363                 | 旧平台的歌装到新平台界面上    |
  | **❤ 的陈旧 ticket 守护**             | 2003 / 2036 / 2081 / 2101 | 旧 ❤ 结果覆盖新状态           |
  | **detect 的期望值守护**              | 1141-1142                 | 用户手动翻转被旧响应覆盖      |
  | **WPS 五条分支**                     | 1692-1735                 | 两路叠加出声 / WPS 失败无提示 |
  | **兜底结果过期 / 匹配抛错**          | 924-926 / 954-956         | 旧歌的源塞给新歌              |
  | 音频图构建失败 / context resume 失败 | 441-489                   | 无声无提示                    |
  | 越界 seek / 非试听复位 / 探不通      | 1474-1516 / 764-805       | 崩溃 / TRIAL 角标不消         |

  🐛 **顺带挖出并修掉一个死代码守护**：`loadNextTrack` 的 D4 守护（「await 期间
  用户切了平台 → 丢弃旧结果」）**从来没生效过** —— `provider` 是 useState 的
  **闭包快照**，`const startedProvider = provider` 来自**同一个闭包** →
  `provider !== startedProvider` **恒为 false**。
  实测症状：电台请求在途时用户切到网易云 → **QQ 的歌被装到网易云界面上**
  （流地址也指着旧平台）。
  修法：用 ref 读最新值（和 `qqQualityRef` / `wpsPlayedIdRef` 同一套做法）。

- **fix(coverage): 权威侧不再整文件替换 —— 函数级改成跨管线并集**（2026-10-23）

  权威侧（coverage-v8）的行号是准的，node 侧（`.test.mjs`）的行号会**平移**（node
  的类型剥离会删掉纯类型行 → 命中行整体偏移，实测 node 独有文件的命中行有
  **29.7% 落在注释/空行上**）→ 所以**行级**必须完全替换（取 max = 污染）。

  但**函数名是源码标识符**、不随转换器变 → **函数级可以跨侧取 max**：同一个源
  文件被两条管线覆盖时，「这个函数跑没跑过」的真相是**两条管线的并集**。

  **原来的整文件替换把这个真相丢了** —— 实测丢了 **22 个函数**
  （`backup-crypto` 的 5 个加解密函数、`spotify-wps` 的 4 个、降级链的
  `pickFallbackSource` / `pickUpgradeSource`、`api.isSourcePlayable`…），
  它们**确实被 `.test.mjs` 测过**，却因为权威侧（vitest 那条管线）没跑到而显示
  0 覆盖 → **diff 门禁会把「改了这些函数」误判成「新增的函数从没被执行过」→
  假红**。

  - 修法：权威文件只**替换行/分支**，**函数命中次数跨侧并集**。
  - ⚠️ 只从「**对该文件有真实覆盖**」的一侧并集：c8 的 `--all` 会给**从没被执行
    过**的文件也列一份 0 命中的函数清单，而那些名字是 c8 自己猜的（跟权威侧
    不一致）→ 混进来会**污染函数分母**（实测全局 % Funcs 从 88.6% 掉到 87.1%）。
  - 两条都加了自测钉住（并做了变异验证）。

  **实测**：全局函数覆盖 **88.60% → 90.41%**（43 个函数救回、0 个反而丢掉），
  行/分支覆盖不变（92.4% / 81.69%），门禁在真实数据上通过。

- **test(electron): 补上 main.ts 里 5 个「从未被执行」的接线回调**（2026-10-23）

  `main.ts` 把 5 个**本地闭包**传给 `DesktopLyricsController`
  （`loadTarget` / `clampToVisibleDisplay` / `log` / `fromOverlay` / `safeStr`）。
  它们只有在控制器**真的建起浮窗**、**真的收到浮窗消息**、**真的出错**时才会被调用
  —— 所以「注册了通道」不等于「接线被验证过」。之前这 5 个函数在 main.ts 里全是
  **0 覆盖**（`main.ts` 25 个函数里只有 5 个被执行到）。

  借 `main.behavior.test.ts` 已有的**假 electron** harness（`Module._load` 换成
  假的）驱动「托盘 → 桌面歌词 → 浮窗建起来 → 浮窗 IPC 只认自己」这条真实路径：

  | 用例 | 覆盖到的                | 可观测的后果                                                                             |
  | ---- | ----------------------- | ---------------------------------------------------------------------------------------- |
  | 20   | `loadTarget`            | 托盘勾选后浮窗真的建出来了（且**加载完之前不显示**，避免空框闪一下）                     |
  | 21   | `fromOverlay`           | **别的 renderer 不能锁死用户浮窗**（preload 是主窗口和浮窗共用的桥）                     |
  | 22   | —                       | 浮窗 `did-finish-load` 之后才 `showInactive`                                             |
  | 23   | `clampToVisibleDisplay` | 历史坐标在**屏外**（拔了外接显示器）→ 丢弃 x/y、**保留尺寸**（用户拉过的宽度不是白拉的） |
  | 24   | `log`                   | 穿透设置出错 → **只告警不崩**（浮窗不丢）                                                |
  | 25   | `safeStr`               | widevine 探测失败 → **不阻塞启动**（非 Spotify 源照常用）                                |

- **test(e2e): 跨包 E2E 补上「跨平台降级链」—— 一个平台的流取不到就换另一个**
  （2026-10-23）

  之前跨包 E2E 只覆盖「搜索 → 播放 → 收藏 → 刷新后仍在」一条**顺利路径**。
  但产品最核心的卖点之一是**跨平台降级**（QQ 挂了自动换网易云/Deezer），而这条链
  **单测根本碰不到**：它要 server 的音频代理真的返 502 → renderer 的 onError →
  跨平台兜底 → 换源 → UI 跟着换。

  新增用例：假 provider 里第二首歌「QQ 源取不到流、网易云源是好的」→ 点它 →
  断言 `<audio>` 的 src 最终换成 `/music/stream/netease/…`，且**真的**先打过
  QQ 的流（先失败再换源，不是压根没试）。

  顺带修了假 provider 的两个**形状错误**（它们让这条链一开始根本跑不起来）：

  - `provider.search()` 必须返回 **Track[]**（`id`=平台曲目 id、`provider`=平台名），
    早先统一返回 FakeSong（`id`=merged id、平台字段叫 `platform`）→ server 的
    等价源搜索拿到 `provider: undefined, id: 'qq:e2e-2'` → 拼出的流地址是
    `/music/stream/undefined/qq%3Ae2e-2` → 前端 502，**看起来像「降级失败」**。
  - **每个平台必须返回自己那一份**：搜 netease 要返回网易云的源，否则「QQ 挂了 →
    自动换网易云」无从触发（等价源搜索是按平台发的）。

- **fix(electron): `peek()` 吃掉过期 OAuth 条目 → 登录界面永久转圈**（2026-10-23）

  **症状**：Spotify 登录「授权回来」之后，界面一直转圈，直到 10 分钟 TTL 超时。
  日志里只有 `hasPending=false, no pending`，看不出发生了什么。

  **根因**：`main.ts` 的 `'consume-oauth-callback'` handler 是「**先 peek() 打诊断
  日志，再 consume()**」，而 `OAuthCallbackBuffer.peek()` 在条目**过期**时做了
  `this.pending = null`：

  1. `peek()` 发现过期 → **把 pending 清掉**；
  2. `consume()` 看到 pending 为空 → **注册一个 waiter 永久等待**（TTL 10 分钟，
     且那个 timer 是 `unref` 的 → 进程都不被它拖住，纯粹干等）；
  3. ⇒ renderer 的 `consume()` **永远不返回**。

  **修法**：`peek()` 的语义是「看一眼，**不消费**」→ 过期时**只返回 null，不清
  pending**。清理交给 `consume()`（它自己也有 TTL 判断 → 过期时清掉并返回 null
  → 上层据此报错「授权已过期」，而不是干等）。

  这条是补测试时**用例挂住**才暴露的：一条断言「peek 过期条目后 consume 应立即
  返回 null」的用例**永远不返回**，而测试进程因为定时器 unref 直接静默退出
  （exit 0、后面几条用例根本没打印）—— **「测试提前结束」也是一种失败**。

- **test(electron): 补 electron 侧的守卫分支 —— 分支覆盖 72.9% → 更高**
  （2026-10-23）

  electron 是四个包里**分支覆盖最低**的（72.92%）。逐段看下来，缺口集中在
  **「状态不在预期」**的防御性路径 —— 它们的失败方式是静默的：浮窗不显示、
  设置改了不生效、一个订阅者抛错把其它订阅者一起带走。

  - `auth/login-window-runner.ts`（12 处分支）—— **登录窗口**（QQ / 网易云登录
    的主路径）：cookie 被**删除**（用户登出）时不能去捕获、cookie 没有 domain
    时不匹配、markerNames 过滤、已 resolve 之后再来事件要忽略、createWindow /
    cookies.on 抛异常要报成 LOGIN_FAILED、清理路径自己抛异常也不能带崩 promise。
  - `auth/oauth-buffer.ts`（3 处）—— OAuth 回调的 TTL 边界。
  - `desktop-lyrics/desktop-lyrics-controller.ts`（12 处）—— 浮窗：窗口没了之后
    的迟到事件、缺字段的 IPC 消息、订阅者抛错。
  - `dev-port.ts`（7 处）—— `RENDERER_PORT` 是**垃圾值**时不能采信（否则 electron
    main 会去连一个不存在的服务 → 窗口黑屏，日志里看不出「端口是脏的」）。

- **fix(e2e): E2E 改用专用端口 3210 —— 别再静默打到用户自己的 server**
  （2026-10-23）

  **症状**：用户开着 maestro app 时（Electron 把 server 作为 sidecar 起在
  **3200**），E2E 开始失败：搜索返回 **60 条真实 QQ 结果**而不是假 provider 的
  2 条 → 断言「2 MATCHES」红。

  **根因（三层，都得修）**：
  1. **端口撞车**：E2E server 用 3200 = app sidecar 的端口 → 起不来；
  2. **静默复用**：Playwright 的 `reuseExistingServer`（本地默认 true）→
     **复用了用户那个真 server** → 测的根本不是假 provider；
  3. **副作用**：E2E 的「收藏」步骤会把红心写进**用户真实的账号**。

  **修法**：
  - E2E server 改用**专用端口 3210**（`E2E_PORT` 可覆盖）；假 provider 的
    「上游音频」地址同步跟着改（否则拉的是用户真 server 的流 → 502）。
  - `playwright.e2e.config.mjs` 的两个 webServer 都改成
    **`reuseExistingServer: false`** —— 起不来就**明确失败**，绝不默默用别人的。
  - 浏览器覆盖采集器同样：端口 3210 + **起飞前检查端口是否空闲**（占用 → 退出码
    3 + 明确提示，不静默复用）。
  - `window.electronAPI` 替身抽成**共享模块**（`tests/e2e/electronStub.mjs`），
    E2E 与覆盖采集共用一份 —— 之前各写一份，其中一份漏了方法 → App 直接崩
    （`?.` 只保护对象为 null，不保护方法缺失）。

  **实测**：用户 app 的 server 照常跑在 3200 的情况下，E2E 2 条全绿 ✓，
  浏览器覆盖采集正常 ✓（App.tsx 66% / main.tsx 100%）。

- **feat(coverage): 浏览器端覆盖率接进统计 —— 接线层（App.tsx）不再「无法判定」**
  （2026-10-22）

  **问题**：`App.tsx`（741 行）是纯**接线层**（只 import hook、拼 props，不导出
  逻辑）→ 单元测试从没 render 过它 → 行覆盖恒为 **0%**。而它的行覆盖数据是
  **可信的**（coverage-v8 产出）→ diff 门禁会把「App.tsx 的任何新增行」判成
  「未覆盖」→ **误拦**（实测：往 App.tsx 中间插一行就被门禁红）。`main.tsx` 同理。

  **做法**：用 Playwright 的 `page.coverage.startJSCoverage()` 在**浏览器里**跑
  一次真实链路（真 E2E server + 真 renderer 源码），把 V8 原始覆盖经
  **source map 回映射**（`v8-to-istanbul`，c8 的同一个库）转成源文件行号 → lcov
  → 作为**权威侧**并进覆盖率管线。

  - 新增 `scripts/collect-browser-coverage.mjs`（编排：起 E2E server + vite dev
    server + 浏览器跑链路 + 存原始 V8 覆盖）与 `scripts/browser-coverage-to-lcov.mjs`
    （V8 → istanbul → lcov）
  - `scripts/test.sh`：报告阶段多一步采集；权威侧 = **vitest8 ∪ 浏览器**
    （**同一坐标系**（都是源文件行号）→ 取并集）
  - 跑在 **vite dev server** 而不是构建产物：dev 提供的每个模块是独立 URL
    （`/src/App.tsx`）且带 inline source map → 字节偏移能直接回映射。
    ⚠️「出厂产物能不能用」由 `tests/e2e/fullchain.spec.mjs`（跑 vite preview）
    负责 —— 两条腿分工：**那边验产物，这边量接线层**。
  - 环境不具备（没装 Chromium）→ **明确警告但不中断**，并说明后果
    （接线层无法被判定 → 改 App.tsx 会被误拦）。

  **实测**：`App.tsx` **0% → 66%**（489/741 行）、`main.tsx` **0% → 100%**；
  全局行覆盖 88.37% → **89.95%**。未覆盖的正好是 E2E 链路没走到的分支
  （如歌词导出）—— 数字是**真的**。

  顺带修了两个「门禁把自己的提交拦了」的问题：
  - **门禁排除测试基建**（`src/e2e/**`、`src/test/**`）：它们只被 E2E 跑，单测
    不 import → 「不在 lcov 里」→ 被判成「新增文件从未被任何测试 import」→
    **误拦**（实测：E2E 基建那个 commit 直接把门禁弄红了）。与「覆盖率分母
    排除测试基建」是同一个原则：夹具不是出厂代码。
  - **门禁给出「这个文件整体没有任何覆盖数据」的提示**：分清「这几行没测」和
    「这个文件从没被执行过」—— 后者多半是接线层，提示跑 `npm run coverage:browser`。

- **test(renderer): `usePlayer.ts` 补测 —— 未覆盖行 345 → 124，语句覆盖
  84.31% → 94.39%**（2026-10-22）

  装上 `@vitest/coverage-v8` 之后，`usePlayer.ts` 的行覆盖第一次是可信的 → 用真实
  lcov 拉出 **345 行未覆盖 / 59 个连续段**，按「**用户可见的功能**」而不是行数
  挑着补。新增 `renderer/src/hooks/usePlayer.core.test.tsx`（22 条）：

  | 补的洞                                                  |            行号（旧） | 用户可见症状                                                         |
  | ------------------------------------------------------- | --------------------: | -------------------------------------------------------------------- |
  | **❤ 角标轮询** `refreshLikedStateUntilStable`           |             1192-1238 | 跨平台 ❤ 数停在中间态（用户实测：「好不容易-方大同，角标不显示 2」） |
  | **radio 路径的 ❤ / 踩**                                 | 2004-2037 / 2081-2093 | 电台歌的红心/踩不生效、不上报信号                                    |
  | **AI 批次续播** `loadMore`                              |             1290-1316 | 歌单播到底了不续拉下一批                                             |
  | **QQ VIP 试听 → 降标准音质**                            |             1069-1089 | VIP 歌只放 30s 试听                                                  |
  | **无版权 → 自动换源 + 登录态探针**                      |             1607-1623 | QQ 真实掉线被静默吞掉                                                |
  | **同源 transient 重试分支**                             |             1558-1564 | 用户已切歌还在重试旧源                                               |
  | **play() 被拒 → 明确报错**                              |             1726-1730 | 界面卡在「等待播放」且无提示                                         |
  | EQ 预置/单频段/总开关、进度保位、WPS 播放路径、❤ 数回填 |                  多处 | —                                                                    |

  复测（`FORCE_COLLECT=1 bash scripts/test.sh --coverage`）：**141 个测试文件全绿**
  （vitest 50 文件 / 586 条），`CI_EXIT=0`；全局行覆盖 **87.83% → 88.37%**、
  分支 79.76% → 80.11%、函数 89.83% → 89.99%。剩下的 124 行主要是
  `console.warn` 诊断分支与竞态早退 —— 价值远低于本轮补的那批。

  🐛 **顺手修掉一个真 bug**：「获取下一批推荐失败：xxx」这条报错**用户永远看不到**
  —— `loadNextTrack` 的 catch 里 `setError(msg)`，紧接着的回落 `presentTrack` 又
  `setError(null)`（「切到下一首就清掉上一次的报错」是有意设计）→ React 18 批处理下
  净效果是 null。表现是：AI 批次拉取失败 → 歌单静默循环回第 1 首，用户毫不知情。
  修法：先记下错误、回落 presentTrack 之后再挂回去（**显式失败优于静默**，与
  「没有可播放的音源」那条报错同一原则）。

- **test(renderer): `useAuth.ts` 的 OAuth 兜底段补测 —— 函数覆盖 90.91% → 100%，
  顺带修 2 个真 bug**（2026-10-23）

  `useAuth.ts` 里「首次 `consumeOAuthCallback` 拿不到回调 → 注册 IPC listener +
  3s poll 兜底」这段，是 **stability-bug1-spotify-120s-timeout 的修复本体**
  —— 当初把「登录界面转圈 120s」改成现在这样靠的就是它。实测覆盖率：
  `poll` / `finishErr` **一次都没被执行过**（函数覆盖 20/22）。

  补 7 条用例（F8–F14，`useAuth.test.tsx`），全用假定时器驱动 3s tick，不依赖墙钟。

  🐛 **顺带挖出 2 个真 bug**（都在这 25 行里，症状都是「同一个事件两种结果」）：

  ① **用户拒绝授权 → 红色「登录失败」，而不是灰色「登录已取消」**
  buffer 路径（`pending.error`）抛 `makeAuthError('AUTH_CANCELLED', ...)`，而
  **IPC 路径和 poll 路径抛的是裸 `new Error(msg)`** → catch 里
  `err.code ?? 'AUTH_UNKNOWN'` → 落到 `AUTH_UNKNOWN`。同一个「用户点了拒绝」，
  取决于回调从哪条路进来，面板要么 `AUTH_CANCELLED`（「登录已取消」/ INFO）、
  要么 `AUTH_UNKNOWN`（「登录失败」/ **FATAL 红色**）——上报口径也跟着错。
  修法：`finishErr` 改抛 `makeAuthError('AUTH_CANCELLED', ...)`，三条路径统一。

  ② **拒绝一次 → renderer 里永久留一个 3s 轮询**
  清理（`for (const fn of cleanups) fn()`）写在 `await` **之后**，而拒绝路径直接
  抛出去 → **跳过清理** → IPC listener 没退订、3s `setInterval` 没清 → 登录早就
  失败了，renderer 里还在每 3 秒发一次 `consumeOAuthCallback` IPC。
  修法：清理挪进 `settle()`，成功 / 拒绝走同一条路。

  复测 `useAuth.ts`：语句 **90.43% → 94.80%**、函数 **90.91% → 100%（23/23）**、
  分支 **76.98% → 81.21%**、行 90.43% → 94.80%。

  ✅ **变异验证**（门禁得能主动抓出坏改动）：
  - 还原 ① → F9 / F10 / F13 三条立刻红
  - 还原 ② → F13 红（退订 spy 没被调用）
  - 删掉 `settle()` 的 double-settle 守卫 → F14 红（清理被做了两次）

  踩坑留档：`consumeOAuthCallback` 这个 mock **序号 0 不是登录流程的首次调用**
  —— 挂载时的一次性「排空 buffer」（K1）用的是同一个 mock，所以调用序是
  `#0 挂载排空 → #1 首次 race → #2 起才是 poll tick`。按「首次调用」排期会全部错位。

### Fixed

- **NL 检索的离线评测门禁 —— CI 里从来没跑过，而且自己有 3 个「静默按通过算」的洞**（2026-10-24）

  `CLAUDE.md` 写的是「**PR 门禁主体**」，但 `grep -rn "reco:eval" .github/workflows/`
  是**空的** → 那道门禁只靠本地 pre-commit hook（`--no-verify` / 换机器 /
  没装 hook 就直接绕过）。这条线是「质量类问题先建度量再改」的主线，
  门禁本身没接线 = 度量只存在于文档里。

  **三个洞（都是静默放行，实测）**：

  | 洞               | 旧行为                                                                                 | 实测能开多大                                                            |
  | ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | 缺基线           | 「⚠️ 没有基线文件 —— 跳过对比」→ 最后照样「✅ 通过」、exit 0                           | 把 jazz 的黄金标签全改成 pop（纯度 100%→0%）+ 缺基线 → **门禁照样通过** |
  | 黄金集覆盖不足   | 只打一条 ⚠️ 警告 → 最后照样「✅ 通过」（自己的注释写着"不当通过"，代码却是**当通过**） | 清空黄金集 → 12 个场景全部"结论不可信" → 门禁报通过                     |
  | 场景级判定没被用 | 只判「不变量 + 基线对比」，**完全没看** `s.pass`                                       | 纯度不达标但不变量还绿 → 照样通过                                       |

  ⇒ 三处现在都**非零退出**（`--save` 建基线那一轮仍放行 —— 那一轮本来就是在换基线）。

  **兜底路径（LLM 没给锚点）在端到端评测里完全没有判据**：

  12 个场景的种子全是 fixture 里录的 **LLM 艺人** ⇒ `GENRE_ARTIST_MAP` 这条
  「零 token、LLM 偷懒 / 超时 / 没给流派艺人时**唯一能用的**确定性兜底」
  一次都没走到。**实测**：把整张 jazz 映射表换成不存在的艺人，评测照样
  100% 通过、exit 0。

  ⇒ 新增 `eval-fallback.test.ts`：真 `buildIntentSeeds` + 真 `buildPool` +
  合成数据（假 provider **只认识黄金集里出现过的人**）+ **独立判据**
  （黄金集的人工标注，与映射表无关）。
  ⚠️ 假 provider 如果按映射表现造数据，这条判据就是循环的（实测那样写时
  测试照样全绿）—— 判据必须是**外部真源**。

  **修法**：

  1. **CI 新增 `nl-eval-gate` job**（与 `check` **并行**，0 元 / 0 网络 / ~3 秒）
     → `npm run build:common` + `npm run reco:eval:offline`
  2. `eval-offline-cli.ts`：缺基线 / 黄金集覆盖不足 / 场景级 `!s.pass`
     → 一律计入判定（`failed` 现在是**四道门**的并集）
  3. 新增 `eval-fallback.test.ts`（兜底路径 + 反向验证）
  4. 新增「种子占池比例」（`seedShare`）→ **参与基线对比**（判「意图模式有没有
     被稀释」：口味档案 / 平台 FM 混进池子时它会掉）；另加「种子产出率」
     （`seedHitRate`）**只报不判**（它被 fixture 覆盖度主导，判它会制造假红）
  5. `specs/eval-driven-nl/baseline.json` 重新入库（新增两个维度；
     **12 个场景的纯度数字一个没变** → 本次改动不改变检索行为）

  **验收**（实测）：

  | 检查                             | 结果                                               |
  | -------------------------------- | -------------------------------------------------- |
  | 门禁进 CI                        | `nl-eval-gate` job ✅（与 check 并行）             |
  | 缺基线 → 红                      | ✅（`eval-offline.test.ts` 断言从 0 **反转**成 1） |
  | 黄金集覆盖不足 → 红              | ✅（新增用例 6g-3）                                |
  | 场景纯度不达标 → 红              | ✅（新增用例 6g-2）                                |
  | 变异：jazz 映射 → 不存在的艺人   | ✅ 变红                                            |
  | 变异：jazz 映射 → 流派标错的艺人 | ✅ 变红                                            |
  | 还原后复检                       | ✅ 绿                                              |
  | 确定性                           | ✅ 两次跑逐行相同                                  |

- **产物里混进了测试代码 —— common / electron / server / common 的 src**（2026-10-24）

  收口覆盖率口径时顺带发现的**出货卫生**问题（实测）：

  - **`app.asar` 里有 11 个 `*.test.js`**（`main.behavior.test.js` /
    `preload.test.js` / `dev-port.test.js` …）—— electron 的 `build.files` 把
    dist 下**所有**文件都收进去（只排除了 map / d.ts）。
  - **产物里 `@maestro/common/dist/` 躺着 5 个测试文件**的 `.js`/`.d.ts`
    —— common 的 `build`/`prepare` 用的是**含测试文件**的 tsconfig，而
    `prepare` 会在打包时的隔离安装里跑 → **跟着出货**。
  - 外加一个**陈旧产物** `__gate_probe.test.js`（源文件已删，`tsc` 不清旧输出
    → 一直留在 dist 里）。

  **同一类问题在另外两个包里也漏了**（顺着「出货路径有四条」逐条查出来的）：

  - **`server/dist/test-helpers/` 里的测试夹具**在出厂产物里 ——
    `src/test-helpers/` **只被 `*.test.ts` 引用**，但构建 tsconfig 排除了
    `src/test/**` 却**漏了** `src/test-helpers/**`。
  - **`server/dist/reco/_tmp-dbg2.js`** —— 一个**从没提交过**的本地调试残留，
    源文件删了之后产物一直躺在 dist 里，
    ⚠️ **它已经跟着一个 dmg 出过货**（`Resources/server/reco/_tmp-dbg2.js`）。
    实测确认：`nest build` 跑完它**依然在** → 它**根本不清** dist。
  - **`@maestro/common/src/` 整个跟着出货**（含 5 个 `*.test.ts`）——
    common 的 `package.json` **没有 `files` 字段** → npm 打包时把整个目录
    都带上（`src` / `scripts` / `tsconfig*.json`）。

  **修法**：

  1. `packages/{common,electron}/tsconfig.build.json`（`extends` 现有配置 +
     `exclude: ["**/*.test.ts"]`）→ `build`/`dev` 显式用它；
     `tsconfig.json`（typecheck 用）**不**排除 → 测试文件仍被类型检查。
  2. `packages/{common,electron}/scripts/clean-dist.cjs` → **build 前清 dist**
     （治陈旧产物）；server 同样加一个（`nest build` 不清）。
  3. electron 的 `build.files` 再加一道保险 `!dist/**/*.test.js`。
  4. `packages/common` 的 `npm test` 原来只跑 5 个测试文件里的 **1 个**
     （另外 4 个在这个包里从来没跑过；仓库根的 `npm test` 跑全部 5 个 → CI 是绿的，
     **掩盖了包级脚本的过时**）→ 改成 `scripts/run-tests.cjs` **自动发现**全部
     `src/*.test.ts` 并**逐个进程**跑（每个测试文件自己 `process.exit(1)`，
     不能 import 到一起）。
  5. `packages/server/tsconfig.build.json` 补 `src/test-helpers/**`。
  6. `packages/common/package.json` 加 `"files": ["dist"]`
     → 出厂包里只带 dist（`exports.import` 仍指向 `./src/index.ts`
     —— 改它会让浏览器覆盖率的**文件归属**变掉；出厂包里没人用 ESM 条件
     解析它：sidecar 是 CJS、renderer 已预打包）。

  ⚠️ **clean 脚本放包内而不是仓库根**：`@maestro/common` 会被
  `npm install file:... --install-links` **复制**到
  `packages/electron/pack-server-deps/node_modules/` → 那个副本里
  `../../scripts/` **不存在** → 引用仓库根路径会直接崩。

  ⚠️ **踩到的坑：清 dist + 增量构建 = 空产物（静默无输出）**
  server 的 tsconfig 开了 `incremental` → tsc 把「编译到哪了」记在**包根目录**的
  `tsconfig.build.tsbuildinfo`（**不在 dist 里**）→ 清掉 dist 之后
  `nest build` 判定「全都编译过了」→ **一个文件都不产出**，
  **退出码 0，屏幕一行输出都没有**。
  ⇒ 清 dist 的同时**必须**清掉构建的增量状态。
  这是典型的**静默降级** —— 验收只能用**正向信号**（产物真的在），
  「没看到报错」会被当场骗过去。

  **验收**（实测）：`asar list | grep test` → **0**（原来 11）；产物里
  `@maestro/common` → **只有 dist + package.json**（`src` 不再跟出去）；
  `npm test -w @maestro/common` → **5/5 个测试文件全跑** ✅；
  `npm run pack` → dmg 145M ✅；`npm run pack:verify` → ✅
  （含「出厂包里没有测试代码」与「sidecar 能解析到 `@maestro/common/dist/index.js`」）

- **出货卫生**只靠人肉验收** —— 现在有门禁了**（2026-10-24）

  #21/#22 修完之后，「产物干净」这件事**只靠人肉验收**（本地打一次包、
  `asar list` 一下）。**一次性的验收会腐烂** —— 半年后没人记得 dist 要排除
  测试文件，一行 tsconfig 改动就能把测试代码重新送出去，
  而**没有任何门禁会红**。

  - 新增 `scripts/check-artifact-hygiene.cjs` → 判四个出货包的 dist：
    **测试代码**（文件名含 `.test.`/`.spec.`，或路径里有
    `test`/`e2e`/`test-helpers` 段）、**陈旧产物**（dist 里的文件在 src 里
    找不到对应源文件）、**源码**（dist 里出现 `.ts`）。
  - **CI 新增一个 job**（`artifact-hygiene`，与 `check` **并行**）→ 先跑自测、
    再构建全部出厂产物、最后 `--require-built` 判。
    ⚠️ `--require-built`：没构建过 = **失败**，不是跳过
    （「跳过」= 门禁形同虚设）。
  - `packages/electron/scripts/verify-pack.sh` 补 macOS 端到端那层
    （CI 打不了 dmg）：asar + sidecar 扫一遍。
    ⚠️ `node_modules` 只查 `@maestro/*` —— 第三方包自带 `test/` 目录是正常的
    （实测不排除会一次报出 120+ 个假阳性，门禁直接被噪音淹掉）。
  - 自测用夹具造出四类违规，断言检查器**都抓得到** —— 只断言「干净时通过」
    是不够的，那不证明它拦得住东西。

- **`npm run pack` 不重建 server / renderer → 打进去的是上一次的产物（静默发旧货）**（2026-10-24）

  打包真正带走的是 `Resources/server`（来自 `server/dist`）和 `Resources/renderer`
  （来自 `renderer/dist`）—— 两者都是 `extraResources`。而 `scripts/pack.cjs`
  在打包前**只** tsc 了 electron 自己的 `dist/main.js`，**那两个产物一次都没重建**。

  实测（修之前）：`packages/server/dist` 的最新文件比 `packages/server/src/**`
  的最新改动**旧一天** —— 也就是当天合入的所有 server 侧改动（错误隔离 / 原子写 /
  NL 检索 / 覆盖率合并器…）**一个都没进包**。「打包成功」是个假象。

  讽刺的是：同一个 PR 里我们给 **electron 版本**做了三方漂移检测
  （package.json 声明的 commit SHA ↔ lockfile ↔ 实际安装产物），理由原话是
  「那属于**静默发错货**」—— 但 server / renderer 的产物没做同样处理。

  修法（两处）：
  - `pack.cjs` 第 4 步从「只编译 electron」改成**构建全部四个产物**
    （common → server → renderer → electron，根 `npm run build` 已经是这个依赖
    顺序），并断言四个产物**真的在**（构建脚本被改名/删掉时不能静默打空包）。
  - `verify-pack.sh` 加一条**新鲜度断言**：包里的产物 mtime 必须不早于当前源码
    的最新 mtime（抓「打包前没重新构建」）。

  回归防护：`packages/electron/scripts/pack.cjs --self-test`（已挂进 `test:ci`）
  —— 它做**结构检查**（主流程是「跑 electron-builder」，自测跑不动它）：
  ① 「构建全部产物」这一步存在；② 它排在 electron-builder **之前**；
  ③ 必备产物清单里有 server 和 renderer 的产物。

  ⚠️ 写这个自测时踩了一个**自己踩自己**的坑：第一版直接 grep 源码里的
  `['run', 'build']` → 那个字符串**就在自测代码里** → 永远命中自己 →
  「删掉构建步骤」这个变异**自测照样绿**。修法：先把自测块自己剥掉再搜
  （`/* SELF-TEST-BEGIN */ … /* SELF-TEST-END */`）。
  三个变异点实测全部被抓：删构建步骤 / 构建排到 electron-builder 之后 /
  产物清单里去掉 renderer。

  实测（修之后）：`SKIP_VMP=1 npm run pack` → dmg 145M，包里的
  `Resources/server/music/music.service.js` **含**当天合入的新代码 ✓。

- **打包管线：`npm run pack` 端到端出 dmg —— 路上修了 4 个真 bug，其中 2 个是
  「把开发环境拆了」和「打出来的 app 启动即崩」**（2026-10-24）

  A2（`specs/packaging/tasks.md` #16）一直卡在「`npm run pack` 出不了 dmg」。
  原来的阻塞描述是「环境缺失的 7zip-bin 传递依赖，需先 `npm install` 恢复」——
  **这是误诊**：7zip-bin 一直都在（`builder-util` 的传递依赖，5.2.0，hoist 到
  仓库根）。真正的原因是下面第 ② 条 —— **是打包过程自己把它弄没的**。

  - ① **electron-builder 算不出 electron 版本** → 打包直接失败
    `⨯ Cannot compute electron version from installed node modules …`
    根因：`getElectronVersionFromInstalled()` 只读
    `<projectDir>/node_modules/electron/package.json`，而 **npm workspaces 把
    electron 提升到了仓库根** → 那个路径不存在 → 回退去读 package.json 的
    `devDependencies.electron`，那是 **castLabs 的 git URL**（不以数字开头）→ 抛错。
    （当年是靠「electron devDep 固定为 31.7.7」绕过去的，换成 castLabs git URL 后失效。）
    修法：新增 `packages/electron/scripts/pack.cjs` 作为打包入口，把**实际装好的**
    版本注入（`--config.electronVersion=`）—— 版本号**只从安装产物读**（唯一真源），
    换 castLabs commit 不用改代码；顺带做**三方漂移检测**（package.json 的 git SHA
    ↔ lockfile 的 resolved SHA ↔ 实际安装的 version），任一对不上就**直接失败**，
    不打「版本和依赖声明不一致」的包。

  - ② **跑一次 `npm run pack`，仓库的 devDependencies 全被剪掉**（含 electron 本身）
    根因：electron-builder 默认跑 `npm install --production`（cwd = appDir，
    `app-builder-lib/out/util/yarn.js`）。在 **npm workspace** 里 `--production` 是
    **整棵树**剪 devDeps → 紧接着造 dmg 时 7za 已经不存在
    （`ENOENT: chmod '.../7zip-bin/mac/arm64/7za' failed`）→ 打包失败；而且
    **之后的 `npm test` 全挂**（开发环境被拆了）。
    修法：build 配置加 `"npmRebuild": false`（本项目 electron 包**零运行时依赖**——
    `electron-is-dev` 声明了但从未被 import，已删；`main.ts` 直接用
    `!app.isPackaged`）→ 根本不需要那次 production install；
    并加**前后守卫**：组装依赖后 / 打包后各查一次 `electron / 7zip-bin / vitest /
typescript` 还在不在，被剪就**立刻失败**并说清怎么恢复。

  - ③ **`npm install` 产不出 electron 二进制**
    castLabs 版 electron 的 `package.json` **没有 `scripts` 字段** → npm 不执行任何
    install 生命周期脚本 → `node_modules/electron/dist/` 永远不会被下载 →
    `npm run dev`（electron）和 `npm run pack` 都报「electron 没装好」。
    修法：`scripts/ensure-electron-dist.cjs` 调 electron 包**自带的** `install.js`
    （自带 `isInstalled()` 判定 → 幂等），挂在 `predev` / `prepack` 上 → **要才付钱**
    （不挂根 `postinstall`，免得每次 CI 都白下载 100MB）。

  - ④ **dmg 打出来了，但 app 启动即崩**（最阴的一个）
    NestJS server 是通过 `extraResources` 放在 `Resources/server/` 的（**不在 asar 里**），
    而它的 154 个运行时依赖（@nestjs/core / reflect-metadata / kuromoji /
    opencc-js …）**没被打进去** →
    `ELECTRON_RUN_AS_NODE=1 Maestro -e "require.resolve('@nestjs/core')"` →
    `MODULE_NOT_FOUND` → sidecar 一 require 就挂。
    修法：`scripts/server-runtime-deps.cjs` 在 `pack-server-deps/` 里做一次**隔离的
    production install**（`@maestro/common` 用 `file:` + `--install-links` → **拷贝**
    而不是软链），再作为 `extraResources` 打进 `Resources/server/node_modules`
    （正好是 sidecar 的 require 解析路径）；用指纹缓存，依赖变了才重装。

  **验收（真的跑起来了，不是看配置）**：

  ```
  $ SKIP_VMP=1 npm run pack
  [pack] electron 版本：43.2.0+wvcus
  [pack] server 运行时依赖就绪：149 个包
  • building target=DMG arch=arm64 file=release/Maestro-1.0.0-arm64.dmg   (116MB)

  $ ELECTRON_RUN_AS_NODE=1 PORT=3999 …/Maestro …/Resources/server/main.js
  [Nest] Nest application successfully started
  [Bootstrap] Server running on http://localhost:3999 (X-Maestro-Token guard armed)
  $ curl -H "X-Maestro-Token: …" http://127.0.0.1:3999/storage/info
  {"backupDir":"…","backupCount":0}
  ```

  新增 `npm run pack:verify`（`scripts/verify-pack.sh`）：看产物结构 + **实测
  sidecar 的依赖能不能解析**（真的 `require.resolve`，不是看配置）。

  ⛔ 仍未做（有外部条件）：VMP 签名 + codesign + notarize。实测本机
  `security find-identity -v -p codesigning` → **0 valid identities**，
  且 `~/.castlabs-evs/` 凭据目录不存在（**EVS 账号从没注册过**）——
  这两步都得本人来，详见 `specs/stability/tasks.md` A1。

- **notarize 缺一个配置前置 —— 走「Apple ID + 专用密码」路线会直接 TypeError 崩**（2026-10-24）

  A1（`specs/spotify/tasks.md` #41–#45）剩下的全是外部动作（买 Apple Developer
  账号、注册 EVS 账号、拿专用密码），但**代码侧其实还差一个前置**：electron-builder
  的 `build.mac` 里**没有 `notarize` 字段**。

  实测 electron-builder 24.13.3 `macPackager.js:generateNotarizeOptions`，`mac.notarize`
  **完全没设**时走「Apple ID + 专用密码」路线，会在
  `const { appBundleId, ascProvider } = options` 处对 `undefined` 解构 →
  `TypeError: Cannot destructure property 'appBundleId' of 'options'` →
  **打包直接崩**（不是警告）。三种配置 × 三条凭据路线实测：

  | `mac.notarize` | 路线 B（Apple ID+专用密码） | 路线 A（钥匙串 profile） | 路线 C（ASC API key） |
  | -------------- | --------------------------- | ------------------------ | --------------------- |
  | 不设           | ❌ **TypeError 崩**         | ✅                       | ✅                    |
  | `true`         | ✅                          | ✅                       | ✅                    |
  | `{ teamId }`   | ✅（转 notarytool）         | ✅（带 teamId）          | ✅（带 teamId）       |

  修法：build 配置加 `"notarize": true`（凭据仍走环境变量，不进 package.json）。
  无凭据时只是 `log.warn('skipped macOS notarization')` → 不影响现有打包。

  **顺带留档两个「静默跳过」信号**（都实测过，避免「以为 notarize 了」）：
  - **没证书** → `doSign` 在 `identity == null` 处直接 `return false`
    （`macPackager.js:195`）→ **notarize 阶段压根没被调用**，日志里连 warn 都没有。
    2026-10-24 实跑 `SKIP_VMP=1 npm run pack`：`PACK_EXIT=0`、dmg 146MB、
    `pack:verify` 全绿，但**日志里一条 notarize 行都没有**。
  - **有证书但 3 组 env 一个都没设** → `getNotarizeOptions` 返回 `undefined` →
    `notarizeIfProvided` 只 warn 一句就继续出包。
    ⇒ **验收信号只有一个：日志里出现 `notarization successful`**，
    再加 `spctl -a -vvv -t install release/Maestro-1.0.0-arm64.dmg`
    显示 `accepted` + `source=Notarized Developer ID`。

  另两点（读源码 + 实跑确认，省掉后续摸索）：
  - `hardenedRuntime` 在 electron-builder 24 里**默认 true**，默认 entitlements 模板
    `app-builder-lib/templates/entitlements.mac.plist` 已带齐 notarize 必需的三条
    （`allow-jit` / `allow-unsigned-executable-memory` / `disable-library-validation`）
    → **不用自己写 entitlements 文件**。
  - 签名时序天然正确：`afterPack`（VMP，行 125）→ `doSign`（~260）→
    `notarizeIfProvided`（275）→ dmg —— VMP 签名在 codesign **之前**，
    `afterPack-vmp.cjs` 的设计不用改。

  同批把 Developer ID 证书申请入口、Apple 专用密码的获取路径、三条凭据路线
  写成可直接执行的 runbook，落 `specs/spotify/tasks.md` #41 / #45。

- **NL 歌单在空库下必然 400 `library_empty` —— 意图检索压根不依赖个人库，这道闸设错了位置**（2026-10-23）

  **现象**：从没导入过 ❤ 库的用户（或库跟着 session 漂移后读不到的用户）点 NL 歌单
  「生成队列」→ 意图解析**完全正确**（「我理解的意图」正常显示），但下一步必炸
  `library_empty：先 POST /music/library/import`。

  **根因**：`reco.run()` 顶部无条件要求库非空，且这道检查跑在 intent 判定**之前**。
  但 intent 模式（`specs/nl-intent-retrieval/`）的候选池**只**来自意图种子
  （流派代表艺人 → 平台真实目录），口味档案与平台 FM 都不参与 —— 它们正是"要爵士给
  大流行"的污染源。库在 NL 路径只有两处用途：① `dedupAgainstLibrary`（空库 = 不去重，
  无害）② `appendTasteFallback`（空库 = 兜不出东西，但那是 spec §风险设计的降级 →
  回退自由生成，不是错误）。`specs/nl-playlist/spec.md` §风险也早写了"首次 import
  用户库时 prompt 没库上下文 → 退化为'通用'推荐，**不报错**"。

  **修法**：库的前置检查只对**没传 intent** 的普通推荐路径生效。判据是"**有没有传
  intent**"而不是"意图里有没有风格指令" —— 用后者会让"来点好听的"这种空流派意图又
  撞回同一个错。普通「✨推荐」路径行为一字未变（仍 400；前端 `useReco` 的
  「库空 → 自动 import」兜底照旧生效）。

  **证据**：真实服务端到端验证（新 session + 空库 +「来点儿蒸汽波」）→ **HTTP 201**，
  `mode=select`，候选池 58 首，产出 12 首**全是蒸汽波**（Macintosh Plus / Vektroid /
  Blank Banshee / Saint Pepsi / Windows96 / Daft Punk），逐首带真实音源（QQ / Deezer）。
  修复前此处必 400。

  **回归**：`reco.test.ts` 新增 3 例（空库+intent 放行 / 空库+无 intent 仍拒 /
  空库+intent 无风格指令放行），47 → 50。

  **顺带定位到用户侧根因**：用户的 ❤ 库**并没有丢** —— 它挂在旧 session 下；应用
  启动时 cookie 没被带上，服务端新建了 session 并用 `Set-Cookie` 覆盖，于是当前会话
  读不到那个库（`librarySize: 0`）。用当前 `SESSION_SECRET` 重签旧 session id 可验证
  服务端仍认得它、`librarySize: 1174`。库已通过应用自己的 import 路径恢复（1566 首：
  网易云 437 / QQ 1265 / Spotify 1000）。

- **搜索路径上的两个 POST 端点没有错误隔离 —— 一次内部抖动就变成 500**（2026-10-23）

  用户报「搜索歌曲时偶尔出现 POST 500」。查下来**不是**搜索路径坏了（大修期间
  `music.controller.ts` 的 search 端点、`music.service.ts` 的搜索方法、
  `search.util.ts` 合计只动了 5 行，搜索/红心/provider 的测试全绿），
  而是这两个端点**没有错误隔离**：

  - `POST /music/like/detect` → `detectLikedAndSync`：内部任何一次偶发异常
    （存储写、锁竞争、provider 抖动、状态形状不兼容）冒到 controller 就 500。
  - `POST /music/track/likeCount` → 直接调 provider，**连 try/catch 都没有**
    （provider 内部的 try 只盖住 fetch 本身）。

  500 的代价不是「报错」这么轻：前端把这次 detect 当成「探测失败」→ ❤ 角标
  一直不亮，而且**看不出**是哪层坏了。

  修法（跟仓库既有的「`searchAlbumsOneProvider` 契约：本方法绝不 throw」同一套）：

  - `detectLikedAndSync` 加「**绝不 throw**」契约 → 内部异常时降级成
    `{liked:false, fannedOutTo:[], settled:false}`。
    `settled:false` 是前端**已有的**「中间态」语义（继续轮询、不把读数当稳定
    命中）→ **和今天 500 之后的行为完全一致**，只是不再把一次内部抖动放大成 500。
    ⚠️ 不能降级成 `settled:true` + `liked:false` —— 那会被前端当成「确认没红心」
    → **把真实红心抹掉**（比 500 严重）。
  - `POST /music/track/likeCount` 补 try/catch → 平台偶发失败降级成 `null`
    （renderer 已经处理 null = 不显示徽标）。

  回归测试 `packages/server/src/music/server-degrade.e2e.test.ts`（16 条），
  三个变异点全部被自测抓到：去掉 controller 的 try/catch → A1/A2 红；
  去掉 service 的包装 → B1/B2 红；storage 退回原地覆盖写 → C2/C3 红。

  ⚠️ **这个 PR 第一次跑 CI 时，diff 门禁把它拦下了** —— 而且拦得对：
  新加的错误处理分支里有 3 处**没被任何测试覆盖**（controller 里「平台不是
  qq/netease」那一支的 `return null`、storage 的「chmod 失败」与「清理失败」
  两条 best-effort 分支）。门禁报的 6 行是**新增行里没被执行过的行** ——
  这正是「新增代码必须被测到」这条规则第一次在真 PR 上生效。补了 A3/C4/C5
  三条用例后复测：6 行全部 hits>0。

  另外钉了一条**不变量**（D 组）：❤/踩/导入这几个端点现在**本来就安全**（远端
  写走同步队列；唯一一处内联的 provider 调用——netease fmTrash——已有 try/catch）
  —— 但那是「逐处碰巧安全」，没有东西钉住它。以后谁在请求路径上加一个内联
  provider 调用而忘了兜底 → 又是一次偶发 500。D 组把「provider 全炸时这几个
  端点仍必须 2xx」写成测试（变异测试实测：在 `fanOutLike` 的请求路径上加一个
  没兜底的 `await qq.fetchLikedMidSet(...)` → D 组立刻红 ✅）。

- **storage 的写不是原子的 → 进程在写一半被杀会留下半截文件 → 下次启动整个状态被清空**（2026-10-23）

  `writeLocked` 用的是 `fs.writeFileSync(this.file, …)` —— 那是「**先截断再写**」。
  进程在写的过程中被杀（dev 模式的 watch 重启、用户直接关 app、机器断电）→
  文件停在半截 → 下次启动 `JSON.parse` 失败（load 有兜底，不会崩）→
  **整个状态被清空**：红心、登录态、歌单「莫名消失」。

  修法：先写 `state.json.tmp` 再 `rename` 覆盖 —— 同一文件系统上 `rename` 是
  **原子**的 → 读到的永远要么是旧的完整内容、要么是新的完整内容。
  顺带：chmod 打在临时文件上（rename 保留 inode 权限位 → 最终文件仍是 0600）；
  写失败时清掉半截的 `.tmp`，不往磁盘上留垃圾。

  回归测试里那条「写失败 → 旧文件完好无损」**一开始是假绿的**：它把
  `fs.writeFileSync` 整个 stub 成抛异常 —— 而真实形态是「**先截断再失败**」。
  不模拟截断的话，连原地覆盖写都测不出区别（原地写也是「什么都没发生」）。
  改成「先截断再抛」后，退回原地覆盖写就会红。

- **覆盖率 diff 门禁的函数级判据：跨文件的同名函数互相掩盖 → 真没测的代码被放过**（2026-10-23）

  `fnCounts` 曾经是**跨文件累加**的全局 map（函数名 → 执行次数）。后果：

  ```
  文件 A 有个 get 被调用过 5 次
  文件 B 有个 get 从没被调用
  → 全局累加后 fnCounts['get'] = 5
  → 门禁判「B 的新 get 已被执行过」→ 漏报
  ```

  仓库里 `get` / `init` / `render` 这种名字到处都是 → 命中概率很高。lcov 的
  `FNDA` 本来就是**按文件记录**发的 → 按文件分层是数据本身支持的，不需要额外假设。

  修法：`fnCounts` 改成 `Map<文件, Map<函数名, 次数>>`，门禁按**所在文件**查。
  补了一条自测钉住跨文件隔离；变异测试：把查找改成「跨文件取 max」（= 回到旧
  行为）→ 自测变红 ✅。

  ⚠️ **同一个文件内**的同名函数仍分不开（lcov 格式的固有限制：`FNDA` 的连接键
  只有函数名，没有行号）。这条如实记录，不假装解决。

- **覆盖率报告的「All files」把可信与不可信的行覆盖混在一起 → 阈值门禁判的是假数字**（2026-10-23）

  报告早就分层标了（每行标 `~`、单列一行「行覆盖可信性」），但**汇总行 `All files`
  仍然是混合总数**，而 ≥60% 那条阈值门禁读的**正是这一行** → 底线守着一个掺了
  「行号错位」的假数字。

  修法：`All files` 改成**只统计可信部分**（目录行若混有不可信文件也标 `~`）。
  实测：可信 41881 行 91.84% / 不可信 983 行 9.87% → 底线从「混合的 90.38%」变成
  「能当真的 91.84%」。

  兜底：一份可信数据都没有时（清单缺失）**退回**未分层总数并明确警告 —— 那是
  「没有数据」，不是「没覆盖」，不能报 0%。

- **测试夹具与测试文件被编译进 server 的 dist → 跟着 electron 打包出货**（2026-10-23）

  `packages/server` 的 `nest build` 用的 `tsconfig.json` 没有 `include`/`exclude`
  → **src 下的一切都编译**，包括：

  - `src/e2e/**`（跨包 E2E 的 server + 假 provider —— 夹具，不是出厂代码）
  - **65 个 `*.test.ts`**（每个还带 `.d.ts` + `.map`）

  而 `packages/electron/package.json` 的 electron-builder 配置会把
  `../server/dist` **整个拷进应用包** → 出货的桌面端里带着 65 个测试文件和
  一套「假 provider」夹具。

  修法：新增 `packages/server/tsconfig.build.json`（`nest build` 优先用它），
  排除 `src/e2e/**` / `src/test/**` / `*.test.ts` / `*.spec.ts`。
  `tsconfig.json`（typecheck 用）**不**排除 → 夹具仍被类型检查
  （实测 `tsc --listFiles` 仍含 2 个 e2e 文件）。

  产物对比：`3.5M / 122 个 js / 65 个测试文件` → `1.5M / 55 个 js / 0 个测试文件`。

  ⚠️ 一次性坑：`incremental: true` 的旧 `tsconfig.build.tsbuildinfo` 会让改动
  **第一次构建看起来没生效** → 需要 `rm -rf dist *.tsbuildinfo`（CI 是干净环境，
  不受影响）。

- **浏览器覆盖采集在 CI 上卡满 6 小时被强杀（PR #114 首次 CI 暴露）**（2026-10-22）

  PR #114 的第一次 CI：`Test & TypeCheck & Lint` 这一步**跑了 6 小时**才被 GitHub
  取消（`##[error]The operation was canceled.`），不是失败，是**挂起**。

  **根因**（日志定位，非猜测）：

  1. `collect-browser-coverage.mjs` 用 `spawn('npx', ['vite', …])` 起 dev server。
     `npx` 是**包装进程**，真正的 vite 是**孙进程**（vite 还会再 fork 一个常驻的
     esbuild）。
  2. 清理时只 `proc.kill('SIGTERM')` → 死的是 npx，**孙进程活下来**。
  3. 孙进程继续持有 stdout/stderr 管道的**写端** → 父进程这边的 pipe 流**永远
     收不到 EOF** → 事件循环不空 → **node 永不退出**。
  4. `test.sh` 就卡在这一行 → CI job 烧满 6 小时。

  **为什么本地不复现**：macOS 上 `npx → vite` 的信号恰好把整棵树带走了；
  Linux runner 上 npx 是 node 脚本 spawn 子进程，SIGTERM 只到 npm 自己。
  **只有 CI 会炸** —— 本地跑 13 分钟全绿，CI 挂 6 小时。

  **证据**（CI 日志）：`[browser-cov]` 的 stdout 行出现 **0 次**，而 stderr 的
  `[web]` 行出现了 1 次 → 父进程**从未退出**（stdout 缓冲区从未刷新）；
  取消时的孤儿进程列表里 **`esbuild` 仍在存活**。

  **修法**（四层防御）：

  - `spawn(..., { detached: true })` → 子进程自成一个进程组
  - 清理改成 `process.kill(-pid, 'SIGKILL')` **杀整个进程组**（npx + node + vite +
    esbuild 一次带走），并 `destroy()` 管道 handle 让事件循环能排空
  - 两处 `execFileSync` 加 `timeout: 120_000` → 子进程不退出最多等 2 分钟
  - 脚本级**看门狗**（4 分钟）+ `test.yml` 的 `timeout-minutes: 45`
    → 任何未预料的挂起都不该再烧掉 6 小时和一份 runner 额度

  **回归测试**：`scripts/collect-browser-coverage.mjs --self-test` 造一个
  「包装进程 → 孙进程」的结构（和 npx→vite 同构），断言 `killGroup` 之后
  **孙进程也没了**。变异测试：把 `kill(-pid)` 改回 `proc.kill()` → 孙进程存活 →
  自测变红 ✅（已实测）。

- **覆盖率 diff 门禁的「可信文件清单」参数根本没实现 → 清单被完全忽略**（2026-10-22）

  `scripts/coverage-diff-gate.js` 里有完整的「三层判据」设计（函数级为主 /
  行级只对可信文件 / 文件级兜底）和对应的自测，但：

  - `--trust` 参数**没在 `parseArgs` 里实现** → `args.trust` 恒为 undefined
  - `readTrustedFiles(undefined)` → 返回 `null`
  - 门禁的守卫是 `if (trusted && !trusted.has(file)) continue;` → `null` 是 falsy
    → **守卫永不触发** → 行级判据对**所有**文件生效

  即：文档和 commit message 描述的「行级只对可信文件启用」**从来没生效过**。
  当时无害（renderer 已改用 `@vitest/coverage-v8`，行号恢复可信），但只要哪天
  换回缺 source map 的采集路径 → 门禁会拿**错位的行号**判 renderer → 随机判决。

  修法：`parseArgs` 补 `--trust`（默认 `coverage/.line-coverage-trusted.txt`）；
  清单**缺失**时门禁**明确失败（退出码 2）**而不是默认「都可信」——不知道谁可信
  时硬判 = 拿可能错位的行号当真值。补一条端到端用例钉住「缺失 → exit 2」。

- **renderer 的行级覆盖数据是错位的 —— 看起来「对齐」，其实随机**（2026-10-21）

  写门禁测试时用探针函数撞出来的：一个**从未被调用**的函数，它的函数体各行
  覆盖率 hits 却是 170；而同一函数里**必然执行**的 `setCurrentTime(0)` hits
  却是 0。

  **机制**：c8 要把 V8 的**字节偏移**映射回源码行，需要 **source map**（从 node
  的 `source-map-cache` 拿）。ts-node 跑的那部分有 → server/common/electron 的
  行号正确；**node 直跑 `.test.mjs` 和 vitest 跑 `.test.tsx` 的那部分没有** →
  renderer 的行号全是错的。而 esbuild 把 `usePlayer.ts` 从 2192 行压成 1336 行
  → c8 拿转换后 JS 的字节偏移去切源 .ts 文件 → 行号随机；但因为切的是完整源
  文件，**DA 条目数 = 源文件行数** → **看起来「对齐」，极具欺骗性**。

  ⇒ 之前报的 renderer 行覆盖数字（含 `api.ts` 98.1% / `usePlayer.ts` 87.8% /
  `lyricsShare.ts` 100%）**都不可信**。

  ⚠️ **2026-10-24 补注（H16 之后）**：上面「node 侧行号是错位的」这个前提**已被
  实测推翻**（node 的 type-stripping 按原位抹掉类型 → 行位置完整保留 → 行号是
  准的）→ 这些数字**重新可信**，但值也变了（`api.ts` 真值 99.4%、`usePlayer.ts`
  97.2%）。详见 `### Tests` 段的 H16 条目。

  **函数级覆盖是可信的** ✓ —— 函数名是源码标识符，不随转换器的字节布局变化。
  实测：从未被调用的探针函数，**FNDA 精确地是 0**。

  - 新增 `scripts/collect-line-coverage-trust.js`：扫两个 temp 目录的
    `source-map-cache` → 产出「行覆盖可信的源文件」清单。
    ⚠️ 这个脚本算错的后果是**静默降级**（清单恒空 → 门禁对所有文件都关掉
    行级判据，只剩函数级）—— 比报错更糟，所以给它加了 `--self-test` 并挂进
    `test:ci`。实测踩了两次：source-map-cache 的 key 有两种形态（`file:///abs`
    和**相对仓库根**的 `packages/...`）；相对路径**开头**就是 `packages/`，
    用 `includes('/packages/')` 检查会一个都匹配不到。
  - 覆盖率报告（`scripts/lcov-summary.js`）**标注**哪些文件的行覆盖不可信 ——
    不可信的那部分「% Lines」和「未覆盖行号」标 `~` / `(行号不可信)`，
    **数字必须诚实**
  - 覆盖率 diff 门禁改成**三层判据**：① **函数级（主）**新增代码所在函数
    FNDA=0 → 拦（全包可靠）② **行级**只对行覆盖**可信**的文件启用
    （renderer 跳过 → 宁可漏报不误报）③ **文件级**新增文件完全不在 lcov 里 → 拦

  ✅ **2026-10-22 彻底修复**：renderer 改用 **@vitest/coverage-v8**（`1.6.1`，
  与现有 vitest 精确匹配）—— 它走 **vite 自己的 transform 链** → 拿得到
  source map → **行号正确**。实测同一个探针：行 hits = **0** ✓、函数 hits = **0** ✓
  （c8 下是 170）。

  - **行覆盖可信的文件：115 → 215**（common 8 / electron 21 / **renderer 71** /
    server 115）→ renderer 的行覆盖**完全可信**
  - ⇒ **门禁盲区消除**：三层判据现在**全包生效**（修复前 renderer 只能靠函数级，
    抓不到「已有函数里新增的未走到分支」）
  - ⚠️ **三个配置坑**（都实测踩过，写在 `packages/renderer/vitest.config.ts` 里）：
    1. **coverage 配置必须放在 `test` 块内** —— vitest 1.6 的 `resolveConfig`
       只合并 `viteConfig.test`，顶层的不生效
    2. **`include` 必须相对 root**（`'src/**/*.{ts,tsx}'`）—— 绝对路径时 v8
       provider 一条都匹配不上（报告 0 个文件、All files 0%）
    3. **不能用 coverage-v8 自己的 `lcov.info`** —— 它的 `SF:` 是「相对 vitest
       root」的，和 git diff 对不上；istanbul JSON 的 key 是**绝对路径** →
       新增 `scripts/istanbul-to-lcov.js` 做转换
    4. **必须显式设 `root: __dirname`** —— vitest 默认拿 **cwd** 当 root；
       `scripts/test.sh` 从**仓库根**跑 → root 变仓库根 → `include` 相对 root
       一个都匹配不上。**在包目录里单跑是好的，换个 cwd 就废了** ——
       本地单跑验不出来，只有从仓库根跑才复现
  - **合并器加「权威输入」语义**（`--authoritative`）：同一个源文件被**两条转换
    管线**覆盖时（node 无 source map / coverage-v8 有），两份的「第 N 行」**不是
    同一行** → 取 max = **污染**（把随机值和真值混在一起），不是「更全的覆盖」。
    权威语义 = 权威来源覆盖的文件**完全替换**其它来源。
    ⚠️ **只有权威侧有「实质覆盖」（>0）时才替换** —— 有些文件**只被 `.test.mjs`
    覆盖**（node 侧有真实用例，只是行号错位），权威侧里它没有实质覆盖 →
    无条件替换会变成「0% 覆盖」，比实际更差。
  - **新可见性**：真实覆盖洞第一次看得见 —— `useCoverArt.ts` 真实 **0%**
    （所有测 usePlayer 的文件都 `vi.mock('./useCoverArt')`，它从未被执行；
    和 H8 的 api.ts 是**同一种病**）；`usePlayer.ts` 真实语句覆盖 **84.3%**
    （之前报的 87.8% 是错位数据的假象）

  ✅ **2026-10-22 补上 `useCoverArt.ts`**（新可见的第一个真洞，已修）：新增
  `renderer/src/hooks/useCoverArt.dom.test.tsx`（16 条）—— 把原
  `useCoverArt.test.mjs`（node 管线、行号错位、覆盖归不到位）的场景搬到 vitest
  管线（行号可信），并补上 `.mjs` 没测的 **`useCoverArt()` hook 本体**：
  `presentCover` / `presentPlaceholder` / **epoch 竞态**（在途取色必须让位给
  后到的封面）/ ref 为空时不崩。

  - 权威覆盖率：`useCoverArt.ts` **0% → 100% 行 / 100% 函数 / 95.45% 分支**
  - ⚠️ 踩到的环境坑（实测）：**happy-dom 的 CSS 解析器不吃 `linear-gradient()`**
    （整条被丢弃，读回来是 ''），且会把 `url(x)` 规范化成 `url("x")` → 断言必须
    绕开 CSSOM 的解析结果，改用「样式替身」直接比对**代码写进去的字符串**

  ✅ **2026-10-22 全量复测（`FORCE_COLLECT=1 bash scripts/test.sh --coverage`）**
  —— 141 个测试文件全绿（node 管线 82 个 + vitest 49 个 / 564 条），`CI_EXIT=0`：

  | 指标                   | 修复前（c8 错位数据） | 修复后（coverage-v8） |
  | ---------------------- | --------------------: | --------------------: |
  | 全局行覆盖             |                90.38% |            **87.83%** |
  | 全局分支覆盖           |                80.34% |            **79.76%** |
  | 全局函数覆盖           |                85.06% |            **89.83%** |
  | **行覆盖可信的行数**   |       24917（92.98%） |   **41848（89.74%）** |
  | **行覆盖不可信的行数** |       17951（86.78%） |     **1020（9.51%）** |
  - **全局行覆盖数字「降了」是好事** —— 之前的高水位里有一部分是**错位数据凑出来的**
    （把一个文件的两条管线的行号错位当成两条不同的行统计）。现在分母和分子都是
    真话：**89.74% 的行覆盖可信**，剩 1.02% 不可信（只剩 8 个只被 `.test.mjs`
    覆盖的文件：`index.ts` / `titleAlias.ts` / `setup.ts` / `main.ts` /
    `album-types.ts` / `types.ts` / `eval-cli.ts` / `eval-genre-cli.ts`）。
  - **diff 门禁在真实数据上通过**：`node scripts/coverage-diff-gate.js`
    `--base origin/master` → 15 个改动文件「全部被执行过」，退出码 0。
  - **8 个 CI 校验器全绿**：figma-code-connect / token-drift / hardcoded-colors /
    readme-i18n + 4 个脚本自测（merge-lcov / istanbul-to-lcov /
    coverage-diff-gate / collect-line-coverage-trust）。

  🐛 **顺手修掉一个我自己早前提交引入的门禁回归**：`scan-hardcoded-colors.mjs`
  会去扫**测试文件**，把测试里的**字面颜色夹具**（`rgb(10, 20, 30)`）当成产品
  硬编码 → `lyricsShare.canvas.test.tsx` 和 `useCoverArt.dom.test.tsx` 两个文件
  没有预算条目 → `npm run test:ci` 直接红。
  改成**测试文件不参与**这个门禁（`TEST_FILE` 规则）：这个门禁管的是「**出厂
  代码**里颜色只能来自令牌层」；测试文件不出厂，而且它**必须**断言字面量 ——
  断言 `var(--token)` 等于没断言。
  ⚠️ 不排除的话后果很难受：棘轮预算**只许降不许升**，而新测试文件不在预算里 →
  每加一个带颜色的测试文件门禁就红一次 → 大家会去调预算而不是修代码。
  实测排除 49 个文件，**16 个产品文件的命中数一个都没变** → 没有误伤。

  **顺带用函数级信号挖出了 `usePlayer.ts` 的真洞** —— 8 个函数从未被执行过，
  其中 5 个是**用户可见功能**：`onTimeUpdate`（进度条不动）、`onEnded`
  （播完不自动下一首）、`seek`（拖进度条/点歌词跳转不生效）、`handleDislike`
  （踩不了）、`changeDeezerPreset`（切不了 Deezer 精选）。新增
  `renderer/src/hooks/usePlayer.events.test.tsx`（9 条）全部补上，复测
  **函数级未执行数 8 → 0**。

  ⚠️ **代价（诚实说明）**：函数被调用过 ≠ 函数体每一行都被走到 → renderer 上的
  门禁**抓不到**「在已有函数里加了一个没走到的分支」。
  ✅ **这条代价已消除**（同日，装 `@vitest/coverage-v8` 之后）：renderer 的行覆盖
  现在**行号正确**（可信文件 115 → 215，renderer 71 个全可信）→ 三层判据在
  renderer 上**全部生效**。
  ⚠️ **另一个盲区**：lcov 的 `FNDA` **按函数名索引** → 同名函数的次数互相掩盖
  （`usePlayer.ts` 里 18 个 `get`）。对「**新增**的函数」这个判据无影响（新增
  函数的名字在 base 里不存在 → 0 就是真的没被调用），但判「已有同名函数」时不可靠。

- **覆盖率阈值门禁在 90% 的水位上等于不存在 —— 换成 diff 粒度**（2026-10-21）

  全局 ≥60% 的阈值在当前水位上**拦不住任何东西**：实测新增 100 / 500 / 1000
  行零覆盖代码，全局覆盖率分别掉到 89.65% / 88.82% / 87.81% —— **全部照样过**。
  要新增 **21324 行**零覆盖代码才跌破 60%。

  仓库自己的 workflow 注释早就写了这件事（「一个 PR 把某个文件从 80% 拉到 0%，
  全局仍然过」），但当时的结论是「挪到每日定时跑」—— 那只是**不看**了，不是
  **修好**了。

  **新判据：本次 PR 新增/修改的代码行必须被执行过。**
  拿 `git diff -U0 <base>...HEAD` 的新增行号 ∩ lcov 的 `DA:<line>,<hits>`，
  落在交集且 `hits=0` 的行 = 「这次改的代码，测试从没跑到」。注释 / 类型声明 /
  空行不在 DA 记录里 → 天然跳过；新增文件从没被任何测试 import → 全部可执行
  行都算未覆盖 → 拦。兜底判据：PR 触碰的文件整体覆盖率掉到 0% → 拦（抓
  「PR 删掉了该文件的测试」）。

  - **不需要 base 分支的覆盖率基线**：它问的是「你这次写的代码有没有被跑到」，
    不是「比上次差多少」→ 不用跑两遍套件、不用存基线快照。
  - **不额外花时间**：`test:ci` 本来就是插桩跑的 → lcov 已存在，「过没过」和
    「覆盖多少」来自同一次执行。
  - **三条数据完整性护栏**（宁可明确报错退出 2，不硬判）：lcov 路径基准不对 /
    lcov 不完整 / lcov 混了多轮采集。另外拿不到 base ref 时**明确失败**，
    不静默放过 —— 静默放过 = 门禁形同虚设。
  - **端到端验证**：改生产代码没写测试 → ❌ 拦下并精确报出行号；补了测试 → ✅
    通过；只加测试文件 → ✅ 通过。
  - **自测调真身**（`judgeAddedLines` 是共享函数）：最初自测里另写了一份实现，
    把主流程的判据改坏自测毫无反应（测的是副本）—— 和「proxyAudio 测副本」
    同款坑。修掉后 4 个变异点全部被自测抓到。
  - ⚠️ **两个「路径」相关的坑**（都会让门禁失效或误拦）：
    1. **pathspec 末尾少写一段 `**`** → 在 git 的 pathspec 里匹配不到任何文件
       （`*` 不跨 `/`）→ diff 恒为空 → **门禁永远通过** —— 最坏的失败模式：
       看起来在把关，其实没有。自测里直接验证 pathspec 能匹配到足够多的 src/
       文件（用 `git ls-files`，不依赖任何 commit 的 diff 内容）。
    2. **不在 src/ 下的文件会误拦**：`vite.config.ts`（构建配置）和 `.d.ts`
       （类型声明）都不在 lcov 里 → 改了它们会被判成「新增文件从未被任何测试
       import」→ 拦下一个完全合理的 PR。修法：pathspec 收窄到 src/ 下 +
       判据里再加一道 `src/` 检查 + 排除 .d.ts（双保险）。
  - ⚠️ **局限**：行覆盖只说明这行被执行过，不说明这行的逻辑被断言过。更强的
    保证得靠 mutation testing，太慢放不进 PR 门禁。

  新增 `scripts/coverage-diff-gate.js`；`test.yml` 的 PR 分支加一步，checkout
  改为 `fetch-depth: 0`（否则拿不到 base 的 diff）。

- **CI 测试门禁假绿 —— 测试挂了，CI 照样显示 success**（2026-10-20 评估实测）

  `scripts/test.sh --ci`（= CI workflow 的 `npm run test:ci`）**从来看不见测试失败**。
  根因是退出码被两处吃掉：

  1. `--ci` 分支用 `OUTPUT=$(run_all 2>&1)` 捕获输出 —— 这是**子 shell**，
     里面 `set +e` 关掉了提前中止，于是「首个失败即退出」根本没实现，
     全部文件都跑完了；
  2. `EXIT_CODE=$?` 取的是 `run_all` **最后一条命令**的退出码，而那行是
     `echo "── all tests passed ──"` → 恒为 0。

  实测：注入一个必失败的测试文件后，脚本照常打印「all tests passed」、
  **退出码 0**。也就是说 `.github/workflows/test.yml` 里的
  `npm run test:ci` 是一道**永远绿的门禁** —— 这个仓库没有任何一道自动门禁
  能拦住测试失败。（旁证：GitHub Actions 历史上唯一一次红是**颜色令牌门禁**
  抓的，不是测试抓的。）

  附带第二个坑：非 CI 模式全程 `set -e`，而 server 排在第 2 位 → server 一红，
  `electron`(8) + `renderer`(41) 共 **49 个测试文件永远不会执行**，信号被截断。

  修法：统一改成**跑完全部测试文件 → 收集失败清单 → 有失败就以非零码退出**。
  - `run_pkg` 里的失败不再中断循环（`if ! (...)` 让 errexit 在该命令上失效）
  - `FAILED_COUNT` / `FAILED_FILES` 是**顶层普通变量**（子 shell 里改不出来，
    这正是旧 bug 的根）
  - `--ci` 分支改成流式输出（不再用 `$(...)` 捕获），失败清单在末尾打印
  - `--coverage` 分支原来用 `|| true` 把失败整个吞掉，现在同样计入失败清单
  - CI 模式的 `✓` 标记改成**只对真通过的文件打**（旧实现无论成败都打 ✓）

  验收（故障注入实测）：注入 1 个必失败文件 → 退出码 **1**、失败清单打印、
  且 common/server/electron/renderer **四段全部跑完**（不再互相遮蔽）；
  移除注入后全绿 → 退出码 0。

- **备份文件同机其他用户可读 + 孤儿键把 state.json 撑大**（2026-10-20 实测用户机器）

  三个真实问题，都在存储/备份这条链上：

  - **备份文件是 0644 = 同机其他用户可读**。`state.json` 每次写都 chmod 0o600
    （storage.ts 里白纸黑字写着「QQ cookie / 网易云 MUSIC_U / Spotify token 全是
    明文」），但**备份路径从来没收紧过** —— 备份文件是 umask 默认的 0644，
    备份目录 0755。备份里装的就是同一份明文凭据。
    修法：目录 0700、文件 0600（`mkdir`/`writeFile` 的 mode 只在创建时生效，
    两边都再 chmod 一次覆盖「已存在」的情况）。
  - **孤儿键**：会话被 TTL 回收后，`sessions` blob 里那条没了，可
    `music:<id>` / `library:<id>` / `playlists:<id>` 还躺在 store 里没人管 ——
    实测 48 个 `music:` 键里 **46 个是孤儿**，state.json 里 1.9MB / 5.55MB 是纯垃圾，
    而且会被**原样抄进每一份备份**。
    修法：`StorageService.gcSessionScoped()` 按「session id 是否还在 `sessions.byId`」
    回收，`SessionService.evictExpired()` 每次都调（幂等，老版本遗留的孤儿在
    升级后第一次启动就被扫掉）。
    语义边界：只在**有 sessions blob** 时回收 —— 没有 blob 说明会话全没了，
    那些键可能被一次「导入备份」复活，保守起见不碰。
  - **「每日备份」被 dev 热重载刷成「最近 7 次重启」**。`onModuleInit` 每次进程
    启动都写一份 → `nest start --watch` 每次热重载都重启 → 保留的 7 份全是重启
    快照，真正的每日备份被挤掉。
    修法：启动时若 24h 内已有备份就跳过（`manual` / `daily` 不受影响）；
    备份文件名时间戳加到**毫秒**（原来只到秒，同一秒内两次备份会撞名互相覆盖）；
    备份内容不缩进（`null, 2` 把 5.5MB 膨胀到 8.9MB，+60%）。
    预期效果：单份 8.9MB → ~3.4MB，7 份合计 **62MB → ~24MB**。

- **专辑详情「不支持」断言长期红灯**（2026-10-20）——
  `album-service.e2e.test.ts` 断言错误消息里含英文子串 `'not supported'`，
  但 `6398ce6` 之后 service 的消息已经改成了人话「该平台暂不支持专辑详情（<平台>）」
  （因为它会**原样透到界面上**）。断言没跟着改 → 长期红灯。改成断言真实契约
  （中文说明 + 平台名）。同文件的 `10b` 注释还写着「网易云未实现（B1 挂起）」，
  但 `6398ce6` 已经解除了 B1（网易云 provider 已实现 `getAlbumTracks`）——
  注释与用例同步纠正，并补了 `10c`：网易云**已实现但未登录** → 抛
  「请先登录网易云」（覆盖 `6398ce6` 新增的前置拦截）。

- **残缺音源静默播完**（用户实测：搜索队列连播到《不染》，音频只有 29 秒，
  界面零反馈）—— `tryUpgradeFromTrial` 的入口条件带
  `FULL_SONG_PROVIDERS.includes(provider)`，把 Deezer/Spotify 源的歌曲整个挡在
  门外，连试都不试。而升级逻辑的目标本来就是 qq/网易云，完全有能力去找全曲。
  实测《不染》：QQ 有 5 个全长版（325/319/281s）但**全部 VIP 锁**、网易云无此歌、
  preview 平台是唯一能出声的源 → 命中该盲区。判定改为**不按 provider 过滤**，
  并抽成纯函数 `isResidualAudio()`（原先内嵌在 `onLoadedMetadata` 里、零测试覆盖）。
  附实测数据说明**为何不能**改在搜索阶段过滤：搜索 240 条结果 duration ≤35s 的
  有 0 条、❤ 库 1174 条里 <60s 仅 7 条且都是真短音频 —— 元数据干净，残缺发生在
  版权锁，「29 秒的 track」这个对象不存在。详见
  `usePlayer.helpers.ts:isResidualAudio` 的 JSDoc。
- **theater 超长歌词撑爆布局**（实测：制作人员名单 40 字被当歌词，44px 主视觉换行
  4 行把面板撑到 ~500px，压住「复制歌词 / 换个源找歌词」按钮与
  `DEEP.SEEK // NEURAL FEED`）—— 三道防线：面板 `max-height` 兜底 + 按字数
  **渐进降级字号**（<14 字 44px / ≤30 字 30px / >30 字 20px，短歌词视觉不变）+
  `-webkit-line-clamp: 3`。内容不截断，完整文本仍可通过点行导出 / 复制获取。
- **远端歌单入口与 NL 入口重叠** —— `.sp-nl-entry` 自带硬编码绝对定位
  (`top:76px;left:64px`)，第二个入口复用同一类叠在同一坐标，把 ✨ 整个盖住。
  定位归 `.sp-entries` 容器，按钮在其内流式并排。
- **远端歌单弹窗只有遮罩没有内容** —— `.remote-playlist-modal` 的
  `position: relative` 覆盖了 `DialogContent` 用于居中的 Tailwind `fixed`，
  Content 被推出视口。该类不再声明 position/transform。
- **远端歌单请求打到错误路由** —— 端点在 `@Controller('music')` 下，api.ts 漏写
  `/music` 前缀，server 回 SPA index.html，renderer 表现为
  `Unexpected token '<' … is not valid JSON`。补了断言最终 URL 的测试。
- **同一处第二个查询参数用错分隔符** —— `?provider=netease?limit=30` 导致 limit
  被静默丢弃（应为 `&`）。由新增的 URL 断言测试抓出。
- **歌单详情默认 limit 截半 Deezer** —— 默认 1000 → 2000（网易云/QQ 的 provider
  内部仍 clamp 到 1000）。

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
  - 总开关，存本地偏好并进备份集，Settings 新增「② 音频」节。
  * `lib/audioFx.ts`：频段表 / 预置 / 归一（`normaliseGains` 把 localStorage 与备份
    导入的脏数据挡在 Web Audio 之外 —— NaN 增益 = 静音且**不报错**）。
  * `lib/eqChain.ts`：链构建与参数推送抽成**纯函数**。`usePlayer` 是大 hook，测它要拉
    React 运行时 + 假 `<audio>`，而 EQ 恰恰是"写错了不报错、只听起来不对"的地方
    （串错顺序 = 整体发糊、`.value =` = 每拖一下咔一声）。抽出来后用记录调用的假 ctx
    就能把连接顺序和参数写法钉死。
  * 建链只在 graph 建立时做一次，之后只改参数、**绝不重连**：EQ 节点提前建好
    （哪怕全 0 dB），重连会发生在正在出声的时刻。
  * 开关关闭 = 各频段 ramp 到 0 dB 而非 disconnect 真旁路（后者会咔哒），曲线保留在
    prefs 里、重新打开即恢复。
  * analyser 移到 EQ **之后**（声波环要反映用户听到的声音，不是 EQ 前的原始信号）；
    `f9 → destination` 与 `f9 → analyser` 并联，analyser 创建失败也不会静音。
  * UI 诚实标注适用范围：**Spotify WPS 路径不生效**（SDK 自己解码输出）。
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
- **多源歌词合并去重**——歌词从
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
- **歌词分享图接线 + 无歌词引导**——`downloadLyricsImage`
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

- **修复：合并器把 node 侧「正确」的行数据整份丢掉 —— 覆盖率被低估、门禁会误拦**
  （2026-10-23 定位 → **2026-10-24 已修**，详见 `specs/stability/tasks.md` H16）

  为了回答「`backup-crypto` 要不要补断言」，先量了它的真实覆盖 —— 结果发现
  **它的「低覆盖」是假的**：`FNDA:11,encryptBundle`（加解密被调了 11 次），
  合并后的 lcov 里 `DA:34..95`（整个加解密核心）却全是 0 命中。

  根因：`scripts/merge-lcov.js` 的规则是「权威侧（vitest8 ∪ browser）只要有
  **任一**实质命中 → **整文件替换** node 侧的行数据」。`backup-crypto.ts` 在
  vitest 侧也有命中（`generatePassphrase` 被某个 `.test.tsx` 调了 108 次）→
  触发替换 → node 侧那 406 条真命中被丢弃（其中未覆盖的正好是 135-136 行
  =「解密后 JSON 解析失败」那条从没触发过的 catch，**语义完全对得上**）。

  影响面：**24 个文件**真正重叠，**568 条 node 侧行命中被丢弃**。最典型的：

  | 文件                   | node 侧 | 合并后           | 真相      | 修后  |
  | ---------------------- | ------- | ---------------- | --------- | ----- |
  | `lib/spotify-wps.ts`   | 488/534 | 138/534（25.8%） | **91%**   | 90.4% |
  | `lib/backup-crypto.ts` | 406/408 | 313/408（76.7%） | **99.5%** | 99.5% |

  ⚠️ 顺带**推翻了一个既有前提**：`collect-line-coverage-trust.js` 与
  `merge-lcov.js` 的注释都写着「node 侧 `.test.mjs` 的行号是随机错位的，必须
  丢弃」。实测**不成立** —— node 的 type-stripping 是按原位抹掉类型 → 行位置
  完整保留 → 行号是准的。证据：`usePlayer.ts` 的 node 命中行是 **1-131 连续
  一段**，而 1-131 正好是「import + 类型 import + re-export 块」= 模块顶层；
  `.test.mjs` 只调纯函数 → 顶层执行一次 → 顶层命中、hook 体一次没跑 → 完全正确。
  真正的问题不是「行号错位」，而是 ① node 侧**过度归因**（v8 覆盖是区间 →
  一段区间把中间的注释/空行一起算命中 → 百分比虚高）② 权威侧**覆盖不全**
  （只反映 vitest 管线 → 低估）。

  ⛔ **门禁会误拦**：`coverage-diff-gate.js` 的判定是「行级 / 函数级 / 整体 0%
  三者全清才放行」，这些文件都在「行级可信」清单里 → 改一个 `.test.mjs`
  **确实覆盖了**的行 → 合并后的 lcov 说它 0 命中 → 误拦（函数级其实通过了，
  但它是 AND 关系）。

  **已修（3 处）**：

  1. **行 / 分支 / 函数全部跨侧取并集**（不再整文件替换）—— 两侧行号同坐标系
     （node 的 type-stripping 保行位置；ts-node / coverage-v8 / 浏览器侧本来
     就有 source map）→ 取 max 是「更全的真相」。
  2. **行覆盖分母只算真实代码行**：写输出时剔除注释/空行的 DA 条目 → 解决
     过度归因造成的虚高。
  3. **信任清单**（`collect-line-coverage-trust.js`）不再只认「有 source map」
     → node 侧出现在 V8 覆盖结果里的文件行号也准 → 清单 224 → **226** 个。

  **验收（口径先定死，避免又造一个「数字在骗人」的指标）**：
  - `spotify-wps.ts` ≈91%（不是 25.8%）→ 实测 **90.4%** ✅
  - `backup-crypto.ts` ≈99.5%（不是 76.7%）→ 实测 **99.5%** ✅
  - 门禁不得对「`.test.mjs` 覆盖到的老代码」报未覆盖 → 实测：在 worktree 里改
    `spotify-wps.ts` 第 256 行（`.test.mjs` 覆盖到的老代码，纯日志文本改动），
    **修复前的 lcov → 门禁 exit 1（误拦）**，**修复后的 lcov → exit 0（放行）** ✅

  **变异验证**（逐个还原修复 → 对应用例必须红，「门禁能主动抓出坏改动」）：
  还原行级并集 → 2 条红；还原分支级并集 → 1 条红；还原注释/空行过滤 → 2 条红。

  **修复后的全局数字**（重新全量采集，同一套脚本）：

  | 口径             | 修复前             | 修复后                 |
  | ---------------- | ------------------ | ---------------------- |
  | 行覆盖（可信）   | 43245 行 / 92.48%  | **30015 行 / 92.41%**  |
  | 行覆盖（不可信） | 983 行 / 9.87%     | **0 行**               |
  | 函数覆盖         | 1183/1312 = 90.17% | 1184/1304 = **90.80%** |
  | 分支覆盖         | 6299/7708 = 81.72% | 6816/8295 = **82.17%** |

  ⚠️ 行覆盖的**分母从 44228 缩到 30015**（注释/空行不再计入）。百分比几乎
  没变（92.48% → 92.41%）说明之前撑大分母的那批行**一半以上是注释和空行**，
  而它们对应的「命中」本来就是过度归因。⇒ 数字没变，但**现在它说的是真话**。

- **修复：覆盖率总数虚高 1.46pp —— 从没被加载过的文件被踢出了分母**（2026-10-24）

  上一条（H16）让**单个文件的行覆盖回到真实**，但「总覆盖率」这个**总数**还在虚高。
  实测（CI 日志，#120 合并那次）：

  ```
  ── 合并 2 份 lcov：145 个文件，行覆盖 27774/30632 = 90.67%   ← 合并后 lcov 的真值
  ── 行覆盖可信性：可信 30147 行（92.13%），不可信 485 行（0%）  ← 485 行全是 0 命中
  ── total line coverage: 92.13%                               ← 报告报的是可信桶
  ```

  差值 **30632 − 30147 = 485** 行，**全是 0 命中** → 报告把它们**踢出了分母**
  → 虚高 **1.46pp**。更要紧的是：**「新增一个从没被测过的文件」完全不影响总数**
  → 覆盖率在骗人。

  **这 485 行是什么**（实测）：`server/src/main.ts`(35)、
  `server/src/music/album-types.ts`(52)、`server/src/music/types.ts`(116)、
  `server/src/reco/eval-cli.ts`(140)、`server/src/reco/eval-genre-cli.ts`(142)
  —— 全是**从没被任何测试加载过**的文件。它们在 lcov 里的 DA 条目是
  **1..N 连续的真实源文件行**（`types.ts` 1..297 / 源文件 298 行）→ **行号是准的**，
  「0% 覆盖」这个**结论也是真的** → **必须按 0% 计入分母**。

  ⚠️ **归因修正**：这个虚高**不是** H16 引入的 —— H16 **之前**就虚高 **1.84pp**
  （合并值 90.72% vs 报告 92.56%），是「All files 只算可信」那一条单独造成的；
  H16 反而把它**收窄**到 1.46pp（因为 node 侧那批行号被证明是准的、进了可信桶）。
  剩下的 1.46pp 全部来自「从没被加载的文件被踢出分母」。

  **顺带修掉两个「静默」问题**：

  1. **合并器丢文件**（pre-existing，`fb00665` 起）：权威侧「存在但一行都没
     命中」的文件既不进 `merged`，又因为 `if (input === authoritative) continue;`
     把权威输入整个跳过 → **两头落空 → 该文件从合并结果里消失**。实测
     `packages/renderer/src/desktop-lyrics/main.tsx` 就是这样丢的（auth 侧 71 个
     文件里有它、0 命中；合并后 137 个文件里没有）→ 修后 **138** 个。
  2. **三份 lcov 解析实现、三种语义**：`merge-lcov.js` / `lcov-summary.js` /
     `coverage-diff-gate.js` 各写一份，重复文件的处理各不相同（取 max / 后者覆盖
     前者 / 保留第一个+报错）→ 抽出 `scripts/lib/lcov.js` 作**唯一真源**。

  **改法**：

  - 新增 `scripts/lib/lcov.js`：统一 `parseLcov` + 统一「行级可信」判据
    （信任清单 ∪ **全 0 命中** —— 0% 这个结论是真的，且实测行号也准）。
  - 报告端（`lcov-summary.js`）与门禁端（`coverage-diff-gate.js`）**用同一套
    判据** → 不会再出现「报告说可信、门禁说不可信」。
  - 合并器：权威侧 0 命中的文件**不再丢**；行/分支/函数**统一走一条并集路径**。
  - 门禁对「从没被加载」的文件**行级判据生效** → 报错能指出**具体哪几行**没跑到
    （以前只能报「整个文件 0%」）。结论不变（照样拦）。
  - 顺带把 `merge-lcov.js` 的自测改成**调真身**（`mergeSources`）—— 原来自测里
    另写了一份合并逻辑的副本，合并逻辑改坏了自测测不出来。

  **验收**（同一份数据 + 同一份信任清单，可直接对比）：

  |                  | 可信桶                 | 不可信桶     | All files          |
  | ---------------- | ---------------------- | ------------ | ------------------ |
  | 修复前           | 43348 行（**92.48%**） | 880 行（0%） | 92.48%（**虚高**） |
  | 修复后           | 44228 行（**90.64%**） | **0 行**     | **90.64%**         |
  | 合并后 lcov 真值 | —                      | —            | **90.64%** ✓       |

  ⇒ **报告值 == 合并后 lcov 的整体行覆盖**（自洽）→ 虚高归零。

  **变异验证**（逐个还原修复 → 对应用例必须红）：

  - 还原「全 0 命中 → 可信」→ 共享模块 + 门禁各红一条
  - 还原「权威侧 0 命中的文件不丢」→ 合并器红两条
  - 还原「重复文件保留第一个」→ 共享模块红三条
  - 还原门禁的旧判据 → 门禁红一条

- **组件层测试补完（17/17）+ 覆盖率 79.61% → 82.24%**（2026-10-21）

  `specs/stability/tasks.md` H4 收口。renderer 的组件层此前有 7 个文件
  **0% 覆盖**，补上 73 条用例：

  - `common/PlayerNotice`（13）—— **失败分级 UI**：五种 reason 的文案必须
    **互不相同**（"分级"失效就等于"都显示同一句"）；4s 倒计时 +「停留」；
    只有 paid-track / vip-locked 给外链；换歌倒计时重置
  - `common/RecoLoading`（8）—— 阶段按**已耗时**推进（2.5s / 7s / 14s），
    不无脑循环（用户等 20s 看到文案绕回第一句，反而像卡住了）
  - `layout/Titlebar`（12）—— 条件渲染 + 各按钮回调 + ♤ 计数徽标
  - `modals/NeteaseCookieModal`（12）—— 扫码轮询三态（803/800/802）+
    手动 MUSIC_U 兜底
  - `modals/RemotePlaylistModal`（17）—— 解析→读取→播放/追加/存本地歌单
  - `source-select/SourceSelect`（7）—— Spotify 档位文案
  - `__sandbox/ButtonSmoke`（4）—— Radix 编译链烟囱

  **顺带修掉 2 条墙钟依赖的 flaky**：`usePlayer.hook.test.tsx` 里「会员已失效」
  和「凭据已过期」两条还留在**真定时器**上（兜底链 800ms + 1500ms 是真
  setTimeout），高负载下被拖过 vitest 默认 5s → 超时。同文件里「兜底链耗尽」
  那条已被改成假定时器，这两条是**漏网的同类**。改成手动推进时钟后，整个文件
  从「超时 5s」变成 **145ms**，与负载无关。

  覆盖率：**79.61% → 82.24%**（行）/ 80.76%（分支）/ 77.13%（函数），
  分母 148 个文件。

- **覆盖率数字不再骗人 —— 口径从 85.63% 改成诚实的 72.19%**（2026-10-20）

  `npm run test:coverage` 之前报的 85.63% **对代码库没有代表性**。三个缺陷：

  1. **`.test.tsx` 根本不进覆盖率** —— coverage 分支只 glob `*.test.ts` /
     `*.test.mjs`，17 个组件测试文件（`usePlayer.hook.test.tsx` 等）压根不执行；
     连带 `.tsx` 源文件也没插桩（`--extension .ts` 只认 `.ts`）→
     `TheaterView.tsx`（1022 行、**25 个通过的组件测试**）在报告里是 **0%**。
     修法：c8 包 vitest 跑 `.test.tsx`（worker 继承 NODE_V8_COVERAGE，实测能收到
     `.tsx` 覆盖数据），并加 `--extension .tsx`。
  2. **分母 = 「被某个测试 import 过的文件」，不是「所有源文件」** ——
     从没被 import 的源文件既不计分子也不计分母，被静默排除（renderer 72 个源文件
     报告里只有 24 个，48 个消失）。修法：采集**与报告**两步都加
     `--all --src <每包 src>` —— 只在采集步骤加无效，c8 report 默认只输出
     「V8 覆盖率里出现过的文件」。报告条目 111 → **141**。
  3. `common/dist` 与 `common/src` 双计 → 虚高 0.98pp。修法：`--exclude` 剔掉
     `**/dist/**` / `**/*.d.ts` / 测试文件自身。

  落地后 **72.19% 行 / 80.42% 分支 / 74.79% 函数（141 条目）**，≥60% 门禁仍然通过，
  但这个数字**第一次代表整个代码库**。几个因此「显形」的洞：
  `usePlayer.ts` 5.3% → **38.8%**（测试早就补了，只是以前测不出来）、
  `electron/src` 6.2%（`main.ts` / `preload.ts` 0%）、
  `renderer/src/hooks` 29.32%、`components/layout` 0%。

  另加一条提示：**本次有 N 个测试文件失败 → 覆盖率偏低**。失败的文件不产生
  （或只产生部分）覆盖数据，于是「某个测试文件跑不起来」会伪装成「这块代码没测」
  —— 实测踩过：`reco.test.ts` 跑不起来时，`reco.service.ts` 覆盖率从 80.27%
  塌成 11.1%，看着像天大的覆盖洞，其实只是那个测试文件没跑成。
  **覆盖率是二手结论**；指认「核心逻辑没测」之前，先确认那个测试文件本身是绿的。

- **测试门禁从「永远绿」改成真门禁**（2026-10-20）—— 见上方 `### Fixed` 条目。
  配套：`specs/stability/tasks.md` 的 **G2** 条目补记了原验收标准的漏洞
  （只验了「全绿时跑通」，没验「有失败时会不会红」）。
- **九层测试覆盖评估（2026-10-20）** —— 产出 `specs/stability/tasks.md` 的
  **H 组（H1–H7）**，逐条带实测数据与验收标准。关键结论：
  - `usePlayer.ts` hook 体（2040 行）曾**零执行**（99 项断言全走导出的纯函数）、
    `reco.service.ts` 曾 11.1% / 函数 4.7% —— 后两项已由并行 session 补齐
    （`reco.service.ts` 复测 **84.6% / 91.5%**）
  - **覆盖率数字口径失真的实测影响是 ~24pp，不是 1pp**（见上条，已修）
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
    - 内容减法，原 1920 档方案改写为 transform:scale 1.29×。
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
`NEXT-ITERATION.md` §0「Apple Developer + castLabs EVS 落地」。

历史 PR / commit hash 的完整追踪参见 `git log --oneline` / `git log --grep`。
