# 视觉回归（D11）— Playwright 截图 baseline

> 目的：把「CSS 漂移」变成 CI 里的一次失败，而不是上线后肉眼看出来。
> 关联：`specs/d11-visual-regression/spec.md` · `specs/d8-compact-layout/spec.md`（三档 density）

## 它测什么 / 不测什么

| 测 | 不测 |
|---|---|
| 渲染器在浏览器里的实际渲染（vite preview 起 `dist`） | Electron 窗口 chrome、原生拖拽区、托盘 |
| **三档 density 的档位判定**（`data-density` 属性断言，纯逻辑） | 动效过程（动效被主动停住，见下） |
| 布局/CSS 漂移（像素比对） | 真实数据态（接口全部 stub 成空库） |

## 怎么跑

```bash
npm i -D @playwright/test          # 首次（会同时更新 package-lock.json）
npx playwright install chromium     # 装 Playwright 自带的 chromium（约 130MB）

npm run visual:test        # 跑比对（必须先有 baseline 或本地已生成）
npm run visual:baseline    # 生成/更新 baseline（会写 tests/visual/__screenshots__/）
```

> ⚠️ **别用系统 chrome 生成基线**（`channel: 'chrome'`）。本机 Chrome 会自动升级，
> 而 CI 用的是 `npm ci` 装下来的、由 playwright 版本**钉死**的 chromium ——
> 两边浏览器构建不同，像素必然不一致，等于自己给自己制造假红。
> 要快跑一次看效果可以用 `channel:'chrome'`，但**基线必须用自带 chromium 生成**。

> `visual:*` 走 `scripts/run-playwright.mjs`：它只解析**本地**的 `@playwright/test`，
> 缺依赖时直接给安装指引 → 不会替你偷偷下载一个与基线版本不一致的 playwright
> （那会让比对结果失去意义）。也别改回 `npx playwright`：新版 npm 的 `--no-install`
> 并不真的拦住联网，离线时报的是 npm 的 proxy 错误，看不出真正原因。

`visual:*` 脚本内部会先 `npm run build:renderer`（preview 服务的是 `dist`），
再起 `vite preview --port 4173` 供 Playwright 访问。

## 为什么截图前要把动效停住

剧场视图有三类**持续动效**：封面呼吸、星尘漂移、声波环脉冲。不停住的话每张截图都不一样，
比对必然假红。两层保险：

1. `playwright.config.mjs` 里 `animations: 'disabled'`（暂停 CSS 动画到终态）；
2. `reducedMotion: 'reduce'` — 命中 `base/_reset.scss` 与 `_theater.scss` 的 reduced-motion 分支。

代价要说清：**动效本身不在回归覆盖范围内**。要测动效得另做录屏/gif 比对，不在 D11。

## 接口为什么要 stub

基线要的是**确定性**。真连 sidecar 的话，曲库一变截图就变。所以 `tests/visual/theater.spec.mjs`
把所有 `/api/**` 挡掉，返回空库（`/music/library` 404 `library_not_imported`、`liked` 空数组），
让 App 停在 idle 态 —— 这是最稳定、也最能反映布局本身的视觉目标。

## 基线 PNG 放仓库还是放 CI

**放仓库**（`tests/visual/__screenshots__/`，6 张、合计 **3.4 MB**）。
理由：baseline 必须**可 diff、可 review** —— 改 CSS 的 PR 里能看到"像素变了多少"才叫门禁；
放 CI 缓存里就没人看得见了。仓库已有 PNG 先例（`.superdesign/shot-*.png`、electron 图标）。

体积账（2026-09-20 实测）：

| 尺寸 | PNG |
|---|---|
| source-select 960×800 / 1440×900 | 328 KB / 486 KB |
| theater narrow / compact / regular / wide | 454 KB / 547 KB / 680 KB / 1040 KB |

- 为什么这么大：**星云 + 星尘背景**是高频噪声，PNG 压不动。
- 为什么不用 JPEG：`toHaveScreenshot` 的选项里**没有** `type`/`quality`（已核对
  `PageAssertionsToHaveScreenshotOptions`），要 JPEG 就得自己截图 + 自己写 diff，
  会丢掉这套容差与报告机制。同样的约束也意味着"换成 webp"这条路不存在。
- 参照物：仓库**已经**跟踪 **3.2 MB** 的 PNG（`.superdesign/shot-*.png`）。
  当年那轮 `chore/remove-pngs` 撤的是 17 张**过程截图**（约 9 MB），性质不同。
- 真嫌大时的两个办法：① 去掉 1920 那张（−1 MB）；② 改成 CI artifact + 摘要报告，
  代价是 PR 里看不到 diff 图。

## 更新基线的姿势

```bash
npm run visual:baseline    # 生成新基线
git diff --stat tests/visual/__screenshots__   # 先看清楚是哪几张变了、变多少
```

**基线变更必须和"为什么变"写进同一个 commit**（改了什么 CSS、看没看过 diff 图）。
只看"测试红了就 --update"等于把门禁关掉。

## 容差不是拍脑袋定的

`maxDiffPixelRatio` 现在是 **0.001（0.1%）**。这个值来自一次**故障注入**：

1. 把 `.th-hud` 的 `top` 从 24px 改成 32px（8px 漂移）；
2. 用当时的 1% 容差跑 → **6/6 全绿**（1440×900 下 1% = 12,960 px，而这点墨迹只差约 9,000 px）；
3. 收到 0.1% → 3 例正确变红，撤回后回绿。

**结论：加完门禁一定要做一次"故意改坏"的自检**，否则你不知道它是真在守还是在装样子。
顺带记住：这种自检还能告诉你"哪些尺寸有覆盖规则把改动吃掉了"（narrow 档把 `.th-hud` 钉在 16px，
所以那 8px 漂移在 narrow 里根本不生效——那是**正确**的绿，不是漏报）。

## CI

`.github/workflows/visual.yml`：PR 改动 `packages/renderer/src/**` / `tests/visual/**` /
`playwright.config.mjs` 时触发，跑 `npx playwright test`，失败时上传 `visual-report/`（含
expected / actual / diff 三张图）。

仓库里**还没有** `@playwright/test` 依赖时，workflow 会**跳过而不是失败**（与
`token-drift.yml` 同款优雅降级）——避免"门禁一上线就红"。
