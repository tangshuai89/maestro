# Spotify Adapter

## 做什么

把 Spotify 作为第四个音乐源接入：
- 登录：OAuth PKCE（不需要 client secret，纯前端友好的标准流程）
- 搜索：Web API `/v1/search`
- 播放：Web API `/v1/tracks/{id}` → preview_url（30s 预览，同 Deezer 限制）
- ❤：Web API `/v1/me/tracks` (PUT/DELETE)
- liked 导入：Web API `/v1/me/tracks`

## 验收标准

- [ ] 登录入口：用户填 client_id → /auth/spotify/start 跳到 accounts.spotify.com 授权
- [ ] 回调 /auth/spotify/callback 收 code → 用 PKCE verifier 换 access_token + refresh_token
- [ ] token 持久化到 .storage（access + refresh + expires_at）
- [ ] access_token 过期（1 小时）→ 自动用 refresh_token 续
- [ ] 搜索返回 Web API 标准化 Track[]
- [ ] 播放走 preview_url（30s 限制同 Deezer，UI 提示）
- [ ] ❤ PUT/DELETE 写远端 liked
- [ ] liked 导入：拉 me/tracks → 进统一库
- [ ] 区域受限（preview_url=null）→ 仍展示但灰态（无版权）
- [ ] 客户端 ID 缺失 → 友好提示"先去 Spotify Developer 申请"

## 接口规格

### 后端

```
GET  /api/auth/spotify/status
→ { configured, loggedIn, expiresAt? }

POST /api/auth/spotify/start
Request: { clientId?: string }   // 不传 = 用之前保存的
Response: { authorizeUrl, codeVerifier, state }
   → renderer 跳到 authorizeUrl
   → state 写 session，callback 校验

GET  /api/auth/spotify/callback?code=&state=
→ 校验 state，code + verifier 换 token
   → 写 session.providers.spotify = { accessToken, refreshToken, expiresAt }

POST /api/auth/spotify/logout
→ 清 token

GET  /api/auth/spotify/client-id
POST /api/auth/spotify/client-id
Request: { clientId }
→ 存到 .storage/secrets.json（git-ignored）
   ⚠️ 跟 DeepSeek key 同样规则：只本地，不上传
```

### Spotify 端点

```
GET  /api/music/search?provider=spotify&q=...
   走 Spotify Web API /v1/search?q=...&type=track&limit=30

GET  /api/music/stream/spotify/{trackId}
   重定向到 preview_url（30s mp3），或 502 'no_preview' 当没有
```

## 实现范围（v1）

- ✅ OAuth PKCE 完整闭环（start / callback / refresh）
- ✅ search：Web API 调用 + 字段映射到 Track
- ✅ getStreamPath：preview_url 暴露
- ✅ like/unlike：PUT/DELETE /v1/me/tracks
- ✅ fetchLiked：GET /v1/me/tracks，importLiked 接入
- ❌ 完整曲库播放（Spotify 不允许非 Premium 完整曲流，仅 30s 预览）
- ❌ 设备切换 / Web Playback SDK

## 不做什么

- 不做"歌词"（Spotify API 需要另外 scopes，本轮不申请）
- 不做"按 genre 搜"（同 QQ 一样只走关键词搜索）
- 不做 client credentials 流程（PKCE 已经够 user 用）

## 技术约束

- 新模块 packages/server/src/music/spotify.provider.ts
- MusicProvider 接口：search / getStreamPath / like / unlike / fetchRadioBatch / fetchLiked
- 复用 P3 MatchService 匹配 Spotify 与其他平台
- 复用 P1 fanOutLike 把 ❤ 写到 Spotify
- 复用 P2 importLiked 把 Spotify liked 拉进统一库
- 客户端 ID 走 .storage secrets，跟 DeepSeek key 同档管理
- token 存 session.providers.spotify，刷新逻辑自己写（不依赖外部 SDK）

---

# v2：全曲播放（Web Playback SDK）+ ❤ 写回

> v1 只做到 30s 预览。v2 把 Spotify 提到"平台对等"：Premium 全曲播放 +
> ❤ 真正写进用户 Spotify 库。

## 做什么

1. **❤ 写回**（任何登录用户，不需要 Premium）：`fanOutLike` 已把 spotify 的
   `like/unlike` 路由到 `PUT/DELETE /v1/me/tracks`，`user-library-modify`
   scope 也早就在。v2 只补一个白盒测试锁死这个 HTTP 往返（之前只测响应形状，
   没测真调用）。
2. **全曲播放**（Premium-only）：接 Spotify Web Playback SDK。当统一 track 的
   `bestSource === 'spotify'` 且用户是 Premium 且 WPS 已连 → 走 SDK 全曲流；
   否则回退 v1 的 30s 预览代理路径。

## 架构

- **SDK 宿主**：同一个 renderer window（不另开隐藏 BrowserWindow）。
  `index.html` defer 加载 `https://sdk.scdn.co/spotify-player.js`。
