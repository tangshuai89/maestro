// likedCache.test.mjs — tests for readCachedLibrary / writeCachedLibrary / clearCachedLibrary
//
// Mocks localStorage (Node doesn't have it).  The source file imports only
// a type from ../api (type-only, stripped at runtime), so no DOM globals
// are needed beyond localStorage.
//
// Run: node src/lib/likedCache.test.mjs

import * as assert from 'node:assert';

// ── mock localStorage ──────────────────────────────────────────────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${err.message}`);
    failed++;
  }
}

async function main() {
  const { readCachedLibrary, writeCachedLibrary, clearCachedLibrary } = await import('./likedCache.ts');

  // Helper: create a valid LibraryImportResult
  function makeLib(overrides = {}) {
    return {
      items: [{ id: 'a', title: 'Song', artist: 'X', coverUrl: '', duration: 200, sources: [], likedPlatforms: ['qq'] }],
      sources: [],
      importedAt: Date.now(),
      ...overrides,
    };
  }

  // ── 1. Empty cache → null ────────────────────────────────────────────
  lsStore.clear();
  check('1. readCachedLibrary on empty cache → null', () => {
    assert.strictEqual(readCachedLibrary(), null);
  });

  // ── 2. Write → read round-trip ───────────────────────────────────────
  lsStore.clear();
  check('2. writeCachedLibrary → readCachedLibrary round-trip', () => {
    const lib = makeLib();
    writeCachedLibrary(lib);
    const read = readCachedLibrary();
    assert.ok(read, 'should not be null after write');
    assert.deepStrictEqual(read.items, lib.items);
    assert.strictEqual(read.importedAt, lib.importedAt);
  });

  // ── 3. Clear → null ──────────────────────────────────────────────────
  lsStore.clear();
  check('3. clearCachedLibrary → readCachedLibrary → null', () => {
    writeCachedLibrary(makeLib());
    assert.ok(readCachedLibrary(), 'should exist before clear');
    clearCachedLibrary();
    assert.strictEqual(readCachedLibrary(), null);
  });

  // ── 4. Corrupt JSON → null ───────────────────────────────────────────
  lsStore.clear();
  check('4. corrupt JSON → null', () => {
    lsStore.set('maestro:liked-library-cache', '{not valid json');
    assert.strictEqual(readCachedLibrary(), null);
  });

  // ── 5. Missing fields → null ─────────────────────────────────────────
  lsStore.clear();
  check('5a. missing items array → null', () => {
    lsStore.set('maestro:liked-library-cache', JSON.stringify({ sources: [], importedAt: Date.now() }));
    assert.strictEqual(readCachedLibrary(), null);
  });
  check('5b. missing sources array → null', () => {
    lsStore.set('maestro:liked-library-cache', JSON.stringify({ items: [], importedAt: Date.now() }));
    assert.strictEqual(readCachedLibrary(), null);
  });
  check('5c. missing importedAt → null', () => {
    lsStore.set('maestro:liked-library-cache', JSON.stringify({ items: [], sources: [] }));
    assert.strictEqual(readCachedLibrary(), null);
  });
  check('5d. importedAt not a number → null', () => {
    lsStore.set('maestro:liked-library-cache', JSON.stringify({ items: [], sources: [], importedAt: 'yesterday' }));
    assert.strictEqual(readCachedLibrary(), null);
  });

  // ── 6. Stale cache (>30 days) → null ─────────────────────────────────
  lsStore.clear();
  check('6. stale cache (>30 days) → null', () => {
    const stale = makeLib({ importedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    writeCachedLibrary(stale);
    assert.strictEqual(readCachedLibrary(), null);
  });

  // ── 7. Fresh cache (just under 30 days) → returned ───────────────────
  lsStore.clear();
  check('7. fresh cache (29 days) → returned', () => {
    const fresh = makeLib({ importedAt: Date.now() - 29 * 24 * 60 * 60 * 1000 });
    writeCachedLibrary(fresh);
    const read = readCachedLibrary();
    assert.ok(read, '29-day cache should be returned');
    assert.deepStrictEqual(read.items, fresh.items);
  });

  // ── 8. writeCachedLibrary doesn't throw on quota error ───────────────
  lsStore.clear();
  check('8. writeCachedLibrary swallows quota error', () => {
    const origSetItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new DOMException('quota exceeded'); };
    try {
      writeCachedLibrary(makeLib()); // should not throw
    } finally {
      globalThis.localStorage.setItem = origSetItem;
    }
  });

  // ── 9. readCachedLibrary doesn't throw on access error ───────────────
  check('9. readCachedLibrary swallows access error', () => {
    const origGetItem = globalThis.localStorage.getItem;
    globalThis.localStorage.getItem = () => { throw new Error('private mode'); };
    try {
      assert.strictEqual(readCachedLibrary(), null);
    } finally {
      globalThis.localStorage.getItem = origGetItem;
    }
  });

  // ── 10. clearCachedLibrary doesn't throw on error ────────────────────
  check('10. clearCachedLibrary swallows error', () => {
    const origRemove = globalThis.localStorage.removeItem;
    globalThis.localStorage.removeItem = () => { throw new Error('denied'); };
    try {
      clearCachedLibrary(); // should not throw
    } finally {
      globalThis.localStorage.removeItem = origRemove;
    }
  });

  console.log(`\n🎉 likedCache.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
