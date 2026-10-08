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

## Phase 10 — 过期登录态的检测与提示（2026-10-08）

> 起点：用户报障「长期不登录后启动播放器，没有提示过期了，但歌曲不能放了」。
> 根因分析见 spec.md「过期登录态的检测与提示」节（四层断链 + 复现证据）。
> 执行前请先跑 `/tmp/probe-qq-valid.mjs` 拿**有效 cookie** 基线（见 F0）。

### Phase -1 — 验证前置（阻塞全部）

- [ ] F0 拿到**有效 cookie** 的对照基线：重新登录 QQ 后跑
      `/tmp/probe-qq-valid.mjs`，确认探针歌（`004Gq0xE1YC8xp` 晴天）在有效态下
      `purl`/`vkey` **非空**。这是「探针歌判据」成立的前提。
      **拿不到就不要往下写** —— 否则整个方案是猜的
- [ ] F1 记录 `result` / `errtype` 在有效态下的取值，补进 spec 附录
      （若发现 `104003` 确实专表登录态失效，可在后续简化判据）

### Phase 0 — 探针本体

- [x] 0.1 新建 `packages/server/src/music/qq-session-probe.ts`：
      `probeQqSession(cookie, uin)` → `{ alive, reason, fetched }`
      判据 = `purl || vkey` 任一非空即 alive。**不解析任何错误码**
- [x] 0.2 探针请求套 `withTimeout(5s)`；网络异常 / 非 JSON / 解析失败
      → **返回 alive:true**（保守，宁可漏报不可误报）
- [x] 0.3 新建 `SessionProbeCache`（per-session Map，TTL 10min，
      `setInterval(...).unref()` 清理），挂在 service 旁
- [x] 0.4 探针单测：purl 存在 / vkey 存在但 purl 空 / 两者皆空 /
      网络异常 / 非 JSON —— 5 条
- [x] 0.5 缓存单测：命中不发请求（计数断言）/ TTL 过期重探 / 不同 session 隔离

### Phase 1 — 服务端接线

- [x] 1.1 `QqMusicProvider` 暴露 `probeSession(session)`，走缓存
- [x] 1.2 `auth.controller.status` 支持 `validate=1`：跑探针，失效时返回
      `{ loggedIn:false, expired:true, error:'AUTH_EXPIRED' }`；
      **不传 validate 时行为与现在完全一致**（回归护栏，必须有单测）
- [x] 1.3 `qq.provider.getStreamPath`：无 purl 时回落到探针；判定失效 →
      抛 `BadRequestException({ error:'AUTH_EXPIRED', message })`（带 error 字段）
- [x] 1.4 `music.controller.stream`：识别 auth 类错误 → `401 + {error:'AUTH_EXPIRED'}`；
      其余仍 `502 stream_unavailable`
- [x] 1.5 端点级测试：validate=1 两种返回 / 不带 validate 的回归 /
      stream 的 401 与 502 分流

### Phase 2 — Renderer 接线

- [x] 2.1 `api.ts`：`authStatus` 支持 `validate` 参数；`UnifiedAlbum`
      无关，不动
- [x] 2.2 `useAuth`：stale-probe 改调 `validate=1`（**修死代码**），
      且去掉 `lastValidatedAt != null` 的前置条件（老 session 也要探）
- [x] 2.3 `usePlayer.onError` 兜底：同源重试 + 跨平台 fallback 都失败后，
      调 `validate=1`；`AUTH_EXPIRED` → 走重登录面板，
      否则维持「音频加载失败」通用错误
- [x] 2.4 renderer 测试 —— `api.test.mjs` 加 6 条（43-48）：validate=1 URL / expired 透出 /
      **从没登录过不误标 expired** / 有效态不标 expired。
      ⚠️ `usePlayer.onError` 兜底与 `useAuth` stale-probe 本身**还没有组件级测试**
      （仓库现状：hooks 只有 usePlayer.test.mjs 的纯逻辑测试，无 React 组件测试基建）。
      这两条路径靠 `api.test.mjs` 的契约测试 + 端到端 curl 兜住，
      组件级测试列为 Phase 12 基建项

## Phase 10 追加：首次上线的两个问题（2026-10-08 14:39）

- [x] 10.1 定位「后端日志全通、前端无反应」：reducer 的 `fail` 有
      `isCurrentAttempt` 门控，过期检测传的 attemptId 匹配不上 → **静默丢弃**
- [x] 10.2 新增 `mark_expired` action（不门控 attemptId，幂等），`useAuth` 的
      `stale-probe` 与 `markExpired` 都改用它
- [x] 10.3 reducer.test.mjs 加 15/16/17 三条，其中 15 条显式断言**旧写法会被
      丢弃**，把这个坑钉死
- [x] 10.4 dev 端口硬编码 5173 → 脚手架级避让 - `packages/renderer/scripts/dev-port.mjs`（新）+ `vite.config.ts` 收口 - `packages/electron/src/dev-port.ts`（新）+ `main.ts` 两处 loadURL 收口 - `packages/server/src/common/config.ts` CORS allowlist 放行 5173–5199
      （**最易漏**：不改则换端口后所有 /music /auth 被 CORS 拒）
- [x] 10.5 实测：5173 被占 → vite 与 electron 两侧算出**同一个** 5176；
      `RENDERER_PORT=6000` 严格照用
- [ ] 10.6 补 `dev-port` 的单测（lsof 不可用时的降级 / MAX_TRIES 边界）

### Phase 3 — 验证与收尾

- [x] 3.1 端到端：用**失效 cookie** 起 server - `curl '/auth/status?provider=qq&validate=1'` → `AUTH_EXPIRED` - `curl '/auth/status?provider=qq'`（不带 validate）→ 仍是 `loggedIn:true`（回归护栏）- `curl '/music/stream/qq/004Gq0xE1YC8xp'` → `401 + AUTH_EXPIRED`
- [ ] 3.2 端到端：用**有效 cookie** 重复上述三条 → 全部正常播放 / 200 - 🔴 **仍被 F0 阻塞**：没有有效 cookie 基线，本条未做
- [x] 3.3 `npm run typecheck && npm run lint && npm test` 全绿
- [x] 3.4 清理 `/tmp/probe-*.mjs`（不进仓库）
- [ ] 3.5 把有效态基线补进 `spec.md` 附录；把「`get_user_baseinfo_v2` 不是真校验」
      这一发现补进 Phase 11 线索（`loginWithCookie` 的 guard 该换成探针）