- **token 桥**：新增 `GET /auth/spotify/token`，返回 `{ accessToken, expiresAt,
  tier }`；server 自动 refresh 过期 token。renderer 把 accessToken 喂给 SDK，
  SDK 自管 WebSocket 续连；renderer 用 expiresAt 提前 60s 重拉 + reconnect。
- **tier 缓存**：`exchangeCode` 时多查一次 `/v1/me` 读 `product` 字段，缓存到
  `session.spotify.tier`（premium/free/open）。新增 `GET /auth/spotify/me` +
  扩展 `GET /auth/spotify/status` 带 tier。老 session 缺 tier → `getMeInfo`
  懒查一次补上。
- **播放路由**：`usePlayer` 收一个 `wpsRef`（打破 App↔usePlayer 循环依赖）。
  spotify + premium + wpsReady → transport（play/pause/resume/seek）走 WPS，
  且 `presentTrack` 把 spotify track 的 `audioUrl` 清空（防 `<audio>` 同时播
  30s 预览造成双声道）。其他情况维持原 `<audio>` 路径不变。WPS 的
  `player_state_changed` 的 position/duration 通过 `applyWpsProgress` 喂回
  usePlayer 的时间轴，UI 其余部分对 WPS 无感知。
- **feature flag**：整条 WPS 路径被 `tier === 'premium'` 门控。Free / 未登录 /
  非 spotify → `wpsReady` 恒 false，行为与 v1 完全一致。
- **Electron 运行时（Widevine + VMP）**：WPS 靠 EME/Widevine CDM 解密整曲流，而
  vanilla Electron 不带 CDM，且 Spotify 的 license 服务器要求宿主二进制带 VMP
  （Verified Media Path）签名——手动下 CDM 也过不了 VMP，是死路。因此运行时换成
  **castLabs Electron fork**（当前 `github:castlabs/electron-releases#8244344`，即
  `v43.2.0+wvcus`；曾用 `v31.7.7+wvcus`，**2026-08 升级**——v31 的 Component Updater
  协议被 Google 服务器拒，CDM 永远装不上）：内置 CDM + VMP 签名。
  `main.ts` 在建窗口前 `await components.whenReady()` 等 CDM 就绪。
- **⚠️ dev VMP 签名被 Spotify 生产 license server 拒**：castLabs fork 的 `+wvcus` 构建
  是 **dev VMP 签名**（README 原话："For production use you can sign up for our
  EVS service"），dev 签名过不了 Spotify 生产 license server 的 VMP 校验 → license
  请求返 500 → 播放会话建不起来 → `playback_error` + `hasTrack=false` + 30s 卡死。
  根因诊断日志（PR #53 落地）：

  ```
  POST https://api.spotify.com/v1/widevine-license/v1/audio/license 500 (Internal Server Error)
  [wps-debug][fatal] playback_error（非致命） {"message":"Playback error"}
  ```

  **修复路径（见下「打包 / VMP」+ 0.Apple Dev + castLabs EVS 落地）**：
  castLabs EVS（Electronic Video Service）——**完全免费**（公开承诺 2020-09-04 wiki，
  签 streaming signature 不收费，个人开发者零成本），但**只对 ECS v6+ 官方 fork 有效**，
  本项目用的就是标准 ECS v43 fork，无 3PL 审计问题。EVS 签出 .app 后 WPS 路径
  license 返 200 → 全曲播放。dev 直接跑 `+wvcus` 永远卡 30s（dev 签名），必须签出
  prod-signed 二进制才能放歌。

- **全链路调试开关 `?wpsDebug=1`**（PR #53）：`packages/renderer/src/lib/debug.ts`
  统一读取 URL/localStorage，渲染端打 `[wps-debug][category]` 类别日志覆盖
  `wpsEnabled` / `tier` / `SDK ready` / `connect` / `ready poll` / `fatal` /
  `widevine`（IPC `widevine:status` 从 main 拉 components.status()） / `transfer` /
  `play` / `presentTrack` 决策。Console 还暴露 `__wpsDebugOn()` / `__wpsDebugOff()` 立即
  toggle 并 reload。诊断 Widevine / EME / 设备注册 / transfer / play 各环节用。
  加上 `device_id 404` 在 `transferHere` / `play` 里**退避重试 0.5s/1.5s/3s**（Spotify
  Connect 设备注册延迟）——但这是 v43+ 的旧问题，dev 签名下 device 永远不在生产
  设备列表，重试也救不回来。

## 打包 / VMP

electron-builder 会重组包 + macOS codesign，把 castLabs 原始 VMP 签名弄失效，
所以打包产物必须用 **castLabs EVS（Electronic Video Service）** 重新 VMP 签名
（且在 codesign 之前；Windows 在 codesign 之后——EVS 客户端会按平台自动决定时序）。
**EVS 完全免费**（castLabs 公开承诺 2020-09-04 wiki），签 streaming signature
不收费；账号永久可用，OAuth-style e-mail 验证。

- `package.json build.afterPack` → `afterPack-vmp.cjs`：mac 平台调
  `python3 -m castlabs_evs.vmp sign-pkg <appOutDir>`，早于 electron-builder 的
  codesign 阶段。
