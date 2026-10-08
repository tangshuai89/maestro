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
import type { UnifiedSearchItem, UnifiedAlbum, AlbumSource } from '../../api';

// ── mock api 模块 ──────────────────────────────────────────────
// vi.hoisted 保证 vi.mock 工厂闭包能拿到 mock 引用
const apiMocks = vi.hoisted(() => ({
  searchUnified: vi.fn(),
  searchOne: vi.fn(),
  fetchLyricsAvailability: vi.fn(),
  searchAlbums: vi.fn(),
  fetchAlbumTracks: vi.fn(),
}));
const {
  searchUnified: mockSearchUnified,
  searchOne: mockSearchOne,
  fetchLyricsAvailability: mockFetchLyricsAvailability,
  searchAlbums: mockSearchAlbums,
  fetchAlbumTracks: mockFetchAlbumTracks,
} = apiMocks;

vi.mock('../../api', async () => {
  // 拿真模块保留类型/常量；只替换 fetch 调用
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    searchUnified: apiMocks.searchUnified,
    searchOne: apiMocks.searchOne,
    fetchLyricsAvailability: apiMocks.fetchLyricsAvailability,
    searchAlbums: apiMocks.searchAlbums,
    fetchAlbumTracks: apiMocks.fetchAlbumTracks,
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
    versions: [
      {
        id: 'ver-1',
        duration: 269,
        sources: [{ platform: 'qq', trackId: '1', hasCopyright: true, url: '/qq/1' }],
        bestSource: 'qq',
      },
    ],
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
    versions: [
      {
        id: 'ver-2',
        duration: 0,
        sources: [{ platform: 'qq', trackId: '2', hasCopyright: false, url: '/qq/2' }],
        bestSource: null,
      },
    ],
    sources: [{ platform: 'qq', trackId: '2', hasCopyright: false, url: '/qq/2' }],
  },
];

/** 同名同 type、3 个不同 duration cluster → 1 item + 3 versions。
 *  每个 version 带自己的原始元数据（server buildUnifiedItems 填充）：
 *  用户展开后要看到"盲选 / 盲选 (Live) / 盲选 (伴奏)"这种真实歌名，而不是 v2/v3。 */
