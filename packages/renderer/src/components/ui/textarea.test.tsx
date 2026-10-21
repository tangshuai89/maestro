/**
 * textarea.test.tsx — 多行文本输入框（原生 <textarea> 的薄封装）。
 *
 * 行为契约：
 *  1. 渲染原生 <textarea>，透传 placeholder / rows / value 等属性
 *  2. 输入 → 触发 onChange，回调拿到新值
 *  3. disabled → 输入框处于禁用态，onChange 不再触发
 *  4. ref 转发到真实的 <textarea> DOM 节点
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { Textarea } from './textarea';

describe('Textarea', () => {
  it('渲染 <textarea> 并透传 placeholder / rows / value', () => {
    render(<Textarea placeholder="写点什么" rows={5} defaultValue="草稿" />);
    const ta = screen.getByPlaceholderText('写点什么');
    expect(ta).toBeInTheDocument();
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta).toHaveAttribute('rows', '5');
    expect(ta).toHaveValue('草稿');
  });

  it('输入 → 触发 onChange，回调拿到新值', async () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} placeholder="写点什么" />);
    await userEvent.type(screen.getByPlaceholderText('写点什么'), 'hi');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.at(-1)?.[0].target.value).toBe('hi');
  });

  it('disabled → 输入框禁用，onChange 不触发', async () => {
    const onChange = vi.fn();
    render(<Textarea disabled onChange={onChange} placeholder="写点什么" />);
    const ta = screen.getByPlaceholderText('写点什么');
    expect(ta).toBeDisabled();
    await userEvent.type(ta, 'hi');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ref 转发到真实的 <textarea> DOM 节点', () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} placeholder="写点什么" />);
    expect(ref.current).toBe(screen.getByPlaceholderText('写点什么'));
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });
});
