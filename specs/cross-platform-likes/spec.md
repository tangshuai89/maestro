# 跨平台 ❤ 累加（cross-platform like total）

## 做什么

HUD 右上的 `♥ {数字}` 改为"当前播放曲目在四个平台被收藏的总数"。

数据可得性经实测（见末尾"接口核实"）：
- **QQ**：✅ 公开匿名可拉 `music.musicasset.SongFavRead / GetSongFansNumberById` → `m_numbers` + `m_show`
- **网易云**：✅ 公开匿名可拉 `/api/song/detail?ids=` → `likedCount`
- **Deezer**：❌ 无 ❤ 字段（只有 `rank` 热度）
- **Spotify**：❌ 无 ❤ 字段（只有 `popularity` 0-100）

实际累加只有 2 个（QQ + 网易云），其他平台 N/A。

## 验收标准

- [ ] 切到一首 QQ/网易云都有 source 的歌 → HUD `♥` 后显示 `QQ 数字¹ + 网易云 数字²`，加号紧凑相连
- [ ] 只有 QQ source 有数 → HUD `♥ 5700w+¹`（¹ = QQ）
- [ ] 只有网易云 source 有数 → HUD `♥ 1,173²`（² = 网易云）
- [ ] QQ/网易云都没数（如 QQ hasCopyright=false 或 Deezer/Spotify 独占） → HUD `♥ —`
- [ ] 切歌瞬间 HUD 显示 `…`（last-good cached + spinner）→ 拉到真实数后平滑替换
- [ ] 拉取 5s 超时 → 不阻塞 search 结果，source.likeCount 留 `undefined`，HUD 按"无该平台数"渲染
- [ ] 库 import 时同样填充 likeCount（import 完成后 library 弹窗里能看到）
- [ ] `likedCount`（titlebar ❤ 徽章 / "999+" 截断 / LikedLibraryModal）行为不变——独立字段
- [ ] `fanOutCount`（HUD fallback `${N}/4`，0~4 平台数）行为不变——独立字段

## UI 样式（D.1：紧凑加号 + 上标）

```
  HUD 右上的 ❤ 计数：

  ♥ 5700w+¹+²    ← QQ + 网易云 都有数（m_show 显示）
  ♥ 1,000,001¹+2,500²   ← 都用精确数（小数字时）
  ♥ 5700w+¹      ← 仅 QQ
  ♥ 1,173²       ← 仅网易云
  ♥ …            ← 切歌过渡态（last-good + spinner）
  ♥ —            ← 都没有数
```

上标 `¹` / `²`：
- 鼠标悬停 tooltip 解释"¹ = QQ" / "² = 网易云"（防用户疑惑）
- 用 `Unicode superscript` 字符（`\u00B9` `\u00B2`），避免 markdown-style 误读

## 数据模型

### SourceInfo 新增字段

```ts
interface SourceInfo {
  // ... 既有
  /**
   * 歌曲在该平台被收藏/喜欢的总数。**只** QQ + 网易云填；Deezer/Spotify 留
   * undefined（这两家平台不暴露这个字段）。undefined = 未知/未拉到。
   * QQ 内部用 m_show（"5700w+"）做 UI 显示、m_numbers（精确数）做累加。
   */
  likeCount?: {
    /** 精确数字（QQ 来自 m_numbers；网易云来自 likedCount） */
    count: number;
    /** UI 显示字符串（QQ 来自 m_show；网易云 = count.toLocaleString()） */
    display: string;
    /** 平台名（debug / tooltip 用） */
    source: 'qq' | 'netease';
  };
}
```

### UnifiedSearchItem 新增派生字段

```ts
interface UnifiedSearchItem {
  // ... 既有
  /**
   * 跨平台 ❤ 累加 = Σ source.likeCount.count（只算 likeable 平台）。
   * 派生字段，不持久化——每次 buildUnifiedItems / getLibrary 时现算。
   * undefined = 全部 source 都没 likeCount（避免和"0"混淆）。
   */
  crossPlatformLikeTotal?: {
    count: number;
    display: string;
    /** 累加来源平台列表（顺序 = sources 顺序），用于上标渲染 */
    platforms: Array<'qq' | 'netease'>;
  };
}
```

## 接口规格

### QQ

```
POST https://u.y.qq.com/cgi-bin/musicu.fcg
{
  "result": {
    "module": "music.musicasset.SongFavRead",
    "method": "GetSongFansNumberById",
    "param": { "v_songId": [97773] }
  }
}

Response (code 200):
{
  "code": 0,
  "result": {
    "code": 0,
    "data": {
      "m_numbers": { "97773": 1000001 },
      "m_show":     { "97773": "5700w+" }
    }
  }
}
```

- 参数是**数字 songId**（不是 mid）。queue 里存的是 songmid → 需要先用 `resolveSongId(songmid)` 转一次。
- 公开明文，不需要 QQ cookie / 加密通道
- 失败 → `null`；超时（5s）→ `null`

### 网易云

```
GET https://music.163.com/api/song/detail?ids=[123456]
→ songs[0].likedCount
```

