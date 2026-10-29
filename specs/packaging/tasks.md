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
  - 验收脚本：`npm run pack:verify`（`packages/electron/scripts/verify-pack.sh`）—— 看产物结构 +
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

- [x] 23. 出货卫生**没有门禁** —— 全靠人肉验收一次（**2026-10-24 完成**）
  - 问题：#21/#22 修完之后，「产物干净」这件事**只靠人肉验收**（本地打一次包、
    `asar list` 一下）。**一次性的验收会腐烂** —— 半年后没人记得 dist 要排除
    测试文件，一行 tsconfig 改动就能把测试代码重新送出去，
    而**没有任何门禁会红**。
  - 修法：
    1. 新增 `scripts/check-artifact-hygiene.cjs` → 判四个出货包的 dist：
       - **测试代码**：文件名含 `.test.` / `.spec.`，或路径里有
         `test` / `tests` / `e2e` / `__tests__` / `test-helpers` 段
       - **陈旧产物**：dist 里的文件在 src 里找不到对应源文件
       - **源码**：dist 里出现 `.ts`（不含 `.d.ts`）
    2. **CI 新增一个 job**（`artifact-hygiene`，与 `check` **并行**）→
       先跑自测、再构建全部出厂产物、最后 `--require-built` 判。
       ⚠️ `--require-built`：没构建过 = **失败**，不是跳过
       （「跳过」= 门禁形同虚设）。
    3. `packages/electron/scripts/verify-pack.sh` 补 macOS 端到端那层
       （CI 打不了 dmg）：asar + sidecar 扫一遍；
       `node_modules` 只查 `@maestro/*`（第三方包自带 `test/` 是正常的，
       实测不排除会一次报出 120+ 个假阳性）。
  - 自测（`--self-test`）：用夹具造出四类违规，断言检查器**都抓得到**
    —— 只断言「干净时通过」是不够的，那不证明它拦得住东西。

- [x] 24. server 的 dist 漏了测试夹具 + `nest build` **不清** dist（**2026-10-24 完成**）
  - 现象 A：测试夹具 `packages/server/src/test-helpers/in-process-http.ts` 的编译产物
    在出厂产物里
    —— `src/test-helpers/` **只被 `*.test.ts` 引用**，但构建 tsconfig 排除了
    `src/test/**` 却**漏了** `src/test-helpers/**` → 夹具跟着
    `extraResources` 一起出货。
  - 现象 B：`packages/server/dist/reco/_tmp-dbg2.js` —— 一个**从没提交过**的
    本地调试残留，源文件删了之后产物一直躺在 dist 里，
    而且 ⚠️ **已经跟着一个 dmg 出过货**
    （`Maestro.app/Contents/Resources/server/reco/_tmp-dbg2.js`）。
    实测确认：`nest build` 跑完它**依然在** → 它**根本不清** dist。
  - 修法：
    1. `packages/server/tsconfig.build.json` 补 `src/test-helpers/**`。
    2. 新增 `packages/server/scripts/clean-dist.cjs` → `build` 前清 dist。
  - ⚠️ **踩到的坑：清 dist + 增量构建 = 空产物（静默无输出）**
    server 的 tsconfig 开了 `incremental` → tsc 把「编译到哪了」记在
    **包根目录**的 `tsconfig.build.tsbuildinfo`（**不在 dist 里**）→
    清掉 dist 之后 `nest build` 判定「全都编译过了」→ **一个文件都不产出**，
    **退出码 0，屏幕一行输出都没有**。
    ⇒ 清 dist 的同时**必须**清掉构建的增量状态。
    这是典型的**静默降级** —— 验收只能用**正向信号**（产物真的在），
    「没看到报错」会被当场骗过去。

- [x] 25. `@maestro/common` 的 **src 跟着出货**（测试文件在内）（**2026-10-24 完成**）
  - 现象：`Resources/server/node_modules/@maestro/common/src/` 里躺着
    **5 个 `*.test.ts`** + 全部 TS 源码 —— common 的 `package.json` **没有
    `files` 字段** → npm 打包时把整个目录都带上（`src` / `scripts` /
    `tsconfig*.json`）。
  - 修法：`packages/common/package.json` 加 `"files": ["dist"]`
    → 装出来的副本**只有 dist**。
  - ⚠️ `exports.import` 仍指向 `./src/index.ts`（vite 构建 renderer 用的是
    **源码**，改成 dist 会让浏览器覆盖率的**文件归属**变掉）→ **不动 exports**；
    出厂包里没人用 ESM 条件去解析它（sidecar 是 CJS、renderer 已预打包）→ 无副作用。
  - 验收（实测）：隔离安装后 `@maestro/common` 目录里**只有 `dist/` + package.json**；
    `require.resolve('@maestro/common')` → 解析到 `dist/index.js` ✅；导出可用 ✅

- [x] 23. 出货验收**全是"人肉验一次"** —— 6 条勾选框一直空着（**2026-10-24 完成**）

