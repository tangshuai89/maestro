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
  classifyVersion,
  versionTypeBadge,
  isCrossScript,
  mergeCrossScript,
  PLAY_PRIORITY,
  VERSION_DURATION_TOLERANCE_SEC,
  sortByRelevance,
} = require('./search.util');
import type { Track, SourceInfo, UnifiedSearchItem } from './types';
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
    assert.strictEqual(items[0].id, 'merged-qq-qq-1-studio', 'Phase 2 id = merged-<provider>-<id>-<versionType>');
});

// ── Bug #5 (stability-bug5-search-dup-platform) ───────────────────
check('11a. 同 platform 多 mid（同 duration）→ 合并为 1 个 source', () => {
  // QQ 高品质 M800 + QQ 标准 C400（同一录音，不同 mid + 不同 audioUrl）。
  // Bug #5 修复前 → sources 出现 2 个 qq source（"两个 QQ"）。
  // 修复后 → 只保留第一个（dedupTracks "第一次出现" 原则）。
  const entries = [
    { track: mkTrack({ id: 'qq-hi', provider: 'qq', title: '落俗', artist: '李荣浩', duration: 267 }) },
    { track: mkTrack({ id: 'qq-std', provider: 'qq', title: '落俗', artist: '李荣浩', duration: 267 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '落俗', artist: '李荣浩', duration: 267 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, '同版本应合并为 1 条');
  const qqCount = items[0].sources.filter((s) => s.platform === 'qq').length;
  assert.strictEqual(qqCount, 1, 'QQ source 应只剩 1 个（去重后）');
  assert.strictEqual(items[0].sources.length, 2, 'total = 1 qq + 1 netease');
});
check('11b. 不同 platform 各 1 个 → 不去重（保持原行为）', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 270 }) },
    { track: mkTrack({ id: 'de-1', provider: 'deezer', title: '晴天', artist: '周杰伦', duration: 270 }) },
    { track: mkTrack({ id: 'sp-1', provider: 'spotify', title: '晴天', artist: '周杰伦', duration: 270 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, '同版本应合并为 1 条');
  assert.strictEqual(items[0].sources.length, 4, '4 平台各 1 个 source，不去重');
});
check('11c. cluster 内多 platform + 同 platform 多 mid 混合', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: 'X', artist: 'A', duration: 200 }) },
    { track: mkTrack({ id: 'qq-2', provider: 'qq', title: 'X', artist: 'A', duration: 200 }) },
    { track: mkTrack({ id: 'qq-3', provider: 'qq', title: 'X', artist: 'A', duration: 200 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: 'X', artist: 'A', duration: 200 }) },
    { track: mkTrack({ id: 'sp-1', provider: 'spotify', title: 'X', artist: 'A', duration: 200 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].sources.length, 3, 'qq×3 → 1 个 qq + netease + spotify = 3 sources');
});

// ── 11. buildUnifiedItems Phase 2：同名同 type 不同 duration → 1 item + 2 versions ──
check('11. buildUnifiedItems：同名同 type 不同 duration → 1 item + 2 versions', () => {
  // Phase 2：同 (key, type) 不管 duration 差多少都合并成 1 item，duration 差
  // 体现在 versions 数组里（每个 cluster = 1 version）。toggle 展开时给用户选。
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270, album: 'X' }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 310, album: 'Y' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, 'Phase 2：同 (key, type) → 1 item（不论 duration）');
  assert.strictEqual(items[0].versions.length, 2, 'duration 差 > 3s → 2 versions');
  assert.strictEqual(items[0].versionType, 'studio');
  // Phase 3：主版本不再取"最短"。两个 cluster 各 1 个源（并列）→ 取**更长**的那条
  //（片段/剪辑版总是更短，不能让折叠行显示片段）。
  assert.strictEqual(items[0].duration, 310, '主版本 = 源数最多 → 时长最长');
  assert.strictEqual(items[0].versions[0].duration, 310, 'versions[0] 必定是主版本');
  assert.strictEqual(items[0].versions[1].duration, 270);
  // 每个 version 带自己的原始元数据（UI 展开时逐行显示真实歌名/专辑，而不是 v2/v3）。
  // cluster 代表 track 按 PLAY_PRIORITY 选：qq > netease。
  assert.strictEqual(items[0].versions[0].title, '晴天');
  assert.strictEqual(items[0].versions[0].artist, '周杰伦');
  assert.strictEqual(items[0].versions[0].album, 'Y');
  assert.strictEqual(items[0].versions[1].album, 'X', '版本级 album 取该 cluster 代表 track，不能串到别的 cluster');
});

