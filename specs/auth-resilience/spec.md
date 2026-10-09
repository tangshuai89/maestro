# Auth Resilience

把现在「常常不稳定」的登录流程改造成有界（bounded）、可恢复（recoverable）、
幂等（idempotent）的状态机。现状：QQ / NetEase 内嵌登录窗口有时丢回调、
Spotify OAuth 协议回调若在主窗口未就绪时到达会无声丢失、刷新 token 偶
发并发改写、过期 cookie 仍报「已登录」直到用户碰到具体错误。

## 验收标准

### 行为

- [ ] 任何登录尝试都有 120 s 硬超时：到时必须 cancel 并显示
      `AUTH_TIMEOUT` 给用户，不会无限挂着。
- [ ] 同时只允许一个登录尝试（per provider）；点击「登录」按钮不会启动
      第二个并行尝试。
- [ ] 切换音源 / 切换 provider 时立刻取消未完成的登录尝试，并释放所有
      相关资源（Electron cookie listener、polling timer、临时 window）。
- [ ] 拿到的凭据**先校验**再写 session：QQ 拉一次 `get_user_baseinfo_v2`，
      NetEase 拉一次 `/api/nuser/account/get`，Spotify 已经过
      `exchangeCode` 校验。每个校验调用套 5 s `withTimeout`，超时 → 不写
      session，报 `AUTH_INVALID`。
- [ ] 平台返回 `1000`（QQ）、`301`（NetEase）、`invalid_grant`（Spotify）
      → 立刻把该 provider 标 `AUTH_EXPIRED`，UI 显示「重新登录」按钮，
      播放器继续工作（其他 provider 不受影响）。
- [ ] 已登录 provider 的 cookie / token 走「滑动」生命周期：每个请求刷新
      `lastAccessedAt`；后台定时器每小时清一次 `now - lastAccessedAt > TTL`
      的 session。

### Electron

- [ ] QQ / NetEase 内嵌登录窗口走同一个 `login-window-runner.ts`，
      单一所有权。20 次反复开/关后，无 cookie listener、无 `setInterval`、
      无隐藏 BrowserWindow 残留。
- [ ] 登录成功 / 失败 / 取消都走 `finally { cleanup }`，任意一条异常路径
      都不会留下 timer 或 window。
- [ ] `maestro://` 协议回调若主窗口未就绪，回调进 buffer；renderer 注册
      consumer 时立即 flush。buffer 上限 10 分钟；超过 → renderer 注册
      consumer 后若超过 10 分钟，丢弃并显示 `AUTH_PROTOCOL_MISSING`。
- [ ] `POST /auth/spotify/cancel` 显式释放未消费的 PKCE flow（清
      `pendingFlows`），并清掉缓存的 `code_verifier` 防止日后被回放。

### Spotify 刷新

- [ ] 同一 session 的并发 refresh 由 `RefreshCoordinator` 单飞：第一个
      调用发请求，其余 await 同一 promise；refresh 进行中不再开第二个
      fetch。
- [ ] 刷新后的 token **经** `SessionService.setProvider` 写入触发
      `persist()`，确保重启后立刻能看到新 `expiresAt`。
- [ ] 旧的 PKCE flow 在 `pendingFlows` 里按 `sessionId` 索引：
      `exchangeCode` 必须校验发起此 flow 的 session 仍然持有它（防跨
      session 回放）。`startAuth` 给 `pendingFlows` 的条目附上
      `sessionId`。

### 错误反馈

- [ ] 引入统一错误码（union string literal）取代裸字符串错误：
  ```
  AuthErrorCode =
    | 'AUTH_CANCELLED'
    | 'AUTH_TIMEOUT'
    | 'AUTH_INVALID'
    | 'AUTH_EXPIRED'
    | 'AUTH_PROTOCOL_MISSING'
    | 'AUTH_BACKEND_DOWN';
  ```
- [ ] `<AuthErrorPanel>` 组件在 `auth.error` 非空时显示，含四个动作
      按钮：「重试」「重新登录」「切换音源」「粘贴 cookie」（QQ /
      NetEase）。
