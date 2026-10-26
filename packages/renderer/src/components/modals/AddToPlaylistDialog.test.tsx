/**
 * AddToPlaylistDialog.test.tsx — 「加到歌单」选择器（specs/playlist-add-from-search/）。
 *
 * 核心契约：
 *  - 「已在歌单」判定与服务端追加去重**用同一个 key**（`platform:trackId`）——
 *    客户端按 `id` 判会和服务端不一致 ⇒ 用户点了「+ 加入」却什么都没发生。
 *  - 成功后要给出**明确的反馈**（进了哪个歌单），不能静默关窗。
 *  - 没有歌单时给空态引导（新建），不是空白。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { AddToPlaylistDialog } from './AddToPlaylistDialog';
import type { UnifiedSearchItem } from '../../api';

// ── mocks ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  patchPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    listPlaylists: mocks.listPlaylists,
    createPlaylist: mocks.createPlaylist,
    patchPlaylist: mocks.patchPlaylist,
    deletePlaylist: mocks.deletePlaylist,
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

const TRACK = makeItem();

/** 歌单里**另一首**（平台曲目身份跟 TRACK 不同） */
const OTHER_TRACK = makeItem({
  id: 'other',
  title: '别的歌',
  sources: [{ platform: 'netease', trackId: 't9', hasCopyright: true, url: 'https://x/9.mp3' }],
  bestSource: 'netease',
});

const PL_1 = {
  id: 'p1',
  name: '夜跑 Electron',
  tracks: [OTHER_TRACK],
  source: 'nl' as const,
  createdAt: 1,
  updatedAt: 1,
};

/** 里面**已经有**这一首（同一个 platform:trackId `qq:t1`，但 item.id 不同） */
const PL_HAS = {
  id: 'p2',
  name: '已有那首',
  tracks: [makeItem({ id: 'norm-key-999' })],
  source: 'nl' as const,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  mocks.listPlaylists.mockReset().mockResolvedValue([PL_1, PL_HAS]);
  mocks.createPlaylist
    .mockReset()
    .mockImplementation(async (body: { name: string; tracks: UnifiedSearchItem[] }) => ({
      id: 'p-new',
      name: body.name,
      tracks: body.tracks,
      source: 'manual' as const,
      createdAt: 1,
      updatedAt: 1,
    }));
  mocks.patchPlaylist.mockReset().mockResolvedValue({
    id: 'p1',
    name: '夜跑 Electron',
    tracks: [PL_1.tracks[0], TRACK],
    source: 'nl',
    createdAt: 1,
    updatedAt: 1,
  });
  mocks.deletePlaylist.mockReset().mockResolvedValue({ ok: true });
});

function renderDialog(track: UnifiedSearchItem | null = TRACK) {
  return render(<AddToPlaylistDialog open onClose={() => {}} track={track} />);
}

describe('AddToPlaylistDialog · 歌单列表', () => {
  it('打开后显示目标曲目 + 歌单列表（名字 + 首数）', async () => {
    renderDialog();
    expect(screen.getByText('加到歌单')).toBeInTheDocument();
    expect(screen.getByText(/夜空中最亮的星/)).toBeInTheDocument();

    const name = await screen.findByText(/夜跑 Electron/);
    expect(name).toBeInTheDocument();
    // 首数在同一个 <li> 里（两个歌单首数可能相同 → 不能用全局 getByText）
    expect(name.closest('li')?.textContent).toContain('（1）');
  });

  it('一个歌单都没有 → 空态引导新建', async () => {
    mocks.listPlaylists.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText(/还没有歌单/)).toBeInTheDocument();
  });

  it('track 为 null → 提示没有选中的歌曲', () => {
    renderDialog(null);
    expect(screen.getByText('没有选中的歌曲')).toBeInTheDocument();
  });
});

describe('AddToPlaylistDialog · 加入已有歌单', () => {
  it('点「+ 加入」→ 调 patchPlaylist(id, {append:[track]}) + 给出反馈', async () => {
    renderDialog();
    const btn = await screen.findByRole('button', { name: '加入歌单 夜跑 Electron' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(mocks.patchPlaylist).toHaveBeenCalledWith('p1', { append: [TRACK] }),
    );
    expect(await screen.findByText(/已加入「夜跑 Electron」/)).toBeInTheDocument();
  });

  it('已在歌单的那一个 → 显示「已在歌单」，**没有**「+ 加入」按钮', async () => {
    renderDialog();
    // 「已有那首」里已经有一首 platform:trackId 相同、id 不同的歌
    expect(await screen.findByText('已在歌单')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入歌单 已有那首' })).not.toBeInTheDocument();
  });

  it('加入失败 → 显示错误', async () => {
    mocks.patchPlaylist.mockRejectedValue(new Error('歌单已满'));
    renderDialog();
    const btn = await screen.findByRole('button', { name: '加入歌单 夜跑 Electron' });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('歌单已满'));
  });
});

describe('AddToPlaylistDialog · 新建歌单并加入', () => {
  it('点「+ 新建歌单并加入」→ 输入名字 → 创建 → createPlaylist({name, tracks:[track], source:"manual"})', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建歌单并加入' }));

    const input = screen.getByLabelText('新歌单名');
    fireEvent.change(input, { target: { value: '新建的歌单' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith({
        name: '新建的歌单',
        tracks: [TRACK],
        source: 'manual',
      }),
    );
    expect(await screen.findByText(/已加入「新建的歌单」/)).toBeInTheDocument();
  });

  it('名字为空 → 创建按钮 disabled', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建歌单并加入' }));
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('创建失败 → 显示错误', async () => {
    mocks.createPlaylist.mockRejectedValue(new Error('名字已被占用'));
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建歌单并加入' }));
    fireEvent.change(screen.getByLabelText('新歌单名'), { target: { value: '重名' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('名字已被占用'));
  });

  it('新建歌单：按 Enter 提交（不点按钮）', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建歌单并加入' }));

    const input = screen.getByLabelText('新歌单名');
    fireEvent.change(input, { target: { value: 'Enter 建的' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith({
        name: 'Enter 建的',
        tracks: [TRACK],
        source: 'manual',
      }),
    );
  });

  it('关闭后重开 → 状态被重置（新建面板收起、名字不留）', async () => {
    // 这个 effect 只在「组件还挂着、open 从 true 变 false」时才会跑
    //（SearchPanel 那种「关掉就卸载」的用法永远走不到）——
    // 所以必须专门测一次「关 → 开」的循环。
    const { rerender } = render(<AddToPlaylistDialog open onClose={() => {}} track={TRACK} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ 新建歌单并加入' }));
    fireEvent.change(screen.getByLabelText('新歌单名'), { target: { value: '半途而废' } });

    // 关 → 开
    rerender(<AddToPlaylistDialog open={false} onClose={() => {}} track={TRACK} />);
    rerender(<AddToPlaylistDialog open onClose={() => {}} track={TRACK} />);

    // 重开后是干净的：新建面板收起、输入框里的字没了
    expect(screen.getByRole('button', { name: '+ 新建歌单并加入' })).toBeInTheDocument();
    expect(screen.queryByLabelText('新歌单名')).not.toBeInTheDocument();
  });
});
