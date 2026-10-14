# Album 跨平台 fan-out（"收藏专辑"同步）

> 把"我在 QQ 收藏了这张专辑 / 网易云的"收藏专辑""同步到所有"有能力收藏专辑"
> 的平台。和 [`heart-fanout`](../heart-fanout/spec.md) 同构——一个在 track 级、
> 一个在 album 级，**复用同一套 match-engine 的归一键**、同一套"per-platform 调
> 用 + 幂等反写"模式。

## 做什么

- 在统一搜索结果里点 🎁/❤（专辑）→ 把"收藏专辑"同步到所有 **hasAlbumSaveApi=true**
  的平台；再点一次 → 取消全部。
- 专辑级 ❤ 角标按**平台数**显示（"3❤"），与 track 级一致。
- 跨专辑 fan-out 配套提供：
  - 专辑级跨平台等价匹配（`findEquivalentAlbum`）
  - 专辑级合并去重（`mergeAlbumLibrary`）
  - 专辑归一键 `normalizeAlbumKey(album, artist, year?)`

## 为什么需要

1. **Track fan-out 不覆盖整张专辑**：用户在 QQ 收藏一张专辑，想象中其它平台也
   应该收藏；但"我喜欢的歌"只能一颗颗 ❤，专辑粒度的"喜欢"完全靠"打开专辑页
   手动全选 ❤"——容易漏歌、效率差。
2. **平台割裂感最痛**：用户在网易云收藏的 100 张专辑，到 Spotify 看不到"我收
   藏的专辑"清单，必须自己重新翻一遍——这正是聚合器的核心价值没立起来。
3. **AETHER 剧场主界面上线**（PR #56）后，专辑视图会更频繁被用户看到——这个
   时点补专辑 fan-out 体验感最好。

## 与 heart-fanout 的关系

| 维度        | heart-fanout                                    | album-fanout（本 spec）                                                     |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| 操作对象    | 单首 track                                      | 整张专辑（若干 track）                                                      |
| 平台能力    | 4 平台全有 ❤ 写回（QQ 公开 API 弱，NetEase 全） | NetEase ✅ / Spotify ✅；QQ ❌（只有"收藏歌单"无"收藏专辑" API）；Deezer ❌ |
| 归一键      | `normalizeKey(title, artist)`                   | `normalizeAlbumKey(album, artist, year?)`                                   |
| 持久化字段  | `state.fanOut[mergedId]`                        | `state.albumFanOut[mergedAlbumId]`                                          |
| 端点        | `POST /music/like/merged`                       | `POST /music/album/save/merged`                                             |
| detect 触发 | 播放到红心歌时补齐                              | 进入专辑详情 / 收藏专辑时补齐                                               |

**结构相同，参数维度多一个"专辑 vs 歌"**。本 spec 不重新设计 fan-out 模式，
直接 fork 一份；具体复用什么看 §「复用点」。

## 验收标准

### Album 匹配

- [ ] 给定一个 Album，给"在其他平台找等价"的方法（`findEquivalentAlbum`）：
  - 主键 `normalizeAlbumKey(album, artist, year?)`
  - 兜底：track 数 ±1、track 总时长差 ≤ 60s、track 名顺序匹配率 ≥ 70%
  - 失败回退：track 数差 > 2 → 不合并（视为不同版本/Deluxe/Japan 版）
- [ ] 给一批 Album 合并去重为统一库（`mergeAlbumLibrary`）
- [ ] `confidence: 'exact' | 'fuzzy' | 'none'` 同 track 级
- [ ] 匹配结果含 `scores: Partial<Record<MusicProvider, number>>`

### Album fan-out 写回

- [ ] 搜索得到一张专辑 → 点收藏 → 在所有 **hasAlbumSaveApi=true** 的平台收藏
- [ ] NetEase 已登录：网易云那边真的能在「收藏的专辑」列表看到
- [ ] Spotify 已登录 + Premium：Spotify 那边真的能在 "Your Library / Albums" 看到
- [ ] QQ 未登录或 hasAlbumSaveApi=false：跳过该平台，**不本地记录**
      （结构性排除——避免角标虚高 + 假收藏污染，与 Deezer ❤ 处理一致）
