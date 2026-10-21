/**
 * ButtonSmoke.test.tsx — shadcn 烟雾测试组件（此前 0% 覆盖）。
 *
 * 这是**开发用的沙盒**（不接入任何 baseline 化页面），存在的唯一目的是验证
 * bridge.scss 颜色 + Tailwind + Radix 这条编译链没断 —— D11 视觉回归拿它当
 * baseline 截图。所以这里的断言只要「能渲染出各 variant 的按钮 + 弹窗 +
 * tooltip 触发」就够了，不追业务语义。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonSmoke } from './ButtonSmoke';

describe('ButtonSmoke', () => {
  it('渲染标题与五种 Button variant', () => {
    render(<ButtonSmoke />);
    expect(screen.getByText('shadcn Phase 1 smoke')).toBeInTheDocument();
    for (const label of ['Primary', 'Destructive', 'Outline', 'Secondary', 'Ghost']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('点「Open Dialog」→ Radix Dialog 真的打开（弹层内容出现）', () => {
    render(<ButtonSmoke />);
    expect(screen.queryByText('shadcn Dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Dialog' }));
    expect(screen.getByText('shadcn Dialog')).toBeInTheDocument();
    expect(screen.getByText('Radix Dialog primitives + AETHER theme')).toBeInTheDocument();
  });

  it('Tooltip 内容是**懒挂载**的（hover 前不在 DOM 里）', () => {
    render(<ButtonSmoke />);
    // Radix Tooltip 的 content 默认延迟 700ms 且懒挂载 —— hover 前不该出现。
    // 如果它提前就在 DOM 里，说明 shadcn 的 Tooltip 包装被改坏了。
    expect(screen.getByRole('button', { name: 'Hover me (tooltip)' })).toBeInTheDocument();
    expect(screen.queryByText('Radix Tooltip via shadcn')).toBeNull();
  });

  it('渲染 Dialog 触发器与 Tooltip 触发器（Radix 链路）', () => {
    render(<ButtonSmoke />);
    expect(screen.getByRole('button', { name: 'Open Dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hover me (tooltip)' })).toBeInTheDocument();
  });
});
