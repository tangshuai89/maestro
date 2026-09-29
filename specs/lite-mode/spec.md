# Lite 播放模式（#6.3）— 实施 spec

> 需求源：`NEXT-ITERATION.md` §6.3「Lite 播放模式（normal / lite 切换）」。
> 决策日期：2026-09-28。**在既有 `theater | mini` 三态上扩一个 `lite`**，
> 不新起一套播放逻辑（见 §2 约束）。

## 1. 范围

做：
- `PlayerMode` 从 `'theater' | 'mini'` 扩为 `'theater' | 'mini' | 'lite'`
  （`theater` 即 NEXT-ITERATION 文中的 `normal`）。类型 + 读写落到
  `lib/storage.ts`，`localStorage['player-mode']` 键名不变（老用户不丢偏好）。
- `<LiteView />`：整屏居中，**只有三类可视元素** —— 歌名块 / 上一首·下一首 / ✨ 推荐。
- 切法三处：Settings 新增「播放模式」节（完整 / 迷你 / 极简）、`⌘⇧L` 快捷键、
  lite 内的 `⛶` 退出键（hover 显形）。
- lite 下 `Esc` 回 theater、`Space` 播放/暂停（键盘可达性补齐，界面不因此多元素）。
- 窗口形态：Electron main 认 `player:mode='lite'` → 收成 480×300 紧凑窗（居中），
  回 theater 恢复切入前 bounds/maximized/fullscreen。与 mini 共用同一套存档逻辑。
- ✨ 走 `useReco.handleReco()`（**与 TheaterView 的 ✨ 同一入口**，不新写推荐流）：
  无 key → `setRecoKeyOpen(true)` 弹 RecoKeyModal（App 层常驻，lite 下同样能弹）；
  有 key → `POST /api/reco/run` 结果直接进队列可播。
- 单测：`LiteView.test.tsx` + `storage.test.mjs` 补 `readStoredPlayerMode`。

不做：
- 窗口变小「自动切 lite」的启发式（NEXT-ITERATION 标注为**可选**，本轮不做 —— 自动切模式
  会在用户拖窗口时误触发，等 lite 手测反馈再定）。
- lite 下的歌词 / 封面 / 搜索 / 库 / 设置浮层 —— 与"仅三类元素"冲突。
- 7.3 媒体键 globalShortcut（另一轮）。

## 2. 技术约束（已核实）

- **`<audio>` 不重建**：常驻 `App.tsx`，`createMediaElementSource` 每元素只能调一次。
  切 mode 只换条件渲染分支 → Web Audio graph 不断、当前歌/队列/进度天然不丢
  （验收第 4 条由架构保证，无需额外状态同步代码）。
- **不复制播放逻辑**：LiteView 只消费 `usePlayer` 已暴露的 `handlePrev` / `handleSkip` /
  `handlePlayPause`，与 MiniPlayer 同手法。
- **进 lite 必须关搜索面板**：`SearchPanel` 的挂载条件是 `player.searchOpen`，与 mode 无关。
  切 lite 时 `setSearchOpen(false)`，否则 overlay 盖在 lite 上。
- **token 门禁**：`test:ci` 含 `scan-hardcoded-colors --gate`，新文件预算 = 0
  → `_lite-mode.scss` / `LiteView.tsx` 只许 `var(--token)` + `color-mix(var…)`。
  注意 `.app.theater-mode` 的 `background: #02020a` 是既有预算项，**不外溢**到 lite。
- **z-index**：`$z-layers` 加 `'lite-view': 45`（低于 `mini-player` 50 / titlebar 100）。
- **快捷键**：`⌘⇧L`（避开 macOS 既有 `⌘⇧M`=mini）。`Space` 仅在 lite 且焦点不在
  输入框/按钮、无浮层打开时生效。**按钮必须让位**：空格激活按钮的 `click` 是
  浏览器在 `keyup` 阶段合成的，若在 `keydown` 里 `preventDefault()` 就把它吃掉，
  键盘用户将只能用 Enter 激活 ✨ / ⛶。
- **浮层清单要含登录态**：`AuthErrorPanel` / `NeteaseCookieModal` 的挂载条件只看
  `auth`，与 `playerMode` 无关，lite 下照样无条件渲染，且各自注册了
  `Escape → onDismiss`。它们若不进 `overlayOpen`，一次 Esc 会同时关面板**和**
  把模式打回 theater —— 正是 §2 要避免的「一次 Esc 关两层」。

## 3. 文件改动

新建：
- `components/views/LiteView.tsx` — 极简视图（`export interface LiteViewProps`）
- `components/views/LiteView.test.tsx` — vitest 单测
- `styles/components/_lite-mode.scss` — 布局 + `.app.lite-mode` 覆写

改动：
- `lib/storage.ts` — `PlayerMode` 类型 + `STORAGE_KEYS.playerMode` + 读写（进备份集）
- `lib/storage.test.mjs` — 补 3 例
- `components/mini/MiniPlayer.tsx` — 移除本地 `PlayerMode` 导出（类型搬去 storage）
- `components/layout/Titlebar.tsx` — 类型改从 `lib/storage` 导入
- `components/modals/SettingsModal.tsx` — 新增 `playerMode` / `onChangePlayerMode` props
  + 「① 播放模式」节（其余节顺延编号 ②–⑨）
