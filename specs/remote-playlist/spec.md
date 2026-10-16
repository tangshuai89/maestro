# 远端歌单读取（Remote playlist）

> **状态**：🚧 进行中（网易云 ✅ 列+读 / QQ ✅ 只读 / Deezer ✅ 公开歌单；Spotify 待决策。见 §分平台解锁条件）

## 背景与调研结论

仓库此前**没有任何平台歌单读取能力**：只有 `fetchLiked()` 拉「我喜欢」单曲集合，
以及 `library/playlist.service.ts` 的**纯本地**歌单（NL 生成 / 手动建），两者与平台歌单无关。

2026-10 调研（公开接口实测 + 代码路径核对）结论：

| 平台    | 读单个公开歌单            | 读「我创建的」歌单列表                                                                   | 阻塞点                                                                                                  |
| ------- | ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 网易云  | ✅                        | ✅                                                                                       | 无                                                                                                      |
| QQ      | ✅ **已解锁（只实现读）** | 读指定歌单已实测通过。列目录实测封死（见上），故 QQ 走 `PlaylistReaderProvider` 单边能力 |
| Spotify | ✅                        | ✅                                                                                       | `SPOTIFY_SCOPES` 缺 `playlist-read-private` / `playlist-read-collaborative`（`spotify.provider.ts:43`） |
| Deezer  | ✅                        | ✅                                                                                       | 公开歌单匿名可用；**用户歌单**需 OAuth（`/user/{id}/playlists` 匿名实测 `error.code=800`）              |

实测记录（2026-10-15，公开接口）：

```
GET  api.deezer.com/playlist/{id}                 → 200，完整元数据
GET  api.deezer.com/playlist/{id}/tracks?limit=300 → 200，带 next 游标可翻页
GET  api.deezer.com/user/{id}/playlists          → {"error":{"code":800,"message":"no data"}}
GET  api.spotify.com/v1/playlists/{id}/tracks     → 401（Web API 现已强制 token）
GET  music.163.com/api/user/playlist?uid=1        → 200（匿名可列）
GET  music.163.com/api/v6/playlist/detail?id=1&n=1000
      → trackCount=158，但 n=10/100/500/1000 **全部只回 6 首**（匿名反爬截断）
POST u.y.qq.com music.playlist.PlaylistDir/dir_list（匿名） → code=500003 subcode=860100001
POST u.y.qq.com music.srfDissInfo.DissInfo/CgiGetDiss（匿名） → code=10004 param error
```

> ⚠️ 网易云匿名被反爬截断（只回 6 首），但登录态下 `n=1000` 可拿全 —— `specs/library-import/spec.md`
> 已实证 987 首全量拉回。**网易云歌单必须带 cookie**，仓库 `isConfigured()` 已强制 `session.musicU`，天然满足。

## 核心架构决策：镜像（mirror），不是导入（import）

这是本 spec 最硬的决策，直接决定数据模型。

|          | 导入（import）                                               | **镜像（mirror）← 采用**            |
| -------- | ------------------------------------------------------------ | ----------------------------------- |
| 数据流   | 平台歌单 → `mergeLibrary` 跨平台去重 → `UnifiedSearchItem[]` | 平台歌单 → 原始 `Track[]`，原样返回 |
| 顺序     | 被打散（合并按 fuzzyKey 重排）                               | **保序**                            |
| 跨平台   | 1000 首会被折叠成 600 条唯一曲目                             | 1000 首进、1000 首出                |
| 权限字段 | 合并后 `vipLocked` 可能取错源                                | 每首带自己平台的 privilege          |
| 适用场景 | 「我的喜欢」这种**集合**语义                                 | 歌单是**用户明确排好的列表**语义    |

