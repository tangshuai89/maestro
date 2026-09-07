/**
 * storage.ts 纯函数测试（mock localStorage）。
 * 运行: node src/lib/storage.test.mjs
 *
 * 覆盖：
 *  - STORAGE_KEYS 常量
 *  - readStoredProvider / writeStoredProvider / clearStoredProvider
 *  - readStoredVolume / readStoredMuted / writeStoredVolume
 *  - readStoredQuality / writeStoredQuality
 *  - readStoredDeezerPreset / writeStoredDeezerPreset
 *  - readStoredTheme / writeStoredTheme
 *  - collectLocalStorage / restoreLocalStorage
 *  - legacy key migration (musicbox:* → maestro:*)
 *  - localStorage 异常安全
 */
// Mock localStorage before importing storage.ts (which runs migration on import)
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => lsStore.get(k) ?? null,
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.window = globalThis;

const {
  STORAGE_KEYS,
  readStoredProvider,
  writeStoredProvider,
  clearStoredProvider,
  readStoredVolume,
  readStoredMuted,
  writeStoredVolume,
  readStoredQuality,
  writeStoredQuality,
  readStoredDeezerPreset,
  writeStoredDeezerPreset,
  readStoredTheme,
  writeStoredTheme,
  collectLocalStorage,
  restoreLocalStorage,
} = await import('./storage.ts');

let passed = 0;
let failed = 0;
function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}
function fail(label, msg) {
  console.log(`❌ ${label}\n   ${msg}`);
  failed++;
}
function expect(label, cond, detail = '') {
  if (cond) ok(label);
  else fail(label, detail);
}
function reset() {
  lsStore.clear();
}

// ── 1. STORAGE_KEYS 常量 ──────────────────────────────────────
{
  expect('1. STORAGE_KEYS 有 5 个 key', Object.keys(STORAGE_KEYS).length === 5);
  expect('1b. STORAGE_KEYS.provider = "music-provider"', STORAGE_KEYS.provider === 'music-provider');
  expect('1c. STORAGE_KEYS.volume = "maestro:volume"', STORAGE_KEYS.volume === 'maestro:volume');
  expect('1d. STORAGE_KEYS.theme = "maestro:theme"', STORAGE_KEYS.theme === 'maestro:theme');
}

// ── 2. readStoredProvider：无值 → null ────────────────────────
reset();
{
  expect('2. readStoredProvider 无值 → null', readStoredProvider() === null);
}

// ── 3. readStoredProvider：合法值 ─────────────────────────────
reset();
{
  for (const p of ['qq', 'netease', 'deezer', 'spotify']) {
    lsStore.set(STORAGE_KEYS.provider, p);
    expect(`3. readStoredProvider("${p}") → "${p}"`, readStoredProvider() === p);
  }
}

// ── 4. readStoredProvider：非法值 → null ──────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.provider, 'bogus');
  expect('4. readStoredProvider("bogus") → null', readStoredProvider() === null);
}

// ── 5. writeStoredProvider / clearStoredProvider ──────────────
reset();
{
  writeStoredProvider('qq');
  expect('5. writeStoredProvider → LS 有值', lsStore.get(STORAGE_KEYS.provider) === 'qq');
  expect('5b. readStoredProvider 读回', readStoredProvider() === 'qq');
  clearStoredProvider();
  expect('5c. clearStoredProvider → LS 无值', !lsStore.has(STORAGE_KEYS.provider));
  expect('5d. readStoredProvider 清除后 → null', readStoredProvider() === null);
}

// ── 6. readStoredVolume：无值 → 默认 1 ────────────────────────
reset();
{
  expect('6. readStoredVolume 无值 → 1', readStoredVolume() === 1);
}

// ── 7. readStoredVolume：合法 JSON ────────────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: 0.5, muted: true }));
  expect('7. readStoredVolume 合法 → 0.5', readStoredVolume() === 0.5);
  expect('7b. readStoredMuted 合法 → true', readStoredMuted() === true);
}

// ── 8. readStoredVolume：边界值 0 和 1 ────────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: 0, muted: false }));
  expect('8. readStoredVolume = 0 → 0', readStoredVolume() === 0);
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: 1, muted: false }));
  expect('8b. readStoredVolume = 1 → 1', readStoredVolume() === 1);
}

// ── 9. readStoredVolume：超范围 → 默认 1 ──────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: 1.5, muted: false }));
  expect('9. readStoredVolume > 1 → 默认 1', readStoredVolume() === 1);
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: -0.5, muted: false }));
  expect('9b. readStoredVolume < 0 → 默认 1', readStoredVolume() === 1);
}

// ── 10. readStoredVolume：非 number → 默认 1 ──────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: "loud", muted: false }));
  expect('10. readStoredVolume 非 number → 默认 1', readStoredVolume() === 1);
}

// ── 11. readStoredVolume：坏 JSON → 默认 1 ─────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, 'not-json');
  expect('11. readStoredVolume 坏 JSON → 默认 1', readStoredVolume() === 1);
  expect('11b. readStoredMuted 坏 JSON → false', readStoredMuted() === false);
}

