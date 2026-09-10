/**
 * Modal.test.tsx — common/Modal 共享弹窗外壳。
 *
 * 行为契约：
 *  1. 点击 scrim (.modal-overlay) → 调 onClose
 *  2. 点击 panel (.modal-panel) → 不调 onClose（stopPropagation 拦住冒泡）
 *  3. children 正常渲染
 *  4. panelClassName 可选；传入时拼到 .modal-panel 后面
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import Modal from './Modal';

describe('Modal', () => {
  it('渲染 children', () => {
    render(
      <Modal onClose={() => {}}>
        <p>hello-modal</p>
      </Modal>,
    );
    expect(screen.getByText('hello-modal')).toBeInTheDocument();
  });

  it('点 scrim 调 onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <p>x</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText('x').parentElement!.parentElement!); // scrim
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点 panel 不调 onClose（stopPropagation）', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose}>
        <span>inner</span>
      </Modal>,
    );
    // 直接点 children（panel 内部元素）
    fireEvent.click(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('panelClassName 拼到 .modal-panel', () => {
    const { container } = render(
      <Modal onClose={() => {}} panelClassName="wide-480">
        <p>x</p>
      </Modal>,
    );
    const panel = container.querySelector('.modal-panel')!;
    expect(panel.className).toContain('wide-480');
  });

  it('不传 panelClassName 时 .modal-panel 不带多余类', () => {
    const { container } = render(
      <Modal onClose={() => {}}>
        <p>x</p>
      </Modal>,
    );
    const panel = container.querySelector('.modal-panel')!;
    expect(panel.className.trim()).toBe('modal-panel');
  });
});
