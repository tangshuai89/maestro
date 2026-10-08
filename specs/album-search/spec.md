# 专辑搜索

## 背景 / 现状

仓库当前**完全没有专辑维度的搜索**，也没有任何"拉专辑曲目"的能力。

| 现状                                                   | 位置                                                                                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 四个 provider 的 `search()` 全部硬编码单曲端点         | `qq.provider.ts:650` `t=0` / `netease.provider.ts:382` `type=1` / `deezer.provider.ts:137` `/search` / `spotify.provider.ts:539` `type=track` |
| `Track.album` 只是一个字符串字段（单曲结果里的专辑名） | `music/types.ts`                                                                                                                              |
| `GET /music/search` 无 `type` 参数，契约已冻结         | `music.controller.ts:113`                                                                                                                     |
| 无 `getAlbumTracks` 类接口                             | 全仓库 grep 无命中                                                                                                                            |
| `specs/unified-search`                                 | 已完成（21 项），**只做歌曲**，本 spec 不动它                                                                                                 |
| `specs/paid-album-detection`                           | 已完成，**只做单曲 `vipLocked` 标记**，与本 spec 无交集                                                                                       |

**为什么值得做**：用户搜歌时大量输入其实是专辑名（`叶惠美`、`范特西`、`五月天第三张专辑`）。
现在这类输入落到单曲搜索上，结果是"一堆散歌"，没有"这是同一张专辑"的聚合视图，也没有
"按专辑顺序播"这个动作。专辑是播放场景里比单曲更强的组织单位。

## 做什么

在现有搜索框上增加 **歌曲 / 专辑 两个 tab**。切到「专辑」tab 时：

1. 跨 QQ / 网易云 / Deezer / Spotify 搜专辑，按"专辑名 + 艺术家"标准化键跨平台合并去重
2. 网格卡片展示（封面 / 专辑名 / 艺术家 / 曲目数 / 平台 chip / 年份）
3. 点卡片 → 拉该专辑的曲目列表 → 走**已有的** `buildUnifiedItems` 跨平台合并 → 曲目列表
4. 「播放全部」→ 整张专辑入队，按 trackNumber 排序
5. 付费专辑不额外标锁 —— 锁在**逐曲**层面由现有 `vipLocked` / `vipCategory` 判定（见「不做什么」）

## 不做什么（Out of Scope）

- **不改** `GET /music/search` 的现有契约。新增独立端点 `GET /music/albums/search`。
  `unified-search` 已上线并有 21 条测试锁住行为，扩 `type` 参数会污染那条线。
- **不做**专辑级付费锁 UI（"整张专辑标 [NP]"）。理由：QQ/网易云都不开放"用户是否已购买
  该专辑"给第三方（`paid-album-detection/spec.md` 已记录这个结论）。专辑卡片标了也判不准，
  逐曲判定反而准确。专辑卡片**不显示**任何付费角标。
- **不做**专辑缓存/落库。专辑搜索是一次性查询，不进 `library`。
- **不做**艺人搜索 tab（虽然三家都有 `/search/artist`）。等专辑这条线验证完再单开 spec。
- **不改** `buildUnifiedItems` / `selectBestSource` / `dedupTracks`。专辑曲目合并直接复用，
  它们对 album 字段无感。
- **不做**专辑封面 proxy 优化。复用现有 `GET /music/cover-proxy`。

## Phase -1：接口探路（Spike）— ✅ 已完成 2026-09-30

**这是本 spec 最重要的一节。** 仓库有明确前科：网易云 `search/get/web` 在 2026-09 对登录态
返回 `code:405`，整条搜索静默空列表（`unified-search/tasks.md:19`）。专辑端点比单曲端点
更老、更少人用，腐化概率显著更高。

### 实测结论（本机匿名环境，2026-09-30）

| 端点                                     | 结论                                                     | 压测                   |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------- |
| QQ 专辑搜索 `client_search_cp&t=8`       | ✅ **匿名可用**                                          | 6/6                    |
| QQ 专辑曲目 `fcg_v8_album_info_cp.fcg`   | ✅ **匿名可用，无需 guid/签名**                          | 6/6                    |
| 网易云 专辑搜索 `cloudsearch/pc&type=10` | ✅ **稳定**                                              | 6/6                    |
| 网易云 专辑曲目 `/api/album/{id}`        | ❌ **不可用**（IP 级反爬，见下）                         | 3/6                    |
| Deezer `/search/album`                   | ⚠️ 可用但**易触发瞬时限流**                              | 6/6 → 0/6 → 冷却后 5/5 |
| Deezer `/album/{id}`                     | ✅ 稳定                                                  | 6/6                    |
| Spotify 全部                             | ❌ **无法验证**：本机无 OAuth token，无 token 返回 `401` | —                      |

