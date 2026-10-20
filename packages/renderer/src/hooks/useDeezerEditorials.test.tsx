/**
 * useDeezerEditorials 测试（此前零覆盖）。
 *
 * 契约：
 *  - 挂载时拉一次 editorials 列表，进 state
 *  - 拉取失败 → **空数组**（不抛、不把错误冒到界面）
 *
 * api 模块整体替换：只关心 fetchDeezerEditorials 这一个出口。
 * 替身函数在工厂外建一次（引用稳定）—— 否则每次 render 新建会让
 * hook 的 effect 依赖一直变 → 无限重跑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  fetchDeezerEditorials: vi.fn(),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

import { useDeezerEditorials } from './useDeezerEditorials';

const editorials = [
  { id: 'e1', name: 'Rock', region: 'FR' },
  { id: 'e2', name: 'Jazz', region: 'FR' },
];

describe('useDeezerEditorials', () => {
  beforeEach(() => {
    apiMocks.fetchDeezerEditorials.mockReset();
  });

  it('挂载时拉一次并放进 state', async () => {
    apiMocks.fetchDeezerEditorials.mockResolvedValue(editorials);
    const { result } = renderHook(() => useDeezerEditorials());
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0].id).toBe('e1');
    expect(apiMocks.fetchDeezerEditorials).toHaveBeenCalledTimes(1);
  });

  it('拉取失败 → 空数组（不抛）', async () => {
    apiMocks.fetchDeezerEditorials.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDeezerEditorials());
    await waitFor(() => expect(apiMocks.fetchDeezerEditorials).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it('拉取返回空列表 → state 是空数组', async () => {
    apiMocks.fetchDeezerEditorials.mockResolvedValue([]);
    const { result } = renderHook(() => useDeezerEditorials());
    await waitFor(() => expect(apiMocks.fetchDeezerEditorials).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