const src = (platform: 'qq' | 'netease', trackId: string, hasCopyright: boolean) => ({
  platform,
  trackId,
  hasCopyright,
  url: `/${platform}/${trackId}`,
});

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
    mockSearchAlbums.mockReset();
    mockFetchAlbumTracks.mockReset();
    // 默认 searchUnified 返回一条结果
    mockSearchUnified.mockResolvedValue({
      items: SAMPLE,
      page: 1,
      pageSize: 20,
      total: 2,
    });
    mockSearchOne.mockResolvedValue(SAMPLE);
    mockFetchLyricsAvailability.mockResolvedValue(false);
    mockSearchAlbums.mockResolvedValue({
      q: '',
      total: 0,
      page: 1,
      pageSize: 20,
      items: [],
    });
    mockFetchAlbumTracks.mockResolvedValue([]);
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

  // 用户报障：搜「浓缩蓝鲸」ALL 模式下裘德那首的 Spotify 行（Spotify 把艺人
  // 记作 "Jude Chiu"）点了没反应 —— Spotify 停发 preview_url 后代理只能 502，
  // <audio> 静默卡 00:00。行必须置灰，且与 parsePlayableQueue 的准入一致。
  const SPOTIFY_NO_PREVIEW: UnifiedSearchItem[] = [
    {
      id: 'merged-spotify-sp1-studio',
      title: '浓缩蓝鲸',
      artist: 'Jude Chiu',
      album: '浓缩蓝鲸',
      coverUrl: '',
      duration: 277,
      bestSource: 'spotify',
      versionType: 'studio',
      sources: [
        {
          platform: 'spotify',
          trackId: 'sp1',
          hasCopyright: true,
          url: '/sp/1',
          vipLocked: true,
          noPreview: true,
        },
      ],
      versions: [
        {
          id: 'ver-sp1',
          duration: 277,
          bestSource: 'spotify',
          sources: [
            {
              platform: 'spotify',
              trackId: 'sp1',
              hasCopyright: true,
              url: '/sp/1',
              vipLocked: true,
              noPreview: true,
            },
          ],
        },
      ],
    },
  ];

  it('Spotify 独占 + 无 preview（WPS 未连）→ row 置灰、点击不播', async () => {
    mockSearchUnified.mockResolvedValue({
      items: SPOTIFY_NO_PREVIEW,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '浓缩蓝鲸');
    await waitFor(() => {
      expect(screen.getByText('浓缩蓝鲸')).toBeInTheDocument();
    });
    const row = screen.getByText('浓缩蓝鲸').closest('.sp-row') as HTMLElement;
    expect(row.classList.contains('sp-row--disabled')).toBe(true);
    // 不是"无版权"——是有源但拿不到音频，文案要分开
    expect(screen.getByText('无音源')).toBeInTheDocument();
    // tooltip 必须说清真正的原因（之前这里是 bestSource!==null 去猜的）
    expect(row.getAttribute('title')).toContain('Premium');
    fireEvent.click(row);
    expect(onPlay).not.toHaveBeenCalled();
  });

  // 2026-09-29 审查发现的文案撒谎：不可播有三类原因（无版权 / Spotify 无
  // 30s 预览 / 没源），而置灰 / tooltip / 行内角标曾各判一次，用
  // `bestSource !== null` 猜原因——于是"QQ 源无版权"会被说成"只有 Spotify
  // 源"、角标也会显示成"无音源"。现在三者都读 api.playableReason。
  const QQ_NO_COPYRIGHT: UnifiedSearchItem[] = [
    {
      id: 'qq-nc',
      title: '无版权歌',
      artist: '未知',
      album: '',
      coverUrl: '',
      duration: 200,
      bestSource: 'qq',
      versionType: 'studio',
      // bestSource 是 qq 且**确实有源**，只是没版权 —— 绝不能说成 Spotify
      sources: [{ platform: 'qq', trackId: 'q1', hasCopyright: false, url: '/qq/1' }],
      versions: [
        {
          id: 'ver-q1',
          duration: 200,
          bestSource: 'qq',
          sources: [{ platform: 'qq', trackId: 'q1', hasCopyright: false, url: '/qq/1' }],
        },
      ],
    },
  ];

  it('QQ 源无版权 → 角标/tooltip 说「无版权」，不误报成 Spotify 无预览', async () => {
    mockSearchUnified.mockResolvedValue({
      items: QQ_NO_COPYRIGHT,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '无版权歌');
    await waitFor(() => {
      expect(screen.getByText('无版权歌')).toBeInTheDocument();
    });
    const row = screen.getByText('无版权歌').closest('.sp-row') as HTMLElement;
    expect(row.classList.contains('sp-row--disabled')).toBe(true);
    // 角标
    expect(screen.getByText('无版权')).toBeInTheDocument();
    expect(screen.queryByText('无音源')).toBeNull();
    // tooltip：说无版权，**不含** Spotify / Premium 那句
    const title = row.getAttribute('title') ?? '';
    expect(title).toContain('无版权');
    expect(title).not.toContain('Spotify');
    expect(title).not.toContain('Premium');
    fireEvent.click(row);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('Spotify 独占 + 无 preview 但 WPS 已连 → row 可播', async () => {
    mockSearchUnified.mockResolvedValue({
      items: SPOTIFY_NO_PREVIEW,
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} wpsReady />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '浓缩蓝鲸');
    await waitFor(() => {
      expect(screen.getByText('浓缩蓝鲸')).toBeInTheDocument();
    });
    const row = screen.getByText('浓缩蓝鲸').closest('.sp-row') as HTMLElement;
    expect(row.classList.contains('sp-row--disabled')).toBe(false);
    fireEvent.click(row);
    expect(onPlay).toHaveBeenCalledTimes(1);
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
    expect(mockSearchOne).toHaveBeenCalledWith('qq', '晴天', expect.anything());
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
    expect(document.querySelector('.sp-row:not(.sp-row--sub) .sp-play-icon')).toBeNull();

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

// ══════════════════════════════════════════════════════════════
// 专辑 tab（spec: specs/album-search，tasks 4.1-4.7 / 4.9）
// ══════════════════════════════════════════════════════════════

const albumSrc = (
  platform: 'qq' | 'netease' | 'deezer' | 'spotify',
  albumId: string,
  extra: Partial<AlbumSource> = {},
): AlbumSource => ({
  platform,
  albumId,
  title: '叶惠美',
  artist: '周杰伦',
  coverUrl: '',
  trackCount: 11,
  year: 2003,
  rank: 0,
  ...extra,
});

const ALBUMS: UnifiedAlbum[] = [
  {
    id: 'merged-a',
    title: '叶惠美',
    artist: '周杰伦',
    coverUrl: '',
    trackCount: 11,
    year: 2003,
    sources: [albumSrc('qq', '000MkMni19ClKG')],
  },
  {
    id: 'merged-b',
    title: '叶惠美',
    artist: '王珏子乔',
    coverUrl: '',
    trackCount: 18,
    year: 2026,
    variantMismatch: true,
    sources: [albumSrc('netease', '372081313', { title: '叶惠美', artist: '王珏子乔' })],
  },
];

const ALBUM_TRACKS: UnifiedSearchItem[] = [
  {
    id: 'qq:t1',
    title: '以父之名',
    artist: '周杰伦',
    album: '叶惠美',
    coverUrl: '',
    duration: 342,
    bestSource: 'qq',
    versionType: 'studio',
    sources: [src('qq', 'm1', true)],
    versions: [
      {
        id: 'v1',
        duration: 342,
        sources: [src('qq', 'm1', true)],
        bestSource: 'qq',
        title: '以父之名',
        artist: '周杰伦',
        album: '叶惠美',
        coverUrl: '',
      },
    ],
  },
  {
    id: 'qq:t2',
    title: '懦夫',
    artist: '周杰伦',
    album: '叶惠美',
    coverUrl: '',
    duration: 218,
    bestSource: 'qq',
    versionType: 'studio',
    sources: [src('qq', 'm2', true)],
    versions: [
      {
        id: 'v2',
        duration: 218,
        sources: [src('qq', 'm2', true)],
        bestSource: 'qq',
        title: '懦夫',
        artist: '周杰伦',
        album: '叶惠美',
        coverUrl: '',
      },
    ],
  },
];

/** 切到「专辑」tab 并输入关键词。 */
async function gotoAlbumTab(q: string) {
  await userEvent.click(screen.getByRole('tab', { name: '专辑' }));
  await userEvent.type(screen.getByPlaceholderText(/搜索专辑名/), q);
}

describe('SearchPanel — 专辑 tab', () => {
  beforeEach(() => {
    mockSearchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: ALBUMS.length,
      page: 1,
      pageSize: 20,
      items: ALBUMS,
    });
    mockFetchAlbumTracks.mockResolvedValue(ALBUM_TRACKS);
  });

  it('默认在歌曲 tab：显示 source-toggle、不显示专辑计数', () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: '歌曲' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '专辑' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('搜索 source')).toBeTruthy();
  });

  it('切到专辑 tab → 隐藏 source-toggle（单平台搜专辑无意义）', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: '专辑' }));
    expect(screen.queryByLabelText('搜索 source')).toBeNull();
    expect(screen.getByPlaceholderText(/搜索专辑名/)).toBeTruthy();
  });

  it('切 tab 不丢关键词（tasks 4.1 的核心契约）', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '叶惠美');
    expect((screen.getByPlaceholderText(/搜索/) as HTMLInputElement).value).toBe('叶惠美');

    await userEvent.click(screen.getByRole('tab', { name: '专辑' }));
    const input = screen.getByPlaceholderText(/搜索专辑名/) as HTMLInputElement;
    expect(input.value).toBe('叶惠美');

    // 再切回歌曲，关键词仍在
    await userEvent.click(screen.getByRole('tab', { name: '歌曲' }));
    expect((screen.getByPlaceholderText(/搜索/) as HTMLInputElement).value).toBe('叶惠美');
  });

  it('专辑 tab：debounce 后调 searchAlbums 并渲染卡片', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await waitFor(() => expect(mockSearchAlbums).toHaveBeenCalled());
    expect(mockSearchAlbums.mock.calls[0][0]).toBe('叶惠美');
    // 专辑 tab 打字**不能**顺带触发歌曲搜索（两个 tab 共用 q）
    expect(mockSearchUnified).not.toHaveBeenCalled();
    // 「叶惠美」有两张专辑卡片同名 → getAllByText
    expect((await screen.findAllByText('叶惠美')).length).toBeGreaterThan(0);
    expect(screen.getByText(/11 首/)).toBeTruthy();
  });

  it('专辑 tab 渲染曲目数 + 年份（tasks 4.3）', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    expect(screen.getByText(/2003/)).toBeTruthy();
  });

  it('variantMismatch → 显示「版本分歧」角标（tasks 4.6）', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    const badge = screen.getByText('版本分歧');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toMatch(/再版|豪华版|翻唱/);
    // 未分歧的那张不应有角标 → 角标数 = 1
    expect(screen.getAllByText('版本分歧')).toHaveLength(1);
  });

  it('点专辑行 → 拉曲目并展开（tasks 4.4）', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);

    await userEvent.click(screen.getAllByText('叶惠美')[0]);
    await waitFor(() =>
      expect(mockFetchAlbumTracks).toHaveBeenCalledWith('qq', '000MkMni19ClKG', expect.anything()),
    );
    expect(await screen.findByText('以父之名')).toBeTruthy();
    expect(screen.getByText('懦夫')).toBeTruthy();
  });

  it('点曲目行 → 调 onPlay(items, index)（tasks 4.4）', async () => {
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    await userEvent.click(screen.getAllByText('叶惠美')[0]);
    const row = await screen.findByText('以父之名');
    await userEvent.click(row);
    expect(onPlay).toHaveBeenCalledWith(ALBUM_TRACKS, 0);
  });

  it('「播放全部」→ 整张专辑入队，从第 1 首开始（tasks 3.7 / 4.5）', async () => {
    const onPlay = vi.fn();
    render(<SearchPanel onPlay={onPlay} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    await userEvent.click(screen.getAllByText('叶惠美')[0]);
    await screen.findByText('以父之名');
    await userEvent.click(screen.getByText(/播放全部/));
    expect(onPlay).toHaveBeenCalledWith(ALBUM_TRACKS, 0);
  });

  it('再点同一专辑行 → 收起曲目', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    const title = screen.getAllByText('叶惠美')[0];
    await userEvent.click(title);
    await screen.findByText('以父之名');
    await userEvent.click(title);
    await waitFor(() => expect(screen.queryByText('以父之名')).toBeNull());
  });

  it('部分平台失败 → 非阻塞提示条，仍显示已有结果（tasks 4.7）', async () => {
    mockSearchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 2,
      page: 1,
      pageSize: 20,
      items: ALBUMS,
      errors: { netease: 'Not logged in to netease' },
    });
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/部分平台不可用/);
    expect(screen.getByText(/网易云音乐/)).toBeTruthy();
    // 已有结果仍然渲染
    expect(screen.getByText(/11 首/)).toBeTruthy();
  });

  it('全平台失败（空 items + errors）→ 提示 + 暂无结果', async () => {
    mockSearchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 0,
      page: 1,
      pageSize: 20,
      items: [],
      errors: { qq: 'boom', deezer: 'limit' },
    });
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    expect(await screen.findByText('暂无结果')).toBeTruthy();
    expect(screen.getByText(/部分平台不可用/)).toBeTruthy();
  });

  it('searchAlbums 抛错 → 显示 .sp-error，不崩', async () => {
    mockSearchAlbums.mockRejectedValue(new Error('network down'));
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    expect(await screen.findByText('network down')).toBeTruthy();
  });

  it('拉曲目失败 → 卡片内提示「曲目加载失败」，不影响其它卡片（tasks 4.7）', async () => {
    mockFetchAlbumTracks.mockRejectedValue(new Error('album detail not supported on netease'));
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    await userEvent.click(screen.getAllByText('叶惠美')[0]);
    expect(await screen.findByText(/曲目加载失败/)).toBeTruthy();
    // 其它卡片仍可交互
    expect(screen.getByText(/18 首/)).toBeTruthy();
  });

  it('专辑 tab 下空关键词 → 不发请求，显示占位', async () => {
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: '专辑' }));
    await screen.findByText('输入专辑名，回车搜');
    expect(mockSearchAlbums).not.toHaveBeenCalled();
  });

  it('「加载更多专辑」按钮按 total/pageSize 正确出现并翻页（回归护栏）', async () => {
    // 第 1 页满 20 条、total=21 → hasMore 必须为 true。
    // 这条专门锁一个已经真出过的 bug：setHasMore 没被调用，hasMore 恒 false，
    // 「加载更多」按钮永远不渲染。
    const page1 = Array.from({ length: 20 }, (_, i) => ({
      ...ALBUMS[0],
      id: `a${i}`,
      title: `专辑${i}`,
    }));
    mockSearchAlbums.mockResolvedValue({
      q: 'x',
      total: 21,
      page: 1,
      pageSize: 20,
      items: page1,
    });
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('x');
    const btn = await screen.findByText('加载更多专辑');
    expect(btn).toBeTruthy();

    // 翻页
    mockSearchAlbums.mockResolvedValue({
      q: 'x',
      total: 21,
      page: 2,
      pageSize: 20,
      items: [{ ...ALBUMS[0], id: 'last', title: '最后一页' }],
    });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(mockSearchAlbums).toHaveBeenCalledWith('x', 2, 20, expect.anything()),
    );
    expect(await screen.findByText('最后一页')).toBeTruthy();
  });

  it('最后一页 → 「加载更多」按钮消失', async () => {
    mockSearchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 2,
      page: 1,
      pageSize: 20,
      items: ALBUMS,
    });
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await gotoAlbumTab('叶惠美');
    await screen.findByText(/11 首/);
    expect(screen.queryByText('加载更多专辑')).toBeNull();
  });

  it('切 tab 会 abort 歌曲 tab 的在途请求（tasks 4.1/4.2）', async () => {
    // 挂起不 resolve —— 只有"在途"的请求才有 abort 意义
    let captured: AbortSignal | undefined;
    mockSearchUnified.mockImplementation((_q: string, _p: number, _s: number, sig: AbortSignal) => {
      captured = sig;
      return new Promise(() => {});
    });
    render(<SearchPanel onPlay={vi.fn()} onClose={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/搜索/), '叶惠美');
    await waitFor(() => expect(captured).toBeDefined());
    expect(captured!.aborted).toBe(false);
    await userEvent.click(screen.getByRole('tab', { name: '专辑' }));
    expect(captured!.aborted).toBe(true);
  });
});
