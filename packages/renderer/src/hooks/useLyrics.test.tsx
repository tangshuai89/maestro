/**
 * useLyrics 测试（此前零覆盖）。
 *
 * 契约：
 *  - 轨道变化 → 拉一次 lyrics，且**先清空**旧结果（面板显示 loading，不显示
 *    上一首歌的词）
 *  - altSources 里与主源 (platform, trackId) 相同的要被剔掉（同一首歌不用
 *    当"另一个源"再求一次）
 *  - 结果映射到 lyrics / synced / source / mergedFrom / added / dropped
 *  - 拉取失败 → lyrics 为 null、loading 归位（不抛到界面）
 *  - 没有 track / provider → 不发请求
 *  - `retryByName()`（「换个源找歌词」）：命中替换结果并返回；没命中**保持上一次
 *    结果**并返回 null —— UI 靠返回值区分「换到了」和「白跑一趟」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  fetchLyrics: vi.fn(),
  fetchLyricsByName: vi.fn(),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

import { useLyrics } from './useLyrics';
import type { Track } from '../api';

const track = (id: string, title = 'T', artist = 'A', duration = 100) =>
  ({ id, title, artist, duration }) as unknown as Track;

const result = {
  lines: [{ time: 0, text: '第一句' }],
  synced: true,
  source: 'qq',
  mergedFrom: ['qq', 'netease'],
  added: 3,
  dropped: 1,
};

describe('useLyrics', () => {
  beforeEach(() => {
    apiMocks.fetchLyrics.mockReset();
    apiMocks.fetchLyricsByName.mockReset();
  });

  it('拉一次 lyrics 并映射到返回值', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    const { result: r } = renderHook(() => useLyrics(track('t1'), 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.lyrics).toHaveLength(1);
    expect(r.current.synced).toBe(true);
    expect(r.current.source).toBe('qq');
    expect(r.current.mergedFrom).toEqual(['qq', 'netease']);
    expect(r.current.added).toBe(3);
    expect(r.current.dropped).toBe(1);
    expect(apiMocks.fetchLyrics).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchLyrics).toHaveBeenCalledWith('qq', 't1', {
      title: 'T',
      artist: 'A',
      sources: undefined,
    });
  });

  it('altSources 里与主源相同的 (platform, trackId) 被剔掉', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    renderHook(() =>
      useLyrics(track('t1'), 'qq', [
        { platform: 'qq', trackId: 't1' }, // 同源 → 剔掉
        { platform: 'netease', trackId: 'n1' }, // 异源 → 保留
      ]),
    );
    await waitFor(() => expect(apiMocks.fetchLyrics).toHaveBeenCalled());
    const sources = apiMocks.fetchLyrics.mock.calls[0][2].sources;
    expect(sources).toEqual([{ platform: 'netease', trackId: 'n1' }]);
  });

  it('拉取失败 → lyrics 为 null、loading 归位（不抛）', async () => {
    apiMocks.fetchLyrics.mockRejectedValue(new Error('boom'));
    const { result: r } = renderHook(() => useLyrics(track('t1'), 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.lyrics).toBeNull();
    expect(r.current.source).toBeNull();
  });

  it('没有 track → 不发请求，loading 保持 false', async () => {
    const { result: r } = renderHook(() => useLyrics(null, 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(apiMocks.fetchLyrics).not.toHaveBeenCalled();
    expect(r.current.lyrics).toBeNull();
  });

  it('没有 provider → 不发请求', async () => {
    const { result: r } = renderHook(() => useLyrics(track('t1'), null));
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(apiMocks.fetchLyrics).not.toHaveBeenCalled();
  });

  it('切歌 → 先清空旧结果（不残留上一首的词）', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    const { result: r, rerender } = renderHook(({ t }: { t: Track }) => useLyrics(t, 'qq'), {
      initialProps: { t: track('t1') },
    });
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(r.current.lyrics).toHaveLength(1);

    // 第二次请求悬而未决 → 旧结果应已被清空
    apiMocks.fetchLyrics.mockReturnValue(new Promise(() => {}));
    rerender({ t: track('t2') });
    await waitFor(() => expect(r.current.loading).toBe(true));
    expect(r.current.lyrics).toBeNull();
  });

  it('retryByName 命中 → 替换结果并返回它', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    apiMocks.fetchLyricsByName.mockResolvedValue({
      ...result,
      lines: [{ time: 0, text: '换到的词' }],
      source: 'netease',
    });
    const { result: r } = renderHook(() => useLyrics(track('t1'), 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));

    let ret: unknown = null;
    await act(async () => {
      ret = await r.current.retryByName();
    });
    expect(ret).not.toBeNull();
    expect(r.current.lyrics?.[0].text).toBe('换到的词');
    expect(r.current.source).toBe('netease');
    expect(apiMocks.fetchLyricsByName).toHaveBeenCalledWith('T', 'A', 100);
  });

  it('retryByName 没命中 → 保持上一次结果、返回 null', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    apiMocks.fetchLyricsByName.mockResolvedValue(null);
    const { result: r } = renderHook(() => useLyrics(track('t1'), 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));

    let ret: unknown = 'unset';
    await act(async () => {
      ret = await r.current.retryByName();
    });
    expect(ret).toBeNull();
    expect(r.current.lyrics).toHaveLength(1); // 上一次的词还在
    expect(r.current.source).toBe('qq');
  });

  it('retryByName 抛错 → 保持上一次结果、返回 null', async () => {
    apiMocks.fetchLyrics.mockResolvedValue(result);
    apiMocks.fetchLyricsByName.mockRejectedValue(new Error('boom'));
    const { result: r } = renderHook(() => useLyrics(track('t1'), 'qq'));
    await waitFor(() => expect(r.current.loading).toBe(false));

    let ret: unknown = 'unset';
    await act(async () => {
      ret = await r.current.retryByName();
    });
    expect(ret).toBeNull();
    expect(r.current.lyrics).toHaveLength(1);
  });
});