- [ ] 再点一次收藏：所有 hasAlbumSaveApi 的平台都取消收藏
- [ ] 单平台专辑：点收藏等同 toggleAlbumSave，不报错
- [ ] 当前正在看的专辑收藏状态显示：已 fan-out 时，🎁/❤ 图标高亮 + 角标
- [ ] `albumFanOut` 状态持久化到 .storage/state.json，重启后保留
- [ ] 播放到专辑里某首 ❤ 歌 → 后台跨平台专辑匹配补齐其余已登录平台；
      匹配成功后把新平台的 source 增量写进「收藏专辑」快照

### 不做（结构性排除）

- [ ] **Deezer 无 per-user album save API** → 跳过（Deezer ❤ 也是这个原因）。
- [ ] **QQ 无 album save API** → 跳过。
- [ ] 不持久化专辑匹配结果——每次按需算。
- [ ] 不依赖 ISRC/UPC——目前拿不到，保留 hook。

## 接口规格

### 后端

```
POST /music/album/save/merged
Request:
  {
    "mergedAlbumId": "merged-album-qq-0039MnYb0qxYhV",
    "sources": [
      {"platform": "qq",      "albumId": "album-xxxx", "title": "范特西", "artist": "周杰伦", "year": 2001},
      {"platform": "netease", "albumId": "12345",      "title": "范特西", "artist": "周杰伦", "year": 2001},
      {"platform": "spotify", "albumId": "abcdef",     "title": "Fantasy", "artist": "Jay Chou", "year": 2001}
    ],
    "saved": true   // false = 取消
  }

Response:
  {
    "success": true,
    "saved": true,
    "fannedOutTo": ["netease", "spotify"]   // 实际写入/清掉的平台（不含结构性跳过）
  }

Error:
  400: sources 为空 / mergedAlbumId 缺失
  500: 持久化失败
```

### 单平台（保持现有行为不变）

```
POST /music/album/save/:albumId?provider=netease
```

仍可用，纯单平台的专辑走这条；统一搜索/专辑视图的 fan-out 走新端点。

## 类型定义（music/types.ts 增量）

```ts
export interface Album {
  id: string; // provider-albumId
  provider: MusicProvider;
  title: string; // 专辑名
  artist: string; // 主艺人（专辑级 collab 不展开）
  year?: number; // 发行年（专辑归一关键字段）
  coverUrl?: string;
  trackCount?: number; // 用于匹配兜底
  totalDuration?: number; // 所有 track duration 之和，用于匹配兜底
}

export interface UnifiedAlbum {
  /** 跨平台合并键 = normalizeAlbumKey(title, artist, year?) */
  mergedAlbumId: string;
  /** 主版本元数据 = versions[0] */
  title: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  trackCount?: number;
  totalDuration?: number;
  /** 各平台版本 */
  versions: Album[];
}

export interface FanOutAlbumSaveRequest {
  mergedAlbumId: string;
  sources: Array<{
    platform: MusicProvider;
    albumId: string;
    title: string;
    artist: string;
    year?: number;
  }>;
  saved: boolean;
}

export interface FanOutAlbumSaveResponse {
  success: boolean;
  saved: boolean;
  fannedOutTo: MusicProvider[];
}
```

## 归一键设计（packages/common/src/normalizer.ts 增量）

```ts
/**
 * 专辑级归一键。复用 track 级 normalizeKey 的流水线（stripFeatTags /
 * stripParensContent / stripTrailingMeta / cjkUnify / 全角→半角 / dash /
 * 智能引号 / 全小写），但输入 = "专辑 + 主艺人"（不带 feat.，专辑通常不写）。
 *
 * year 是关键锚点：周杰伦《范特西》(2001) vs 《范特西 PLUS》(2003) 单凭专辑名
 * 会撞，year 隔开。但 year 在四平台里覆盖不均（Spotify / NetEase 通常有，QQ
 * / Deezer 偶无），所以 year 用作 **加分项**而非 **硬门**：
 *   - 都有 year 且一致 → 强锚
 *   - 都缺 year → 仅靠 album+artist key，Deluxe 版本可能撞 → 由 track 数 +
 *     总时长兜底
 *   - 一有一缺 → 不阻断，仅记入 scores
 */
export function normalizeAlbumKey(album: string, artist: string, year?: number): string {
  const base = normalizeKey(album, artist);
  return year ? `${base}|y${year}` : base;
}
```