// ── 11b. versions 的元数据必须区分同名不同版本（用户看不到区别就没法选）──
check('11b. buildUnifiedItems：同录音（时长偏差 ≤50%）合并，各自保留专辑/时长', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 240, album: '首发单曲' }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '盲选', artist: '黄霄雲', duration: 287, album: '精选集' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, '同名同 type → 1 item');
  const versions = items[0].versions;
  assert.strictEqual(versions.length, 2, 'duration 差 > 3s → 2 versions');
  assert.deepStrictEqual(
    versions.map((v) => [v.title, v.artist, v.album, v.duration]),
    [
      ['盲选', '黄霄雲', '精选集', 287],
      ['盲选', '黄霄雲', '首发单曲', 240],
    ],
    '主版本在前；每个版本带自己 cluster 的元数据（album 不能互串）',
  );
  assert.strictEqual(items[0].album, '精选集', 'item 级元数据 = versions[0]（主版本）');
});

// ── 11c. Phase 3：跨平台共识优先于时长（短片段若多平台都在，也算主版本）──
check('11c. buildUnifiedItems：主版本按跨平台源数选，不够长的单平台条目让位', () => {
  const entries = [
    // 80s 那条三平台都有 → 跨平台共识
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 80 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '盲选', artist: '黄霄雲', duration: 80 }) },
    { track: mkTrack({ id: 'sp-1', provider: 'spotify', title: '盲选', artist: '黄霄雲', duration: 80 }) },
    // 287s 只有 QQ 一条（时长虽长，但只有单平台）
    { track: mkTrack({ id: 'qq-2', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 287 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, '80s 与 287s 时长差 >50% → 拆成 2 条');
  const main = items.find((it) => it.sources.length === 3);
  assert.ok(main, '跨平台共识那条应作为主 item');
  assert.strictEqual(main!.duration, 80, '主版本 = 源数最多（即使更短）');
  assert.strictEqual(main!.versions.length, 1);
  const outlier = items.find((it) => it.sources.length === 1);
  assert.ok(outlier, '单平台的 287s 应单独成条');
  assert.strictEqual(outlier!.duration, 287);
  assert.notStrictEqual(outlier!.id, main!.id, 'item id 必须唯一（renderer 用 id 做 key/展开态）');
});