### 三条推翻原假设的发现

1. **QQ 不需要签名。** 原 spec 假设 `fcg_v8_*` 老旧可能跑不通 —— 实测 `albummid` 裸请求
   就能拿到完整曲目列表（`songmid` / `strMediaMid` / `pay` 全都有）。QQ 这条线**没有缺口**。
2. **网易云专辑曲目是硬阻塞。** `/api/album/{id}` 返回 `code:-462 "请绑定手机后再试哦~"`。
   对照实验（4 种 header 变体 × 6 次）证明**与 header 无关**，是 IP 级反爬：
   `no-referer 2/6`、`ref=/ 1/6`、`ref=/album?id= 3/6`、`ref=/+secfetch 0/6`。
   搜索兜底方案（`cloudsearch type=1` 后按 `al.id` 过滤）实测**命中 0 首**（该专辑应 11 首，
   搜索只返 14 条且无一条属于本专辑）—— 搜索不索引专辑全量曲目，兜底不成立。
   → **结论：网易云专辑详情需登录态。本机无登录会话，无法验证登录后是否放行。**
3. **"同名不同专辑"不是防御性冗余，是刚需。** 搜「叶惠美」三家分别返回：
   QQ = 周杰伦 11 首 / 网易云 = **王珏子乔 18 首（翻唱）** / Deezer = `Jue Wang` 19 首。
   若无 `trackCount` 分歧守卫，会把翻唱和原专辑并成一张卡片，曲目列表整个是错的。

### 因此产生的范围调整

- **网易云专辑搜索保留，专辑详情暂缓** —— 搜索端点（`type=10`）稳定可用，先出这一半
- Phase 1.2（网易云 `getAlbumTracks`）降级为「需登录态验证」，在 spec 中标为**已知缺口**，
  对应 tasks.md 的阻塞项 **B1**
- **Spotify 整条线挂起**，直到能提供 OAuth token（tasks.md 阻塞项 **B2**；连带 1.5 / 1.6）
- Deezer 搜索的限流风险要求：**不要因为它返回 0 结果就当"没搜到"**，
  错误处理需区分「限流」和「真空」（见风险表）

## 验收标准

### 通用

- [ ] 搜索框有「歌曲 / 专辑」tab 切换，切换不丢失已输入的关键词
- [ ] 专辑 tab 沿用歌曲 tab 的 300ms debounce / 20 条分页 / 3s 空结果提示 / AbortController
- [ ] 专辑 tab 的请求**不与**歌曲 tab 打架（切走时 abort 在途专辑请求）
- [ ] 单平台专辑搜索 throw → 200 + 该平台标 `unavailable`，其他平台正常出结果
      （复用 `searchOneProvider` 的 fail-soft 模式）
- [ ] **Deezer 限流与「真空」可区分**：被限流时标 error 并提示，不能返回空列表让用户
      看到「暂无结果」（Spike 实测 Deezer `/search/*` 压测必触发限流，冷却 40s 恢复）
- [ ] **仅 QQ + Deezer 支持专辑详情**（网易云 / Spotify 挂起）：点不支持的卡片给明确提示，
      不静默失败
- [ ] 空 `q` / `q.length > 100` → 400（与 `/music/search` 同校验）
- [ ] 4 个平台全部失败 → 返回 `{ items: [], errors: {...} }`，UI 显示"暂无结果"而非崩溃

### 跨平台合并

- [ ] 合并键 = `normalizeKey(albumName, artist)`（复用 `packages/common/src/normalizer.ts`，
      **禁止**在 server 端另写一份）
- [ ] 同一专辑在多个平台都有 → 合并成一张卡片，`sources[]` 列出全部源
- [ ] 卡片封面：取首个非空 `coverUrl`（跨平台取，同 `unified-search/tasks.md:15` 口径）
- [ ] 同名专辑但**艺术家不同** → 不合并（两张卡片）
- [ ] 同名同艺术家但 `trackCount` 差 >50% → 标记 `variantMismatch`（UI 加角标），
      **且不跨平台合并**（同平台内去重即可）。理由：同名再版/豪华版合并错 = 曲目列表整个错，
      比歌曲维度误并严重得多
