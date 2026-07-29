# Auth Resilience — Design

## 1. 状态机

```
                 ┌──────────────┐
                 │    idle      │  ←── 初始
                 └──────┬───────┘
                        │ start()
                        ▼
                 ┌──────────────┐
                 │   starting   │  ←── server: create flow / open window
                 └──────┬───────┘
            validated │  │  invalid
            credential│  ▼
            ┌─────────┴────────┐
            ▼                  │
   ┌────────────────┐   ┌──────────────┐
   │  waiting_user  │   │   invalid    │──> AUTH_INVALID
   │  (QQ/Netease)  │   └──────────────┘
   └────────┬───────┘
            │ captured
            ▼
   ┌────────────────┐
   │   validating   │  ←── guard call (5s withTimeout)
   └────┬───────┬───┘
        │       │ timeout / fail
        │       ▼
        │   ┌──────────────┐
        │   │   expired    │──> AUTH_EXPIRED (cookie/token 失效)
        │   └──────────────┘
        ▼
   ┌────────────────┐
   │  authenticated │
   └────────────────┘

任何 state 上 cancel() / 120s timeout → cancelled
   ┌──────────────┐
   │  cancelled   │──> AUTH_CANCELLED | AUTH_TIMEOUT
   └──────────────┘

protocol buffer: callback 在窗口未就绪时到达
   → buffer(state, code) [10min TTL]
   → renderer registers consumer:
        - < 10min: flush → waiting_user
        - ≥ 10min: drop + AUTH_PROTOCOL_MISSING
```

## 2. 单飞 refresh 协调器

`RefreshCoordinator` 挂在 `SessionService` 旁边，per-session Map 持有
inflight Promise：

```
refresh(sessionId):
  if sessionId in inflight:
    return inflight[sessionId]      # 共享 promise
  p = doFetch().finally(() => delete inflight[sessionId])
  inflight[sessionId] = p
  return p
```

- 多个并发 `like` / `search` 同时发现 token 过期 → 第一个发起 refresh，
  其余 await 同一 promise
- refresh 完成 → `setProvider` 触发 `persist()`，重启不丢乐观态
- refresh 失败 → 设 `error = AUTH_EXPIRED` 到 session metadata（不
  清 token，让 UI 主动选择）

## 3. PKCE state 绑定 session

`pendingFlows` key 改为 `${sessionId}:${state}`：

```
startAuth(sessionId):
  state = randomBytes(16)
  pendingFlows[`${sessionId}:${state}`] = { codeVerifier, createdAt, sessionId }

exchangeCode(sessionId, code, state):
  flow = pendingFlows[`${sessionId}:${state}`]
  if !flow or flow.sessionId !== sessionId: throw AUTH_INVALID
  delete flow
  if now - flow.createdAt > TTL: throw AUTH_EXPIRED
  ...
```

`POST /auth/spotify/cancel` 扫 `pendingFlows` 删 `key.startsWith(sessionId + ':')` 的项。

## 4. 登录窗口 runner

`packages/electron/src/auth/login-window-runner.ts`：

```
runLoginWindow<T>(cfg: {
  url: string,
  captureFn: (win: BrowserWindow) => Promise<T | null>,
  cookies: { domains: string[], requiredMarker?: string },
  onCaptured: (result: T) => void,
  deadlineMs: number = 120_000,
}): Promise<T>
```

单一所有权：内部 `let cleanup: (() => void) | null = null;`，`try { ... }
finally { cleanup?.() }`，保证 `cookies.off('changed')`、`clearInterval`、
`closeOrHideWin` 都跑了。`WeakMap<webContentsSession, Set<Listener>>` 跟踪
listener，配合 `off()` 避免 leak。

`openQqLoginWindow` / `openNeteaseLoginWindow` 改为薄壳 → 调
`runLoginWindow`。

## 5. 协议 callback buffer

`packages/electron/src/auth/oauth-buffer.ts`：

```
class OAuthCallbackBuffer {
  private pending: Map<string, { code, state, expiresAt }> = new Map()
  private consumer?: (code, state) => void
  static TTL_MS = 10 * 60_000

  push(state, code, state)   // open-url 调用
  registerConsumer(fn)        // renderer 启动后注册
}
```

`app.on('open-url', ...)` 调 `buffer.push(...)`；renderer 端 `useAuth` 启
动时 `window.electronAPI.on('spotify:oauth-protocol', handler)`，但
main 端不再 push 事件给一个不存在的 consumer，而是让 renderer 来
pull。preload 暴露 `consumeOAuthCallback()` 给 renderer 一次性拉取。

## 6. 错误反馈组件

`packages/renderer/src/components/common/AuthErrorPanel.tsx`：

```
interface Props {
  provider: MusicProvider
  error: AuthError
  onRetry: () => void       // re-attempt
  onReLogin: () => void     // 调回 handleXxxLogin
  onSwitch: () => void      // 回到 SourceSelect
  onPasteCookie?: () => void // 打开 NeteaseCookieModal (QQ/Netease only)
}
```

挂在 `App.tsx` 根节点附近，独立于 `<ErrorPanel>`（那是 cover-card 内的
通用错误条）。新组件接收 `auth.error`（reducer 暴露的
`AuthError | null`），不可见时不渲染。

## 7. 滑动 session + 定时清理

`Session` 增 `lastAccessedAt: number`，`SessionService.require()` 调一次
就更新。`onModuleInit` 启一个 `setInterval(60min, evictExpired)`，用
`unref()` 不阻塞进程退出。`evictExpired` 改用 `now - lastAccessedAt > ttl`。

`LikeSyncQueue` 新增 `purgeForProvider(sessionId, provider)`：
删 `pending` / `active` 中所有 `task.session.id === sessionId &&
targets.some(t => t.platform === provider)` 的项。

`AuthController.logout` 调 `likeSyncQueue.purgeForProvider(session.id, p)`。

## 8. 状态文件迁移

`Session` 增 `lastAccessedAt`；老数据缺这个字段 → 在 `evictExpired` /
`require` 里 `s.lastAccessedAt ??= s.createdAt` 兜底。无破坏性变更。

## 9. 测试策略

- `server`: Node assert + 注入 fake fetch。覆盖 PKCE 跨 session 拒绝、
  RefreshCoordinator 单飞、setProvider 触发 persist（mock Storage）、
  队列清理。
- `renderer`: 用 vitest 风格 runner（沿用项目 ts-node 单测模式）写
  reducer 测试：start / cancel / succeed / fail 转移。
- `electron`: login-window-runner 的 fake `BrowserWindow` 测；不开
  真窗口。

## 10. 范围外

- OS keychain / safeStorage（option C）
- 加密 auto-backup（NEXT-ITERATION §3.1）
- 多账号 / per-source 重登录 UI
- 改 CORS / cookie 模型
