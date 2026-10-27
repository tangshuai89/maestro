# 自动更新 —— 任务清单

对应 spec: `specs/auto-update/spec.md`

## 1. 状态机（纯模块）

- [x] `packages/electron/src/updater.ts`：- `UpdateState`（idle / unsupported / checking / not-available /
      available / downloading / ready / error）- `createUpdater(bridge)` —— 状态机（不 import electron ⇒ 可单测）- `createUnsupportedUpdater(reason)` —— dev / 未打包 / 依赖缺失 - `loadElectronUpdater(loader?)` —— **懒加载**，加载不到 ⇒ `null` - `createElectronUpdaterBridge(auto)` —— electron 的事件名/载荷 → 我们的形状
- [x] `packages/electron/src/updater.test.ts`（36 条）

## 2. 主进程接线

- [x] `main.ts`：打包后才接；dev ⇒ `unsupported`（**不发任何请求**）
- [x] `main.ts`：状态变化 → `webContents.send('updater:state', …)`
- [x] `main.ts`：启动后静默检查一次
- [x] `main.ts`：`updater:get-state` / `updater:check` / `updater:install`
      （`install` 只在状态是 `ready` 时才真的装）
- [x] `preload.ts`：`updater:state` 进 `SUBSCRIBABLE_CHANNELS` + 三个 API

## 3. 渲染层

- [x] `packages/renderer/src/lib/appUpdate.ts`：状态的人话描述 + `isInstallable`
- [x] `packages/renderer/src/hooks/useAppUpdate.ts`：订阅 + 问初始状态 + 两个动作
- [x] `packages/renderer/src/components/settings/UpdateSection.tsx`：设置里的一段
- [x] `SettingsModal.tsx`：挂上这一段

## 4. 打包

- [x] `packages/electron/package.json`：`electron-updater` 生产依赖 +
      `build.publish`（GitHub Releases）
- [x] `build.files`：带上 `node_modules/**/*`（主进程的运行时依赖）
- [x] `scripts/updater-runtime-deps.cjs`（16 个包的子树）：把依赖子树复制到 appDir/node_modules
      （npm workspace 把它提升到根 ⇒ electron-builder 在 appDir 找不到）
- [x] `scripts/pack.cjs`：打包前装配 + 工作区完整性复查

## 5. 测试

- [x] `packages/electron/src/updater.test.ts`（36 条：状态机 + 适配层 + 加载失败降级 + 三条接入分支）
- [x] `packages/renderer/src/lib/appUpdate.test.tsx`（12 条：文案映射）
- [x] `packages/renderer/src/components/settings/UpdateSection.test.tsx`（10 条）
      （状态真源在主进程 / 只在「已就绪」时能安装 / 没有 electronAPI 不炸）
- [x] `packages/electron/src/ipc-surface.test.ts`（通道双向契约）—— 自动覆盖了 4 个新通道

## 6. 门禁

- [x] `npm run typecheck` 全绿（四个包各自的 tsc）
- [x] `npm run lint` 全绿（0 error；16 个 warning 是仓库既有的）
- [x] 全量套件 `bash scripts/test.sh --ci` → **EXIT=0**（65 个 vitest 文件 / 806 条；随后补的 3 条渲染层用例单独跑通 809 条）
- [x] 覆盖率 diff 门禁（base = `74f07d8`）→ ✅ 本次改动的代码全部被执行过
- [x] 变异验证：把 `progress` 的百分比换算去掉（直接透传 0..1 的小数）⇒ **红**（断言1 文件内容确实变了；断言2 `updater.test.ts` 3 failed / 33 passed）
- [x] `node packages/electron/scripts/pack.cjs --check` 绿（打包管线没被弄坏）

## 8. 这批实际跑过的 pipeline（本地离线）

| 项                                                                                            | 结果 |
| --------------------------------------------------------------------------------------------- | ---- |
| ```bash                                                                                       |
| npm run typecheck # 四个包各自的 tsc → 全绿                                                   |
| npm run lint # 0 error                                                                        |
| bash scripts/test.sh --ci # EXIT=0                                                            |
| node scripts/coverage-diff-gate.js --base 74f07d8 --trust coverage/.line-coverage-trusted.txt |
| node scripts/scan-hardcoded-colors.mjs --gate                                                 |

```|

- 11 个门禁脚本的 `--self-test` 全绿（test:ci 的尾巴那一串）
- 本地跨包 E2E：`npx playwright test --config playwright.e2e.config.mjs` → **3 passed**
- 打包自检：`node packages/electron/scripts/pack.cjs --check` → 绿

## 7. 局限（如实记录）

- **真机自动更新要 A1**：更新包必须**已签名且已公证**（Developer ID +
      notarization）⇒ A1 没做完之前，真机验证做不了（代码/单测/打包都已验证）
- 只做 macOS 的 GitHub Releases 通道
- 没有灰度/分批推送、没有「静默安装」
```