- [ ] 出错时 `auth.loggedIn` 立即翻为 `false`，避免 UI 与实际状态
      错位。

### 退出 / 队列

- [ ] 退出登录（`/auth/logout?provider=...`）调用 `LikeSyncQueue.purgeForProvider(sessionId, provider)`，避免队列里堆积「不再合法的」重试任务。

### 测试

- [ ] 服务端单测 ≥ 6 条：登录窗口失败转译、PKCE state 跨 session 拒
      绝、单飞 refresh 调度、PKCE TTL 过期清、token 持久化触发、登出队列
      清理。
- [ ] renderer 单元 / 集成测试覆盖 reducer 状态转移 + cleanup。
- [ ] Electron 端用 `login-window-runner` 的 fake `BrowserWindow` 做
      listener leak 测试：N=20 次 login/logout 周期后，注册的 listener
      数 = 0。
- [ ] 手动 smoke：20 个 QQ 登录/退出周期无残留窗口 / listener。

### 过期登录态的检测与提示（Phase 10，2026-10-08）

**背景** — 用户报障：长期不登录后启动播放器，**没有提示登录已过期，但歌曲放不了**。
附日志关键行：

```
QQ GetVkey 无 purl: mid=003cSLOO35W3yP, errtype=, hasCookie=true, uin=81295659
QQ lossless 无 purl(errtype=)，回退默认音质：004Gq0xE1YC8xp
[renderer ERR] [audio] error code=4 http://127.0.0.1:5173/music/stream/qq/...
```

**已用本机真实 cookie 复现**（`uin=81295659`，与日志一致）：

| 用同一个**已失效**的 cookie 测          | 结果                                             |
| --------------------------------------- | ------------------------------------------------ |
| GetVkey 免费歌（晴天 `004Gq0xE1YC8xp`） | `result=104003` `purl=""` `vkey=""` `errtype=""` |
| GetVkey 日志中那首（`003cSLOO35W3yP`）  | `result=104003` `purl=""` `vkey=""` `errtype=""` |
| 搜索 `client_search_cp`                 | ✅ 正常                                          |
| 歌词                                    | ✅ 正常                                          |
| 用户资料 `get_user_baseinfo_v2`         | ✅ 返回 nickname                                 |

→ **匿名/公开接口全好，只有需要鉴权的取流失败。** 所以「能搜到歌」完全不能证明
登录有效 —— app 因此看起来一切正常，一按播放就死。

#### 四层断链（每层单独都足以让提示出不来）

| #   | 位置                                            | 问题                                                                                                                                                                                                                |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `auth.controller.ts:212`                        | `loggedIn = Boolean(ps?.qqCookie)` —— 纯结构判断，**从不验证**。死 cookie 照报已登录                                                                                                                                |
| 2   | `useAuth.ts:157-172`                            | 24h 过期探测是**死代码**：触发后又调**同一个不验证的**端点，`fresh.loggedIn` 恒为 `true`，那个 `AUTH_EXPIRED` 分支永远走不到。注释「server will re-validate」**不成立**                                             |
| 3   | `qq.provider.ts:858-866`                        | 无 purl → 抛通用 `BadRequestException`，body **没有** `error:'AUTH_EXPIRED'`                                                                                                                                        |
| 4   | `music.controller.ts:665` + `usePlayer.ts:1044` | stream 端点把一切压成 `502 stream_unavailable`，而该 URL 交给 **`<audio src>`** —— 浏览器**读不到 body**。播放器只见 `MediaError code=4` → 重试 → 换源也失败 → 「音频加载失败，请尝试切歌」。**永不会有重登录提示** |

第 4 层最深：即使服务端正确返回 `AUTH_EXPIRED`，`<audio>` 这条路也传不到前端的
类型化错误处理（`api.json` 的 `AuthError` 机制）。

#### 关键设计取舍：不靠解码 `104003`

实测 `result=104003` 在**免费歌和 VIP 歌上完全相同**，且与无 cookie 时的响应一致。
它**可能**是「登录态失效」，但 QQ 未文档化该码，且 spec 原文写的判据是
「QQ 返回 `1000`」—— **与现实对不上**。