- [ ] 合并口径用 `normalizeKey`（匹配级）而非 `displayKey`（展示级），跟 `unified-search` 一致。
      专辑名括号内容（如 `叶惠美 (Special Edition)`）是真实差异，靠 trackCount 那一档兜

### 专辑详情 / 播放

- [ ] 点卡片 → 拉曲目列表，loading 态有明确反馈
- [ ] 曲目列表走 `buildUnifiedItems` 合并（同一首歌的多平台版本仍折叠成多版本行）
- [ ] 曲目按 `trackNumber` 升序；平台没给 `trackNumber` 时保持平台返回序
- [ ] 「播放全部」→ 整张专辑入队，从第 1 首开始
- [ ] 曲目列表里的每行仍可单独播放（复用现有 `SearchPanel` 行点击逻辑）
- [ ] 专辑拉曲目失败 → 卡片上显示"曲目加载失败"，不影响其他卡片

### 接口

- [ ] `GET /music/albums/search?q=&page=&pageSize=` → `UnifiedAlbumSearchResult`
- [ ] `GET /music/albums/:provider/:albumId/tracks` → `{ items: UnifiedSearchItem[] }`
      （曲目**已合并**，直接喂现有队列渲染）
- [ ] 两个端点都受现有 `sessionService.resolve` 鉴权保护
- [ ] `music.controller.allowlist.test.ts` 补上两个新端点

### 质量

- [ ] `npm run typecheck && npm run lint && npm test` 全绿
- [ ] 单测覆盖：合并键 / 同名不同歌手不并 / trackCount 分歧标记 / 空输入 /
      4 平台全失败 / 单平台 fail-soft —— 至少 8 个用例
- [ ] renderer 侧有 `SearchPanel` 回归测试：切 tab 不丢关键词、专辑卡片点击拉曲目
- [ ] 端到端：`curl '/api/music/albums/search?q=叶惠美'` 返回跨平台合并结果；
      `curl '/api/music/albums/qq/{albumMid}/tracks'` 返回可播放曲目

## 接口规格

### 类型（新增 `packages/server/src/music/album-types.ts`）

**放独立文件而不是塞进 `types.ts`** —— `types.ts` 现在是纯 `Track`/`SourceInfo` 家族，
专辑是独立聚合根，混进去会让所有 import `types.ts` 的地方都拖上专辑类型。

```ts
import { MusicProvider } from '../common/provider';

/** 单个平台上的一个专辑。 */
export interface AlbumSource {
  platform: MusicProvider;
  /** 平台内专辑 id：QQ=albumMid / netease=albumId / deezer=albumId / spotify=albumId */
  albumId: string;
  /** 该平台返回的专辑名（未归一，合并后取代表项的） */
  title: string;
  artist: string;
  coverUrl: string;
  /** 曲目数。0 = 平台没给（不要当成"空专辑"） */
  trackCount: number;
  /** 发行年份。0 = 未知 */
  year: number;
  /** 平台返回的原始排序位次，供 tie-break */
  rank: number;
}

/** 跨平台合并后的专辑卡片。 */
export interface UnifiedAlbum {
  id: string; // `merged-${normalizeKey(title, artist)}` 截断
  title: string; // 代表专辑的原始名
  artist: string;
  coverUrl: string; // 首个非空 coverUrl
  trackCount: number; // 各源中位数（不是最大 —— 再版会虚高）
  year: number; // 最早非零（合辑常见 0）
  sources: AlbumSource[];
  /** trackCount 分歧超阈值时置位，UI 加角标 */
  variantMismatch?: boolean;
}

export interface UnifiedAlbumSearchResult {
  q: string;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedAlbum[];
  /** 失败的平台。key = platform，value = 错误摘要。 */
  errors?: Partial<Record<MusicProvider, string>>;
}
```

### 后端端点

```
GET /music/albums/search?q=<关键词>&page=1&pageSize=20
  q:        string (必填, 1-100 字符)
  page:     number (选填, 默认 1)
  pageSize: number (选填, 默认 20, 最大 50)

→ 200 UnifiedAlbumSearchResult
→ 400 q 参数无效

GET /music/albums/:provider/:albumId/tracks
  provider: qq | netease | deezer | spotify
  albumId:  平台内专辑 id（QQ 是 albumMid，不是 songmid）
  page/pageSize: 选填，Deezer / Spotify 曲目接口本身分页，QQ / 网易云一次返回全量

→ 200 { items: UnifiedSearchItem[] }    // 已 buildUnifiedItems 合并
→ 400 该平台未实现专辑详情（netease / spotify，实测：album detail not supported on <p>）
→ 404 专辑不存在 —— QQ `code=1101`；Deezer `HTTP 200 + {error:{message:'no data'}}`
                   （⚠️ Deezer 用 200+body 表达 not-found，不是 404，别只看 status）
→ 502 上游故障 / 限流（QQ 非 1101 错误；Deezer 非 "no data" 的 200+error）
```

