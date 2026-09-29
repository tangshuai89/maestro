/**
 * parseLrc + mergeLyricSources 白盒测试（Node built-in assert）。
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
 *
 * 多源合并（第 19–31 项）：
 *  - 比对键归一（全角 / 标点 / 繁简 / 纯标点）
 *  - 并集增量 + 时间容差去重 / 副歌重复保留
 *  - 整体偏移对齐 vs 错位源整源丢弃
 *  - 纯文本兜底路径 / mixed 源 / 行数上限 / 排序稳定性 / 空输入
 */
export {};
const assert = require('node:assert');
const {
  parseLrc,
  lyricLineKey,
  mergeLyricSources,
  LYRIC_MAX_MERGED_LINES,
} = require('./lyrics');

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

// ── 19. 比对键归一 ────────────────────────────────────────────
check('19. lyricLineKey：全角/标点/繁简归一，纯标点→空串', () => {
  assert.strictEqual(lyricLineKey('Hello, World!'), 'helloworld');
  assert.strictEqual(lyricLineKey('Ｈｅｌｌｏ'), 'hello');
  assert.strictEqual(lyricLineKey(' 晴天  '), '晴天');
  // 繁简桥：同一句一边繁体一边简体必须同键
  assert.strictEqual(lyricLineKey('後來'), lyricLineKey('后来'));
  // 纯标点 / 空 → 空串（调用方丢弃）
  assert.strictEqual(lyricLineKey('——'), '');
  assert.strictEqual(lyricLineKey('   '), '');
  assert.strictEqual(lyricLineKey(''), '');
});

// ── 20. 并集：低优先级源补进行 ────────────────────────────────
check('20. 合并并集：低优先级源补进缺失的行', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      lines: [
        { time: 1, text: 'A' },
        { time: 5, text: 'B' },
      ],
    },
    {
      source: 'netease',
      priority: 1,
      lines: [
        { time: 1, text: 'A' },
        { time: 5, text: 'B' },
        { time: 9, text: 'C' },
      ],
    },
  ])!;
  assert.deepStrictEqual(merged.sources, ['qq', 'netease']);
  assert.strictEqual(merged.synced, true);
  assert.strictEqual(merged.lines.length, 3);
  assert.strictEqual(merged.added, 1);
  assert.strictEqual(merged.dropped, 2);
  assert.deepStrictEqual(
    merged.lines.map((l) => l.time),
    [1, 5, 9],
  );
});

// ── 21. 时间容差内去重 + 副歌重复保留 ─────────────────────────
check('21. 容差 400ms 内视为同一句；副歌同词不同时间保留两条', () => {
  const merged = mergeLyricSources([
    { source: 'qq', priority: 0, lines: [{ time: 10, text: ' Chorus ' }] },
    // 200ms 抖动 → 同一句，去重
    { source: 'netease', priority: 1, lines: [{ time: 10.2, text: 'Chorus' }] },
    // 6s 后再唱一遍副歌 → 不同时间点，保留
    { source: 'netease', priority: 1, lines: [{ time: 16, text: 'Chorus' }] },
  ])!;
  assert.strictEqual(merged.lines.length, 2, '副歌第二次重复要保留');
  assert.strictEqual(merged.dropped, 1);
  assert.deepStrictEqual(merged.lines.map((l) => l.text), ['Chorus', 'Chorus']);
  // 整体对齐 -0.2s（锚点众数），第二次重复随之平移
  assert.strictEqual(merged.lines[1].time, 16, '单锚点不判系统性偏移');
  assert.deepStrictEqual(merged.rejected, []);
});

// ── 22. 整体偏移的对齐（不是丢弃）────────────────────────────
check('22. 低优先级源整体晚 1s → 对齐后并入（不丢源）', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      lines: [
        { time: 1, text: 'A' },
        { time: 5, text: 'B' },
        { time: 9, text: 'C' },
      ],
    },
    {
      source: 'netease',
      priority: 1,
      lines: [
        { time: 2, text: 'A' },
        { time: 6, text: 'B' },
        { time: 10, text: 'C' },
      ],
    },
  ])!;
  assert.deepStrictEqual(merged.rejected, []);
  assert.strictEqual(merged.dropped, 3, '三行都对齐成重复');
  assert.deepStrictEqual(merged.lines.map((l) => l.time), [1, 5, 9]);
});

// ── 22b. 残差超出容差 → 保留成新行（不猜）────────────────────
check('22b. 对齐后仍残差 0.5s 的行保留为新行（超出 400ms 容差）', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      lines: [
        { time: 1, text: 'A' },
        { time: 5, text: 'B' },
        { time: 9, text: 'C' },
      ],
    },
    {
      source: 'netease',
      priority: 1,
      lines: [
        { time: 2, text: 'A' },
        { time: 6, text: 'B' },
        // 锚点众数是 -1s，这行只对齐到 9.5，残差 0.5s > 容差 0.4s
        { time: 10.5, text: 'C' },
      ],
    },
  ])!;
  assert.strictEqual(merged.dropped, 2, 'A/B 被判定重复');
  assert.strictEqual(merged.added, 1, 'C 残差超容差，保留为新行');
  assert.strictEqual(merged.lines.length, 4);
});

