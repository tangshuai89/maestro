# Auth Resilience Tasks

## Phase 0 — 规格（已完成）
- [x] 1. 写 `specs/auth-resilience/spec.md`（验收 + 错误码 + 接口）
- [x] 2. 写 `specs/auth-resilience/design.md`（状态机 + 架构）
- [x] 3. 写 `specs/auth-resilience/tasks.md`（本文）

## Phase 1 — Renderer auth 状态机
- [x] 4. `packages/renderer/src/auth/types.ts`：`AuthErrorCode` union、`AuthError`、`AuthPhase` 类型
- [x] 5. `packages/renderer/src/auth/reducer.ts`：纯函数 reducer，状态转移 + cancel/timeout
- [x] 6. `packages/renderer/src/hooks/useAuth.ts` 改造为 reducer + 单 attempt + 120s 超时
- [x] 7. `packages/renderer/src/components/common/AuthErrorPanel.tsx`：四个动作按钮
- [x] 8. `App.tsx` 接入 `<AuthErrorPanel>`（独立于 ErrorPanel）
- [x] 9. 注入 auth reducer 测试（reducer 单测）

## Phase 2 — Electron login-window runner
- [x] 10. `packages/electron/src/auth/login-window-runner.ts`：单一所有权 runner（带 WeakMap listener 跟踪）
- [x] 11. `packages/electron/src/main.ts` 迁 `openQqLoginWindow` / `openNeteaseLoginWindow` 到 runner
- [x] 12. login-window-runner 单测：20 次 cycle 后 listener 数 = 0

## Phase 3 — maestro:// callback buffer
- [x] 13. `packages/electron/src/auth/oauth-buffer.ts`：`OAuthCallbackBuffer`（10min TTL）
- [x] 14. `packages/electron/src/main.ts` `app.on('open-url')` 改走 buffer.push，不直接 IPC
- [x] 15. `preload.ts` 加 `consumeOAuthCallback()` IPC
- [x] 16. `useAuth` 启动时调 `consumeOAuthCallback()`，10min 内命中即用，过期报 `AUTH_PROTOCOL_MISSING`
- [x] 17. 新增 `POST /auth/spotify/cancel` 端点（auth.controller）清 session 的 pendingFlows

## Phase 4 — 凭据校验后再持久化
- [x] 18. `qq.strategy.ts.loginWithCookie`：先以 withTimeout(5s) 调 `get_user_baseinfo_v2`；失败 → throw `BadRequestException('AUTH_INVALID')`
- [x] 19. `netease-auth.strategy.ts.loginWithCookie`：先 withTimeout(5s) 调 `/api/nuser/account/get`；失败 → throw `BadRequestException('AUTH_INVALID')`
- [x] 20. `netease-auth.strategy.ts.qrCheck`：803 拿到 MUSIC_U 后先 validate 再 setProvider
- [x] 21. `auth.controller` 把这些 throw 翻译成 400 + `{ error: 'AUTH_INVALID' }` 错误体

## Phase 5 — 滑动 session + 定时清理
- [x] 22. `Session` 增 `lastAccessedAt: number`；`require()` 滑动；老数据兜底 createdAt
- [x] 23. `SessionService` 加 `setInterval(60min, evictExpired).unref()` 定时清理
- [x] 24. `LikeSyncQueue` 加 `purgeForProvider(sessionId, provider)`
- [x] 25. `AuthController.logout` 调 queue.purgeForProvider

## Phase 6 — Spotify 单飞 refresh + 持久化
- [x] 26. `packages/server/src/auth/refresh-coordinator.ts`：per-session 单飞 refresh
- [x] 27. `spotify.provider.ts.refreshAccessToken` 改走 coordinator；写回改用 `setProvider` 触发 persist
- [x] 28. `pendingFlows` key 改为 `${sessionId}:${state}`；`exchangeCode` 校验 sessionId 匹配
- [x] 29. `startAuth` 接受 sessionId 参数（`auth.controller.startSpotify` 注入）

## Phase 7 — 错误反馈 + 翻译
- [x] 30. `packages/renderer/src/api.ts`：`json()` helper 检测 `body.error ∈ AuthErrorCode` 抛 `AuthError`
- [x] 31. `auth.status` 返回 `lastValidatedAt`；renderer 24h 未校验就 ping 一次
- [x] 32. `useAuth` reducer `fail` 状态翻 `loggedIn=false` 立即

## Phase 8 — Auth 埋点
- [x] 33. `auth.controller` 加 `POST /auth/event`（NestJS Logger，token / cookie 不打）
- [x] 34. `useAuth` 每次 attempt 结束（ok / fail / cancel）打一次埋点

## Phase 9 — 收尾
- [x] 35. `npm run typecheck` 干净
- [x] 36. `npm run lint` 干净
- [x] 37. `npm test` 全部通过
- [x] 38. 手动 smoke：20 次 QQ login/logout 周期无残留（runner.test.ts 自动化覆盖）
