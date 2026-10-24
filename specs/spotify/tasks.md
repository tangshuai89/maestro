- [x] 1. packages/server/src/music/spotify.provider.ts: 实现 MusicProvider 接口 (search/getStreamPath/like/unlike/fetchRadioBatch/fetchLiked + PKCE startAuth/exchangeCode + token refresh)
- [x] 2. OAuth PKCE: /auth/spotify/start + /callback + token refresh
- [x] 3. 客户端 ID 管理（同 DeepSeek key，存 secrets.json:spotify-client-id）
- [x] 4. 接入 MusicProvider 注册表（common/provider.ts 加 'spotify'）
- [x] 5. 接入 searchUnified / getStreamPath / fanOutLike / importLiked
- [x] 6. 前端 api.ts：startSpotify / getSpotifyStatus / setSpotifyClientId（v1 已实际接线，非 TODO）
- [x] 7. 前端音源选择页加 Spotify 项（v1 已实际接线：SourceSelect / SourceMenu / useAuth.handleSpotifyLogin）
- [x] 8. 白盒测试 7 条：PKCE URL 包含所有 OAuth 参数 / exchangeCode invalid state 拒绝 / isConfigured 边界 / token 过期 refresh 路径 / saveToken 不可变
- [x] 9. typecheck + 39/39 测试通过（search 12 + match 8 + reco 12 + spotify 7）
- [x] 10. e2e: 5 个 case (status / no client_id 400 / 短 client_id 400 / set client_id 200 / start returns real accounts.spotify.com URL)

## v2（全曲播放 + ❤ 写回）

- [x] 11. scopes 加 user-read-email + user-modify-playback-state（streaming 已在）
- [x] 12. exchangeCode 缓存 tier（/v1/me product）到 session.spotify.tier；session.ts 扩字段
- [x] 13. provider 加 getValidTokenForRenderer + getMeInfo + fetchMeInfo
- [x] 14. auth.controller 加 GET /auth/spotify/token + /me；status 带 tier
- [x] 15. renderer lib/spotify-wps.ts：WPS SDK 包装（connect/play/pause/resume/seek/transferHere/onStateChange）
- [x] 16. renderer hooks/useSpotifyWpsPlayer.ts：懒初始化 + token 续期重连 + 状态镜像
- [x] 17. api.ts：getSpotifyStatus 带 tier + getSpotifyToken + getSpotifyMe；AuthStatus 加 tier
- [x] 18. useAuth：透出 tier（登录成功 + provider 切换两条路径）
- [x] 19. SourceSelect：按 tier 切 desc（premium=全曲 / free=30s 预览）
- [x] 20. usePlayer：wpsRef 参数 + spotify+premium+wpsReady 分支（play/pause/resume/seek + audioUrl 清空 + applyWpsProgress 时间轴桥）
- [x] 21. App.tsx：wpsRef 桥接 usePlayer↔useSpotifyWpsPlayer 循环 + WPS 进度回喂
- [x] 22. index.html：defer 加载 sdk.scdn.co/spotify-player.js
- [x] 23. spotify.test.ts 加 5 条 v2 白盒（like PUT / unlike DELETE / like 401 / getValidTokenForRenderer 边界）——共 12 条
- [x] 24. typecheck 干净 + npm test 全绿（55+ case）+ renderer vite build 通过 + SDK script 进产物
- [ ] 25. 【需 Premium 手动】全曲播放 / 设备可见 / transport / token 重连 —— 开发者无 Premium，代码 code-complete 未运行验证（见 spec v2 验收）

## v2.1（Widevine 运行时：换 castLabs Electron —— 解决 WPS 起不来的真正卡点）

> v2 应用层 code-complete 但 vanilla Electron 无 Widevine CDM + 无 VMP 签名，
> WPS 永远 initialization_error 退 30s。换 castLabs fork 解决。

- [x] 26. electron devDep 换 `github:castlabs/electron-releases`（drop-in，同版）+ npm install
  - 2024-08 锁 v31.7.7+wvcus，2026-08 升级到 **v43.2.0+wvcus**（commit `8244344`）——
    v31 的 Component Updater 协议被 Google 服务器拒，CDM 装不上；
    v43 走当前协议，Widevine CDM v4.10.3050.0 装好
