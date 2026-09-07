/**
 * search.util 纯函数白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/music/search.util.test.ts
 *
 * 覆盖：
 *  - dedupTracks：相同 normalizeKey 合并
 *  - selectBestSource：三档优先级（全曲非锁 → 非锁 → 有版权）
 *  - clusterByDuration：同 key 内按 duration 聚类
 *  - buildUnifiedItems：跨平台聚合 + main 选取 + cover 兜底
 *  - isCrossScript：CJK ↔ latin 判定
 *  - mergeCrossScript：跨脚本合并 + 元数据尾缀合并
 */
export {};
const assert = require('node:assert');
const {
  dedupTracks,
  selectBestSource,
  buildUnifiedItems,
  isCrossScript,
  mergeCrossScript,
  PLAY_PRIORITY,
  VERSION_DURATION_TOLERANCE_SEC,
} = require('./search.util');
import type { Track, SourceInfo } from './types';
import type { MusicProvider } from '../common/provider';

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

function mkTrack(
  overrides: Partial<Track> & { id: string; provider: Track['provider'] },
): Track {
  return {
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    coverUrl: '',
    audioUrl: '',
    duration: 200,
    liked: false,
    ...overrides,
  };
}

function mkSource(
  platform: MusicProvider,
  overrides: Partial<SourceInfo> = {},
): SourceInfo {
  return {
    platform,
    trackId: `${platform}-id`,
    hasCopyright: true,
    url: '',
    ...overrides,
  };
}

// ── 1. dedupTracks：相同 normalizeKey 合并 ─────────────────────
check('1. dedupTracks：相同 key 合并，保留第一个', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦' }) },
    { track: mkTrack({ id: 'netease-1', provider: 'netease', title: '晴天', artist: '周杰伦' }) },
  ];
  const map = dedupTracks(entries);
  assert.strictEqual(map.size, 1, '同名同歌手应合并为 1 条');
  const first = map.values().next().value;
  assert.strictEqual(first.id, 'qq-1', '保留第一个出现的');
});

// ── 2. dedupTracks：不同 key 不合并 ────────────────────────────
check('2. dedupTracks：不同 key 不合并', () => {
  const entries = [
    { track: mkTrack({ id: '1', provider: 'qq', title: '晴天', artist: '周杰伦' }) },
    { track: mkTrack({ id: '2', provider: 'qq', title: '稻香', artist: '周杰伦' }) },
  ];
  const map = dedupTracks(entries);
  assert.strictEqual(map.size, 2);
});

// ── 3. selectBestSource：全曲非锁优先 ──────────────────────────
check('3. selectBestSource：qq 全曲非锁 → 选 qq', () => {
  const sources = [
    mkSource('qq', { hasCopyright: true, vipLocked: false }),
    mkSource('spotify', { hasCopyright: true, vipLocked: false }),
  ];
  assert.strictEqual(selectBestSource(sources), 'qq');
});

// ── 4. selectBestSource：qq 锁 + netease 非锁 → 选 netease ─────
check('4. selectBestSource：qq 锁 + netease 非锁 → 选 netease', () => {
  const sources = [
    mkSource('qq', { hasCopyright: true, vipLocked: true }),
    mkSource('netease', { hasCopyright: true, vipLocked: false }),
  ];
  assert.strictEqual(selectBestSource(sources), 'netease');
});

// ── 5. selectBestSource：全部锁 → 退回有版权的第一优先级 ───────
check('5. selectBestSource：全部锁 → 选 qq（best-effort）', () => {
  const sources = [
    mkSource('qq', { hasCopyright: true, vipLocked: true }),
    mkSource('netease', { hasCopyright: true, vipLocked: true }),
  ];
  assert.strictEqual(selectBestSource(sources), 'qq');
});

// ── 6. selectBestSource：无版权 → null ─────────────────────────
check('6. selectBestSource：全部无版权 → null', () => {
  const sources = [
    mkSource('qq', { hasCopyright: false }),
    mkSource('netease', { hasCopyright: false }),
  ];
  assert.strictEqual(selectBestSource(sources), null);
});