复用 `UnifiedSearchItem` 会让「用户那个歌单」失真——这是 `cross-platform-match.e2e.test.ts`
（1767 行）在守护的合并语义所固有的。所以**新建 `RemotePlaylist` 类型，与现有 `Playlist` 并存，
绝不复用 `library/playlist.service.ts` 的 `Playlist`**（后者存 `UnifiedSearchItem[]`、
`MAX_TRACKS=500`，且没有平台来源字段）。

## 数据模型

```ts
/** 远端歌单元信息（列表页用，不含曲目）。 */
export interface RemotePlaylistMeta {
  provider: MusicProvider;
  /** 平台内歌单 id（网易云数字 id / QQ disstid / Spotify base62 / Deezer 数字） */
  id: string;
  name: string;
  coverUrl: string;
  /** 平台声明的总曲目数（可能 > 实际返回，QQ 会过滤失效歌曲） */
  trackCount: number;
  /** 私有歌单。网易云 privacy=10，Spotify public=false。 */
  private: boolean;
}

/** 远端歌单详情 = 元信息 + 保序曲目。 */
export interface RemotePlaylist extends RemotePlaylistMeta {
  tracks: Track[];
}
```

**不持久化**：远端歌单按需实时读，不落 `state.json`。理由——平台侧歌单随时变，
缓存必然引入 stale 问题；且与本地 `playlists:{sessionId}` 的语义（用户自己造的）冲突。

## Provider 契约

新增两个**可选**方法（各 provider 按自身能力实现，不强求全平台对齐）：

```ts
interface PlaylistCapableProvider {
  /** 列当前用户的歌单目录。不支持 → 抛 BadRequestException('playlist_unsupported')。 */
  listPlaylists(session: ProviderSession, limit?: number): Promise<RemotePlaylistMeta[]>;
  /** 拉单个歌单的曲目（保序）。 */
  fetchPlaylistTracks(
    session: ProviderSession,
    playlistId: string,
    maxTracks?: number,
  ): Promise<RemotePlaylist>;
}
```

controller / service 用能力探测（`typeof p.listPlaylists === 'function'`），
缺失就返回 `{ provider, supported: false }`，而不是让整个端点 500。

## 接口规格

### 后端

```
GET /music/playlists?provider=netease&limit=50
Response:
  { provider: 'netease', supported: true, items: RemotePlaylistMeta[] }
  { provider: 'qq', supported: false }        // 能力缺失，不 500
Errors:
  400  未知 provider

GET /music/playlists/:provider/:id/tracks?limit=1000
Response:
  { provider, playlist: RemotePlaylist }      // 含 meta + tracks[]
Errors:
  400  未知 provider / 平台不支持 / 未登录
  404  playlist_not_found
```

均套 `withTimeout`（`common/timeout.ts`，单平台 5s），与其他搜索/元数据调用一致。

## 验收标准

- [x] 网易云：已登录 → `GET /music/playlists?provider=netease` 返回用户全部歌单（含封面 / 曲目数 / 私有标记）
- [x] 网易云：`GET /music/playlists/netease/{id}/tracks?limit=1000` 返回该歌单**全部**曲目，**顺序与平台一致**
- [x] 网易云：未登录（无 `musicU`）→ 400 `not_logged_in`，不 500
- [x] 网易云：`{id}` 不存在 → 404 `playlist_not_found`
- [x] 未支持的平台（deezer）→ `{ supported: false }`，不 500
- [x] `fetchLiked` 行为**完全不变**（回归：`netease.provider.test.ts` / `library-import.e2e.test.ts` 全绿）
- [x] 远端歌单**不进** `mergeLibrary` 管线、不落 `state.json`
- [x] 曲目保序：返回顺序 === 平台返回顺序（白盒断言）

## Phase 2 实证：QQ（2026-10-15，登录态实测）

cookie 从本地 `.storage/state.json` 的 session 取（**已验证是有效登录态**：
`CgiGetDiss dirid=201` 回 `code=0` + 正常 songlist。探针脚本放 `/tmp`，不入仓库）。
**结论：QQ 只能做一半。**