> 以上 9 个状态码**已用真实 server 逐条 curl 验证**（2026-09-30），非推断。
> 初版把「专辑不存在」做成 400、把 Deezer not-found 做成 500，都是端到端跑出来的
> —— 单测用 mock 全部通过也照样错，因为 mock 的 not-found 形态是照着自己写的。

`GET /music/albums/:provider/:albumId/tracks` **返回已合并的 `UnifiedSearchItem[]`** 而不是
原始 `Track[]`。理由：renderer 的队列播放器本来就吃 `UnifiedSearchItem`（有 `versions[]`
和 `bestSource`），返回原始 track 会让前端再做一次合并，等于把 `buildUnifiedItems` 的
跨脚本合并逻辑复制一份到 renderer —— 违反 CLAUDE.md 的"跨包归一工具禁止两端各写一份"。

### Provider 接口扩展（实现时修正过）

原方案写「往 `packages/common/src/provider.ts` 加两个可选方法」—— **该处无 interface 可扩展**：
那个文件里 `MusicProvider` 是一个字符串 union（`'qq'|'netease'|'deezer'|'spotify'`）+
两个 label 常量。实际实现改为在 `album-types.ts` 定义形状，由 service 层 feature detection：

```ts
export interface AlbumProvider {
  searchAlbums?(session: ProviderSession, keyword: string, count: number): Promise<AlbumSource[]>;
  getAlbumTracks?(session: ProviderSession, albumId: string): Promise<AlbumTrack[]>;
}
```

`AlbumTrack extends Track` 多带 `trackNumber?` / `discNumber?`（Deezer 恒 undefined）。
方法全可选 → 没实现即「缺席」，`albumProviderOf()` 返回 `null`，
`searchAlbumsUnified` 直接跳过该平台，**不进 `errors`**（前端不该为「这个平台没做专辑」弹错误条）。

`AlbumProvider` 用 `bind()` + 显式断言保住泛型 —— `withTimeout<T>` 靠它推断，
否则 `bind` 会把返回类型退化成 `{}`。

### 各 provider 实现要点（已按 Spike 实测更新）

| 平台        | 搜索                            | 曲目                                        | 字段映射要点                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QQ**      | `client_search_cp&t=8` ✅ 6/6   | `fcg_v8_album_info_cp.fcg?albummid=` ✅ 6/6 | 搜索：`albumMID` / `albumName` / `singerName` / `albumPic`(R180，**比单曲封面 R800 小**) / `song_count` / `publicTime`。曲目：`data.list[]` 带 `songmid` / `strMediaMid` / `songname` / `singer[]` / `interval` / `pay` —— 可直接复用现有 `detectQqVipLocked`。**曲序**：`belongCD`(碟号) + `cdIdx`(碟内序)，需自行组装 trackNumber |
| **网易云**  | `cloudsearch/pc&type=10` ✅ 6/6 | ❌ **`/api/album/{id}` 被反爬**             | 搜索：`result.albums[]` 的 `id` / `name` / `size`(=曲目数) / `picUrl` / `publishTime`(ms) / `artists[]`。⚠️ **`artist`(单数) 是空字符串，必须用 `artists[]`(复数)**，取错会导致 artist="" 全部合并成一坨。曲目路径是 `album.songs`（顶层 `j.songs` 为 undefined）                                                                   |
| **Deezer**  | `/search/album` ⚠️ 易限流       | `/album/{id}` ✅ 6/6                        | 搜索：`id` / `title` / `cover_xl`(1000×1000) / `nb_tracks` / `artist.name`（⚠️ **`/search/album` 不给 `release_date`** → year 恒 0）。⚠️ artist 常是**罗马音**（实测叶惠美 → `Jue Wang`），合并靠 `artistAlias` 表桥接。曲目：`tracks.data[]` **无 trackNumber**，只能保序                                                          |
| **Spotify** | ❓ 未验证                       | ❓ 未验证                                   | 需 OAuth token，本机无 token 无法验证。`limit` 上限未知，**不要沿用 track 的 clamp=10**。未实现前该平台在专辑搜索里缺席                                                                                                                                                                                                             |

### 合并逻辑

新文件 `packages/server/src/music/album.util.ts`（与 `search.util.ts` 平级，不要混进去 ——
`search.util.ts` 已经 700+ 行）：

