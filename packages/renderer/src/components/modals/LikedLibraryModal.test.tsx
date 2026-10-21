/**
 * LikedLibraryModal.test.tsx — 红心库全屏弹窗。
 *
 * 行为契约：
 *  1. 挂载即拉库（getLibrary 一次）；请求未回来时显示加载骨架（aria-busy）
 *  2. 拉到数据后渲染曲目行：歌名 / 歌手·专辑 / 时长 / 平台角标 / 总数
 *  3. getLibrary 返回 null（还没导入过）→ 空态提示 + 「现在导入」按钮
 *  4. getLibrary 抛错 → 显示错误文案（不是白屏）
 *  5. 搜索框按歌名/歌手过滤；无匹配时提示「未找到匹配「x」的歌曲」
 *  6. 「清除搜索」恢复全部曲目
 *  7. 点曲目行 → onPlay(整库 items, 该曲在原库中的下标)
 *  8. 空态点「现在导入」→ importLibrary；成功后渲染导入结果 + onImportSettled(新曲目数)
 *  9. 重新导入进行中：按钮文案变「重新导入中…」且 disabled
 * 10. 点关闭按钮 / 按 ESC → onClose
 * 11. 同歌多平台版本：可展开子行；点子行 → onPlay 对应下标
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import LikedLibraryModal from './LikedLibraryModal';
import type { UnifiedSearchItem } from '../../api';

// ── mocks ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  importLibrary: vi.fn(),
}));

vi.mock('../../api', async () => {
  // 保留真常量（类型运行时不需要，但 importActual 让未 mock 的导出保持原样，
  // 避免组件里其它 import 被清空）。
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, getLibrary: mocks.getLibrary, importLibrary: mocks.importLibrary };
});

/**
 * 虚拟滚动在 happy-dom 里测不了：容器没有真实尺寸，virtualizer 认为视口高 0，
 * getVirtualItems() 永远返回空数组（列表一行都不渲染）。
 * 这里把 useVirtualizer 换成「全量渲染」的简化实现——本组件要保证的是
 * 「渲染了哪些行 / 行上能点什么」，虚拟化算法本身由库负责，不在契约范围内。
 */
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (index: number) => number }) => {
    let start = 0;
    const virtualItems = [];
    for (let i = 0; i < opts.count; i++) {
      const size = opts.estimateSize(i);
      virtualItems.push({ key: i, index: i, start, size });
      start += size;
    }
    return {
      getTotalSize: () => start,
      getVirtualItems: () => virtualItems,
      measureElement: () => undefined,
    };
  },
}));

// ── 测试数据 ──────────────────────────────────────────────────
function makeItem(over: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
  return {
    id: 'qq-1',
    title: '夜空中最亮的星',
    artist: '逃跑计划',
    album: '世界',
    coverUrl: '',
    duration: 251,
    sources: [{ platform: 'qq', trackId: 't1', hasCopyright: true, url: 'https://x/1.mp3' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
    likedPlatforms: ['qq'],
    ...over,
  };
}

function makeLibrary(items: UnifiedSearchItem[]) {
  return {
    items,
    sources: [{ provider: 'qq' as const, count: items.length }],
    importedAt: 1700000000000,
  };
}

beforeEach(() => {
  // 本地缓存（localStorage）会影响首帧 loading/空态，这里每次清干净，
  // 保证「首帧无缓存 → 显示骨架」这条路径可复现。
  localStorage.clear();
  mocks.getLibrary.mockReset();
  mocks.importLibrary.mockReset();
});

describe('LikedLibraryModal · 加载与主路径', () => {
  it('挂载即拉库；请求未回来时显示加载骨架', async () => {
    mocks.getLibrary.mockReturnValue(new Promise(() => {}));
    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);

    expect(mocks.getLibrary).toHaveBeenCalledTimes(1);
    // aria-busy 是给读屏用户的「正在加载」信号
    expect(screen.getByRole('list', { busy: true })).toBeInTheDocument();
    expect(screen.queryByText('还没有导入任何红心歌曲')).not.toBeInTheDocument();
  });

  it('拉到数据后渲染歌名 / 歌手·专辑 / 时长 / 平台角标 / 总数', async () => {
    const items = [makeItem()];
    mocks.getLibrary.mockResolvedValue(makeLibrary(items));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);

    expect(await screen.findByText('夜空中最亮的星')).toBeInTheDocument();
    expect(screen.getByText('逃跑计划')).toBeInTheDocument();
    expect(screen.getByText(/世界/)).toBeInTheDocument();
    expect(screen.getByLabelText('时长 4:11')).toBeInTheDocument();
    // 平台角标统计
    expect(screen.getByTitle('QQ 音乐 1 首')).toBeInTheDocument();
    expect(screen.getByText('共 1 首')).toBeInTheDocument();
    // 加载骨架已经撤掉
    expect(screen.queryByRole('list', { busy: true })).not.toBeInTheDocument();
  });
});

