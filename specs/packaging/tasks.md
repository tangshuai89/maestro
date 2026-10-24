- [x] 1. ~~esbuild bundle 单文件~~ 改走 tsc 编译 + 整 dist/ 路线（esbuild 丢 decorator metadata，NestJS DI 挂）
- [x] 2. ~~esbuild devDep~~ 移除（不再用）
- [x] 3. ~~esbuild 配置~~ 移除
- [x] 4. Electron main: prod 模式下 spawn sidecar 子进程（用 ELECTRON_RUN_AS_NODE=1）
- [x] 5. Electron main: waitForSidecar() 轮询 /music/deezer/editorials 30 秒超时
- [x] 6. Electron main: before-quit + window-all-closed 时 kill sidecar
- [x] 7. preload: 暴露 apiBase + onSidecarReady
- [x] 8. renderer api.ts: resolveApiOrigin() 优先读 electronAPI.apiBase → env.DEV → localhost
- [x] 9. electron-builder config: extraResources 加 server/dist
- [x] 10. tsc 编译 + node dist/main.js 独立启动 :3200 已验过
- [x] 11. typecheck + 39/39 测试通过
- [x] 12. 文档：README "Build for production" 一节更新
- [x] 13. 修 extraResources 实际漏配 server/dist（tasks#9 曾勾但 package.json 里只有 renderer）+ 补 build/（tray 图标运行时）
- [x] 14. 修 electron-builder 无法探测 electron 版本（workspace 提升 → electron devDep 固定为 31.7.7）
- [x] 15. 6.4：应用图标（build/icon.icns + Dock/窗口图标）+ macOS Tray（播放/暂停/上下首/显示/退出）+ 关窗到托盘、Cmd+Q 真退出并 kill sidecar
- [x] 16. 端到端冒烟：`npm run pack` 出 dmg —— **已完成（2026-10-24）**
  - ⚠️ 之前写的阻塞原因（「环境缺失的 7zip-bin 传递依赖，需先 `npm install` 恢复」）
    是**误诊**：7zip-bin 一直都在（`builder-util` 的传递依赖，5.2.0，hoist 到仓库根）。
    真正的原因见 18 —— **是打包过程自己把它弄没的**。
  - 现在的链路：`SKIP_VMP=1 npm run pack` → `release/Maestro-1.0.0-arm64.dmg`（116MB）
    → 挂载出的 `.app` 里 **sidecar server 真的能起来**（见 20 的验收）。
  - 验收脚本：`npm run pack:verify`（`scripts/verify-pack.sh`）—— 看产物结构 +
    **实测 sidecar 的依赖能不能解析**（不是看配置，是真的 `require.resolve`）。
- [x] 17. electron-builder 算不出 electron 版本 → 打包入口显式注入实际装好的版本
  - 现象：`⨯ Cannot compute electron version from installed node modules - none of
the possible electron modules are installed and version ("https://github.com/
castlabs/electron-releases#8244344c…") is not fixed in project.`
  - 根因：`getElectronVersionFromInstalled()` 只读
    `<projectDir>/node_modules/electron/package.json`，而 **npm workspaces 把
    electron 提升到了仓库根** → 那个路径不存在 → 回退去读 package.json 的
    `devDependencies.electron`，那是 **castLabs 的 git URL**（不以数字开头）→ 抛错。
    （任务 14 当年靠「electron devDep 固定为 31.7.7」绕过去；后来换成 castLabs 的
    git URL，那个绕法就失效了。）
  - 修法：新增 `scripts/pack.cjs` 作为打包入口，把**实际装好的**版本注入
    （`--config.electronVersion=`）。版本号**只从安装产物读**（唯一真源）→
    以后换 castLabs commit 不用改代码。
  - 顺带做**三方漂移检测**（package.json 的 git SHA ↔ lockfile 的 resolved SHA ↔
    实际安装的 version），任一对不上就**直接失败** —— 不打「electron 版本和依赖
    声明不一致」的包（那属于静默发错货）。
- [x] 18. 打包会**剪掉整棵 workspace 的 devDependencies**（含 electron 本身）
  - 现象：跑一次 `npm run pack` 之后，`node_modules` 里的
    **electron / electron-builder / vitest / typescript / c8 / playwright /
    eslint / prettier / 7zip-bin 全部消失** → 紧接着造 dmg 时
    `ENOENT: chmod '.../7zip-bin/mac/arm64/7za' failed` → 打包失败；
    而且**之后的 `npm test` 全挂**（开发环境被拆了）。
  - 根因：electron-builder 默认跑一次 `npm install --production`
    （`app-builder-lib/out/util/yarn.js` 的 `installDependencies`，cwd = appDir）。
    在 **npm workspace** 里 `--production` 是**整棵树**剪 devDeps。
  - 修法：build 配置加 `"npmRebuild": false`（本项目的 electron 包**零运行时依赖**
    —— `electron-is-dev` 声明了但从未被 import，已删；`main.ts` 直接用
    `!app.isPackaged`）→ 根本不需要那次 production install。
  - 加**前后守卫**：`scripts/pack.cjs` 在组装依赖后、打包后各查一次
    `electron / 7zip-bin / vitest / typescript` 还在不在 → 被剪就**立刻失败**并
    说清怎么恢复，而不是留一个「打包完了但 npm test 全挂」的烂摊子。
