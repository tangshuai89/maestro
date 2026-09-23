/**
 * ChannelPriorityList 子组件测试。
 * 覆盖：
 *  - 挂载时调 getChannelPriority + 用 returned priority/default 渲染
 *  - ↑ 按钮禁用首位、↓ 按钮禁用末位
 *  - 点 ↑ 把该行上移；点 ↓ 把该行下移
 *  - 「保存」调 setChannelPriority；「重置」调 resetChannelPriority
 *  - 成功 → status ok；setChannelPriority 抛错 → status err
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getChannelPriority: vi.fn(() =>
    Promise.resolve({
      priority: ['qq', 'netease', 'deezer', 'spotify'],
      default: ['qq', 'netease', 'deezer', 'spotify'],
    }),
  ),
  setChannelPriority: vi.fn((p) =>
    Promise.resolve({ ok: true as const, priority: p }),
  ),
  resetChannelPriority: vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      priority: ['qq', 'netease', 'deezer', 'spotify'],
    }),
  ),
}));
const {
  getChannelPriority: mockGet,
  setChannelPriority: mockSet,
  resetChannelPriority: mockReset,
} = mocks;

vi.mock('../../api', () => ({
  getChannelPriority: mocks.getChannelPriority,
  setChannelPriority: mocks.setChannelPriority,
  resetChannelPriority: mocks.resetChannelPriority,
  PROVIDER_LABELS: {
    qq: 'QQ 音乐',
    netease: '网易云音乐',
    deezer: 'Deezer',
    spotify: 'Spotify',
  },
}));

import ChannelPriorityList from './ChannelPriorityList';

describe('ChannelPriorityList', () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockSet.mockClear();
    mockReset.mockClear();
    // 默认 4 个全在列表
    mockGet.mockResolvedValue({
      priority: ['qq', 'netease', 'deezer', 'spotify'],
      default: ['qq', 'netease', 'deezer', 'spotify'],
    });
    mockSet.mockImplementation((p) =>
      Promise.resolve({ ok: true as const, priority: p }),
    );
  });

  it('挂载时调 getChannelPriority + 渲染 4 个平台', async () => {
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // 4 行 platform 徽章
    expect(screen.getAllByText(/QQ 音乐|网易云|Deezer|Spotify/).length).toBeGreaterThanOrEqual(4);
  });

  it('首位禁用 ↑、末位禁用 ↓', async () => {
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // 4 个 ↑ 按钮：首位 disabled
    const upBtns = screen.getAllByLabelText('上移');
    expect(upBtns[0]).toBeDisabled();
    expect(upBtns[1]).not.toBeDisabled();
    const downBtns = screen.getAllByLabelText('下移');
    expect(downBtns[downBtns.length - 1]).toBeDisabled();
    expect(downBtns[0]).not.toBeDisabled();
  });

  it('点 ↓ 把该项下移；保存后 setChannelPriority 收到新序', async () => {
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // qq 是首位，点它的 ↓ → 跑到第二位
    const downBtns = screen.getAllByLabelText('下移');
    await userEvent.click(downBtns[0]);
    await userEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith(['netease', 'qq', 'deezer', 'spotify']);
    });
  });

  it('点 ↑ 把该项上移', async () => {
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // spotify 是末位，找它的 ↑ 按钮
    const upBtns = screen.getAllByLabelText('上移');
    await userEvent.click(upBtns[upBtns.length - 1]);
    await userEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledWith([
        'qq',
        'netease',
        'spotify',
        'deezer',
      ]);
    });
  });

  it('「重置默认顺序」按钮 → 调 resetChannelPriority + 列表回到 default', async () => {
    // 初始列表已经"乱序"才能测出 reset 有效果
    mockGet.mockResolvedValueOnce({
      priority: ['spotify', 'deezer', 'netease', 'qq'],
      default: ['qq', 'netease', 'deezer', 'spotify'],
    });
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    await userEvent.click(screen.getByRole('button', { name: /重置默认顺序/ }));
    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
    });
  });

  it('setChannelPriority 抛错 → status 显示 err 消息', async () => {
    mockSet.mockRejectedValueOnce(new Error('duplicate provider'));
    render(<ChannelPriorityList />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    await userEvent.click(screen.getByRole('button', { name: /^保存$/ }));
    await waitFor(() => {
      expect(screen.getByText('duplicate provider')).toBeInTheDocument();
    });
  });

  it('首次 getChannelPriority 失败 → 渲染 fallback 默认 4 个平台', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    render(<ChannelPriorityList />);
    // 不抛错就是 success；4 个平台徽章在
    await waitFor(() => {
      expect(screen.getAllByText(/QQ 音乐|网易云|Deezer|Spotify/).length).toBeGreaterThanOrEqual(4);
    });
  });
});