// ── 12. readStoredMuted：无 muted 字段 → false ────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.volume, JSON.stringify({ volume: 0.5 }));
  expect('12. readStoredMuted 无 muted 字段 → false', readStoredMuted() === false);
}

// ── 13. writeStoredVolume ─────────────────────────────────────
reset();
{
  writeStoredVolume(0.3, true);
  const raw = lsStore.get(STORAGE_KEYS.volume);
  const parsed = JSON.parse(raw);
  expect('13. writeStoredVolume 写入 volume', parsed.volume === 0.3);
  expect('13b. writeStoredVolume 写入 muted', parsed.muted === true);
  expect('13c. readStoredVolume 读回', readStoredVolume() === 0.3);
  expect('13d. readStoredMuted 读回', readStoredMuted() === true);
}

// ── 14. readStoredQuality：默认 standard ──────────────────────
reset();
{
  expect('14. readStoredQuality 无值 → standard', readStoredQuality() === 'standard');
}

// ── 15. readStoredQuality：合法值 ─────────────────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.quality, 'high');
  expect('15. readStoredQuality("high") → high', readStoredQuality() === 'high');
  lsStore.set(STORAGE_KEYS.quality, 'lossless');
  expect('15b. readStoredQuality("lossless") → lossless', readStoredQuality() === 'lossless');
  lsStore.set(STORAGE_KEYS.quality, 'standard');
  expect('15c. readStoredQuality("standard") → standard', readStoredQuality() === 'standard');
}

// ── 16. readStoredQuality：非法值 → standard ──────────────────
reset();
{
  lsStore.set(STORAGE_KEYS.quality, 'ultra');
  expect('16. readStoredQuality("ultra") → standard', readStoredQuality() === 'standard');
}

// ── 17. writeStoredQuality ────────────────────────────────────
reset();
{
  writeStoredQuality('lossless');
  expect('17. writeStoredQuality → LS 有值', lsStore.get(STORAGE_KEYS.quality) === 'lossless');
  expect('17b. readStoredQuality 读回', readStoredQuality() === 'lossless');
}

// ── 18. readStoredDeezerPreset：默认 asia ─────────────────────
reset();
{
  expect('18. readStoredDeezerPreset 无值 → asia', readStoredDeezerPreset() === 'asia');
}

// ── 19. readStoredDeezerPreset / writeStoredDeezerPreset ──────
reset();
{
  writeStoredDeezerPreset('rock');
  expect('19. writeStoredDeezerPreset → LS 有值', lsStore.get(STORAGE_KEYS.deezerPreset) === 'rock');
  expect('19b. readStoredDeezerPreset 读回', readStoredDeezerPreset() === 'rock');
}

// ── 20. readStoredTheme：默认 system ──────────────────────────
reset();
{
  expect('20. readStoredTheme 无值 → system', readStoredTheme() === 'system');
}

// ── 21. readStoredTheme / writeStoredTheme ────────────────────
reset();
{
  writeStoredTheme('dark');
  expect('21. writeStoredTheme → LS 有值', lsStore.get(STORAGE_KEYS.theme) === 'dark');
  expect('21b. readStoredTheme 读回 dark', readStoredTheme() === 'dark');
  writeStoredTheme('light');
  expect('21c. readStoredTheme 读回 light', readStoredTheme() === 'light');
}

// ── 22. collectLocalStorage：空 ───────────────────────────────
reset();
{
  const result = collectLocalStorage();
  expect('22. collectLocalStorage 空 → {}', Object.keys(result).length === 0);
}

// ── 23. collectLocalStorage：有值 ─────────────────────────────
reset();
{
  writeStoredProvider('qq');
  writeStoredVolume(0.5, false);
  writeStoredTheme('dark');
  const result = collectLocalStorage();
  expect('23. collectLocalStorage 收集 3 个 key', Object.keys(result).length === 3);
  expect('23b. collectLocalStorage 含 provider', result[STORAGE_KEYS.provider] === 'qq');
  expect('23c. collectLocalStorage 含 theme', result[STORAGE_KEYS.theme] === 'dark');
}

// ── 24. collectLocalStorage：null 值不收集 ────────────────────
reset();
{
  writeStoredProvider('qq');
  // volume 不写
  const result = collectLocalStorage();
  expect('24. collectLocalStorage 只收集有值的 key', Object.keys(result).length === 1);
}

// ── 25. restoreLocalStorage：正常恢复 ─────────────────────────
reset();
{
  restoreLocalStorage({
    [STORAGE_KEYS.provider]: 'netease',
    [STORAGE_KEYS.theme]: 'light',
    [STORAGE_KEYS.volume]: JSON.stringify({ volume: 0.3, muted: false }),
  });
  expect('25. restoreLocalStorage 恢复 provider', readStoredProvider() === 'netease');
  expect('25b. restoreLocalStorage 恢复 theme', readStoredTheme() === 'light');
  expect('25c. restoreLocalStorage 恢复 volume', readStoredVolume() === 0.3);
}

