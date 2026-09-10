/**
 * SearchPanel.test.tsx — 搜索全屏。
 *
 * 行为契约：
 *  1. 初始空 input → 显示「输入歌名 / 歌手，回车搜」占位
 *  2. 输入触发 debounce 300ms 后调 searchUnified
 *  3. searchUnified 返回结果后渲染到 .sp-row
 *  4. 点击 bestSource!==null 的 row → 调 onPlay(items, index)
 *  5. 点击 bestSource===null 的 row → 不调 onPlay（disabled）
 *  6. 切换 sourceMode 重新调搜索（mode=qq 时调 searchOne 而非 searchUnified）
 *  7. ESC 调 onClose
 *  8. 搜索无结果 → 显示「暂无结果」
 *  9. 搜索抛错 → 显示 .sp-error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnifiedSearchItem } from '../../api';

// ── mock api 模块 ──────────────────────────────────────────────
// vi.hoisted 保证 vi.mock 工厂闭包能拿到 mock 引用
const apiMocks = vi.hoisted(() => ({
  searchUnified: vi.fn(),
  searchOne: vi.fn(),
  fetchLyricsAvailability: vi.fn(),
}));
const {
  searchUnified: mockSearchUnified,
  searchOne: mockSearchOne,
  fetchLyricsAvailability: mockFetchLyricsAvailability,
} = apiMocks;

vi.mock('../../api', async () => {
  // 拿真模块保留类型/常量；只替换 fetch 调用
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    searchUnified: apiMocks.searchUnified,
    searchOne: apiMocks.searchOne,
    fetchLyricsAvailability: apiMocks.fetchLyricsAvailability,
  };
});

import SearchPanel from './SearchPanel';

const SAMPLE: UnifiedSearchItem[] = [
  {
    id: 'qq:1',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    coverUrl: '',
    duration: 269,
    bestSource: 'qq',
    sources: [{ platform: 'qq', trackId: '1', hasCopyright: true, url: '/qq/1' }],
  },
  {
    id: 'qq:2',
    title: '无版权歌',
    artist: '未知',
    album: '',
    coverUrl: '',
    duration: 0,
    bestSource: null,
    sources: [{ platform: 'qq', trackId: '2', hasCopyright: false, url: '/qq/2' }],
  },
];

describe('SearchPanel', () => {
  beforeEach(() => {
    mockSearchUnified.mockReset();
    mockSearchOne.mockReset();
    mockFetchLyricsAvailability.mockReset();
    // 默认 searchUnified 返回一条结果
    mockSearchUnified.mockResolvedValue({
      items: SAMPLE,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    mockSearchOne.mockResolvedValue(SAMPLE);
    mockFetchLyricsAvailability.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态：显示占位文案，不调 searchUnified', () => {
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/输入歌名.*回车搜/)).toBeInTheDocument();
    expect(mockSearchUnified).not.toHaveBeenCalled();
  });

  it('输入后 debounce 300ms 调 searchUnified 并渲染结果', async () => {
    vi.useFakeTimers();
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/) as HTMLInputElement;
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, '晴天');
    // 还没过 debounce
    expect(mockSearchUnified).not.toHaveBeenCalled();
    // 推进过 debounce 窗口
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    // 等 searchUnified 的 Promise microtask 落地
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSearchUnified).toHaveBeenCalledWith(
      '晴天',
      1,
      20,
      expect.anything(), // AbortSignal
    );
    // 结果渲染（fakeTimers 下 waitFor 不可用，直接同步查）
    expect(screen.getByText('晴天')).toBeInTheDocument();
    // 不可播放的 row 也渲染（但 disabled）
    expect(screen.getByText('无版权歌')).toBeInTheDocument();
  });

  it('点击 bestSource!==null 的 row → 调 onPlay(items, index)', async () => {
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await userEvent.type(input, '晴天');
    await waitFor(() => {
      expect(screen.getByText('晴天')).toBeInTheDocument();
    });
    // 找到「晴天」所在的 .sp-row
    const titleEl = screen.getByText('晴天');
    const row = titleEl.closest('.sp-row') as HTMLElement;
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0]).toEqual(SAMPLE);
    expect(onPlay.mock.calls[0][1]).toBe(0);
  });

  it('点击 bestSource===null 的 row → 不调 onPlay（disabled）', async () => {
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await userEvent.type(input, '晴天');
    await waitFor(() => {
      expect(screen.getByText('无版权歌')).toBeInTheDocument();
    });
    const row = screen.getByText('无版权歌').closest('.sp-row') as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('切换 source 到 qq → 调 searchOne 而不是 searchUnified', async () => {
    vi.useFakeTimers();
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, '晴天');
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // 切到 qq 平台（点 .sp-badge）
    const badges = document.querySelectorAll('.sp-badge');
    const qqBadge = Array.from(badges).find((b) => b.textContent === 'Q') as HTMLElement;
    fireEvent.click(qqBadge);
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSearchOne).toHaveBeenCalledWith(
      'qq',
      '晴天',
      expect.anything(),
    );
  });

  it('按 ESC 调 onClose', async () => {
    const onClose = vi.fn();
    render(<SearchPanel onPlay={() => {}} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('搜索返回空 → 显示「暂无结果」', async () => {
    mockSearchUnified.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await userEvent.type(input, '不存在的歌');
    await waitFor(() => {
      // 多次匹配「暂无结果」（loadingMore / 0 results）选一个就行
      expect(screen.getAllByText('暂无结果').length).toBeGreaterThan(0);
    });
  });

  it('searchUnified 抛错 → 显示 .sp-error', async () => {
    mockSearchUnified.mockRejectedValueOnce(new Error('网络炸了'));
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/搜索/);
    await userEvent.type(input, '炸');
    await waitFor(() => {
      expect(document.querySelector('.sp-error')?.textContent).toBe('网络炸了');
    });
  });
});