// ── 11d. Phase 3：偏离主版本时长 >50% 的孤立 cluster 不再混进 versions ──
check('11d. buildUnifiedItems：片段/剪辑版（时长 -50% 以上）拆成独立 item', () => {
  const entries = [
    // 4:47 三平台共识 = 正式版本
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 287 }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '盲选', artist: '黄霄雲', duration: 287 }) },
    // 1:20 只在 QQ，且比主版本短 72% → 不是"版本"
    { track: mkTrack({ id: 'qq-2', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 80 }) },
    // 2:50 偏 -41%，仍在阈值内 → 保留为版本
    { track: mkTrack({ id: 'qq-3', provider: 'qq', title: '盲选', artist: '黄霄雲', duration: 170 }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, '1:20 拆走 → 主 item + 1 条独立 item');
  const main = items.find((it) => it.sources.length === 2)!;
  assert.strictEqual(main.duration, 287, '主版本 = 跨平台共识的 4:47');
  assert.deepStrictEqual(
    main.versions.map((v) => v.duration),
    [287, 170],
    '主版本在前，阈值内的 2:50 仍是版本',
  );
  const clip = items.find((it) => it.sources.length === 1)!;
  assert.strictEqual(clip.duration, 80, '1:20 片段单独成条');
  assert.strictEqual(clip.versions.length, 1);
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

// ── classifyVersion：版本类型识别（Phase 1 of dedup redesign）──
check('24. classifyVersion: 晴天 → studio', () => {
  assert.strictEqual(classifyVersion('晴天', '叶惠美'), 'studio');
});
check('24b. classifyVersion: 晴天 (Live) → live', () => {
  assert.strictEqual(classifyVersion('晴天 (Live)', '叶惠美'), 'live');
});
check('24c. classifyVersion: 现场版 / 演唱会 / 实况 → live', () => {
  assert.strictEqual(classifyVersion('盲选 (现场版)', '...'), 'live');
  assert.strictEqual(classifyVersion('X', '演唱会实况'), 'live');
  assert.strictEqual(classifyVersion('Y', 'Concert Live'), 'live');
});
check('24d. classifyVersion: 优先级 live > acoustic', () => {
  assert.strictEqual(classifyVersion('X (Live Acoustic)', 'Y'), 'live');
});
check('24e. classifyVersion: acoustic > remix', () => {
  assert.strictEqual(classifyVersion('X (Acoustic)', 'Y Remix'), 'acoustic');
});
check('24f. classifyVersion: remix / instrumental', () => {
  assert.strictEqual(classifyVersion('X (Remix)', 'Y'), 'remix');
  assert.strictEqual(classifyVersion('X', '伴奏'), 'instrumental');
});

// ── versionTypeBadge ─────────────────────────────────────────
check('25. versionTypeBadge: studio → null', () => {
  assert.strictEqual(versionTypeBadge('studio'), null);
});
check('25b. versionTypeBadge: live → [LIVE]', () => {
  assert.strictEqual(versionTypeBadge('live'), '[LIVE]');
});
check('25c. versionTypeBadge: 其余 → 对应文字', () => {
  assert.strictEqual(versionTypeBadge('acoustic'), '[ACOUSTIC]');
  assert.strictEqual(versionTypeBadge('remix'), '[REMIX]');
  assert.strictEqual(versionTypeBadge('instrumental'), '[INSTRUMENTAL]');
});

// ── Phase 1 buildUnifiedItems: 按 (normalizeKey, versionType) 二元组合并 ───
check('26. 同歌 studio + live → 2 条（之前会因 cluster 差 > 3s 也 2 条；现在按 type 拆分）', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-s', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 269, album: '叶惠美' }) },
    { track: mkTrack({ id: 'qq-l', provider: 'qq', title: '晴天 (Live)', artist: '周杰伦', duration: 280, album: '叶惠美 Live' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, 'studio + live → 2 条');
  const types = items.map((it) => it.versionType).sort();
  assert.deepStrictEqual(types, ['live', 'studio']);
});
check('27. 同歌同 type (studio) 多平台 → 1 条 studio', () => {
  // 同 artist 跨平台 → 1 条 studio（normalizeKey 一致）。
  const entries = [
    { track: mkTrack({ id: 'qq-s', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 269, album: '叶惠美' }) },
    { track: mkTrack({ id: 'ne-s', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 269, album: '叶惠美' }) },
    { track: mkTrack({ id: 'sp-s', provider: 'spotify', title: '晴天', artist: '周杰伦', duration: 269, album: '叶惠美' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 1, '同 studio + 同 duration → 1 条');
  assert.strictEqual(items[0].versionType, 'studio');
  assert.strictEqual(items[0].sources.length, 3, '3 平台各 1 source');
});
check('28. 不同 type 同 key → 各自成条，sources 不混合', () => {
  // 同 artist 跨平台 + 同 title（仅 album 含 Live 关键字触发 versionType）→
  // studio + live 各 1 条，sources 不混合。
  // 注：title 里的 "(Live)" 因 normalizeKey 不调 stripParensContent 会让 key
  // 不同（"盲选" vs "盲选live"），那是 spec 既定设计——下面用 album 触发 type。
  const entries = [
    { track: mkTrack({ id: 'qq-s', provider: 'qq', title: '盲选', artist: '黄霄云', duration: 240, album: 'X' }) },
    { track: mkTrack({ id: 'ne-s', provider: 'netease', title: '盲选', artist: '黄霄云', duration: 240, album: 'X' }) },
    { track: mkTrack({ id: 'qq-l', provider: 'qq', title: '盲选', artist: '黄霄云', duration: 250, album: 'X (Live)' }) },
    { track: mkTrack({ id: 'sp-l', provider: 'spotify', title: '盲选', artist: '黄霄云', duration: 250, album: 'X Live' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, 'studio + live → 2 条');
  const studio = items.find((it) => it.versionType === 'studio');
  const live = items.find((it) => it.versionType === 'live');
  assert.ok(studio && live);
  assert.strictEqual(studio.sources.length, 2, 'studio: qq + netease');
  assert.strictEqual(live.sources.length, 2, 'live: qq + spotify');
});
check('29. classifyVersion 与 buildUnifiedItems 集成（不破坏测试 10/11）', () => {
  // 测试 10 同歌同版本跨平台合并 → versionType='studio'（默认）
  const t10 = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '晴天', artist: '周杰伦', duration: 270, album: '叶惠美' }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '晴天', artist: '周杰伦', duration: 270, album: '叶惠美' }) },
  ];
  const i10 = buildUnifiedItems(new Map(), t10);
  assert.strictEqual(i10[0].versionType, 'studio');
});

// 跨脚本同名：spec 设计上 mergeCrossScript 不用于 search（仅 library import），
// 所以 search 阶段同 (key, type) + 不同 normalizeKey 仍拆开。这是有意为之——
// 把跨脚本合并留给 library import 路径（避免 search 误合并 coverUrl/album
// 不同的同名项）。
check('28b. 跨脚本同歌同 type → 各自成条（spec 设计：跨脚本合并留给 library）', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '盲选', artist: '黄霄云', duration: 240, album: 'X' }) },
    { track: mkTrack({ id: 'sp-1', provider: 'spotify', title: '盲选', artist: 'Huang Xiaoyun', duration: 240, album: 'X' }) },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(items.length, 2, '不同 artist → 不同 normalizeKey → 各自成条（spec 设计）');
});

