> 对应 `specs/album-search/spec.md`。执行入口：`/spec-implement album-search`
> **Phase -1 已完成（2026-09-30），Phase 0 可以开始。**
> ⚠️ 三个阻塞项（网易云详情 / Spotify / Deezer 限流阈值）见 Phase -1 末尾，未解则对应任务跳过。

## Phase -1：接口探路（Spike）— ✅ 已完成 2026-09-30

> 结论已回写 `spec.md`（Phase -1 节 / provider 表 / 风险表 / 附录）。
> 一次性脚本在 `/tmp/spike*.mjs`，**未进仓库**，符合任务 F4。

- [x] -1.1 本机环境勘察：29 个 session **全部无登录态** → Spike 只能匿名跑
- [x] -1.2 QQ 专辑搜索 `t=8` → `code=0`，6/6。字段：`albumMID`/`albumName`/`singerName`/
      `albumPic`(R180)/`song_count`/`publicTime`
- [x] -1.3 QQ 专辑曲目 `fcg_v8_album_info_cp` → **6/6，裸 albummid 即可，无需 guid/签名**。
      字段含 `songmid`/`strMediaMid`/`pay`/`belongCD`/`cdIdx`
- [x] -1.4 网易云 `cloudsearch/pc&type=10` → `code=200`，6/6。⚠️ `artist`(单数) 为空，
      必须读 `artists[]`(复数)
- [x] -1.5 网易云 `/api/album/{id}` → ❌ **`code:-462 "请绑定手机后再试哦~"`**
- [x] -1.6 Deezer `/search/album` → 可用但**易限流**；`limit` 无 50 上限（25/50/100 全通过）
- [x] -1.7 Deezer `/album/{id}` → 6/6 稳定。⚠️ `tracks.data[]` **无 trackNumber**
- [x] -1.8 Spotify `/v1/search?type=album` → ❌ **无法验证**：无 token，直接 401
- [x] -1.9 Spotify `/v1/albums/{id}/tracks` → ❌ 同上，未验证
- [x] -1.10 四段真实 JSON 已贴进 `spec.md` 附录（含曲序字段横向对比表）
- [x] -1.11 结论回写 spec：端点定稿 / 风险表重排 / 执行顺序调整
- [x] -1.12 登录态 vs 匿名对照 → **无法做**（本机无任何登录会话）。
      改为做了**反爬归因对照实验**（4 header 变体 × 6 次），证明 `-462` 与 header 无关、
      是 IP 级反爬；并验证搜索兜底方案命中 0 首，不成立

### Phase -1 遗留的三个阻塞项

- [ ] **B1** 网易云 `getAlbumTracks` — 需一个**已登录网易云**的会话复测 `/api/album/{id}`。
      登录后若仍 `-462`，则网易云专辑详情为永久缺口，spec 需再改一次范围
- [ ] **B2** Spotify 整条线 — 需 OAuth token 才能继续任务 1.5 / 1.6
- [ ] **B3** Deezer 限流阈值 — 需测出「多少次请求/多少时间内」触发，
      以便在 `withTimeout` 之外加请求节流。当前只有定性结论（压测必触发，正常使用未验证）

## Phase 0：类型与接口签名

- [x] 0.1 新建 `packages/server/src/music/album-types.ts`：`AlbumSource` /
      `UnifiedAlbum` / `UnifiedAlbumSearchResult`（结构照 spec「类型」节）
- [x] 0.2 `packages/common/src/provider.ts` 的 `MusicProvider` 加两个**可选**方法
      `searchAlbums?` / `getAlbumTracks?`
- [x] 0.3 `npm run typecheck` 通过（可选方法不该引起任何现有实现报错）

## Phase 1：Provider 实现

