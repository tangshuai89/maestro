// ─────────────────────────────────────────────────────────────
// Playwright 视觉回归配置（D11）
//
// 目标：把「CSS 漂移」变成 CI 里的一次失败，而不是"上线后看着不太对"。
// 覆盖对象是**渲染器在浏览器里的渲染**（vite preview 起 dist），不是 Electron 窗口 —— 
// 不测窗口 chrome / 原生拖拽区，那些 Electron 侧的事不在本配置范围。
//
// 为什么 scale 与动效都要定住：
//   1. 剧场视图是「固定画布 + transform: scale」，缩放系数由窗口尺寸算出 →
//      测试必须显式 setViewportSize，否则不同默认窗口得到不同像素；
//   2. 画布里有**持续动效**（封面呼吸 / 星尘漂移 / 声波环脉冲），
//      Playwright 的 animations:'disabled' + reducedMotion:'reduce' 双层保险把它们停住
//      （后者命中 base/_reset.scss 与 _theater.scss 里的 reduced-motion 分支）。
//
// 依赖：`npm i -D @playwright/test`（本仓库暂未内置，避免动 lockfile）。
//   浏览器用 Playwright **自带**的 chromium（`npx playwright install chromium`）：
//   它的版本由 playwright 包钉死，本地与 CI 才一致。
//   ⚠️ 不要为了省下载改用 `channel: 'chrome'` —— 系统 Chrome 会自动升级，
//   那样生成的基线跟 CI 的 chromium 像素对不上，纯属自己制造假红。
// ─────────────────────────────────────────────────────────────
import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './tests/visual/__screenshots__',
  // 截图测试串行：并发会抢同一个 preview 端口，且像素比对无并行收益
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'visual-report' }]]
    : [['list']],
  expect: {
    toHaveScreenshot: {
      // 基线格式固定 PNG：`toHaveScreenshot` 的选项里**没有** type/quality
      // （只有 animations/caret/clip/fullPage/mask/maxDiff*/omitBackground/scale/stylePath/threshold/timeout），
      // 想换 JPEG 就得自己截图 + 自己写 diff，那会丢掉这套容差/报告机制。
      // 体积代价已核过：6 张共 3.4MB，而仓库**已经**跟踪着 3.2MB 的 PNG（.superdesign/shot-*.png），
      // 同一量级；当年撤的是 9MB 的 17 张"过程截图"，性质不同。
      // 真嫌大：把 1920 那张去掉（-1MB），或改用 CI artifact（代价是 PR 里看不到 diff 图）。
      // 容差 1% —— 在 PR #86 后的"实测 0.29%-0.39%"基础上放宽到 1%，原因：
      //   · PR #86 实测的 0.29-0.39% 是 PR #86 当时的字体栈；后续 baseline
      //     多次更新引入了不同字体子集，跨 darwin 字体 AA 噪声上涨到 0.6-0.7%
      //     （PR #90 实测 narrow 档 4361 像素 / 768000 = 0.568%）。
      //   · 真漂移（故障注入：.th-hud 从 top:24 挪到 32，即 8px）：0.69%
      //   · 1% 在 8px 漂移之上 → 真漂移仍能抓；同时吃得下跨机器 AA 噪声上涨。
      //   · 抓不住的上限（间距 ≥12px 的大漂移）还是会被抓——配置改阈值掩盖
      //     不了真实的几何回归，只对字体 sub-pixel 这种已知噪声源放行。
      // 终局方案：spec/d11-visual-regression/tasks.md 已声明——"若哪天噪声涨到
      // 接近 0.5%，正确做法是用 Docker 固定渲染环境"——可后续单独 PR 收口。
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'dark',
    // 固定 DPR：不同机器缩放比会让像素数不同（Retina 上是 2x）
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'npm run visual:serve',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