- [x] 27. main.ts: import `components` + 建窗口前 `await components.whenReady()` + log `components.status()`
- [x] 28. main.ts: 删无效的 `enable-features=EncryptedMedia` hack + 修 webPreferences Widevine 注释
- [x] 29. 删死路脚本 scripts/get-widevine-cdm.js（手动下 CDM 过不了 VMP）
- [x] 30. 打包 VMP：afterPack-vmp.cjs 调 `castlabs_evs.vmp sign-pkg`（codesign 前）+ build.afterPack + build.electronDist 指本地 castLabs dist
- [x] 31. typecheck 干净 + build:electron 通过 + 启动看 components.status() Widevine 就绪
- [ ] 32. ⚠️ 本机 iOA 挡 CDM 运行时下载：`components.whenReady()` 报 error 0 但 WidevineCdm/ 空，直连 CDM CDN 返回 567B HTML 拦截页。代码/配置正确，全曲无法在此机验证（见 spec v2 已知限制）
- [ ] 33. 【需无 TLS 拦截网络 + Premium 手动】dev 下 CDM 能下 + Premium 播整曲；【需 EVS 账号 + Premium】打包 DMG VMP 签名后仍能播整曲

## v2.2（调试：定位"Premium 但仍 30s"根因 → 锁在 license 500）

> v2.1 把 CDM 装好了，但 Premium 实际播放仍卡 30s。PR #53 加全链路调试，
> 定位到 **Spotify license server 500**：castLabs fork `+wvcus` 是 **dev VMP 签名**，
> 被生产 license server 拒。修复路径 = **v2.3 Apple Dev + castLabs EVS**（见下）。

- [x] 34. `?wpsDebug=1` URL 开关 + `__wpsDebugOn()/Off()` console toggle + localStorage 持久化（`packages/renderer/src/lib/debug.ts`）
- [x] 35. App.tsx / useSpotifyWpsPlayer / spotify-wps 全链路 `[wps-debug]` 日志（wpsEnabled/tier/SDK ready/connect/ready/fatal/transfer/play/presentTrack）
- [x] 36. IPC `widevine:status`：renderer 启动时调 main 拉 `components.status()`，打到 console
- [x] 37. EME 探测 `requestMediaKeySystemAccess('com.widevine.alpha')`：connect 前确认 CDM 可用
- [x] 38. `parsePlayableQueue` 支持 `wpsReady` 参数：WPS 激活时优先 Spotify 源（之前服务端 bestSource 把 Spotify 排最后，WPS 路径不触发）
- [x] 39. `spotifyApiWithRetry` 工具：transfer / play 遇 404（device 还没注册到 Spotify Connect 设备列表）退避重试 0.5s/1.5s/3s
- [x] 40. `transferHere` 失败不阻断 `play`（两边都 404 重试；play 带 `device_id` 也会激活设备）

## v2.3（Apple Developer + castLabs EVS —— 唯一修复 license 500 的路径）

> **根因（v2.2 定位）**：castLabs fork `+wvcus` 是 **dev VMP 签名**（README 原话：
> "For production use you can sign up for our EVS service"），Spotify 生产 license
> server 拒 → `POST /v1/widevine-license/v1/audio/license 500` → `playback_error` →
> `hasTrack=false` → 30s 退。**Spotify 自己桌面端用 prod VMP 签的 ECS**——第三方
> 拿不到，唯一合规通道 = castLabs EVS（完全免费）签 streaming。
>
> **EVS = Electronic Video Service**：castLabs 公开承诺 **完全免费**（2020-09-04 wiki），
> 个人开发者零成本，签 streaming signature 不收费。**前置 = Apple Developer**
> （$99/年）做 macOS code-sign / notarize，否则 Gatekeeper 拦 dmg。