- 公开匿名
- 失败 / 超时（5s） → `null`

### 后端 service 新方法

```ts
// qq.provider.ts
async getTrackFavCount(
  session: ProviderSession,
  songmid: string,  // 接受 mid，内部 resolveSongId
): Promise<{ count: number; display: string } | null>;

// netease.provider.ts
async getTrackLikeCount(
  session: ProviderSession,
  songId: string,
): Promise<{ count: number; display: string } | null>;
```

## 缓存策略

| 场景 | TTL | key |
|---|---|---|
| 命中 / 干净缺席（5000）| 1h | `(sessionId, platform, songId)` |
| 失败 / 超时（>5000ms）| 30s | 同上 |

复用 `equivSearchCache` 已有模式（5min TTL 改为上面两档；30s / 1h）。
不引新缓存基础设施——直接挂 `equivSearchCache` 同名 Map，**复用** `clean` 字段语义。

## 异步填充

- `buildUnifiedItems` 返回后**不阻塞**主结果，对每个有 QQ/网易云 source 的 item **fire-and-forget** 调 `getTrackFavCount` / `getTrackLikeCount`
- 并发上限 4（与 `runPlatformSearch` 同源）
- 拉完后用 `mutate-and-broadcast`（已有 `libraryCache` 同模式）：脏 item 写回 + 推 `UnifiedSearchItem[]` 给前端
- 前端在收到 mut 后**只在 HUD 显示**，不重排结果（切歌时正常被 `next.liked` / `setFanOutCount` 路径覆盖）

## 不做什么

- **不**在 import 时持久化 likeCount 进 `library.json`（派生即可，避免多份真值漂移）
- **不动** `likedCount`（库总歌数）/ `fanOutCount`（0~4 平台数）这两个独立字段
- **不**做 Spotify popularity / Deezer rank 的近似 ❤ 数（语义造假）
- 不动 Titlebar 的 ❤ 徽章显示
- 不动 LikedLibraryModal 的内层 UI

## 接口核实（铁证）

```bash
# 1) QQ 公开搜索接口——完整字段已 dump，没有 fav 字段
curl 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=晴天&n=1&format=json&new_json=1'
# track_info keys: mid, name, singer, album, file, pay, mv, ksong, interval, action, fnote, ...
# 无 collect_count / like_count / popularity

# 2) QQ 公开详情接口——404
curl 'https://c.y.qq.com/song/fcgi-bin/song_detail_v2.fcg?songmid=0039MnYb0qxYhV'
# 404

# 3) QQ 加密 musicu——get_song_detail 能通但无 fav 字段；猜的 16 个 module 全 500003
# 全字段：mid, name, singer, album, file, pay, mv, ksong, interval, action(位掩码),
#         volume(响度), vi, vf, vs, data.info(staff credits), data.extras(wiki)
# 无 collect_count / like_count

# 4) QQ 加密 musicu 猜的 fav module 全失败（500003 / 500005）

# 5) 真实可拿：wonderabc/python-qq-music-api 公开的
POST https://u.y.qq.com/cgi-bin/musicu.fcg
{ "result": { "module": "music.musicasset.SongFavRead",
              "method":  "GetSongFansNumberById",
              "param":   { "v_songId": [97773] } } }
→ { "result": { "data": { "m_numbers": { "97773": 1000001 },
                          "m_show":    { "97773": "5700w+" } } } }
```

## 技术约束

- QQ `getTrackFavCount` 套 `withTimeout(5s)`（CLAUDE.md 硬约束）
- 并发控制：参考 `runPlatformSearch` 的 `Promise.allSettled + withTimeout` 模式
- `resolveSongId` 已存在（`qq.provider.ts:432-471`），**直接复用**——不重新写 mid→id 逻辑
- 缓存清理走 `pruneEquivSearchCache()` 已有路径

## 文件改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/server/src/music/qq.provider.ts` | 新增 `getTrackFavCount()` |
| 2 | `packages/server/src/music/netease.provider.ts` | 新增 `getTrackLikeCount()` |
| 3 | `packages/server/src/music/types.ts` `SourceInfo` | 加 `likeCount?` 字段 |
| 4 | `packages/server/src/music/types.ts` `UnifiedSearchItem` | 加 `crossPlatformLikeTotal?` 派生字段 |
| 5 | `packages/server/src/music/search.util.ts` `buildUnifiedItems` | 不变结构；新增可选 `likeCountResolver: (platform, trackId) => Promise<...>` 注入点；具体调用放 `music.service.ts` |
| 6 | `packages/server/src/music/music.service.ts` | `searchUnified` 异步填充 likeCount；`importLiked` / `patchLibraryWithSources` 同样 |
| 7 | `packages/renderer/src/components/views/TheaterView.tsx` HUD L286 | 改读 `track.crossPlatformLikeTotal`；D.1 样式 |
| 8 | `packages/renderer/src/App.tsx` | 派发 `crossPlatformLikeTotal` mutation（与现有 fanOutCount 轮询同链路） |
| 9 | 测试 | e2e |
| 10 | 清理 | `packages/server/src/music/_qq-fav-test.ts` |
