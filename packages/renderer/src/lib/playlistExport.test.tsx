/**
 * 歌单导出的纯函数 + 下载行为（specs/playlist-export/）。
 *
 * 「导出的文本长什么样」是**用户看得见的东西** ⇒ 锁死格式，别让格式被
 * 改代码的人随手改掉。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPlaylistText, safeFileName, downloadPlaylistText } from './playlistExport';
import type { Playlist } from '../api';

function track(title: string, artist: string, duration: number) {
  return {
    id: `${title}-${artist}`,
    title,
    artist,
    album: '专辑',
    coverUrl: '',
    duration,
    bestSource: 'qq',
    versionType: 'studio',
    sources: [],
    versions: [],
  } as unknown as Playlist['tracks'][number];
}

function playlist(name: string, tracks: Playlist['tracks']): Playlist {
  return {
    id: 'p1',
    name,
    tracks,
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('playlistExport · 文本格式', () => {
  it('首行是歌单名 + 首数，第二行是导出时间', () => {
    const txt = buildPlaylistText(playlist('通勤路上', [track('晴天', '周杰伦', 269)]), 0);
    const lines = txt.split('\n');
    expect(lines[0]).toBe('通勤路上（1 首）');
    expect(lines[1]).toMatch(/^导出时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('每首一行：序号 + 歌名 — 歌手 + 时长', () => {
    const txt = buildPlaylistText(
      playlist('x', [
        track('Drip Dry Eyes', 'YUKIHIRO TAKAHASHI', 330),
        track('晴天', '周杰伦', 269),
      ]),
      0,
    );
    expect(txt).toContain('1. Drip Dry Eyes — YUKIHIRO TAKAHASHI（5:30）');
    expect(txt).toContain('2. 晴天 — 周杰伦（4:29）');
  });

  it('用「—」而不是「-」分隔（歌名/歌手本身可能带连字符）', () => {
    const txt = buildPlaylistText(playlist('x', [track('A-B', 'C-D', 60)]), 0);
    expect(txt).toContain('1. A-B — C-D（1:00）');
  });

  it('时长为 0 → 不带时长括号', () => {
    const txt = buildPlaylistText(playlist('x', [track('无时长', '某人', 0)]), 0);
    expect(txt).toContain('1. 无时长 — 某人');
    expect(txt).not.toContain('（0:00）');
  });

  it('空歌单 → 首数 0，没有曲目行', () => {
    const txt = buildPlaylistText(playlist('空的', []), 0);
    expect(txt).toContain('空的（0 首）');
    expect(txt.split('\n').filter((l) => /^\d+\./.test(l))).toHaveLength(0);
  });
});

describe('playlistExport · 文件名', () => {
  it('去掉文件系统不允许的字符', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
  });

  it('全是非法字符 / 空 → 兜底「歌单」', () => {
    expect(safeFileName('///')).toBe('歌单');
    expect(safeFileName('   ')).toBe('歌单');
  });

  it('超长截断到 60 字', () => {
    expect(safeFileName('x'.repeat(200))).toHaveLength(60);
  });
});

describe('playlistExport · 下载', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('点「导出」→ 生成 .txt 下载（文件名 = 歌单名）', () => {
    downloadPlaylistText(playlist('通勤路上', [track('晴天', '周杰伦', 269)]));
    expect(URL.createObjectURL).toHaveBeenCalled();
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    expect(click).toHaveBeenCalledTimes(1);
    // a.download 必须是「歌单名.txt」
    const created = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(created.download).toBe('通勤路上.txt');
    expect(created.href).toBe('blob:mock');
  });
});
