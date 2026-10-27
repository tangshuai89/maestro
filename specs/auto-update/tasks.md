# 自动更新 —— 任务清单

对应 spec: `specs/auto-update/spec.md`

## 1. 状态机（纯模块）

- [ ] `packages/electron/src/updater.ts`：- `UpdateState`（idle / unsupported / checking / not-available /
      available / downloading / ready / error）- `createUpdater(bridge)` —— 状态机（不 import electron ⇒ 可单测）- `createUnsupportedUpdater(reason)` —— dev / 未打包 / 依赖缺失 - `loadElectronUpdater(loader?)` —— **懒加载**，加载不到 ⇒ `null` - `createElectronUpdaterBridge(auto)` —— electron 的事件名/载荷 → 我们的形状
- [ ] `packages/electron/src/updater.test.ts`

## 2. 主进程接线

- [ ] `main.ts`：打包后才接；dev ⇒ `unsupported`（**不发任何请求**）
- [ ] `main.ts`：状态变化 → `webContents.send('updater:state', …)`
- [ ] `main.ts`：启动后静默检查一次
- [ ] `main.ts`：`updater:get-state` / `updater:check` / `updater:install`
      （`install` 只在状态是 `ready` 时才真的装）
- [ ] `preload.ts`：`updater:state` 进 `SUBSCRIBABLE_CHANNELS` + 三个 API

## 3. 渲染层

- [ ] `packages/renderer/src/lib/appUpdate.ts`：状态的人话描述 + `isInstallable`
- [ ] `packages/renderer/src/hooks/useAppUpdate.ts`：订阅 + 问初始状态 + 两个动作
- [ ] `packages/renderer/src/components/settings/UpdateSection.tsx`：设置里的一段
- [ ] `SettingsModal.tsx`：挂上这一段

## 4. 打包

- [ ] `packages/electron/package.json`：`electron-updater` 生产依赖 +
      `build.publish`（GitHub Releases）
- [ ] `build.files`：带上 `node_modules/**/*`（主进程的运行时依赖）
- [ ] `scripts/updater-runtime-deps.cjs`：把依赖子树复制到 appDir/node_modules
      （npm workspace 把它提升到根 ⇒ electron-builder 在 appDir 找不到）
- [ ] `scripts/pack.cjs`：打包前装配 + 工作区完整性复查

## 5. 测试

- [ ] `packages/electron/src/updater.test.ts`（状态机 + 适配层 + 加载失败降级）
- [ ] `packages/renderer/src/lib/appUpdate.test.tsx`（文案映射）
- [ ] `packages/renderer/src/components/settings/UpdateSection.test.tsx`
      （状态真源在主进程 / 只在「已就绪」时能安装 / 没有 electronAPI 不炸）
- [ ] `packages/electron/src/ipc-surface.test.ts`（通道双向契约）自动覆盖新通道

## 6. 门禁

- [ ] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] 全量套件 `bash scripts/test.sh --ci` → EXIT=0
- [ ] 覆盖率 diff 门禁 → ✅ 本次改动的代码全部被执行过
- [ ] 变异验证：把 `progress` 的百分比换算去掉（直接透传 0..1 的小数）
      ⇒ 断言 3c 必须红
- [ ] `node packages/electron/scripts/pack.cjs --check` 绿（打包管线没被弄坏）

## 7. 局限（如实记录）

- [ ] **真机自动更新要 A1**：更新包必须**已签名且已公证**（Developer ID +
      notarization）⇒ A1 没做完之前，真机验证做不了（代码/单测/打包都已验证）
- [ ] 只做 macOS 的 GitHub Releases 通道
- [ ] 没有灰度/分批推送、没有「静默安装」
