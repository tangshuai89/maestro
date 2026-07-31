# Liked 导入：把各平台"我的喜欢"合并为统一库

## 做什么

从用户已登录的每个平台拉取"我的喜欢"列表（NetEase "我喜欢的音乐"，
QQ 收藏，Deezer user tracks），合并去重后存到 `.storage/library.json`。
为后续的 P4 DeepSeek 推荐 / 统一库 UI / 跨平台回退提供数据基础。

## 验收标准

- [x] POST /music/library/import 调用后，library.json 写入
- [x] 单平台拉取失败不阻塞——返回里 `sources[].error` 记录
- [x] 跨平台同歌合并：用户在 QQ + 网易云都 ❤ 的同一首歌，在库里出现 1 次，sources 列表里有两条
- [x] duration gate：同歌名但 duration 差 >3 秒视为不同版本（remix/live）
- [x] 库读：GET /music/library 返回最近一次 import 的结果
- [x] 未 import 时 GET /music/library → 404 `library_not_imported`
- [x] 重新 import → 覆盖原结果（不是 merge）
- [x] QQ: 已登录用户 import 后 `sources[qq].count > 0`（前提：cookie 有效且有 ≥1 首收藏）
- [x] QQ: 未登录（`qqCookie` 缺失）时 `sources[qq].error === 'not_logged_in'`，不阻塞其他平台
- [x] QQ: cookie 失效（favorites endpoint 返回 `code === 1000`）→ `sources[qq].error` 反映登录失效，不抛 500
- [ ] 弹窗 UX：见下方「UI / 体验（LikedLibraryModal）」节

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

## UI / 体验（LikedLibraryModal）

本轮把「不做 UI 集成」补上。`packages/renderer/src/components/modals/LikedLibraryModal.tsx`
是这一组需求的承载点。

### 验收标准

- [ ] 第二次及以后打开弹窗：先从 sessionStorage 读上次拿到的库，**首帧即渲染列表**，随后后台静默刷新（stale-while-revalidate）。视觉上不出现「加载中…」白屏。
- [ ] 后台拉新时标题右侧有一颗绿色脉动小点指示「正在同步」——避免 sessionStorage 里的旧数据被误认作当前真值（典型场景：上次关闭弹窗前 fanOut 还没补齐，下次打开看到的是落后一拍的角标）。
- [ ] 关闭弹窗**不取消**后台 getLibrary 请求；fetch resolve 时无论 modal 是否还挂载都写入 sessionStorage，保证下一次打开首帧就是最新数据（修「上一首歌刚 fan-out 完但 library 还显示老 badge」）。
- [ ] **fanOut key 与 library item.id 不一致 + library 只有 1 个 source 时**，badge 仍能反映完整 ❤ 平台列表。二层兜底：① getLibrary 的 (platform, trackId) → fanOut key 反向索引取整组；② `healLibraryItem` 异步后台用 `searchEquivalent` 的 4-tier 匹配（normalizeKey / 双向 includes / 跨脚本 / JW fuzzy）搜索补全缺失平台，写入 fanOut + 增量 patch library 的 sources。修「Lefty Hand Cream 翻唱歌曲三个平台都 ❤ 但弹窗只显示云」。
- [ ] 第一次打开（无 sessionStorage 缓存）：渲染 6 个 skeleton 行占位（封面方块 + 两行灰条），保持和真实行等高，避免布局抖动。
- [ ] 后台静默刷新失败：保留旧数据，不弹错误（用户继续看的就是上次的库，新拉失败不打扰）。
- [ ] sessionStorage 写入失败（隐私模式 / 配额）：降级到「首次打开」路径——只展示 skeleton，正常走网络。**不抛错**。
- [ ] 「重新导入」点击后：列表整体变暗（半透明遮罩 + 模糊），正中显示 ❤ 心形脉动 spinner + 「正在从 QQ / 网易云 / Spotify 重新导入…」。底部按钮文案换为「重新导入中…」并禁用。
- [ ] 「重新导入」中顶部有一条渐变条从左到右循环滚动（YouTube Music 风格的「正在同步」条）。
- [ ] 重新导入完成：遮罩渐隐 200ms，列表回到正常亮度；如果新数据项数变了，头部计数也平滑切换。
- [ ] 空态点「现在导入」：保留原空态文案与按钮，按钮内嵌一个旋转 spinner，文字换成「导入中…」。
- [ ] 关闭弹窗时不取消正在进行的「重新导入」请求（让后台继续跑完，下次打开自动拿到新数据）。导入完通过 `likedVersion` signal 通知 App 顶部 ❤ 角标刷新。