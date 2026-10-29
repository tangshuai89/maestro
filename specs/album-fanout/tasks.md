# Album fan-out — 任务清单

> 配 [`spec.md`](./spec.md)。每完成一项勾一条；开工前先读 spec 的「验收标准」
> 段确认 scope 没漂。
>
> ⚠️ **2026-10-20 实施记录（重要）**：本清单写于 `specs/album-search` 落地
> **之前**，其中 6 条任务的前提已被后续代码推翻。实施时**以代码现状为准**，
> 被推翻的条目标注为「已由 album-search 覆盖 / 前提已变」并说明原因，
> 详见文末「与 spec 的偏差记录」。spec.md 正文同步修订。

## 0. 准备

- [x] 0.1 grep `~/Music/` 有无 album fan-out / collect album / album save 历史决策
      —— `~/Music` 只有 `QQ音乐/`（本地音乐目录），无相关决策；`~/knowledge`
      全文检索 `album fan-out` / `收藏专辑` 零命中
- [x] 0.2 复核 `MusicProvider.hasAlbumSaveApi` 是否已就位
      —— ❌ **前提已变**：`packages/server/src/common/provider.ts` 里
      `MusicProvider` 是**字符串 union**（`'qq'|'netease'|…`），**没有 interface
      可以扩展**。改为在 `album-types.ts` 新增可选方法接口
      `AlbumSaveProvider`（照 album-search 的 `AlbumProvider` 同构）+ feature
      detection 判定能力
- [x] 0.3 读 `specs/heart-fanout/spec.md` + `specs/match-engine/spec.md` 复习复用模式

## 1. 归一键（packages/common/src/normalizer.ts 增量）

- [x] 1.1 ~~加 `normalizeAlbumKey(album, artist, year?)`~~ → ❌ **取消**
      （前提已变）：专辑归一已由 `album.util.ts` 的 `buildUnifiedAlbums` 用
      `normalizeKey(title, artist)` 实现并**已上线**（album-search）。再新建
      一个 `normalizeAlbumKey` = 两套归一口径，必然漂移（CLAUDE.md 明令禁止）。
      专辑级年份锚点改为在**定向等价查找**里做冲突守卫（见 2.5）
- [x] 1.2 ~~加 `normalizer.test.ts` 覆盖专辑场景~~ → ❌ **取消**（同上；
      专辑归一的覆盖在 `album.util.test.ts` 里）

## 2. 跨平台专辑匹配（packages/server/src/match/match.service.ts 增量）

- [x] 2.1 ~~加 `findEquivalentAlbum(seed: Album)`~~ → ❌ **取消**（前提已变）：
      跨平台专辑合并已在 `album.util.ts` 落地（`buildUnifiedAlbums` +
      `albumsProbablySame` + variantMismatch 守卫）。真正缺的是「去**某个平台**
      定向找等价专辑」→ 见 2.5
- [x] 2.2 ~~加 `mergeAlbumLibrary(albums: Album[])`~~ → ❌ **取消**（同上，
      `buildUnifiedAlbums` 已是它）
- [x] 2.3 ~~加 `search.util.ts` 的 album dedup + build~~ → ❌ **取消**（同上；
      且 album-search 刻意把专辑合并独立成 `album.util.ts`，不塞进
      `search.util.ts`）
- [x] 2.4 ~~`match.test.ts` 覆盖专辑场景~~ → ❌ **取消**（同上；覆盖在
      `album.util.test.ts`）
- [x] 2.5 🆕 `findAlbumEquivalentOnPlatform(session, platform, title, artist, year?)`
      —— 去目标平台 `searchAlbums` → 用 `albumsProbablySame` 判等价 +
      **year 冲突守卫**（双方年份已知且不等 → 不命中）。实现于
      `music.service.ts`；白盒覆盖见 9.1

## 3. 专辑收藏写能力（packages/server/src/music/album-types.ts 增量）

- [x] 3.1 `qq: false` —— 未实现 `saveAlbum` → feature detection 自动缺席
- [x] 3.2 `netease: true` —— `netease.provider.ts` 新增 `saveAlbum()`
      （`POST /api/album/sub`，复用 `apiCall` 的 appver/csrf/realIP 配套）
