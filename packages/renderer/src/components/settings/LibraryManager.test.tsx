/**
 * LibraryManager 子组件测试。
 * 覆盖：
 *  - 挂载时调 getLibrary + 按 platforms 算出 count
 *  - 「清空此平台」按钮 → 调 clearProviderLibrary(p)
 *  - clearProviderLibrary 成功 → status ok + refresh
 *  - 「清空全部库」按钮打开 Modal + 点「确认清空」调 clearAllLibraries
 *  - deezer 不渲染（不是用户库贡献者）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  clearProviderLibrary: vi.fn(),
  clearAllLibraries: vi.fn(),
}));
const {
  getLibrary: mockGet,
  clearProviderLibrary: mockClearOne,
  clearAllLibraries: mockClearAll,
} = mocks;

vi.mock('../../api', () => ({
  getLibrary: mocks.getLibrary,
  clearProviderLibrary: mocks.clearProviderLibrary,
  clearAllLibraries: mocks.clearAllLibraries,
  PROVIDER_LABELS: {
    qq: 'QQ 音乐',
    netease: '网易云音乐',
    deezer: 'Deezer',
    spotify: 'Spotify',
  },
}));

vi.mock('../common/Modal', () => ({
  default: ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
    <div data-testid="modal-mock">
      <button data-testid="modal-close" onClick={onClose}>×</button>
      {children}
    </div>
  ),
}));

import LibraryManager from './LibraryManager';

const sampleLib = {
  items: [
    {
      id: 'qq:1',
      title: 'S1',
      artist: 'A1',
      album: '',
      coverUrl: '',
      duration: 0,
      sources: [{ platform: 'qq' as const, trackId: '1', hasCopyright: true, url: '' }],
      bestSource: 'qq' as const,
      versionType: 'studio' as const,
      versions: [],
    },
    {
      id: 'qq:2',
      title: 'S2',
      artist: 'A1',
      album: '',
      coverUrl: '',
      duration: 0,
      sources: [{ platform: 'qq' as const, trackId: '2', hasCopyright: true, url: '' }],
      bestSource: 'qq' as const,
      versionType: 'studio' as const,
      versions: [],
    },
    {
      id: 'ne:1',
      title: 'N1',
      artist: 'A2',
      album: '',
      coverUrl: '',
      duration: 0,
      sources: [
        { platform: 'netease' as const, trackId: '1', hasCopyright: true, url: '' },
      ],
      bestSource: 'netease' as const,
      versionType: 'studio' as const,
      versions: [],
    },
  ],
  sources: [],
  importedAt: 0,
};

describe('LibraryManager', () => {
  beforeEach(() => {
    mockGet.mockClear();
    mockClearOne.mockClear();
    mockClearAll.mockClear();
    mockGet.mockResolvedValue(sampleLib);
    mockClearOne.mockImplementation(() =>
      Promise.resolve({ ok: true as const, removed: 2 }),
    );
    mockClearAll.mockResolvedValue({ ok: true as const });
  });

  it('挂载时调 getLibrary + 渲染 QQ / 网易云 / Spotify 三行（deezer 不渲染）', async () => {
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    // QQ 2 首 / 网易云 1 首 / Spotify 0 首
    expect(screen.getByText('2 首')).toBeInTheDocument();
    expect(screen.getByText('1 首')).toBeInTheDocument();
    expect(screen.getByText('0 首')).toBeInTheDocument();
    // Deezer 行不应在（不会清空 deezer）
    expect(screen.getAllByRole('button', { name: /清空此平台/ })).toHaveLength(3);
  });

  it('「清空此平台」按钮 → 调 clearProviderLibrary(provider)', async () => {
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    const btns = screen.getAllByRole('button', { name: /清空此平台/ });
    // 第 1 个是 QQ（2 首非 0 → 可点）
    await userEvent.click(btns[0]);
    await waitFor(() => {
      expect(mockClearOne).toHaveBeenCalledWith('qq');
    });
  });

  it('clearProviderLibrary 成功 → status 显示「已清除 N 项」', async () => {
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    const btns = screen.getAllByRole('button', { name: /清空此平台/ });
    await userEvent.click(btns[0]);
    await waitFor(() => {
      expect(screen.getByText(/已清除 2 项.*QQ 音乐/)).toBeInTheDocument();
    });
  });

  it('「清空全部库」→ 打开 Modal → 「确认清空」调 clearAllLibraries', async () => {
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    await userEvent.click(screen.getByRole('button', { name: /^清空全部库$/ }));
    // Modal 出现
    await waitFor(() => {
      expect(screen.getByTestId('modal-mock')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /确认清空/ }));
    await waitFor(() => {
      expect(mockClearAll).toHaveBeenCalled();
    });
  });

  it('「清空全部库」Modal 里点「取消」不调 clearAllLibraries', async () => {
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    await userEvent.click(screen.getByRole('button', { name: /^清空全部库$/ }));
    await waitFor(() => {
      expect(screen.getByTestId('modal-mock')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    expect(mockClearAll).not.toHaveBeenCalled();
  });

  it('空库 → 「清空全部库」按钮 disabled', async () => {
    mockGet.mockResolvedValue({ ...sampleLib, items: [] });
    render(<LibraryManager />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: /^清空全部库$/ })).toBeDisabled();
  });

  it('getLibrary 返回 null（未导入过）→ 「清空全部库」按钮 disabled', async () => {
    mockGet.mockResolvedValue(null);
    render(<LibraryManager />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^清空全部库$/ })).toBeDisabled();
    });
  });
});