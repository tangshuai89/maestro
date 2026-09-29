import type { LyricLine } from '../api';

/**
 * 歌词行定位。TheaterView 的内嵌歌词面板与桌面歌词浮窗（§7.2）共用同一套
 * 判定 —— 两边对「当前行」的理解必须一致，否则浮窗会和面板错行。
 */

export interface LyricLineWindow {
  /** 当前行 index；-1 = 还没到第一句 */
  index: number;
  current: LyricLine | null;
  next: LyricLine | null;
  /** 当前行内进度 0..1；没有当前行或下一句时间未知时为 0 */
  progress: number;
}

/**
 * 当前行 index（时间已过的最后一行）。
 *
 * 50ms 容差：LRC 时间戳是秒级精度，行边界早 50ms 判过去，避免"唱到一半才换行"
 * 这种肉眼可见的滞后。lines 必须按 time 升序（server 侧已排序）。
 */
export function activeLineIndex(lines: LyricLine[] | null | undefined, t: number): number {
  if (!lines || lines.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t + 0.05) idx = i;
    else break;
  }
  return idx;
}

/**
 * 一次算出当前行 + 下一行 + 行内进度。
 *
 * 浮窗每秒要重算好几次，面板也要 —— 合成一次遍历省得两处各写一遍二分/线性扫描。
 */
export function activeLineWindow(
  lines: LyricLine[] | null | undefined,
  t: number,
): LyricLineWindow {
  const index = activeLineIndex(lines, t);
  if (index < 0 || !lines) {
    return { index: -1, current: null, next: lines?.[0] ?? null, progress: 0 };
  }
  const current = lines[index];
  const next = lines[index + 1] ?? null;
  const span = next ? next.time - current.time : 0;
  const progress =
    span > 0 ? Math.min(1, Math.max(0, (t - current.time) / span)) : 0;
  return { index, current, next, progress };
}