- [x] 3.3 `deezer: false` —— 同 3.1
- [x] 3.4 `spotify: true` → ⚠️ **降级为留位**：Spotify 有
      `PUT/DELETE /v1/me/albums`，但**未实现专辑搜索**（album-search 阻塞项
      B2：本机无 OAuth token）→ 拿不到 albumId，本期不实现。接口位已在
      `AlbumSaveProvider` 留好
- [x] 3.5 provider 单元测试：网易云最小 happy-path —— 见 9.1（能力矩阵 +
      写入语义）；真实端点真伪待登录态实测（见验收清单）

## 4. fan-out 业务逻辑（packages/server/src/music/music.service.ts 增量）

- [x] 4.1 加 `fanOutAlbumSave(session, mergedAlbumId, sources, saved)`：循环
      写各平台，收集 `fannedOutTo`，写 `albumFanOut` 字段
- [x] 4.2 加 `toggleAlbumSave(session, provider, albumId, saved)`：单平台写
- [x] 4.3 `loadState` / `saveState` 扩展支持 `albumFanOut` 字段
      —— 格式 `{ mergedAlbumId: [{platform, albumId}] }`（比 spec 原文多存
      albumId：取消收藏要靠它反写，缺了就撤不掉）
- [x] 4.4 失败策略：单平台失败 → fannedOutTo 不含 + 整体 success=true
- [x] 4.5 结构性跳过：hasAlbumSaveApi=false / 未登录 → **不写入** albumFanOut
      （避免假收藏污染 + 角标虚高）

## 5. Controller（packages/server/src/music/music.controller.ts 增量）

- [x] 5.1 加 `POST /music/album/save/merged` 端点
- [x] 5.2 加 `POST /music/album/save/:albumId?provider=&saved=` 端点
- [x] 5.3 验证 sources 非空 + mergedAlbumId 缺失 → 400
      —— ⚠️ 口径微调：`sources` 只在**收藏**方向必需（取消方向按服务端
      记录的 platform+albumId 反写，客户端不必回传）

## 6. 类型（packages/server/src/music/album-types.ts 增量）

- [x] 6.1 `AlbumSource` / `UnifiedAlbum` / `AlbumSaveProvider` /
      `AlbumFanOutEntry` / `FanOutAlbumSaveResponse` 定义
      —— ⚠️ 与 spec 原文不同：`Album` / `UnifiedAlbum` 已在 album-search
      落地（`album-types.ts`），**复用**不新建；`UnifiedAlbum` 增
      `savedPlatforms?: MusicProvider[]`（角标真值来源）

## 7. Renderer API 封装（packages/renderer/src/api.ts 增量）

- [x] 7.1 加 `fanOutAlbumSave(mergedAlbumId, sources, saved)` 方法
- [x] 7.2 加 `toggleAlbumSave(albumId, provider, saved)` 方法
- [x] 7.3 ~~`api.d.ts` 类型同步~~ → ❌ **不适用**：仓库无 `api.d.ts`，
      类型镜像直接写在 `api.ts`（`UnifiedAlbum` 镜像加 `savedPlatforms`）

## 8. UI 接入（packages/renderer/src/ 增量）

- [x] 8.1 `AlbumResults.tsx` 专辑行加 ❤ 按钮：点收藏 / 再点取消，
      乐观更新 + 失败回滚
- [x] 8.2 已 fan-out 的专辑显示角标（♥ + 平台数）
- [x] 8.3 ~~detect：进入专辑视图时后台 `findEquivalentAlbum` 补齐其它平台~~
      → ❌ **取消**（前提已变）：专辑搜索**已跨平台合并**，
      `UnifiedAlbum.sources` 本就含各平台 albumId，无需再 detect。
      真正需要补齐的场景（该平台根本没被搜到）由 2.5 的定向等价查找覆盖，
      且只在**用户点收藏时**按需触发

## 9. 测试