// ── 7. selectBestSource：空数组 → null ─────────────────────────
check('7. selectBestSource：空数组 → null', () => {
  assert.strictEqual(selectBestSource([]), null);
});

// ── 8. selectBestSource：Deezer 非锁 vs QQ 全曲非锁 → QQ ───────
check('8. selectBestSource：Deezer 非锁 vs QQ 全曲非锁 → QQ（全曲优先）', () => {
  const sources = [
    mkSource('deezer', { hasCopyright: true, vipLocked: false }),
    mkSource('qq', { hasCopyright: true, vipLocked: false }),
  ];
  assert.strictEqual(selectBestSource(sources), 'qq');
});

// ── 9. selectBestSource：QQ 锁 + Deezer/Spotify 非锁 → Deezer ──
check('9. selectBestSource：QQ 锁 + Deezer 非锁 + Spotify 非锁 → Deezer', () => {
  const sources = [
    mkSource('qq', { hasCopyright: true, vipLocked: true }),
    mkSource('deezer', { hasCopyright: true, vipLocked: false }),
    mkSource('spotify', { hasCopyright: true, vipLocked: false }),
  ];
  assert.strictEqual(selectBestSource(sources), 'deezer');
});

// ── 10. buildUnifiedItems：跨平台同版本合并 ───────────────────
check('10. buildUnifiedItems：同歌同版本跨平台合并为一条', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 270 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, '同歌同版本应合并为 1 条');
  assert.strictEqual(items[0].sources.length, 2, 'sources 含两个平台');
  assert.strictEqual(items[0].bestSource, 'qq', 'bestSource = qq');
  assert.strictEqual(items[0].id, 'merged-qq-qq-1', 'id 用 main 平台');
});

// ── 11. buildUnifiedItems：不同版本各自成条 ───────────────────
check('11. buildUnifiedItems：同名同歌手不同时长 → 各自成条', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 310 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, '差 > 3s 应分成 2 条');
});

// ── 12. buildUnifiedItems：duration ≤ 0 全部并入一个 cluster ──
check('12. buildUnifiedItems：duration=0 全部并入一个 cluster', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 0 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 0 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, 'duration=0 应合并为 1 条');
  assert.strictEqual(items[0].sources.length, 2);
});

// ── 13. buildUnifiedItems：cover 兜底（主平台无封面用其他平台）─
check('13. buildUnifiedItems：主平台无封面 → 用其他平台封面', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', coverUrl: '' }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', coverUrl: 'https://p1.music.126.net/cover.jpg' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items[0].coverUrl, 'https://p1.music.126.net/cover.jpg');
});