因此**不用错误码判据**，改用**探针歌判据**：拿一首确定免费的歌打 GetVkey，
拿不到 `purl`/`vkey` 就判定登录态已死。理由：

- 不依赖任何未文档化的错误码语义
- 降级安全：判错就退回今天的行为（通用错误），不会误伤
- 探针失败的信息价值 > 判据的精确性

#### 验收标准

- [ ] **QQ 登录态探针**：`probeQqSession(cookie, uin)` 打 GetVkey（探针歌
      `004Gq0xE1YC8xp` 晴天，标准音质无 filename），返回
      `{ alive: boolean; reason?: string }`。`purl` 或 `vkey` 任一非空 → `alive:true`
- [ ] **探针结果按 session 缓存**，TTL **10 分钟**；缓存命中不发请求。
      防抖：一次播放失败不应连打 QQ 多次
- [ ] **`GET /auth/status?provider=qq&validate=1`** 真正跑探针：
      探针判定失效 → `{ loggedIn:false, error:'AUTH_EXPIRED' }`；
      有效 → `{ loggedIn:true }`；不传 `validate=1` 时**保持现有行为**（不额外发请求）
- [ ] **启动即提示**（用户诉求核心）：renderer 启动 / 恢复前台时若
      `lastValidatedAt` 超过 24h，调 `validate=1`；返回 `AUTH_EXPIRED` →
      `dispatch({type:'fail'})` → 弹「重新登录」（复用现有 `<AuthErrorPanel>`）
- [ ] **修活第 2 层死代码**：`useAuth` 的 stale-probe 改为调 `validate=1`
      （而非同一个不验证的端点），且不要求 `lastValidatedAt != null` 才探测 ——
      `null`（老 session / 从未登录后重新写入）也要探
- [ ] **取流失败时回落到探针**：`getStreamPath` 拿不到 purl 时调
      `probeQqSession`；判定失效 → 抛**类型化** `AUTH_EXPIRED`
      （body 含 `error:'AUTH_EXPIRED'`），否则维持现有通用错误
- [ ] **stream 端点不再压平 auth 失败**：auth 类错误透传为
      `401 + {error:'AUTH_EXPIRED'}`；其余仍为 `502 stream_unavailable`
- [ ] **`<audio>` 盲区兜底**：`usePlayer.onError` 在「同源重试 + 跨平台
      fallback 都失败」之后，调 `GET /auth/status?provider=<cur>&validate=1`；
      返回 `AUTH_EXPIRED` → 跳重登录面板，**不再**只弹「音频加载失败」
- [ ] 探针不可用（网络异常 / QQ 改接口）→ **保守当作 alive**（不误报过期），
      降级为今天的行为
- [ ] 网易云 / Spotify 同样存在这条链（`musicU` / token 也会过期），本轮
      **只修 QQ**，但 `probeSession` 的形状按 provider 参数化，留好扩展点
- [ ] 错误体符合既有规范：`{ error: AuthErrorCode, message?: string }`，
      `AuthErrorCode` union **不新增成员**（复用已有 `AUTH_EXPIRED`）
- [ ] 单测：探针 alive/dead 两态、缓存命中不发请求、TTL 过期重探、
      `validate=1` 两种返回、无 `validate` 时行为不变（回归护栏）、
      `getStreamPath` 无 purl 时探针回落、stream 端点 auth 透传 401
- [ ] renderer 测试：`onError` 兜底探针命中过期 → 出重登录面板；
      探针说有效 → 仍走原通用错误
- [ ] 端到端：用失效 cookie 起 server → `curl '/music/auth-status?validate=1'`
      确认返 `AUTH_EXPIRED`；`curl '/music/stream/qq/<免费歌mid>'` 确认 401 + `AUTH_EXPIRED`
- [ ] `npm run typecheck && npm run lint && npm test` 全绿

#### 已知缺口（本轮不修，但要记）

