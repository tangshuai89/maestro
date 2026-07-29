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

## 实现范围

- ✅ 上述所有验收项
- ❌ OS keychain / `safeStorage` 凭据加密（option C 内容，下一轮）
- ❌ 加密的「会话自动备份」（NEXT-ITERATION §3.1）

## 不做什么

- 不动 Spotify PKCE / OAuth 协议本身
- 不改 CORS / cookie 安全模型
- 不动 UI 视觉（只增加 `<AuthErrorPanel>` 一处）
