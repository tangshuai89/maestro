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
- [x] **单平台 fetchLiked 硬超时**：任一平台 fetchLiked 卡死（`music.163.com` /
      `c.y.qq.com` / `api.spotify.com` 上游挂）不阻塞整个 import——`POST
      /music/library/import` 在单平台 30s 兜底后 resolve（`IMPORT_FETCH_TIMEOUT_MS`
      常量）；该平台 `sources[].error='timeout'`、`count=0`；其余平台照常合并。
      同样兜底覆盖 `getLikedSet`（❤ 检测 / fanOut 走这条路径，单平台 hang
      也会卡用户点 ❤）。
- [x] **mergeCrossScript 性能（导入卡死根因）**：n=987 时 O(n²) 内每对都跑
      artistTransliterationMatch（cn2t/cjkUnify OpenCC 转换 ~0.2ms/次 × 475k 对
      = 实测 95s，即用户看到的「导入卡死」）。修法：① 判定顺序重排为
      时长(±12s) → 标题 → 艺人（AND 条件顺序无关，语义不变，把最贵的
      transliteration 压到最后）；② `translit.ts` memoize
      cn2t/romanizeJaTokens/romanizeVariants；③ `normalizer.ts` memoize
      cjkUnify（server 与 renderer 两端共用）。实测 987 条：95s → ~4s；
      1352 条（QQ 1216 + 网易云 987 合并）~6.6s，合并结果与优化前完全一致
      （cross-script-merge.test 全绿）。
- [x] **QQ fetchLiked 换 CgiGetDiss（2026-08-26）**：旧两步走
      （fcg_user_created_diss 找 dirid=201 → fcg_ucc_getcdinfo_byids_cp）在 QQ
      新登录体系下失效——实测 created_diss 里「我喜欢」不再是 dirid=201
      （返回 1/31~57/205），旧代码恒 `return []`，导入 QQ 恒 0 首。新实现走
      y.qq.com 现网 web 端自己的 `CgiGetDiss`（`music.srfDissInfo.DissInfo`，
      `disstid=0 + dirid=201 + enc_host_uin=<euin>`，euin 从 cookie jar 取），
      一次直达、song_begin/song_num 翻页、hasmore 判末页（QQ 会过滤失效歌曲，
      短页不判末）。实测用户 1216 首全量拉回。
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
- ✅ QQ: 走 y.qq.com 现网 web 端同款 `CgiGetDiss`（u.y.qq.com musicu.fcg，
  `module=music.srfDissInfo.DissInfo`，`disstid=0 + dirid=201 +
  enc_host_uin=<euin>`，euin 从登录窗口捕获的 cookie jar 拿）一次直达「我喜欢」
  歌单，`song_begin`/`song_num` 翻页（每页 1000，上限 2000），`hasmore` 判末页。
  QQ 会过滤失效歌曲（filtered_song），短页不判末、偏移按请求页大小推进。
  2026-08-26 前的老两步走（fcg_user_created_diss 找 dirid=201 →
  fcg_ucc_getcdinfo_byids_cp）已废弃——QQ 新登录体系下「我喜欢」不再是
  dirid=201，恒返回 []（实测用户 1216 首漏导）。
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

## 性能：库打开秒开（≥ 3000 首）

> 用户反馈：3000+ 首库「我的喜欢」打开太卡——重启 app 后首开要等好几秒；同 session 二次打开也要等；滚动卡；点 ❤ 之后 ❤ 计数刷新慢。下面这套覆盖整条链路。

### 验收标准