- **登录前的凭据校验是假的**：`qq.strategy.ts:64-74` `loginWithCookie` 的 guard 用
  `get_user_baseinfo_v2`，实测**完全不带 cookie 也能返回资料**（按 uin 的公开
  查询）。所以 `tasks.md:18`「凭据校验后再持久化」拦不住过期 cookie ——
  一个死 cookie 能通过登录时的 guard 被写进 session。
  **Phase 10 的探针可以复用来修这条**（guard 改调 `probeQqSession`），
  但那是登录路径的改动，本轮先不动，列为 Phase 11。
- **网易云 / Spotify 的等价修复**：同一条链，未做。
- **`session.lastAccessedAt` 滑动 TTL 与 cookie 真实寿命是两回事**：
  本地滑动窗口不会让 QQ cookie 续命，所以「本地 session 还在」≠「QQ 侧还认」。

## 接口规格

### 后端新增

```
POST /auth/spotify/cancel
  → { ok: true }
  清掉当前 session 关联的 pendingFlows 条目（不暴露内部状态）。

POST /auth/event
  Request: { provider, attemptId, outcome: 'ok'|'fail'|'cancel', durationMs, errorCode? }
  → { ok: true }
  一次性埋点：renderer 上报一次登录尝试的结局。仅做日志，不做策略。

GET  /auth/status  (现有)
  Response 新增 lastValidatedAt: number | null（ms epoch），给 renderer
  做「老 token 24h 没校验过就主动 ping 一次」的依据。
```

### 错误体规范

```
HTTP 4xx / 5xx with body:
{ "error": AuthErrorCode, "message"?: string }
```

renderer `api.json` helper 检测到 `body.error ∈ AuthErrorCode` 时抛
`AuthError`，`useAuth` 据此触发 `error` 状态而非泛 `Error`。

### 过期登录态探针（Phase 10）

```
GET /auth/status?provider=qq&validate=1
  validate=1 → **真的**发一次探针请求判定登录态（带 10min session 级缓存）
  不传 / 传其它值 → 行为与现在完全一致（纯结构判断，不发额外请求）

  探针判定已失效：
    200 { provider:'qq', loggedIn:false, expired:true,
          error:'AUTH_EXPIRED',
          message:'QQ 登录已过期，请重新登录' }
  探针判定有效 / 探针本身不可用（网络异常、QQ 改接口）：
    200 { provider:'qq', loggedIn:true, ...现有字段 }
```

`expired:true` 是**给 renderer 用的明确信号**（`loggedIn:false` 单独出现时，
renderer 分不清是「从没登录过」还是「登录过期了」，前者不该弹重登录）。

服务端错误体不变：`{ error: AuthErrorCode, message?: string }`。

```
GET /music/stream/:provider/:trackId   （行为变更，Phase 10）
  之前：任何取流失败 → 502 { error:'stream_unavailable' }
  之后：auth 类失败（探针判定登录态已死）
        → 401 { error:'AUTH_EXPIRED', message:'…' }
        其余失败不变 → 502 { error:'stream_unavailable' }
```

> ⚠️ **`<audio>` 读不到这个 body。** 这个 401 是给
> `usePlayer.onError` 兜底探针**和**将来可能的 pre-flight 用的，
> **不是**指望 `<audio>` 能解析它。renderer 侧必须自己再问一次
> `validate=1`（见验收标准第 9 条）。

内部探针接口（不对外，仅 server 内）：

```ts
// packages/server/src/music/qq-session-probe.ts
export interface SessionProbeResult {
  alive: boolean;
  /** 仅日志用，不进任何响应体 / 不含 cookie */
  reason?: 'purl_present' | 'vkey_present' | 'no_vkey' | 'network_error';
  /** 本次是否真的发了请求（false = 命中缓存） */
  fetched: boolean;
}
export async function probeQqSession(cookie: string, uin: string): Promise<SessionProbeResult>;
```

缓存位置：`SourceHealthService` 旁的新 `SessionProbeCache`
（per-session Map，TTL 10min，`unref()` 定时清理）。

## 实现范围

- ✅ 上述所有验收项
- ❌ OS keychain / `safeStorage` 凭据加密（option C 内容，下一轮）
- ❌ 加密的「会话自动备份」（NEXT-ITERATION §3.1）

