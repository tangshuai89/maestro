# 一致性修复任务清单

> 按执行顺序排列。每个任务自包含（含文件/行号/修复方向/测试要求），可直接
> 交给独立子 agent 开发。流程：独立分支 → 实现 + 回归测试 → typecheck/lint/
> test 全绿 → PR。禁止直接 push master。
>
> 依赖关系：T1 独立最先做（打包版致命）；T2 是 B 类根因，先于 T3-T5；
> T6（前端守护）与 server 端任务无依赖可并行；其余按序。

## P0 — 打包版致命（必须最先修）

- [ ] **T1** 媒体路由 guard 豁免 + sidecar 探活 + API_ORIGIN 动态化
  - `music.controller.ts`：新建 `@SkipInternalToken()` 装饰器（SetMetadata），
    `RequireInternalTokenGuard` 用 Reflector 检查；对以下只读媒体 GET 豁免：
    `GET /music/stream/:provider/:trackId`、`GET /music/cover-proxy`、
    `GET /music/lyrics/:provider/:trackId`、`GET /music/deezer/editorials`
  - `electron/src/main.ts` `waitForSidecar`（~L81）：探活 fetch 带
    `X-Maestro-Token` header（双保险）
  - `renderer/src/api.ts`：`API_ORIGIN` const → `getApiOrigin()` 函数，
    每次调用时求值（保留向后兼容 export，逐步迁移调用点：`usePlayer.ts`
    的 audioUrl 拼接、`useCoverArt.ts` 的 proxied URL、`lyricsShare.ts`）
  - 测试：guard 豁免路由回归测试（auth-guard.test.ts 扩展：配置 token
    后 stream/cover-proxy 不带 header 也 200/404，其他路由仍 401）

## P1 — likedCache/state 双真值源收口（B 类根因，修完 #75 才算真正修完）

- [ ] **T2** `writeLike` 收口 + getLikedSet 返回 reconciled 集合
  - `music.service.ts` 新增私有 helper：
    `writeLike(session, state, platform, trackId, liked)` = `setLike` +
    `updateLikedCache`，返回 setLike 的 boolean
  - 改造全部绕过点用 writeLike：
    - `fanOutLike` like/unlike 两方向（现在是 setLike+updateLikedCache 两行，收口）
    - `detectLikedAndSync`（同上收口）
    - `toggleLike` / `applyLikeToggle`（~2469：radio ❤ 路径，**高危**）
    - `markDisliked`（~734：直接 .delete）
    - `dislikeMerged`（~780：double-check 直接 .delete）
    - `resolveEquivalents`（~1082：discover 匹配写入）
  - `getLikedSet`（~2169）：fetch 成功后先 reconcile 再缓存/返回
    reconciled `next`（不再缓存 raw remote）；`reconcileLiked`（~2145）
    末尾把 `next` 回写 `likedCache`
  - 测试：新建 `liked-cache-consistency.test.ts`——(1) toggleLike 后
    getLikedSet 立即反映 (2) markDisliked 后 detect 不再看到 liked
    (3) reconcile 后缓存与 state 一致 (4) 在途 like（pendingTargets 模拟）
    不被 reconcile 抹掉

- [ ] **T3** LikeSyncQueue 可见性窗口 + 登录登出缓存失效
  - `like-sync.queue.ts`：target 完成后保留 30s「可见性窗口」——
    `pendingTargets` 返回 pending + active + recently-completed（30s 内）；
    实现：completed 数组 `{sessionId, platform, trackId, liked, at}`，
    pendingTargets 时过滤过期项；窗口常量可注入便于测试
  - `music.service.ts` 暴露 `invalidateLikedCache(session, provider?)`
    （provider 省略 = 清该 session 全部平台）
  - `auth.controller.ts`：登录成功（setProvider 各处）+ 登出
    （clearProvider 处）调用 invalidateLikedCache
  - 测试：扩展 `like-sync.queue.purge.test.ts`——完成后 30s 内
    pendingTargets 仍含该 target；auth 流程测试——登出后 likedCache 失效
    （getLikedSet 重新拉取）

