/**
 * QualityMenu.test.tsx — 音质选择按钮 + 下拉菜单。
 *
 * 行为契约：
 *  1. 渲染触发按钮：文案是当前音质名，title 为「音质（无损需会员）」
 *  2. 默认收起：菜单不存在
 *  3. 点触发按钮 → 展开菜单，三个音质档位各占一项（role=menuitem）
 *  4. 当前音质那一项带 ✓ 标记，其余不带
 *  5. 点菜单项 → 调 onSelect(该音质)，且菜单收起
 *  6. 点遮罩 → 菜单收起，且不调 onSelect
 *  7. 菜单开着时再点触发按钮 → 菜单收起
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QualityMenu from './QualityMenu';

describe('QualityMenu', () => {
  it('渲染触发按钮：当前音质名 + title「音质（无损需会员）」', () => {
    render(<QualityMenu quality="standard" onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: '标准' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('title', '音质（无损需会员）');
  });

  it('默认收起：菜单不存在', () => {
    render(<QualityMenu quality="standard" onSelect={() => {}} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('点触发按钮 → 展开菜单，三个音质档位', async () => {
    render(<QualityMenu quality="standard" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '标准' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    for (const label of [/标准/, /极高 320/, /无损/]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });

  it('当前音质项带 ✓ 标记，其余不带', async () => {
    render(<QualityMenu quality="lossless" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '无损' }));
    expect(screen.getByRole('menuitem', { name: /无损/ })).toHaveTextContent('✓');
    expect(screen.getByRole('menuitem', { name: /标准/ })).not.toHaveTextContent('✓');
  });

  it('点菜单项 → 调 onSelect(该音质) 且菜单收起', async () => {
    const onSelect = vi.fn();
    render(<QualityMenu quality="standard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: '标准' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /极高 320/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('high');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('点遮罩 → 菜单收起且不调 onSelect', async () => {
    const onSelect = vi.fn();
    const { container } = render(<QualityMenu quality="standard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: '标准' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(container.querySelector('.source-menu-backdrop')!);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('菜单开着时再点触发按钮 → 菜单收起', async () => {
    render(<QualityMenu quality="standard" onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: '标准' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
