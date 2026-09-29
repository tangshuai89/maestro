import { getApiOrigin } from '../api';
import type { LyricLine } from '../api';

const WIDTH = 720;
const PADDING = 48;
const COVER_SIZE = 112;
const LINE_HEIGHT = 34;
const MAX_LINES = 40;

export interface LyricsShareWindow {
  /** 实际画到图上的那一段 */
  window: LyricLine[];
  /** `window` 里被高亮的那一行下标；null = 整段导出不高亮 */
  highlightIndex: number | null;
  /** 窗口之前 / 之后被裁掉的行数（图上用省略号提示） */
  trimmedBefore: number;
  trimmedAfter: number;
}

/**
 * 选分享图的歌词窗口。
 *
 * 关键点：**以用户点的那一行为中心**取窗口，而不是永远从第 1 行截。
 * 一首长歌点第 80 行，导出的图里必须有第 80 行——否则"词句分享"名不副实。
 *
 * `highlightText` 在歌词里找不到（同名重复句 / 已切歌）时退化成"从头取
 * 满窗口"，保证导出永远成功。
 */
export function sliceLyricsWindow(
  lines: LyricLine[],
  highlightText: string | null,
  max: number = MAX_LINES,
): LyricsShareWindow {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { window: [], highlightIndex: null, trimmedBefore: 0, trimmedAfter: 0 };
  }
  const limit = Math.max(1, Math.min(max, lines.length));
  let start = 0;
  let highlightIndex: number | null = null;
  if (highlightText) {
    const idx = lines.findIndex((l) => l.text === highlightText);
    if (idx >= 0) {
      // 以高亮行为中心，前后各留一半；start 夹在 [0, lines.length - limit]
      start = Math.min(
        Math.max(idx - Math.floor((limit - 1) / 2), 0),
        lines.length - limit,
      );
      highlightIndex = idx - start;
    }
  }
  return {
    window: lines.slice(start, start + limit),
    highlightIndex,
    trimmedBefore: start,
    trimmedAfter: lines.length - (start + limit),
  };
}

/** 下载文件名：`歌名 - 歌手 歌词.png`，去掉文件系统非法字符。 */
export function lyricsImageFileName(title: string, artist: string): string {
  return `${title} - ${artist} 歌词.png`.replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * 把歌词渲染成一张可分享的图片（cover + 歌名/歌手 + 歌词正文），
 * 生成 PNG 并触发本地下载。cover 走 /music/cover-proxy（带 CORS 头），
 * 否则 canvas 会被跨域图片污染、toDataURL 直接 throw。
 *
 * `highlightText` 命中时以那一行为中心取窗口并在图上加粗高亮（见
 * `sliceLyricsWindow`）。
 *
 * 返回 true 表示已触发下载；封面加载失败会降级成无封面版式，仍会导出。
 */
export async function downloadLyricsImage(opts: {
  title: string;
  artist: string;
  coverUrl: string;
  lines: LyricLine[];
  /** 用户点的那一句（原文）。命中时以它为中心取窗口并在图上加粗高亮。 */
  highlightText?: string | null;
}): Promise<boolean> {
  const { title, artist, coverUrl } = opts;
  const pick = sliceLyricsWindow(opts.lines, opts.highlightText ?? null);
  const lines = pick.window;
  const { trimmedBefore, trimmedAfter } = pick;
  const truncated = trimmedBefore > 0 || trimmedAfter > 0;

  let cover: ImageBitmap | null = null;
  if (coverUrl) {
    try {
      const proxied = `${getApiOrigin()}/music/cover-proxy?url=${encodeURIComponent(coverUrl)}`;
      const res = await fetch(proxied);
      if (res.ok) cover = await createImageBitmap(await res.blob());
    } catch {
      cover = null;
    }
  }

  const headerH = PADDING + COVER_SIZE + 28;
  const bodyH = (lines.length + (truncated ? 1 : 0)) * LINE_HEIGHT;
  const footerH = 64;
  const height = headerH + bodyH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  // 暖奶白底 + 顶部一条 accent 色带，和 App 的暖色调一致
  ctx.fillStyle = '#faf6f0';
  ctx.fillRect(0, 0, WIDTH, height);
  const grad = ctx.createLinearGradient(0, 0, WIDTH, 0);
  grad.addColorStop(0, '#eb9e76');
  grad.addColorStop(1, '#a2472a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, 6);

  // cover（圆角裁剪）
  if (cover) {
    ctx.save();
    const r = 16;
    const x = PADDING;
    const y = PADDING;
    ctx.beginPath();
    ctx.roundRect(x, y, COVER_SIZE, COVER_SIZE, r);
    ctx.clip();
    ctx.drawImage(cover, x, y, COVER_SIZE, COVER_SIZE);
    ctx.restore();
  }

  // 歌名 / 歌手
  const textX = cover ? PADDING + COVER_SIZE + 24 : PADDING;
  ctx.fillStyle = '#2b2119';
  ctx.font =
    '600 26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(title, textX, PADDING + 44, WIDTH - textX - PADDING);
  ctx.fillStyle = '#8a7361';
  ctx.font =
    '400 18px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(artist, textX, PADDING + 76, WIDTH - textX - PADDING);

  // 歌词正文
  ctx.fillStyle = '#453629';
  ctx.font =
    '400 19px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const REGULAR_FONT =
    '400 19px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const HIGHLIGHT_FONT =
    '700 19px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  let y = headerH + LINE_HEIGHT;
  for (let i = 0; i < lines.length; i++) {
    const isHighlight = i === pick.highlightIndex;
    ctx.fillStyle = isHighlight ? '#a2472a' : '#453629';
    ctx.font = isHighlight ? HIGHLIGHT_FONT : REGULAR_FONT;
    ctx.fillText(lines[i].text, PADDING, y, WIDTH - PADDING * 2);
    if (isHighlight) {
      // 高亮行左侧一道短竖条，和 AETHER 的 active lyric bar 呼应
      ctx.fillRect(PADDING - 8, y - 15, 3, 20);
    }
    y += LINE_HEIGHT;
  }
  if (truncated) {
    ctx.fillStyle = '#a08c7a';
    ctx.font = REGULAR_FONT;
    ctx.fillText('…', PADDING, y);
  }

  // 落款
  ctx.fillStyle = '#b7a390';
  ctx.font =
    '400 14px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('Maestro', PADDING, height - 28);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = lyricsImageFileName(title, artist);
  a.click();
  return true;
}
