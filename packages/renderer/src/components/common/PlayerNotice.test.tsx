/**
 * PlayerNotice.test.tsx — 播放彻底失败后的分级提示条（此前 0% 覆盖）。
 *
 * 这个组件是「兜底链耗尽」的唯一出口 —— 2026-10-19「交换余生」报障时，
 * usePlayer 只 setError 了一个**没有任何组件渲染**的字符串，界面停在
 * 「歌名 + 00:00 + HUD READY」，视觉上是假死。所以它的文案分级不是装饰：
 * 「付费专辑 / 会员专属 / 会员失效 / 音源故障 / 无版权」要的用户动作**完全不同**。
 *
 * 行为契约：
 *  1. failure 与 error 都空 → 不渲染
 *  2. 每种 reason 一句对应文案（**互不相同** —— 分级失效就是"都显示同一句"）
 *  3. autoSkip=true → 4s 倒计时 + 「Ns 后自动下一首」+「停留」按钮
 *  4. autoSkip=false → 不倒计时、不显示「停留」
 *  5. 「停留」→ 停掉倒计时（不再自动跳）
 *  6. 倒计时到 0 → 自动调 onSkipNext
 *  7. 只有 paid-track / vip-locked 给「去XX查看」外链（无版权去了也没用）
 *  8. failure 存在 → 有「下一首」按钮；只有 error → 没有
 *  9. 点「×」→ onDismiss
 * 10. failure 为 null 只有 error → 降级显示 error 字符串
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PlayerNotice from './PlayerNotice';
import type { PlayFailure } from '../../hooks/usePlayer';

const fail = (over: Partial<PlayFailure> = {}): PlayFailure => ({
  title: '歌名',
  artist: '艺人',
  provider: 'qq',
  trackId: 't1',
  reason: 'no-match',
  detail: '细节',
  autoSkip: true,
  ...over,
});

const baseProps = { onSkipNext: vi.fn(), onDismiss: vi.fn() };

beforeEach(() => {
  baseProps.onSkipNext.mockReset();
  baseProps.onDismiss.mockReset();
  delete (globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PlayerNotice', () => {
  it('failure 与 error 都空 → 不渲染', () => {
    const { container } = render(<PlayerNotice failure={null} error={null} {...baseProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('每种 reason 给出**不同**的分级文案', () => {
    const cases: Array<[PlayFailure['reason'], RegExp]> = [
      ['paid-track', /付费专辑曲目/],
      ['vip-locked', /会员专属/],
      ['entitlement-expired', /会员已失效/],
      ['stream-failed', /音源暂时不可用/],
      ['no-match', /暂无可播版本/],
    ];
    const texts: string[] = [];
    for (const [reason, re] of cases) {
      // 每轮必须 unmount —— 否则上一轮的 alert 还在 DOM 里，getByRole 撞多个
      const { unmount } = render(
        <PlayerNotice failure={fail({ reason })} error={null} {...baseProps} />,
      );
      const text = screen.getByRole('alert').textContent ?? '';
      expect(text).toMatch(re);
      texts.push(text);
      unmount();
    }
    // 分级失效 = 每种 reason 都显示同一句 → 断言文案互不相同
    expect(new Set(texts).size).toBe(cases.length);
  });

  it('entitlement-expired 的文案要说明「重登没用」（与凭据过期相反的动作）', () => {
    render(
      <PlayerNotice
        failure={fail({ reason: 'entitlement-expired' })}
        error={null}
        {...baseProps}
      />,
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toMatch(/重新登录没用/);
  });

  it('autoSkip=true → 显示倒计时与「停留」按钮', () => {
    render(<PlayerNotice failure={fail({ autoSkip: true })} error={null} {...baseProps} />);
    expect(screen.getByText(/4s 后自动下一首/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停留' })).toBeInTheDocument();
  });

  it('autoSkip=false → 不倒计时、不显示「停留」', () => {
    render(<PlayerNotice failure={fail({ autoSkip: false })} error={null} {...baseProps} />);
    expect(screen.queryByText(/后自动下一首/)).toBeNull();
    expect(screen.queryByRole('button', { name: '停留' })).toBeNull();
  });

  it('点「停留」→ 停掉倒计时，不再自动跳', () => {
    vi.useFakeTimers();
    render(<PlayerNotice failure={fail({ autoSkip: true })} error={null} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '停留' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(baseProps.onSkipNext).not.toHaveBeenCalled();
    expect(screen.queryByText(/后自动下一首/)).toBeNull();
  });

  it('倒计时走到 0 → 自动调 onSkipNext', async () => {
    vi.useFakeTimers();
    render(<PlayerNotice failure={fail({ autoSkip: true })} error={null} {...baseProps} />);
    // 逐步推进：倒计时是 useEffect 里的 setTimeout，每跳一次要 React 重渲染
    // 才会挂上下一个 timer —— 一次 advance 4000ms 只会走一格。
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(baseProps.onSkipNext).toHaveBeenCalled();
  });

  it('只有 paid-track / vip-locked 给「去原平台查看」外链', () => {
    const { unmount } = render(
      <PlayerNotice failure={fail({ reason: 'paid-track' })} error={null} {...baseProps} />,
    );
    expect(screen.getByRole('button', { name: /去QQ 音乐查看/ })).toBeInTheDocument();
    unmount();

    render(<PlayerNotice failure={fail({ reason: 'no-match' })} error={null} {...baseProps} />);
    expect(screen.queryByRole('button', { name: /查看$/ })).toBeNull();
  });

  it('点「去原平台查看」→ 走 electronAPI.openExternal', () => {
    const openExternal = vi.fn();
    (globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI = {
      openExternal,
    };
    render(<PlayerNotice failure={fail({ reason: 'vip-locked' })} error={null} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /查看$/ }));
    expect(openExternal).toHaveBeenCalledWith('https://y.qq.com/n/ryqq/songDetail/t1');
  });

  it('failure 存在 → 有「下一首」按钮；点击 → onSkipNext', () => {
    render(<PlayerNotice failure={fail()} error={null} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /下一首/ }));
    expect(baseProps.onSkipNext).toHaveBeenCalled();
  });

  it('只有 error（无 failure）→ 降级显示 error 字符串，且没有「下一首」', () => {
    render(<PlayerNotice failure={null} error="播放失败：网络错误" {...baseProps} />);
    expect(screen.getByRole('alert').textContent).toMatch(/播放失败：网络错误/);
    expect(screen.queryByRole('button', { name: /下一首/ })).toBeNull();
  });

  it('点「×」→ onDismiss', () => {
    render(<PlayerNotice failure={fail()} error={null} {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(baseProps.onDismiss).toHaveBeenCalled();
  });

  it('failure 变化 → 倒计时重置（上一首的 4s 不该带到下一首）', async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <PlayerNotice failure={fail({ title: '歌A' })} error={null} {...baseProps} />,
    );
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    // 走了 3s → 剩 1s
    expect(screen.getByText(/1s 后自动下一首/)).toBeInTheDocument();

    // 换一首歌 → 倒计时回到 4s（否则新歌的提示条只剩 1 秒就没了）
    // ⚠️ 这里**不能**用 waitFor —— 假定时器下它内部的轮询定时器不会被推进，
    // 会一直等到 vitest 的 5s 超时。倒计时重置发生在 render 期（同步），直接断言即可。
    await act(async () => {
      rerender(<PlayerNotice failure={fail({ title: '歌B' })} error={null} {...baseProps} />);
    });
    expect(screen.getByText(/4s 后自动下一首/)).toBeInTheDocument();
  });
});