// 中文关键字 "\b" 边界修复：原 pattern 用 \b 包围，中文字符两侧不形成 \b 边界，
// 所以 "现场"/"演唱会"/"伴奏" 等中文关键字永远不匹配。修复：中文关键字去 \b。
check('28c. classifyVersion 中文关键字：现场/演唱会/实况/不插电/原声/混音/伴奏', () => {
  assert.strictEqual(classifyVersion('X', '现场版'), 'live');
  assert.strictEqual(classifyVersion('X', '演唱会实况'), 'live');
  assert.strictEqual(classifyVersion('X (Live)', 'Y'), 'live');
  assert.strictEqual(classifyVersion('X', '不插电'), 'acoustic');
  assert.strictEqual(classifyVersion('X', '原声版'), 'acoustic');
  assert.strictEqual(classifyVersion('X', '混音版'), 'remix');
  assert.strictEqual(classifyVersion('X', '伴奏'), 'instrumental');
});

// ── selectBestSource 接收 priority（§6.2 渠道优先级） ──────────
check('P1. selectBestSource 默认 = PLAY_PRIORITY（无参时不破坏旧行为）', () => {
  const sources: SourceInfo[] = [
    { platform: 'qq', trackId: '1', hasCopyright: true, url: '' },
    { platform: 'netease', trackId: '2', hasCopyright: true, url: '' },
  ];
  assert.strictEqual(selectBestSource(sources), 'qq');
});

