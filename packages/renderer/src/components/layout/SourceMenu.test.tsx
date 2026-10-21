/**
 * SourceMenu.test.tsx — 音源切换按钮 + 下拉菜单。
 *
 * 行为契约：
 *  1. 渲染触发按钮：文案是当前音源名，title 为「切换音源」
 *  2. 默认收起：菜单不存在
 *  3. 点触发按钮 → 展开菜单，四个可切换音源各占一项（role=menuitem）
 *  4. 当前音源那一项带 ✓ 标记，其余不带
 *  5. 点菜单项 → 调 onSelect(该音源)，且菜单收起
 *  6. 点遮罩 → 菜单收起，且不调 onSelect
 *  7. 菜单开着时再点触发按钮 → 菜单收起
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceMenu from './SourceMenu';

describe('SourceMenu', () => {
  it('渲染触发按钮：当前音源名 + title「切换音源」', () => {
    render(<SourceMenu provider="qq" onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: /QQ 音乐/ });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('title', '切换音源');
  });

  it('默认收起：菜单不存在', () => {
    render(<SourceMenu provider="qq" onSelect={() => {}} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('点触发按钮 → 展开菜单，四个音源项', async () => {
    render(<SourceMenu provider="qq" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /QQ 音乐/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    for (const label of [/QQ 音乐/, /网易云音乐/, /Deezer/, /Spotify/]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
  });

  it('当前音源项带 ✓ 标记，其余不带', async () => {
    render(<SourceMenu provider="deezer" onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Deezer/ }));
    expect(screen.getByRole('menuitem', { name: /Deezer/ })).toHaveTextContent('✓');
    expect(screen.getByRole('menuitem', { name: /QQ 音乐/ })).not.toHaveTextContent('✓');
  });

  it('点菜单项 → 调 onSelect(该音源) 且菜单收起', async () => {
    const onSelect = vi.fn();
    render(<SourceMenu provider="qq" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /QQ 音乐/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /网易云音乐/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('netease');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('点遮罩 → 菜单收起且不调 onSelect', async () => {
    const onSelect = vi.fn();
    const { container } = render(<SourceMenu provider="qq" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /QQ 音乐/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(container.querySelector('.source-menu-backdrop')!);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('菜单开着时再点触发按钮 → 菜单收起', async () => {
    render(<SourceMenu provider="qq" onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: /QQ 音乐/ });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