- [x] 1.1 `netease.provider.ts:searchAlbums()` — `cloudsearch/pc` + `type=10`
- [ ] 1.2 ~~`netease.provider.ts:getAlbumTracks()`~~ → 🔴 **挂起（B1）**
      Spike 实测 `/api/album/{id}` 返 `code:-462`，与 header 无关的 IP 级反爬，
      搜索兜底命中 0 首不成立。**等有登录网易云的会话后复测再决定是否实现。**
      不要现在写。
- [x] 1.3 `deezer.provider.ts:searchAlbums()` — `/search/album`
- [x] 1.4 `deezer.provider.ts:getAlbumTracks()` — `/album/{id}` → `tracks.data[]`
- [ ] 1.5 ~~`spotify.provider.ts:searchAlbums()`~~ → 🔴 **挂起（B2）**
      无 OAuth token，`/v1/search?type=album` 直接 401，schema / limit 上限全未知。
      **不要照 track 的 clamp=10 猜一个值写进代码。**
- [ ] 1.6 ~~`spotify.provider.ts:getAlbumTracks()`~~ → 🔴 **挂起（B2）**，同上
- [x] 1.7 `qq.provider.ts:searchAlbums()` — `client_search_cp&t=8`（Spike 已定稿，6/6）
      → `albumName`/`singerName`/`albumPic`(R180)/`song_count`/`publicTime`
- [x] 1.8 `qq.provider.ts:getAlbumTracks()` — `fcg_v8_album_info_cp.fcg?albummid=`（已定稿，6/6）
      → 裸 albummid 即可，**无需 guid/签名**（原 spec 的「高风险」已被 Spike 排除）
      → 复用现有 `detectQqVipLocked(s.pay, session.qqVip)`，**不要另写一份**
      → trackNumber 由 `belongCD` + `cdIdx` 组装
- [x] 1.9 全部外部调用套 `withTimeout`（单平台 5s），音频/封面字节流不设超时
- [x] 1.10 provider 单测：QQ / 网易云 / Deezer 的 `searchAlbums` 字段映射
      （mock 响应 → `AlbumSource`）
- [x] 1.11 **单测锁住网易云 `artists[]` vs `artist`**：mock 里 `artist.name=""` +
      `artists=[{name:"王珏子乔"}]`，断言取到「王珏子乔」而非空串
      （取错会让所有专辑 artist="" 合并成一坨）
- [x] 1.12 Deezer `/search/*` 限流与「真空」要能区分：限流应标 error 而非返回空列表
      （否则用户看到"暂无结果"，复刻 `unified-search/tasks.md:19` 的坑）

## Phase 2：跨平台合并与搜索端点

- [x] 2.1 新建 `packages/server/src/music/album.util.ts`：`buildUnifiedAlbums()` + 专辑版相关性排序（算法照 spec「合并逻辑」7 步）
- [x] 2.2 `album.util.ts` 单测：合并键 / 同名不同歌手不并 / trackCount 分歧标
      `variantMismatch` 且不跨平台合并 / coverUrl 取首个非空 / trackCount 中位数 /
      year 最早非零 / 相关性排序 / 空输入 —— ≥8 用例
- [x] 2.3 `music.service.ts:searchAlbumsUnified()` — 复用 `searchOneProvider` 的
      fail-soft 模式（单平台失败不阻塞，`Promise.all` 不让 reject 冒泡）
- [x] 2.4 分页 + `pageSize` clamp（1-50），非法 page/pageSize 兜底逻辑照抄
      `searchUnified:665` 的 `Number.isFinite` 写法
- [x] 2.5 `music.controller.ts` 加 `GET /music/albums/search`
- [x] 2.6 端点级测试：空 q → 400、>100 字符 → 400、单平台失败 → 200+errors、
      4 平台全失败 → 200+空 items（不 502）
- [x] 2.7 回归护栏：搜「叶惠美」应**产出多张**卡片（QQ 周杰伦 11 首 / 网易云 王珏子乔 18 首 /
      Deezer Jue Wang 19 首），不能被合并成一张 —— 用真实响应片段做 fixture 锁住

## Phase 3：专辑曲目与播放全部

