/**
 * parseLrc 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/common/lyrics.test.ts
 *
 * 覆盖 ISSUES.md §2.7 提到的两个实测 bug：
 *   1. 多 tag 同行（NetEase 合唱 repeat）必须拆为多行
 *   2. 时间越界（minutes > 999 / seconds ≥ 60）必须丢弃
 */
export {}; // 顶层 const 不与其他 .test.ts 冲突
const assert = require('node:assert/strict');
const { parseLrc } = require('./lyrics');

function eqLines(actual: any, expected: Array<{ time: number; text: string }>) {
  assert.equal(actual.length, expected.length, `length: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].time, expected[i].time, `line ${i} time`);
    assert.equal(actual[i].text, expected[i].text, `line ${i} text`);
  }
}

// ── 1. 单 tag 基线 ────────────────────────────────────────
{
  const r = parseLrc('[01:23.45]hello');
  eqLines(r, [{ time: 83.45, text: 'hello' }]);
}

// ── 2. 多 tag 同行（bug 1 修复）────────────────────────────
// ISSUES.md §2.7 bug 1：旧实现会把后续 tag 当作 text 一部分吞掉。
// 期望拆成两条 LyricLine，共享同一段尾随文本。
{
  const r = parseLrc('[02:30.500]A[02:35.500]B');
  eqLines(r, [
    { time: 150.5, text: 'B' },
    { time: 155.5, text: 'B' },
  ]);
}

// ── 3. 三 tag + 边界毫秒精度 ───────────────────────────────
{
  const r = parseLrc('[00:00.001]x[00:00.002]x[00:00.003]x');
  eqLines(r, [
    { time: 0.001, text: 'x' },
    { time: 0.002, text: 'x' },
    { time: 0.003, text: 'x' },
  ]);
}

// ── 4. 时间越界（bug 2 修复）──────────────────────────────
// ISSUES.md §2.7 bug 2：旧实现接受 [99:99.99] → 6039.99s，污染排序。
{
  const r = parseLrc('[99:99.99]bad');
  assert.equal(r, null, 'seconds ≥ 60 must drop the line');
}

{
  // minutes 1000 也应丢弃（99:59 仍合法 → 59.99s）
  const r = parseLrc('[1000:00.00]bad\n[00:59.99]good');
  eqLines(r, [{ time: 59.99, text: 'good' }]);
}

{
  // 负数也应丢弃
  const r = parseLrc('[-1:00.00]bad');
  assert.equal(r, null, 'negative minutes must drop');
}

// ── 5. 边界 OK ────────────────────────────────────────────
{
  const r = parseLrc('[00:00.00]start\n[999:59.99]end');
  eqLines(r, [
    { time: 0, text: 'start' },
    { time: 60 * 999 + 59.99, text: 'end' },
  ]);
}

// ── 6. 元数据行自动跳过 ───────────────────────────────────
{
  const r = parseLrc('[ti:Title]\n[ar:Artist]\n[al:Album]\n[00:01.00]lyric');
  eqLines(r, [{ time: 1, text: 'lyric' }]);
}

// ── 7. 仅元数据 → null ────────────────────────────────────
{
  const r = parseLrc('[ti:Title]\n[ar:Artist]');
  assert.equal(r, null);
}

// ── 8. 空 / 纯空白文本行跳过（NetEase 视觉气口）────────────
{
  const r = parseLrc('[00:01.00]   \n[00:02.00]real lyric');
  eqLines(r, [{ time: 2, text: 'real lyric' }]);
}

// ── 9. 排序按时间升序 ─────────────────────────────────────
{
  const r = parseLrc('[00:05.00]late\n[00:01.00]early\n[00:03.00]mid');
  eqLines(r, [
    { time: 1, text: 'early' },
    { time: 3, text: 'mid' },
    { time: 5, text: 'late' },
  ]);
}

// ── 10. 同一时间多行保留原始顺序（稳定排序）──────────────
{
  const r = parseLrc('[00:01.00]A\n[00:01.00]B');
  eqLines(r, [
    { time: 1, text: 'A' },
    { time: 1, text: 'B' },
  ]);
}

// ── 11. CRLF 行尾容忍 ────────────────────────────────────
{
  const r = parseLrc('[00:01.00]one\r\n[00:02.00]two');
  eqLines(r, [
    { time: 1, text: 'one' },
    { time: 2, text: 'two' },
  ]);
}

// ── 12. tag 后接多字符标点/中文/emoji 保留 ─────────────────
{
  const r = parseLrc('[00:01.00]你好，世界 🎵');
  eqLines(r, [{ time: 1, text: '你好，世界 🎵' }]);
}

// ── 13. 行中段出现普通方括号（不是 tag）→ 视作 text ────────
{
  const r = parseLrc('[00:01.00]see [1] in text');
  eqLines(r, [{ time: 1, text: 'see [1] in text' }]);
}

console.log('parseLrc tests: 13/13 ok');
