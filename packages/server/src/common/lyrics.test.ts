/**
 * parseLrc 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/common/lyrics.test.ts
 *
 * 覆盖：
 *  - 标准 LRC 单时间戳行
 *  - 多时间戳行（合唱重复 [mm:ss.xx][mm:ss.xx]text）
 *  - 元数据标签跳过（[ti:Title] / [ar:Artist]）
 *  - 边界：秒数 ≥ 60 / 分钟 > 999 → 跳过
 *  - 空文本 / 空行 / 纯空白行
 *  - 排序验证
 *  - null 返回条件（无时间戳行）
 */
export {};
const assert = require('node:assert');
const { parseLrc } = require('./lyrics');

let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

// ── 1. 标准 LRC 单时间戳行 ────────────────────────────────────
check('1. 标准 LRC 单时间戳行', () => {
  const lrc = '[00:01.23]Hello\n[00:03.45]World\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 2);
  assert.strictEqual(lines![0].time, 1.23);
  assert.strictEqual(lines![0].text, 'Hello');
  assert.strictEqual(lines![1].time, 3.45);
  assert.strictEqual(lines![1].text, 'World');
});

// ── 2. 多时间戳行（合唱重复）──────────────────────────────────
check('2. 多时间戳行 → 每个时间戳一条 LyricLine', () => {
  const lrc = '[00:01.00][00:05.00]Chorus line\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 2);
  assert.strictEqual(lines![0].time, 1.0);
  assert.strictEqual(lines![0].text, 'Chorus line');
  assert.strictEqual(lines![1].time, 5.0);
  assert.strictEqual(lines![1].text, 'Chorus line');
});

// ── 3. 元数据标签跳过 ─────────────────────────────────────────
check('3. 元数据标签 [ti:Title] / [ar:Artist] 跳过', () => {
  const lrc = '[ti:Song Title]\n[ar:Artist Name]\n[00:01.00]First line\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].text, 'First line');
});

// ── 4. 秒数 ≥ 60 → 跳过 ───────────────────────────────────────
check('4. 秒数 ≥ 60 → 跳过该时间戳', () => {
  const lrc = '[00:61.00]Bad seconds\n[00:01.00]Good\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].text, 'Good');
});

// ── 5. 分钟 > 999 → 跳过 ──────────────────────────────────────
check('5. 分钟 > 999 → 跳过', () => {
  const lrc = '[1000:00.00]Bad minutes\n[00:01.00]Good\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].text, 'Good');
});

// ── 6. 空文本 → null ──────────────────────────────────────────
check('6. 空文本 → null', () => {
  assert.strictEqual(parseLrc(''), null);
});

// ── 7. 纯元数据无时间戳行 → null ──────────────────────────────
check('7. 纯元数据无时间戳行 → null', () => {
  assert.strictEqual(parseLrc('[ti:Title]\n[ar:Artist]\n'), null);
});

// ── 8. 空行 / 纯空白行不产生 LyricLine ────────────────────────
check('8. 空行 / 纯空白行不产生 LyricLine', () => {
  const lrc = '\n\n[00:01.00]Hello\n   \n[00:02.00]World\n\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 2);
});

// ── 9. 空文本行（时间戳后无内容）跳过 ─────────────────────────
check('9. 时间戳后无文本 → 跳过', () => {
  const lrc = '[00:01.00]\n[00:02.00]Real text\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].text, 'Real text');
});

// ── 10. 排序验证（乱序输入）──────────────────────────────────
check('10. 乱序输入 → 按 time 升序排列', () => {
  const lrc = '[00:05.00]Fifth\n[00:01.00]First\n[00:03.00]Third\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines![0].time, 1.0);
  assert.strictEqual(lines![1].time, 3.0);
  assert.strictEqual(lines![2].time, 5.0);
});

// ── 11. 毫秒精度（3 位小数）──────────────────────────────────
check('11. 毫秒精度（3 位小数）', () => {
  const lrc = '[00:01.234]Hello\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines![0].time, 1.234);
});

// ── 12. 无小数秒也支持 ────────────────────────────────────────
check('12. 无小数秒也支持', () => {
  const lrc = '[00:30]Hello\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines![0].time, 30);
});

// ── 13. 分钟 > 99 但 ≤ 999 → 接受 ─────────────────────────────
check('13. 分钟 = 100 → 接受（≤ 999）', () => {
  const lrc = '[100:00.00]Long song\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].time, 6000);
});

// ── 14. CRLF 换行兼容 ─────────────────────────────────────────
check('14. CRLF 换行兼容', () => {
  const lrc = '[00:01.00]Line1\r\n[00:02.00]Line2\r\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 2);
  assert.strictEqual(lines![0].text, 'Line1');
  assert.strictEqual(lines![1].text, 'Line2');
});

// ── 15. 同时间戳多行保持输入顺序（稳定排序）──────────────────
check('15. 同时间戳多行保持输入顺序', () => {
  const lrc = '[00:01.00]First\n[00:01.00]Second\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 2);
  assert.strictEqual(lines![0].text, 'First');
  assert.strictEqual(lines![1].text, 'Second');
});

// ── 16. 负数分钟/秒 → 跳过 ────────────────────────────────────
check('16. 负数秒 → 跳过', () => {
  // 正则 \d 不匹配负号，所以 [-00:01.00] 不会匹配为时间戳
  const lrc = '[-00:01.00]Bad\n[00:01.00]Good\n';
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1);
  assert.strictEqual(lines![0].text, 'Good');
});

// ── 17. 多时间戳 + 空文本 → 全跳过 ───────────────────────────
check('17. 多时间戳 + 空文本 → 全跳过 → null', () => {
  const lrc = '[00:01.00][00:02.00]\n';
  const lines = parseLrc(lrc);
  assert.strictEqual(lines, null);
});

// ── 18. 大量行性能烟测（1000 行）──────────────────────────────
check('18. 1000 行解析不崩溃', () => {
  let lrc = '';
  for (let i = 0; i < 1000; i++) {
    lrc += `[${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.00]Line ${i}\n`;
  }
  const lines = parseLrc(lrc);
  assert.ok(lines);
  assert.strictEqual(lines!.length, 1000);
});

console.log(`\n🎉 lyrics.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
