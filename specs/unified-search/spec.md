# 跨平台统一搜索

## 做什么

用户在搜索框输入一个关键词（歌名/歌手/专辑），系统同时去网易云、QQ 音乐、Deezer 三个平台搜索，合并去重后统一展示结果。用户点播放时，自动选有版权的平台。

## 验收标准

- [x] 输入"周杰伦" → 三个平台各返回搜索结果，合并展示（去重按"歌名+歌手"标准化键）
- [x] 同一首歌在多个平台都有 → 合并成一条，展开可看到各平台的版本
- [x] 搜索结果中每条显示: 歌名、歌手、专辑、时长、平台标签、是否有版权
- [x] 点击播放 → 自动选有版权的平台，VIP 锁源被规避（Free 用户避开付费歌，落到可全曲播放的源）
- [x] 如果所有平台都无版权 → 显示灰色不可播放状态
- [x] 输入为空时不发起搜索
- [x] 输入过程中 debounce 300ms
- [x] 搜索结果分页，每页 20 条
- [x] 搜索 3 秒无结果 → 显示"暂无结果"
- [x] 单平台 search throw → 不阻塞其他平台，返回 200 + 失败的平台标记为 unavailable

## 接口规格

### NestJS 后端

```
GET /music/search?q=<关键词>&page=1&pageSize=20

Request:
  q: string (必填, 1-100 字符)
  page: number (选填, 默认 1)
  pageSize: number (选填, 默认 20, 最大 50)

Response:
{
  "q": "周杰伦",
  "total": 47,
  "page": 1,
  "pageSize": 20,
  "items": [
    {
      "id": "merged-xxx",           // 去重后统一 ID
      "title": "晴天",
      "artist": "周杰伦",
      "album": "叶惠美",
      "duration": 269,
      "sources": [                  // 各平台版本
        {"platform": "netease", "trackId": "xxx", "hasCopyright": true, "url": "..."},
        {"platform": "qq",      "trackId": "yyy", "hasCopyright": true, "url": "..."},
        {"platform": "deezer",  "trackId": "zzz", "hasCopyright": false}
      ],
      "bestSource": "netease",      // 推荐播放平台（已规避 vipLocked）
      "versions": [                 // 同 (key, type) 内的录音版本，每个 cluster 一条
        {
          "id": "ver-...",
          "duration": 269,
          "sources": [...],
          "bestSource": "netease",
          // 版本级原始元数据（cluster 内 PLAY_PRIORITY 代表 track）：
          // 展开多版本时逐行显示，用户靠它选版本（同名不代表同专辑/同时长）
          "title": "晴天",
          "artist": "周杰伦",
          "album": "叶惠美",
          "coverUrl": "..."
        }
      ]
    }
  ]
}

Error:
  400: q 参数无效
  注：单平台失败 → 200 + sources[].error；不会 502（partial results 设计）。
```

### 去重规则（Phase 1：versionType 分类 + 同 type 合并）

1. 主键：normalizeKey(title, artist)（全角→半角、去空格、去标点、全小写；CJK 跨写法归一）
2. **versionType 分类**（按 title + album 关键字匹配，优先级 live > acoustic > remix > instrumental > studio）：
   - `live`：含 `live` / `现场` / `演唱会` / `实况` / `concert` / `live版`
   - `acoustic`：含 `acoustic` / `不插电` / `原声` / `unplugged`
   - `remix`：含 `remix` / `混音` / `extended` / `remaster`
   - `instrumental`：含 `instrumental` / `纯音乐` / `伴奏` / `karaoke`
   - `studio`：默认（专辑原版）
3. **同 normalizeKey + 同 versionType** 才合并为一个 UnifiedSearchItem；不同 type 分开成多条。
4. 同 type 内 clusterByDuration 容差 3s（同 type 不同录音 master 容差，album vs remix 各自成 cluster）。
5. cluster 内同 platform 多 mid 去重（保留第一个；QQ 高品质 + QQ 标准合并为一个 source）。
6. ISRC：未接入（接口没暴露），保留 hook 待将来扩展。

### UI 展示规则（Phase 1）

- 每条 UnifiedSearchItem 标题后显示 versionType 角标：`[LIVE]` / `[ACOUSTIC]` / `[REMIX]` / `[INSTRUMENTAL]`（`studio` 不显示）。
- 多版本 item 行尾显示「N 个版本 ▾」展开按钮（行尾**唯一**的箭头；播放三角在封面
  hover 遮罩上，避免被当成展开箭头误点）。
- 展开后的版本行显示该版本的**真实元数据**：歌名 / 歌手 · 专辑 · 时长 + 平台 chip。
  不允许只显示 `v2 / 2:35` 这类序号 —— 用户无从判断选哪个。
- 点击版本行播放时，队列里的 item 元数据（title/artist/album/coverUrl）也换成该版本，
  播放器展示的必须是用户实际选中的版本。

### 播放优先级

`qq > netease > deezer`（基础优先级），但 `bestSource` 进一步规避 vipLocked=true 的源——
Free 用户不会被分配到仅 VIP 可播的源（见 search.util.selectBestSource）。

## 不做什么(Out of Scope)

- ~~不支持 Spotify 搜索~~ → 已支持（v2 起）。`MUSIC_PROVIDERS` 含 spotify，统一搜索一并 fan-out；
  token 缺失的 session 只跳过 spotify，其他平台不受影响。
- 不做搜索建议/自动补全（二期）
- 不做搜索历史记录（二期）
- 不做歌词搜索（走 lyrics 模块）

## 技术约束(来自 CLAUDE.md)

- 外部 API 调用走**内置 fetch**（不是 axios），单平台 5s 超时（`common/timeout.ts: withTimeout`）
- provider 接口叫 `MusicProvider`，每个平台实现 `search(query, page, pageSize): SearchResult[]`
- 去重逻辑放 `music.service.ts` 里，不要在 controller 里做
- 类型定义放 `music/types.ts`（Track 已在 P7 audit 后挪到此文件）
