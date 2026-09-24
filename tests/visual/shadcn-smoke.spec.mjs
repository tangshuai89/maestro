// shadcn Phase 1 视觉基线
// ─────────────────────────────────────────────────────────────
// 单测 ButtonSmoke 组件（不进任何 baseline 化页面），保证：
//   1. tokens-bridge.scss 颜色桥接正确（AETHER → shadcn HSL）
//   2. Tailwind 三层编译链通（base/components/utilities）
//   3. shadcn 组件（Button/Dialog/Tooltip）渲染无 crash
//
// 入口：tests/visual/shadcn-smoke.html —— 一个独立 HTML 加载 ButtonSmoke
// 组件（不进 App 路由，避免触发 ThearterView 等）。
//
// 历史：shadcn-migration spec commit 6。
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('shadcn Phase 1 smoke', () => {
  test('ButtonSmoke @ 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const html = path.resolve(__dirname, 'shadcn-smoke.html');
    await page.goto(`file://${html}`);
    await expect(page.locator('.shadcn-smoke-root')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.shadcn-smoke-root')).toHaveScreenshot('shadcn-smoke-1440x900.png');
  });
});