```ts
export function buildUnifiedAlbums(
  all: { album: AlbumSource; platform: MusicProvider }[],
  opts?: { query?: string },
): UnifiedAlbum[];
```

算法：

1. 按 `normalizeKey(albumTitle, albumArtist)` 分组
2. 组内选代表：`PLAY_PRIORITY` 顺序（qq > netease > deezer > spotify）取第一个
3. `coverUrl` = 组内首个非空
4. `trackCount` = 组内**中位数**（偶数取下中位）
5. `year` = 组内**最早非零**
6. `variantMismatch` = `max(trackCount) / min(非零 trackCount) > 1.5` → **不跨平台合并**，
   同平台内各自成卡片并打标
7. 查询相关性排序：打分（名全等 +120 / 前缀 +70 / 包含 +50，艺术家全等 +60 / 包含 +30），
   同分按 `AlbumSource.rank` 升序（与 `unified-search/tasks.md:20` 同思路）

> **为什么不复用 `sortByRelevance`**：`search.util.ts:446` 那版签名绑死 `UnifiedSearchItem`，
> 字段语义是 track（title/artist）。硬套会把"专辑名"当"歌名"打分。抽成泛型要动已上线的
> 搜索排序代码，收益不抵风险。接受这几十行重复，但**两边注释互相标注**"口径必须同步，
> 改一处要改另一处"。

## 风险与权衡（已按 Spike 实测更新）

| 风险                                     | 状态                | 说明                                                                                                                               | 缓解                                                                                                                                                             |
| ---------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **网易云专辑曲目被反爬**                 | 🔴 **已确认阻塞**   | `/api/album/{id}` 返回 `code:-462 "请绑定手机后再试哦~"`。4 变体 × 6 次对照实验证明与 header 无关，是 IP 级反爬。搜索兜底命中 0 首 | 专辑详情**先只支持 QQ + Deezer**。网易云搜索（`type=10`）照做，等有登录态再验详情端点                                                                            |
| **Spotify 整条线未验证**                 | 🔴 **阻塞**         | 本机无 OAuth token，`/v1/search` 无 Authorization 直接 401，album 的 schema / limit 上限 / 分页参数全部未知                        | 先不实现。**不要**照着 track 的 clamp=10 猜一个值写进代码                                                                                                        |
| **Deezer 搜索易触发限流**                | 🟡 已确认           | 压测中 `/search/album` 从 6/6 掉到 0/6，一度 `ECONNRESET`（TLS 层断连）；~40s 冷却后恢复 5/5。同期 `/album/{id}` 始终 6/6          | 限流 ≠ 真空。错误处理要能区分「被限流」和「确实没搜到」，前者应标 error 而不是静默返回空列表（否则用户看到"暂无结果"，正是 `unified-search/tasks.md:19` 那个坑） |
| QQ 专辑端点腐化                          | 🟢 **已排除**       | 原判断 `fcg_v8_*` 需 guid/签名 —— 实测裸 `albummid` 请求 6/6 通过，`songmid`/`strMediaMid`/`pay` 全有                              | 无需缓解。Spike 提前把这条风险消掉了                                                                                                                             |
| 专辑同名误并                             | 🟡 **已确认为刚需** | 搜「叶惠美」QQ=周杰伦 11 首 / 网易云=王珏子乔 18 首(翻唱) / Deezer=`Jue Wang` 19 首。翻唱在搜索结果里排很前                        | `trackCount` 分歧 >50% 直接不跨平台合并 + 打 `variantMismatch` 标。这不是防御性冗余                                                                              |
| Deezer artist 是罗马音                   | 🟡 已确认           | `Jue Wang` vs QQ 的 `周杰伦` vs 网易云翻唱的 `王珏子乔`，三平台 artist 字符串完全不同                                              | 合并键依赖 `artistAlias` 表；跨脚本 artist 走 `artistTransliterationMatch`（`translit.ts` 已有）                                                                 |
| 网易云 `artist` 单数字段为空             | 🟡 已确认           | `album.artist.name === ""`，必须读 `album.artists[]`                                                                               | 映射时显式取复数数组并单测锁住（取错会让所有专辑 artist="" 合并成一坨）                                                                                          |
| `buildUnifiedItems` 在专辑场景表现未验证 | 🟡 待验             | 它按 `normalizeKey(title, artist)` 聚类。专辑内同名曲少，理论安全                                                                  | 端到端验证一张有 live 版的专辑，确认折叠行为合理                                                                                                                 |
| 专辑 tab 拖慢歌曲 tab                    | 🟢                  | 两 tab 共用输入框，切 tab 不 abort 会并发两套请求                                                                                  | 切 tab 时 abort 在途请求（复用现有 AbortController 逻辑）                                                                                                        |
| 前端工作量被低估                         | 🟡                  | 专辑卡片网格 + 详情视图是新 UI，不是加个 tab                                                                                       | Phase 4 单列一条 task；Figma 未定稿前先出**最简列表视图**（复用现有行样式）保证闭环                                                                              |
| 目录膨胀                                 | 🟢                  | 新增 `album-types.ts` + `album.util.ts`                                                                                            | 与 `search.util.ts` 独立成文件，边界清晰，不塞进现有文件                                                                                                         |

