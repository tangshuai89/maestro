/**
 * ErrorPanel.test.tsx — TheaterView 内联错误面板。
 *
 * 行为契约：
 *  1. 默认折叠（只显示 firstLine，最多 120 字符）
 *  2. 点 summary → 展开，显示完整 message + 复制 + 关闭
 *  3. 复制按钮调 navigator.clipboard.writeText；成功后短暂显示「已复制 ✓」
 *  4. 关闭按钮调 onClose
 *  5. 多行 message 时 firstLine 只取首行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import ErrorPanel from './ErrorPanel';

describe('ErrorPanel', () => {
  beforeEach(() => {
    // 每个用例重置 clipboard 调用计数
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockClear?.();
  });

  it('默认折叠：显示首行（多行 message 取首行）', () => {
    render(
      <ErrorPanel message={'line1\nline2\nline3'} onClose={() => {}} />,
    );
    expect(screen.getByText('line1')).toBeInTheDocument();
    expect(screen.queryByText('line2')).not.toBeInTheDocument();
  });

  it('首行超过 120 字符时截断', () => {
    const long = 'x'.repeat(200);
    render(<ErrorPanel message={long} onClose={() => {}} />);
    // 折叠态显示 .err-summary-text；展开后 .err-pre 才显示完整 message
    expect(screen.getByText('x'.repeat(120)).textContent).toBe('x'.repeat(120));
  });

  it('点 summary 展开 → 显示 .err-pre + 复制/关闭按钮', () => {
    render(
      <ErrorPanel message={'line1\nline2'} onClose={() => {}} />,
    );
    // 初始：line2 不可见（在 <pre> 里）
    expect(document.querySelector('.err-detail')).not.toBeInTheDocument();
    // 点 summary 行（button accessible name = "⚠ line1 ▸"）
    fireEvent.click(screen.getByRole('button', { name: /line1/ }));
    // 展开后：.err-detail 出现，.err-pre 包含完整 message
    const pre = document.querySelector('.err-pre') as HTMLElement;
    expect(pre).toBeInTheDocument();
    expect(pre.textContent).toBe('line1\nline2');
    // 复制 + 关闭按钮出现
    expect(screen.getByText('复制')).toBeInTheDocument();
    expect(screen.getByText('关闭')).toBeInTheDocument();
  });

  it('点「关闭」调 onClose', () => {
    const onClose = vi.fn();
    render(<ErrorPanel message="err" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /err/ }));
    fireEvent.click(screen.getByText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点「复制」调 navigator.clipboard.writeText 写入完整 message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<ErrorPanel message="full-error-text" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /full-error-text/ }));
    await act(async () => {
      fireEvent.click(screen.getByText('复制'));
    });
    expect(writeText).toHaveBeenCalledWith('full-error-text');
  });
});