check('P2. selectBestSource 接受 priority：每档内按用户序迭代', () => {
  // 两个全曲源：priority 决定 tier-1 内谁胜出
  const full: SourceInfo[] = [
    { platform: 'qq', trackId: '1', hasCopyright: true, url: '' },
    { platform: 'netease', trackId: '2', hasCopyright: true, url: '' },
  ];
  assert.strictEqual(
    selectBestSource(full, ['netease', 'qq', 'deezer', 'spotify']),
    'netease',
  );
  // 两个非全曲源：tier-2 内同样按 priority
  const preview: SourceInfo[] = [
    { platform: 'spotify', trackId: '3', hasCopyright: true, url: '' },
    { platform: 'deezer', trackId: '4', hasCopyright: true, url: '' },
  ];
  assert.strictEqual(
    selectBestSource(preview, ['spotify', 'deezer', 'qq', 'netease']),
    'spotify',
  );
  // 非全曲源不能靠 priority 跨档压过全曲源（ladder 不变，见 P4）
  assert.strictEqual(
    selectBestSource(
      [full[0], preview[0]],
      ['spotify', 'qq', 'netease', 'deezer'],
    ),
    'qq',
  );
});

check('P3. selectBestSource priority = 缺某平台 → 该平台永远不返回', () => {
  const sources: SourceInfo[] = [
    { platform: 'qq', trackId: '1', hasCopyright: false, url: '' },  // 无版权
    { platform: 'deezer', trackId: '2', hasCopyright: true, url: '' }, // 唯一有版权
  ];
  // user 从 priority 里删了 deezer → 即使 deezer 是唯一有版权源也不选
  assert.strictEqual(
    selectBestSource(sources, ['qq', 'netease', 'spotify']),
    null,
  );
});

check('P4. selectBestSource VIP ladder 不变：priority 仅影响每档内迭代', () => {
  const sources: SourceInfo[] = [
    { platform: 'qq', trackId: '1', hasCopyright: true, url: '', vipLocked: true },
    { platform: 'netease', trackId: '2', hasCopyright: true, url: '', vipLocked: false },
    { platform: 'deezer', trackId: '3', hasCopyright: true, url: '', vipLocked: false },
  ];
  // qq VIP 锁 → 跳过；剩下 netease / deezer 都是非锁，priority=[deezer,...]
  // → 但 netease 在 FULL_SONG_PROVIDERS（qq/netease），deezer 不在 → 仍选 netease
  assert.strictEqual(
    selectBestSource(sources, ['deezer', 'netease', 'qq', 'spotify']),
    'netease',
  );
});

check('P5. buildUnifiedItems 透传 priority：bestSource 按用户序选', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: 'G', artist: 'A' }) },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: 'G', artist: 'A' }) },
  ];
  const items = buildUnifiedItems(
    new Map(),
    entries,
    ['netease', 'qq', 'deezer', 'spotify'],
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].bestSource, 'netease');
});

check('P6. mergeCrossScript 透传 priority：合并后 bestSource 按用户序重选', () => {
  const items: UnifiedSearchItem[] = [
    {
      id: 'qq-1', title: '横顔', artist: 'Yama', album: '', coverUrl: '',
      duration: 200, sources: [mkSource('qq', { trackId: '1' })], bestSource: 'qq' as const,
      versionType: 'studio' as const, versions: [],
    },
    {
      id: 'ne-1', title: 'Yokogao', artist: 'Yama', album: '', coverUrl: '',
      duration: 200, sources: [mkSource('netease', { trackId: '2' })], bestSource: 'netease' as const,
      versionType: 'studio' as const, versions: [],
    },
  ];
  const merged = mergeCrossScript(items, ['netease', 'qq', 'deezer', 'spotify']);
  assert.strictEqual(merged.length, 1);
  // sources 含 qq + netease（都是全曲源），tier-1 内按 user priority 选 netease
  assert.strictEqual(merged[0].bestSource, 'netease');
});