## 执行顺序（已按 Spike 结论调整）

```
Phase -1  Spike：四平台端点实测                     ✅ 已完成 2026-09-30
   ↓
Phase 0   类型 + provider 可选方法签名              ← 可以开始
   ↓
Phase 1   searchAlbums × 3（QQ/网易云/Deezer）
          getAlbumTracks × 2（QQ/Deeezer）        ← 网易云详情挂起，Spotify 整条挂起
   ↓
Phase 2   album.util.ts 跨平台合并 + 搜索端点 + 单测
   ↓
Phase 3   专辑曲目合并 + 「播放全部」入队
   ↓
Phase 4   renderer：tab 切换 + 专辑列表 + 详情视图
   ↓
         全量 typecheck / lint / test + 端到端 curl

挂起：网易云 getAlbumTracks（待登录态） · Spotify 全线（待 OAuth token）
```

## 附录：实测响应（Phase -1，2026-09-30 本机匿名环境）

测试关键词：`叶惠美`。压测口径：每端点 6 次，间隔 0.45–0.7s。

### QQ — 专辑搜索 `client_search_cp&t=8`

```jsonc
// GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=叶惠美&t=8&format=json&new_json=1
// Referer: https://y.qq.com/   （无 cookie，匿名）
{
  "code": 0, // 6/6 全部 code=0
  "data": {
    "album": {
      "list": [
        {
          "albumID": 8220,
          "albumMID": "000MkMni19ClKG", // ← 专辑 id 用这个
          "albumName": "叶惠美",
          "albumPic": "http://y.gtimg.cn/music/photo_new/T002R180x180M000000MkMni19ClKG_5.jpg",
          //  ↑ R180，单曲封面用的是 R800
          "publicTime": "2003-07-31", // ← 年份直接可取，无需 parse
          "singerMID": "0025NhlN2yWrP4",
          "singerName": "周杰伦",
          "singer_list": [{ "id": 4558, "mid": "0025NhlN2yWrP4", "name": "周杰伦", "uin": 0 }],
          "song_count": 11, // ← trackCount 直接可取
          "type": 0,
        },
      ],
    },
  },
}
```

### QQ — 专辑曲目 `fcg_v8_album_info_cp.fcg`

```jsonc
// GET https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=000MkMni19ClKG&format=json
// 无 cookie / 无 guid / 无签名   →  6/6 全部 code=0，data.list.length = 11
{
  "code": 0,
  "data": {
    "cur_song_num": 11,
    "list": [
      {
        "songid": 97771,
        "songmid": "001n4C3p1yv0FU", // ← 取流用这个
        "strMediaMid": "002ExFMX2Jt6gv", // ← 高音质 filename 用这个（与单曲 search 一致）
        "songname": "以父之名",
        "albumname": "叶惠美",
        "albummid": "000MkMni19ClKG",
        "singer": [{ "id": 4558, "mid": "0025NhlN2yWrP4", "name": "周杰伦" }],
        "interval": 342, // 秒
        "belongCD": 1, // ← 碟号
        "cdIdx": 0, // ← 碟内序号（0-based）
        "isonly": 0,
        "pay": {
          // ← 可直接喂现有 detectQqVipLocked
          "payalbum": 0,
          "payalbumprice": 0,
          "paydownload": 1,
          "payinfo": 1,
          "payplay": 1, // ⚠️ 叶惠美是免费专辑，这里 payplay=1
          "paytrackmouth": 1,
          "paytrackprice": 200,
          "timefree": 0,
        },
      },
    ],
  },
}
```

