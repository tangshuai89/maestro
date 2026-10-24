# 打包：把 NestJS sidecar 到 Electron 桌面包

## 做什么

目前 `npm run pack`（electron-builder mac dmg）出来的包**不能跑**：

1. NestJS 没在桌面包里 → renderer 找不到 API
2. Prod renderer 用 `http://localhost:3200/api/...`，但桌面用户不会本地跑 server

修两件事：

1. tsc 编译 NestJS → dist/；electron-builder 把 `packages/server/dist` 复制为 extraResources
2. Electron main 在 packaged 模式 spawn `node resources/server/main.js` 当 sidecar，
   等端口就绪再 loadFile（renderer）。端口由 NestJS 自己选（PORT env，默认 3200），
   preload 把 sidecar URL 透给 renderer。

## 为什么不用 esbuild bundle 成单文件

试过 esbuild bundle（external @nestjs/* + reflect-metadata + rxjs），
跑起来 DI 注入挂了：`Cannot read properties of undefined (reading 'storageDir')`。
原因：esbuild bundle 模式不生成 TypeScript 的 `__metadata("design:paramtypes", ...)`，
NestJS DI 就识别不出构造函数参数类型。
第三方插件（esbuild-plugin-tsc）能解，但本轮不引入额外依赖。
tsc 编译 + 整 dist/ 走 sidecar 是更稳的方案。

## 验收标准

> ⚠️ 2026-10-24：这 6 条以前**全是"人肉验收一次"** —— 勾选框一直没动，
> 因为没人说得清"哪条证据守着它"。现在每条都指到**具体的自动化证据**：
> 有一条是人肉（且当时验过），其余五条都有机器可重复跑的检查。

- [x] `npm run build:server` 产出 packages/server/dist/
      —— **CI 的 `artifact-hygiene` job** 跑 `npm run build`（四个包全建）+ `scripts/check-artifact-hygiene.cjs --require-built` 判定；
      `pack.cjs` 的 `REQUIRED_ARTIFACTS` 也断言 `packages/server/dist/main.js` 在
- [x] `node packages/server/dist/main.js` 独立启动后 :3200 正常服务
      —— **2026-10-24 自动化**：`scripts/verify-pack.sh` 新增「出厂 sidecar 实测」
      —— 用 `ELECTRON_RUN_AS_NODE=1` 把**出厂的** `Resources/server/main.js`
      **真的起一次**，探 `/storage/info`（不依赖任何平台凭据）。
      ⚠️ 以前只验了「依赖能解析」（require.resolve）→ **不覆盖**"进程起不来 /
      端口不通 / 鉴权头不对"这一整类出货事故
- [x] `npm run pack`（electron-builder）产物 Resources 里有 server/dist
      —— `pack.cjs` 的 `REQUIRED_ARTIFACTS` + `verify-pack.sh` 的
      「server/main.js 存在」；`pack:verify` 里有新鲜度断言
- [x] Electron packaged 启动后，main spawn sidecar → 等端口 ready → 打开 BrowserWindow
      —— `packages/electron/src/main.behavior.test.ts` 用例 3
      「sidecar 被 spawn，waitForSidecar 的探针走的是 fetch」
      （假 `child_process` + 全局 fetch 打桩，跑的是**真的** main）
- [x] 关闭 BrowserWindow / app quit 时 sidecar 跟着 kill
      —— 同文件 用例 18「before-quit → sidecar 收 SIGTERM（等落盘）」+ 用例 19「window-all-closed → sidecar 也被收掉」
- [x] renderer 端通过 preload 拿到 sidecar URL（替代 hardcode localhost:3200）
      —— `packages/electron/src/preload.test.ts` §5
      「onSidecarReady：写回 apiBase / internalToken」

### 仍然是人肉的那一步

- [ ] **签名 / 公证**（A1）：`security find-identity -v -p codesigning` → 0 valid
      identities；dmg 未经签名与公证 → 别人机器上会被 Gatekeeper 拦。
      → 需要 Apple Developer 账号（$99/年，1–3 天批）+ Developer ID 证书 +
      Apple 专用密码。**这是外部审批，不在工程范围内。**

## 实现范围（v1）

- ✅ tsc 编译（已存在）；electron-builder extraResources 配 server/dist
- ✅ Electron main: prod 模式 spawn sidecar + 等端口 ready + 关闭时 kill
- ✅ preload 暴露 sidecar URL 到 window.electronAPI.apiBase
- ✅ renderer api.ts: 优先读 window.electronAPI?.apiBase，回退 import.meta.env 推导
- ❌ Windows / Linux pack（只 mac 走通；electron-builder config 已有 mac 段）
- ❌ 完整 installer / auto-update（electron-builder 有但本轮不验）
- ❌ node_modules sidecar 装包（当前走 assumption：dev 模式 renderer 走 vite proxy，
  prod 模式 NestJS 起在自己 dist/，不需要 node_modules 重新装——见下方"已知限制"）

## 不做什么

- 不做内嵌 NestJS 到 Electron main 进程（child_process spawn 更稳）
- 不做 NestJS hot-reload（生产不需要）
- 不做 auto-restart sidecar（崩溃让用户重启 App）
- 不做 installer / signing / auto-update（electron-builder 有但本轮不验）

## 已知限制

- 桌面包里要带 node_modules（NestJS 运行时依赖）。这会让 .dmg 涨 ~50MB。
  真要省体积要上 esbuild 完整 bundle + 修 metadata 丢失——见上。
- 端口固定 3200；冲突时让用户手动 kill 冲突进程（不起多实例）。
- 桌面包里的 .env / secrets.json 不进 git，要用户首次启动后手动配 DeepSeek key / Spotify client id。

## 技术约束

- Electron main: 用 child_process.spawn node 启 dist/main.js，detached: false
- 端口 ready 检测：轮询 http://127.0.0.1:{port}/music/editorials（轻量 endpoint），最多 30 秒超时
- sidecar 进程注册到 app.on('before-quit') / window-all-closed 时 kill
- preload 用 contextBridge.exposeInMainWorld 暴露 apiBase
- api.ts 优先读 window.electronAPI?.apiBase → '' (走 same-origin) → http://localhost:3200