- [x] 9.1 白盒：`album-save.service.test.ts`（19 条）—— 能力矩阵 / 写入 /
      未登录跳过 / 写失败不写 state / 取消幂等 / 取消只动自己的记录 /
      老 state 兼容 / 定向等价查找 / 源码契约 / 异常隔离×3 / trackCount 守卫 /
      漂移归一 / 锁时序 / 同平台多 albumId / 跨 key 取消 / 角标两路 / 部分撤失败
- [x] 9.2 白盒：state 序列化 + 幂等反写（不动未收藏过的平台）—— 同上
- [x] 9.3 e2e：`album-save.e2e.test.ts`（6 条）—— 400 校验 / **路由顺序**
      （`album/save/merged` 不被 `:albumId` 截胡）/ 结构性跳过 / 网易云写入 /
      搜索结果带 `savedPlatforms` / 取消反写
- [x] 9.3b UI：`AlbumResults.test.tsx`（11 条，vitest）—— ❤ 按钮 / 调用契约 /
      角标 / 取消 / 空 fannedOutTo 提示 / 失败回滚 / 不触发行展开 /
      换关键词清 override / per-album 保存集合 / sources 带 trackCount /
      部分取消保留角标
- [x] 9.4 `npm run typecheck` 通过
- [x] 9.5 `npm test` 全量绿
- [x] 9.6 变异验证：① 不写 `albumFanOut` → 红 ② 取消方向改用请求 sources
      反写 → 红 ③ 去掉 `saveAlbumOnce` 的异常隔离 → 红 ④ 远端写挪回 state 锁内
      → 红
- [x] 9.7 🆕 **异常隔离**（review 必修）：`saveAlbumOnce` / 等价查找都不得把
      平台异常抛出去 —— `withTimeout` 不吞 rejection（`Promise.race` 直接传播），
      而网易云 `apiCall` 在网络失败 / 响应非 JSON 时抛 `BadRequestException`、
      `searchAlbums` 在 `code!=200` 时抛。抛出点在 `saveState` 之前 →
      已成功平台的落账丢失 → 远端收藏了但本地无记录（孤儿，撤不掉）。
      统一降级成"这个平台没写成"
- [x] 9.8 🆕 **远端写移出 state 锁**（review 中优先级）：三阶段执行 ——
      规划（无锁，含网络）→ 远端写（无锁）→ 落账（锁内）。否则一次收藏最坏
      ≈10s 会把该 session 其它 state 写路径（❤/踩/queue refill）全排队
      （track 侧特意把远端写推队列就是躲这个）
- [x] 9.9 🆕 **mergedId 漂移归一**（review 中优先级）：照 track 侧
      `canonicalMergedId` —— 专辑 mergedId = `merged-${normalizeKey(代表源)}`，
      代表源会变（QQ 缺席时 rep 变 Deezer）→ 同一张专辑两条记录 → 旧条成孤儿。
      按 platform+albumId 重合扫 `albumFanOut` 归一
- [x] 9.10 🆕 **trackCount 分歧守卫**（review 中优先级，写路径正确性）：
      同名 + 同艺人 + 同年份但曲目数差 >50% = EP vs LP / 豪华版 → 不是同一张
      专辑。sources 带上 `trackCount`（用**该平台自己报的**，不是合并中位数），
      阈值复用 `album.util` 的 `TRACK_COUNT_DIVERGENCE`（不另立一份）
- [x] 9.11 🆕 **平台严格校验**（review 低优先级）：`normalizeProvider` 会把
      未知平台兜底成 'qq' → `provider=bogus` 静默打到 QQ。专辑端点改用
      `requireAlbumProvider`（未知 → 400），与歌单端点同口径
- [x] 9.12 🆕 **albumFanOut LRU 上限**（review 低优先级）：`ALBUM_FANOUT_MAX
= 1000`，照 `fanOut` 的 `FANOUT_MAX` 口径（state.json 不会无限长）
- [x] 9.13 🆕 **同平台 entry 的 albumId 更新**：请求带来新 albumId 时更新旧的，
      否则 unsave 撤的是旧 id、新的成远端孤儿
