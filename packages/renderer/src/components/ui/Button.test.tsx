/**
 * Button.test.tsx — 通用按钮（shadcn 语义类 + Radix Slot 的 asChild 模式）。
 *
 * 行为契约：
 *  1. 渲染原生 <button>，透传文案 / type / aria-label 等原生属性
 *  2. 点击 → 调 onClick
 *  3. disabled → 按钮处于禁用态，点击不触发 onClick
 *  4. asChild → 不渲染 <button>，而是把按钮语义合并到子元素上
 *  5. ref 转发到真实的 DOM 节点（默认 <button>，asChild 时是子元素）
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { Button } from './Button';

describe('Button', () => {
  it('渲染 <button> 并透传原生属性', () => {
    render(
      <Button type="submit" aria-label="登录">
        登录
      </Button>,
    );
    const btn = screen.getByRole('button', { name: '登录' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('type', 'submit');
  });

  it('点击 → 调 onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>播放</Button>);
    await userEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled → 按钮禁用且点击不触发 onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        播放
      </Button>,
    );
    const btn = screen.getByRole('button', { name: '播放' });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('asChild → 渲染子元素而不是 <button>，并把按钮属性合并上去', () => {
    render(
      <Button asChild>
        <a href="/library">我的曲库</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: '我的曲库' });
    expect(link).toHaveAttribute('href', '/library');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ref 转发到真实的 DOM 节点', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>播放</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: '播放' }));
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