// ── R. sortByRelevance：分页前按查询相关性重排 ─────────────────
// 回归：buildUnifiedItems 输出序 = 平台段首次出现序（qq 段在前），平台独占曲目
// 会被挤出第一页——网易云独有「浓缩蓝鲸 · 裘德」排在 25 条 QQ 弱相关结果之后。
check('R1. sortByRelevance：netease 独占精确命中从末尾提到第一页', () => {
  const entries: { track: Track; platform: MusicProvider }[] = [];
  for (let i = 0; i < 25; i++) {
    entries.push({
      track: mkTrack({
        id: `qq-${i}`, provider: 'qq',
        title: `相关歌曲${i}`, artist: `歌手${i}`,
      }),
      platform: 'qq' as const,
    });
  }
  entries.push({
    track: mkTrack({
      id: 'ne-1', provider: 'netease', title: '浓缩蓝鲸', artist: '裘德',
    }),
    platform: 'netease' as const,
  });
  const items = buildUnifiedItems(new Map(), entries);
  const before = items.findIndex((it) => it.artist === '裘德');
  assert.strictEqual(before, 25, '重排前在 index 25（页外）');
  const sorted = sortByRelevance(items, '浓缩蓝鲸');
  const after = sorted.findIndex((it) => it.artist === '裘德');
  assert.ok(after === 0, `重排后应在第 0 位（实际 ${after}）`);
});

check('R2. sortByRelevance：多 token「裘德 浓缩蓝鲸」标题+歌手双命中压过同歌名', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '浓缩蓝鲸', artist: '别人' }), platform: 'qq' as const },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '浓缩蓝鲸', artist: '裘德' }), platform: 'netease' as const },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  const sorted = sortByRelevance(items, '裘德 浓缩蓝鲸');
  assert.strictEqual(sorted[0].artist, '裘德', '标题+歌手双 token 命中应排第一');
});

check('R3. sortByRelevance：全不匹配时保持插入序（不回归）', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '甲', artist: 'A' }), platform: 'qq' as const },
    { track: mkTrack({ id: 'ne-1', provider: 'netease', title: '乙', artist: 'B' }), platform: 'netease' as const },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  const sorted = sortByRelevance(items, '完全不相关');
  assert.deepStrictEqual(sorted.map((it) => it.title), ['甲', '乙']);
});

check('R4. sortByRelevance：空 query / 全空白 → 原序返回', () => {
  const entries = [
    { track: mkTrack({ id: 'qq-1', provider: 'qq', title: '甲', artist: 'A' }), platform: 'qq' as const },
  ];
  const items = buildUnifiedItems(new Map(), entries);
  assert.strictEqual(sortByRelevance(items, '   '), items);
});

check('R5. sortByRelevance：同分同名按平台内 rank 交错（浓缩蓝鲸实测场景）', () => {
  // 25 条 QQ 同名翻唱 + 网易云 #1 裘德原版：query 分全等（+120），
  // rank tie-break 让 ne#0 裘德升到第 2 位（仅次于 qq#0），而不是沉在 25 名外。
  const entries: { track: Track; platform: MusicProvider }[] = [];
  for (let i = 0; i < 25; i++) {
    entries.push({
      track: mkTrack({ id: `qq-${i}`, provider: 'qq', title: '浓缩蓝鲸', artist: `翻唱${i}` }),
      platform: 'qq' as const,
    });
  }
  entries.push({
    track: mkTrack({ id: 'ne-1', provider: 'netease', title: '浓缩蓝鲸', artist: '裘德' }),
    platform: 'netease' as const,
  });
  const items = buildUnifiedItems(new Map(), entries);
  // 模拟 music.service 的 rankMap：每平台内下标即名次（qq-i→i，ne-1→0）
  const rankMap = new Map<string, number>();
  for (let i = 0; i < 25; i++) rankMap.set(`qq:qq-${i}`, i);
  rankMap.set('netease:ne-1', 0);
  const rankOf = (it: UnifiedSearchItem) =>
    Math.min(
      ...it.sources.map((s) => rankMap.get(`${s.platform}:${s.trackId}`) ?? Number.MAX_SAFE_INTEGER),
    );
  const sorted = sortByRelevance(items, '浓缩蓝鲸', rankOf);
  const qi = sorted.findIndex((it) => it.artist === '裘德');
  assert.ok(qi === 1, `裘德（ne rank0）应仅次于 qq rank0（实际第 ${qi} 位）`);
  assert.strictEqual(sorted[0].artist, '翻唱0', 'qq rank0 仍第一');
  assert.strictEqual(sorted[2].artist, '翻唱1', 'qq rank1 第三（被 ne rank0 超过）');
});

console.log(`🎉 search.util.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
