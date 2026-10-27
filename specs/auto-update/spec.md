# 自动更新（electron-updater）—— 发版后用户不用手动下 dmg

## 背景

功能盘点 P0：`electron-updater / autoUpdater → 0 处`。

**「不装它，每次发版用户都得手动下载 dmg」** —— 对一个已经分发出去的桌面
App 来说这是分发链路的最后一环：没有它，每次发版都要用户自己去 Releases 页
找 dmg、下载、拖进 Applications、替换旧版。

## 范围

**做**：

- 主进程接 `electron-updater`，**打包后**启动时静默检查一次
- 更新状态机（检查中 / 无更新 / 有新 / 下载中 / 已就绪 / 出错）
- 渲染层：设置里一个「应用更新」段（状态 + 「检查更新」+「重启并安装」）
- IPC：`updater:state`（主→渲染）+ `updater:get-state` / `updater:check` /
  `updater:install`（渲染→主）

**不做**（各自有理由）：

- **不做「静默下载」** —— macOS 上自动更新必须下载**已签名**的包，用户没签名
  就会看到「无法打开，因为无法验证开发者」⇒ 比不更新更糟。
- **不做灰度/分批推送** —— 个人项目，GitHub Releases 的 latest 就够了。
- **不做自动重启** —— 「重启并安装」必须是**用户点**（他可能正在听歌）。
- **不接服务端** —— 更新检查是主进程的事，不该经过本地 sidecar。

## 关键决策

- **状态机独立成纯模块**（`packages/electron/src/updater.ts`）：不 import
  electron ⇒ 能用 node:assert 单测（跟 `global-shortcuts.ts` 同款做法）。
  `electron-updater` 的 API 由 main 侧**适配**进来。
- **dev 模式一律不检查**：未打包的 app 没有 publish 配置，
  `checkForUpdates()` 会 reject（"No published versions"）⇒ 报个假错误。
  状态直接是 `unsupported`。
- **`require('electron-updater')` 懒加载 + try/catch**：打包时如果依赖没被
  带进产物，**App 仍然能启动**（只是没有自动更新）⇒ 打包失误降级成
  「没有这个功能」，而不是「App 开不了」。
- **IPC payload 类型跟着 preload 走**：渲染层用
  `import type { UpdateState } from '../../../electron/src/preload'`
  （跟 `DesktopLyricsState` 同款做法）—— 跨包**类型**共享、**运行时**不共享。

## 状态机

```
idle ──check()──> checking ──┬─> not-available   （已是最新）
                             ├─> available        （有新版本，等下载）
                             ├─> downloading ──> ready   （下载完，等重启安装）
                             └─> error            （网络/配置问题）
unsupported  （dev / 未打包）
```

## 验收标准

- [ ] 打包后启动会静默检查一次；dev 下状态是 `unsupported`，**不发起任何请求**
- [ ] 设置里能看到状态，并能手动「检查更新」
- [ ] 有新版本时能看到版本号；下载完成后能「重启并安装」
- [ ] 更新失败（网络/无 publish 配置）→ 显示错误文案，**不崩**
- [ ] 缺 `electron-updater` 依赖（打包失误）→ App 照常启动，只是没有更新
- [ ] IPC 契约测试通过（通道双向都对得上）
- [ ] 全量套件 EXIT=0 + 覆盖率 diff 门禁绿 + 变异验证

## 局限（如实记录）

- **真跑起来要 A1**：macOS 的自动更新要求更新包**已签名且已公证**
  （`Developer ID` + `notarization`）⇒ A1 没做完之前，这段代码只能在
  「状态机 + UI + 单测」这一层验证，真机自动更新跑不了。
- **只支持 macOS 的 GitHub Releases 通道**（Windows 的 Squirrel 通道没做）。
- 更新包的大小/下载速度取决于 GitHub，不是我们的瓶颈。