- [x] 9.14 🆕 **同平台多 albumId**（二轮残留）：plan/落账按 `platform:albumId`
      去重 —— 平台侧换专辑 id（再版/换源）时同一平台可能挂多条，每条都是真实
      写过的远端对象；取消逐条撤，只撤一条会留远端孤儿。⚠️ 与 9.13 的关系：
      9.13 是同 platform+同 albumId 的字段更新，本条是同 platform+**不同**
      albumId 的多记录共存
- [x] 9.15 🆕 **`fannedOutTo` 取消方向语义**（二轮残留）：= 该平台名下记录
      **全部撤干净**才计入（撤一半角标不能灭，否则 UI 撒谎）；失败的条目保留
      在 state 里可重试
- [x] 9.16 🆕 **角标两路注入**（二轮残留）：`searchAlbumsUnified` 注入
      `savedPlatforms` 走 ① item.id 精确 key + ② sources 的 platform:albumId
      与任一记录条目重合 —— 漂移归一把记录留在老 key 下，只靠精确 key 角标会
      暗（与 track 侧 library `ptToFanOutKeys` 倒排同思路）；按 platform 去重
- [x] 9.17 🆕 **plan/commit 并发窗口写明为有意取舍**（二轮残留）：plan 读锁外
      快照、落账锁内重读，之间可能插进并发写 —— 落账按"实际撤成功的 pair"摘
      条目 → 没撤的保留 ↔ 远端仍收藏，end state 自洽。消掉窗口要把网络 I/O
      塞回锁里（最坏 ≈10s 堵全部 state 写），不值。见 `fanOutAlbumSave` docstring

## 10. 知识库沉淀（完工后）

- [x] 10.1 `~/knowledge/maestro/album-fanout.md`：设计要点 + 复用决策 +
      平台能力矩阵
- [x] 10.2 `~/knowledge/maestro/spotify.md` 增量记 "album save 留位" 一节
- [x] 10.3 ~~`~/Music/maestro/maestro-frontier.md`~~ → ❌ **取消**：
      知识库在 `~/knowledge/maestro/`，`~/Music` 是本地音乐目录不是知识库
      （spec 原文把沉淀路径写到了错误的地方）

## 验收清单（需登录态手动）

- [ ] @manual 网易云已登录 → 搜一张专辑 → 点 ❤ → **网易云「我的收藏专辑」里真的出现**
      → 再点取消 → 真的消失
- [ ] @manual 端点确认：`POST /api/album/sub` 返回 200（若非 200 → 看日志里的 code，
      改 `netease.provider.ts` 的 `NETEASE_ALBUM_SUB_ENDPOINT` 常量，一行可改）
- [ ] @manual 跨平台：一张只在 QQ 搜到的专辑 → 点 ❤ → 自动走定向等价查找 →
      网易云也收藏成功；找不到则明确提示而不是静默失败

---

## 2026-10-20 review 后的加固（外部 agent review）

review 提出的 1 个必修 + 4 个中低优先级问题，逐条处置如下：

| 级别    | 问题                                                         | 处置                                                                                                                                           |
| ------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 必修 | provider 抛异常炸穿整个 fan-out（`withTimeout` 不吞 reject） | ✅ 修：`saveAlbumOnce` / 等价查找都 catch → 降级成"没写成"，整体 success 仍 true；补 3 条白盒（save 抛 / 查找抛 / unsave 抛）                  |
| 🟡 中   | 专辑侧无 mergedId 漂移归一                                   | ✅ 修（9.9）                                                                                                                                   |
| 🟡 中   | `toggleAlbumSave` 不落账 → 远端收藏了无记录                  | ⚠️ **标注为 raw 接口**（不改行为）：单平台端点拿不到统一专辑键 → 端点/服务/api 三处都写明"不落账、角标不亮、不能用 merged 撤"，UI 只走 fan-out |
| 🟡 中   | 等价查找缺 trackCount 守卫（EP vs LP）                       | ✅ 修（9.10）                                                                                                                                  |
| 🟡 中   | 锁横跨网络 I/O                                               | ✅ 修（9.8，三阶段）                                                                                                                           |
| 🟢 低   | controller docstring 被新端点隔断                            | ✅ 修：端点挪到 `albumTracks` 之后                                                                                                             |
| 🟢 低   | `normalizeProvider` 静默纠偏                                 | ✅ 修（9.11）                                                                                                                                  |
| 🟢 低   | `albumFanOut` 无上限                                         | ✅ 修（9.12）                                                                                                                                  |
| 🟢 低   | `providerSessionFor` 不调 `bindSessionId`                    | ✅ 注释留警示（Spotify 落地时必须补）                                                                                                          |
| 🟢 低   | 同平台 entry 的 albumId 不更新                               | ✅ 修（9.13）                                                                                                                                  |
| 🟢 低   | 前端 `savedOverrides` 不回表 / `savingAlbumId` 单槽          | ✅ 修：换关键词清 override；保存中状态改成 per-album 集合（点 A 不再让点 B 静默失效）                                                          |