- [x] 26. 出厂验收**没有强制力** + CI 查不到「出厂 app 起不来」（**2026-10-28 完成**）

  `packages/electron/scripts/verify-pack.sh` 是**唯一**能验「出厂 app 能不能起来」的东西
  （它把出厂的 `Resources/server/main.js` **真的起一次**再探 `/storage/info`），
  但它有两个洞：

  1. **永远 exit 0** —— 哪怕满屏 ❌。它是个「报告」，不是门禁。
     ⇒ 「app 装上就崩」这条路径**实际上没有任何门禁**。
     ⚠️ 讽刺：同一个脚本早前就因为「`node ... | sed` 的退出码是 sed 的（恒 0）」
     踩过一次坑（"构建成功"是假象），但**脚本自己**的退出码一直没管。
  2. **CI 上根本没有它** —— dmg 要 hdiutil + 签名，CI 上打不出来
     → 「出厂 app 起不来」**只能本地验** → 半年没人验一次。

  **修法**：
  - 脚本改成**有 ❌ 就 exit 1**（新增 `fail()` 累加器；失败项**逐条列出**；
    `node -e` 的依赖解析探针改成**自己 exit(1)**，脚本看它的退出码，
    不用管道）；`--no-dmg` 开关给「只造了 .app」的场景用。
  - 新增 `.github/workflows/packaged-app.yml`（**macOS runner**）：
    `electron-builder --dir` 造 .app（**不出 dmg** → 省掉 hdiutil 与签名的
    失败面）→ 跑 `verify-pack.sh --no-dmg` → **有 ❌ 就红**。
    ⚠️ 必须是 macOS：探针跑的是**出厂 app 里的那个 Electron 二进制**
    （`ELECTRON_RUN_AS_NODE=1`）→ ubuntu 上没有那个可执行文件。
    代价：macOS runner 按 10 倍分钟计费（与 `visual.yml` 同款取舍）⇒ 用
    **paths 过滤**把触发面收窄到「能影响出货产物」的路径。

  **实测**：
  - `npm run pack -- --dir` → 出 .app、**不出 dmg** ✓；`verify-pack.sh --no-dmg`
    → **全部检查通过，exit 0** ✓（含「出厂 sidecar 真起来并答了 /storage/info」）
  - **反面**（把出厂 server 的 `node_modules` 移走 = 模拟「缺依赖 → app 启动即崩」）
    → 报 **3 项失败**（没有 server/node_modules / 依赖解析失败 / 出厂 sidecar 起不来）
    → **exit 1** ✓
  - 没有任何产物时 → 5 项失败 → exit 1 ✓
  - `check-artifact-hygiene.cjs` 在这个脚本里改成带 `--require-built`
    （没构建过 = **失败**，不是跳过 —— 「跳过」= 门禁形同虚设）
  - 现象：`specs/packaging/spec.md` 的「验收标准」6 条**一条没勾**，而且
    **没人说得清哪条证据守着它** —— 勾选框空着 = 没人知道它是"没做"还是
    "做了但没记证据"。这类"欠账"最消耗个人开发者：清单看着长，其实早就不欠。
  - 做法：**给每一条指到具体的自动化证据**（不是重写实现）——
    1. `npm run build:server` 产出 dist → CI 的 `artifact-hygiene` job
       （`npm run build` 四个包全建 + `--require-built` 判定）+ `pack.cjs`
       的 `REQUIRED_ARTIFACTS`
    2. `node packages/server/dist/main.js` 独立启动后正常服务
       → **本次新增自动化**：`packages/electron/scripts/verify-pack.sh` 的「出厂 sidecar 实测」
    3. `npm run pack` 产物 Resources 里有 server/dist → `pack.cjs` +
       `verify-pack.sh`
    4. packaged 启动后 spawn sidecar → 等端口 ready → 打开 BrowserWindow
       → `main.behavior.test.ts` 用例 3
    5. 关闭 app 时 sidecar 跟着 kill → 同文件 用例 18 / 19
    6. renderer 端通过 preload 拿到 sidecar URL → `preload.test.ts` §5
  - **本次新增的自动化**（第 2 条）：`verify-pack.sh` 里用
    `ELECTRON_RUN_AS_NODE=1` 把**出厂的** `Resources/server/main.js`
    **真的起一次**，探 `/storage/info`（不依赖任何平台凭据 → 不会因为
    没配 Spotify/Deezer 而误报）。
    ⚠️ 以前只验了「依赖能解析」（`require.resolve`）→ **不覆盖**
    「进程起不来 / 端口不通 / 鉴权头不对 / 环境变量没生效」这一整类出货事故。
  - 踩到的两个坑（都记在脚本注释里）：
    - bash 里 `$VAR` 紧跟**全角** `）` → bash 会把全角字符算进变量名
      → `SIDECAR_PROBE_PORT: unbound variable` → 一律用 `${VAR}`。
    - 端口写死 → 撞上"上次跑剩下来的 sidecar"（脚本中途退出会留孤儿进程）
      → 改成**现找一个空闲端口**（node `net.listen(0)`）+ `trap` 保证收尾。
