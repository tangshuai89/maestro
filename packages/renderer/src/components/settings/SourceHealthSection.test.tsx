/**
 * SourceHealthSection 子组件测试。
 * 覆盖：
 *  - 挂载时调 fetchSourceHealth
 *  - 每平台渲染 1 行（4 平台 = 4 行）
 *  - total=0 → "近 24h 无请求" + 进度条 width 0% + 文本 "—"
 *  - total>0 → successRate 进度条 width 正确
 *  - lastFailureAt 非 null → 显示「最近失败：刚刚」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  fetchSourceHealth: vi.fn(),
}));
const { fetchSourceHealth: mockHealth } = mocks;

vi.mock('../../api', () => ({
  fetchSourceHealth: mocks.fetchSourceHealth,
  PROVIDER_LABELS: {
    qq: 'QQ 音乐',
    netease: '网易云音乐',
    deezer: 'Deezer',
    spotify: 'Spotify',
  },
}));

import SourceHealthSection from './SourceHealthSection';

describe('SourceHealthSection', () => {
  beforeEach(() => {
    mockHealth.mockClear();
  });

  it('挂载时调 fetchSourceHealth + 渲染 4 行（按 MUSIC_PROVIDERS 顺序）', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalled();
    });
    // 4 行：每行显示「近 24h 无请求」
    expect(screen.getAllByText(/近 24h 无请求/).length).toBe(4);
  });

  it('total=0 → 进度条 width 0% + 文本 "—"', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalled();
    });
    // 4 个 "—"
    expect(screen.getAllByText('—').length).toBe(4);
    // fill 宽度 0%
    const fills = document.querySelectorAll('.set-health-bar-fill');
    expect(fills.length).toBe(4);
    fills.forEach((f) => {
      expect((f as HTMLElement).style.width).toBe('0%');
    });
  });

  it('total=10, successRate=0.8 → 显示「10 次请求 · 成功率 80%」+ 进度条 80%', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 10, successRate: 0.8, lastFailureAt: null },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalled();
    });
    expect(screen.getByText(/10 次请求 · 成功率 80%/)).toBeInTheDocument();
    const fills = document.querySelectorAll('.set-health-bar-fill');
    expect((fills[0] as HTMLElement).style.width).toBe('80%');
    // 80% < 90% → mid 颜色（黄）
    expect(fills[0].className).toContain('set-health-bar-fill--mid');
  });

  it('successRate>=90% → good 颜色（绿）', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 100, successRate: 0.95, lastFailureAt: null },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalled();
    });
    const fills = document.querySelectorAll('.set-health-bar-fill');
    expect(fills[0].className).toContain('set-health-bar-fill--good');
  });

  it('lastFailureAt 非 null → 显示「最近失败：刚刚」', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 5, successRate: 0.8, lastFailureAt: Date.now() - 30_000 },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalled();
    });
    expect(screen.getByText(/最近失败：刚刚/)).toBeInTheDocument();
  });

  it('点 ↻ 按钮 → 重新调 fetchSourceHealth', async () => {
    mockHealth.mockResolvedValue({
      items: [
        { provider: 'qq', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'netease', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'deezer', total: 0, successRate: 1, lastFailureAt: null },
        { provider: 'spotify', total: 0, successRate: 1, lastFailureAt: null },
      ],
    });
    render(<SourceHealthSection />);
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalledTimes(1);
    });
    await userEvent.click(screen.getByTitle('刷新'));
    await waitFor(() => {
      expect(mockHealth).toHaveBeenCalledTimes(2);
    });
  });
});