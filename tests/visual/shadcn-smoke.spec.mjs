// shadcn Phase 1 视觉基线
// ─────────────────────────────────────────────────────────────
// 单测 ButtonSmoke 组件：vite preview 起 renderer app，
// `?smoke=1` query 让 main.tsx 挂 ButtonSmoke 替代 App，
// 抓 tokens-bridge.scss 颜色 + Tailwind 编译链 + shadcn 组件渲染。
//
// 历史：shadcn-migration spec commit 6。
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';

test.describe('shadcn Phase 1 smoke', () => {
  test('ButtonSmoke @ 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?smoke=1`);
    await expect(page.locator('.shadcn-smoke-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.shadcn-smoke-root')).toHaveScreenshot('shadcn-smoke-1440x900.png');
  });
});