// ── 23. 错位源整源丢弃 ───────────────────────────────────────
check('23. 偏移 6s 的源 → rejected，不污染主源时间轴', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      lines: [
        { time: 1, text: 'A' },
        { time: 5, text: 'B' },
      ],
    },
    {
      source: 'netease',
      priority: 1,
      lines: [
        { time: 7, text: 'A' },
        { time: 11, text: 'B' },
      ],
    },
  ])!;
  assert.deepStrictEqual(merged.rejected, ['netease']);
  assert.deepStrictEqual(merged.sources, ['qq']);
  assert.strictEqual(merged.lines.length, 2);
});

// ── 24. 无共同词的两个源 → 都并入（偏移 0）────────────────────
check('24. 两个毫无共同词的源（不同版本歌词）→ 都保留', () => {
  const merged = mergeLyricSources([
    { source: 'qq', priority: 0, lines: [{ time: 1, text: 'A' }] },
    { source: 'netease', priority: 1, lines: [{ time: 1, text: 'Z' }] },
  ])!;
  assert.deepStrictEqual(merged.rejected, []);
  assert.strictEqual(merged.lines.length, 2);
  assert.strictEqual(merged.added, 1);
});

// ── 25. 纯标点行不占时间轴 ───────────────────────────────────
check('25. 纯标点行（——）被丢弃', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      lines: [
        { time: 1, text: 'A' },
        { time: 2, text: '——' },
      ],
    },
  ])!;
  assert.strictEqual(merged.lines.length, 1);
});

// ── 26. 全纯文本源 → synced=false，按 key 去重拼接 ────────────
check('26. 无 synced 源（lyrics.ovh 纯文本）→ synced=false', () => {
  const merged = mergeLyricSources([
    { source: 'lyricsovh', priority: 0, lines: [{ time: 0, text: 'line one' }, { time: 0, text: 'line two' }] },
    { source: 'deezer', priority: 1, lines: [{ time: 0, text: 'Line One!' }, { time: 0, text: 'line three' }] },
  ])!;
  assert.strictEqual(merged.synced, false);
  assert.strictEqual(merged.lines.length, 3, 'Line 1! 与 line one 同键被去重');
  assert.strictEqual(merged.added, 1);
  assert.ok(merged.lines.every((l) => l.time === 0));
});

// ── 27. synced + 纯文本混合 → 纯文本不参与合并 ───────────────
check('27. 有 synced 源时纯文本源被忽略', () => {
  const merged = mergeLyricSources([
    { source: 'qq', priority: 0, lines: [{ time: 1, text: 'A' }] },
    { source: 'lyricsovh', priority: 1, lines: [{ time: 0, text: 'plain text' }] },
  ])!;
  assert.strictEqual(merged.synced, true);
  assert.deepStrictEqual(merged.sources, ['qq']);
  assert.strictEqual(merged.lines.length, 1);
});

// ── 28. 行数上限截断 ─────────────────────────────────────────
check('28. 超量源被 LYRIC_MAX_MERGED_LINES 截断', () => {
  const big = Array.from({ length: LYRIC_MAX_MERGED_LINES + 200 }, (_, i) => ({
    time: i + 1,
    text: `line${i}`,
  }));
  const merged = mergeLyricSources([
    { source: 'qq', priority: 0, lines: big },
    { source: 'netease', priority: 1, lines: [{ time: 99999, text: 'extra' }] },
  ])!;
  assert.ok(
    merged.lines.length <= LYRIC_MAX_MERGED_LINES,
    `截断后 ${merged.lines.length} 行应 ≤ 上限`,
  );
});

// ── 29. 排序：时间升序，同时间按来源优先级 ────────────────────
check('29. 同时间戳的两行：主源排在前面', () => {
  const merged = mergeLyricSources([
    { source: 'netease', priority: 1, lines: [{ time: 3, text: 'B' }] },
    { source: 'qq', priority: 0, lines: [{ time: 3, text: 'A' }] },
  ])!;
  assert.deepStrictEqual(merged.lines, [
    { time: 3, text: 'A' },
    { time: 3, text: 'B' },
  ]);
});

// ── 30. 空输入 / 空行 → null ─────────────────────────────────
check('30. 空输入、空行、空文本 → null', () => {
  assert.strictEqual(mergeLyricSources([]), null);
  assert.strictEqual(mergeLyricSources([{ source: 'qq', priority: 0, lines: [] }]), null);
  assert.strictEqual(
    mergeLyricSources([{ source: 'qq', priority: 0, lines: [{ time: 1, text: '  ' }] }]),
    null,
  );
});

// ── 31. 脏数据防御 ───────────────────────────────────────────
check('31. 非字符串 text / NaN time 不炸', () => {
  const merged = mergeLyricSources([
    {
      source: 'qq',
      priority: 0,
      // 白盒：故意塞脏数据（line 数组在这里是 any 上下文）
      lines: [{ time: 1, text: 'A' }, { time: NaN, text: null }, { time: 2, text: 'C' }],
    },
  ])!;
  assert.strictEqual(merged.lines.length, 2);
  assert.strictEqual(merged.synced, true);
});

console.log(`\n🎉 lyrics.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
