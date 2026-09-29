import { chromium } from '@playwright/test';

const SIGNED = process.env.SIGNED;
const MODE = process.env.MODE ?? 'all'; // 'all' | 'netease'

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
await ctx.addCookies([
  { name: 'mb_session', value: SIGNED, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
]);
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/vite|DevTools|font|Hydrate/.test(t)) return;
  console.log('[console:' + m.type() + ']', t.slice(0, 400));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 140), r.failure()?.errorText));
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/music/stream/')) console.log('[stream]', r.status(), u.slice(0, 160));
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

// 选音源：网易云
await page.getByText('网易云音乐', { exact: false }).first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/step1.png' });
console.log('--- after enter, buttons ---');
console.log((await page.$$eval('button,[role=button]', (els) =>
  els.slice(0, 40).map((e) => `${e.className.slice(0, 40)}|${e.getAttribute('aria-label') || ''}|${(e.textContent || '').trim().slice(0, 16)}`))).join('\n'));

// 打开搜索
const searchBtn = page.locator('[aria-label*="搜索"], [title*="搜索"]').first();
if (await searchBtn.count()) await searchBtn.click();
else await page.keyboard.press('/');
await page.waitForTimeout(800);
const input = page.locator('.sp-search-input');
await input.waitFor({ timeout: 5000 });

if (MODE !== 'all') {
  // 切到 netease tab
  await page.locator('.sp-source-toggle button, .sp-src-chip, [class*=chip]').filter({ hasText: /N/ }).first().click().catch(() => {});
  await page.waitForTimeout(300);
}

await input.fill('浓缩蓝鲸');
await page.waitForTimeout(6000);
await page.screenshot({ path: `/tmp/search-${MODE}.png` });

const rows = await page.$$eval('.sp-row', (els) =>
  els.map((e, i) => i + ':' + (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)));
console.log('--- rows ---');
console.log(rows.join('\n'));

const idx = rows.findIndex((r) => r.includes(process.env.ROWMATCH ?? '裘德'));
console.log('裘德 row idx =', idx, rows[idx]);
if (idx >= 0) {
  await page.locator('.sp-row').nth(idx).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `/tmp/play-${MODE}.png` });
  const state = await page.evaluate(() => {
    const a = document.querySelector('audio');
    return {
      src: a?.src?.slice(0, 160),
      paused: a?.paused,
      readyState: a?.readyState,
      networkState: a?.networkState,
      err: a?.error ? { code: a.error.code, msg: a.error.message } : null,
      dur: a?.duration,
      t: a?.currentTime,
      title: document.querySelector('.th-title, .tv-title, [class*=title]')?.textContent?.trim().slice(0, 40),
      errBanner: document.body.innerText.match(/失败[^\n]*/)?.[0],
    };
  });
  console.log('--- audio state ---', JSON.stringify(state, null, 1));
}
await browser.close();
