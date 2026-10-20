# Changelog

All notable changes to Maestro will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

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
