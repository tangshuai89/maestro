/**
 * Input.test.tsx — 单行文本输入框（原生 <input> 的薄封装）。
 *
 * 行为契约：
 *  1. 渲染原生 <input>，透传 placeholder / type / value 等属性
 *  2. 输入 → 触发 onChange，回调拿到新值
 *  3. disabled → 输入框处于禁用态，onChange 不再触发
 *  4. ref 转发到真实的 <input> DOM 节点
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { Input } from './Input';

describe('Input', () => {
  it('渲染 <input> 并透传 placeholder / type / value', () => {
    render(<Input placeholder="搜索歌名" type="search" defaultValue="晴天" />);
    const input = screen.getByPlaceholderText('搜索歌名');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveValue('晴天');
  });

  it('输入 → 触发 onChange，回调拿到新值', async () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="搜索歌名" />);
    await userEvent.type(screen.getByPlaceholderText('搜索歌名'), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe('ab');
  });

  it('disabled → 输入框禁用，onChange 不触发', async () => {
    const onChange = vi.fn();
    render(<Input disabled onChange={onChange} placeholder="搜索歌名" />);
    const input = screen.getByPlaceholderText('搜索歌名');
    expect(input).toBeDisabled();
    await userEvent.type(input, 'ab');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ref 转发到真实的 <input> DOM 节点', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="搜索歌名" />);
    expect(ref.current).toBe(screen.getByPlaceholderText('搜索歌名'));
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