- [x] 3.1 `music.service.ts:getAlbumTracksUnified()` — 拉单平台 `Track[]` →
      `buildUnifiedItems` 合并（**不**加 `crossScriptMerge`？——见下）- ⚠️ 决策点：`unified-search/tasks.md:21` 的跨脚本合并是为**全目录搜索**设计的，
      专辑内曲目是同一位歌手/乐队的作品，跨脚本误并风险低但存在（如 CJK 曲名 + 罗马音
      曲名同专辑）。倾向**开** `crossScriptMerge`，理由是专辑内曲名同质性高、时长门
      （≤30s）能兜住。实现时用一张有跨脚本曲名的专辑（如 Evan Yo）端到端验证
- [x] 3.2 曲目排序：**「可得即用，缺失保序」**（Spike 已确认三家能力不一致）- QQ → `belongCD` + `cdIdx` 组装出 trackNumber，可排序 - Deezer → **无 trackNumber 字段**，保持 API 返回序 - 网易云 → `songs[].no`，但端点被封取不到 - ⚠️ **不要为了跨平台对齐而重排 Deezer 的曲目** —— 会打乱它的原始顺序，
      那是这张专辑在 Deezer 上的真实编曲顺序
- [x] 3.3 `music.controller.ts` 加 `GET /music/albums/:provider/:albumId/tracks`
      → `{ items: UnifiedSearchItem[] }`（**已合并**，renderer 不再合并）
- [x] 3.4 404 / 502 分支：专辑不存在 → 404；provider throw → 502（带错误摘要）
- [x] 3.5 ~~`music.controller.allowlist.test.ts` 补两个新端点~~
      → ⚠️ **本条原任务写错了**：`allowlist.test.ts` 测的是音频流私域 host 白名单，
      不管路由清单。正确做法是新增 `album-service.e2e.test.ts`（service 层 17 用例，
      含 fail-soft / 分页 / 曲序 / 参数校验）+ `album-provider.test.ts`（provider 层 27 用例）。
      两个新端点的存在性已由真实 server 启动日志确认：
      `Mapped {/music/albums/search, GET}` / `Mapped {/music/albums/:provider/:albumId/tracks, GET}`
- [x] 3.6 renderer `api.ts` 加 `searchAlbums()` / `fetchAlbumTracks()` + 类型定义
      （`UnifiedAlbum` / `AlbumSource` / `UnifiedAlbumSearchResult`）
- [x] 3.7 「播放全部」入队：从第 1 首开始，复用现有 `onPlay(items, index)` 契约
      （**不**新增队列机制）
- [x] 3.8 端到端：拿一张**有 live 版曲目**的专辑 curl 曲目端点，确认 `buildUnifiedItems`
      的多版本折叠行为在专辑场景合理 - 用 **纵贯线《Live in Taipei / 出发·终点站》**（`albummid=001Drvrj2djhHM`，56 首）
      实测：拉回 56 首 → 合并成 **51 个 item**，其中 **5 个是多版本折叠**，
      每个 versions=2，且时长差异合理（如「凡人歌 (Live)」267s / 251s =
      不同场次的同一首歌）- ✅ 折叠行为**正确**：同 versionType（live）+ 同 key → 归为一条 item 的两个
      version，不会重复占两行；专辑内 51 个 item 全部标 `versionType=live`，
      说明 album 路径的 versionType 分类同样生效 - 附带观察：专辑 56 首 → 51 item，说明有 5 首确实是同曲多版本，与上面吻合 - 之前只验过纯录音室专辑（QQ 叶惠美 11 首 / Deezer 19 首），本条补上了
      live 版这一档
- [x] 3.9 ⚠️ **当前只覆盖 QQ + Deezer 两个平台的专辑详情**（网易云 B1 / Spotify B2 挂起）。
      服务端已能优雅处理：未实现的平台 → 400 `album detail not supported on <p>`（已实测）；
      专辑不存在 → 404（QQ `code=1101` / Deezer `200+{error:'no data'}`，均已实测）；
      上游故障 → 502。UI 侧提示留到 Phase 4