| 能力               | 判定              | 证据                                                                                                                               |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 「我喜欢」单曲集   | ✅ 可用（现状）   | `CgiGetDiss disstid=0 dirid=201` → `code=0`，分页正常                                                                              |
| 读**指定**歌单     | ✅ **已验证可用** | `disstid=8584177317`（用户提供的真实歌单「抖音超火：热门歌曲随时听」）→ 227 首全量拉回，分页 `0→100→200→27` 干净收尾，去重 227/227 |
| 列「我的歌单」目录 | ❌ **实测走不通** | 8 个候选全部 `code=500003 subcode=860100001`（见下）                                                                               |

「列目录」候选（全部 `500003 / 860100001`）：

```
music.playlist.PlaylistDir.dir_list      （空参 / 带 uin / GetDirList / get_dir_list）
music.user.FcgUserDissList.diss_list     （老接口，复测确认仍与 library-import 记录一致地报废）
music.user.UserDirInfo.get_user_dir_info
music.musicHall.DissList.GetFeed / GetDissFeed
```

### ⚠️⚠️ 最大的坑：`disstid` 必须传**数字**

传字符串 `"8584177317"` → `code=10004 param error`、`data.songlist` 为空，
**错误信息完全看不出是类型问题**。传数字 `8584177317` → `code=0`、227 首全量。

现有 `fetchLiked` 传的是 `disstid: 0` —— 恰好是数字，所以这个坑在仓库里
一直没暴露。实现时用 `Number(playlistId)` 转换并在发请求前校验
（非数字 / ≤0 / 非整数 → 400 `invalid_playlist_id`，附一句能看懂的 hint）。

> 注意区分：纯数字字符串（`'8584177317'`）**要接受**——用户从
> `y.qq.com/n/ryqq/playlist/8584177317` 复制来的 URL 片段就是这形态，
> 前端不该要求他先手动 parseInt。

### ⚠️ 已排除风控误判：同一时刻、同一 cookie、同一 envelope 打已知可用的

`CgiGetDiss dirid=201` → `code=0`。所以 `500003` 是真实的接口下线，不是限流。
也试过补 `g_tk` 签名 —— cookie 里**没有 `skey`**，`g_tk` 只能算出空串的 `5381`
（仓库 `qq.provider.ts:411` 早知此事），补了也没用。

**影响**：QQ 做不成「列出我所有歌单 → 点进去」，只能做「用户自己提供 disstid → 读出来」。

### 由此逼出的契约变更

`PlaylistCapableProvider` 原本要求 `listPlaylists` + `fetchPlaylistTracks`
**成对实现**、`playlistCapable()` 两者都在才认。按上面的实测结论，QQ 会被整
个判为「不支持」，连它确实能做的读歌单也一起废掉。

→ 已把契约拆成 `PlaylistListerProvider` / `PlaylistReaderProvider` 两个**各自
独立可选**的 interface，service 各自探测、各自降级。这是实测逼出来的设计
修正，不是事后美化。

## Phase 4 实证：Deezer（2026-10-15，匿名实测）

Deezer 公开 API **不需要 OAuth / API key / 登录态**，是四平台里唯一零凭证的。

| 能力           | 判定              | 证据                                                                       |
| -------------- | ----------------- | -------------------------------------------------------------------------- |
| 读**公开**歌单 | ✅ **已验证可用** | `id=6399367984`（Lofi Girl，490 首）→ 翻 2 页取满，去重 490/490            |
| 列「我的歌单」 | ❌ 不做           | `/user/{id}/playlists` 匿名 → `{"error":{"code":800,"message":"no data"}}` |

⚠️ **Deezer 对「歌单不存在」回 HTTP 200**，body 是
`{"error":{"type":"DataException","message":"no data","code":800}}`
—— 不是 404。只看 HTTP status 会把「不存在」误判成「成功但空歌单」。
实现里必须查 body 的 `error` 字段（`fetchPlaylistTracks` 已处理）。

实测要点：

