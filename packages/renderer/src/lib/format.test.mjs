// format.test.mjs — tests for formatTime / formatDuration / clampText
//
// Pure functions, no imports, no DOM — just import the .ts directly.
// Run: node src/lib/format.test.mjs

import * as assert from 'node:assert';

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function main() {
  const { formatTime, formatDuration, clampText } = await import('./format.ts');

  // ── formatTime ───────────────────────────────────────────────────────
  check('1. formatTime(0) → 0:00', formatTime(0), '0:00');
  check('2. formatTime(65) → 1:05', formatTime(65), '1:05');
  check('3. formatTime(125) → 2:05', formatTime(125), '2:05');
  check('4. formatTime(3661) → 61:01', formatTime(3661), '61:01');
  check('5. formatTime(-5) → 0:00 (negative)', formatTime(-5), '0:00');
  check('6. formatTime(NaN) → 0:00', formatTime(NaN), '0:00');
  check('7. formatTime(Infinity) → 0:00', formatTime(Infinity), '0:00');
  check('8. formatTime(-Infinity) → 0:00', formatTime(-Infinity), '0:00');
  check('9. formatTime(59.7) → 0:59 (floors seconds)', formatTime(59.7), '0:59');
  check('10. formatTime(60.9) → 1:00 (floors seconds)', formatTime(60.9), '1:00');

  // ── formatDuration ───────────────────────────────────────────────────
  check('11. formatDuration(0) → "" (empty for zero)', formatDuration(0), '');
  check('12. formatDuration(-5) → "" (empty for negative)', formatDuration(-5), '');
  check('13. formatDuration(65) → 1:05', formatDuration(65), '1:05');
  check('14. formatDuration(125) → 2:05', formatDuration(125), '2:05');
  check('15. formatDuration(NaN) → ""', formatDuration(NaN), '');
  check('16. formatDuration(Infinity) → ""', formatDuration(Infinity), '');
  check('17. formatDuration(0.5) → 0:00 (>0, floors to 0)', formatDuration(0.5), '0:00');
  check('18. formatDuration(1) → 0:01', formatDuration(1), '0:01');

  // ── clampText ────────────────────────────────────────────────────────
  check('19. clampText("hello", 10) → "hello" (under limit)', clampText('hello', 10), 'hello');
  check('20. clampText("hello", 5) → "hello" (at limit)', clampText('hello', 5), 'hello');
  check('21. clampText("hello world", 8) → "hello w… (truncated)', clampText('hello world', 8), 'hello w…');
  check('22. clampText("", 10) → "" (empty)', clampText('', 10), '');
  check('23. clampText("hi", 3) → "hi" (under limit)', clampText('hi', 3), 'hi');
  check('24. clampText("abcdef", 4) → "abc… (truncated)', clampText('abcdef', 4), 'abc…');
  check('25. clampText("abcdef", 6) → "abcdef" (at limit)', clampText('abcdef', 6), 'abcdef');

  console.log(`\n🎉 format.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
