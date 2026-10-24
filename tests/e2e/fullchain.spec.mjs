// ─────────────────────────────────────────────────────────────
// H7 —— 跨包 E2E 全链路：搜索 → 播放 → 收藏 → 角标 → 刷新后仍在
//
// 这条链**每一步都穿过两个包**：
//   renderer（真产物，浏览器里） → HTTP → server（真 NestJS 路由 / 真控制器 /
//   真存储 / 真音频代理） → 假 provider（只有「平台本身」是假的）
//
// 之前仓库里没有一条这样的链：
//   - Playwright 只覆盖 3 个视图（首屏 / 剧场密度 / ButtonSmoke），API 是
//     **在网络层 stub 掉的** → 只能验「长得对不对」，验不了「链路通不通」。
//   - server 侧的 e2e（*.e2e.test.ts）用 in-process HTTP 调内部 handler，
//     **没有 renderer 参与** → 验不了「renderer 期望的形状和 server 返回的是
//     不是同一个」。
//   - renderer 侧的 hook 测试把 `../api` 整个 mock 掉 → 验不了跨包契约。
//
// ⚠️ 断言要钉在**跨包事实**上，不是组件细节：
//   - 「真的打到了 server」（响应 2xx）而不是「UI 上出现了某个字」
//   - 「收藏真的落库了」（刷新后还在）而不是「按钮变红了」
//
// ⚠️ **会话 cookie 必须同站**（实测踩到，症状极隐蔽）：
//   页面在 `http://127.0.0.1:4173`、server 在 `http://127.0.0.1:3210` →
//   **跨站** → server 发的是 `SameSite=Lax` 的会话 cookie → 浏览器**不发送**
//   → 每个请求都被 server 当成新 session → 收藏写进了用完即弃的 session
//   → 「刷新后红心还在」这条断言永远失败，而且**看起来像产品的 bug**。
//   修法：注入 `window.electronAPI.apiBase`（**生产环境本来就靠它**把 sidecar
//   的 origin 推给 renderer，见 api.ts 的 resolveApiOrigin）指向
//   `http://127.0.0.1:3210` → 页面与 API 同站 → cookie 正常带上。
// ⚠️ **E2E server 用专用端口 3210**（不是 3200）：3200 是 Electron sidecar 的
//   端口 → 用户开着 app 时它一直在监听 → 端口冲突 + Playwright 静默复用**真**
//   server → 测错对象，还会把红心写进用户真实账号。
// ─────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { installElectronStub, seedProvider as seedProviderLocal } from './electronStub.mjs';

const API_ORIGIN = 'http://127.0.0.1:3210';

/**
/**
 * 让 App 跳过 SourceSelect 直接进剧场 + 把 API origin 指到**同站**的 E2E server。
 *
 * 替身的**完整性**要求、以及为什么必须用**专用端口**（3210，不是 app sidecar 的
 * 3200），见 tests/e2e/electronStub.mjs 的文件头。
 */
async function seedProvider(page, provider = 'qq') {
  await seedProviderLocal(page, provider);
  await installElectronStub(page, API_ORIGIN);
}

/** 收集真实发生的跨包请求（用来断言「链路真的穿过去了」）。 */
function trackApiCalls(page) {
  const calls = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith(API_ORIGIN)) calls.push({ url, status: res.status() });
  });
  return calls;
}

