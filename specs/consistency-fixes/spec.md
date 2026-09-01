# 一致性修复：状态/缓存双真值源 + 竞态类 bug 清扫

> 2026-09-01 全仓扫描产出。背景：PR #75 修复了「推荐歌曲点红心后短暂显示再消失」
> ——根因是 `fanOutLike` 写本地 state 却不更新 `likedCache`，detect 轮询读到旧缓
> 存把红心抹掉。本 spec 是对**同类问题的系统性清扫**：4 个并行审计覆盖
> server（music.service / like-sync.queue / storage / auth / session）、
> renderer（usePlayer / App / useCoverArt / spotify-wps / api）、
> electron main（sidecar / 登录窗口 / oauth-buffer）。
> 所有发现均经过代码级验证（文件 + 函数 + 行号）。

## 问题分类

### 类别 A — 打包版致命缺陷（P0：打包版完全不可用）

**A1. `<audio>` / cover-proxy 被 RequireInternalTokenGuard 拦死**
- `music.controller.ts:66` 类级 `@UseGuards(RequireInternalTokenGuard)` 覆盖全部路由。
- `<audio src="/music/stream/...">` 无法带自定义 header；`useCoverArt.ts:34`
  的 `fetch(proxied)` 也没走 `fetchWithToken`。
- dev 模式 token 未配置 → guard 放行，掩盖了问题；打包版 token 已配置 →
  **stream 和 cover-proxy 全部 401：无声音、无封面**。
- 修复方向：把媒体只读 GET（`stream/*`、`cover-proxy`、`lyrics`、
  `deezer/editorials`）从类级 guard 豁免（方法级装饰器 / 自定义 @Public()
  metadata + guard 里查 reflector），依赖签名 session cookie 保护。

**A2. `waitForSidecar` 探活不带 token**
- `electron/src/main.ts:81` 轮询 `/music/deezer/editorials` 不带
  `X-Maestro-Token` → 打包版 401 → `res.ok` 永远 false → 30s 后误判
  「sidecar 启动失败」。
- 修复方向：探活 fetch 加 header（若 A1 豁免了该路由则自然解决，但仍建议
  带上，双保险）。

**A3. `API_ORIGIN` 模块加载时固化**
- `api.ts:33` 在 import 时求值，此时 `electronAPI.apiBase` 还是 ''（
  sidecar-ready IPC 未到）→ 永远 fallback `http://localhost:3200`。
- PORT 改端口时打包版全部请求打错地址。默认端口下侥幸可用。
- 修复方向：`API_ORIGIN` 改为函数 `getApiOrigin()` 每次调用求值，或
  onSidecarReady 后可变更新。

### 类别 B — likedCache / state 双真值源不同步（P1：与 #75 同类，日常可复现）

核心设计缺陷：`state.providers[p].liked`（真值）与 `likedCache`（getLikedSet
的 5 分钟读缓存）是同一事实的两个副本，多处写路径只写其一。

**B1. `getLikedSet` 缓存并返回原始 remote 集合而非 reconciled 集合**（根因级）
- `music.service.ts:2216` 缓存 raw remote set；`reconcileLiked` 算出的
  `next = remote ∪ pending-like − pending-unlike` 只写 state 不回写缓存。
- 后果：任何在途 like 在 detect 眼里都不存在 → 误判 → 抹红心/重复入队。
- 修复方向：`getLikedSet` 返回并缓存 reconciled `next`；`reconcileLiked`
  末尾把 `next` 回写 `likedCache`。

**B2. `toggleLike` / `applyLikeToggle` 不更新 likedCache**
- `music.service.ts:2469` 单平台路径（radio ❤）直接改 state 不动缓存 →
  与 #75 完全同类：radio 模式点红心也会被 detect 抹掉。

**B3. `LikeSyncQueue` 完成即从 `pendingTargets` 消失，无可见性窗口**
- `like-sync.queue.ts:225` remote 写成功后 `active=null`，但平台端最终一致
  （fetchLiked 可能还返回旧集合）→ reconcile 把刚写成功的 like 当失配抹掉。
- 修复方向：完成的 target 保留一个短暂可见窗口（如 30s）再从
  pendingTargets 剔除；或 reconcile 改为「不删除本地新增、只删被
  pending-unlike 显式否定的」。

**B4. 登录/登出不失效 likedCache**
- 全仓 0 处 `likedCache.delete/clear` 调用（除测试）。换账号后 5 分钟内
  显示上一账号的红心。
