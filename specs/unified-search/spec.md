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
      "bestSource": "netease"       // 推荐播放平台（已规避 vipLocked）
    }
  ]
}

Error:
  400: q 参数无效
  注：单平台失败 → 200 + sources[].error；不会 502（partial results 设计）。
```

### 去重规则

1. 主键：normalizeKey(title, artist)（全角→半角、去空格、去标点、全小写；CJK 跨写法归一）
2. duration gate：同 normalizeKey 但 duration 差 >3s → 不合并（remix/live）
3. ISRC：未接入（接口没暴露），保留 hook 待将来扩展

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