test.describe('跨包全链路', () => {
  test('搜索 → 播放 → 收藏 → 角标 → 刷新后仍在', async ({ page }) => {
    await seedProvider(page);
    const calls = trackApiCalls(page);

    // ── 1. 打开 App（真产物）────────────────────────────────────
    await page.goto('/');
    const canvas = page.locator('.th-canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });

    // ── 2. 搜索（真 HTTP → 真控制器 → 假 provider 的结果）──────
    await page.locator('.titlebar-btn.search-btn').click();
    const searchInput = page.locator('.sp-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('E2E');

    // 结果条数来自 server 的响应（真跨包）
    await expect(page.locator('.sp-result-count')).toContainText('2 MATCHES', {
      timeout: 20_000,
    });
    expect(calls.some((c) => c.url.includes('/music/search?') && c.status === 200)).toBe(true);

    // ── 3. 播放（真音频代理：server 拉上游 → 转发字节给浏览器）──
    await page.locator('.sp-item .sp-row').first().click();
    // 搜索面板收起 → 回到剧场
    await expect(page.locator('.sp-root')).toBeHidden();
    await expect(page.locator('.th-track-sub')).toContainText('测试歌手');

    // 音频元素真的装上了 server 的代理 URL
    const audio = page.locator('audio').first();
    await expect
      .poll(async () => await audio.getAttribute('src'), { timeout: 20_000 })
      .toContain('/music/stream/qq/');
    // 而且 server 真的返回了音频字节（不是 502/403）
    await expect
      .poll(async () => calls.find((c) => c.url.includes('/music/stream/qq/'))?.status, {
        timeout: 20_000,
      })
      .toBe(200);

    // 播放态：核心按钮进入 is-playing
    await expect(page.locator('.th-core')).toHaveClass(/is-playing/, { timeout: 20_000 });

    // ── 4. 收藏（真 POST → 真 fan-out → 落库）──────────────────
    const likeBtn = page.locator('.th-like');
    await expect(likeBtn).toBeEnabled();
    await likeBtn.click();
    // aria-pressed 变 true = 红心点亮
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
    // ⚠️ NestJS 的 @Post 默认返 **201 Created**（不是 200）——这里断言「2xx」
    // 而不是写死 200，否则会在 server 侧改成 @HttpCode(200) 时误报。
    expect(
      calls.some((c) => c.url.includes('/music/like/merged') && c.status >= 200 && c.status < 300),
    ).toBe(true);

    // ── 5. 角标 = 跨平台平台数（真 detect → fannedOutTo）────────
    // 假 detect 返回 ['qq','netease'] → 2 → 徽标显示 2
    await expect(page.locator('.th-like-badge')).toHaveText('2', { timeout: 20_000 });

    // ── 6. 刷新后仍在（**真的落库了**，不是内存里的状态）──────
    await page.reload();
    await expect(page.locator('.th-canvas')).toBeVisible({ timeout: 30_000 });
    // 重新搜索并播同一首 → 红心应当是**亮的**（从库里读回来的）
    await page.locator('.titlebar-btn.search-btn').click();
    await expect(page.locator('.sp-search-input')).toBeVisible();
    await page.locator('.sp-search-input').fill('E2E');
    await expect(page.locator('.sp-result-count')).toContainText('2 MATCHES', { timeout: 20_000 });
    await page.locator('.sp-item .sp-row').first().click();
    await expect(page.locator('.th-like')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20_000,
    });
  });

  test('一个平台的流取不到 → 自动降级到另一个平台（跨包降级链）', async ({ page }) => {
    // 这条链**单测碰不到**：server 的音频代理真的返 502 → renderer 的
    // onError → 跨平台兜底 → 换源 → UI 跟着换。
    //
    // 假 provider 里第二首歌「QQ 源取不到流、网易云源是好的」→ 点它。
    await seedProvider(page);
    const calls = trackApiCalls(page);
    await page.goto('/');
    await expect(page.locator('.th-canvas')).toBeVisible({ timeout: 30_000 });

    await page.locator('.titlebar-btn.search-btn').click();
    await page.locator('.sp-search-input').fill('E2E');
    await expect(page.locator('.sp-result-count')).toContainText('2 MATCHES', { timeout: 20_000 });

    // 第二首歌：它的 QQ 源是坏的
    await page.locator('.sp-item .sp-row').nth(1).click();

    // 音频元素最终换到了**网易云**的流（而不是一直卡在 QQ）
    await expect
      .poll(async () => await page.locator('audio').first().getAttribute('src'), {
        timeout: 30_000,
      })
      .toContain('/music/stream/netease/');

    // 而且真的打过 QQ 的流（先失败再换源，不是压根没试）
    //
    // ⚠️ **这里必须用 poll，不能用裸断言**（2026-10-24 实测踩到）：
    // 上面那个 poll 等的是 `<audio src>` **属性**，而 src 是渲染层**同步**设的、
    // 浏览器发请求是**异步**的 → 断言可能跑在请求之前。
    // 实测：CI 上这条连续两次都输掉这个竞态（本地加 1.5s 等待就 5/5 全过），
    // 而降级链**本身是好的**（netease 的流真的返 200、音频真的在放）。
    await expect
      .poll(() => calls.some((c) => c.url.includes('/music/stream/qq/')), { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(() => calls.some((c) => c.url.includes('/music/stream/netease/')), { timeout: 30_000 })
      .toBe(true);

    // 换源**不是**终点：得真的在放（用户可见的症状是「有声音」，不是「src 变了」）
    await expect
      .poll(
        async () =>
          await page
            .locator('audio')
            .first()
            .evaluate((el) => ({ t: el.currentTime, err: el.error && el.error.code })),
        { timeout: 30_000 },
      )
      .toMatchObject({ err: null });
    await expect
      .poll(
        async () => await page.locator('audio').first().evaluate((el) => el.currentTime),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  test('搜索无结果 → 明确空态，不崩', async ({ page }) => {
    await seedProvider(page);
    await page.goto('/');
    await expect(page.locator('.th-canvas')).toBeVisible({ timeout: 30_000 });
    await page.locator('.titlebar-btn.search-btn').click();
    await page.locator('.sp-search-input').fill('zzz-不存在的歌-zzz');
    // ⚠️ 结果条 `.sp-result-count` 只在**有结果**时渲染（SearchPanel 的
    // `items.length > 0` 条件）→ 空态要看 `.sp-empty`。
    await expect(page.locator('.sp-empty')).toHaveText('暂无结果', { timeout: 20_000 });
    // 页面还活着
    await expect(page.locator('.sp-root')).toBeVisible();
  });
});
