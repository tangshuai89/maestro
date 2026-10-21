/**
 * DeezerPresetSelect.test.tsx — Deezer 榜单（Deezer editorial）下拉选择。
 *
 * 行为契约：
 *  1. 渲染一个下拉框，title 为「Deezer 榜单」
 *  2. 每个 editorial 渲染成一个 option，文案是榜单名（有 region 时追加「 · region」）
 *  3. 当前 value 对应的选项处于选中态
 *  4. 选另一项 → 调 onChange(该榜单对应的 preset code)
 *  5. 榜单名不在映射表里 → preset code 回退为 'all'
 *  6. editorials 为空 → 下拉框没有任何选项
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeezerEditorial } from '../../api';
import DeezerPresetSelect from './DeezerPresetSelect';

const EDITORIALS: DeezerEditorial[] = [
  { id: 1, name: 'All' },
  { id: 2, name: '摇滚', region: '全球' },
  { id: 3, name: '古典' },
];

describe('DeezerPresetSelect', () => {
  it('渲染下拉框，title 为「Deezer 榜单」', () => {
    render(<DeezerPresetSelect editorials={EDITORIALS} value="all" onChange={() => {}} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute('title', 'Deezer 榜单');
  });

  it('每个 editorial 渲染成一个 option，文案含榜单名与地区', () => {
    render(<DeezerPresetSelect editorials={EDITORIALS} value="all" onChange={() => {}} />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '摇滚 · 全球' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '古典' })).toBeInTheDocument();
  });

  it('当前 value 对应的选项处于选中态', () => {
    render(<DeezerPresetSelect editorials={EDITORIALS} value="rock" onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('rock');
    const rockOption = screen.getByRole('option', { name: '摇滚 · 全球' }) as HTMLOptionElement;
    expect(rockOption.selected).toBe(true);
  });

  it('选另一项 → 调 onChange(对应的 preset code)', async () => {
    const onChange = vi.fn();
    render(<DeezerPresetSelect editorials={EDITORIALS} value="all" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'classical');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('classical');
  });

  it('榜单名不在映射表里 → preset code 回退为 all', () => {
    const editorials: DeezerEditorial[] = [{ id: 9, name: '没听过的榜单' }];
    render(<DeezerPresetSelect editorials={editorials} value="all" onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('all');
    expect(screen.getByRole('option', { name: '没听过的榜单' })).toHaveValue('all');
  });

  it('editorials 为空 → 下拉框没有任何选项', () => {
    render(<DeezerPresetSelect editorials={[]} value="all" onChange={() => {}} />);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
