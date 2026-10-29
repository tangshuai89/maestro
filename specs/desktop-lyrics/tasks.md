# 桌面歌词浮窗 — Tasks（NEXT-ITERATION §7.2）

## Phase 1 — main 进程（窗口 + prefs）

- [x] **D1** `prefs.ts`：`DesktopLyricsPrefs` + `normalisePrefs()` + JSON 读写
- [x] **D2** `window-options.ts`：透明/置顶/尺寸/穿透的纯函数窗口配置
- [x] **D3** `desktop-lyrics-controller.ts`：懒建窗口、state 转发、lock/hover/prefs、关闭清理
- [x] **D4** 单测：`prefs.test.ts` / `window-options.test.ts` / `desktop-lyrics-controller.test.ts`
- [x] **D5** `main.ts` 装配 + IPC 注册 + Tray「桌面歌词」勾选项 + `before-quit` 关窗
- [x] **D6** `preload.ts`：`desktopLyrics` API 组 + `SUBSCRIBABLE_CHANNELS` 白名单

## Phase 2 — 浮窗 renderer

- [x] **D7** `lib/lyrics.ts` `activeLineWindow()` + 单测（TheaterView 同步复用）
- [x] **D8** `lyrics.html` + `desktop-lyrics/main.tsx` 入口 + vite 多入口
- [x] **D9** `DesktopLyricsOverlay.tsx`：双行 / 行内进度 / 无歌词 / 暂停 / 设置面板（字号·配色·描边·锁定·关闭）
- [x] **D10** `desktop-lyrics.scss` + `_tokens.scss` 浮窗令牌（scanner 0 硬编码）
- [x] **D11** `DesktopLyricsOverlay.test.tsx`

## Phase 3 — 主窗口接线

- [x] **D12** `useDesktopLyrics.ts`：行变化才推 IPC（进度 5% 分桶去抖 ≈ 250ms 一跳）
- [x] **D13** `App.tsx` / `Titlebar.tsx` 接线 + `⌘⇧D`（`⌘⇧L` 已被 lite 模式占用）

## Phase 4 — 门禁与手测

- [x] **D14** `npm test` / `typecheck` / `lint` / `scan-hardcoded-colors --gate` / `build:renderer` / `build:electron`
- [ ] @manual **D15** 手测：置顶逐行高亮 / 拖动 + 重启恢复 / 样式调节 / 锁定穿透 + hover 恢复 /
      切歌·无歌词·暂停 / Tray 与 Titlebar 勾选同步 / 多显示器
- [x] **D16** 打包模式（`npm run pack`）验证浮窗资源路径 `lyrics.html` 落在 `Resources/renderer/`
      —— 2026-10-24 核过：出厂包里 `Resources/renderer/` 下
      `index.html` / `lyrics.html` / `preset.html` 三个入口都在 ✓

- [x] **D17** 浮窗**入口**（`desktop-lyrics/main.tsx`）补测 —— 它整个是 **0% 覆盖**（2026-10-24）
  - 现象：覆盖率报告里 `main.tsx | 0 | 0 | 0 | 0 | 1-16…102` —— 浮窗的
    **挂载点**（第二个 HTML 入口 `lyrics.html` + 第二个 BrowserWindow）
    **从没被任何测试跑到过**。组件本身（`DesktopLyricsOverlay.test.tsx`）测了，
    入口这段没人管。
  - 入口测的东西不轻：浮窗是**只读镜像**（播放快照由主窗口推给 main、
    main 再转发过来）—— 订阅/退订/锁定态 hover 回报写错的话，症状是
    「浮窗关不掉」「鼠标移进去点不动」「关掉后穿透还开着」，
    都是**用户看得见、但很难定位**的问题。
  - 做法：新增 `desktop-lyrics/main.test.tsx`（vitest + happy-dom），
    把 `DesktopLyricsApp` **导出**（入口文件以前不导出，测不了；导出不影响
    运行时行为），用**假 preload API** 顶掉 `window.electronAPI.desktopLyrics`，
    并**捕获订阅回调**好主动推数据（模拟 main 推数据的样子）。
  - 覆盖的契约：
    1. 没装 preload（浏览器里直接开 `lyrics.html` 调试）→ 兜个空态，**别白屏**
    2. 装了 preload → 订阅播放快照 + 样式偏好
    3. **卸载 → 退订**（否则浮窗关不掉，订阅一直挂着）
    4. 锁定态 → `mouseenter`/`mouseleave` → 回报 hover（临时解除点击穿透）
    5. 锁定态卸载 → 收尾 `hover(false)`（不留"穿透还开着"的状态）
    6. 没锁定 → 不注册 hover 监听（不打扰鼠标）
    7. `#root` 存在 → **import 就把浮窗挂上去**（入口接线本身）
  - 效果：`desktop-lyrics/main.tsx` **0% → 100% 行覆盖 / 100% 分支覆盖**
    （函数覆盖 50%：剩下的是 React 内部回调的包装函数）

> 偏离说明：全局热键（`globalShortcut` 开关浮窗）按 #7.3 排期，本轮只做应用内 `⌘⇧D`。
> 快捷键避让：`⌘⇧L` 归 lite 模式（§6.3）、`⌘⇧M` 归 mini，桌面歌词取 `⌘⇧D`。
