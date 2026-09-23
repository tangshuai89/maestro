/**
 * 统一搜索的纯函数：去重 + 聚合 + 选 bestSource。
 *
 * 抽到独立文件是为了能直接被白盒测试覆盖（无需 DI 启动 NestJS）。
 * MusicService 内部也复用同一份实现。
 *
 * 归一相关函数（normalizeKey / stripFeatTags / stripParensContent /
 * stripFuriganaParens / cjkUnify / displayKey）抽到 `@maestro/common`——
 * 单一真值源，server 端 catalog 匹配和 renderer 端 groupLibrary 展示级
 * 聚类都从同一条流水线走，确保两端的 key 永远对齐（弹窗徽章 = server
 * 实际合并的平台集合）。
 */
import type { Track } from './types';
import type {
  SourceInfo,
  UnifiedSearchItem,
  VersionEntry,
} from './types';
import type { MusicProvider } from '../common/provider';

// Re-export 给 server 模块用——music.service.ts 等不需要改 import 路径。
// 实际实现统一在 @maestro/common（单测在 common/src/normalizer.test.ts）。
// 同时 import 让本文件内部也能调用（re-export 不在 in-scope 里给本文件用）。
import {
  artistLooseMatch,
  cjkUnify,
  displayKey,
  normalizeKey,
  stripFeatTags,
  stripFuriganaParens,
  stripParensContent,
  stripTrailingMeta,
} from '@maestro/common';
// 音译佐证：跨脚本艺人（Spotify 罗马音 vs QQ/网易云 汉字/假名）的判等。
// mergeCrossScript（库导入合并）与 searchEquivalent（搜索匹配）共用同一套
// 音译逻辑，避免库导入对跨脚本艺人「合并不上」而搜索却「能匹配」的口径分裂。
import { artistTransliterationMatch } from './translit';
export {
  artistLooseMatch,
  cjkUnify,
  displayKey,
  normalizeKey,
  stripFeatTags,
  stripFuriganaParens,
  stripParensContent,
  stripTrailingMeta,
} from '@maestro/common';

export type RawSearchEntry = { track: Track; platform: MusicProvider };

/** 去重: 相同 normalizeKey 的歌合并为一条，保留第一个出现的。 */
export function dedupTracks(all: RawSearchEntry[]): Map<string, Track> {
  const map = new Map<string, Track>();
  for (const { track } of all) {
    const key = normalizeKey(track.title, track.artist);
    if (!map.has(key)) {
      map.set(key, track);
    }
  }
  return map;
}

/** 播放优先级: qq > netease > deezer > spotify。只有 hasCopyright 的才可选。
 *  Spotify 排最后——30s 预览是它的硬限制，能用但不优；QQ/网易云通常有完整曲流。
 *  ⚠️ 加新 provider 时务必在这里 append，否则 unified 永远拿不到它当 bestSource。 */
export const PLAY_PRIORITY: MusicProvider[] = [
  'qq',
  'netease',
  'deezer',
  'spotify',
];

/** 能出「全曲」的平台。Deezer 匿名 / Spotify 非 Premium 本身就是 30s 预览，
 *  不算全曲源——所以"优先非 VIP 锁"这一档只在它们之间挑，别让一个 Deezer 预览
 *  仅因为"没被标 VIP 锁"就顶掉一个 QQ 源。 */
const FULL_SONG_PROVIDERS: ReadonlySet<MusicProvider> = new Set<MusicProvider>([
  'qq',
  'netease',
]);

/**
 * 录音版本分类（Phase 1 of unified-search dedup redesign）：
 * 同一首歌在搜索结果里会出现多个版本（专辑原版 / Live / Acoustic / Remix / 纯伴奏），
 * 全列出来对用户太杂。`classifyVersion` 按 title + album 关键字判定属于哪一类，
 * buildUnifiedItems 再按 (normalizeKey, versionType) 二元组合并——专辑版合并成 1
 * 条、Live 合并成 1 条、互不混淆。
 *
 * 优先级：live > acoustic > remix > instrumental > studio。
 * 如果 title 和 album 同时带多个关键字（如"晴天 (Live Acoustic)"），高优先级胜出。
 */
export type VersionType =
  | 'studio'
  | 'live'
  | 'acoustic'
  | 'remix'
  | 'instrumental';