describe('LikedLibraryModal · 空态与错误态', () => {
  it('getLibrary 返回 null（还没导入过）→ 空态提示 +「现在导入」按钮', async () => {
    mocks.getLibrary.mockResolvedValue(null);

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);

    expect(await screen.findByText('还没有导入任何红心歌曲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '现在导入' })).toBeInTheDocument();
    // 空态不该出现搜索框（没什么可搜）
    expect(screen.queryByPlaceholderText('搜索歌名或歌手…')).not.toBeInTheDocument();
  });

  it('getLibrary 抛错 → 显示错误文案（不是白屏）', async () => {
    mocks.getLibrary.mockRejectedValue(new Error('网络开小差了'));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);

    expect(await screen.findByText(/网络开小差了/)).toBeInTheDocument();
    // 出错时不再显示「还没有导入」的空态，避免误导
    expect(screen.queryByText('还没有导入任何红心歌曲')).not.toBeInTheDocument();
  });
});

describe('LikedLibraryModal · 搜索', () => {
  it('输入关键字后只留下匹配的曲目', async () => {
    const items = [
      makeItem({ id: 'a', title: '夜空中最亮的星' }),
      makeItem({ id: 'b', title: '平凡之路', artist: '朴树', album: '猎户星座' }),
    ];
    mocks.getLibrary.mockResolvedValue(makeLibrary(items));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    fireEvent.change(screen.getByPlaceholderText('搜索歌名或歌手…'), {
      target: { value: '朴树' },
    });

    await waitFor(() => expect(screen.queryByText('夜空中最亮的星')).not.toBeInTheDocument());
    expect(screen.getByText('平凡之路')).toBeInTheDocument();
    expect(screen.getByText('共 1 首')).toBeInTheDocument();
  });

  it('搜索无结果时明确提示「未找到匹配「x」的歌曲」', async () => {
    mocks.getLibrary.mockResolvedValue(makeLibrary([makeItem()]));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    fireEvent.change(screen.getByPlaceholderText('搜索歌名或歌手…'), {
      target: { value: '不存在的歌' },
    });

    expect(await screen.findByText('未找到匹配「不存在的歌」的歌曲')).toBeInTheDocument();
  });

  it('点「清除搜索」恢复全部曲目', async () => {
    const items = [
      makeItem({ id: 'a', title: '夜空中最亮的星' }),
      makeItem({ id: 'b', title: '平凡之路', artist: '朴树', album: '猎户星座' }),
    ];
    mocks.getLibrary.mockResolvedValue(makeLibrary(items));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    const input = screen.getByPlaceholderText('搜索歌名或歌手…');
    fireEvent.change(input, { target: { value: '朴树' } });
    await waitFor(() => expect(screen.queryByText('夜空中最亮的星')).not.toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('清除搜索'));

    await waitFor(() => expect(screen.getByText('夜空中最亮的星')).toBeInTheDocument());
    expect(input).toHaveValue('');
  });
});

