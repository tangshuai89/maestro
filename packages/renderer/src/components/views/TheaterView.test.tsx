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
 *  8. 「复制歌词」→ clipboard 写入 LRC 格式（synced 带 [mm:ss.xx]）
 *  9. 非 synced → 写入纯文本，不带时间戳
 * 10. 「复制本行」→ 只写当前行；activeLine<0 时禁用
 * 11. 复制成功后按钮 in-place 变「已复制 ✓」，1.2s 后复原
 * 12. 「换个源找歌词」有结果→「已换源 · N 行 ✓」；无结果→「其它源也没有歌词」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  /** userEvent.setup() 无论 writeToClipboard 取值都会用自己的 stub 顶掉
   *  navigator.clipboard，所以必须 setup 之后再装 spy（ErrorPanel 那边全程用
   *  fireEvent，没踩到这个坑）。 */
  function setupUser() {
    const user = userEvent.setup({ writeToClipboard: false });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    return user;
  }

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
      <TheaterView {...makeProps({ lyricsExportState: 'working', onExportLyrics: vi.fn() })} />,
    );
    const btn = screen.getByRole('button', { name: /导出中/ });
    expect(btn).toBeDisabled();

    rerender(
      <TheaterView {...makeProps({ lyricsExportState: 'done', onExportLyrics: vi.fn() })} />,
    );
    expect(screen.getByRole('button', { name: /已导出/ })).toBeEnabled();

    rerender(
      <TheaterView {...makeProps({ lyricsExportState: 'error', onExportLyrics: vi.fn() })} />,
    );
    expect(screen.getByRole('button', { name: /导出失败/ })).toBeEnabled();
  });

  it('5. 无歌词 → 重搜按钮 + 网易云外链（href 带歌名/歌手）', async () => {
    // 必须给返回值：按钮现在按 res.lines.length 判「换到了」还是「白跑」
    const onRetryLyrics = vi.fn().mockResolvedValue({ lines: [{ time: 1, text: 'x' }] });
    render(
      <TheaterView {...makeProps({ lyrics: null, onRetryLyrics, onExportLyrics: vi.fn() })} />,
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
    render(<TheaterView {...makeProps({ lyrics: null, onExportLyrics: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: /导出歌词图/ })).toBeNull();
  });

  it('7. 合并徽章：mergedFrom > 1 才显示', () => {
    const { rerender } = render(
      <TheaterView {...makeProps({ lyricsMergedFrom: ['qq'], lyricsAdded: 0 })} />,
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

  it('8. 「复制歌词」→ clipboard 写入标准 LRC 行格式 [mm:ss.xx]', async () => {
    const user = setupUser();
    render(<TheaterView {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /复制歌词/ }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    // currentTime=10 落在 LYRICS[2]；synced=true → 每行都带时间戳
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      ['[00:01.00] 第一句', '[00:05.00] 第二句', '[00:09.00] 第三句', '[00:13.00] 第四句'].join(
        '\n',
      ),
    );
  });

  it('9. 非 synced → 写入纯文本，不带时间戳', async () => {
    const user = setupUser();
    render(<TheaterView {...makeProps({ lyricsSynced: false })} />);

    await user.click(screen.getByRole('button', { name: /复制歌词/ }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('第一句\n第二句\n第三句\n第四句');
  });

  it('10. 「复制本行」→ 只写当前行；activeLine<0 时禁用', async () => {
    const user = setupUser();

    // 播放头在歌词起点之前 → 没有当前行 → 按钮禁用，不发 clipboard
    const first = render(<TheaterView {...makeProps({ currentTime: 0 })} />);
    const disabledBtn = screen.getByRole('button', { name: /复制本行/ });
    expect(disabledBtn).toBeDisabled();
    await user.click(disabledBtn);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    first.unmount();

    // currentTime=10 落在 LYRICS[2] → 只复制那一句，不带时间戳
    render(<TheaterView {...makeProps()} />);
    await user.click(screen.getByRole('button', { name: /复制本行/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('第三句');
  });

  it('11. 复制成功 → 按钮 in-place 变「已复制 ✓」，1.2s 后复原', async () => {
    const user = setupUser();
    render(<TheaterView {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /复制歌词/ }));
    expect(await screen.findByRole('button', { name: /已复制/ })).toBeInTheDocument();

    await waitFor(
      () => expect(screen.getByRole('button', { name: /复制歌词/ })).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
  it('12. 「换个源找歌词」：有结果→「已换源 · N 行 ✓」，无结果→「其它源也没有歌词」', async () => {
    const user = setupUser();

    // 命中：返回 3 行 → 按钮显示「已换源 · 3 行 ✓」
    const hit = vi.fn().mockResolvedValue({
      lines: [
        { time: 1, text: 'a' },
        { time: 2, text: 'b' },
        { time: 3, text: 'c' },
      ],
    });
    const first = render(<TheaterView {...makeProps({ onRetryLyrics: hit })} />);
    await user.click(screen.getByRole('button', { name: /换个源找歌词/ }));
    expect(hit).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /已换源 · 3 行/ })).toBeInTheDocument();
    first.unmount();

    // 未命中：返回 null → 按钮显示「其它源也没有歌词」
    const miss = vi.fn().mockResolvedValue(null);
    render(<TheaterView {...makeProps({ onRetryLyrics: miss })} />);
    await user.click(screen.getByRole('button', { name: /换个源找歌词/ }));
    expect(miss).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /其它源也没有歌词/ })).toBeInTheDocument();
  });
});