- `components/modals/SettingsModal.test.tsx` — 补 prop + 1 例（切模式触发回调）
- `styles/abstracts/_variables.scss` — `$z-layers` 加 `'lite-view': 45`
- `styles/main.scss` — `@use 'components/lite-mode'`
- `App.tsx` — 三态 state（走 storage 读写）+ `⌘⇧L` / `Esc` / `Space` + 条件渲染 +
  根 class + 进 lite 关搜索
- `packages/electron/src/preload.ts` — `reportPlayerMode` 收 `'lite'`
- `packages/electron/src/main.ts` — `player:mode` 认 lite（紧凑态机 mini ⇄ lite）

## 4. 视觉

```
        ┌──────────── 480×300 ────────────┐
        │                          ⛶     │  ← hover 显形，常驻 DOM（可访问性）
        │                                  │
        │           歌 名（大字）           │  data-lite-el="title"
        │           歌 手（副行，弱）        │
        │                                  │
        │        ⏮          ⏭              │  data-lite-el="nav"
        │                                  │
        │              ✨                  │  data-lite-el="reco"
        └──────────────────────────────────┘
```

- 底：`var(--bg-base)` + `.bg-layer` 封面晕染保留（lite 不隐藏，opacity 抬到 0.5，
  与 `.mini-mode` 的 0.2 反过来 —— 极简模式反而更该让人看到"在放什么"）。
- 歌名字号 `clamp(20px, 4vw, 34px)`，`--text-primary`；副行 `--text-dim` 12px。
- 按钮：`--radius-full` 圆形，`--glass-fill` 底；`:hover` 描 `--glass-stroke`；
  `✨` 用 `--accent-live`（跟随封面色）做 hover 光晕。
- 整屏 `-webkit-app-region: drag`（无 titlebar，要能拖窗口），按钮 `no-drag`。
- `prefers-reduced-motion` 下关入场动画。

## 5. 验收

- [ ] `npm test`（含新 `LiteView.test.tsx`）绿
- [ ] `npm run typecheck` / `npm run lint` 绿
- [ ] `node scripts/scan-hardcoded-colors.mjs --gate` 不破预算（新文件 0）
- [ ] `npm run build:renderer` / `build:electron` 通过
- [ ] 手测：Settings / `⌘⇧L` 切 lite 即时生效、重启记住；lite 仅三类元素；
      ✨ 出推荐可播、无 key 弹 key 框；`theater ↔ lite` 往返当前歌/队列/进度不丢、音频不断

## 6. 偏离说明

1. **标题块内多一行歌手副行**：NEXT-ITERATION 写"仅剩 歌名 + ◀▶ + ✨"。歌手行归入
   歌名块（同 `data-lite-el="title"`），不构成第四类元素；纯歌名在切歌时无法辨认曲库。
2. **多一个 hover 显形的 ⛶ 退出键**：验收只列三类元素，但"只能靠快捷键退出"对纯鼠标
   用户是死路。折中：DOM 常驻、`opacity: 0` → `:hover`/`:focus-visible` 显形，
   默认不可见故不污染「三类元素」的视觉验收，`Esc` / `⌘⇧L` 同时有效。
3. **✨ 用 `handleReco`（整队替换）而非 `appendToQueue`（续进）**：与 TheaterView 的 ✨
   行为一致（推荐即新队列），且 DeepSeek 推荐的去重是按 run 记录的，追加会绕过
   `useReco` 已有的「正在播 + 接下来 2」派生逻辑。NEXT-ITERATION 的"续进队列"
   按"推荐结果进队列并可播"理解。
4. **不做窗口尺寸启发式自动切 lite**：见 §1「不做」。
5. **lite 下推荐期间不走全屏 `RecoLoading`**：`RecoLoading` 是 `z-index:150` +
   `inset:0` 的整屏星云遮罩（`_reco-loading.scss`），会把 lite 的歌名 / ◀▶ / ✨
   全部盖掉 —— 而点 ✨ 恰恰是 lite 唯一的主动作，等于「三元素契约」在 100% 使用
   频率最高的时刻失效，且 `LiteView` 自己写的 `recoRunning` 分支（`disabled` +
   `aria-busy` + 转圈 + 「推荐中…」）变成生产不可达的死码。
   **改法**：`App.tsx` 的 `RecoLoading` 渲染条件加 `playerMode !== 'lite'`，
   loading 态交回 LiteView 内联表达。theater / mini 行为不变。
6. **未配 DeepSeek key 时 ✨ 挂 `is-unset` 视觉态**：`LiteViewProps.recoConfigured`
   此前只进了 `title` 属性，配与不配在视觉上完全一致；用户点了"没反应"，
   不知道要先填 key。`is-unset` 只把描边改成虚线、字色降到 `--text-secondary`
   （全是既有令牌，新增硬编码色预算仍为 0），不新增元素、不破坏三元素契约；
   按钮仍可点（点击由 App 转去弹 `RecoKeyModal`），推荐在飞时不叠该态。