- [ ] 41. **买 Apple Developer Account**（[developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)，$99/年，1–3 天批）—— **⚠️ 先提交**（1–3 天延迟），同时跑 #42-#44
  - ⚠️ 2026-10-24 实测：本机 `security find-identity -v -p codesigning` →
    **0 valid identities**（只有腾讯 IOA MDM 的、不受信）→ electron-builder 打包时
    直接跳过 codesigning（"skipped macOS application code signing"）。
    ⇒ **没有 Developer ID 证书 → 不签名 / 不 notarize 的 dmg 会被 Gatekeeper 拦。**
  - **拿「Developer ID Application」证书**（notarize 必需；注意**不是**「Apple
    Development」——那只是开发签名，Apple 不会给它 notarize）：
    - **路线 A（推荐，省事）**：Xcode → Settings → Accounts → 登录你的 Apple ID →
      Manage Certificates → 左下 `+` → **Developer ID Application** → Done。
      **私钥自动生成在本机登录钥匙串** → electron-builder 直接能发现，不用导 .p12。
    - **路线 B（无 Xcode）**：developer.apple.com → Certificates, Identifiers &
      Profiles → Certificates → `+` → **Developer ID Application** → **Generate CSR**
      （用「钥匙串访问 → 证书助理 → 证书颁发机构」生成 .csr）→ 上传 → 下载 `.cer`
      → 双击导入钥匙串。
      ⚠️ **证书本身不含私钥**——只导 `.cer` 等于没签上，必须同时有私钥在钥匙串里。
    - 落地后自检（应看到 1 条 `Developer ID Application` 身份）：
      ```bash
      security find-identity -v -p codesigning
      ```
- [x] 42. `pip install --upgrade castlabs-evs`
  - ✅ **2026-10-24 实测：已经装好了** —— `~/.castlabs-evs-venv/bin/` 下
    `evs-vmp` 和 `evs-account` 都在，`evs-vmp sign-pkg --help` 正常。
    （重装命令：`~/.castlabs-evs-venv/bin/pip install --upgrade castlabs-evs`）
- [ ] 43. **注册 EVS 账号**（e-mail 验证，凭据缓存 `~/.castlabs-evs/`）—— **0 成本**
  - ❌ **2026-10-24 实测：`~/.castlabs-evs/` 目录不存在** → **账号从没注册过**。
  - ⚠️ **命令入口**：`evs-account signup`（**不是** `python3 -m castlabs_evs.account signup`
    —— castlabs-evs 只提供 `evs-vmp` / `evs-account` 两个 CLI，**没有
    `python3 -m castlabs_evs` 的 `__main__`**；这个坑在
    `packages/electron/afterPack-vmp.cjs` 的注释里已经踩过并修掉）。
  - 命令：`~/.castlabs-evs-venv/bin/evs-account signup`（要邮箱 + 密码，**得本人来**）
- [ ] 44. EVS 签出 dev 用 .app —— ⚠️ **命令入口要改**：`python3 -m castlabs_evs.vmp
sign-pkg` 不存在（见 #43）→ 用
      `~/.castlabs-evs-venv/bin/evs-vmp sign-pkg <dist/mac-arm64/Maestro.app>`
  - ⚠️ `sign-pkg` 收的是「**包含 .app 的目录**」，不是 `.app` 本身。
  - 验证：`?wpsDebug=1` 重跑 → license 返 200 + `hasTrack=true`
  - ⚠️ 前提：`npm run pack` 得先跑通（**已通**，见 `specs/stability/tasks.md` A2）
