/**
 * PlaylistManagerModal.test.tsx — 歌单管理弹窗（specs/playlist-edit/）。
 *
 * 对应 spec §验收 1–14。**关键的两条**：
 *  - 「已在歌单」判定必须和 server 去重**同一个 key**（`platform:trackId`，
 *    不是 item.id）—— 否则用户点了「+」，服务端去重掉，症状是「点了没反应」。
 *  - 移除单曲传的是**平台曲目身份**，不是 item.id —— 同一首歌的 QQ 版和
 *    Spotify 版 id 相同，按 id 移除会一次干掉两条。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// 导出按钮会调 URL.createObjectURL + <a download> —— happy-dom 没有
// createObjectURL，必须替掉（否则直接抛错）。
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { PlaylistManagerModal } from './PlaylistManagerModal';
import type { Playlist, UnifiedSearchItem } from '../../api';

// ── mocks ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  searchUnified: vi.fn(),
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    searchUnified: mocks.searchUnified,
  };
});

// ── 测试数据 ──────────────────────────────────────────────────
function makeItem(over: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
  return {
    id: 'norm-key-1',
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

const TRACK_A = makeItem();
const TRACK_B = makeItem({
  id: 'norm-key-2',
  title: '平凡之路',
  artist: '朴树',
  sources: [{ platform: 'netease', trackId: 't2', hasCopyright: true, url: 'https://x/2.mp3' }],
  bestSource: 'netease',
});

function makePlaylist(over: Partial<Playlist> = {}): Playlist {
  return {
    id: 'p1',
    name: '夜跑 Electron',
    tracks: [TRACK_A, TRACK_B],
    source: 'nl',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const ops = {
  rename: vi.fn(),
  append: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  ops.rename.mockReset().mockResolvedValue(undefined);
  ops.append.mockReset().mockResolvedValue(undefined);
  ops.remove.mockReset().mockResolvedValue(undefined);
  mocks.searchUnified
    .mockReset()
    .mockResolvedValue({ q: 'x', total: 0, page: 1, pageSize: 20, items: [] });
});

function renderModal(playlist: Playlist | null = makePlaylist(), onPlay = vi.fn()) {
  const utils = render(
    <PlaylistManagerModal open onClose={() => {}} playlist={playlist} ops={ops} onPlay={onPlay} />,
  );
  return { ...utils, onPlay };
}

describe('PlaylistManagerModal · 展示', () => {
  it('验收 1：打开后显示歌单名', () => {
    renderModal();
    expect(screen.getByTestId('pm-name')).toHaveTextContent('夜跑 Electron');
  });

  it('验收 2：显示曲目列表（序号 / 标题 / 艺术家）', () => {
    renderModal();
    expect(screen.getByText('夜空中最亮的星')).toBeInTheDocument();
    expect(screen.getByText(/逃跑计划/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('验收 12：0 首歌单显示空态文案', () => {
    renderModal(makePlaylist({ tracks: [] }));
    expect(screen.getByText(/这个歌单还没有歌曲/)).toBeInTheDocument();
    expect(screen.queryByText('夜空中最亮的星')).not.toBeInTheDocument();
  });

  it('playlist 为 null → 提示歌单不存在', () => {
    renderModal(null);
    expect(screen.getByText(/歌单不存在或已被删除/)).toBeInTheDocument();
  });

  it('验收 11：点「播放全部」→ onPlay(tracks, 0)', () => {
    const { onPlay } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '▶ 播放全部' }));
    expect(onPlay).toHaveBeenCalledWith([TRACK_A, TRACK_B], 0);
  });
});

describe('PlaylistManagerModal · 导出（specs/playlist-export/）', () => {
  it('点「导出」→ 触发 .txt 下载（文件名 = 歌单名）', () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderModal();
    const btn = screen.getByLabelText('导出歌单');
    fireEvent.click(btn);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const a = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(a.download).toBe('夜跑 Electron.txt');
    clickSpy.mockRestore();
  });

  it('空歌单 → 导出按钮禁用', () => {
    renderModal(makePlaylist({ tracks: [] }));
    expect(screen.getByLabelText('导出歌单')).toBeDisabled();
  });
});

describe('PlaylistManagerModal · 改名', () => {
  it('验收 3：点 ✎ → 输入 → Enter → 提交新名', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '夜跑 II' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(ops.rename).toHaveBeenCalledWith('p1', '夜跑 II'));
  });

  it('验收 4b：ESC 取消改名 → **不关掉整个弹窗**（Radix 在 document 层监听 Escape）', () => {
    const onClose = vi.fn();
    render(
      <PlaylistManagerModal
        open
        onClose={onClose}
        playlist={makePlaylist()}
        ops={ops}
        onPlay={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '不该保存' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(ops.rename).not.toHaveBeenCalled();
    // 不拦住冒泡的话，ESC 会「取消改名」+「关掉弹窗」一起发生
    expect(onClose).not.toHaveBeenCalled();
  });

  it('验收 4：Esc 取消 → 不发请求', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '不該保存' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(ops.rename).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-name')).toHaveTextContent('夜跑 Electron');
  });

  it('验收 5a：空名 → 报错且不提交', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(ops.rename).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('歌单名不能为空');
  });

  it('验收 5b：超 60 字 → 报错且不提交', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: 'x'.repeat(61) } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(ops.rename).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/不能超过 60 字/);
  });

  it('验收 6：改名失败 → 显示服务端原文，不改标题', async () => {
    ops.rename.mockRejectedValue(new Error('名字已被占用'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));

    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '夜跑 II' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('名字已被占用'));
    // 失败时**保持编辑态**（让用户能直接改），输入框还在、值没丢
    expect(screen.getByLabelText('歌单名')).toHaveValue('夜跑 II');
  });

  it('名字没改 → 不发请求', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '重命名歌单' }));
    const input = screen.getByLabelText('歌单名');
    fireEvent.change(input, { target: { value: '夜跑 Electron' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ops.rename).not.toHaveBeenCalled();
  });
});

describe('PlaylistManagerModal · 移除单曲', () => {
  it('验收 6：点 × → 传**平台曲目身份**（platform:trackId），不是 item.id', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '从歌单移除 夜空中最亮的星' }));
    await waitFor(() => expect(ops.remove).toHaveBeenCalledWith('p1', ['qq:t1']));
    // 关键：不是 item.id（'norm-key-1'）
    expect(ops.remove).not.toHaveBeenCalledWith('p1', ['norm-key-1']);
  });

  it('第二条曲目的身份也用 platform:trackId', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '从歌单移除 平凡之路' }));
    await waitFor(() => expect(ops.remove).toHaveBeenCalledWith('p1', ['netease:t2']));
  });

  it('验收 7：移除失败 → 错误条提示', async () => {
    ops.remove.mockRejectedValue(new Error('歌单已被删除'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '从歌单移除 夜空中最亮的星' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('歌单已被删除'));
  });
});

describe('PlaylistManagerModal · 添加歌曲', () => {
  const NEW_ITEM = makeItem({
    id: 'norm-key-3',
    title: 'Animal',
    artist: 'Kygo',
    sources: [{ platform: 'deezer', trackId: 't9', hasCopyright: true, url: 'https://x/9.mp3' }],
    bestSource: 'deezer',
  });

  it('展开「+ 添加歌曲」→ 输入 → 搜索 → 出结果', async () => {
    mocks.searchUnified.mockResolvedValue({
      q: 'animal',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [NEW_ITEM],
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ 添加歌曲' }));

    const input = screen.getByLabelText('搜索要添加的歌曲');
    fireEvent.change(input, { target: { value: 'animal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mocks.searchUnified).toHaveBeenCalledWith('animal'));
    expect(await screen.findByText(/Animal/)).toBeInTheDocument();
  });

  it('验收 8：点「+ 加」→ append 一首', async () => {
    mocks.searchUnified.mockResolvedValue({
      q: 'animal',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [NEW_ITEM],
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ 添加歌曲' }));
    const input = screen.getByLabelText('搜索要添加的歌曲');
    fireEvent.change(input, { target: { value: 'animal' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const addBtn = await screen.findByRole('button', { name: '添加到歌单 Animal' });
    fireEvent.click(addBtn);
    await waitFor(() => expect(ops.append).toHaveBeenCalledWith('p1', [NEW_ITEM]));
  });

  it('验收 9/10：已在歌单的歌 → 显示「已在歌单」，没有「+ 加」按钮', async () => {
    // id 不同但**首个音源相同** → 和 server 去重是同一首 → 必须判为「已在歌单」
    const sameSongDifferentId = makeItem({ id: 'norm-key-999' });
    mocks.searchUnified.mockResolvedValue({
      q: 'x',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [sameSongDifferentId],
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ 添加歌曲' }));
    const input = screen.getByLabelText('搜索要添加的歌曲');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByTestId('pm-in-list')).toHaveTextContent('已在歌单');
    expect(
      screen.queryByRole('button', { name: '添加到歌单 夜空中最亮的星' }),
    ).not.toBeInTheDocument();
  });

  it('搜索失败 → 显示错误', async () => {
    mocks.searchUnified.mockRejectedValue(new Error('搜索服务不可用'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ 添加歌曲' }));
    const input = screen.getByLabelText('搜索要添加的歌曲');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('搜索服务不可用'));
  });

  it('添加失败 → 显示错误', async () => {
    ops.append.mockRejectedValue(new Error('歌单已满'));
    mocks.searchUnified.mockResolvedValue({
      q: 'x',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [NEW_ITEM],
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '+ 添加歌曲' }));
    const input = screen.getByLabelText('搜索要添加的歌曲');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const addBtn = await screen.findByRole('button', { name: '添加到歌单 Animal' });
    fireEvent.click(addBtn);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('歌单已满'));
  });
});