- [x] 19. `npm install` 产不出 electron 二进制 → `predev` / `prepack` 钩子兜底
  - 根因：castLabs 版 electron 的 `package.json` **没有 `scripts` 字段** →
    **npm 不执行任何 install 生命周期脚本** → `node_modules/electron/dist/`
    永远不会被下载 → `npm run dev`（electron）和 `npm run pack` 都报
    「electron 没装好」。
  - 修法：`scripts/ensure-electron-dist.cjs` 调 electron 包**自带的**
    `install.js`（它从 castlabs releases 下载对应版本，且自带 `isInstalled()`
    判定 → 幂等）。挂在 `predev` / `prepack` 上 → **要才付钱**（不挂根
    `postinstall`，免得每次 CI 都白下载 100MB）。
- [x] 20. 打包产物里 server 的运行时依赖没进去 → **dmg 能打出来，但 app 启动即崩**
  - 现象：NestJS server 是通过 `extraResources` 放在 `Resources/server/` 的
    （**不在 asar 里**），而它的 154 个运行时依赖（@nestjs/core /
    reflect-metadata / kuromoji / opencc-js …）**没被打进去**：
    `ELECTRON_RUN_AS_NODE=1 Maestro -e "require.resolve('@nestjs/core')"` →
    `MODULE_NOT_FOUND` → sidecar 一 require 就挂。
  - 修法：`scripts/server-runtime-deps.cjs` 在 `pack-server-deps/` 里做一次
    **隔离的 production install**（`@maestro/common` 用 `file:` 引用 +
    `--install-links` → **拷贝**而不是软链），再作为 `extraResources` 打进
    `Resources/server/node_modules`（正好是 sidecar 的 require 解析路径）。
    用指纹缓存：server 依赖 / common 的 build 产物变了才重装。
  - 验收（**真的跑起来了**，不是看配置）：
    ```
    $ ELECTRON_RUN_AS_NODE=1 PORT=3999 …/Maestro …/Resources/server/main.js
    [Nest] Nest application successfully started
    [Bootstrap] Server running on http://localhost:3999 (X-Maestro-Token guard armed)
    $ curl -H "X-Maestro-Token: …" http://127.0.0.1:3999/storage/info
    {"backupDir":"…","backupCount":0}
    ```

- [x] 21. 产物里混进了**测试代码** —— common / electron 两个包（**2026-10-24 完成**）
  - 现象（实测）：`app.asar` 里有 **11 个 `*.test.js`**（`main.behavior.test.js` /
    `preload.test.js` / `dev-port.test.js` …）；产物里
    `Resources/server/node_modules/@maestro/common/dist/` 躺着 **5 个测试文件**的
    `.js`/`.d.ts` + 一个**陈旧产物** `__gate_probe.test.js`（源文件已删，
    `tsc` 不清旧输出 → 一直跟着出货）。
  - 根因：两个包的构建都用**含测试文件的 tsconfig**（`include: ["src"]`），
    且 `build.files` 把 dist 下所有文件都收进 asar。
  - 修法：
    1. `packages/{common,electron}/tsconfig.build.json`（`extends` 现有配置 +
       `exclude: ["**/*.test.ts"]`）→ `build` / `dev` 显式用它；
       `tsconfig.json`（typecheck 用）**不**排除 → 测试文件仍被类型检查。
    2. `packages/{common,electron}/scripts/clean-dist.cjs` → **build 前清 dist**
       （治陈旧产物）。
    3. electron 的 `build.files` 再加一道保险 `!dist/**/*.test.js`。
  - ⚠️ **为什么 clean 脚本要放包内而不是仓库根**：`@maestro/common` 会被
    `npm install file:... --install-links` **复制**到
    `packages/electron/pack-server-deps/node_modules/` → 那个副本里
    `../../scripts/` **不存在** → 构建脚本引用仓库根的路径会直接崩。
  - 验收（实测）：`asar list | grep test` → **0**；产物里
    `@maestro/common/dist` → **只有 10 个源文件产物，0 个测试文件**；
    `npm run pack` → dmg 146MB ✅；`npm run pack:verify` → ✅
- [x] 22. `packages/common` 的 `npm test` 只跑 5 个测试文件里的 1 个（**2026-10-24 完成**）
  - 原来是 `"test": "npm run build && node dist/normalizer.test.js"` → 只跑
    `normalizer.test.js`，另外 4 个（`artistAlias` / `contract` / `grouping` /
    `mask`）在这个包里**从来没跑过**。仓库根的 `npm test` 跑全部 5 个 ✅ →
    CI 是绿的，**掩盖了包级脚本的过时**。
  - 而且 #21 修完之后它会**直接失败**（`build` 不再产出 `dist/normalizer.test.js`）。
  - 修法：新增 `packages/common/scripts/run-tests.cjs` → **自动发现**
    `src/*.test.ts` → **逐个进程**跑（每个测试文件自己 `process.exit(1)`，
    不能 import 到一起）→ 与仓库根 `scripts/test.sh` 的 `run_pkg common`
    行为一致。**以后新增测试文件不用改脚本**（漏跑就是静默的质量缺口）。
  - 验收：`npm test -w @maestro/common` → **5/5 个测试文件全跑** ✅