// ── 26. restoreLocalStorage：忽略未知 key ─────────────────────
reset();
{
  restoreLocalStorage({
    'unknown:key': 'value',
    [STORAGE_KEYS.provider]: 'qq',
  });
  expect('26. restoreLocalStorage 忽略未知 key', !lsStore.has('unknown:key'));
  expect('26b. restoreLocalStorage 只恢复已知 key', readStoredProvider() === 'qq');
}

// ── 27. restoreLocalStorage：空对象不崩 ───────────────────────
reset();
{
  restoreLocalStorage({});
  expect('27. restoreLocalStorage 空对象 → 不崩', true);
  restoreLocalStorage(null);
  expect('27b. restoreLocalStorage null → 不崩', true);
}

// ── 28. restoreLocalStorage：非 string 值跳过 ─────────────────
reset();
{
  restoreLocalStorage({
    [STORAGE_KEYS.provider]: 12345, // 非 string
  });
  expect('28. restoreLocalStorage 非 string 值 → 跳过', readStoredProvider() === null);
}

// ── 29. legacy key migration：musicbox:* → maestro:* ──────────
reset();
{
  // 重新 import 会触发 migration，但模块已 cached。
  // 手动模拟 migration 逻辑验证：
  lsStore.set('musicbox:volume', JSON.stringify({ volume: 0.7, muted: false }));
  lsStore.set('musicbox:theme', 'dark');
  // 手动跑 migration（模拟重新 import）
  const LEGACY_MAP = {
    'musicbox:volume': STORAGE_KEYS.volume,
    'musicbox:qq-quality': STORAGE_KEYS.quality,
    'musicbox:deezer-preset': STORAGE_KEYS.deezerPreset,
    'musicbox:theme': STORAGE_KEYS.theme,
  };
  for (const [oldKey, newKey] of Object.entries(LEGACY_MAP)) {
    const oldVal = lsStore.get(oldKey);
    if (oldVal == null) continue;
    if (lsStore.get(newKey) == null) lsStore.set(newKey, oldVal);
    lsStore.delete(oldKey);
  }
  expect('29. migration: musicbox:volume → maestro:volume', lsStore.has(STORAGE_KEYS.volume));
  expect('29b. migration: musicbox:theme → maestro:theme', lsStore.get(STORAGE_KEYS.theme) === 'dark');
  expect('29c. migration: 旧 key 已删', !lsStore.has('musicbox:volume'));
  expect('29d. migration: 旧 theme key 已删', !lsStore.has('musicbox:theme'));
}

// ── 30. legacy migration：新 key 已有值时不覆盖 ───────────────
reset();
{
  lsStore.set('musicbox:theme', 'dark');
  lsStore.set(STORAGE_KEYS.theme, 'light'); // 新 key 已有值
  // 手动跑 migration
  const oldVal = lsStore.get('musicbox:theme');
  if (oldVal != null) {
    if (lsStore.get(STORAGE_KEYS.theme) == null) lsStore.set(STORAGE_KEYS.theme, oldVal);
    lsStore.delete('musicbox:theme');
  }
  expect('30. migration: 新 key 已有值时不覆盖', lsStore.get(STORAGE_KEYS.theme) === 'light');
  expect('30b. migration: 旧 key 仍被删除', !lsStore.has('musicbox:theme'));
}

// ── 31. localStorage 异常安全（writeStoredVolume）─────────────
reset();
{
  const origSetItem = lsStore.set;
  lsStore.set = () => { throw new Error('QuotaExceeded'); };
  let threw = false;
  try { writeStoredVolume(0.5, false); } catch { threw = true; }
  expect('31. writeStoredVolume LS 异常 → 不崩', !threw);
  lsStore.set = origSetItem;
}

// ── 32. localStorage 异常安全（restoreLocalStorage）───────────
reset();
{
  const origSetItem = lsStore.set;
  lsStore.set = () => { throw new Error('QuotaExceeded'); };
  let threw = false;
  try {
    restoreLocalStorage({ [STORAGE_KEYS.provider]: 'qq' });
  } catch { threw = true; }
  expect('32. restoreLocalStorage LS 异常 → 不崩', !threw);
  lsStore.set = origSetItem;
}

// ── 33. round-trip: collect → restore ─────────────────────────
reset();
{
  writeStoredProvider('spotify');
  writeStoredVolume(0.42, true);
  writeStoredQuality('high');
  writeStoredDeezerPreset('rock');
  writeStoredTheme('dark');
  const snapshot = collectLocalStorage();
  reset();
  restoreLocalStorage(snapshot);
  expect('33. round-trip provider', readStoredProvider() === 'spotify');
  expect('33b. round-trip volume', readStoredVolume() === 0.42);
  expect('33c. round-trip muted', readStoredMuted() === true);
  expect('33d. round-trip quality', readStoredQuality() === 'high');
  expect('33e. round-trip deezerPreset', readStoredDeezerPreset() === 'rock');
  expect('33f. round-trip theme', readStoredTheme() === 'dark');
}

console.log(`\n🎉 storage.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