> ⚠️ 顺带发现（**不属于本 spec**，但要记一笔）：叶惠美是 2003 年的免费专辑，曲目 `pay.payplay=1`
> 会让 `detectQqVipLocked` 对非绿钻用户判 `vipLocked=true`（`qqVip !== true`）。
> 这正是 `paid-album-detection/spec.md` 风险表里「过度保守：把免费歌也锁了」那条，
> 在专辑曲目路径上同样存在。**本 spec 不动它**，但 Phase 1.7 实现时要确认复用的是同一套判定，
> 不要在专辑路径上另写一份。

### 网易云 — 专辑搜索 `cloudsearch/pc&type=10`

```jsonc
// GET https://music.163.com/api/cloudsearch/pc?s=叶惠美&type=10&offset=0&limit=5
// 6/6 全部 code=200
{
  "code": 200,
  "result": {
    "albums": [
      {
        "id": 372081313,
        "name": "叶惠美",
        "size": 18, // ← trackCount
        "picUrl": "https://p1.music.126.net/vwUBxTBt3BazxX8QllCxlg==/109951173094981144.jpg",
        "publishTime": 1777219200000, // ms epoch
        "artist": { "name": "", "id": 0 }, // ⚠️ 单数字段是空的，不要用
        "artists": [{ "name": "王珏子乔", "id": 0 }], // ← 必须用复数数组
        "songs": [],
        "alias": [],
        "status": 1,
        "copyrightId": 743010,
      },
    ],
  },
}
```

> 注意这条结果本身就是**翻唱专辑**（王珏子乔，18 首），而 QQ 返回的是周杰伦原版（11 首）。
> 同一个关键词，三家给三张不同的专辑。

### 网易云 — 专辑曲目 `/api/album/{id}` ❌ 不可用

```jsonc
// 稳定复现：
{ "code": -462, "message": "请绑定手机后再试哦~" } // body len = 355
```

**对照实验**（4 种 header 变体，各打 6 次，判定 `code===200 && album.songs 非空`）：

| 变体                                            | 成功率 |
| ----------------------------------------------- | ------ |
| A 无 Referer                                    | 2/6    |
| B `Referer: https://music.163.com/`             | 1/6    |
| C `Referer: https://music.163.com/album?id=xxx` | 3/6    |
| D B + `Sec-Fetch-*`                             | 0/6    |

→ **与 header 无关，是 IP 级反爬。** 同窗口内 `cloudsearch` 10/10 正常，说明不是全站封。

**搜索兜底也不成立**：`cloudsearch type=1` 搜「叶惠美 周杰伦」返 14 条，
按 `al.id === 372081313` 过滤命中 **0 首**（该专辑应 11 首）→ 搜索不索引专辑全量曲目。

### Deezer — 专辑搜索 `/search/album`

```jsonc
// GET https://api.deezer.com/search/album?q=叶惠美&limit=5    （匿名）
{
  "total": 2,
  "data": [
    {
      "id": 966922721, // ← 专辑 id
      "title": "叶惠美",
      "cover_xl": "https://cdn-images.dzcdn.net/images/cover/b3ff8890f470dd508b169f1d1c942b6f/1000x1000-000000-80-0-0.jpg",
      "cover_big": ".../500x500-...",
      "md5_image": "b3ff8890f470dd508b169f1d1c942b6f",
      "nb_tracks": 19, // ← trackCount
      "record_type": "album",
      "artist": { "id": 578008, "name": "Jue Wang" }, // ⚠️ 罗马音
      "explicit_lyrics": false,
      // ⚠️ 实测顶层字段就这些 —— **没有 release_date**。它只在 /album/{id}
      //   详情端点有，而为每张卡发一次详情请求换年份是 N+1，不划算。
      //   → Deezer 侧 year 恒 0，合并时 earliestYear 取其他源的年份。
      //   （2026-09-30 修正：本节原写 release_date:"2003-07-28"，
      //     那是推断不是实测，实测该字段不存在。）
    },
  ],
}
```

**limit 上限实测**：`limit=25/50/100` 均返回对应条数、`error=null` → 无 50 上限。
**限流行为**：连续压测后掉到 0/6，一度 `ECONNRESET`（TLS 断连）；~40s 冷却后恢复 5/5。
同期 `/album/{id}` 始终 6/6 → 限流主要打在 `/search/*` 上。

### Deezer — 专辑曲目 `/album/{id}`