// 英文 keyword 用 \b 包围（避免 "live" 误匹配 "deliver"）；中文 keyword 不用
// \b（JS regex \b 基于 \w，中文字符两侧不是 \b 边界）。中文 keyword 直接 substring 匹配。
const VERSION_PATTERNS: ReadonlyArray<{
  type: VersionType;
  pattern: RegExp;
}> = [
  { type: 'live',          pattern: /(\b(live|live版|concert)\b|现场|演唱会|实况)/i },
  { type: 'acoustic',      pattern: /(\b(acoustic|unplugged)\b|不插电|原声)/i },
  { type: 'remix',         pattern: /(\b(remix|extended|remaster)\b|混音)/i },
  { type: 'instrumental',  pattern: /(\b(instrumental|karaoke)\b|纯音乐|伴奏|卡拉ok)/i },
];

/** Classify a search result entry into a version bucket. Title and album are
 *  concatenated (lowercased) before matching. Default `studio` for tracks
 *  without any keyword signal. Pure (no side effects), unit-testable. */
export function classifyVersion(title: string, album: string): VersionType {
  const text = `${title} ${album}`;
  for (const { type, pattern } of VERSION_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'studio';
}

/** UI 角标文字。`studio` 返回 null（不显示角标——专辑原版是默认形态）。 */
export function versionTypeBadge(type: VersionType): string | null {
  switch (type) {
    case 'live':         return '[LIVE]';
    case 'acoustic':     return '[ACOUSTIC]';
    case 'remix':        return '[REMIX]';
    case 'instrumental': return '[INSTRUMENTAL]';
    case 'studio':       return null;
  }
}

/**
 * 选 bestSource：三档优先——「能出全曲」 → 「非 VIP 锁」 → 「best-effort 试听」。
 *  1. **完整曲流平台里，有版权且非 VIP 锁**的（qq/网易云中能出全曲的）→ 按平台
 *     优先级选。这样"网易云免费全曲、QQ 绿钻独占"会直接选网易云，不再选中 QQ
 *     然后播成 30s 试听。
 *  2. 全部完整曲流平台都锁 → 在**所有平台**里找非锁的（避开试听）。这样
 *     "Lydia 网易云试听 + QQ 锁 + Spotify 30s 预览"会选 Spotify（或 Deezer 30s
 *     预览），而不是死磕网易云 30s 试听（试听更短 + 音质更差）。兑现
 *     `types.ts:17` 注释承诺："全部源都锁时才退回"。
 *  3. 全部都锁（罕见：所有平台都是 VIP 独占 / 区域限制）→ 退回「按平台优先级
 *     选第一个有版权的」（best-effort：QQ 试听仍优于 Deezer 预览，保持以前
 *     行为，不让任何平台都不可选导致黑屏）。
 *
 * `priority` 默认 = `PLAY_PRIORITY`。Settings 暴露的「渠道优先级」走这个形参透传
 * 给所有 caller（music.service.searchUnified / findPlayableEquivalent /
 * patchLibraryWithSources）。三档 ladder 不变，priority 只影响每档内迭代序 —
 * VIP 锁源仍优先跳过。如果用户从 priority 删了某平台（Settings UI），该平台
 * **永远不会被自动选**（包括第三档 best-effort 兜底）— 这是设计选择，避免
 * 用户隐藏的源被偷偷复活。
 */
export function selectBestSource(
  sources: SourceInfo[],
  priority: MusicProvider[] = PLAY_PRIORITY,
): MusicProvider | null {
  const byPriority = (pred: (s: SourceInfo) => boolean): MusicProvider | null =>
    priority.find((p) => sources.some((s) => s.platform === p && pred(s))) ?? null;
  return (
    byPriority(
      (s) => s.hasCopyright && !s.vipLocked && FULL_SONG_PROVIDERS.has(s.platform),
    ) ??
    byPriority((s) => s.hasCopyright && !s.vipLocked) ??
    byPriority((s) => s.hasCopyright)
  );
}

/** 同 normalizeKey 的两首视为"同一版本"的最大 duration 差（秒）。与
 *  match.service 的 DURATION_TOLERANCE_SEC 保持一致。 */
export const VERSION_DURATION_TOLERANCE_SEC = 3;

/** 跨版本容差：title-exact 或剥括号后 substring 类的强信号匹配，即使
 *  duration 差 30s 也应接受。修「ねえ、ちゃんと聞いてる？ りりあ。」（QQ 源
 *  dur=258 vs Spotify/Netease 源 dur=243）— 同歌不同版本（带 intro/outro
 *  的专辑版 vs 短版 single）。30s 足以覆盖常见的 intro/桥段/尾奏差异；
 *  30s 以上的差异基本可认为是不同歌（同歌 remix 一般 ≥30s）。
 *
 *  ⚠️ 2026-08-07 曾短暂提到 60s（Humbert Humbert「日が落ちるまで」QQ 296s
 *  vs Spotify 248s），后回退：查证 Spotify 248s 是 2021《FOLK 3》**重录版**
 *  （不同录音、不同 ISRC），不是同录音 master 差异——重录版就该是两首歌，
 *  不应放宽容差去捡。 */
export const DIFFERENT_VERSION_DURATION_TOLERANCE_SEC = 30;

/**
 * 在同一个 normalizeKey 组内，按 duration 就近聚类成「版本」。
 * 每个 cluster = 一个版本（一个 UnifiedSearchItem）。
 *
 * 规则：
 *  - duration ≤ 0（未知，如部分 Deezer 结果）不参与门槛 → 全部并入第一个
 *    cluster（或自成一 cluster）。这保证老测试（duration 全 0）仍合并为一条。
 *  - duration > 0：按升序贪心，cluster 宽度 ≤ TOLERANCE（anchor=cluster 最小值），
 *    差 > TOLERANCE 就开新 cluster。→ "晴天"的 album/live/remix 各自成条。
 */
function clusterByDuration(entries: RawSearchEntry[]): RawSearchEntry[][] {
  const withDur = entries
    .filter((e) => e.track.duration > 0)
    .sort((a, b) => a.track.duration - b.track.duration);
  const zeroDur = entries.filter((e) => !(e.track.duration > 0));

  const clusters: { anchor: number; items: RawSearchEntry[] }[] = [];
  for (const e of withDur) {
    const last = clusters[clusters.length - 1];
    if (
      last &&
      e.track.duration - last.anchor <= VERSION_DURATION_TOLERANCE_SEC
    ) {
      last.items.push(e);
    } else {
      clusters.push({ anchor: e.track.duration, items: [e] });
    }
  }
  if (zeroDur.length) {
    if (clusters.length) clusters[0].items.push(...zeroDur);
    else clusters.push({ anchor: 0, items: zeroDur });
  }
  return clusters.map((c) => c.items);
}

/**
 * 将所有平台的原始搜索结果聚合为 UnifiedSearchItem。
 *
 * Phase 3（2026-09-20）在此之上收敛了"版本"口径：
 *  - 折叠行显示的主版本 = **跨平台共识最多**的那个录音（并列取最长），不再是"最短"
 *    （最短经常是片段/剪辑版，用户点开就播到 1:20 的怪东西）；
 *  - 偏离主版本时长 >50% 的孤立 cluster 不再当"同一首歌的另一个版本"，单独成条。
 *
 * 先按 normalizeKey（歌名+歌手）分组，再在组内按 duration 聚类成「版本」——
 * 同名不同时长的版本（album / live / remix ...）各自成条，跨平台**同版本**
 * （时长接近）才合并。这样搜索里能看到多个版本，点 ❤ 时 sources 里就是
 * 同一个版本的跨平台源。
 *
 * `deduped` 参数保留是为了兼容旧签名/测试；分组逻辑不再依赖它。
 */
/** 一个 (normalizeKey, versionType) 分组的稳定标识。 */
interface RawGroup {
  key: string;
  versionType: VersionType;
}

/**
 * 主版本时长相对偏差上限：偏离主版本超过这个比例，就不再当作"同一录音的另一个
 * master"，单独成条。
 *
 * 依据（2026-09-20，用户实际搜"盲选"）：同名同艺人的 6 条结果里，只有 4:47 那条
 * 同时出现在 QQ/网易/Spotify（跨平台共识），其余 1:20 / 2:35 / 2:50 / 5:42 / 6:07
 * 都只在单平台。1:20 相对 4:47 偏 -72% —— 那是片段/剪辑，不是"版本"；而常见的
 * radio edit(3:30) vs 专辑版(5:00) 只偏 -30%，必须继续当同一条的两个版本。取中间值。
 */
const VERSION_DURATION_SPREAD_RATIO = 0.5;

/** cluster 里最高优先级平台的序号（越小越优先）；没有已知平台时排最后。 */
function platformRank(v: VersionEntry): number {
  const idx = PLAY_PRIORITY.findIndex((p) => v.sources.some((s) => s.platform === p));
  return idx === -1 ? PLAY_PRIORITY.length : idx;
}

/**
 * 折叠态那一行该显示/播放哪个录音版本（= `versions[0]`）。
 *
 * 顺序：① 跨平台源数最多 —— 多平台都有的那条就是曲库里的正式版本；
 *       ② 时长最长 —— 片段/剪辑版总是更短，绝不能让它当主版本（旧实现取"最短"，
 *          于是"盲选"的折叠行显示 1:20 的片段）；
 *       ③ 平台优先级兜底，保证确定性。
 */
function pickCanonicalVersion(versions: VersionEntry[]): VersionEntry {
  return [...versions].sort((a, b) => {
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    if (b.duration !== a.duration) return b.duration - a.duration;
    return platformRank(a) - platformRank(b);
  })[0];
}

/** 是否与主版本属于"同一录音"（时长偏差在阈值内）。时长未知时不拆，保持旧行为。 */
function isSameRecording(v: VersionEntry, canonical: VersionEntry): boolean {
  if (!(canonical.duration > 0) || !(v.duration > 0)) return true;
  return (
    Math.abs(v.duration - canonical.duration) / canonical.duration <=
    VERSION_DURATION_SPREAD_RATIO
  );
}

/** 一个 duration cluster → 1 个 VersionEntry（含 cluster 内同 platform 去重）。 */
function toVersionEntry(
  cluster: RawSearchEntry[],
  group: RawGroup,
  idx: number,
  priority: MusicProvider[] = PLAY_PRIORITY,
): VersionEntry {
  // Bug #5 (stability-bug5-search-dup-platform)：cluster 内同 platform 多 mid 去重。
  const seenPlatform = new Set<MusicProvider>();
  const dedupedCluster = cluster.filter((e) => {
    if (seenPlatform.has(e.track.provider)) return false;
    seenPlatform.add(e.track.provider);
    return true;
  });
  const sources: SourceInfo[] = dedupedCluster.map(({ track }) => ({
    platform: track.provider,
    trackId: track.id,
    hasCopyright: true,
    url: track.audioUrl,
    mediaMid: track.mediaMid,
    vipLocked: track.vipLocked,
    // 付费分类从 provider.search 透传。SourceChip 据此加 [P]/[NP] 标签。
    vipCategory: track.vipCategory,
  }));
  const main =
    priority.map((p) =>
      cluster.find((e) => e.track.provider === p),
    ).find(Boolean)?.track ?? cluster[0].track;
  return {
    id: `ver-${group.key}-${group.versionType}-${idx}`,
    duration: main.duration,
    sources,
    bestSource: selectBestSource(sources, priority),
    label: undefined,  // Phase 3 可加：从 main.album/title 提取"短版"/"长版"
    // 该版本的原始元数据（main = cluster 内 priority 代表 track）。
    // UI 展开后每行显示真实歌名/歌手/专辑，而不是 "v2 / 2:35"。
    title: main.title,
    artist: main.artist,
    album: main.album,
    // 封面：cluster 内跨 platform 取第一个非空。
    coverUrl: cluster.find((e) => e.track.coverUrl)?.track.coverUrl || '',
  };
}

/**
 * 一组同录音的 versions → 1 个 UnifiedSearchItem。
 * item 级字段全部取主版本，且 `versions[0]` 必定是主版本 —— renderer 的折叠行
 * 就是拿 `versions[0]` 播放的（`handleRowClick(i, 0)`），这个不变量不能破。
 */
function toUnifiedItem(
  group: RawGroup,
  versions: VersionEntry[],
  canonical: VersionEntry,
  priority: MusicProvider[] = PLAY_PRIORITY,
): UnifiedSearchItem {
  const ordered = [
    canonical,
    ...versions
      .filter((v) => v !== canonical)
      .sort((a, b) => a.duration - b.duration),
  ];
  const rep =
    priority.map((p) => canonical.sources.find((s) => s.platform === p)).find(Boolean) ??
    canonical.sources[0];
  return {
    id: `merged-${rep.platform}-${rep.trackId}-${group.versionType}`,
    title: canonical.title,
    artist: canonical.artist,
    album: canonical.album,
    coverUrl: canonical.coverUrl,
    duration: canonical.duration,
    sources: canonical.sources,
    bestSource: canonical.bestSource,
    versionType: group.versionType,
    versions: ordered,
  };
}

/**
 * 统一搜索结果按查询相关性重排（稳定排序）。
 *
 * 为什么需要：`buildUnifiedItems` 的输出序 = `all` 里各平台段首次出现的顺序
 * （MUSIC_PROVIDERS 序：qq 段整体在前）。平台内部 rank 跨平台不可比，且平台
 * 独占曲目会被挤出第一页——实测「浓缩蓝鲸」：QQ 返回 25 条弱相关结果占满前
 * 排，网易云独有的「浓缩蓝鲸 · 裘德」落到 index 25，pageSize=20 时第一页
 * 根本看不到。各平台的 rank 信号只在"同一首歌内的源选择"里有意义，对 item
 * 级的展示序必须用 query 相关性重排。
 *
 * 打分规则（标题匹配 > 歌手匹配 > 多 token 命中）：
 *  - 标题 key 全等 query key +120；前缀 +70；包含 +50
 *  - 歌手 key 全等 +60；包含 +30
 *  - 多 token 查询（"裘德 浓缩蓝鲸"）：每个 token 命中标题或歌手 +20
 *  - 0 分保持插入序（stable sort）——全不匹配时退回原平台段序，不回归
 *
 * `rankOf`（可选）：item 在其来源平台结果里的最佳排名（0 起）。同分时按
 * 它升序——同名翻唱/同题歌曲的 query 分完全一致，此时各平台自己的排序
 * 才是最可靠的相关性信号：「浓缩蓝鲸」QQ 返回 25 条同名翻唱全得 +120，
 * 没有 rank tie-break 时网易云第 1 位的裘德原版仍被整段 QQ 块压在页外；
 * 有了它，ne#0 与 qq#0 并列、优于 qq#1… → 平台各自的 top 结果交错排前。
 *
 * 只用于统一搜索（music.service.searchUnified 分页前）；库合并路径
 * （match.service → buildUnifiedItems）没有 query，不调它。
 */
export function sortByRelevance(
  items: UnifiedSearchItem[],
  query: string,
  rankOf?: (item: UnifiedSearchItem) => number,
): UnifiedSearchItem[] {
  const qKey = displayKey(query, '');
  if (!qKey) return items;
  const rank = rankOf ?? (() => 0);
  const tokens = query
    .split(/\s+/)
    .map((t) => displayKey(t, ''))
    .filter((t) => t && t !== qKey); // 单 token = 整串，已在全串比较里计分
  const score = (it: UnifiedSearchItem): number => {
    const titleK = displayKey(it.title, '');
    const artistK = displayKey(it.artist, '');
    let s = 0;
    if (titleK === qKey) s += 120;
    else if (titleK.startsWith(qKey)) s += 70;
    else if (titleK.includes(qKey)) s += 50;
    if (artistK === qKey) s += 60;
    else if (artistK.includes(qKey)) s += 30;
    for (const tk of tokens) {
      if (titleK.includes(tk) || artistK.includes(tk)) s += 20;
    }
    return s;
  };
  // Array.prototype.sort 自 ES2019 起稳定——同分同 rank 保持插入序。
  return [...items].sort((a, b) => score(b) - score(a) || rank(a) - rank(b));
}

export function buildUnifiedItems(
  _deduped: Map<string, Track>,
  all: RawSearchEntry[],
  priority: MusicProvider[] = PLAY_PRIORITY,
): UnifiedSearchItem[] {
  // 1) 按 (normalizeKey, versionType) 分组（Phase 1 redesign）：
  // 同一首歌（normalizeKey 相同）的不同 version（studio / live / acoustic /
  // remix / instrumental）→ 不同 item；同 version 内部继续按 duration 聚类。
  // 旧版只按 normalizeKey 分组，结果是 Live / Remix 都跟 studio 各自成 cluster
  // ——搜索"盲选"一下十几条，根本看不过来。
  type Group = RawGroup & { entries: RawSearchEntry[] };
  const byGroup = new Map<string, Group>();
  for (const e of all) {
    const key = normalizeKey(e.track.title, e.track.artist);
    const versionType = classifyVersion(e.track.title, e.track.album);
    const groupKey = `${key}\u0001${versionType}`; // \u0001 = 不会出现在 normalizeKey 里
    const g =
      byGroup.get(groupKey) ?? { key, versionType, entries: [] };
    g.entries.push(e);
    byGroup.set(groupKey, g);
  }

  const items: UnifiedSearchItem[] = [];
  for (const group of byGroup.values()) {
    // Phase 2 redesign：search "盲选" 之前会出现十几条 album/live/remix 不同
    // 录音版本。Phase 1 按 versionType 分组但同 type 内还按 3s duration 拆 cluster，
    // 结果是专辑短版/长版/Live 短版/Live 长版...各自成 item，仍然太多。
    //
    // Phase 2：同 (normalizeKey, versionType) → 1 个 UnifiedSearchItem，item 内
    // 保留 `versions: VersionEntry[]`（每个 cluster = 1 个录音版本）。默认折叠
    // 视图只显示 1 行（播放 versions[0]）；toggle ON 后展开所有 versions 给用户选。
    const clusters = clusterByDuration(group.entries);
    const versions = clusters.map((cluster, idx) =>
      toVersionEntry(cluster, group, idx, priority),
    );

    // Phase 3（2026-09-20）：主版本 = 跨平台共识最多（并列取最长）的那条，不再是
    // "最短"。用户搜"盲选"时折叠行原本显示 1:20 的片段（最短 cluster），点开就播它。
    const canonical = pickCanonicalVersion(versions);

    // 与主版本时长偏差 >50% 的孤立 cluster：不是"这首歌的另一个版本"，单独成条
    // （不然展开列表里会混进明显是另一条录音/片段的东西）。
    const sameRecording = versions.filter((v) => isSameRecording(v, canonical));
    const others = versions.filter((v) => !isSameRecording(v, canonical));

    items.push(toUnifiedItem(group, sameRecording, canonical, priority));
    for (const v of others) items.push(toUnifiedItem(group, [v], v, priority));
  }
  return items;
}

/**
 * 两个 key（歌名 / 艺人）是否属于不同文字系统：一方纯 CJK（含假名）、
 * 另一方纯拉丁字母（无 CJK）。用来在 library 合并阶段把「横顔」和「Yokogao」
 * 这类 Spotify 罗马音与 QQ/网易云日语原文的对齐处理掉。
 *
 * ⚠️ 假名（平/片假名，U+3040-U+30FF）也算「CJK 侧」——只在汉字范围（U+4E00-
 * U+9FFF）会把「もっと」「はなび」这类假名标题当既非 CJK 也算不上 latin，
 * 导致「はなび ↔ Hanabi」「もっと ↔ Motto」跨脚本合并漏掉。2026-08-14 已在对
 * 齐 music.service.isCrossScript 时补上假名；这里务必保持一致（否则两端 key
 * 口径分裂）。
 *
 * 注意：不对内容做翻译/映射——只判定"是同一首歌的两个不同写法，应该合"。
 */
export function isCrossScript(a: string, b: string): boolean {
  const hasCjk = (s: string) =>
    /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(s);
  const hasLatin = (s: string) => /[a-z]/i.test(s);
  const aCjk = hasCjk(a);
  const bCjk = hasCjk(b);
  if (aCjk && !bCjk && hasLatin(b)) return true;
  if (bCjk && !aCjk && hasLatin(a)) return true;
  return false;
}

/**
 * 在已 merge 的 UnifiedSearchItem 上再做一遍 cross-script / meta-suffix 合并。
 *
 * 把跨平台同歌同艺人但写法不同的条目合并成一个，涵盖两类差异：
 *  - **跨文字**（Spotify 罗马音 vs QQ 汉字）："横顔" + "Yokogao" →
 *    含 qq/netease/spotify 三个 sources。
 *  - **品牌/CM/影视元数据尾缀**（catalog 级 normalizeKey 未剥）：
 *    「一百」+「一百 - 百事可乐品牌主题曲」→ 合并。
 *
 * 艺人匹配用 `artistLooseMatch`（@maestro/common）：策展别名表 + 段段配对
 * （「李荣浩·黑马」vs「Ronghao Li·黑馬」按 `·` 切后段对段再查表）。非表内
 * 巧合仍拒判（保留「Coldplay vs Cold」铁律）。
 *
 * 仅用于 library import 路径（不做在线搜索合并，那个用严格 normalizeKey）。
 */
export function mergeCrossScript(
  items: UnifiedSearchItem[],
  priority: MusicProvider[] = PLAY_PRIORITY,
): UnifiedSearchItem[] {
  const n = items.length;
  const dead = new Set<number>();

  // 性能（2026-08-26 加）：原实现每对都无条件调 artistTransliterationMatch——
  // 单次调用 ~0.2ms（内含 cn2t/cjkUnify 的 OpenCC 转换），n=987 时 O(n²)=475k
  // 对 → 实测 95s，用户看到的「导入卡死」根因在此（不是 fetchLiked）。
  //
  // 优化：三个合并条件是 AND 关系（歌手 AND 标题 AND 时长），**调换判定顺序
  // 不改语义**。把最便宜的时长差（±12s 数值比较）提到最前，把最贵的
  // artistTransliterationMatch 压到最后——绝大多数对在时长一步就被 continue
  // 掉，artist 比较只跑在「同名同长的候选」上。配合 translit.ts 的 memoization
  // （cn2t / romanizeJaTokens / romanizeVariants 按输入串缓存），987 条库从
  // ~95s 降到 ~2s，合并结果不变（cross-script-merge.test 全绿）。
  for (let i = 0; i < n; i++) {
    if (dead.has(i)) continue;
    const a = items[i];
    // 预计算 a 的 title key（b 的在循环里按需算；时长/标题过滤后剩下的对
    // 才值得算 key，所以不用预存全部——见下方 continue 顺序）。
    for (let j = i + 1; j < n; j++) {
      if (dead.has(j)) continue;
      const b = items[j];
      // 1) Duration within 30 s —— 最便宜的数值比较，先挡掉绝大多数对。
      //    30s 与 DIFFERENT_VERSION_DURATION_TOLERANCE_SEC 对齐：跨平台同歌
      //    不同版本（intro/outro 差异、single vs album、radio edit）常差
      //    15-25s，12s 太严会漏合并（用户实测：尘大师 QQ 210s vs Spotify
      //    195s 差 15s 被跳过）。后续 title displayKey 相等 + artist 别名
      //    命中是强条件，30s 内不会误并不同歌。
      if (a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) > 30) continue;
      // 2) Title: strip trailing meta (品牌主题曲/电影版/完整版/...) then
      //    either equal or cross-script. `displayKey` 内含 cjkUnify + noise
      //    strip + 小写，与 renderer 端 groupLibrary 同一把 key。
      const aTitleKey = displayKey(stripTrailingMeta(a.title), '');
      const bTitleKey = displayKey(stripTrailingMeta(b.title), '');
      if (aTitleKey !== bTitleKey && !isCrossScript(aTitleKey, bTitleKey)) continue;
      // 3) Artist: loose (alias table + per-segment for `·`-separated composite)
      //    OR cross-script via transliteration（Spotify 罗马音 vs QQ/网易云 汉字/
      //    假名）。artistLooseMatch 只认字面/别名表，桥不上「黒うさP ↔ Kurousa P」
      //    这类跨脚本写法——跨脚本必须音译佐证才有真实依据（见 translit.ts）。
      if (
        !artistLooseMatch(a.artist, b.artist) &&
        !artistTransliterationMatch(a.artist, b.artist)
      ) {
        continue;
      }
      // Merge: sources + likedPlatforms
      for (const s of b.sources) {
        if (!a.sources.some((x) => x.platform === s.platform && x.trackId === s.trackId)) {
          a.sources.push(s);
        }
      }
      if (b.likedPlatforms) {
        a.likedPlatforms = [...new Set([...(a.likedPlatforms ?? []), ...b.likedPlatforms])];
      }
      // Keep the shorter title (usually the CJK/canonical form wins)
      if (b.title.length < a.title.length) a.title = b.title;
      dead.add(j);
    }
  }
  // Recompute bestSource for every item that absorbed new sources
  return items
    .filter((_, i) => !dead.has(i))
    .map((it) => {
      // bestSource is a function of sources — after cross-script merge the
      // item has more platforms, so re-run the selector.
      return { ...it, bestSource: selectBestSource(it.sources, priority) };
    });
}
