/**
 * Tooltip.test.tsx — 悬浮提示（Radix Tooltip 封装）。
 *
 * 行为契约：
 *  1. 触发元素常驻可见，提示内容初始不渲染
 *  2. 悬停触发元素 → 出现 role=tooltip 的提示内容
 *  3. 鼠标移开触发元素 → 提示内容消失；点触发元素 → 提示内容关闭
 *  4. 键盘聚焦触发元素 → 同样出现提示内容
 *  5. 提示打开时按 ESC → 提示关闭
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './Tooltip';

/** delayDuration=0 只是让测试不等默认的 700ms 延迟，不改变组件行为。 */
function BasicTooltip() {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger>播放</TooltipTrigger>
        <TooltipContent>播放这首歌</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip', () => {
  it('初始不渲染提示内容', () => {
    render(<BasicTooltip />);
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('悬停触发元素 → 出现提示内容', async () => {
    render(<BasicTooltip />);
    await userEvent.hover(screen.getByRole('button', { name: '播放' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('播放这首歌');
  });

  it('鼠标移开 → 提示内容消失', async () => {
    render(<BasicTooltip />);
    const trigger = screen.getByRole('button', { name: '播放' });
    await userEvent.hover(trigger);
    await screen.findByRole('tooltip');
    await userEvent.unhover(trigger);
    // 提示默认「可悬停」，移开触发元素后需把指针移到提示区域之外才关闭。
    //
    // ⚠️ **pointerMove 必须放进 waitFor 里重试**（2026-10-22 实测踩到 flaky）：
    // Radix 的关闭链路是「trigger 的**原生** pointerleave → setState（grace area）
    // → React effect 挂上 document 的 pointermove 监听 → 监听里判断指针是否
    // 出界 → onClose」。**挂监听那一步是后续任务** → 机器负载高时它会比下面
    // 这行 fireEvent 更晚 → 监听器还没挂上 → 这次 pointermove 没人接 →
    // 提示永远不关 → 之前那条 1s 超时的 waitFor 直接红（而且只在 CI 高负载时红）。
    // 放进 waitFor 里重试 = 断言语义不变（「最终会关」），但与负载无关。
    await waitFor(() => {
      fireEvent.pointerMove(document.body, { clientX: 300, clientY: 300 });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('点触发元素 → 提示内容关闭', async () => {
    render(<BasicTooltip />);
    const trigger = screen.getByRole('button', { name: '播放' });
    await userEvent.hover(trigger);
    await screen.findByRole('tooltip');
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('键盘聚焦触发元素 → 出现提示内容', async () => {
    render(<BasicTooltip />);
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('播放这首歌');
  });

  it('提示打开时按 ESC → 提示关闭', async () => {
    render(<BasicTooltip />);
    const trigger = screen.getByRole('button', { name: '播放' });
    await userEvent.hover(trigger);
    await screen.findByRole('tooltip');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });
});
