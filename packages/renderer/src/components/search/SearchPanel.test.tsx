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
 * 10. 多版本 item：行尾唯一的箭头是「N 个版本 ▾」展开按钮，点它只展开、不播放
 *     （Bug #7：行尾曾经是 ▶ 播放三角，被用户当成展开箭头点）
 * 11. 展开后的 sub-row 点播放对应 version（sources/bestSource/duration 换成该版本）
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
    versionType: 'studio',
    versions: [{ id: 'ver-1', duration: 269, sources: [{ platform: 'qq', trackId: '1', hasCopyright: true, url: '/qq/1' }], bestSource: 'qq' }],
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
    versionType: 'studio',
    versions: [{ id: 'ver-2', duration: 0, sources: [{ platform: 'qq', trackId: '2', hasCopyright: false, url: '/qq/2' }], bestSource: null }],
    sources: [{ platform: 'qq', trackId: '2', hasCopyright: false, url: '/qq/2' }],
  },
];

/** 同名同 type、3 个不同 duration cluster → 1 item + 3 versions。
 *  每个 version 带自己的原始元数据（server buildUnifiedItems 填充）：
 *  用户展开后要看到"盲选 / 盲选 (Live) / 盲选 (伴奏)"这种真实歌名，而不是 v2/v3。 */
const src = (
  platform: 'qq' | 'netease',
  trackId: string,
  hasCopyright: boolean,
) => ({ platform, trackId, hasCopyright, url: `/${platform}/${trackId}` });

const MULTI: UnifiedSearchItem[] = [
  {
    id: 'merged-1',
    title: '盲选',
    artist: '某歌手',
    album: '某专辑',
    coverUrl: '',
    duration: 200,
    bestSource: 'qq',
    versionType: 'studio',
    sources: [src('qq', '1', true)],
    versions: [
      {
        id: 'v1',
        duration: 200,
        sources: [src('qq', '1', true)],
        bestSource: 'qq',
        title: '盲选',
        artist: '黄霄雲',
        album: '盲选',
        coverUrl: '',
      },
      {
        id: 'v2',
        duration: 360,
        sources: [src('netease', '2', true)],
        bestSource: 'netease',
        title: '盲选 (Live)',
        artist: '黄霄雲',
        album: '现场版',
        coverUrl: '',
      },
      {
        id: 'v3',
        duration: 420,
        sources: [src('qq', '3', false)],
        bestSource: null,
        title: '盲选 (伴奏)',
        artist: '黄霄雲',
        album: '',
        coverUrl: '',
      },
    ],
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
    const row = screen.getByText('无版权歌').closest('.sp-row') as HTMLElement;
    expect(row.classList.contains('sp-row--disabled')).toBe(true);
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

  it('多版本：行尾展开按钮「N 个版本」只展开版本，不触发播放', async () => {
    mockSearchUnified.mockResolvedValue({
      items: MULTI,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '盲选');
    await waitFor(() => {
      expect(screen.getByText('盲选')).toBeInTheDocument();
    });

    const toggle = document.querySelector('.sp-ver-toggle') as HTMLElement;
    expect(toggle).toBeTruthy();
    // 行尾唯一箭头是展开按钮，文案 + 收起态是向下箭头
    expect(toggle.textContent).toContain('3 个版本');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // 主行不再有行尾播放三角（Bug #7 根因）
    expect(
      document.querySelector('.sp-row:not(.sp-row--sub) .sp-play-icon'),
    ).toBeNull();

    await userEvent.click(toggle);

    expect(onPlay).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.sp-row--sub').length).toBe(2);
  });

  it('多版本：sub-row 显示该版本的真实歌名/歌手/专辑（不是 v2/v3）', async () => {
    mockSearchUnified.mockResolvedValue({
      items: MULTI,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    render(<SearchPanel onPlay={() => {}} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '盲选');
    await waitFor(() => {
      expect(screen.getByText('盲选')).toBeInTheDocument();
    });

    await userEvent.click(document.querySelector('.sp-ver-toggle') as HTMLElement);
    const subRows = document.querySelectorAll('.sp-row--sub');
    expect(subRows.length).toBe(2);
    // 版本行标题 = 真实歌名（含 Live/伴奏 区分）
    expect(screen.getByText('盲选 (Live)')).toBeInTheDocument();
    expect(screen.getByText('盲选 (伴奏)')).toBeInTheDocument();
    // 第二行 = 歌手 · 专辑 · 时长
    expect(subRows[0].textContent).toContain('黄霄雲');
    expect(subRows[0].textContent).toContain('现场版');
    expect(subRows[0].textContent).toContain('6:00');
    // 旧的 v2/v3 序号 chip 已移除
    expect(document.querySelector('.sp-ver-num')).toBeNull();
  });

  it('多版本：点击 sub-row → 播放该 version（元数据/sources/duration 一起换成该版本）', async () => {
    mockSearchUnified.mockResolvedValue({
      items: MULTI,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '盲选');
    await waitFor(() => {
      expect(screen.getByText('盲选')).toBeInTheDocument();
    });

    await userEvent.click(document.querySelector('.sp-ver-toggle') as HTMLElement);
    const subRows = document.querySelectorAll('.sp-row--sub');
    await userEvent.click(subRows[0]); // v2 → 360s / netease

    expect(onPlay).toHaveBeenCalledTimes(1);
    const [viewItems, index] = onPlay.mock.calls[0];
    expect(index).toBe(0);
    expect(viewItems[0].duration).toBe(360);
    expect(viewItems[0].bestSource).toBe('netease');
    expect(viewItems[0].sources).toEqual([src('netease', '2', true)]);
    // 播放器/队列看到的是所选版本的元数据，不是主行的
    expect(viewItems[0].title).toBe('盲选 (Live)');
    expect(viewItems[0].artist).toBe('黄霄雲');
    expect(viewItems[0].album).toBe('现场版');
  });

  it('播放入口 = 封面遮罩（点击仍走 row → onPlay）', async () => {
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '晴天');
    await waitFor(() => {
      expect(screen.getByText('晴天')).toBeInTheDocument();
    });
    const overlay = document.querySelector('.sp-play-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    await userEvent.click(overlay);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][1]).toBe(0);
  });
});
