// ─────────────────────────────────────────────────────────────
// window.electronAPI 的**完整**替身（E2E 与浏览器覆盖采集共用）
//
// ── 为什么必须完整 ──────────────────────────────────────────────
// App 里有 `window.electronAPI?.reportPlayerMode(mode)` 这种写法 ——
// `?.` 只保护「**对象**为 null」，**不保护「方法不存在」** → 少一个方法就是
// `TypeError: reportPlayerMode is not a function` → effect 抛错 → React 崩
// → **整个页面空白**（症状：`.th-canvas` 根本不存在，极难定位）。
//
// 同理 `useDesktopLyrics` 会无保护地调 `api.getStatus()` / `api.onChanged(cb)`。
//
// ⚠️ **两处必须共用这一份**：E2E spec（tests/e2e/fullchain.spec.mjs）与浏览器
// 覆盖采集（scripts/collect-browser-coverage.mjs）都要注入它 —— 各写一份的话，
// 改了一处另一处就会以「页面空白」的形式炸掉。
//
// ── `apiBase` 的作用 ────────────────────────────────────────────
// 生产环境由 preload 推 sidecar 的 origin（api.ts 的 resolveApiOrigin 读它）。
// E2E 里**必须**指向 E2E 自己的 server（专用端口 3210）：3200 是 app sidecar
// 的端口 → 指着它 = 链路打到用户真 server 上（测错对象 + 往用户真实账号写红心）。
//
// `isElectron: false` = 让 App 走**浏览器**分支（E2E 不需要登录窗口；登录态是
// server 侧假出来的；走 Electron 分支会去调 IPC 登录）。
// ─────────────────────────────────────────────────────────────

/**
 * 在页面里装好 electronAPI 替身。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} apiBase  E2E server 的 origin（必须是**专用**端口）
 */
export async function installElectronStub(page, apiBase) {
  await page.addInitScript((api) => {
    window.electronAPI = {
      apiBase: api,
      isElectron: false,
      internalToken: '',
      reportPlayerMode: () => {},
      reportPlaybackState: () => {},
      setWindowButtonsVisible: () => {},
      getWidevineStatus: async () => ({ ready: false, status: 'e2e' }),
      onTrayCommand: () => () => {},
      consumeOAuthCallback: async () => null,
      qqLogin: async () => ({ success: false, error: 'e2e' }),
      neteaseLogin: async () => ({ success: false, error: 'e2e' }),
      openExternal: () => {},
      // ⚠️ desktopLyrics 的方法面要**完整**（preload 的那一组）：
      // useDesktopLyrics 会无保护地调 `api.getStatus()` / `api.onChanged(cb)`
      // → 少一个就是 TypeError → React 崩 → 整个页面空白。
      desktopLyrics: {
        pushState: () => {},
        setEnabled: () => {},
        getStatus: async () => ({ enabled: false }),
        onChanged: () => () => {},
      },
    };
  }, apiBase);
}

/**
 * 让 App 跳过 SourceSelect 直接进剧场（与 App 自带 `?demo=` 同一个 localStorage 键）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} provider
 */
export async function seedProvider(page, provider = 'qq') {
  await page.addInitScript((p) => {
    try {
      localStorage.setItem('music-provider', p);
    } catch {
      /* private mode：交给 SourceSelect 分支，断言会明确失败 */
    }
  }, provider);
}
