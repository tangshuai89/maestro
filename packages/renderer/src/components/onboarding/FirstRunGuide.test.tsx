import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FirstRunGuide, { GUIDE_STEPS } from './FirstRunGuide';

/**
 * 首次启动引导（specs/first-run-guide）。
 *
 * 守的是三条：
 *  ① 三步都能走完
 *  ② **任何一步都能跳过**（引导不能变成关卡）
 *  ③ 第 2 步的「现在设置」能打开已有的 RecoKeyModal（复用，不重写 key 输入）
 */
function setup(over: Partial<React.ComponentProps<typeof FirstRunGuide>> = {}) {
  const onClose = vi.fn();
  const onOpenRecoKey = vi.fn();
  render(<FirstRunGuide open onClose={onClose} onOpenRecoKey={onOpenRecoKey} {...over} />);
  return { onClose, onOpenRecoKey };
}

describe('FirstRunGuide', () => {
  it('open=false → 什么都不渲染', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('第 1 步：欢迎 + 三个要点 + 进度', () => {
    setup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(GUIDE_STEPS[0].title)).toBeInTheDocument();
    expect(screen.getByText('STEP 1 / 3')).toBeInTheDocument();
    for (const p of GUIDE_STEPS[0].points) {
      expect(screen.getByText(p.head)).toBeInTheDocument();
    }
  });

  it('点「开始」→ 第 2 步', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    expect(screen.getByText(GUIDE_STEPS[1].title)).toBeInTheDocument();
    expect(screen.getByText('STEP 2 / 3')).toBeInTheDocument();
  });

  it('第 2 步：「现在设置」触发回调（打开已有的 RecoKeyModal）', () => {
    const { onOpenRecoKey } = setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '现在设置' }));
    expect(onOpenRecoKey).toHaveBeenCalledTimes(1);
  });

  it('第 2 步：「以后再说」→ 第 3 步', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '以后再说' }));
    expect(screen.getByText(GUIDE_STEPS[2].title)).toBeInTheDocument();
    expect(screen.getByText('STEP 3 / 3')).toBeInTheDocument();
  });

  it('第 3 步：「开始使用」→ 收尾（onClose）', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '以后再说' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('第 1 步就能跳过 → onClose（引导不是关卡）', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('第 2 步也能跳过 → onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('第 3 步也能跳过 → onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '以后再说' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('跳过之后回到第 1 步（下次「重新看引导」从头开始，不留半截状态）', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // 组件仍然挂着（父组件负责关），但内部步数已复位
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    expect(screen.getByText('STEP 2 / 3')).toBeInTheDocument();
  });
});
