# 跨平台统一搜索

## 做什么

用户在搜索框输入一个关键词（歌名/歌手/专辑），系统同时去网易云、QQ 音乐、Deezer 三个平台搜索，合并去重后统一展示结果。用户点播放时，自动选有版权的平台。

## 验收标准

- [ ] 输入"周杰伦" → 三个平台各返回搜索结果，合并展示（去重按 ISRC 或"歌名+歌手"）
- [ ] 同一首歌在多个平台都有 → 合并成一条，展开可看到各平台的版本
- [ ] 搜索结果中每条显示: 歌名、歌手、专辑、时长、平台标签、是否有版权
- [ ] 点击播放 → 自动选有版权的平台，如果多个平台有版权，优先 QQ > 网易云 > Deezer
- [ ] 如果所有平台都无版权 → 显示灰色不可播放状态
- [ ] 输入为空时不发起搜索
- [ ] 输入过程中 debounce 300ms
- [ ] 搜索结果分页，每页 20 条
- [ ] 搜索 3 秒无结果 → 显示"暂无结果"

## 接口规格

### NestJS 后端

```
GET /api/search?q=<关键词>&page=1&pageSize=20

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
      "bestSource": "netease"       // 推荐播放平台
    }
  ]
}

Error:
  400: q 参数无效
  502: 某个上游平台挂了（部分结果仍然返回，失败的平台标记为 unavailable）
```

### 去重规则

1. 优先按 ISRC（国际标准录音编码）去重
2. 无 ISRC 时，用"歌名 + 歌手"标准化后匹配: 全角转半角、去空格、去标点、全小写

### 播放优先级

`qq > netease > deezer`，且必须 `hasCopyright = true`。

IPC 通道: `search:execute`(renderer → main → server) / `search:result`(server → main → renderer)

## 不做什么(Out of Scope)

- 不支持 Spotify 搜索（Spotify 的搜索/播放/红心单独做，这次不碰）
- 不做搜索建议/自动补全（二期）
- 不做搜索历史记录（二期）
- 不做歌词搜索

## 技术约束(来自 CLAUDE.md)

- 所有外部 API 调用走 `axios`，带 5 秒超时
- provider 接口叫 `MusicProvider`，每个平台实现 `search(query, page, pageSize): SearchResult[]`
- 去重逻辑放 `music.service.ts` 里，不要在 controller 里做
- 类型定义放 `music/types.ts`
