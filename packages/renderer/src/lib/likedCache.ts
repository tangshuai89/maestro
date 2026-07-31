import type { LibraryImportResult } from '../api';

/**
 * Last-good `LibraryImportResult` mirror in sessionStorage, so reopening
 * the LikedLibraryModal paints instantly with stale data while a fresh
 * `getLibrary()` runs in the background (stale-while-revalidate).
 *
 * sessionStorage is intentional, not localStorage:
 *   - tied to the app tab/session — close Maestro and we don't want a
 *     stale "❤ 247" badge from weeks ago haunting the next launch;
 *   - private-mode + quota errors are swallowed: failure to read or write
 *     simply degrades to the "first ever open" skeleton path.
 *
 * The payload shape matches the network response, so the same `setData`
 * call works whether the data came from cache or fetch.
 */
const CACHE_KEY = 'maestro:liked-library-cache';

export function readCachedLibrary(): LibraryImportResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
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
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedLibrary(lib: LibraryImportResult): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(lib));
  } catch {
    /* quota / private mode — degrade silently, modal just won't have a cache next open */
  }
}

export function clearCachedLibrary(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}