**与 `normalizeKey` 的关键边界**：catalog 级 `normalizeKey` 不剥掉括号内版本标签
（保留 `(Deluxe)` / `(Live)` / `(Remix)` 差异），album 级默认也保留，但**额外
允许**把 `(Deluxe Edition)` / `(豪华版)` / `(日本盤)` 这类版本差异剥掉作
display 级（参考 `displayKey`）——catalog 级仍要 `(Deluxe)` 与原版分裂（这是
catalog metadata 故意为之）。

**复用点**：

- ✅ `stripFeatTags` — 专辑名偶有 feat.（"周杰伦 feat. 方文山 合辑"）
- ✅ `stripParensContent` — display 用，剥 `(Deluxe)` 让弹窗合并
- ✅ `stripTrailingMeta` — 专辑尾缀 "(Remastered)" / "(Japan)" / "(初回限定盤)"
- ✅ `stripVersionTags` — 识别 `LIVE` / `ACOUSTIC` / `COVER` 但专辑级一般没这些
- ❌ `stripCjkTranslationSuffix` — 译名通常是"专辑名"，跨平台必须保留，不能剥

## 状态存储（`.storage/state.json` 增量）

```ts
{
  "music:{sessionId}": {
    qq:      { queue, liked, disliked },
    netease: { queue, liked, disliked },
    spotify: { queue, liked, disliked },
    // 已有的
    fanOut: {
      "merged-qq-0039MnYb0qxYhV": ["qq", "netease", "deezer"]
    },
    // 新增
    albumFanOut: {
      "merged-album-qq-album-xxxx": ["netease", "spotify"]
    },
    // 已有的 albumsByPlatform（如果之前已有的话）
    albumsByPlatform?: {
      netease: ["12345", "67890"],
      spotify: ["abcdef"]
    }
  }
}
```

`albumFanOut` 只存"目前被收藏的统一专辑"，及其 fan-out 到的平台集合。切换
`saved=false` 时按这里写的平台去 unsave（保证幂等：只动我们之前保存过的平台）。

## 各平台能力矩阵

| 平台    | hasAlbumSaveApi | 接口                                                                    | 失败兜底                   |
| ------- | --------------- | ----------------------------------------------------------------------- | -------------------------- |
| QQ      | ❌              | —                                                                       | 结构性跳过，**不本地记录** |
| NetEase | ✅              | `/album/sub?alg=ALG&sub=true/false&id=...`（需登录 cookie）             | 失败时 fannedOutTo 不含    |
| Deezer  | ❌              | —                                                                       | 结构性跳过                 |
| Spotify | ✅              | `PUT/DELETE /v1/me/albums?ids=...`（需 Premium，Free 也可加但只播 30s） | 失败时 fannedOutTo 不含    |

> **本 spec 不引入新的能力边界**——能力判定走 `MusicProvider.hasAlbumSaveApi`
> 静态字段，和 `heart-fanout` 的 `hasCopyright` 判定逻辑完全同构。

## 复用点

### 直接复用（不改）

- ✅ **`specs/heart-fanout`** 的 `fanOutLike` 模式 — 改"per-platform 调
  toggleAlbumSave"即可；幂等反写、失败策略、状态持久化结构完全一致。
- ✅ **`specs/match-engine`** 的 MatchService — 加 `findEquivalentAlbum` /
  `mergeAlbumLibrary` 方法，复用 `withTimeout` 5s + try/catch 隔离 + confidence / scores 字段语义。
- ✅ **`packages/common/src/normalizer.ts`** — `normalizeKey` 流水线作
  `normalizeAlbumKey` 的内部实现，**不重新发明** strip 工具。
- ✅ **`search.util.ts`** 的 dedup + buildUnifiedItems — album 级加
  `dedupAlbums + buildUnifiedAlbums`。

### 新增（仅 spec 内命名空间）

- 🆕 `normalizeAlbumKey(album, artist, year?)` 放 `packages/common/src/normalizer.ts`
- 🆕 `MatchService.findEquivalentAlbum(seed)` + `mergeAlbumLibrary(albums)`
  放 `packages/server/src/match/match.service.ts`