```jsonc
// GET https://api.deezer.com/album/966922721   → 6/6 稳定
{
  "title": "叶惠美",
  "nb_tracks": 19,
  "tracks": {
    "data": [
      {
        "id": 3976396981,
        "title": "爱情悬崖",
        "title_short": "爱情悬崖",
        "duration": 229, // 秒
        "rank": 100000,
        "explicit_lyrics": false,
        "preview": "https://cdnt-preview.dzcdn.net/api/.../....mp3?hdnea=...",
        "md5_image": "b3ff8890f470dd508b169f1d1c942b6f",
        "artist": { "id": 578008, "name": "Jue Wang" },
        // ⚠️ 无 trackNumber / discNumber 字段 → 只能保序
      },
    ],
  },
}
```

### Spotify — ❌ 无法验证

```
GET https://api.spotify.com/v1/search?type=album&q=test   （无 Authorization）
→ 401  { "error": { "status": 401 } }
```

本机 `packages/server/.storage/state.json` 里 29 个 session **全部无 `spotifyAccessToken`**，
无法拿到 OAuth token。album 端点的 schema / limit 上限 / 分页参数全部未知。

### 曲序字段横向对比

| 平台    | 有 trackNumber？ | 字段                                                                            |
| ------- | ---------------- | ------------------------------------------------------------------------------- |
| QQ      | 🟡 需组装        | `belongCD`(碟号) + `cdIdx`(碟内序，0-based)                                     |
| 网易云  | ✅               | `songs[].no`（但端点被封，取不到）                                              |
| Deezer  | ❌               | 无，保持 API 返回序                                                             |
| Spotify | ❓               | 未知（`/v1/albums/{id}/tracks` 通常无，需 `/tracks?album` 才有 `track_number`） |

→ 跨平台曲目排序**不可能完全一致**。合并后统一按「可得即用，缺失保序」处理，
不为了对齐而跨平台重排（重排会打乱 Deezer 的原始顺序）。

## UI 实现决策（Phase 4，2026-09-30）

### 为什么是「SearchPanel 持 q + 委托 AlbumResults」而不是提升到 App

原 spec 写「`q` 提到父组件或提升 state」。实际选了更轻的方案：

- `q` **留在 SearchPanel**，新增 `AlbumResults` 独立组件承接全部专辑逻辑
  （自己的 debounce / abort / 分页 / 曲目展开）
- 切 tab 因此**天然不丢关键词** —— 根本不存在状态搬家的窗口期
- 避开 `App.tsx` 改接线（会波及 TheaterView 等其它消费方）
- `SearchPanel` 只多约 40 行壳代码；`AlbumResults` 复用 `sp-*` 类名，样式几乎零新增

代价：`SearchPanel` 现在同时知道两种维度。但它只做「渲染哪个结果区」的判断，
不含任何专辑业务逻辑，可接受。

### 三条实打实踩到的坑（都已加测试锁住）

1. **只分流渲染、没门控 effect** → 在专辑 tab 打字会**同时**打 `searchUnified`。
   两个 tab 共用同一个 `q`，于是多发一路请求，且歌曲 tab 的 loading / 结果状态
   跟专辑 tab 打架。修法：歌曲搜索 effect 开头 `if (tab === 'album') return`。
2. **`hasMore` 恒 false** → 「加载更多专辑」按钮永不渲染。`setHasMore` 一度从未被
   调用（写的时候漏了），是 eslint 的 `no-unused-vars` 把它暴露出来的。
3. **`finally` 里写 `return`** 会吞掉 try 块抛出的异常（`no-unsafe-finally`）。
   改用 `if (!aborted) { ... }` 条件块表达同一意图。

### 专辑 tab 的两个产品决策

- **隐藏 source-toggle**：`/albums/search` 没有 provider 参数，单平台搜专辑体验割裂，
  不如只给统一结果。切回歌曲 tab 会把 `sourceMode` 复位成 ALL。
- **「播放全部」只入队可播曲目**（`filter(isPlayableEntry)`）：把不可播的混进队列
  会导致播放静默失败。全不可播时按钮 `disabled`，旁边提示 N 首当前不可播。

### 颜色

新增样式全部走 `var(--token)`，通过 `scripts/scan-hardcoded-colors.mjs --gate`
（仓库 token 门禁，CI 跑）。专辑角标复用 `--error-*`，强调色复用 `--accent`。

## 附：文档漂移（顺手记一笔，不在本 spec 修）

`CLAUDE.md` 和 `.opencode/skill/spec-implement/SKILL.md` 都写着
「provider 实现 `packages/common/src/provider.ts` 的 `MusicProvider` 接口」，
但**该文件不存在**。真实位置是 `packages/server/src/common/provider.ts`
（`MusicProvider` 是纯 type union + 两个 label 常量，没放 common 的理由）。
本 spec 一律用真实路径。