## 不做什么

- 不动 Spotify PKCE / OAuth 协议本身
- 不改 CORS / cookie 安全模型
- 不动 UI 视觉（只增加 `<AuthErrorPanel>` 一处）

### Phase 10 追加的不做什么

- **不**动网易云 / Spotify 的过期检测（等价链路，本轮只修 QQ）
- **不**改 `qq.strategy.ts` 登录路径的 guard（`get_user_baseinfo_v2` 不是
  真校验，另立 Phase 11 修）
- **不**给 stream 端点加重试 / 预检请求（避免每首歌多打一发）——
  renderer 侧兜底探针只在**已失败**后才发
- **不**在探针里做续期 / 自动重登（cookie 续期是 QQ 侧行为，客户端做不到）
- **不**把探针结果写进 `session.providers`（持久化一个会过期的判定，
  等于把 bug 从运行时搬到磁盘）

## Phase 10 风险与权衡

| 风险                                           | 说明                                                                     | 缓解                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **探针歌被下架 / 变成 VIP**                    | 判据依赖一首固定歌曲可播                                                 | 探针歌**只**用于判定，拿不到 purl 时还有 `vkey` 兜；两者皆空才判失效。判错的最坏后果 = 误报过期让用户重登一次，**不影响数据**。真出问题时把常量换掉即可（单点） |
| **误报过期**（探针本身出问题，如 QQ 临时抽风） | 用户被无端要求重登                                                       | 网络异常 / 非 JSON / 超时 **一律返回 alive:true**（保守）。宁可漏报也不误报 —— 漏报退回今天的行为，误报打断正常使用                                             |
| **多打请求**                                   | 每次校验都打一次 QQ                                                      | 10min session 级缓存 + 只在**已失败**后才探（不预检）。正常播放路径零额外请求                                                                                   |
| **修死代码会引出既有 bug**                     | `useAuth` stale-probe 从没真正跑过，接活后可能暴露别的问题               | 2.2 单独立项 + 独立测试；先跑 `npm test` 确认基线，再看差异                                                                                                     |
| **只修 QQ 的不一致**                           | 网易云 `musicU` / Spotify token 同样会过期，用户会问"为什么网易云不提示" | spec 明确写「本轮只修 QQ」，`probeSession` 按 provider 参数化留扩展点。网易云/Spotify 列为 Phase 11                                                             |
| **`<audio>` 拿不到 401 body**                  | 容易误以为改了 stream 端点就够了                                         | spec 接口节显式警告；renderer 侧 2.3 单独兜底。**两层都要做，缺一不可**                                                                                         |
| **判据不依赖错误码**                           | 好处是不猜；坏处是若 QQ 改了取流行为，探针会误判                         | 探针实现里把 `reason` 打进日志（`purl_present` / `no_vkey` / `network_error`），线上出问题能一眼看出是哪一档                                                    |

## Phase 10 附录：实测记录（2026-10-08）

**失效 cookie**（`uin=81295659`，与用户日志一致，取自 `packages/server/.storage/state.json`，
`lastAccessedAt=2026-10-08T05:45:10Z`）：

| 接口                                     | 结果                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| GetVkey `004Gq0xE1YC8xp`（晴天，免费）   | `result=104003` `errtype=""` `purl=""` `vkey=""` `isonly=0` `pneed=0` `isbuy=0` `pdl=0` |
| GetVkey `003cSLOO35W3yP`（用户日志那首） | 同上，逐字段一致                                                                        |
| 无 cookie 时的 GetVkey                   | 同上                                                                                    |
| `client_search_cp` 搜索                  | ✅ `code=0` 正常                                                                        |
| `c.y.qq.com` 歌词                        | ✅ 正常                                                                                 |
| `get_user_baseinfo_v2`                   | ✅ 返回 nickname（**无 cookie 也能返回**）                                              |

**有效 cookie**：⏳ **仍待补**（任务 F0/F1，本轮未做）。