- 修复方向：`MusicService.invalidateLikedCache(session, provider)`，
  AuthController 登录/登出时调用。

**B5. 其余绕过 setLike+cache 的写点**（一次性收口）
- `resolveEquivalents`（~1082）：setLike 后缺 updateLikedCache。
- `markDisliked`（~734）：直接 `.delete` 绕过。
- `dislikeMerged`（~780）：double-check 直接 `.delete` 绕过。
- `reconcileLiked`（~2145）：bulk 赋值不回写缓存（并入 B1）。
- `healLibraryItem`（~1270）/ `mergeSiblingLibraryLikes`（~2455）：写
  fanOut 不写 providers.liked → 下次 reconcile 把 fanOut 条目删掉，
  角标闪现又消失。
- 修复方向：收口一个私有 helper `writeLike(session, state, platform,
  trackId, liked)` = setLike + updateLikedCache，全部写点改用它；
  fanOut-only 写点补 providers.liked。

### 类别 C — server 端 load-modify-save 竞态（P1~P2）

**C1. `importLiked` 清空 fanOut 抹掉并发写入 + 非单飞**
- `music.service.ts:2780` 长 await 后 `musicState.fanOut = {}` 无条件清空
  ——import 期间用户点的红心全部丢失；双击重新导入两个 import 交错互抹。
- 修复方向：per-session 单飞（in-flight promise 复用）+ 只清 import 开始
  前快照里已存在的 key，不动 import 期间新增的。

**C2. 无 per-session 状态锁**
- `fanOutLike` / `detectLikedAndSync` / `toggleLike` / `importLiked` /
  `getNextTrack` 全是 load → await → save，交错丢写。
- 修复方向：`MusicService` 加 per-session async mutex（简单 promise-chain
  实现即可，无需引库），所有 mutating 方法包裹。注意 detectLikedAndSync
  中间有 6s `waitForSettled`——锁粒度要拆到「写段」而不是整个方法，
  否则会把 like 点击阻塞 6 秒。

**C3. `resolveEquivalents` 完成后不检查用户已 unlike**
- discover 搜索期间用户取消红心 → 搜索回来无条件 setLike + 写 fanOut →
  **复活刚取消的红心**（用户视角：取消了又自己亮回来）。
- 修复方向：await 搜索后重新 loadState，若 `fanOut[canonicalId]` 已不存在
  （用户已 unlike/dislike）则丢弃 discover 结果。

**C4. `getNextTrack` 并发双 refill**
- 两个并发 `/music/next` 都看到空队列 → 双拉 batch → 队列多出一倍。
  C2 的锁顺带解决，或单独用 refill in-flight promise 共享。

**C5. `detectLikedAndSync` 跨 6s wait 的 stale canonicalId**
- `:2344` 算 canonicalId → 6s wait → `:2398` 重新 loadState 却用旧
  canonicalId 写 → 漂移场景下写错 key。修复：wait 后重算。

### 类别 D — 前端 usePlayer 竞态（P1：与 #75 直接相关的交互层）

**D1. `handleLike` 无请求代际/轨道守护**
- `usePlayer.ts:1185`：双击 ❤ 或点 ❤ 后立刻切歌，await 回来的
  `setTrack({liked: next})` 把新 track / 新意图覆盖掉。
- 修复：`likeTicketRef` 代际 + `startedTrackId` 守护。

**D2. `handleLike` 不递增 `likedRefreshGenRef`**
- 点 ❤ → 轮询启动 → 立刻取消 ❤ → 旧轮询没被作废，detect 读到远端
  残留（队列未排空）→ **把刚取消的红心重新点亮**。
- 修复：handleLike / handleDislike 开头 `++likedRefreshGenRef.current`。

**D3. `detectAndApplyLiked` 只防切歌不防手动翻转**
- `activeMergedIdRef` 只在换歌时变化；同一首歌上用户手动翻转后，在途
  detect 结果无条件 `setTrack` 覆盖手动状态。
- 修复：轮询路径要求 `trackRef.current?.liked` 与轮询启动时一致才应用。

**D4. `loadNextTrack` radio 路径缺 provider/preset 守护**
- await `fetchNextTrack` 期间切平台/换 preset → 回来仍 presentTrack 旧
  平台的歌。修复：await 前快照，回来校验。

**D5. `handleDislike` 同类竞态**（同 D1 方案）

**D6. WPS play/transferHere 链切歌后播旧 URI**
- `transferHere().then(() => wps.play(uri))` 无 track 守护。
- 修复：then 回调里校验 `trackRef.current?.id === startedTrackId`。