- 🆕 `MusicService.fanOutAlbumSave(session, mergedAlbumId, sources, saved)` +
  `toggleAlbumSave(session, provider, albumId, saved)` 放
  `packages/server/src/music/music.service.ts`
- 🆕 `music.controller.ts` 的 `POST /music/album/save/merged` + `POST /music/album/save/:albumId`
- 🆕 `Album` / `UnifiedAlbum` / `FanOutAlbumSaveRequest` / `FanOutAlbumSaveResponse` 类型
  放 `packages/server/src/music/types.ts`
- 🆕 `api.ts` 加 fanOutAlbumSave + toggleAlbumSave 方法
- 🆕 `.storage/state.json` schema 加 `albumFanOut` 字段（兼容旧 state）

## 失败策略

| 场景                                | 行为                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| 单平台 save 失败（NetEase/Spotify） | fannedOutTo 不含该项，整体 success 仍 true                           |
| 平台 hasAlbumSaveApi=false          | 跳过，**不写入 albumFanOut 字段**（结构性排除）                      |
| 平台未登录                          | 跳过，**不写入 albumFanOut 字段**（与 hasAlbumSaveApi=false 同处理） |
| NetEase cookie 失效                 | 401 → 走 heart-fanout 既有"重新登录"提示；本 spec 不重复实现         |
| Spotify Premium 过期 → 写不进去     | 与 heart-fanout 同：返回 200 + fannedOutTo 不含该项 + 静默提示用户   |

## 不做什么

- **不做"专辑详情页"**：专辑 fan-out 的入口仅在搜索结果行的专辑徽章 / 专辑卡片
  （如果未来加）触发；现在不做独立专辑详情页。
- **不做专辑智能推荐**：album fan-out 不触发 DeepSeek（专辑级 AI 推荐是 #8 长期档）。
- **不解决"QQ/Deezer 没有公开 album save API"**：结构性跳过，已在 §「各平台能力
  矩阵」明确。
- **不做专辑统计 / 个人专辑页"收藏时间线"**：先做"跨平台收藏"核心体验，统计
  留后续轮次。

## 技术约束

- 新端点放 `music.controller.ts`；业务逻辑放 `music.service.ts`
- 复用现有 toggleLike 模式做 per-platform 写入（avoid 重复 NetEase/Spotify 同步实现）
- 失败策略：单平台 save 失败不能阻塞其他平台，整体 success 仍为 true，
  fannedOutTo 不含失败项
- 类型定义放 `music/types.ts`
- 归一键放 `packages/common/src/normalizer.ts`，跨 server/renderer 共用
- 匹配逻辑放 `packages/server/src/match/match.service.ts`，独立于 music 模块

## 排期 / 估时

| 阶段     | 内容                                                                            | 估时       |
| -------- | ------------------------------------------------------------------------------- | ---------- |
| 0.5      | 读 match-engine / heart-fanout spec；复核 MusicProvider.hasAlbumSaveApi 实现    | 0.5 天     |
| 1        | `normalizeAlbumKey` + `cjkUnify` 复用 + `normalizer.test.ts` 覆盖专辑场景       | 0.5 天     |
| 2        | `MatchService.findEquivalentAlbum` + `mergeAlbumLibrary` + `match.test.ts` 覆盖 | 1 天       |
| 3        | `MusicService.fanOutAlbumSave` + `toggleAlbumSave` + controller + state 持久化  | 1 天       |
| 4        | `api.ts` + App.tsx 专辑徽章接 fanOutAlbumSave                                   | 0.5 天     |
| 5        | 白盒测试 + e2e + typecheck                                                      | 1 天       |
| **合计** | —                                                                               | **4.5 天** |

**不阻塞**于 #0 EVS / Apple Dev / #5 Settings / #7.4 NL 歌单——可单独排期。

## 验证清单

开工前先 grep `~/Music/` 有无相关历史决策（按 CLAUDE.md「关键术语触发知识库
检索」），避免重复造轮子：

- `rg -i "album fan-out" ~/Music`
- `rg -i "albumsave" ~/Music`
- `rg -i "collect.*album" ~/Music`

沉淀路径（完工后）：

- `~/Music/maestro/album-fanout.md`（设计要点 + 复用决策 + 平台能力矩阵）
- `~/Music/maestro/spotify.md` 增量记 "album save endpoint" 一节
