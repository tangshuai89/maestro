/**
 * Parse a standard LRC body into sorted `LyricLine[]`. Each line has
 * the form "[mm:ss.xx]text" or "[mm:ss.xxx]text"; multi-tag lines
 * like "[mm:ss.xx][mm:ss.xx]text" are split into one line per tag
 * (this is how NetEase emits chorus repeats).
 *
 * Metadata tags without time stamps (e.g. "[ti:Title]", "[ar:Artist]")
 * are skipped — they're not singable lines.
 *
 * Returns null if no timestamped lines were found, so callers can
 * distinguish "no lyrics" from "lyrics but all unparseable".
 */
export function parseLrc(body: string): LyricLine[] | null {
  const lines: LyricLine[] = [];
  // Walk one physical line at a time. Each line may carry one or more
  // timestamp tags; NetEase emits chorus repeats as "[mm:ss.xx]text"
  // chained back-to-back, and we want each tag to produce its own
  // LyricLine sharing the trailing text.
  // Capture groups: 1 = minutes, 2 = seconds (with optional decimal).
  const tagRe = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
  for (const rawLine of body.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(tagRe)];
    if (matches.length === 0) continue;
    // Text is whatever follows the last tag on the line.
    const last = matches[matches.length - 1];
    const tailStart = (last.index ?? 0) + last[0].length;
    const text = rawLine.slice(tailStart).trim();
    // Skip lines whose "text" is empty/whitespace — NetEase emits
    // visual breath marks that look ugly in the panel.
    if (!text) continue;
    for (const m of matches) {
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      // Boundary guard: minutes ∈ [0, 999], seconds ∈ [0, 60). Anything
      // outside (e.g. "[99:99.99]") would otherwise pollute the sorted
      // timeline with multi-hour phantom lines.
      if (
        !Number.isFinite(minutes) ||
        !Number.isFinite(seconds) ||
        minutes < 0 ||
        minutes > 999 ||
        seconds < 0 ||
        seconds >= 60
      ) {
        continue;
      }
      lines.push({ time: minutes * 60 + seconds, text });
    }
  }
  if (lines.length === 0) return null;
  // Sort ascending so the renderer can binary-search by currentTime.
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export interface LyricLine {
  time: number;
  text: string;
}

// 跨包归一工具（繁→简 + 日文汉字形），与 catalog 匹配共用同一条流水线
import { cjkUnify } from '@maestro/common';

// ─────────────────────────────────────────────────────────────────────────
// 多源歌词合并（NEXT-ITERATION §4「多源歌词聚合：LRC 合并去重」）
//
// 背景：此前 getLyricsAggregated 是 first-hit-wins——QQ 有词就用 QQ，
// NetEase 里多出来的 verse / 副歌补不进来。合并的目标改成：
//   1. 并行拉所有候选源（QQ / NetEase / Deezer）
//   2. 按优先级把**各自缺的那几行**并进来（并集，而不是覆盖）
//   3. 文本重复的行按时间容差去重（副歌重复的同词不同时间点必须保留）
//   4. 时间轴整体错位的源（不同录音 / 人声裁剪不同）整源丢弃，
//      绝不让错位行污染时间轴
//
// 纯文本源（lyrics.ovh / Deezer 无时间戳）不参与合并——没有时间戳就没法
// 落进时间轴；只在「一个 synced 源都没有」时整源兜底。
// ─────────────────────────────────────────────────────────────────────────

/** 同一句词在不同源之间允许的时间差（秒）。LRC 时间戳精度到 10~100ms，
 *  但各平台的对轴差异通常在 200~300ms 量级，取 400ms。 */
export const LYRIC_MATCH_TOLERANCE_S = 0.4;
/** 单个锚点允许的最大时间轴偏移（秒）。超过说明是不同录音，直接弃源。 */
export const LYRIC_MAX_OFFSET_S = 3;
/** 「近锚点」阈值（秒）：|delta| 在这个范围内基本可断定是同一句的
 *  对轴抖动，而不是副歌重复造成的假配对。 */
export const LYRIC_NEAR_ANCHOR_S = 1;
/** 锚点配对的硬上限（秒）——超过这个差值根本不是「同一句的不同对轴」，
 *  不参与中位数计算（否则一堆离群值会把中位数拉偏）。 */
const LYRIC_ANCHOR_CEILING_S = 30;
/** 合并后行数上限——防异常源（乱序 LRC / 同一行重复上千次）撑爆面板。 */
export const LYRIC_MAX_MERGED_LINES = 800;

export interface LyricSourceBundle {
  /** 来源标识（'qq' | 'netease' | 'deezer' | 'lyricsovh'），只用于回传展示。 */
  source: string;
  /** 越小越优先。0 = 主源。 */
  priority: number;
  lines: LyricLine[];
}

export interface MergedLyrics {
  lines: LyricLine[];
  synced: boolean;
  /** 实际贡献了行的来源（优先级降序）；length > 1 = 发生了多源合并。 */
  sources: string[];
  /** 低优先级源补进来的行数（并集增量）。 */
  added: number;
  /** 文本重复被丢弃的行数（去重量）。 */
  dropped: number;
  /** 时间轴对不齐、被整源放弃的来源。 */
  rejected: string[];
}