- [ ] 45. `afterPack-vmp.cjs` 钩子**生产模式**（无 `SKIP_VMP=1`）跑通：sign → codesign → notarize → dmg
  - 依赖 #41（Developer ID 证书）+ #43（EVS 凭据）
  - ✅ **配置前置已补上**：`packages/electron/package.json` 的 `build.mac` 里加了
    `"notarize": true`。⚠️ **不加会崩**：2026-10-24 实测 electron-builder 24.13.3
    `generateNotarizeOptions` 在 `mac.notarize` **完全没设**时，走「Apple ID + 专用
    密码」路线会在 `const { appBundleId, ascProvider } = options` 处对 `undefined`
    解构 → `TypeError: Cannot destructure property 'appBundleId' of 'options'`。
    实测三种配置 × 三条路线：
    | `mac.notarize` | 路线 B（Apple ID+密码） | 路线 A（钥匙串） | 路线 C（API key） |
    | -------------- | ----------------------- | ---------------- | ----------------- |
    | 不设           | ❌ **TypeError 崩**     | ✅               | ✅                |
    | `true`         | ✅                      | ✅               | ✅                |
    | `{ teamId }`   | ✅（转 notarytool）     | ✅（带 teamId）  | ✅（带 teamId）   |
  - **notarize 凭据一律走环境变量，不要写进 package.json**（2026-10-24 实测
    electron-builder 24.13.3 `macPackager.js:getNotarizeOptions` 只认这 3 组 env）：

    | 路线                          | 环境变量                                                  | 说明                                      |
    | ----------------------------- | --------------------------------------------------------- | ----------------------------------------- |
    | **A. 钥匙串 profile（推荐）** | `APPLE_KEYCHAIN_PROFILE`（可选 `APPLE_KEYCHAIN`）         | 密码存进 login 钥匙串，磁盘上没有明文     |
    | B. Apple ID + 专用密码        | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`                | 走旧的 legacy notarize 工具               |
    | C. ASC API key                | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | electron-builder 官方最推荐（issue 7859） |

  - **Apple 专用密码怎么拿**：account.apple.com → 登录 → 「Sign-in and Security」
    → 滚到「App-specific passwords」→ `+` 生成 → **只显示一次**，当场存进密码管理器。
    前提：该 Apple ID 已开**双因素认证**。⚠️ 这**不是登录密码**，填错 Apple 会直接拒收。
  - **路线 A 的落地命令**：
    ```bash
    xcrun notarytool store-credentials "maestro-notary" \
      --apple-id "you@example.com" \
      --team-id "XXXXXXXXXX" \
      --password "xxxx-xxxx-xxxx-xxxx"
    # 之后打包时：
    export APPLE_KEYCHAIN_PROFILE=maestro-notary
    ```
    teamId 在 developer.apple.com → Membership 页面可见（10 位大写字母数字）。
  - ⚠️ **两级「静默跳过」，都要自己查日志**（2026-10-24 实测源码路径 + 实跑日志）：

    | 日志里的信号                                     | 含义                                                                                                                                               |
    | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `skipped macOS application code signing`         | **没证书** → `doSign` 在 `identity == null` 处直接 `return false`（`macPackager.js:195`）→ **notarize 阶段压根没被调用**，日志里连 warn 都不会出现 |
    | 有签名日志、但**没有** `notarization successful` | 3 组 env 一个都没设 → `getNotarizeOptions` 返回 `undefined` → `notarizeIfProvided` 只 `log.warn('skipped macOS notarization')` 后继续出包          |
    | `notarization successful`                        | ✅ 真的过了一遍                                                                                                                                    |

    ⇒ **别只看「打包成功 / dmg 出来了」**——2026-10-24 实跑 `SKIP_VMP=1 npm run pack`
    就是 `PACK_EXIT=0`、dmg 146MB、`pack:verify` 全绿，但**日志里一条 notarize 行都没有**
    （因为本机没证书，签名整步被跳过）。
    验收：`spctl -a -vvv -t install release/Maestro-1.0.0-arm64.dmg`
    （应显示 `accepted` + `source=Notarized Developer ID`）。

  - ✅ **不用自己写 entitlements**：electron-builder 24 的 `hardenedRuntime` 默认
    **true**（`scheme.json` → `MacConfiguration.properties.hardenedRuntime.default=true`），
    默认 entitlements 模板 `app-builder-lib/templates/entitlements.mac.plist` 已带齐
    notarize 必需的三条（`allow-jit` / `allow-unsigned-executable-memory` /
    `disable-library-validation`）。⇒ 证书到位后 notarize 前提自动满足。
  - ✅ **签名时序已经是对的**（2026-10-24 读 electron-builder 24.13.3 源码确认顺序）：
    `afterPack`（VMP 签名，行 125）→ `doSign`（行 ~260）→ `notarizeIfProvided`（行 275）
    → dmg。⇒ VMP 签名在 codesign **之前**，符合 castLabs 要求，
    `afterPack-vmp.cjs` 的设计不用改。
- [ ] 46. 装 EVS-signed dmg → 登录 Premium → 播整曲 / Spotify 桌面端可见 "maestro-xxxx" 设备 / transport / token 1h 重连不掉播
- [ ] 47. CI 化（可选）：EVS 凭据进 GitHub Actions secret，`EVS_NO_ASK=1` 跑 release tag 自动出 prod-signed dmg
