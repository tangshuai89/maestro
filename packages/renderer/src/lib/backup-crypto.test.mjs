// backup-crypto.test.mjs — tests for encryptBundle / decryptBundle / generatePassphrase
//
// Uses Node's built-in Web Crypto (globalThis.crypto.subtle, available in
// Node 20+ with a warning, stable in Node 22+).  No DOM mocking needed —
// btoa/atob/TextEncoder/TextDecoder are all Node globals.
//
// Run: node src/lib/backup-crypto.test.mjs

import * as assert from 'node:assert';
import { webcrypto } from 'node:crypto';

// Polyfill for Node 20 (Node 22+ already has globalThis.crypto)
if (!globalThis.crypto) globalThis.crypto = webcrypto;

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
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${err.message}`);
    failed++;
  }
}

async function main() {
  const { encryptBundle, decryptBundle, generatePassphrase } = await import('./backup-crypto.ts');

  const sampleBundle = {
    manifest: { version: 1, exportedAt: '2026-09-07T00:00:00Z', appVersion: '1.0.0' },
    stateJson: { sessions: { s1: { qq: { cookies: { uin: '123456' } } } } },
    localStorage: { 'maestro:provider': 'qq' },
  };

  // ── 1. Round-trip: encrypt → decrypt → original ──────────────────────
  await checkAsync('1. encrypt → decrypt round-trip preserves data', async () => {
    const blob = await encryptBundle(sampleBundle, 'my-passphrase');
    const decrypted = await decryptBundle(blob, 'my-passphrase');
    assert.deepStrictEqual(decrypted, sampleBundle);
  });

  // ── 2. Wrong passphrase → throws ─────────────────────────────────────
  await checkAsync('2. wrong passphrase → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'correct-pass');
    await assert.rejects(
      () => decryptBundle(blob, 'wrong-pass'),
      /解密失败/,
    );
  });

  // ── 3. Empty passphrase → throws ─────────────────────────────────────
  await checkAsync('3a. encrypt with empty passphrase → throws', async () => {
    await assert.rejects(
      () => encryptBundle(sampleBundle, ''),
      /口令不能为空/,
    );
  });
  await checkAsync('3b. decrypt with empty passphrase → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'pass');
    await assert.rejects(
      () => decryptBundle(blob, ''),
      /口令不能为空/,
    );
  });

  // ── 4. Tampered ciphertext → throws ──────────────────────────────────
  await checkAsync('4. tampered ciphertext → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'pass');
    // Flip a byte in the ciphertext portion. The packed data layout is:
    // magic(4) + salt(16) + iv(12) + cipher. The cipher starts at offset 32.
    const parts = blob.split('.');
    const packed = atob(parts[2]);
    const off = 4 + 16 + 12; // magic + salt + iv
    const tampered = packed.slice(0, off) + String.fromCharCode(packed.charCodeAt(off) ^ 0xff) + packed.slice(off + 1);
    const tamperedBlob = `${parts[0]}.${parts[1]}.${btoa(tampered)}`;
    await assert.rejects(
      () => decryptBundle(tamperedBlob, 'pass'),
      /解密失败/,
    );
  });

  // ── 5. Tampered manifest (AAD) → throws ──────────────────────────────
  await checkAsync('5. tampered manifest (AAD) → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'pass');
    const parts = blob.split('.');
    // Corrupt the manifest segment
    const manifest = JSON.parse(atob(parts[1]));
    manifest.appVersion = '99.0.0';
    const tamperedBlob = `${parts[0]}.${btoa(JSON.stringify(manifest))}.${parts[2]}`;
    await assert.rejects(
      () => decryptBundle(tamperedBlob, 'pass'),
      /解密失败/,
    );
  });

  // ── 6. Invalid format → throws ───────────────────────────────────────
  await checkAsync('6. invalid format (not MBX1) → throws', async () => {
    await assert.rejects(
      () => decryptBundle('XXXX.manifest.cipher', 'pass'),
      /不是有效的 Maestro 备份文件/,
    );
  });
  await checkAsync('7. invalid format (wrong segment count) → throws', async () => {
    await assert.rejects(
      () => decryptBundle('MBX1.onlyone', 'pass'),
      /不是有效的 Maestro 备份文件/,
    );
  });

  // ── 8. Version mismatch → throws ─────────────────────────────────────
  await checkAsync('8. version mismatch → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'pass');
    const parts = blob.split('.');
    const manifest = JSON.parse(atob(parts[1]));
    manifest.version = 99;
    const v99Blob = `${parts[0]}.${btoa(JSON.stringify(manifest))}.${parts[2]}`;
    await assert.rejects(
      () => decryptBundle(v99Blob, 'pass'),
      /不兼容的备份版本/,
    );
  });

  // ── 9. Corrupt manifest JSON → throws ────────────────────────────────
  await checkAsync('9. corrupt manifest JSON → throws', async () => {
    const blob = await encryptBundle(sampleBundle, 'pass');
    const parts = blob.split('.');
    const corruptBlob = `${parts[0]}.${btoa('not-json')}.${parts[2]}`;
    await assert.rejects(
      () => decryptBundle(corruptBlob, 'pass'),
      /备份文件头损坏/,
    );
  });

  // ── 10. Different bundles with same passphrase are distinct ──────────
  await checkAsync('10. two bundles with same passphrase are distinct', async () => {
    const blob1 = await encryptBundle(sampleBundle, 'pass');
    const otherBundle = { ...sampleBundle, stateJson: { different: true } };
    const blob2 = await encryptBundle(otherBundle, 'pass');
    assert.notStrictEqual(blob1, blob2);
    const d1 = await decryptBundle(blob1, 'pass');
    const d2 = await decryptBundle(blob2, 'pass');
    assert.deepStrictEqual(d1, sampleBundle);
    assert.deepStrictEqual(d2, otherBundle);
  });

  // ── 11. generatePassphrase: 4 words joined by '-' ────────────────────
  check('11. generatePassphrase returns 4 hyphen-separated words', () => {
    const pp = generatePassphrase();
    const words = pp.split('-');
    assert.strictEqual(words.length, 4, `expected 4 words, got ${words.length}: ${pp}`);
    for (const w of words) {
      assert.ok(w.length > 0, `empty word in passphrase: ${pp}`);
    }
  });

  // ── 12. generatePassphrase: reasonably random (10 samples differ) ────
  check('12. generatePassphrase produces varied output (10 samples)', () => {
    const samples = new Set();
    for (let i = 0; i < 10; i++) samples.add(generatePassphrase());
    assert.ok(samples.size > 5, `only ${samples.size} unique out of 10 — RNG might be broken`);
  });

  // ── 13. Large bundle round-trip ──────────────────────────────────────
  await checkAsync('13. large bundle (1000 items) round-trip', async () => {
    const items = [];
    for (let i = 0; i < 1000; i++) {
      items.push({ id: `item-${i}`, title: `Song ${i}`, artist: `Artist ${i}` });
    }
    const largeBundle = {
      manifest: { version: 1, exportedAt: '2026-09-07T00:00:00Z', appVersion: '1.0.0' },
      stateJson: { library: { items } },
      localStorage: {},
    };
    const blob = await encryptBundle(largeBundle, 'big-pass');
    const decrypted = await decryptBundle(blob, 'big-pass');
    assert.strictEqual(decrypted.stateJson.library.items.length, 1000);
    assert.strictEqual(decrypted.stateJson.library.items[999].title, 'Song 999');
  });

  console.log(`\n🎉 backup-crypto.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