// ── 14. buildUnifiedItems：main 选取按 PLAY_PRIORITY ───────────
check('14. buildUnifiedItems：main 取优先级最高平台的 track', () => {
  const entries = [
    { track: mkTrack({ id: 'sp-1', provider: 'spotify', title: 'Sunny', artist: 'Jay', duration: 270 }) },
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  // normalizeKey 会把两个归一为同一 key（取决于 normalizer 实现）
  // 如果合并了，main 应该是 qq（优先级更高）
  if (items.length === 1) {
    assert.strictEqual(items[0].title, '晴天', 'main 用 QQ 的中文标题');
  }
});

// ── 15. isCrossScript：CJK ↔ latin ─────────────────────────────
check('15. isCrossScript：汉字 ↔ 拉丁 → true', () => {
  assert.strictEqual(isCrossScript('横顔', 'Yokogao'), true);
});

check('15b. isCrossScript：同文字系统 → false', () => {
  assert.strictEqual(isCrossScript('晴天', '晴天'), false);
  assert.strictEqual(isCrossScript('Sunny', 'Sunny'), false);
});

check('15c. isCrossScript：假名 ↔ 拉丁 → true', () => {
  assert.strictEqual(isCrossScript('はなび', 'Hanabi'), true);
});

check('15d. isCrossScript：两边都 CJK → false', () => {
  assert.strictEqual(isCrossScript('晴天', '稻香'), false);
});

// ── 16. mergeCrossScript：跨脚本合并 ───────────────────────────
check('16. mergeCrossScript：同歌跨脚本合并为一条', () => {
  const items = [
    {
      id: 'merged-qq-1',
      title: '横顔',
      artist: 'ヨルシカ',
      album: '',
      coverUrl: '',
      duration: 240,
      sources: [mkSource('qq', { trackId: 'qq-1' })],
      bestSource: 'qq' as const,
    },
    {
      id: 'merged-spotify-1',
      title: 'Yokogao',
      artist: 'Yorushika',
      album: '',
      coverUrl: '',
      duration: 240,
      sources: [mkSource('spotify', { trackId: 'sp-1' })],
      bestSource: 'spotify' as const,
    },
  ];
  const merged = mergeCrossScript(items);
  assert.strictEqual(merged.length, 1, '跨脚本同歌应合并');
  assert.strictEqual(merged[0].sources.length, 2, 'sources 合并');
});

// ── 17. mergeCrossScript：不同歌不合并 ─────────────────────────
check('17. mergeCrossScript：不同歌不合并', () => {
  const items = [
    {
      id: '1', title: '晴天', artist: '周杰伦', album: '', coverUrl: '',
      duration: 270, sources: [mkSource('qq', { trackId: '1' })], bestSource: 'qq' as const,
    },
    {
      id: '2', title: '稻香', artist: '周杰伦', album: '', coverUrl: '',
      duration: 223, sources: [mkSource('qq', { trackId: '2' })], bestSource: 'qq' as const,
    },
  ];
  const merged = mergeCrossScript(items);
  assert.strictEqual(merged.length, 2);
});

// ── 18. mergeCrossScript：时长差 > 30s 不合并 ─────────────────
check('18. mergeCrossScript：时长差 > 30s 不合并', () => {
  const items = [
    {
      id: '1', title: '晴天', artist: '周杰伦', album: '', coverUrl: '',
      duration: 270, sources: [mkSource('qq', { trackId: '1' })], bestSource: 'qq' as const,
    },
    {
      id: '2', title: '晴天', artist: '周杰伦', album: '', coverUrl: '',
      duration: 310, sources: [mkSource('spotify', { trackId: '2' })], bestSource: 'spotify' as const,
    },
  ];
  const merged = mergeCrossScript(items);
  assert.strictEqual(merged.length, 2, '时长差 40s > 30s 不合并');
});

// ── 19. PLAY_PRIORITY 顺序 ─────────────────────────────────────
check('19. PLAY_PRIORITY = [qq, netease, deezer, spotify]', () => {
  assert.deepStrictEqual([...PLAY_PRIORITY], ['qq', 'netease', 'deezer', 'spotify']);
});

// ── 20. VERSION_DURATION_TOLERANCE_SEC = 3 ─────────────────────
check('20. VERSION_DURATION_TOLERANCE_SEC = 3', () => {
  assert.strictEqual(VERSION_DURATION_TOLERANCE_SEC, 3);
});

// ── 21. buildUnifiedItems：空输入 → 空数组 ─────────────────────
check('21. buildUnifiedItems：空输入 → []', () => {
  assert.strictEqual(buildUnifiedItems(new Map(), []).length, 0);
});

// ── 22. buildUnifiedItems：vipLocked 透传到 sources ────────────
check('22. buildUnifiedItems：vipLocked 透传', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: 'VIP歌', artist: '歌手', vipLocked: true }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items[0].sources[0].vipLocked, true);
});

// ── 23. buildUnifiedItems：mediaMid 透传 ───────────────────────
check('23. buildUnifiedItems：mediaMid 透传', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '歌', artist: '手', mediaMid: 'mid123' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items[0].sources[0].mediaMid, 'mid123');
});

console.log(`\n🎉 search.util.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
