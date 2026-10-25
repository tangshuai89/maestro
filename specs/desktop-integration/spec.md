# 桌面系统集成（desktop-integration）

> 状态：🚧 **进行中**（2026-10-24 起）· 关联：`NEXT-ITERATION.md` §7.3

## 做什么

把 Maestro 接进**操作系统**，而不只是"一个能播歌的窗口"：

1. **系统媒体控件 + 耳机媒体键 + macOS「正在播放」** → `navigator.mediaSession`
2. **全局热键**（App 不在前台也能控制）→ Electron `globalShortcut`
3. **自动更新** → `electron-updater`（**本 spec 不含**，见下「不在本 spec 范围」）

## 为什么现在做

2026-10-24 做产品盘点时实测（`master 8ded104`）：

| 关键词                             | `packages/renderer/src` + `packages/electron/src` 命中数 |
| ---------------------------------- | -------------------------------------------------------- |
| `mediaSession`                     | **0**                                                    |
| `globalShortcut`                   | **0**                                                    |
| `MPNowPlayingInfoCenter`           | **0**                                                    |
| `electron-updater` / `autoUpdater` | **0**                                                    |

同一批实测里，**产品功能面已经齐了**（四平台 / 统一库 / 跨平台匹配 / AI 推荐 /
跨平台 ❤ fan-out / 三种播放视图 / 桌面歌词）。**唯一整层为空的，是「桌面应用
该有的系统集成」** —— 这是"能跑"和"能天天用"之间的差距，也是本 spec 存在的理由。

## 三条关键决策（都带坑）

### 决策 1：`mediaSession` 一个 API 覆盖三件事

`navigator.mediaSession` 是标准 Web API（Chromium 内置）。在 macOS 上，Chromium
的 media session **底层接的就是 `MPNowPlayingInfoCenter`** —— 所以设一次
`metadata`，**系统媒体控件（控制中心 / 锁屏）、耳机与键盘媒体键、macOS
「正在播放」三件事一起点亮**，不需要写原生模块。

> 依据：真实 Electron 案例（Qobuz 的 now-playing 方案）明确写「macOS learns
> what's playing from Chromium's media session」「Control Center and the lock
> screen always go through Now Playing」。**⚠️ 仍需真机验一次**（见验收 §4）。

**前提条件（已满足）**：Chromium 的 media session **只在页面有真实 `<audio>`
元素播放时才发布**。Maestro 的 A/B 槽位（`specs/audio-fx` §2.2）天然满足。

### 决策 2：媒体键**只能走一条路** —— 不注册成 `globalShortcut`

Electron 在 macOS 上把媒体键实现为 `globalShortcut` 走同一条 remote command
center 通道；**一旦注册，就会占住通道并关掉 Chromium 自己的媒体键处理** →
页面的 media session 再也收不到 `seek` 等远程命令。

⇒ **媒体键交给 `mediaSession`；`globalShortcut` 只注册非媒体键的自定义热键。**
（两套都注册 = 互相打架，媒体键表现为"有时双触发、有时失灵"。）

### 决策 3：全局热键**复用 `tray:command` 通道**，不新增 IPC 表面

主进程已经有 `sendTrayCommand()` → `webContents.send('tray:command', …)` →
preload 的 `onTrayCommand` → renderer 的 `trayHandlersRef`。全局热键**直接调
同一个 `sendTrayCommand`**，于是：

- **零新增 IPC 通道** → `ipc-surface.test.ts` 的白名单卫生检查不受影响
- **零新增 renderer 侧订阅逻辑** → 同一个 `trayHandlersRef` 映射表

> 通道名 `tray:command` 保留不动（改名要动 preload 白名单 + 那个卫生测试，
> 收益不抵风险）；**类型**改名 `TrayCommand` → `PlaybackCommand` 以反映
> "它现在是主进程→renderer 的播放命令通道，tray 只是命令来源之一"。

## 范围

### 做

- [ ] `navigator.mediaSession`：
  - [ ] `metadata`（title / artist / album / artwork）
  - [ ] `playbackState`（playing / paused / none）
  - [ ] `setPositionState`（duration / position / playbackRate）
  - [ ] 7 个 action handler：`play` / `pause` / `previoustrack` / `nexttrack` /
        `seekbackward` / `seekforward` / `seekto`（+ `stop`）
- [ ] `globalShortcut`（**只注册非媒体键**）：
  - [ ] 播放/暂停、上一首、下一首、音量+、音量−
  - [ ] 桌面歌词浮窗开关（**主进程直接调** `DesktopLyricsController.toggle()`，
        它本来就是主进程拥有的窗口）

### 不做（本 spec 范围外）

