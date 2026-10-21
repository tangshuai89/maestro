/**
 * Dialog.test.tsx — 模态对话框（Radix Dialog 封装：遮罩 + 内容 + 标题/描述 + 关闭按钮）。
 *
 * 行为契约：
 *  1. 初始关闭：内容（标题 / 描述 / 关闭按钮）不在页面里
 *  2. 点 Trigger → 打开，role=dialog 的内容可见
 *  3. 点右上角关闭按钮（无障碍名 "Close"）→ 关闭，内容从页面移除
 *  4. 点 DialogClose 包裹的业务按钮 → 关闭
 *  5. 按 ESC → 关闭
 *  6. onOpenChange 回调：打开时 true、关闭时 false
 *  7. 对话框的可访问名来自 DialogTitle、描述来自 DialogDescription
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './Dialog';

function BasicDialog(props: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={props.onOpenChange}>
      <DialogTrigger>打开设置</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>调整播放偏好</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>取消</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('初始关闭：内容不在页面里', () => {
    render(<BasicDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('设置')).not.toBeInTheDocument();
  });

  it('点 Trigger → 打开，内容可见', async () => {
    render(<BasicDialog />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('调整播放偏好')).toBeInTheDocument();
  });

  it('点右上角关闭按钮 → 关闭，内容移除', async () => {
    render(<BasicDialog />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('点 DialogClose 包裹的业务按钮 → 关闭', async () => {
    render(<BasicDialog />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('按 ESC → 关闭', async () => {
    render(<BasicDialog />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('onOpenChange：打开时 true、关闭时 false', async () => {
    const onOpenChange = vi.fn();
    render(<BasicDialog onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    await screen.findByRole('dialog');
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('可访问名来自 DialogTitle、描述来自 DialogDescription', async () => {
    render(<BasicDialog />);
    await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('设置');
    expect(dialog).toHaveAccessibleDescription('调整播放偏好');
  });
});