- [ ] **T4** resolveEquivalents 的 unlike 竞态 + stale canonicalId
  - `music.service.ts` `resolveEquivalents`（~1008-1102）：await
    searchEquivalent 完成后 re-loadState，检查 `state.fanOut[canonicalId]`
    仍存在（用户没取消）才写入 setLike/mergeFanOutEntries；已消失则丢弃
    discover 结果并 log
  - `detectLikedAndSync`（~2344/2398）：`waitForSettled` 之后用
    `stateAfterWait` 重算 canonicalId 再做 mergeSiblingLibraryLikes 和
    fanOut 读写
  - `healLibraryItem`（~1270）/ `mergeSiblingLibraryLikes`（~2455）：
    写 fanOut 的同时用 writeLike 补 `providers[p].liked`（防 reconcile
    把 fanOut 条目删掉、角标闪现消失）
  - 测试：discover 期间 unlike → 结果被丢弃；detect 跨 wait 的
    canonicalId 漂移用例

- [ ] **T5** per-session 状态锁 + importLiked 单飞
  - `music.service.ts`：手写 promise-chain mutex
    （`private stateLocks = new Map<string, Promise<void>>()` +
    `withStateLock<T>(sessionId, fn: () => Promise<T>): Promise<T>`）
  - 包裹写路径：`fanOutLike`、`toggleLike`、`dislikeMerged`、
    `markDisliked`、`getNextTrack`（refill 段）、`importLiked`。
    ⚠️ `detectLikedAndSync` 只锁写段（waitForSettled 前的写 + 之后的
    merge 写），6s wait 不持锁——否则 ❤ 点击会被 detect 阻塞
  - ⚠️ 锁内不得调用另一个也拿锁的方法（不可重入）——`dislikeMerged` 内部
    调 `fanOutLike` 的场景：抽出无锁内部版供复用
  - `importLiked` 单飞：`private importInFlight = Map<sessionId, Promise>`，
    在途时直接返回同一 promise；fanOut 清理改为「只删 import 开始前快照
    中已存在的 key」，import 期间新增的 fanOut 保留
  - 测试：并发 fanOutLike + detect 不丢写；并发双 import 只跑一次；
    import 期间 fanOutLike 的记录 import 结束后仍在；并发 getNextTrack
    不双 refill

## P1 — 前端交互守护（与 server 任务并行）

- [ ] **T6** usePlayer 红心/切歌竞态守护
  - `handleLike`（~1185）：进入时 `const ticket = ++likeTicketRef.current`
    + `const startedTrackId = track.id`；await 后
    `ticket === likeTicketRef.current && trackRef.current?.id === startedTrackId`
    才 setTrack/setFanOutCount；setTrack 用 id 守护形式
  - `handleLike` / `handleDislike` 开头 `++likedRefreshGenRef.current`
    （作废在途轮询，防止取消后旧 detect 复活红心）
  - `detectAndApplyLiked`（~629）：轮询调用路径传入 expectedLiked
    （轮询只在 liked=true 时启动），await 后
    `trackRef.current?.liked !== expectedLiked` 则丢弃结果
  - `handleDislike`（~1225）：同 ticket/track 守护
  - `loadNextTrack` radio 路径（~797）：await 前快照
    provider/deezerPreset，回来不一致则丢弃
  - WPS play 链（~1009-1024）：transferHere().then 回调校验
    `trackRef.current?.id === startedTrackId`
  - 测试：扩展 `usePlayer.test.mjs`——守护条件抽成可导出纯函数
    （如 `shouldApplyLikeResult(...)`）单测

## P2 — Spotify/WPS 生命周期

- [ ] **T7** Spotify token/session 生命周期
  - `common/session.ts` `persistSpotify`（~214）：校验传入的
    ProviderSession 与当前 live `s.providers.spotify` 是同一对象引用
    （不是则说明已登出/重登，丢弃写入并 log）
  - `spotify.provider.ts` `getValidTokenForRenderer`（~474）：refresh
    后 re-read token 返回新 expiresAt
  - `auth/refresh-coordinator.ts`：key 改 `${provider}:${sessionId}`
  - 测试：登出期间 refresh 完成不复活 token；expiresAt 是新值

