// ─────────────────────────────────────────────────────────────
// 跨包 E2E 配置（H7：第 7 层「E2E 全链路」）
//
// 与 `playwright.config.mjs`（视觉回归）**分开**，因为两者的服务端需求不同：
//   - 视觉回归：不需要后端（Playwright 在网络层 stub 掉 API）→ 确定性截图
//   - 跨包 E2E：**需要真后端**（真 NestJS 路由 / 真控制器 / 真存储 / 真音频代理）
//
// 组成：
//   1. **E2E server** —— 真 NestJS，只把「平台本身」换成假 provider
//      （packages/server/src/e2e/e2e-server.ts）。零产品代码改动。
//   2. **renderer 产物** —— vite preview 起 dist（跟视觉回归同一套命令），
//      浏览器里跑的是**真的出厂产物**，不是 dev server 的热更新版本。
//
// ⚠️ 为什么 renderer 用 `http://localhost:3200` 而不是 127.0.0.1：
//    生产模式的 renderer 没有 electronAPI → API origin 兜底成
//    `http://localhost:3200`（api.ts 的 resolveApiOrigin）。而 localhost 在
//    部分机器上解析成 ::1 → 只绑 127.0.0.1 会出现「浏览器连不上、curl 连得上」
//    的幽灵故障。E2E server 因此**不指定 host**（绑全部网卡）。
//
// ⚠️ CORS：renderer 产物的 origin 是 127.0.0.1:4173，server 的 allowlist 默认
//    只放行 3000 + 5273-5322 → E2E server 用 `RENDERER_ORIGINS` **追加**
//    （env 是追加不是替换，见 server/src/common/config.ts 的注释）。
// ─────────────────────────────────────────────────────────────
import { defineConfig } from '@playwright/test';

const PREVIEW_PORT = 4173;
// ⚠️ **专用端口**（不是 3200）：3200 是 Electron sidecar 的端口，用户开着 app
//   时它一直在监听 → 端口冲突 + `reuseExistingServer` 静默复用**真** server
//   → E2E 测的不是假 provider，还会把红心写进用户真实账号（实测踩到）。
const API_PORT = 3210;

export default defineConfig({
  testDir: './tests/e2e',
  // ⚠️ 串行：E2E server 是**单例**（一个端口、一个 session 存储），
  // 并发跑会互相踩收藏状态。
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'e2e-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    // 失败时留 trace —— 跨包链路出问题时光看报错不够，要能回放。
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run e2e:server',
      // 用一个真端点判活（HEAD/GET 都行）—— /music/liked 返回 200。
      url: `http://127.0.0.1:${API_PORT}/music/liked?provider=qq`,
      // ⚠️ **绝不复用**已有的 server：那个端口上若是用户的 app sidecar，
      //   复用 = 测错对象 + 往用户真实账号写红心。起不来就直接失败。
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run visual:serve',
      url: `http://127.0.0.1:${PREVIEW_PORT}`,
      // 同理：preview 也必须是**我们自己起的**那份产物（复用别人的 = 测错版本）。
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
