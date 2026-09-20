# D11 — Tasks

## Phase A — 准备（已完成）

- [x] **A1** 确认 `@playwright/test` 未安装（需 `npm i`）；本机有 Google Chrome（可 `channel:'chrome'`）
- [x] **A2** 确认渲染器有 `vite preview`（`packages/renderer/package.json`）可当被测服务
- [x] **A3** 摸清启动接口（`getLibrary` 等）→ 决定全 stub 成空库态
- [x] **A4** 确认仓库 PNG 政策：已有 9 个跟踪中的 PNG（`.superdesign/shot-*` 等），基线可入库
- [x] **A5** 确认剧场视图有持续动效（呼吸/漂移/脉冲）→ 必须停住才能比对

## Phase B — 脚手架（已完成）

- [x] **B1** `playwright.config.mjs`（testDir / snapshotDir / animations disabled / reducedMotion / DPR=1 / 1% 容差 / webServer）
- [x] **B2** `tests/visual/theater.spec.mjs`（4 尺寸 × 2 断言：density 属性 + 截图）
- [x] **B3** `package.json`：`visual:serve` / `visual:test` / `visual:baseline`
- [x] **B4** `.github/workflows/visual.yml`（路径过滤 + 未装依赖跳过 + 失败上传报告）
- [x] **B5** `docs/visual-regression.md`（跑法 / 更新姿势 / 取舍 / PNG 政策）

## Phase C — 离线可验部分（已完成）

- [x] **C1** `node --check` 校验 spec 与 config 语法
- [x] **C2** workflow YAML 解析通过
- [x] **C3** `npm run build:renderer` 后 `vite preview` 起得来、`/` 返回 **HTTP 200 / 1667B**
      且 index.html 正确引用 `assets/index-*.{js,css}`（沙箱内禁绑定端口，这一步用外部执行验的）
- [x] **C4** `visual:test` / `visual:baseline` 走 `scripts/run-playwright.mjs`：只解析**本地**
      `@playwright/test`，缺依赖时给安装指引。
      （实测 `npx --no-install` 在新版 npm 里拦不住联网 —— 离线时报的是 npm proxy 错误，
      看不出真正原因；而且自动下载会拿到与基线不同版本的 playwright，比对失去意义。）

## Phase D — 需要你本机跑（未做）

- [x] **D1** `npm i -D @playwright/test`（用户已跑，`^1.63.0` 进 package.json + lockfile）
- [x] **D2** `npm run visual:baseline` → **6 张基线**（2 张 SourceSelect + 4 张 TheaterView）
- [x] **D3** 门禁自检（**故障注入**）：把 `.th-hud` 从 `top:24` 挪到 `32`（8px）
      → compact/regular/wide **3 例变红**、narrow 与 SourceSelect 保持绿（narrow 有覆盖规则钉 16px、
      SourceSelect 无 `.th-hud`）；撤回后 6/6 回绿。**这个自检顺带证明容差得收紧**，见下。
- [ ] **D4** （可选）把 D8 的真机视觉验收改用这套机制做：`npm run dev` 手感 + baseline 兜回归

## Phase E — 首次运行抓到的真问题（这就是做 D11 的理由）

| # | 问题 | 怎么发现的 | 处置 |
|---|---|---|---|
| 1 | 首屏根本不是剧场视图 —— 无凭据时 App 在 `App.tsx:219` 就分流到 **SourceSelect**，`.th-canvas` 压根不存在 | 4 个用例全挂在 `toBeVisible`，error-context 的 ARIA 快照里是"选择音乐来源" | spec 里 seed `localStorage['music-provider']`（与 App 自带 `?demo=` 同一个键）；顺手把 SourceSelect 也纳入基线 |
| 2 | 紧凑档的**当前歌词（40px）折两行压住控制条** | 基线截图肉眼可见 | 歌词面板上移 + 紧凑档字号收到 26px |
| 3 | 修 #2 的第一版把控制条挪到 690 —— 会压住**音质行 697..709**；idle 态没曲目，基线看不出来 | 读 `_theater.scss` 里 Bug #8 的注释（"下半屏是一条联立解出的垂直链，不能单独动"） | 歌词改塞进「封面底 445 → 歌名块 602」的空带，控制条回到链上的 726 |

**容差靠故障注入定，不能拍脑袋**：最初设 1%（1440×900 下 12,960 px），
结果 8px 的 HUD 漂移只产生约 9,000 px 差异 → **被放过**。改成 **0.1%（≈1,300 px）**后才红。
这条数字是量出来的，不是估的。

**其它踩到的坑**（都已修）：

- `@playwright/test` 的 `exports` 不放行 `./cli.js` → 启动器直接 resolve 报
  `ERR_PACKAGE_PATH_NOT_EXPORTED`，被我误当成"没装依赖"；改走 `./cli` ✅
- `npx --no-install` 在新版 npm 拦不住联网；`toHaveScreenshot` 的选项里**没有** `type`/`quality`
  （只能 PNG）；基线文件名带 `-darwin` 平台后缀 → CI 必须 macOS
