// lyrics.test.mjs — activeLineIndex / activeLineWindow
//
// 桌面歌词浮窗与 TheaterView 歌词面板共用这两个判定，错行会直接被用户看见，
// 所以边界（行首、行尾、容差、末行）都要钉死。
// Run: node src/lib/lyrics.test.mjs

import * as assert from 'node:assert';

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

const LINES = [
  { time: 0, text: '第一句' },
  { time: 10, text: '第二句' },
  { time: 20, text: '第三句' },
  { time: 30, text: '第四句' },
];

/** 压平成可 JSON 比对的形状 */
const flat = (w) => ({
  index: w.index,
  current: w.current?.text ?? null,
  next: w.next?.text ?? null,
  progress: w.progress,
});

async function main() {
  const { activeLineIndex, activeLineWindow } = await import('./lyrics.ts');

  // ── activeLineIndex ───────────────────────────────────────────────────
  check('1. null → -1', activeLineIndex(null, 5), -1);
  check('2. [] → -1', activeLineIndex([], 5), -1);
  check('3. 第一句之前 → -1', activeLineIndex(LINES, -1), -1);
  check('4. 正好在第一句', activeLineIndex(LINES, 0), 0);
  check('5. 行中', activeLineIndex(LINES, 15), 1);
  check('6. 末行', activeLineIndex(LINES, 999), 3);
  check('7. 50ms 容差内算已唱到下一行', activeLineIndex(LINES, 10.04), 1);
  check('8. 容差外仍是上一行', activeLineIndex(LINES, 9.9), 0);

  // ── activeLineWindow ──────────────────────────────────────────────────
  check('9. 还没开口：current=null，next=第一句', flat(activeLineWindow(LINES, -1)), { index: -1, current: null, next: '第一句', progress: 0 });
  check('10. 行中：进度过半', flat(activeLineWindow(LINES, 15)), { index: 1, current: '第二句', next: '第三句', progress: 0.5 });
  check('11. 行首：进度 0', flat(activeLineWindow(LINES, 10)), { index: 1, current: '第二句', next: '第三句', progress: 0 });
  check('12. 末行：无 next、进度 0', flat(activeLineWindow(LINES, 35)), { index: 3, current: '第四句', next: null, progress: 0 });
  check('13. 超前的时间不会让进度溢出', flat(activeLineWindow(LINES, 999)), { index: 3, current: '第四句', next: null, progress: 0 });
  check('14. 浮窗播放头：index=-1 时也带首句做预告', activeLineWindow(LINES, -3).next?.text, '第一句');
  check('15. 空歌词 → 全空', flat(activeLineWindow(null, 3)), { index: -1, current: null, next: null, progress: 0 });

  // 单行歌词（没有 span）→ 进度恒 0，不该出 NaN
  const one = activeLineWindow([{ time: 5, text: '只有一句' }], 8);
  check('16. 单行歌词进度 0（无 NaN）', one.progress, 0);
  check('17. 单行歌词 next=null', one.next, null);

  console.log(`\n${failed === 0 ? '✅' : '❌'} lyrics.test.mjs: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
