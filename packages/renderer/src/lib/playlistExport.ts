/**
 * 歌单导出（specs/playlist-export/）。
 *
 * ## 为什么需要它
 *
 * App 有**整库**的加密备份导出，但没有「**把这张歌单发给别人**」——
 * 功能盘点 P3：`歌单分享 / 导出 · sharePlaylist / 导出歌单 → 0 处`。
 *
 * ## 导成什么格式
 *
 * **纯文本（.txt）**，不是 JSON。理由：这份文件的用途是**发给朋友**——
 * 对方拿到的应该是一份「歌名 - 歌手」的清单，能直接贴进任何播放器；
 * JSON 里的 `platform:trackId` 对没有同一个平台账号的人毫无意义。
 *
 * （要机器可读/可回导的 JSON 是另一件事，需要服务端补一个 import 端点才能
 * 闭环 —— 不在本 spec 范围。）
 *
 * ## 纯函数 + DOM 副作用分开
 *
 * - `buildPlaylistText()` —— **纯函数**（歌单 → 文本），好测
 * - `downloadPlaylistText()` —— DOM 副作用（Blob + `<a download>`）
 *
 * 下载的做法跟 `lib/lyricsShare.ts` 的歌词图片导出同款（浏览器原生下载），
 * Electron 里会落到系统「下载」目录。
 */
import type { Playlist } from '../api';
import { formatDuration } from './format';

/** 导出文本里的时间戳（本地时区，可读优先）。 */
function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 文件名里不能有 `/ \ : * ? " < > |` —— 换成全角或去掉。 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : '歌单';
}

/**
 * 歌单 → 纯文本清单。
 *
 * 格式：
 * ```
 * 我的歌单（12 首）
 * 导出时间：2026-10-26 11:30
 *
 * 1. Drip Dry Eyes — YUKIHIRO TAKAHASHI（5:30）
 * 2. ...
 * ```
 *
 * ⚠️ 曲目用 **歌名 — 歌手**（破折号两侧留空格），因为歌名/歌手里本身可能
 * 带连字符 —— 用「-」会被误读成分隔符。
 */
export function buildPlaylistText(playlist: Playlist, now: number = Date.now()): string {
  const lines: string[] = [];
  lines.push(`${playlist.name}（${playlist.tracks.length} 首）`);
  lines.push(`导出时间：${stamp(now)}`);
  lines.push('');
  playlist.tracks.forEach((t, i) => {
    const dur = t.duration > 0 ? `（${formatDuration(t.duration)}）` : '';
    lines.push(`${i + 1}. ${t.title} — ${t.artist}${dur}`);
  });
  return lines.join('\n');
}

/**
 * 触发浏览器下载（.txt）。
 *
 * ⚠️ 用 `<a download>` + `createObjectURL`（跟 `lib/lyricsShare.ts` 同款），
 * 不引第三方库 —— Electron 里会落到系统「下载」目录。
 */
export function downloadPlaylistText(playlist: Playlist): void {
  const text = buildPlaylistText(playlist);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(playlist.name)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 会让部分浏览器来不及开始下载 → 延后一拍
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
