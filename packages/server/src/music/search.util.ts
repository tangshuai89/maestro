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
 */
export function selectBestSource(sources: SourceInfo[]): MusicProvider | null {
  const byPriority = (pred: (s: SourceInfo) => boolean): MusicProvider | null =>
    PLAY_PRIORITY.find((p) => sources.some((s) => s.platform === p && pred(s))) ??
    null;
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
 * 先按 normalizeKey（歌名+歌手）分组，再在组内按 duration 聚类成「版本」——
 * 同名不同时长的版本（album / live / remix ...）各自成条，跨平台**同版本**
 * （时长接近）才合并。这样搜索里能看到多个版本，点 ❤ 时 sources 里就是
 * 同一个版本的跨平台源。
 *
 * `deduped` 参数保留是为了兼容旧签名/测试；分组逻辑不再依赖它。
 */
export function buildUnifiedItems(
  _deduped: Map<string, Track>,
  all: RawSearchEntry[],
): UnifiedSearchItem[] {
  // 1) 按 normalizeKey 分组
  const byKey = new Map<string, RawSearchEntry[]>();
  for (const e of all) {
    const key = normalizeKey(e.track.title, e.track.artist);
    const arr = byKey.get(key) ?? [];
    arr.push(e);
    byKey.set(key, arr);
  }

  const items: UnifiedSearchItem[] = [];
  for (const entries of byKey.values()) {
    // 2) 组内按 duration 聚类成版本
    for (const cluster of clusterByDuration(entries)) {
      const sources: SourceInfo[] = cluster.map(({ track }) => ({
        platform: track.provider,
        trackId: track.id,
        // QQ/网易云的搜索结果默认有版权（搜索阶段无法完全判断，
        // 播放时 getStreamUrl 才最终裁决）。
        hasCopyright: true,
        url: track.audioUrl,
        // 透传 QQ 的 media_mid，让统一搜索结果走「标准→320→无损」时仍可升级。
        mediaMid: track.mediaMid,
        // 透传 VIP 锁标记，selectBestSource 据此避开只能出试听的源。
        vipLocked: track.vipLocked,
      }));
      // main：取 cluster 内优先级最高平台的 track（决定 id / 展示信息），
      // 保证同一版本的 id 稳定、标题优先用 QQ/网易云的中文名。
      const main =
        PLAY_PRIORITY.map((p) =>
          cluster.find((e) => e.track.provider === p),
        ).find(Boolean)?.track ?? cluster[0].track;
      const bestSource = selectBestSource(sources);
      items.push({
        id: `merged-${main.provider}-${main.id}`,
        title: main.title,
        artist: main.artist,
        album: main.album,
        coverUrl: main.coverUrl,
        duration: main.duration,
        sources,
        bestSource,
      });
    }
  }
  return items;
}

/**
 * 两个 key（歌名 / 艺人）是否属于不同文字系统：一方纯 CJK（无拉丁字母）、
 * 另一方纯拉丁字母（无 CJK）。用来在 library 合并阶段把「横顔」和「Yokogao」
 * 这类 Spotify 罗马音与 QQ/网易云日语原文的对齐处理掉。
 *
 * 注意：不对内容做翻译/映射——只判定"是同一首歌的两个不同写法，应该合"。
 */
export function isCrossScript(a: string, b: string): boolean {
  const hasCjk = (s: string) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s);
  const hasLatin = (s: string) => /[a-z]/.test(s);
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
export function mergeCrossScript(items: UnifiedSearchItem[]): UnifiedSearchItem[] {
  const n = items.length;
  const dead = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (dead.has(i)) continue;
    const a = items[i];
    for (let j = i + 1; j < n; j++) {
      if (dead.has(j)) continue;
      const b = items[j];
      // Artist: loose (alias table + per-segment for `·`-separated composite).
      if (!artistLooseMatch(a.artist, b.artist)) continue;
      // Title: strip trailing meta (品牌主题曲/电影版/完整版/...) then
      // either equal or cross-script. `displayKey` 内含 cjkUnify + noise
      // strip + 小写，与 renderer 端 groupLibrary 同一把 key。
      const aTitleKey = displayKey(stripTrailingMeta(a.title), '');
      const bTitleKey = displayKey(stripTrailingMeta(b.title), '');
      if (aTitleKey !== bTitleKey && !isCrossScript(aTitleKey, bTitleKey)) continue;
      // Duration within 12 s (generous — cross-script already guarantees
      // same-artist same-song, duration variation is version difference)
      if (a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) > 12) continue;
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
      return { ...it, bestSource: selectBestSource(it.sources) };
    });
}