- `build.electronDist` 指向本地 castLabs `node_modules/.../electron/dist`
  （当前 v43.2.0+wvcus），避免 electron-builder 按版本号去官方镜像下 vanilla Electron
  （会丢 Widevine）。
- **一次性前置（本机手动）**：
  1. **Apple Developer Account**（$99/年，[developer.apple.com](https://developer.apple.com/programs/enroll/)，
     1–3 天批）—— code-sign / notarize 必需
  2. `pip install --upgrade castlabs-evs`
  3. `python3 -m castlabs_evs.account signup`（e-mail 收验证码，凭据缓存 `~/.castlabs-evs/`）
  4. CI 化（可选）：`EVS_NO_ASK=1` + GitHub Actions secret 注入
- **EVS 规则**：避免创建冗余账户、避免重复签名（已有有效签名时不签，节省 quota）、
  按用途选 `streaming` / `persistent`（Spotify 走 `streaming` 即可）
- 逃生阀 `SKIP_VMP=1 npm run pack`：跳过签名，只验打包管线；产物的 Spotify
  全曲不可用（退回 30s，**dev 签名被生产 license server 拒**），其它源正常。

## v2 验收标准

### 可在本环境自动验证

- [x] `like()` → `PUT /v1/me/library?uris=spotify:track:{id}`，header 带 Bearer
  （旧 `PUT /v1/me/tracks` body `{ids:[trackId]}` 已 deprecate；spec 已更新到新端点）
- [x] `unlike()` → `DELETE /v1/me/library?uris=spotify:track:{id}` 同上
- [x] `like()` 遇非 2xx（401 等）→ `success:false` 不抛
- [x] `getValidTokenForRenderer`：无 session → null；有效 → 透传 accessToken + tier
- [x] `SPOTIFY_SCOPES` 含 `user-read-email` + `streaming` + `user-modify-playback-state`
- [x] typecheck 干净、renderer vite build 通过、SDK script 进构建产物
- [x] electron 依赖换成 castLabs fork（`v31.7.7+wvcus`）、`components.whenReady()` 接入、`components.status()` 报 Widevine 就绪（不需 Premium）

### 需 Premium 账号手动验证（本轮开发者无 Premium，代码 code-complete 未运行验证）

- [ ] Premium 账号能从 Spotify 源直接播**完整**曲目（>30s）
- [ ] Spotify 桌面端能看到 "maestro-xxxx" 设备
- [ ] pause / resume / skip / seek transport 生效
- [ ] token 到期（1h）时自动重连不掉播
- [ ] 打包 DMG（经 EVS VMP 签名）后 Premium 仍能播整曲

### Free 账号可验证（回退路径）

- [ ] Free 账号播 Spotify 曲目仍走 30s 预览（v1 路径），无回归

## v2 不做什么

- 不做 WPS 曲末自动切下一首（`<audio>` 的 `onEnded` 对无 src 的 spotify track
  不触发；WPS 的曲末检测不可靠且无法本地验证）。用户手动 skip。**已知限制**。
- 不做 Spotify 歌词（要另外 scope，deferred）。
- 不做设备跨重启持久化（Spotify Connect 设备本就是临时的）。
- 不做非 Premium 的 Web Playback（Spotify 硬性限制，接不了）。

## v2 已知限制

- **WPS 全链路未在本地运行验证**（开发者无 Premium）。缓解：Free 路径不变、
  WPS 被 tier 门控、写回路径有测试锁死。上线前需 Premium 账号跑一遍手动验收。
  Widevine 坑已解（换 castLabs fork），`components.status()` 可在无 Premium 时验组件就绪。
- **打包产物未验证**：VMP 签名需 castLabs EVS 账号（一次性 signup），且验整曲仍需
  Premium。`npm run pack` 另受 packaging spec task 16 的环境依赖阻塞。`afterPack`
  钩子已就位，逻辑 code-complete、未实跑。
- **⚠️ 本机（腾讯 iOA）挡 Widevine CDM 下载**：castLabs 31.7.7 只有 `+wvcus`
  变体——CDM 不打进二进制，首次 `components.whenReady()` 时从 Google 组件服务器
  （`redirector.gvt1.com/edgedl/widevine-cdm/...`）运行时下载。实测本机该下载被 iOA
  网关拦截：组件更新器 `Update completed with error 0` 但 `WidevineCdm/` 始终为空，
  直接 curl CDM zip 返回的是 567 字节 HTML 拦截页（`<HTM...`）而非 ZIP（`PK..`）。
  → **代码/配置正确**（typecheck+build 通过、`components.whenReady()` 已接），但本机
  拉不到 CDM，全曲无法在此验证。换到无 TLS 拦截的网络（个人网络 / 已装 CDM 的机器）
  即可。这是环境限制，非代码缺陷。
- **WPS token 中途轮换**：SDK 不自动 refresh；`useSpotifyWpsPlayer` 每 30s 检查
  一次 expiresAt，将到期（<60s）就重拉 token + reconnect。设备名不变，位置能续。
- **网络出口**：需能访问 `sdk.scdn.co` + `*.spotify.com`（含 wss）。仅在用户
  主动选 Spotify + Premium 登录后才加载，不后台预载。