/** 有任何一行 time>0 才算 synced（与 lyrics.service 的判定保持一致）。 */
export function isSyncedLyrics(lines: LyricLine[]): boolean {
  return lines.some((l) => l.time > 0);
}

const FULLWIDTH_RE = /[！-～]/g;

/**
 * 行级比对键：跨源判定「这两行是不是同一句」。
 *
 * 归一链条：全角 ASCII→半角 → 去所有空白/标点/符号 → cjkUnify（繁→简，
 * 桥「同一句一边繁体一边简体」）→ 小写。纯标点行（"——"）归一成空串，
 * 由调用方丢弃。
 */
export function lyricLineKey(text: string): string {
  if (!text) return '';
  const halfWidth = text
    .replace(FULLWIDTH_RE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' '); // 全角空格 → 半角（写成转义避免 irregular whitespace lint）
  const stripped = halfWidth.replace(/[\p{P}\p{S}\p{Z}\p{C}]/gu, '');
  if (!stripped) return '';
  return cjkUnify(stripped).toLowerCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 偏移分箱宽度（秒）：各源对轴抖动通常在 100~300ms。 */
const LYRIC_OFFSET_BIN_S = 0.05;

/**
 * 取出现次数最多的偏移值（众数），而不是中位数。
 *
 * 为什么不用中位数：副歌重复会让「同一句」在两个源里落到不同时间点，
 * 那些成对产生的 delta 是离群值（例如 chorus 在 10s / 16s 各唱一次，
 * 其中一次配对会算出 -6s 的假偏移）。中位数会被这类离群值拖偏，
 * 众数（密集 bin）只认真正的时间轴平移。
 *
 * 平票时取离 0 更近的那个——小偏移更可能是真实对轴，大偏移更可能是
 * 副歌错配。
 */
function dominantOffset(deltas: number[]): number {
  const bins = new Map<number, { count: number; sum: number }>();
  for (const d of deltas) {
    const k = Math.round(d / LYRIC_OFFSET_BIN_S);
    const e = bins.get(k) ?? { count: 0, sum: 0 };
    e.count++;
    e.sum += d;
    bins.set(k, e);
  }
  let best: { count: number; sum: number } | null = null;
  let bestValue = 0;
  for (const [k, e] of bins) {
    const value = e.sum / e.count;
    if (
      best === null ||
      e.count > best.count ||
      // 平票 → 取离 0 更近的偏移
      (e.count === best.count && Math.abs(value) < Math.abs(bestValue))
    ) {
      best = e;
      bestValue = value;
    }
    void k;
  }
  return best === null ? 0 : bestValue;
}

/** key → 已接受的时间戳列表（升序）。副歌重复会让同一个 key 挂多个时间。 */
class TimeIndex {
  private readonly map = new Map<string, number[]>();
  private total = 0;

  get size(): number {
    return this.total;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** 升序插入——后来源的 offset 不保证单调，不能直接 push。 */
  add(key: string, time: number): void {
    let arr = this.map.get(key);
    if (!arr) {
      arr = [];
      this.map.set(key, arr);
    }
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, time);
    this.total++;
  }

  /** 离 t 最近的时间戳（无记录返回 null）。 */
  nearest(key: string, t: number): number | null {
    const arr = this.map.get(key);
    if (!arr || arr.length === 0) return null;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    // lo 与 lo-1 二选一
    const before = lo > 0 ? arr[lo - 1] : null;
    const here = arr[lo];
    if (before === null) return here;
    if (here === null) return before;
    return Math.abs(here - t) <= Math.abs(before - t) ? here : before;
  }

  /** 该 key 是否已在 tolerance 内落过点。 */
  collides(key: string, t: number, tolerance: number): boolean {
    const near = this.nearest(key, t);
    return near !== null && Math.abs(near - t) <= tolerance;
  }
}

/**
 * 估计一个源相对已接受时间轴的整体偏移。
 *
 * 对「同一个比对键」的行取最近时间点、算 delta。三种返回：
 *   - 0     没有共同词 / 只有一个共同词（不敢判系统性偏移）→ 按 0 偏移并入
 *   - 数字  该源整条时间轴平移这么久（共同词的众数偏移）
 *   - null  时间轴不可信（系统性偏移过大 = 不同录音）——调用方整源丢弃
 *
 * 两级取锚点：
 *   1. 先看「近锚点」（|delta| ≤ 1s）——这些几乎肯定是同一句，是真偏移
 *   2. 一个近锚点都没有（整条时间轴错开）时才退回用全部 delta，
 *      并且**必须 ≥ 2 个**才敢下结论：单个 delta 既可能是系统性偏移，
 *      也可能只是副歌重复唱了两次，误判成偏移会整源丢内容，
 *      代价远大于多留一行。
 */
function estimateOffset(lines: LyricLine[], index: TimeIndex): number | null {
  const deltas: number[] = [];
  for (const line of lines) {
    const key = lyricLineKey(line.text);
    if (!key || !index.has(key)) continue;
    const near = index.nearest(key, line.time);
    if (near === null) continue;
    const d = near - line.time;
    // 这里用「硬上限」而不是 LYRIC_MAX_OFFSET_S 过滤：整体偏移 6s 的错位
    // 源，正是要靠「中位数 > 3s」被判弃源；若先按 3s 把锚点过滤掉，结果
    // 会变成「没有锚点 → 偏移 0 → 错位行直接污染时间轴」，恰是最坏情况。
    if (Math.abs(d) <= LYRIC_ANCHOR_CEILING_S) deltas.push(d);
  }
  if (deltas.length === 0) return 0;
  const near = deltas.filter((d) => Math.abs(d) <= LYRIC_NEAR_ANCHOR_S);
  const pool = near.length > 0 ? near : deltas;
  // 单锚点不下系统性偏移的结论（见函数注释的取舍说明）
  if (pool.length < 2) return 0;
  const offset = dominantOffset(pool);
  if (Math.abs(offset) > LYRIC_MAX_OFFSET_S) return null;
  return offset;
}

interface Accepted {
  line: LyricLine;
  priority: number;
  order: number;
}

interface BundleStats {
  source: string;
  accepted: number;
}

/** 纯文本合并：没有任何 synced 源时，按优先级去重拼接。 */
function mergePlainText(bundles: LyricSourceBundle[]): MergedLyrics {
  const seen = new Set<string>();
  const lines: LyricLine[] = [];
  const stats: BundleStats[] = [];
  let dropped = 0;
  for (const b of bundles) {
    let accepted = 0;
    for (const line of b.lines) {
      const key = lyricLineKey(line.text);
      if (!key) continue;
      if (seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      lines.push({ time: 0, text: line.text.trim() });
      accepted++;
    }
    stats.push({ source: b.source, accepted });
  }
  const first = stats[0]?.accepted ?? 0;
  return {
    lines,
    synced: false,
    sources: stats.filter((s) => s.accepted > 0).map((s) => s.source),
    added: Math.max(0, lines.length - first),
    dropped,
    rejected: [],
  };
}

/**
 * 多源歌词合并去重——纯函数，不碰网络（便于白盒测试）。
 *
 * @param bundles 来源包，顺序任意；内部按 priority 升序（小的优先）
 * @returns 合并结果；没有任何可用行时返回 null
 */
export function mergeLyricSources(
  bundles: LyricSourceBundle[],
): MergedLyrics | null {
  const usable = bundles
    .filter((b) => b && Array.isArray(b.lines) && b.lines.length > 0)
    .map((b) => ({
      source: b.source,
      priority: Number.isFinite(b.priority) ? b.priority : 99,
      // 丢空文本行 + 防御外部 API 的脏 text（非字符串）
      lines: b.lines
        .filter(
          (l) => l && typeof l.text === 'string' && l.text.trim().length > 0,
        )
        .map((l) => ({
          time: Number.isFinite(Number(l.time)) ? Number(l.time) : 0,
          text: l.text.trim(),
        })),
    }))
    .filter((b) => b.lines.length > 0);
  if (usable.length === 0) return null;

  usable.sort((a, b) => a.priority - b.priority);

  const syncedBundles = usable.filter((b) => isSyncedLyrics(b.lines));
  if (syncedBundles.length === 0) return mergePlainText(usable);

  const index = new TimeIndex();
  const accepted: Accepted[] = [];
  const stats: BundleStats[] = [];
  const rejected: string[] = [];
  let dropped = 0;

  for (const bundle of syncedBundles) {
    const lines = [...bundle.lines].sort((a, b) => a.time - b.time);
    let offset = 0;
    if (accepted.length > 0) {
      const est = estimateOffset(lines, index);
      if (est === null) {
        rejected.push(bundle.source);
        continue;
      }
      offset = est;
    }
    let taken = 0;
    for (const line of lines) {
      const key = lyricLineKey(line.text);
      if (!key) continue; // 纯标点行（"——"）不值得占时间轴
      if (line.time <= 0) continue; // synced 源里的无时间戳行没有落点
      if (index.size >= LYRIC_MAX_MERGED_LINES) break;
      const time = Math.max(0, round2(line.time + offset));
      if (index.collides(key, time, LYRIC_MATCH_TOLERANCE_S)) {
        dropped++;
        continue;
      }
      index.add(key, time);
      accepted.push({
        line: { time, text: line.text },
        priority: bundle.priority,
        order: accepted.length,
      });
      taken++;
    }
    stats.push({ source: bundle.source, accepted: taken });
  }

  if (accepted.length === 0) return null;

  accepted.sort((a, b) =>
    a.line.time !== b.line.time
      ? a.line.time - b.line.time
      : a.priority !== b.priority
        ? a.priority - b.priority
        : a.order - b.order,
  );

  const first = stats[0]?.accepted ?? 0;
  return {
    lines: accepted.map((a) => a.line),
    synced: true,
    sources: stats.filter((s) => s.accepted > 0).map((s) => s.source),
    added: Math.max(0, accepted.length - first),
    dropped,
    rejected,
  };
}
