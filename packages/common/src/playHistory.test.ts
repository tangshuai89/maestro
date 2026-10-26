/**
 * 播放历史的纯函数（specs/play-history/）。
 *
 * server 存/读和 renderer 的去重判定共用这一份 —— 所以它的语义
 * （「最近播放」而不是「播放流水」）必须被锁死。
 *
 * 变异验证：把 `mergePlayHistory` 里的去重去掉 → 本文件必须红。
 *
 * 运行: npx ts-node packages/common/src/playHistory.test.ts
 */
export {}; // 模块作用域：避免顶层 const 与其它测试文件的全局声明冲突
const assert = require('node:assert');
const {
  mergePlayHistory,
  normalisePlayHistoryEntry,
  playHistoryKey,
  PLAY_HISTORY_LIMIT,
} = require('./playHistory');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, expect = true) {
  if (cond === expect) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label} → ${cond}（预期 ${expect}）`);
    failed++;
  }
}
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok);
  if (!ok) console.log(`   实际 ${JSON.stringify(actual)} ≠ 预期 ${JSON.stringify(expected)}`);
}

function entry(id: string, playedAt = 1000): any {
  const [platform, trackId] = id.split(':');
  return {
    id,
    platform,
    trackId,
    title: `T-${trackId}`,
    artist: 'A',
    duration: 100,
    playedAt,
  };
}

// ── 1. 身份键 ─────────────────────────────────────────────
console.log('\n── 身份键 ──');
eq('platform:trackId', playHistoryKey('qq', '0019n4uH2jsLcq'), 'qq:0019n4uH2jsLcq');

// ── 2. 并入（去重 + 移到最前 + 截断）──────────────────────
console.log('\n── 并入 ──');
eq(
  '新条目进最前',
  mergePlayHistory([entry('qq:a'), entry('qq:b')], entry('qq:c')).map((e: any) => e.id),
  ['qq:c', 'qq:a', 'qq:b'],
);
const dup = mergePlayHistory([entry('qq:a'), entry('qq:b')], entry('qq:b', 2000));
eq(
  '同一条再记 → 移到最前',
  dup.map((e: any) => e.id),
  ['qq:b', 'qq:a'],
);
eq('同一条再记 → 不追加第二条', dup.length, 2);
eq(
  '跨平台的同一首歌是两条（key 带平台前缀）',
  mergePlayHistory([entry('qq:a')], entry('netease:a')).length,
  2,
);
const many = Array.from({ length: PLAY_HISTORY_LIMIT + 10 }, (_, i) => entry(`qq:k${i}`));
const capped = mergePlayHistory(many, entry('qq:new'));
eq('超过上限 → 长度截到上限', capped.length, PLAY_HISTORY_LIMIT);
eq('超过上限 → 新的在最前', capped[0].id, 'qq:new');
// 最旧的是 k209（数组尾部）—— 被截掉的是**尾部**，不是头部
eq(
  '超过上限 → 最旧的被丢',
  capped.some((e: any) => e.id === 'qq:k209'),
  false,
);
eq(
  '超过上限 → 较新的还在',
  capped.some((e: any) => e.id === 'qq:k0'),
  true,
);
eq('limit=0 → 空数组', mergePlayHistory([entry('qq:a')], entry('qq:b'), 0).length, 0);

// ── 3. 规整 ───────────────────────────────────────────────
console.log('\n── 规整 ──');
const norm = normalisePlayHistoryEntry({
  platform: 'qq',
  trackId: 'mid1',
  title: '  晴天 ',
  artist: ' 周杰伦 ',
  duration: -5,
});
eq('补 id', norm?.id, 'qq:mid1');
eq('歌名去空白', norm?.title, '晴天');
eq('歌手去空白', norm?.artist, '周杰伦');
eq('负时长归零', norm?.duration, 0);
eq(
  '缺 platform → null',
  normalisePlayHistoryEntry({ platform: '', trackId: 'x', title: 't', artist: 'a' }),
  null,
);
eq(
  '缺 trackId → null',
  normalisePlayHistoryEntry({ platform: 'qq', trackId: '', title: 't', artist: 'a' }),
  null,
);
eq(
  '空标题 → null',
  normalisePlayHistoryEntry({ platform: 'qq', trackId: 'x', title: '  ', artist: 'a' }),
  null,
);
eq(
  '空歌手 → null',
  normalisePlayHistoryEntry({ platform: 'qq', trackId: 'x', title: 't', artist: '  ' }),
  null,
);
eq('没有 album 就不带这个键', norm && 'album' in norm, false);
eq('没有 coverUrl 就不带这个键', norm && 'coverUrl' in norm, false);

console.log(`\n🎉 playHistory.test 通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) process.exit(1);