⚠️ 因此「探针歌在有效态下能出 purl」这个前提**尚未实测**。本轮已用**失效**
cookie 端到端验通（`probeSession` 判死 / 缓存命中 / `getStreamPath` 抛
`AUTH_EXPIRED`），失效方向确定成立；**有效方向要等 F0 补上基线才算闭环**。

风险可控的原因：探针判错的最坏后果是"误报一次需要重新登录"，不影响数据、
不丢曲库。真正需要担心的是反向（有效 cookie 被判死 → 用户被反复要求重登），
这一点在 F0 完成前**没有实测保证** —— 上线前请务必先跑 F0。

### 本轮实测补充（14:2x，Phase 10 落地后）

用**同一个已失效 cookie** 走真实链路（非 mock）：

```
probeQqSessionUncached        → alive=false reason=no_vkey fetched=true
provider.probeSession 第 1 次  → alive=false fetched=true
provider.probeSession 第 2 次  → alive=false fetched=false   ← 缓存生效，未重复打网络
getStreamPath(免费歌)         → body.error=AUTH_EXPIRED
                                 "QQ 登录已过期，请重新登录"
```

→ 免费歌与 VIP 歌响应**逐字段完全相同** ⇒ 单靠 GetVkey 响应**无法**区分
「登录态失效」与「内容受限」，这正是选择探针歌判据而非错误码判据的原因。

## Phase 10 追加：首次上线的两个问题（2026-10-08 14:39 实机复现）

修完之后真机跑，后台日志链路全通（`validate` 调用 → 探针判死 → 抛
`AUTH_EXPIRED`），但**前端毫无反应**。两个问题，都不是当初 spec 能预见的。

### 问题 1：`fail` 被 `isCurrentAttempt` 静默丢弃

**根因** —— 过期检测复用了 `fail` action，而 `fail` 有
`isCurrentAttempt()` 门控（`auth/reducer.ts`）。那是给「用户刚点了登录、
这次尝试失败了」设计的：只有 attemptId 匹配当前尝试才生效。过期检测是
**事后**发现的（启动重校验 / 播放失败兜底），此刻 `phase` 已是
`authenticated`，`currentAttempt` 返回的是**上次登录**的 attempt id，
而我们传的是 `'stale-probe'` / `'play-failure-probe'` —— 永远匹配不上，
`return state` 静默丢弃，UI 什么都不会发生。

**修法** —— 新增专用 action `mark_expired`：

- 不做 attemptId 门控：它不是一次登录尝试的失败，是对**既有登录态**的判定翻转
- 幂等：`useAuth`（启动探测）和 `usePlayer`（播放兜底）可能各触发一次
- 同样翻 `loggedIn:false` / `user:null` / `phase:'failed'`，让 `AuthErrorPanel` 正常渲染

`useAuth` 的 `stale-probe` 与 `markExpired` 都从 `fail` 改为 `mark_expired`。

**教训** —— 「登录态失效」和「登录尝试失败」是两种不同的状态转移，混用
attemptId 门控会静默吞掉前者。reducer.test.mjs 加了 3 条（15/16/17），
其中 15 条**显式断言了旧写法会被丢弃**，把这个坑钉死。

### 问题 2：dev 端口硬编码 5173

本机同时跑着另一个 5173 前端时，vite 会**静默**换到 5175，而
`packages/electron/src/main.ts` 的 `loadURL` 写死 5173 → 窗口打开的是
**隔壁项目**，而 `/music` `/auth` 又经 vite 代理转到本项目 3200 ——
页面能渲染、登录态却莫名其妙，几乎无法从现象反推。

**修法** —— 脚手架级端口避让，三处硬编码全部收口：

| 位置                                              | 改法                                                        |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `packages/renderer/scripts/dev-port.mjs` **(新)** | 探测逻辑（lsof 同步探测，vite config 是同步求值没法 await） |
| `vite.config.ts`                                  | `port: resolveDevPort()`，冲突时打印醒目提示                |
| `packages/electron/src/dev-port.ts` **(新)**      | 同一套规则的 TS 实现，供 electron main 用                   |
| `packages/electron/src/main.ts`                   | `loadURL(devRendererUrl())`；歌词浮窗同样收口               |
| `packages/server/src/common/config.ts`            | **CORS allowlist 放行 5173–5199**                           |