- `limit` 上限 **300**（`limit=500` 会被截），翻页**直接 follow 响应里的 `next` 游标**，
  不要自己算 `index`
- `public: false` 才是私有歌单 → `RemotePlaylistMeta.private`
- 封面 `picture_xl` / `picture_big` / `picture_medium`，按 xl → big → medium 降级
- 歌单容量上限 **5000** 首，provider 默认 `maxTracks=2000`（service 层再 clamp）

**不做** `listPlaylists`：Deezer 匿名没有"用户"概念。歌单靠 URL 里的 id 定位
（`https://www.deezer.com/playlist/1313621735`）。

## 分平台解锁条件（汇总）

| 平台    | 状态                    | 结论                                                                       |
| ------- | ----------------------- | -------------------------------------------------------------------------- |
| 网易云  | ✅ 列目录 + 读歌单      | 零阻塞，链路本来就存在（`fetchLiked` 三步），只把 id 放开                  |
| QQ      | ✅ 只读（给定 disstid） | 列目录实测封死（8 个候选全 `500003`），见 §Phase 2 实证                    |
| Deezer  | ✅ 只读（公开歌单）     | 匿名实测可用；用户歌单需 OAuth，**本 spec 不做**，见 §Phase 4 实证         |
| Spotify | 🟡 **仍待决策**         | 需改 `SPOTIFY_SCOPES` 加 2 个 scope → **所有已登录用户被强制重新授权一次** |

## 不做什么

- ❌ 歌单写入 / 排序 / 删除回平台（只读镜像）
- ❌ 远端歌单持久化 / 离线缓存 / 变更检测
- ❌ 歌单跨平台合并（见 §核心架构决策）
- ❌ 歌单封面 / 描述 / 订阅数等装饰字段的完整映射（Phase 1 只要 封面 / 曲目数 / 私有标记）
- ❌ 前端 UI（Phase 1 只交付后端能力 + 契约，前端另起 spec）
- ❌ Deezer OAuth / Spotify scope 变更（见 §分平台解锁条件，需用户决策）

## 文件改动清单

### 新增

- `packages/server/src/music/playlist.provider.test.ts` — provider 契约白盒测试

### 改动

- `packages/server/src/music/types.ts` — 加 `RemotePlaylistMeta` / `RemotePlaylist`
- `packages/server/src/music/netease.provider.ts` — 加 `listPlaylists` / `fetchPlaylistTracks`
- `packages/server/src/music/music.controller.ts` — 加 2 个 GET 端点
- `packages/server/src/music/music.service.ts` — 加能力探测 + 超时包装

### 不动

- `packages/server/src/library/playlist.service.ts`（本地歌单，语义不同，不复用）
- `fetchLiked()` 各平台实现（回归保证）
- `mergeLibrary` / `UnifiedSearchItem` 管线

## 风险

- **网易云匿名反爬**：不带 cookie 时 `n=1000` 只回 6 首。已由 `isConfigured()` 拦截，不构成线上风险；但**测试环境**必须 mock，不能打真实网络。
- **QQ 歌单目录未知**：这是 QQ 能否解锁的唯一未知项。在实测出结论前不要写 QQ 的 `listPlaylists`——写了也是猜。
- **Spotify 强制重授权**：改 scope 是产品级代价，不该由实现者单方面决定。
- **歌单上限差异**：网易云 / QQ 歌单上限 1000 首、Spotify 10000 首、Deezer 5000 首。Phase 1 统一 `maxTracks` 默认 1000，Deezer/Spotify 解锁时再单独调。

## 相关文档

- `specs/library-import/` — `fetchLiked` 三平台实现与 QQ `CgiGetDiss` 实证记录
- `specs/nl-playlist/` — 本地歌单（NL 生成），语义与本 spec 的远端镜像**不同**
- `specs/cross-platform-likes` — `mergeLibrary` 跨平台合并（本 spec **刻意不走**这条管线）