**review 的一条判断我修正了**：它说"异常 → 本次已成功平台的写入丢失"。v1 只有
网易云可写，单平台情况下不存在"部分成功"；但**"远端写成功、本地无记录"**这条
是真的（`apiCall` 在"请求已发出、响应非 JSON"时抛）—— 同样要修，危害更大。

## 2026-10-20 二轮 review 残留处置

一轮 review 收尾时留下的 3 条已知残留，本轮全部处置：

| #   | 残留                                                                                                                          | 处置                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | unsave 按平台去重：两个漂移 key 各持同平台**不同** albumId 时，只远端撤第一个却把该平台从所有 key 摘掉 → 另一个远端对象成孤儿 | ✅ 修：plan/落账按 `platform:albumId` pair 去重，同平台多条都撤；`fannedOutTo` 取消方向 = 该平台全部撤干净才计入（9.14/9.15，白盒 16/17/19）                                             |
| 2   | plan（锁外快照）与落账（锁内重读）之间非原子                                                                                  | ⚠️ **写明为有意取舍**（9.17）：落账按"实际撤成功的 pair"摘条目 → 并发新增的记录保留 ↔ 远端仍收藏，end state 自洽不产孤儿；消掉窗口需把网络 I/O 塞回锁（最坏 ≈10s 堵全部 state 写），不值 |
| 3   | 角标只按 `item.id` 精确 key 注入 → 漂移归一把记录留在老 key 下时，新 key 的卡片角标不亮                                       | ✅ 修：两路注入（9.16，白盒 18）—— 精确 key + sources 的 platform:albumId 重合                                                                                                           |

## 与 spec 的偏差记录（2026-10-20 实施）

| #   | spec 原文                                                              | 实际                                                          | 原因                                                                          |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `MusicProvider` interface 加 `hasAlbumSaveApi`                         | `album-types.ts` 新增 `AlbumSaveProvider` + feature detection | `common/provider.ts` 只有字符串 union，没有 interface；静态标志位会与实现漂移 |
| 2   | 新建 `Album` / `UnifiedAlbum` 类型                                     | 复用 album-search 已有的                                      | 避免两套类型                                                                  |
| 3   | 新建 `normalizeAlbumKey` / `findEquivalentAlbum` / `mergeAlbumLibrary` | 复用 `album.util.ts`；只补 `findAlbumEquivalentOnPlatform`    | 两套归一口径必然漂移（CLAUDE.md 禁止）                                        |
| 4   | `albumFanOut: { id: [platforms] }`                                     | `{ id: [{platform, albumId}] }`                               | 取消收藏要靠 albumId 反写                                                     |
| 5   | Spotify 收藏 ✅                                                        | 留位不实现                                                    | 未实现专辑搜索 → 无 albumId                                                   |
| 6   | 「进入专辑视图后台 detect 补齐」                                       | 删除                                                          | 专辑搜索已跨平台合并，detect 冗余                                             |
| 7   | 沉淀到 `~/Music/maestro/`                                              | 沉淀到 `~/knowledge/maestro/`                                 | `~/Music` 是本地音乐目录                                                      |
