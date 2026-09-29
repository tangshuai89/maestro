/**
 * TheaterView 歌词交互层测试（vitest + happy-dom）。
 *
 * 覆盖本轮加的「歌词分享 + 无歌词引导」：
 *  1. 点当前行 → onExportLyrics(当前行文本)
 *  2. 点后续行 → onExportLyrics(那行文本)
 *  3. 「导出歌词图」按钮 → onExportLyrics()（无参 = 整段）
 *  4. lyricsExportState 状态机 → 按钮文案 / disabled
 *  5. 无歌词 → 「换个源找歌词」按钮 + 网易云外链（href 带歌名歌手）
 *  6. 无歌词时不显示导出按钮
 *  7. 合并徽章：mergedFrom.length > 1 才显示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TheaterView, { type TheaterViewProps } from './TheaterView';

const LYRICS = [
  { time: 1, text: '第一句' },
  { time: 5, text: '第二句' },
  { time: 9, text: '第三句' },
  { time: 13, text: '第四句' },
];

function makeProps(over: Partial<TheaterViewProps> = {}): TheaterViewProps {
  return {
    track: {
      id: 't1',
      provider: 'qq',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      coverUrl: '',
      audioUrl: '',
      duration: 240,
      liked: false,
    },
    playing: true,
    loading: false,
    liked: false,
    fanOutCount: 0,
    currentTime: 10, // 落在 LYRICS[2]「第三句」
    duration: 240,
    provider: 'qq',
    qqQuality: 'high',
    accountName: 'Guest',
    likedCount: 0,
    coverBackdropRef: { current: null },
    lyrics: LYRICS,
    lyricsSynced: true,
    lyricsSource: 'qq',
    recoConfigured: false,
    recoLibrarySize: 0,
    recoRunning: false,
    recoMatchRate: 0,
    recoSuggestions: [],
    onPlayPause: vi.fn(),
    onSkip: vi.fn(),
    onPrev: vi.fn(),
    onLike: vi.fn(),
    onDislike: vi.fn(),
    onSeek: vi.fn(),
    onOpenLiked: vi.fn(),
    onSwitchProvider: vi.fn(),
    ...over,
  };
}

describe('TheaterView 歌词交互', () => {
  // 密度由窗口宽度决定（<1100 = narrow 只渲染当前行）。默认 happy-dom 是
  // 1024 宽 → 拿不到「后续行」，所以显式开成 regular 档。
  beforeEach(() => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
  });

  it('1. 点当前行 → onExportLyrics(当前行文本)', async () => {
    const onExportLyrics = vi.fn();
    render(<TheaterView {...makeProps({ onExportLyrics })} />);
    await userEvent.click(screen.getByText('第三句'));
    expect(onExportLyrics).toHaveBeenCalledWith('第三句');
  });

  it('2. 点后续行 → onExportLyrics(那行文本)', async () => {
    const onExportLyrics = vi.fn();
    render(<TheaterView {...makeProps({ onExportLyrics })} />);
    await userEvent.click(screen.getByText('第四句'));
    expect(onExportLyrics).toHaveBeenCalledWith('第四句');
  });

  it('3. 「导出歌词图」按钮 → onExportLyrics() 无参（整段）', async () => {
    const onExportLyrics = vi.fn();
    render(<TheaterView {...makeProps({ onExportLyrics })} />);
    await userEvent.click(screen.getByRole('button', { name: /导出歌词图/ }));
    expect(onExportLyrics).toHaveBeenCalledWith();
  });

  it('4. 导出状态机：working → done 文案切换 + 禁用', async () => {
    const { rerender } = render(
      <TheaterView
        {...makeProps({ lyricsExportState: 'working', onExportLyrics: vi.fn() })}
      />,
    );
    const btn = screen.getByRole('button', { name: /导出中/ });
    expect(btn).toBeDisabled();

    rerender(
      <TheaterView
        {...makeProps({ lyricsExportState: 'done', onExportLyrics: vi.fn() })}
      />,
    );
    expect(screen.getByRole('button', { name: /已导出/ })).toBeEnabled();

    rerender(
      <TheaterView
        {...makeProps({ lyricsExportState: 'error', onExportLyrics: vi.fn() })}
      />,
    );
    expect(screen.getByRole('button', { name: /导出失败/ })).toBeEnabled();
  });

  it('5. 无歌词 → 重搜按钮 + 网易云外链（href 带歌名/歌手）', async () => {
    const onRetryLyrics = vi.fn();
    render(
      <TheaterView
        {...makeProps({ lyrics: null, onRetryLyrics, onExportLyrics: vi.fn() })}
      />,
    );
    expect(screen.getByText(/暂无歌词/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /换个源找歌词/ }));
    expect(onRetryLyrics).toHaveBeenCalledTimes(1);

    const link = screen.getByRole('link', { name: /去网易云提交歌词/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('music.163.com');
    expect(decodeURIComponent(href)).toContain('晴天');
    expect(decodeURIComponent(href)).toContain('周杰伦');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('6. 无歌词时不显示导出按钮', () => {
    render(
      <TheaterView
        {...makeProps({ lyrics: null, onExportLyrics: vi.fn() })}
      />,
    );
    expect(screen.queryByRole('button', { name: /导出歌词图/ })).toBeNull();
  });

  it('7. 合并徽章：mergedFrom > 1 才显示', () => {
    const { rerender } = render(
      <TheaterView
        {...makeProps({ lyricsMergedFrom: ['qq'], lyricsAdded: 0 })}
      />,
    );
    expect(screen.queryByText(/MERGED/)).toBeNull();
    rerender(
      <TheaterView
        {...makeProps({
          lyricsMergedFrom: ['qq', 'netease'],
          lyricsAdded: 3,
        })}
      />,
    );
    expect(screen.getByText('MERGED · QQ+NETEASE (+3)')).toBeInTheDocument();
  });
});
