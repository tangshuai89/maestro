/**
 * NLPlaylistModal.test.tsx — 自然语言生成歌单弹窗。
 *
 * 行为契约：
 *  1. open=false 不渲染内容；open=true 渲染标题「✨ NL 歌单」+ 说明文案
 *  2. 空文本时「生成队列」disabled；输入后 enabled，并显示字数计数
 *  3. 点示例 prompt → 输入框被填成该示例
 *  4. 点「生成队列」→ 先 parseIntent(text) 再 runReco(intent)，成功后渲染意图摘要 + 队列曲目
 *  5. 生成中：按钮文案变「生成中…」且 disabled
 *  6. parseIntent 普通失败 → role=alert 显示服务端错误文案
 *  7. parseIntent 失败且 status=428（没配 DeepSeek key）→ 调 onNeedKey 并显示错误
 *  8. runReco 失败 → 显示错误文案
 *  9. 覆盖模式 + 当前队列非空 → 点「▶ 播放」先弹「替换当前队列？」确认框，确认后 onPlay(items, 0)
 * 10. 追加模式 → 点「▶ 播放」直接 onAppendQueue(items)
 * 11. 点「保存为歌单」→ 二次弹窗；填名后点「保存」→ createPlaylist(name, tracks, prompt, source='nl')
 * 12. 「我的歌单」区渲染已有歌单；点「删除」→ deletePlaylist(id)
 * 13. 点「关闭」→ onClose
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { NLPlaylistModal } from './NLPlaylistModal';
import type { UnifiedSearchItem } from '../../api';

// ── mocks ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  parseIntent: vi.fn(),
  runReco: vi.fn(),
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  patchPlaylist: vi.fn(),
}));

vi.mock('../../api', async () => {
  // importActual 保留真常量（parseRemotePlaylistInput 之类的纯函数），
  // 只把会发请求的函数换成 mock。
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    parseIntent: mocks.parseIntent,
    runReco: mocks.runReco,
    listPlaylists: mocks.listPlaylists,
    createPlaylist: mocks.createPlaylist,
    deletePlaylist: mocks.deletePlaylist,
    patchPlaylist: mocks.patchPlaylist,
  };
});

// ── 测试数据 ──────────────────────────────────────────────────
const PARSED_INTENT = {
  mood: '夜跑',
  genres: ['电子', '舞曲'],
  tempo: 'fast' as const,
  language: 'zh' as const,
  similar_artists: [],
  similar_tracks: [],
  exclude_artists: [],
  exclude_genres: [],
  target_count: 2,
  rationale: '适合夜跑的快节奏电子乐',
};

function makeItem(over: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
  return {
    id: 'a1',
    title: '夜空中最亮的星',
    artist: '逃跑计划',
    album: '世界',
    coverUrl: '',
    duration: 251,
    sources: [{ platform: 'qq', trackId: 't1', hasCopyright: true, url: 'https://x/1.mp3' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
    ...over,
  };
}

const ITEMS = [makeItem(), makeItem({ id: 'a2', title: '平凡之路', artist: '朴树' })];

beforeEach(() => {
  mocks.listPlaylists.mockResolvedValue([]);
  mocks.createPlaylist.mockResolvedValue({
    id: 'p-new',
    name: 'NL 歌单',
    tracks: ITEMS,
    source: 'nl',
    createdAt: 1,
    updatedAt: 1,
  });
  mocks.deletePlaylist.mockResolvedValue({ ok: true });
  mocks.patchPlaylist.mockResolvedValue({});
});

describe('NLPlaylistModal · 打开与输入', () => {
  it('open=false 时不渲染任何弹窗内容', () => {
    render(<NLPlaylistModal open={false} onClose={() => {}} onPlay={() => {}} />);
    expect(screen.queryByText('✨ NL 歌单')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('open=true 时渲染标题与说明文案', () => {
    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    expect(screen.getByText('✨ NL 歌单')).toBeInTheDocument();
    expect(screen.getByText(/说一句话，DeepSeek 解析意图/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('例：放点适合夜跑的电子乐')).toBeInTheDocument();
  });

  it('空文本时「生成队列」disabled；输入后 enabled，并显示字数计数', () => {
    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);

    const generate = screen.getByRole('button', { name: '生成队列' });
    expect(generate).toBeDisabled();
    expect(screen.getByText('0/500')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点爵士' },
    });

    expect(generate).toBeEnabled();
    // '放点爵士' 是 4 个字 → 计数显示 4/500
    expect(screen.getByText('4/500')).toBeInTheDocument();
  });

  it('点示例 prompt → 输入框被填成该示例', () => {
    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '周末慵懒的中文民谣' }));

    expect(screen.getByPlaceholderText('例：放点适合夜跑的电子乐')).toHaveValue(
      '周末慵懒的中文民谣',
    );
  });
});

describe('NLPlaylistModal · 生成队列', () => {
  it('点「生成队列」→ 先 parseIntent 再 runReco，成功后渲染意图摘要 + 曲目列表', async () => {
    mocks.parseIntent.mockResolvedValue({ intent: PARSED_INTENT });
    mocks.runReco.mockResolvedValue({ items: ITEMS, model: 'deepseek', runAt: 1 });

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));

    expect(await screen.findByText('我理解的意图')).toBeInTheDocument();
    expect(screen.getByText('适合夜跑的快节奏电子乐')).toBeInTheDocument();
    expect(screen.getByText('夜跑')).toBeInTheDocument();
    expect(screen.getByText('电子、舞曲')).toBeInTheDocument();
    expect(screen.getByText('生成的队列（2 首）')).toBeInTheDocument();
    expect(screen.getByText('1. 夜空中最亮的星 — 逃跑计划')).toBeInTheDocument();

    expect(mocks.parseIntent).toHaveBeenCalledWith('放点夜跑的电子乐');
    expect(mocks.runReco).toHaveBeenCalledWith({ intent: PARSED_INTENT });
  });

  it('生成中：按钮文案变「生成中…」且 disabled', () => {
    mocks.parseIntent.mockReturnValue(new Promise(() => {}));

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));

    const btn = screen.getByRole('button', { name: '生成中…' });
    expect(btn).toBeDisabled();
  });

  it('parseIntent 普通失败 → 显示服务端错误文案', async () => {
    mocks.parseIntent.mockRejectedValue({ status: 500, message: '解析服务开小差了' });

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('解析服务开小差了');
    expect(mocks.runReco).not.toHaveBeenCalled();
  });

  it('parseIntent 失败且 status=428（没配 DeepSeek key）→ 调 onNeedKey 并显示错误', async () => {
    mocks.parseIntent.mockRejectedValue({ status: 428, message: '尚未配置 DeepSeek API Key' });
    const onNeedKey = vi.fn();

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} onNeedKey={onNeedKey} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('尚未配置 DeepSeek API Key');
    expect(onNeedKey).toHaveBeenCalledTimes(1);
  });

  it('runReco 失败 → 显示错误文案', async () => {
    mocks.parseIntent.mockResolvedValue({ intent: PARSED_INTENT });
    mocks.runReco.mockRejectedValue({ status: 502, message: '推荐服务超时' });

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('推荐服务超时');
  });
});

describe('NLPlaylistModal · 播放队列', () => {
  async function renderWithItems(
    props: Partial<React.ComponentProps<typeof NLPlaylistModal>> = {},
  ) {
    mocks.parseIntent.mockResolvedValue({ intent: PARSED_INTENT });
    mocks.runReco.mockResolvedValue({ items: ITEMS, model: 'deepseek', runAt: 1 });
    const onPlay = props.onPlay ?? vi.fn();
    render(
      <NLPlaylistModal open onClose={props.onClose ?? (() => {})} onPlay={onPlay} {...props} />,
    );
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));
    await screen.findByText('生成的队列（2 首）');
    return { onPlay };
  }

  it('覆盖模式且当前队列非空 → 点「▶ 播放」先弹确认框，确认后 onPlay(items, 0)', async () => {
    const onPlay = vi.fn();
    await renderWithItems({ onPlay, queueLength: 5 });

    fireEvent.click(screen.getByRole('button', { name: '▶ 播放' }));

    const confirm = await screen.findByRole('dialog', { name: '替换当前队列？' });
    expect(confirm).toHaveTextContent('播放将清空当前队列（5 首）');
    // 还没确认前不能播
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: '替换并播放' }));

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(ITEMS, 0);
  });

  it('确认框点「取消」→ 不播放', async () => {
    const onPlay = vi.fn();
    await renderWithItems({ onPlay, queueLength: 5 });

    fireEvent.click(screen.getByRole('button', { name: '▶ 播放' }));
    const confirm = await screen.findByRole('dialog', { name: '替换当前队列？' });
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));

    expect(onPlay).not.toHaveBeenCalled();
  });

  it('当前队列为空 → 点「▶ 播放」直接播放，不弹确认框', async () => {
    const onPlay = vi.fn();
    await renderWithItems({ onPlay, queueLength: 0 });

    fireEvent.click(screen.getByRole('button', { name: '▶ 播放' }));

    expect(onPlay).toHaveBeenCalledWith(ITEMS, 0);
    expect(screen.queryByText('替换当前队列？')).not.toBeInTheDocument();
  });

  it('追加模式 → 点「▶ 播放」走 onAppendQueue，不弹确认框', async () => {
    const onPlay = vi.fn();
    const onAppendQueue = vi.fn();
    await renderWithItems({ onPlay, onAppendQueue, queueLength: 5 });

    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    fireEvent.click(screen.getByRole('button', { name: '▶ 播放' }));

    expect(onAppendQueue).toHaveBeenCalledWith(ITEMS);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByText('替换当前队列？')).not.toBeInTheDocument();
  });
});

describe('NLPlaylistModal · 本地歌单', () => {
  it('点「保存为歌单」→ 二次弹窗；填名后点「保存」→ createPlaylist', async () => {
    mocks.parseIntent.mockResolvedValue({ intent: PARSED_INTENT });
    mocks.runReco.mockResolvedValue({ items: ITEMS, model: 'deepseek', runAt: 1 });

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('例：放点适合夜跑的电子乐'), {
      target: { value: '放点夜跑的电子乐' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成队列' }));
    await screen.findByText('生成的队列（2 首）');

    fireEvent.click(screen.getByRole('button', { name: '保存为歌单' }));

    const saveDialog = await screen.findByRole('dialog', { name: '保存为歌单' });
    const nameInput = within(saveDialog).getByPlaceholderText('歌单名（≤ 60 字）');
    fireEvent.change(nameInput, { target: { value: '夜跑歌单' } });
    fireEvent.click(within(saveDialog).getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith({
        name: '夜跑歌单',
        tracks: ITEMS,
        prompt: '放点夜跑的电子乐',
        source: 'nl',
      }),
    );
  });

  it('「我的歌单」区渲染已有歌单；点「删除」→ deletePlaylist(id)', async () => {
    mocks.listPlaylists.mockResolvedValue([
      {
        id: 'p1',
        name: '我的歌单',
        tracks: [ITEMS[0]],
        source: 'nl',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);

    expect(await screen.findByText('我的歌单')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的歌单（1）' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(mocks.deletePlaylist).toHaveBeenCalledWith('p1'));
  });

  it('「我的歌单」区每行有「管理」入口 → 点开歌单管理弹窗（specs/playlist-edit/）', async () => {
    mocks.listPlaylists.mockResolvedValue([
      {
        id: 'p1',
        name: '我的歌单',
        tracks: [ITEMS[0]],
        source: 'nl',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<NLPlaylistModal open onClose={() => {}} onPlay={() => {}} />);

    expect(await screen.findByText('我的歌单')).toBeInTheDocument();
    // 管理入口和删除入口并存 —— 「点歌单名 = 播放」这个既有行为不变
    expect(screen.getByRole('button', { name: '管理' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '管理' }));

    // 管理弹窗打开：标题行显示歌单名 + 曲目
    expect(await screen.findByText('歌单管理')).toBeInTheDocument();
    expect(screen.getByTestId('pm-name')).toHaveTextContent('我的歌单');
  });

  it('在管理弹窗里点「▶ 播放全部」→ 调 onPlay(tracks, 0) + 关掉管理弹窗', async () => {
    // ⚠️ 这条是被**覆盖率 diff 门禁**逼出来的：NL 弹窗把 onPlay 透传给
    // 管理弹窗的那段回调（setManagingId(null) + onPlay(items, index)）
    // 在此之前**从没被执行过** —— 管理弹窗自己的测试用的是它自己的 mock。
    mocks.listPlaylists.mockResolvedValue([
      {
        id: 'p1',
        name: '我的歌单',
        tracks: [ITEMS[0]],
        source: 'nl',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const onPlay = vi.fn();
    render(<NLPlaylistModal open onClose={() => {}} onPlay={onPlay} />);

    await screen.findByText('我的歌单');
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    expect(await screen.findByText('歌单管理')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '▶ 播放全部' }));

    await waitFor(() => expect(onPlay).toHaveBeenCalledWith([ITEMS[0]], 0));
    // 播放了就让开位置（管理弹窗收起）
    await waitFor(() => expect(screen.queryByTestId('pm-name')).not.toBeInTheDocument());
  });
});

describe('NLPlaylistModal · 关闭', () => {
  it('点「关闭」→ onClose', () => {
    const onClose = vi.fn();
    render(<NLPlaylistModal open onClose={onClose} onPlay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