最后一条最容易漏：只改 vite 和 electron 的话，换端口后 server 的 CORS 会把
所有 `/music` / `/auth` 请求拒掉，症状是「页面能开但什么都是 undefined」。

规则：`RENDERER_PORT` 显式指定则严格照用（占用即报错，不静默改）；
否则 5173 空闲就用，被占则向上找并**两边都打印实际端口**。
实测两侧算出同一个端口（5176），`RENDERER_PORT=6000` 也严格生效。

### 问题 2 的第一次修法也是错的（黑屏实录）

第一版让 **vite 和 electron 各自跑一遍同样的 `lsof` 探测**，逻辑写得几乎一致，
并在两侧注释里互相标注"必须保持同步"。实机一跑就是**黑屏**：

```
进程1 vite      启动探测：5173 空闲          → 决定监听 5173
进程2 electron 稍后探测：5173 已被 vite 占    → 决定连 5174
→ electron: Failed to load URL http://127.0.0.1:5174/ ERR_CONNECTION_REFUSED
```

**逻辑一致也救不了**：两个进程探测的**时间点不同**，同一端口在不同时刻状态就
不同 —— vite 探测时它自己还没占住 5173，electron 探测时 vite 已经占住了。
这是设计错误，不是边界情况。

第二版还踩了一个更隐蔽的坑：最初在 `configureServer` 钩子里读
`server.httpServer.address()`，但该钩子跑在 vite 真正 `listen` **之前**，
读到的仍是**配置的** 5173 而非实际的 5174 —— 端口文件写 5173、vite 却在 5174
监听，electron 照样连不上。

**最终形态：vite 写、electron 读。**

| 角色                   | 职责                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| vite（**唯一权威方**） | 在 httpServer 的 **`listening` 事件**里读实际端口，原子写进 `packages/renderer/.dev-port`（先写 tmp 再 rename）。退出时清掉，不给下次 dev 留过期值 |
| electron               | **只读**该文件，绝不自己探测。优先级：`RENDERER_PORT` > `.dev-port` > 5173 兜底。读不到时**打印明确提示**而不是静默连错端口                        |

实测：占住 5173 后起完整 dev 栈 → 端口文件 `5174` = vite 实际监听 = electron 连接，
0 个 `ERR_CONNECTION_REFUSED`，renderer 正常加载。

### 问题 2 的收尾：默认端口 5173 → 5273

避让机制只在"冲突时"救场，而**冲突本身是可以直接消除的**：5173 是 vite 的
历史默认端口，本机同时跑别的 5173 前端几乎是常态。改用一段不常用的 `5273`
后，常用路径压根不触发避让 —— 机制退化成纯粹的安全网，而不是每次都要靠它。

改动面（`5173` 在本仓库的**全部**硬编码点）：

| 位置                                             | 说明                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `packages/renderer/scripts/dev-port.mjs`         | `DEFAULT_DEV_PORT`                                         |
| `packages/electron/src/dev-port.ts`              | `DEFAULT_DEV_PORT` + 兜底说明                              |
| `packages/server/src/common/config.ts`           | CORS allowlist 改覆盖 `5273–5299`（抽成 `DEV_PORT_RANGE`） |
| `packages/server/.env.example`                   | `RENDERER_BASE` / `RENDERER_ORIGINS`                       |
| `README.md` / `README.zh-CN.md` / `README.ja.md` | 架构图 + 环境变量表                                        |

实测：5273 起完整 dev 栈 → 端口文件 `5273` = vite 实际监听 = electron 加载，
0 个 `ERR_CONNECTION_REFUSED`，**且未触发避让**；经 vite 代理的
`/music/search`、`/auth/status`、`/reco/status` 均 200；
CORS 预检对 `Origin: http://127.0.0.1:5273` 正确回 `Access-Control-Allow-Origin`。

`dev-port.test` 12 条，其中 7-11 锁的就是这条发布/读取链路
（actual 优先 configured、未发布返回 null、退出清理、纯数字原子写）。
