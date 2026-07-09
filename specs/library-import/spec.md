# Liked 导入：把各平台"我的喜欢"合并为统一库

## 做什么

从用户已登录的每个平台拉取"我的喜欢"列表（NetEase "我喜欢的音乐"，
QQ 收藏，Deezer user tracks），合并去重后存到 `.storage/library.json`。
为后续的 P4 DeepSeek 推荐 / 统一库 UI / 跨平台回退提供数据基础。

## 验收标准

- [ ] POST /music/library/import 调用后，library.json 写入
- [ ] 单平台拉取失败不阻塞——返回里 `sources[].error` 记录
- [ ] 跨平台同歌合并：用户在 QQ + 网易云都 ❤ 的同一首歌，在库里出现 1 次，sources 列表里有两条
- [ ] duration gate：同歌名但 duration 差 >3 秒视为不同版本（remix/live）
- [ ] 库读：GET /music/library 返回最近一次 import 的结果
- [ ] 未 import 时 GET /music/library → 404 `library_not_imported`
- [ ] 重新 import → 覆盖原结果（不是 merge）
- [ ] QQ: 已登录用户 import 后 `sources[qq].count > 0`（前提：cookie 有效且有 ≥1 首收藏）
- [ ] QQ: 未登录（`qqCookie` 缺失）时 `sources[qq].error === 'not_logged_in'`，不阻塞其他平台
- [ ] QQ: cookie 失效（favorites endpoint 返回 `code === 1000`）→ `sources[qq].error` 反映登录失效，不抛 500

## 接口规格

### POST /music/library/import

触发导入。无 request body。返回：

```ts
{
  items: UnifiedSearchItem[];            // 去重后的统一库
  sources: Array<{
    provider: 'qq' | 'netease' | 'deezer';
    count: number;                        // 拉取成功数
    error?: string;                       // 'not_logged_in' / 'qq_favorites_fetch_failed' / 等
  }>;
  importedAt: number;                     // ms timestamp
}
```

### GET /music/library

返回最近一次 import 的同 shape 数据，404 `library_not_imported` 当未 import。

## 实现范围（v1）

- ✅ NetEase: `fetchLiked` 走 `/api/nuser/account/get` → `/api/user/playlist` →
  `/api/v6/playlist/detail` 三步拉取"我喜欢的音乐"歌单
- ✅ QQ: 走 `c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=<uin>`
  拿用户创建的歌单列表，find `dirid===201`（"我喜欢" 魔法值）拿其 `tid`
  → `c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?disstid=<tid>`
  拿歌曲列表（老接口，扁平字段 songmid/songname/albummid/interval/strMediaMid）；
  硬上限 1000 首（song_num 精确分页）。g_tk 用字面 `'5381'`（cookie 才是真鉴权）。
  ⚠️ 注意：`fcg_musiclist_getmyfav` 返回的是 songid 收藏位图，不是歌单，
  不能用来拿"我喜欢"的 dissid。
- ❌ Deezer: 匿名模式无 user 概念；返回 `error: 'deezer_anonymous_no_user_likes'`
- ✅ 跨平台合并：复用 P3 的 MatchService.mergeLibrary

## 持久化

`.storage/state.json` 里 session 下新增键 `library:{sessionId}`，以及 QQ session
的 `qqCookies: Record<string,string>`（Electron 登录窗口解析后的完整 cookie
map，用于按名取 skey / qqmusic_key 等）。老 session 没这个字段也能用，
favorites 接口在 `qqCookies` 缺失时直接用字面 `g_tk=5381`。

```ts
{
  importedAt: number;
  items: UnifiedSearchItem[];
  sources: Array<{provider, count, error?}>;
}
```

## 不做什么

- 不做"增量同步"——每次 import 是全量覆盖
- 不做"导入后自动 ❤ 到其他平台"——用户可以手动点 fan-out ❤（P1 路径）
- 不做 UI 集成——本轮只做后端 + endpoint，UI 是下一轮