**D7. `api.ts` 关键调用缺 AbortSignal**（低优先，做 D1-D4 时顺带评估）

### 类别 E — Spotify / WPS 生命周期（P2）

**E1. `persistSpotify` 覆盖登出/重登**
- refresh 在途时用户登出/重登 → refresh 完成后 `persistSpotify` 无条件
  回写旧 token → 登出后「复活」、重登被旧账号覆盖。
- 修复：persist 前校验该 ProviderSession 仍是 live 引用（对象身份或版本号）。

**E2. `getValidTokenForRenderer` 返回旧 expiresAt**
- refresh 后没重读 token → renderer 拿新 accessToken + 旧 expiresAt →
  反复刷新。修复：refresh 后 re-read。

**E3. `spotify-wps.ts` sdkPromise 超时后永不重试**
- SDK 加载 >5s → sdkPromise 永久 rejected → 该会话 WPS 永远不可用。
- 修复：超时分支 `sdkPromise = null` 允许下次重试。

**E4. `disconnect()` 不移除 SDK listeners**（泄漏 + 幽灵设备）
**E5. 旧 player 的 ready 事件覆盖新 deviceId**（`p !== player` 时忽略）
**E6. `getOAuthToken` 异步链拿旧 token**（改为读 latestToken 变量）
**E7. `useSpotifyWpsPlayer` 快速 toggle 泄漏 wrapper**（cleanup 精确到实例）

### 类别 F — Electron main 登录/生命周期（P2）

**F1. 隐藏登录窗口缓存旧 `__maestroLastResult`**
- 登出后再登录 → 直接返回旧 cookie，**换不了账号**（直到重启 app）。
- 修复：login 调用时清掉缓存结果 / 登出时销毁隐藏窗口。

**F2. oauth-buffer 一个 code 发给多个并发消费者**
- React Strict Mode 双 consume → 同一 PKCE code 兑换两次 → 第二次失败。
- 修复：每次 push 只 resolve 一个 waiter。

**F3. 登录窗口 closed 抢跑 capture 成功**
- capture await 期间用户关窗 → 已捕到的 cookie 被丢弃、报「取消」。
- 修复：capture in-flight 标志，closed 时等 capture 落定再决定。

**F4. tray 命令发到 destroyed window**（加 isDestroyed 检查）

### 类别 G — 存储/会话持久化（P3）

**G1. storage 200ms debounce + SIGTERM 丢写**
- Electron 退出 `kill('SIGTERM')` 不等 flush → 最后 200ms 的红心/登录丢失。
- 修复：sidecar `process.on('SIGTERM')` flushSync；main 退出前先等。

**G2. `session.prefs` 直接改不持久化**
- `setDeezerPreset` 改内存不落盘 → 重启丢 preset。
- 修复：SessionService.setPref + persist。

**G3. 首次启动并行请求创建多个 session**（renderer 首个请求串行化预热）

**G4. like-sync task 持 live session 引用**（重登后可能串账号写；
  任务创建时快照 ProviderSession）

**G5. `patchLibraryWithSources` 同引用 mutation 不失效 libraryCache**
- `storedRef === stored` 检测失效 → getLibrary 返回旧结果，新 source
  不显示直到重启。修复：mutation 后 `libraryCache.delete(session.id)`。

**G6. reco coverCache 无 TTL**（低优先，加 `{cover, at}` + 24h TTL）
**G7. `RefreshCoordinator` key 加 provider 前缀**（未来多 provider 防串）

## 验收标准（全局）

1. 每项修复必须附带回归测试（沿用现有 plain-Node + ts-node/mjs 模式）
2. `npm run typecheck && npm run lint && npm test` 全绿
3. 修复不引入新依赖（async mutex 用 promise-chain 手写）
4. 每个任务独立分支 + PR，不直接 push master
5. P0 类修复（A1-A3）需要打包冒烟验证：`npm run build` + 本地打包启动，
   确认音频/封面可用（若打包链路可跑）

## 风险提示

- C2 的锁引入要小心死锁：detectLikedAndSync 内部调用 fanOut 相关方法时
  不能重复获取同一把锁（锁需要可重入或写段拆分）
- B3 的可见性窗口不能太长：官方 App 里手动取消红心后，窗口内 reconcile
  不会移除本地状态（可接受的取舍，窗口 ≤ 60s）
- B1 改 getLikedSet 返回值语义，`detectLikedAndSync`/`isLikedOn` 的所有
  调用点行为都会变——需要跑全量 like.e2e + heart 相关测试确认无回归
