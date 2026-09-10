/**
 * RecoKeyModal.test.tsx — DeepSeek API Key 输入弹窗。
 *
 * 行为契约：
 *  1. 渲染提示文案 + DeepSeek 链接（target=_blank, rel=noreferrer）
 *  2. 保存按钮在 key 长度 < 8 时 disabled；≥ 8 时 enabled
 *  3. 点保存调 onSave(key)
 *  4. 点关闭 / 取消调 onClose
 *  5. 输入框回车 → 调 onSave
 *  6. 点 scrim → 调 onClose（继承 Modal 行为）
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecoKeyModal from './RecoKeyModal';

describe('RecoKeyModal', () => {
  it('渲染标题、提示文案、DeepSeek 平台链接', () => {
    render(<RecoKeyModal onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByText('设置 DeepSeek API Key')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /platform\.deepseek\.com/ });
    expect(link).toHaveAttribute('href', 'https://platform.deepseek.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('保存按钮：key < 8 字符时 disabled', () => {
    render(<RecoKeyModal onSave={() => {}} onClose={() => {}} />);
    const save = screen.getByText('保存');
    expect(save).toBeDisabled();
    // 输入 7 字符仍 disabled
    const input = screen.getByPlaceholderText('sk-...');
    fireEvent.change(input, { target: { value: 'sk-1234' } }); // 7 字符
    expect(save).toBeDisabled();
  });

  it('保存按钮：key ≥ 8 字符时 enabled；点保存调 onSave', async () => {
    const onSave = vi.fn();
    render(<RecoKeyModal onSave={onSave} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('sk-...');
    await userEvent.type(input, 'sk-12345678');
    const save = screen.getByText('保存');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith('sk-12345678');
  });

  it('输入框按 Enter 调 onSave', async () => {
    const onSave = vi.fn();
    render(<RecoKeyModal onSave={onSave} onClose={() => {}} />);
    const input = screen.getByPlaceholderText('sk-...');
    await userEvent.type(input, 'sk-abcdefgh{Enter}');
    expect(onSave).toHaveBeenCalledWith('sk-abcdefgh');
  });

  it('点「取消」调 onClose', () => {
    const onClose = vi.fn();
    render(<RecoKeyModal onSave={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点右上角 × 关闭按钮调 onClose', () => {
    const onClose = vi.fn();
    render(<RecoKeyModal onSave={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('空 key 时点 scrim（modal-overlay）调 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(
      <RecoKeyModal onSave={() => {}} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