- [ ] **renderer 端持久化缓存**：库快照从 sessionStorage 升级到 localStorage（带 importedAt 校验），重启 app 后首次打开 modal 走 localStorage 缓存首帧，**视觉上不出现白屏或 skeleton**；后台静默 `getLibrary` 拉新拉到后平滑替换。
- [ ] **renderer 端虚拟滚动**：3000+ 个 group row 只渲染可见 ~30 个；滚动流畅（FPS 不掉）；展开 sublist 的动态高度用 `measureElement` 处理，不破坏虚拟化。
- [ ] **server 端 `getLibrary` 零成本**：3000+ 首库 + 5000 fanOut 条目下，缓存命中时 server 处理 < 1ms（无 fanOut 计算）。fanOut 变更时正确 invalidate 缓存。
- [ ] **server 端增量合并**：fanOut 反向索引只对**受影响的 library item** 算 likedPlatforms，未受影响的 item 直接复用 storage 已存值；不再做 O(I × S × F) 全扫。
- [ ] **renderer `groupLibraryItems` 性能**：二次扫描不再重复调 fuzzyKey（用第一遍的 enriched 复用），3000 items 全过程 < 50ms。
- [ ] **App ❤ 计数秒出**：titlebar ❤ 按钮打开/刷新时，localStorage 缓存立即给数；后台拉新后用真实值覆盖（也走缓存链路）。
- [ ] **失效兜底**：localStorage 写失败（quota / 隐私模式）→ 降级为首次打开 skeleton；读取失败（JSON 损坏 / 旧版格式）→ 同上；`importedAt` 超过 30 天仍走网络拉新（不强求秒开），但不影响后台拉新覆盖。
- [ ] **缓存陈旧可感知**：后台拉新时标题绿色脉动小点 + ❤ 计数平滑过渡；用户感知到「旧→新」的更新。

### 实现

- **renderer `lib/likedCache.ts`**：key 改成 `maestro:liked-library-cache` 写到 localStorage；`readCachedLibrary` / `writeCachedLibrary` / `clearCachedLibrary` 接口不变。quota 失败吞异常降级。
- **renderer `components/modals/LikedLibraryModal.tsx`**：用 `@tanstack/react-virtual` 的 `useVirtualizer` 渲染 group rows；每个 group 是虚拟槽位（含展开 sublist 的总高度）。`expanded` Set 触发 `measureElement` 重测。
- **renderer `lib/groupLibrary.ts`**：把二次扫描里的 `fuzzyKey(anchor...)` / `fuzzyKey(cand...)` 提到循环外；enrich 数组中存 `repTitleKey / repArtistKey` 直接复用。预期 3000 items 下从 ~500ms 降到 < 50ms。
- **server `music.service.ts` `getLibrary`**：加 `libraryCache: Map<sessionId, { result, fanOutKeyCount }>`；cache key 含 fanOut 总条目数 + Object.keys(fanOut).join('|') 的简化 hash（fanOut 变更时引用或长度变了就 invalidate）。命中直接 return；miss 时**反向索引 (platform, trackId) → library item indices 一次构建**，只对**受 fanOut 命中的 item** 重算 likedPlatforms，其它 item 直接用 storage 的值。
- **server `music.service.ts` fanOut mutate 处**：fanOutLike / detectLikedAndSync / dislikeMerged / patchLibraryWithSources / importLiked（清空 fanOut 那步）→ `libraryCache.delete(session.id)`。集中成一个 `private invalidateLibraryCache(sessionId)`，每个 mutate 路径调用。
- **renderer `App.tsx` `reloadLikedCount`**：先 `readCachedLibrary()` → 立即 `setLikedCount(cached.items.length)` → 后台 `getLibrary()` → 拉到后 `setLikedCount(res.items.length)`。

### 不做什么

- 不引 IndexedDB：localStorage 容量（5–10MB）足够 3000+ items 的 JSON（~200–500KB），且接口简单，复杂场景再换。
- 不把 `groupLibraryItems` 移到 web worker：当前优化到 < 50ms 后没必要；进一步优化留待真出现卡顿再说。
- 不持久化 server 端派生 cache 到 state.json：内存缓存够用，重启后冷启动一次 getLibrary 也只是 50ms 级（3000 items + 缓存路径）。
- 不改 `fanOut` 数据结构：保留 `Record<mergedId, FanOutEntry[]>`；只在 getLibrary 端做反向索引。