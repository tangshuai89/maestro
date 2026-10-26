// ─────────────────────────────────────────────────────────────
// D11 — 剧场视图视觉回归
//
// 覆盖两屏（都在 Figma 里有对应 screen）：
//   A. **SourceSelect** —— App 在 `player.provider` 为空时渲染的首屏，无需 seed，天然确定；
//   B. **TheaterView** —— 需要 seed `localStorage['music-provider']`（与 App 自带的
//      `?demo=<provider>` 机制同一个键）才进得去。
//
// TheaterView 每个用例做两件事：
//   1) **断言 density 档位**（纯逻辑，与 lib/theaterLayout.ts 的阈值一一对应）——
//      不依赖像素，能直接抓住"断点改错了"；
//   2) **截图比对**（像素级）——抓 CSS 漂移。
//
// 尺寸取三档 + 一档宽屏：960×800(narrow) / 1200×800(compact) / 1440×900(regular) /
// 1920×1200(regular，验证大窗口放大档)。
//
// 接口全部 stub 成空态：视觉基线要的是**确定性**，有数据就会随曲库变。
// ─────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';

const SIZES = [
  { name: 'narrow-960x800', width: 960, height: 800, density: 'narrow' },
  { name: 'compact-1200x800', width: 1200, height: 800, density: 'compact' },
  { name: 'regular-1440x900', width: 1440, height: 900, density: 'regular' },
  { name: 'wide-1920x1200', width: 1920, height: 1200, density: 'regular' },
];

// 首屏尺寸：窗口最小宽 960 与设计基准 1440
const FIRST_SCREEN_SIZES = [
  { name: '960x800', width: 960, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
];

async function stubApi(page) {
  // preview 构建里 api.ts 的 resolveApiOrigin() 返回独立 sidecar origin
  // （http://localhost:3200），与页面 origin(127.0.0.1:4173) 不同源 ——
  // 旧 pattern '**/api/**' 从不匹配，所有请求 connection refused，页面一直
  // 隐性带 error（PlayerNotice 把它渲染出来后窄屏截图超容差）。
  // 这里按 sidecar origin 拦截。fetchWithToken 用 credentials:'include'
  // （session cookie），credentialed 跨域下 ACAO 不能是 '*' —— 必须回显
  // 请求 Origin 并允许 credentials，否则浏览器照样拦响应。
  const corsHeaders = (req) => {
    const h = req.headers();
    const headers = {};
    if (h['origin']) {
      headers['Access-Control-Allow-Origin'] = h['origin'];
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers['Vary'] = 'Origin';
    }
    if (h['access-control-request-method'])
      headers['Access-Control-Allow-Methods'] = h['access-control-request-method'];
    if (h['access-control-request-headers'])
      headers['Access-Control-Allow-Headers'] = h['access-control-request-headers'];
    return headers;
  };
  const stub = (route) => {
    const req = route.request();
    const headers = corsHeaders(req);
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers });
    }
    const url = req.url();
    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });
    // 空库：App 会进 idle 态（最稳定的视觉目标）
    if (url.includes('/music/library')) return json(404, { message: 'library_not_imported' });
    if (url.includes('/music/liked')) return json(200, []);
    if (url.includes('/music/next')) return json(200, null);
    // 列表型端点：renderer 期望 {items:[...]}，裸 {} 会读出 undefined.length
    if (url.includes('/editorials')) return json(200, { items: [] });
    if (url.includes('/music/playlists') || url.includes('/library/playlists'))
      return json(200, { items: [] });
    return json(200, {});
  };
  await page.route('http://localhost:3200/**', stub);
  await page.route('**/api/**', stub); // 兜底仍可能存在的 /api/ 前缀调用
}

/** 让 App 跳过 SourceSelect 进剧场：与 App 自带 `?demo=` 用的是同一个 localStorage 键 */
async function seedProvider(page, provider = 'deezer') {
  await page.addInitScript((p) => {
    try {
      localStorage.setItem('music-provider', p);
      // ⚠️ **同时标记「引导已看过」**（specs/first-run-guide）：首次启动引导是
      //   整屏覆盖层（z-index 500）⇒ 不标记的话它会盖住剧场界面 ⇒ 截图跟
      //   基线完全对不上（这个 job 比的是**剧场视图**，引导是另一个东西）。
      localStorage.setItem('maestro:onboarding-done', '1');
    } catch {
      /* private mode：交给 SourceSelect 分支，断言会明确失败 */
    }
  }, provider);
}

test.describe('SourceSelect（无凭据首屏）', () => {
  for (const s of FIRST_SCREEN_SIZES) {
    test(`first screen @ ${s.name}`, async ({ page }) => {
      await page.setViewportSize({ width: s.width, height: s.height });
      await stubApi(page);
      await page.goto('/');
      await expect(page.locator('.ss-root')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.ss-root')).toHaveScreenshot(`source-select-${s.name}.png`);
    });
  }
});

test.describe('TheaterView（三档 density）', () => {
  for (const s of SIZES) {
    test(`theater @ ${s.name}`, async ({ page }) => {
      await page.setViewportSize({ width: s.width, height: s.height });
      await stubApi(page);
      await seedProvider(page);
      await page.goto('/');

      const canvas = page.locator('.th-canvas');
      await expect(canvas).toBeVisible({ timeout: 15_000 });

      // 1) 档位断言（不依赖像素）
      await expect(canvas).toHaveAttribute('data-density', s.density);

      // 2) 截图比对
      // mask: 隔离 .th-hud-sync（HUD ❤ 数字区域）。这块渲染逻辑是 PR 主动改的
      // （feat/hud-cross-platform-likes：D.1 紧凑加号 + 上标），所以测试目的是
      // **其他 CSS 不要漂移**，而不是 ❤ 数字本身的像素级比对（❤ 数字字面值每次
      // 跑都不一样——和真实数据耦合——本来就该排除）。
      // 其他 4 处文字区域（brand / 选一首歌 / 等待播放 / 底部副标题）spec 已承认
      // 跨 darwin 字体引擎时序差异是已知噪声源（0.1% 容差在 PR #86 假红过），
      // 不在 mask 范围——容差留 0.5%（playwright.config.mjs 注释里"实测跨机器
      // 噪声 0.29%-0.39%"）。
      await expect(page.locator('.th-root')).toHaveScreenshot(`theater-${s.name}.png`, {
        mask: [page.locator('.th-hud-sync')],
      });
    });
  }
});