- [ ] **T8** spotify-wps.ts + useSpotifyWpsPlayer 生命周期
  - `waitForSdk`（~119）：超时分支 `sdkPromise = null` 允许重试
  - `bindListeners`/`disconnect`（~214/~333）：保存 listener 引用，
    disconnect 时逐个 `removeListener`
  - `onReady`（~237）：`p !== player` 时忽略（旧 player 事件）
  - `getOAuthToken`（~312）：改读 `latestToken` 可变变量，
    `refreshToken` 原地更新
  - `useSpotifyWpsPlayer`（~107-195）：effect cleanup 精确 disconnect
    本 effect 创建的实例（局部变量，不读 wrapperRef.current）
  - 测试：扩展 `spotify-wps.test.mjs`——SDK 超时重试、disconnect 后
    listener 清空、旧 player ready 不覆盖 deviceId、token 刷新后
    getOAuthToken 拿新值

## P2 — Electron main 登录/生命周期

- [ ] **T9** 登录窗口 + oauth-buffer 竞态
  - `main.ts` `openQqLoginWindow`/`openNeteaseLoginWindow`
    （~418/~547）：login 调用时清 `__maestroLastResult`（强制新流程），
    登出 IPC（若有）时销毁隐藏窗口
  - `oauth-buffer.ts` `deliver`（~76）：每次 push 只 resolve 一个
    waiter（FIFO 队首），其余继续等下一次 push
  - `login-window-runner.ts`（~129-183）：`capturing` in-flight 标志；
    closed 事件时若 capture 在途，等它落定——成功则 resolve 成功，
    null 才按取消处理
  - `sendTrayCommand`（~181）：加 `!mainWindow.isDestroyed()` 检查
  - 测试：扩展 `oauth-buffer.test.ts`（单 waiter 语义；注意现有
    「concurrent consume both resolve」用例语义要改）+
    `login-window-runner.test.ts`（closed vs capture 竞态）

## P3 — 存储/会话持久化

- [ ] **T10** 存储 flush + prefs 持久化 + 杂项
  - server `main.ts`（bootstrap）：`process.on('SIGTERM')` →
    `storage.flushSync()` 后退出；electron `main.ts` before-quit 先发
    SIGTERM 并短暂等待（≤500ms）再强杀
  - `session.ts`：新增 `setPref(session, key, value)`（写 blob +
    persist）；`music.controller.ts` `setDeezerPreset` + `/next?preset=`
    改用它
  - `like-sync.queue.ts`：task 创建时深拷贝 ProviderSession 快照
    （structuredClone），`syncLikeRemoteOnce` 用快照（防重登串账号）
  - `music.service.ts` `patchLibraryWithSources`/`healLibraryItem`
    mutation 后 `libraryCache.delete(session.id)`
  - `reco.service.ts` coverCache 加 `{cover, at}` + 24h TTL
  - 测试：prefs 持久化（`deezer-preset.test.ts` 扩展——重建 service 读
    同一 storage 模拟重启）；session 快照测试；libraryCache 失效测试

## 未排期（记录在案，暂不做）

- api.ts 全面加 AbortSignal（D7）——T6 完成后评估是否仍需要
- useCoverArt createImageBitmap 后补 epoch check（低概率窗口）
- applyWpsProgress 校验 track id（进度条闪烁，低危害）
- 首次启动并行请求多 session（G3）——单飞预热请求
- cover-proxy 服务端 LRU 缓存（性能优化，非 bug）
- session lastAccessedAt 持久化（极低危害）

## 完成判据

- [ ] 全部 P0/P1 任务（T1-T6）合并
- [ ] P2/P3 任务（T7-T10）合并
- [ ] 每个 PR：`npm run typecheck && npm run lint && npm test` 全绿
- [ ] 打包冒烟：打包版能出声、能显示封面（T1 验收，条件允许时）
- [ ] 回归确认：#75 场景（推荐歌曲点红心）+ radio 点红心 + 取消红心
  三个手工场景在修复后行为正确
