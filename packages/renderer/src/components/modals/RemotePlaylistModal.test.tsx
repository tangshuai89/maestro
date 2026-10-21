/**
 * RemotePlaylistModal.test.tsx — 远端歌单导入弹窗（此前 0% 覆盖）。
 *
 * 契约（specs/remote-playlist §Phase 5）：
 *  1. open=false → 不渲染；open=true → 渲染标题与输入框
 *  2. 输入被解析出来 → 提示「识别为 XX · id N」；认不出 → 提示语；空 → 另一条提示
 *  3. Spotify → 「尚未接入」提示 + 「读取」按钮禁用
 *  4. 「读取」→ getRemotePlaylist → 显示歌单名 / 首数 / 曲目列表
 *  5. 「▶ 播放全部」→ onClose + onPlay(items, 0)；点某一行 → onPlay(items, i)
 *  6. 「追加到队列」→ onClose + onAppendQueue(items)
 *  7. 「存为本地歌单」→ 展开输入 → 「保存」→ createPlaylist({name, tracks, source:'manual'})
 *  8. 服务端错误 → 翻成能看懂的中文（playlist_not_found / playlist_unsupported /
 *     invalid_playlist_id / not_logged_in）
 *  9. 平台标的首数 > 实际读到的首数 → 额外提示「平台标 N 首」（QQ 会过滤失效歌曲）
 *  10. 私有歌单 → 标注「· 私有」
 *
 * `parseRemotePlaylistInput` 是纯函数，**用真的**（它有自己的测试文件）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getRemotePlaylist: vi.fn(),
  createPlaylist: vi.fn(),
}));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    getRemotePlaylist: mocks.getRemotePlaylist,
    createPlaylist: mocks.createPlaylist,
  };
});

import { RemotePlaylistModal } from './RemotePlaylistModal';
import type { UnifiedSearchItem } from '../../api';

const item = (id: string, title: string, vip = false) =>
  ({
    id,
    title,
    artist: '艺人',
    album: '专辑',
    sources: [{ platform: 'qq', trackId: id, vipLocked: vip }],
  }) as unknown as UnifiedSearchItem;

const playlist = (over: Record<string, unknown> = {}) => ({
  provider: 'qq',
  name: '我的歌单',
  coverUrl: '',
  trackCount: 2,
  private: false,
  ...over,
});

const props = (over: Record<string, unknown> = {}) => ({
  open: true,
  onClose: vi.fn(),
  onPlay: vi.fn(),
  onAppendQueue: vi.fn(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRemotePlaylist.mockResolvedValue({
    playlist: playlist(),
    items: [item('1', '第一首'), item('2', '第二首')],
  });
  mocks.createPlaylist.mockResolvedValue({ id: 'p1', name: 'x', items: [], updatedAt: 0 });
});

describe('RemotePlaylistModal', () => {
  it('open=false → 不渲染内容', () => {
    const { container } = render(<RemotePlaylistModal {...props({ open: false })} />);
    expect(container.textContent).not.toMatch(/从平台歌单导入/);
  });

  it('open=true → 渲染标题 + 输入框', () => {
    render(<RemotePlaylistModal {...props()} />);
    expect(screen.getByText('从平台歌单导入')).toBeInTheDocument();
    expect(screen.getByLabelText('歌单链接或 id')).toBeInTheDocument();
  });

  it('输入被解析出来 → 提示「识别为 XX · id N」', async () => {
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://music.163.com/#/playlist?id=1562085694' },
    });
    await waitFor(() => expect(screen.getByText(/识别为/)).toBeInTheDocument());
    expect(screen.getByText(/网易云/)).toBeInTheDocument();
    expect(screen.getByText(/1562085694/)).toBeInTheDocument();
  });

  it('认不出的链接 → 给「认不出」提示，读取按钮禁用', () => {
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://example.com/whatever' },
    });
    expect(screen.getByText(/认不出这个链接/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取' })).toBeDisabled();
  });

  it('Spotify → 「尚未接入」提示 + 读取按钮禁用', () => {
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' },
    });
    expect(screen.getByText(/Spotify 歌单读取尚未接入/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取' })).toBeDisabled();
    expect(mocks.getRemotePlaylist).not.toHaveBeenCalled();
  });

  it('「读取」→ 拉歌单 → 显示名称 / 首数 / 曲目列表', async () => {
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText('我的歌单')).toBeInTheDocument());
    expect(mocks.getRemotePlaylist).toHaveBeenCalledWith('qq', '8584177317');
    expect(screen.getByText('第一首')).toBeInTheDocument();
    expect(screen.getByText('第二首')).toBeInTheDocument();
    expect(screen.getByText(/2 首/)).toBeInTheDocument();
  });

  it('「▶ 播放全部」→ onClose + onPlay(items, 0)', async () => {
    const p = props();
    render(<RemotePlaylistModal {...p} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /播放全部/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /播放全部/ }));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onPlay).toHaveBeenCalledWith(expect.any(Array), 0);
  });

  it('点曲目行 → onPlay(items, 该行下标)', async () => {
    const p = props();
    render(<RemotePlaylistModal {...p} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText('第二首')).toBeInTheDocument());
    fireEvent.click(screen.getByText('第二首'));
    expect(p.onPlay).toHaveBeenCalledWith(expect.any(Array), 1);
  });

  it('「追加到队列」→ onClose + onAppendQueue(items)', async () => {
    const p = props();
    render(<RemotePlaylistModal {...p} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /追加到队列/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /追加到队列/ }));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onAppendQueue).toHaveBeenCalledWith(expect.any(Array));
  });

  it('没有 onAppendQueue → 不渲染「追加到队列」', async () => {
    const p = props({ onAppendQueue: undefined });
    render(<RemotePlaylistModal {...p} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /播放全部/ })).toBeEnabled());
    expect(screen.queryByRole('button', { name: /追加到队列/ })).toBeNull();
  });

  it('「存为本地歌单」→ 展开输入 → 「保存」→ createPlaylist(source=manual)', async () => {
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /存为本地歌单/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /存为本地歌单/ }));

    const nameInput = screen.getByLabelText('本地歌单名');
    fireEvent.change(nameInput, { target: { value: '  我的收藏  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mocks.createPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({ name: '我的收藏', source: 'manual' }),
      ),
    );
  });

  it('服务端错误 → 翻成中文', async () => {
    mocks.getRemotePlaylist.mockRejectedValue({
      body: { error: 'playlist_not_found' },
      message: 'raw',
    });
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText(/这个歌单不存在/)).toBeInTheDocument());
  });

  it('not_logged_in → 提示先登录', async () => {
    mocks.getRemotePlaylist.mockRejectedValue({ body: { error: 'not_logged_in' } });
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText(/先在设置里登录/)).toBeInTheDocument());
  });

  it('平台标的首数 > 实际读到的 → 额外提示', async () => {
    mocks.getRemotePlaylist.mockResolvedValue({
      playlist: playlist({ trackCount: 10 }),
      items: [item('1', '第一首')],
    });
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText(/平台标 10 首/)).toBeInTheDocument());
  });

  it('私有歌单 → 标注「· 私有」', async () => {
    mocks.getRemotePlaylist.mockResolvedValue({
      playlist: playlist({ private: true }),
      items: [item('1', '第一首')],
    });
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText(/· 私有/)).toBeInTheDocument());
  });

  it('VIP 曲目标 [VIP]', async () => {
    mocks.getRemotePlaylist.mockResolvedValue({
      playlist: playlist(),
      items: [item('1', 'VIP曲', true)],
    });
    render(<RemotePlaylistModal {...props()} />);
    fireEvent.change(screen.getByLabelText('歌单链接或 id'), {
      target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(screen.getByText('[VIP]')).toBeInTheDocument());
  });

  it('输入框回车 → 触发读取', async () => {
    render(<RemotePlaylistModal {...props()} />);
    const input = screen.getByLabelText('歌单链接或 id');
    fireEvent.change(input, { target: { value: 'https://y.qq.com/n/ryqq/playlist/8584177317' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.getRemotePlaylist).toHaveBeenCalled());
  });
});
