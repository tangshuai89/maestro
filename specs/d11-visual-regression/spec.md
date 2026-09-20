# D11 — Playwright 截图 baseline + CI 视觉回归

> 目的：CSS 漂移不该靠肉眼发现。把剧场视图在**三档 density** 下的渲染固化成 baseline，
> PR 改动渲染器时自动比对，红了给出 expected / actual / diff 三张图。
> 关联：`specs/d8-compact-layout/spec.md`（三档阈值）· `docs/visual-regression.md`（操作手册）

## 1. 为什么现在做

- D8 刚把尺寸适配做进代码（三档 density + 紧凑画布），**没有任何自动化的视觉保护**；
- D4 已经有了 token 漂移门禁（Figma → SCSS），D11 是它的下游：token 改了、CSS 改错了，
  像素比对能兜住；
- 但 D8 交付时明确留了一个洞：**本环境无 GUI，真机视觉验收没做**。D11 正是补这个洞的机制
  （把"看一眼"变成可重复的比对）。

## 2. 覆盖范围

| 尺寸 | density | 断言 |
|---|---|---|
| 960×800 | `narrow` | 档位属性 + 像素比对 |
| 1200×800 | `compact` | 同上 |
| 1440×900 | `regular` | 同上 |
| 1920×1200 | `regular`（放大档） | 同上 |

每个用例两条断言：**① `data-density` 档位**（纯逻辑，不依赖像素，能直接抓断点改错）；
**② 截图比对**（抓 CSS 漂移）。

## 3. 关键设计

1. **动效必须停住**：剧场视图有封面呼吸/星尘漂移/声波环脉冲三类持续动效，不停住每次截图都不同。
   两层保险：Playwright `animations: 'disabled'` + `reducedMotion: 'reduce'`
   （后者命中 `_reset.scss` / `_theater.scss` 既有的 reduced-motion 分支）。
   代价：**动效本身不在覆盖内**。
2. **接口全 stub 成空库**：基线要确定性；真连 sidecar 的话曲库一变就红。空库态也最能反映布局本身。
3. **固定 DPR=1 + 固定 viewport**：缩放系数由窗口尺寸算出，不固定就不可复现（Retina 上是 2x）。
4. **容差 0.1%（≈1300 px @1440×900）**：抗机器间字体/抗锯齿的零星差异。
   这个数字是**故障注入量出来的** —— 最早设 1%（12,960 px），8px 的 `.th-hud` 漂移只产生约 9,000 px
   差异、被直接放过；收到 0.1% 才红。**别凭感觉调这个值**。
5. **优雅降级**：仓库还没装 `@playwright/test` 时，workflow 跳过而非失败。

## 4. 验收

- [x] `playwright.config.mjs` + `tests/visual/theater.spec.mjs` 就位
- [x] `docs/visual-regression.md` 写清跑法/更新姿势/取舍
- [x] `.github/workflows/visual.yml`（路径过滤 + 未装依赖时跳过 + 失败上传报告）
- [x] `package.json` 加 `visual:serve` / `visual:test` / `visual:baseline`
- [x] 离线可验部分：spec/config 语法（`node --check`）、workflow YAML 解析、
      `vite preview` 能起并返回构建产物
- [x] `npm i -D @playwright/test`（`^1.63.0`）+ `npm run visual:baseline` → 6 张基线入库
- [x] `npm run visual:test` 对基线 **6/6 绿**
- [x] **故障注入**：`.th-hud` 挪 8px → 3 例变红（见 tasks Phase E）；撤回 → 6/6 回绿
- [ ] 真机手感验收（`npm run dev` 拖窗口）仍建议你做一次 —— 基线兜的是"有没有变"，
      兜不住"好不好看"

## 5. 不在范围

- **动效比对**（录屏/gif）：不测
- **Electron 窗口层**（原生 chrome、拖拽区、多显示器 DPI）：不测
- **真实数据态**（有曲目/歌词/推荐卡）：不测（接口 stub 成空库）
- 跨浏览器矩阵：只跑 chromium 一种

## 6. 风险

| 风险 | 处置 |
|---|---|
| 基线 PNG 让仓库变大 | 4 张、约 100–400 KB；真变大就改 CI artifact |
| 机器间像素差异导致假红 | 容差 1% + 固定 DPR + 固定 viewport |
| "红了就 --update" 把门禁关掉 | 文档明确要求：基线变更必须与"为什么变"同 commit，并先看 diff 图 |
| 新增依赖动 lockfile | **不由我改 lockfile**（AGENTS.md 红线）：你跑 `npm i -D @playwright/test` 时一并更新 |
