/**
 * AccountsList 子组件测试。
 * 覆盖：
 *  - 挂载时调 fetchAuthStatusAll + 渲染 4 行平台
 *  - Deezer 行：标「匿名公开电台」、登出按钮 disabled
 *  - 已登录平台：显示 nickname；登出按钮可用
 *  - 未登录平台：登出按钮 disabled
 *  - 点登出 → 调 logout(p) + refresh
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  fetchAuthStatusAll: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));
const { fetchAuthStatusAll: mockAll, logout: mockLogout } = mocks;

vi.mock('../../api', () => ({
  fetchAuthStatusAll: mocks.fetchAuthStatusAll,
  logout: mocks.logout,
  PROVIDER_LABELS: {
    qq: 'QQ 音乐',
    netease: '网易云音乐',
    deezer: 'Deezer',
    spotify: 'Spotify',
  },
}));

import AccountsList from './AccountsList';

const baseStatus = {
  qq: {
    provider: 'qq' as const,
    loggedIn: false,
    user: null,
    lastValidatedAt: null,
  },
  netease: {
    provider: 'netease' as const,
    loggedIn: false,
    user: null,
    lastValidatedAt: null,
  },
  deezer: {
    provider: 'deezer' as const,
    loggedIn: false,
    user: null,
    lastValidatedAt: null,
  },
  spotify: {
    provider: 'spotify' as const,
    loggedIn: false,
    user: null,
    lastValidatedAt: null,
  },
};

describe('AccountsList', () => {
  beforeEach(() => {
    mockAll.mockClear();
    mockLogout.mockClear();
    mockLogout.mockResolvedValue(undefined);
  });

  it('挂载时调 fetchAuthStatusAll + 渲染 4 行平台徽章', async () => {
    mockAll.mockResolvedValue(baseStatus);
    render(<AccountsList />);
    await waitFor(() => {
      expect(mockAll).toHaveBeenCalled();
    });
    expect(screen.getByText(/QQ 音乐/)).toBeInTheDocument();
    expect(screen.getByText(/网易云/)).toBeInTheDocument();
    expect(screen.getByText(/Deezer/)).toBeInTheDocument();
    expect(screen.getByText(/Spotify/)).toBeInTheDocument();
  });

  it('Deezer 行显示「匿名公开电台」+ 登出按钮 disabled', async () => {
    mockAll.mockResolvedValue(baseStatus);
    render(<AccountsList />);
    await waitFor(() => {
      expect(screen.getByText(/匿名公开电台/)).toBeInTheDocument();
    });
    // deezer 的登出按钮 disabled（其它 3 个 enabled，因为未登录也 disabled）
    const logoutBtns = screen.getAllByTitle(/登出|匿名/);
    const deezerBtn = logoutBtns.find((b) =>
      b.textContent === '登出' && (b as HTMLButtonElement).disabled,
    );
    expect(deezerBtn).toBeDefined();
  });

  it('已登录平台显示 nickname + 登出按钮可用', async () => {
    mockAll.mockResolvedValue({
      ...baseStatus,
      qq: {
        provider: 'qq' as const,
        loggedIn: true,
        user: {
          nickname: '张三',
          avatarUrl: 'x',
          provider: 'qq' as const,
        },
        lastValidatedAt: Date.now() - 30_000, // 30 秒前 → "刚刚校验"
      },
    });
    render(<AccountsList />);
    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
    expect(screen.getByText(/刚刚校验/)).toBeInTheDocument();
    // qq 行的登出按钮应该可点
    const logoutBtns = screen.getAllByRole('button', { name: /登出/ });
    const qqBtn = logoutBtns.find((b) => !(b as HTMLButtonElement).disabled);
    expect(qqBtn).toBeDefined();
  });

  it('未登录平台登出按钮 disabled', async () => {
    mockAll.mockResolvedValue(baseStatus);
    render(<AccountsList />);
    await waitFor(() => {
      expect(mockAll).toHaveBeenCalled();
    });
    const logoutBtns = screen.getAllByRole('button', { name: /登出/ });
    // 4 行 → 4 个登出按钮，3 个未登录 disabled，Deezer disabled → 全部 disabled
    expect(logoutBtns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('点登出 → 调 logout(provider) + 之后 status 显示「已登出」', async () => {
    mockAll.mockResolvedValue({
      ...baseStatus,
      spotify: {
        provider: 'spotify' as const,
        loggedIn: true,
        user: {
          nickname: 'Spotify User',
          avatarUrl: 'y',
          provider: 'spotify' as const,
        },
        lastValidatedAt: Date.now(),
      },
    });
    render(<AccountsList />);
    await waitFor(() => {
      expect(screen.getByText('Spotify User')).toBeInTheDocument();
    });
    // spotify 行登出
    const logoutBtns = screen.getAllByRole('button', { name: /登出/ });
    const enabledBtn = logoutBtns.find((b) => !(b as HTMLButtonElement).disabled)!;
    await userEvent.click(enabledBtn);
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledWith('spotify');
    });
    await waitFor(() => {
      expect(screen.getByText(/已登出.*Spotify/)).toBeInTheDocument();
    });
  });

  it('fetchAuthStatusAll 失败 → status 显示 err', async () => {
    mockAll.mockRejectedValue(new Error('boom'));
    render(<AccountsList />);
    await waitFor(() => {
      expect(screen.getByText(/无法读取平台账号状态/)).toBeInTheDocument();
    });
  });
});