- ❌ **自动更新**（`electron-updater`）：它要 GitHub Releases feed + **已签名的
  构建**才有意义（没签名的 dmg 更新完照样被 Gatekeeper 拦）→ 依赖
  `NEXT-ITERATION.md` §0 的 Apple Dev + EVS，**单独立 spec**，等签名落地再做
- ❌ **Linux MPRIS / Windows SMTC**：Chromium 的 media session 在这两个平台也
  有系统集成，但 Maestro 现在只出 macOS 包（`packages/electron` 打包目标
  `mac-arm64`）→ 等真要出 Windows/Linux 包再说
- ❌ **自定义快捷键设置界面**：先给一组固定快捷键（见下表），不做配置 UI
- ❌ **原生 `MPNowPlayingInfoCenter` 模块**：决策 1 已经覆盖了

## 快捷键表（第一版）

| 快捷键    | 动作             | 通道                        |
| --------- | ---------------- | --------------------------- |
| `⌘⇧Space` | 播放 / 暂停      | `tray:command` `playpause`  |
| `⌘⇧→`     | 下一首           | `tray:command` `next`       |
| `⌘⇧←`     | 上一首           | `tray:command` `prev`       |
| `⌘⇧↑`     | 音量 +5%         | `tray:command` `volumeup`   |
| `⌘⇧↓`     | 音量 −5%         | `tray:command` `volumedown` |
| `⌘⇧D`     | 桌面歌词浮窗开关 | 主进程直接调 controller     |

> ⚠️ `⌘⇧D` **已被现有桌面歌词快捷键占用**（`NEXT-ITERATION.md` §7.2 记的
> "⌘⇧D（⌘⇧L 已被 lite 占用）"）→ 改用 `⌘⇧Y`，或见 tasks 的实际注册表。

## 验收标准

### 自动化（CI 门禁，不靠手测）

- [ ] `useMediaSession` 的单测覆盖：
  - [ ] metadata 正确组装（title / artist / album / artwork URL）
  - [ ] `playbackState` 随播放状态翻转
  - [ ] `setPositionState` 被调用且参数正确
  - [ ] **每个 action handler 真的调到了对应的播放命令**（不是"注册了就算"）
  - [ ] `navigator.mediaSession` 不存在时**优雅降级**（不抛）
- [ ] `globalShortcut` 的单测覆盖：
  - [ ] 注册了哪几个快捷键（**断言清单**，防止手滑多注册媒体键）
  - [ ] **断言没有注册任何媒体键**（决策 2 的守卫）
  - [ ] 触发快捷键 → 发出正确的命令
  - [ ] 退出时全部 `unregister`
- [ ] **变异验证**：把任一 action handler 里的调用去掉 → 对应用例**必须红**；
      把"不注册媒体键"的守卫去掉 → 对应用例**必须红**
- [ ] `npm run typecheck` / `npm run lint` / `npm test` 全绿
- [ ] 覆盖率 diff 门禁绿（本次新增的行必须被执行过）

### 手测（**只有这 1 条**无法自动化）

- [ ] 插上带媒体键的耳机 → 按 ⏯ / ⏭ / ⏮ → Maestro 响应；
      控制中心 / 锁屏显示当前歌名 + 封面；⌘⇧Space 在 App 不在前台时能暂停

## 风险与兜底

| 风险                                                    | 兜底                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| macOS 上 `mediaSession` 不发布（无真实 `<audio>` 播放） | Maestro 的 A/B 槽位是常驻 `<audio>`；真机验一次（验收 §4）               |
| 媒体键与 `globalShortcut` 打架                          | 决策 2：**只走 mediaSession**；单测断言"没注册媒体键"                    |
| 系统媒体控件显示的歌名和 UI 不一致                      | metadata 只从 `player.track` 单向派生（UI 是唯一事实来源）               |
| 全局热键和 App 内快捷键撞键                             | 全局用 `⌘⇧` 组合，App 内用裸键；注册前查 `globalShortcut.isRegistered()` |
| macOS 媒体键被别的播放器占着                            | 系统行为，Chromium 会按"当前 Now Playing app"路由 —— 不可控，不处理      |

## 不在范围但要记住

- **自动更新**（`electron-updater`）：等 Apple Dev + EVS 落地、有了签名构建再单独做
- **Windows / Linux 的系统媒体集成**：等出那几个平台的包

## 相关文档

- `NEXT-ITERATION.md` §7.3 —— 本 spec 的来源条目
- `specs/audio-fx/spec.md` §2.2 —— A/B 音频槽位（mediaSession 的前提）
- `specs/desktop-lyrics/spec.md` —— 桌面歌词浮窗（全局热键要开关它）
- `packages/electron/src/ipc-surface.test.ts` —— IPC 白名单卫生（复用通道的理由）