## Phase 4：Renderer UI

- [x] 4.1 「歌曲 / 专辑」tab 切换；切 tab **不丢关键词**，并 abort 在途的另一 tab 请求 - 实现取法：`q` **留在 SearchPanel**（不提升到 App），专辑结果区委托给
      `AlbumResults`（新文件），因此切 tab 天然不丢输入 - ⚠️ 踩到的真 bug：最初只把**渲染**按 tab 分流，搜索 **effect** 没门控 →
      在专辑 tab 打字会同时打 `searchUnified`。已在 effect 开头加
      `if (tab === 'album') return`，并补测试锁住 - 专辑 tab 隐藏 source-toggle：`/albums/search` 没有 provider 参数，
      单平台搜专辑体验割裂
- [x] 4.2 专辑 tab 复用现有 debounce 300ms / pageSize 20 / 3s 空结果 / AbortController
- [x] 4.3 **最简专辑列表视图**（复用 `.sp-row` / `.sp-cover` / `.sp-row-meta` 等
      现有类名：封面 + 专辑名 + 艺术家 + 曲目数 + 年份 + 平台字母 chip）
      —— 保证功能闭环，不等 Figma。
      新增样式集中在 `_search-panel.scss` 末尾，全部走 `var(--token)`，
      颜色门禁 `scan-hardcoded-colors.mjs --gate` 通过
- [x] 4.4 点专辑行 → 拉曲目 → 展开为曲目列表（每行可单独播放，走 `buildUnifiedItems`
      产出的 `UnifiedSearchItem`）
- [x] 4.5 「播放全部」按钮 —— **只入队可播曲目**（`filter(isPlayableEntry)`），
      不可播的混进去播放会静默失败；全不可播时按钮 disabled
- [x] 4.6 `variantMismatch` 角标（文案如「版本分歧」，tooltip 说明"各平台曲目数不一致，
      未跨平台合并"）
- [x] 4.7 错误态：部分平台失败 → `.sp-album-warn` 非阻塞提示条（仍显示已有结果）；
      全失败 → 提示条 + 「暂无结果」；`searchAlbums` 抛错 → `.sp-error`；
      拉曲目失败 → 卡片内提示，不影响其它卡片
- [ ] 4.8 Figma 定稿后把 4.3 的最简列表换成正式网格卡片（**本轮按设计刻意延后**）
      —— 本轮只交最简列表视图（复用 `.sp-row` 等现有类名）保证功能闭环。
      等专辑 UI 设计稿定稿后再换网格。**这是唯一未做的 Phase 4 任务**
- [x] 4.9 `SearchPanel.test.tsx` 回归
  - 新增 18 个专辑用例；原有 15 个**一个字未改、全部仍通过**（零回归）
  - 覆盖：切 tab 不丢关键词 / 专辑 tab 不误触歌曲搜索 / 点专辑行拉曲目 /
    点曲目行播放 / 播放全部 / 再点收起 / 版本分歧角标 / 部分与全平台失败 /
    拉取失败显示错误态 / 在途请求被 abort / 分页按钮出现与消失
  - 「分页按钮」这条是**专门为已发生的 bug 加的**：`setHasMore` 一度从未被调用，
    `hasMore` 恒 false，导致「加载更多」永不渲染；由 eslint `no-unused-vars` 暴露

## 收尾

- [x] F1 `npm run build:common && npm run typecheck && npm run lint && npm test` 全绿
- [x] F2 端到端 curl 三条：专辑搜索 / 专辑曲目 / 非法 q → 400
- [x] F3 复核 `spec.md` 验收标准逐条勾选，spec 里没写但实现中改了的决策回写进 spec
- [x] F4 清理 Spike 期的一次性脚本（`/tmp/spike*.mjs`，从未进仓库，天然满足）
