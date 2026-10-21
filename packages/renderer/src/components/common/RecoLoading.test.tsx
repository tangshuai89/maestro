/**
 * RecoLoading.test.tsx — AI 推荐生成中全屏（此前 0% 覆盖）。
 *
 * 契约：
 *  1. 阶段文案按**已耗时**推进（不是无脑循环播放 —— 用户等 20s 看到文案
 *     绕回第一句，反而像卡住了）：0-2.5s / 2.5-7s / 7-14s / 14s+
 *  2. LIBRARY 显示库内歌曲数；0 → 显示「…」（还在读）
 *  3. MATCH 恒为 PENDING
 *  4. 有 onClose 时才渲染关闭按钮；ESC 也能关
 *  5. 超过 4s 后文案后面带已耗时秒数
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import RecoLoading from './RecoLoading';

const T0 = new Date('2026-01-01T00:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** 推进挂钟 + 定时器（组件用 500ms 轮询累计耗时）。 */
async function elapse(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('RecoLoading', () => {
  it('初始显示 STEP 1/4 与第一阶段文案', () => {
    render(<RecoLoading librarySize={100} />);
    expect(screen.getByText('STEP 1/4')).toBeInTheDocument();
    expect(screen.getByText('正在读取你的口味档案…')).toBeInTheDocument();
  });

  it('阶段按已耗时推进：2.5s → STEP 2，7s → STEP 3，14s → STEP 4', async () => {
    render(<RecoLoading librarySize={100} />);
    expect(screen.getByText('STEP 1/4')).toBeInTheDocument();

    await elapse(3000);
    expect(screen.getByText('STEP 2/4')).toBeInTheDocument();
    expect(screen.getByText('正在找相似歌手与候选…')).toBeInTheDocument();

    await elapse(5000);
    expect(screen.getByText('STEP 3/4')).toBeInTheDocument();

    await elapse(8000);
    expect(screen.getByText('STEP 4/4')).toBeInTheDocument();
    expect(screen.getByText('正在填实可播音源…')).toBeInTheDocument();
  });

  it('LIBRARY 显示库内歌曲数；0 → 显示「…」', () => {
    const { unmount } = render(<RecoLoading librarySize={1234} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    unmount();

    render(<RecoLoading librarySize={0} />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('MATCH 恒为 PENDING', () => {
    render(<RecoLoading librarySize={10} />);
    expect(screen.getByText('PENDING')).toBeInTheDocument();
  });

  it('有 onClose → 渲染关闭按钮，点击调 onClose', () => {
    const onClose = vi.fn();
    render(<RecoLoading librarySize={10} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('没有 onClose → 不渲染关闭按钮', () => {
    render(<RecoLoading librarySize={10} />);
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
  });

  it('ESC → onClose', () => {
    const onClose = vi.fn();
    render(<RecoLoading librarySize={10} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('超过 4s → 文案后面带已耗时秒数', async () => {
    render(<RecoLoading librarySize={10} />);
    expect(screen.queryByText(/\(\d+s\)/)).toBeNull();
    await elapse(5000);
    expect(screen.getByText(/\(5s\)/)).toBeInTheDocument();
  });
});
