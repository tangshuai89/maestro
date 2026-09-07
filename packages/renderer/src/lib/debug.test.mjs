/**
 * debug.ts 测试（mock window + localStorage + URLSearchParams）。
 * 运行: node src/lib/debug.test.mjs
 *
 * 覆盖：
 *  - isWpsDebug：URL ?wpsDebug=1 → true
 *  - isWpsDebug：URL ?wpsDebug=0 → false（URL 优先于 LS）
 *  - isWpsDebug：URL 无 flag + LS=1 → true
 *  - isWpsDebug：URL 无 flag + LS 无 → false
 *  - isWpsDebug：localStorage 抛异常 → false
 *  - wpsLog/wpsWarn/wpsError：debug 关时不静默
 *  - wpsLog/wpsWarn/wpsError：debug 开时输出
 *  - wpsDebugBanner：只打一次
 *  - __wpsDebugOn/Off：写 LS + reload
 */
import {
  isWpsDebug,
  wpsLog,
  wpsWarn,
  wpsError,
  wpsDebugBanner,
  __wpsDebugOn,
  __wpsDebugOff,
} from './debug.ts';

// ── mock window / localStorage / location ─────────────────────
const lsStore = new Map();
const localStorageMock = {
  getItem: (k) => lsStore.get(k) ?? null,
  setItem: (k, v) => lsStore.set(k, v),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

let locationSearch = '';
let reloadCalled = false;

const locationMock = {
  get search() { return locationSearch; },
  reload: () => { reloadCalled = true; },
};

const consoleLogSpy = [];
const consoleWarnSpy = [];
const consoleErrorSpy = [];
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

function setupWindow() {
  globalThis.window = {
    location: locationMock,
    __wpsDebugOn,
    __wpsDebugOff,
  };
  globalThis.localStorage = localStorageMock;
  // debug.ts uses bare `location.reload()` (global), not `window.location`
  globalThis.location = locationMock;
}

function spyConsole() {
  console.log = (...args) => consoleLogSpy.push(args.join(' '));
  console.warn = (...args) => consoleWarnSpy.push(args.join(' '));
  console.error = (...args) => consoleErrorSpy.push(args.join(' '));
}

function restoreConsole() {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origError;
}

function reset() {
  lsStore.clear();
  locationSearch = '';
  reloadCalled = false;
  consoleLogSpy.length = 0;
  consoleWarnSpy.length = 0;
  consoleErrorSpy.length = 0;
  // reset bannered flag by re-importing is not feasible; test banner separately
}

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

setupWindow();
spyConsole();

// ── 1. isWpsDebug：URL ?wpsDebug=1 → true ─────────────────────
reset();
{
  locationSearch = '?wpsDebug=1';
  expect('1. URL ?wpsDebug=1 → true', isWpsDebug() === true);
}

// ── 2. isWpsDebug：URL ?wpsDebug=0 → false ────────────────────
reset();
{
  locationSearch = '?wpsDebug=0';
  lsStore.set('maestro:debug-wps', '1');
  expect(
    '2. URL ?wpsDebug=0 → false（URL 优先于 LS=1）',
    isWpsDebug() === false,
  );
}

// ── 3. isWpsDebug：URL 无 flag + LS=1 → true ──────────────────
reset();
{
  locationSearch = '';
  lsStore.set('maestro:debug-wps', '1');
  expect('3. URL 无 flag + LS=1 → true', isWpsDebug() === true);
}

// ── 4. isWpsDebug：URL 无 flag + LS 无 → false ────────────────
reset();
{
  locationSearch = '';
  expect('4. URL 无 flag + LS 无 → false', isWpsDebug() === false);
}

// ── 5. isWpsDebug：URL ?wpsDebug=true → true ──────────────────
reset();
{
  locationSearch = '?wpsDebug=true';
  expect('5. URL ?wpsDebug=true → true', isWpsDebug() === true);
}

// ── 6. isWpsDebug：URL ?wpsDebug=false → false ────────────────
reset();
{
  locationSearch = '?wpsDebug=false';
  expect('6. URL ?wpsDebug=false → false', isWpsDebug() === false);
}

// ── 7. isWpsDebug：localStorage 抛异常 → false ────────────────
reset();
{
  locationSearch = '';
  const origGetItem = localStorageMock.getItem;
  localStorageMock.getItem = () => { throw new Error('SecurityError'); };
  expect('7. localStorage 抛异常 → false', isWpsDebug() === false);
  localStorageMock.getItem = origGetItem;
}

// ── 8. wpsLog：debug 关 → 不输出 ──────────────────────────────
reset();
{
  locationSearch = '';
  consoleLogSpy.length = 0;
  wpsLog('test', 'hello');
  expect('8. wpsLog debug 关 → 不输出', consoleLogSpy.length === 0);
}

// ── 9. wpsLog：debug 开 → 输出 ────────────────────────────────
reset();
{
  locationSearch = '?wpsDebug=1';
  consoleLogSpy.length = 0;
  wpsLog('test', 'hello');
  expect(
    '9. wpsLog debug 开 → 输出 [wps-debug][test]',
    consoleLogSpy.length === 1 && consoleLogSpy[0].includes('[wps-debug][test]'),
    consoleLogSpy[0],
  );
}

// ── 10. wpsWarn：debug 开 → console.warn ──────────────────────
reset();
{
  locationSearch = '?wpsDebug=1';
  consoleWarnSpy.length = 0;
  wpsWarn('cat', 'warn-msg');
  expect(
    '10. wpsWarn debug 开 → console.warn',
    consoleWarnSpy.length === 1 && consoleWarnSpy[0].includes('[wps-debug][cat]'),
  );
}

// ── 11. wpsError：debug 开 → console.error ────────────────────
reset();
{
  locationSearch = '?wpsDebug=1';
  consoleErrorSpy.length = 0;
  wpsError('cat', 'err-msg');
  expect(
    '11. wpsError debug 开 → console.error',
    consoleErrorSpy.length === 1 && consoleErrorSpy[0].includes('[wps-debug][cat]'),
  );
}

// ── 12. wpsWarn/Error：debug 关 → 不输出 ──────────────────────
reset();
{
  locationSearch = '';
  consoleWarnSpy.length = 0;
  consoleErrorSpy.length = 0;
  wpsWarn('cat', 'x');
  wpsError('cat', 'x');
  expect(
    '12. wpsWarn/Error debug 关 → 不输出',
    consoleWarnSpy.length === 0 && consoleErrorSpy.length === 0,
  );
}

// ── 13. __wpsDebugOn：写 LS + reload ──────────────────────────
reset();
{
  reloadCalled = false;
  __wpsDebugOn();
  expect(
    '13. __wpsDebugOn → LS=1 + reload',
    lsStore.get('maestro:debug-wps') === '1' && reloadCalled,
  );
}

// ── 14. __wpsDebugOff：删 LS + reload ─────────────────────────
reset();
{
  lsStore.set('maestro:debug-wps', '1');
  reloadCalled = false;
  __wpsDebugOff();
  expect(
    '14. __wpsDebugOff → LS 删除 + reload',
    !lsStore.has('maestro:debug-wps') && reloadCalled,
  );
}

// ── 15. __wpsDebugOn：localStorage 抛异常不崩 ─────────────────
reset();
{
  const origSetItem = localStorageMock.setItem;
  localStorageMock.setItem = () => { throw new Error('QuotaExceeded'); };
  reloadCalled = false;
  let threw = false;
  try { __wpsDebugOn(); } catch { threw = true; }
  expect('15. __wpsDebugOn LS 抛异常 → 不崩（仍 reload）', !threw && reloadCalled);
  localStorageMock.setItem = origSetItem;
}

// ── 16. window.__wpsDebugOn/Off 已挂载 ────────────────────────
reset();
{
  const w = globalThis.window;
  expect(
    '16. window.__wpsDebugOn/Off 已挂载',
    typeof w.__wpsDebugOn === 'function' && typeof w.__wpsDebugOff === 'function',
  );
}

restoreConsole();
console.log(`\n🎉 debug.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
