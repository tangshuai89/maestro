// ─────────────────────────────────────────────────────────────────
// TheaterView 的尺寸适配规则（纯函数，可单测）
//
// 背景：剧场视图是**固定设计画布 + transform: scale()**，不是流式重排。
// 2026-09-20 量过一套几何：1440 稿里「封面簇右边缘 670」+「歌词宽 560」+ 右边距 60
// ⇒ 这套版式的**最小可用宽度是 1330px**；而窗口默认 1200、最小 960。
// 所以只要改成"贴左贴右的重排"，1200 宽就已经压住 70px、960 宽压住 310px ——
// 修法不是重排，而是**按宽度做内容减法 + 换一版更小的紧凑画布**。
//
// 三档（阈值与 Figma `Screen/NowPlaying` 的 density 变体一一对应）：
//   regular  ≥1280  1440×900 画布，歌词 5 行（上 1 + 当前 + 下 3），声波环 + 推荐卡都在
//   compact  1100–1279  同一 1440×900 画布（继续缩放），歌词减到 3 行
//   narrow   <1100  换 960×800 紧凑画布：砍声波环与推荐卡，歌词只留当前行
//
// 为什么 narrow 是"另一张画布"而不是"缩小原画布"：
// Figma 里那些块是**实例**，实例内部不随实例 resize 缩放（2026-09-20 实测踩到），
// 直接压小会把进度环里的圆弧和时间码顶到歌词上。所以紧凑档保持各块原生尺寸、纵向堆叠。
// ─────────────────────────────────────────────────────────────────

export type TheaterDensity = 'regular' | 'compact' | 'narrow';

/** 顶部 Titlebar 高度（macOS 拖拽区），画布可用高度 = 窗口高 - 它 */
export const TITLEBAR_H = 40;

/** 每档对应的设计画布尺寸（narrow 是另一张更小的画布，不是缩放） */
export const CANVAS: Record<TheaterDensity, { w: number; h: number }> = {
  regular: { w: 1440, h: 900 },
  compact: { w: 1440, h: 900 },
  narrow: { w: 960, h: 800 },
};

/** 宽度 → 档位 */
export function theaterDensity(width: number): TheaterDensity {
  if (width < 1100) return 'narrow';
  if (width < 1280) return 'compact';
  return 'regular';
}

/**
 * 画布缩放系数：宽高各算一次取小值。
 * 高度项有 0.3 下限，避免窗口极矮时画布塌成一条线（沿用实装既有行为）。
 */
export function canvasScale(width: number, height: number, density: TheaterDensity): number {
  const c = CANVAS[density];
  const byWidth = width / c.w;
  const byHeight = Math.max(0.3, (height - TITLEBAR_H) / c.h);
  return Math.min(byWidth, byHeight);
}

/** 歌词窗口：当前行之外还显示几行 */
export function lyricWindow(density: TheaterDensity): { prev: number; following: number } {
  if (density === 'narrow') return { prev: 0, following: 0 };
  if (density === 'compact') return { prev: 1, following: 1 };
  return { prev: 1, following: 3 };
}
