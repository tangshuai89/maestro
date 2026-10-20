/**
 * usePlaylist 测试（此前零覆盖）。
 *
 * 契约：
 *  - 首挂拉一次歌单列表
 *  - create → optimistic 插到**最前**（服务端按 updatedAt 倒序）
 *  - rename / append / remove → 用服务端返回的整份歌单替换对应项
 *  - remove_playlist → 从列表里摘掉
 *  - 任何写操作失败 → 记 error 并**重新抛出**（调用方要能感知）
 *  - clearError → 清错误态
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  patchPlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

import { usePlaylist } from './usePlaylist';
import type { Playlist } from '../api';

const pl = (id: string, name = `歌单${id}`) =>
  ({ id, name, items: [], updatedAt: 0 }) as unknown as Playlist;

describe('usePlaylist', () => {
  beforeEach(() => {
    apiMocks.listPlaylists.mockReset().mockResolvedValue([pl('p1'), pl('p2')]);
    apiMocks.createPlaylist.mockReset();
    apiMocks.patchPlaylist.mockReset();
    apiMocks.deletePlaylist.mockReset();
  });

  it('首挂拉一次歌单列表', async () => {
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));
    expect(result.current.loading).toBe(false);
    expect(apiMocks.listPlaylists).toHaveBeenCalledTimes(1);
  });

  it('拉取失败 → 记 error、列表保持空', async () => {
    apiMocks.listPlaylists.mockRejectedValue(new Error('拉歌单失败'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.error).toBe('拉歌单失败'));
    expect(result.current.playlists).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('create → optimistic 插到最前', async () => {
    apiMocks.createPlaylist.mockResolvedValue(pl('p0'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await result.current.create({ name: '新的', tracks: [] });
    });
    expect(result.current.playlists[0].id).toBe('p0');
    expect(result.current.playlists).toHaveLength(3);
  });

  it('create 失败 → 记 error 并重新抛出（列表不变）', async () => {
    apiMocks.createPlaylist.mockRejectedValue(new Error('存歌单失败'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await expect(result.current.create({ name: 'x', tracks: [] })).rejects.toThrow('存歌单失败');
    });
    expect(result.current.error).toBe('存歌单失败');
    expect(result.current.playlists).toHaveLength(2);
  });

  it('rename → 用服务端返回的整份歌单替换', async () => {
    apiMocks.patchPlaylist.mockResolvedValue(pl('p1', '新名字'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await result.current.rename('p1', '新名字');
    });
    expect(apiMocks.patchPlaylist).toHaveBeenCalledWith('p1', { name: '新名字' });
    expect(result.current.playlists.find((p) => p.id === 'p1')?.name).toBe('新名字');
    expect(result.current.playlists).toHaveLength(2); // 不是新增，是替换
  });

  it('append → 传 append 曲目并替换对应歌单', async () => {
    const tracks = [{ id: 't1' }] as never;
    apiMocks.patchPlaylist.mockResolvedValue(pl('p1', 'p1带曲'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await result.current.append('p1', tracks);
    });
    expect(apiMocks.patchPlaylist).toHaveBeenCalledWith('p1', { append: tracks });
    expect(result.current.playlists.find((p) => p.id === 'p1')?.name).toBe('p1带曲');
  });

  it('remove → 传 remove 曲目 id 并替换对应歌单', async () => {
    apiMocks.patchPlaylist.mockResolvedValue(pl('p1', 'p1少曲'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await result.current.remove('p1', ['t1', 't2']);
    });
    expect(apiMocks.patchPlaylist).toHaveBeenCalledWith('p1', { remove: ['t1', 't2'] });
    expect(result.current.playlists.find((p) => p.id === 'p1')?.name).toBe('p1少曲');
  });

  it('remove_playlist → 从列表里摘掉', async () => {
    apiMocks.deletePlaylist.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await result.current.remove_playlist('p1');
    });
    expect(apiMocks.deletePlaylist).toHaveBeenCalledWith('p1');
    expect(result.current.playlists.map((p) => p.id)).toEqual(['p2']);
  });

  it('写操作失败 → 记 error 并重新抛出', async () => {
    apiMocks.patchPlaylist.mockRejectedValue(new Error('改歌单名失败'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    await act(async () => {
      await expect(result.current.rename('p1', 'x')).rejects.toThrow('改歌单名失败');
    });
    expect(result.current.error).toBe('改歌单名失败');
  });

  it('clearError → 清错误态', async () => {
    apiMocks.listPlaylists.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.error).toBe('boom'));
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('refresh → 重新拉一次并替换列表', async () => {
    const { result } = renderHook(() => usePlaylist());
    await waitFor(() => expect(result.current.playlists).toHaveLength(2));

    apiMocks.listPlaylists.mockResolvedValue([pl('p9')]);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.playlists.map((p) => p.id)).toEqual(['p9']);
    expect(apiMocks.listPlaylists).toHaveBeenCalledTimes(2);
  });
});