describe('LikedLibraryModal · 交互', () => {
  it('点曲目行 → onPlay 收到整库 items 与该曲下标', async () => {
    const items = [
      makeItem({ id: 'a', title: '夜空中最亮的星' }),
      makeItem({ id: 'b', title: '平凡之路', artist: '朴树', album: '猎户星座' }),
    ];
    mocks.getLibrary.mockResolvedValue(makeLibrary(items));
    const onPlay = vi.fn();

    render(<LikedLibraryModal onClose={() => {}} onPlay={onPlay} />);
    await screen.findByText('平凡之路');

    fireEvent.click(screen.getByText('平凡之路'));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(items, 1);
  });

  it('空态点「现在导入」→ 调 importLibrary，成功后渲染导入结果并回调 onImportSettled', async () => {
    mocks.getLibrary.mockResolvedValue(null);
    const imported = makeLibrary([makeItem({ id: 'new', title: '导入进来的歌' })]);
    mocks.importLibrary.mockResolvedValue(imported);
    const onImportSettled = vi.fn();

    render(
      <LikedLibraryModal onClose={() => {}} onPlay={() => {}} onImportSettled={onImportSettled} />,
    );
    await screen.findByText('还没有导入任何红心歌曲');

    fireEvent.click(screen.getByRole('button', { name: '现在导入' }));

    expect(await screen.findByText('导入进来的歌')).toBeInTheDocument();
    expect(mocks.importLibrary).toHaveBeenCalledTimes(1);
    expect(onImportSettled).toHaveBeenCalledWith(1);
  });

  it('重新导入进行中：按钮文案变「重新导入中…」且 disabled', async () => {
    mocks.getLibrary.mockResolvedValue(makeLibrary([makeItem()]));
    mocks.importLibrary.mockReturnValue(new Promise(() => {}));

    render(<LikedLibraryModal onClose={() => {}} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    fireEvent.click(screen.getByRole('button', { name: '🔄 重新导入' }));

    const btn = await screen.findByRole('button', { name: '重新导入中…' });
    expect(btn).toBeDisabled();
    // 重新导入中给一层遮罩提示，用户知道后台正在同步
    expect(screen.getByText('正在重新导入喜欢的歌曲…')).toBeInTheDocument();
  });

  it('点关闭按钮 → onClose', async () => {
    mocks.getLibrary.mockResolvedValue(makeLibrary([makeItem()]));
    const onClose = vi.fn();

    render(<LikedLibraryModal onClose={onClose} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    fireEvent.click(screen.getByLabelText('关闭'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('按 ESC → onClose', async () => {
    mocks.getLibrary.mockResolvedValue(makeLibrary([makeItem()]));
    const onClose = vi.fn();

    render(<LikedLibraryModal onClose={onClose} onPlay={() => {}} />);
    await screen.findByText('夜空中最亮的星');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('LikedLibraryModal · 同歌多平台版本', () => {
  it('折叠时只显示一行；展开后出现子行，点子行 → onPlay 对应下标', async () => {
    const items = [
      makeItem({ id: 'a', likedPlatforms: ['qq'] }),
      makeItem({ id: 'b', likedPlatforms: ['netease'] }),
    ];
    mocks.getLibrary.mockResolvedValue(makeLibrary(items));
    const onPlay = vi.fn();

    render(<LikedLibraryModal onClose={() => {}} onPlay={onPlay} />);
    await screen.findByText('共 1 首');

    // 折叠：一个标题 → 一行
    expect(screen.getAllByText('夜空中最亮的星')).toHaveLength(1);

    const toggle = screen.getByRole('button', { name: '展开各平台版本' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    // 展开：组行 + 每个成员一行（2 个成员）→ 3 个同名标题
    await waitFor(() => expect(screen.getAllByText('夜空中最亮的星')).toHaveLength(3));
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');

    // 点子行（最后一个同名元素 = 第二个成员）→ 播第二首
    fireEvent.click(screen.getAllByText('夜空中最亮的星')[2]);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(items, 1);
  });
});
