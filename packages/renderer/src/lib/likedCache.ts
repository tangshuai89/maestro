import type { LibraryImportResult } from '../api';

/**
 * Last-good `LibraryImportResult` mirror in localStorage, so reopening
 * the LikedLibraryModal paints instantly with stale data while a fresh
 * `getLibrary()` runs in the background (stale-while-revalidate).
 *
 * **localStorage** (was sessionStorage before perf-cache):
 *   - cross-launch persistence: closing & relaunching Maestro still has
 *     a fresh-enough snapshot to paint the modal on first open, instead
 *     of falling back to the 6-row skeleton + wait-for-network path.
 *     Critical for ≥3000-track libraries where the network round-trip +
 *     fanOut merge + React render of 3000 rows can take several seconds.
 *   - quota (5–10 MB) is plenty: 3000 items × ~2 sources × ~200 bytes
 *     of metadata ≈ 200–500 KB JSON. We still catch QuotaExceededError
 *     and silently degrade to "first ever open" — a write failure must
 *     never block the UI.
 *   - private-mode browsers throw on `localStorage` access. The whole
 *     helper is try/catch'd so we never break the host component.
 *
 * **Staleness tolerance**: we keep entries up to `MAX_AGE_MS` (30 days)
 * and accept whatever is there as the "first frame" data. Anything older
 * is discarded and we wait for the network; the user can still re-trigger
 * a real import via the modal's refresh button. This guards against the
 * cache poisoning the UI for a user who hasn't opened the app in weeks
 * and whose ❤ count has drifted significantly.
 *
 * The payload shape matches the network response, so the same `setData`
 * call works whether the data came from cache or fetch.
 */
const CACHE_KEY = 'maestro:liked-library-cache';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function readCachedLibrary(): LibraryImportResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LibraryImportResult;
    if (
      !parsed ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.sources) ||
      typeof parsed.importedAt !== 'number'
    ) {
      return null;
    }
    // 缓存陈旧到一程度就不再信任——避免"我两周前 ❤ 过 50 首，弹窗却显示
    // 旧数据假装是现在"。后台 getLibrary 拉到后会立刻覆盖，这里只决定
    // 是否用缓存做首帧秒开。
    if (Date.now() - parsed.importedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedLibrary(lib: LibraryImportResult): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(lib));
  } catch {
    /* quota / private mode — degrade silently, modal just won't have a cache next open */
  }
}

export function clearCachedLibrary(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}