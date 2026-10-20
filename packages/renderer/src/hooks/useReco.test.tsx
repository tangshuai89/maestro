/**
 * useReco 测试（此前零覆盖）。
 *
 * 契约（DeepSeek 推荐流程）：
 *  - 首挂拉一次 status（key 是否配好 + 库多大）；拉失败 → 按「没配 key」处理
 *  - 跑推荐前**重新**拉一次 status（防旧状态）
 *  - 没配 key → 弹 key 输入框（recoKeyOpen），不跑
 *  - 库为空 → 先自动导入各平台「我的喜欢」；一个都没导到 → 明确报错并**不跑**
 *  - 跑完 → 结果喂给 playSearch，并带上 loadMore（续播下一批，带 exclude 去重）
 *  - 结果为空 → 明确报错
 *  - 种子模式（「放点像这首的」）→ seed 传给 runReco
 *  - suggestions 从队列位置派生：正在播 + 接下来 2 张卡
 *  - 保存 key：太短 → 报错；成功 → 关弹窗 + 刷新 status
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  fetchRecoStatus: vi.fn(),
  runReco: vi.fn(),
  importLibrary: vi.fn(),
  saveRecoKey: vi.fn(),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

import { useReco } from './useReco';
import type { UnifiedSearchItem } from '../api';

const item = (title: string, artist = 'A', bestSource = 'qq') =>
  ({ id: title, title, artist, bestSource }) as unknown as UnifiedSearchItem;

const playSearch = vi.fn();
const setError = vi.fn();

function mount(over: { queueIdx?: number; queueUnifiedItems?: UnifiedSearchItem[] } = {}) {
  return renderHook(() =>
    useReco(playSearch, setError, over.queueIdx ?? -1, over.queueUnifiedItems),
  );
}

describe('useReco', () => {
  beforeEach(() => {
    playSearch.mockReset();
    setError.mockReset();
    apiMocks.fetchRecoStatus.mockReset().mockResolvedValue({ configured: true, librarySize: 10 });
    apiMocks.runReco.mockReset().mockResolvedValue({ items: [item('歌1')] });
    apiMocks.importLibrary.mockReset();
    apiMocks.saveRecoKey.mockReset().mockResolvedValue({ ok: true });
  });

  it('首挂拉一次 status', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());
    expect(result.current.recoStatus).toEqual({ configured: true, librarySize: 10 });
    expect(apiMocks.fetchRecoStatus).toHaveBeenCalled();
  });

  it('status 拉失败 → 按「没配 key」处理（不抛）', async () => {
    apiMocks.fetchRecoStatus.mockRejectedValue(new Error('boom'));
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());
    expect(result.current.recoStatus).toEqual({ configured: false, librarySize: 0 });
  });

  it('没配 key → 弹 key 框、不跑推荐', async () => {
    apiMocks.fetchRecoStatus.mockResolvedValue({ configured: false, librarySize: 0 });
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus?.configured).toBe(false));

    await act(async () => {
      await result.current.handleReco();
    });
    expect(result.current.recoKeyOpen).toBe(true);
    expect(apiMocks.runReco).not.toHaveBeenCalled();
  });

  it('库为空 → 先自动导入，导入到就继续跑推荐', async () => {
    apiMocks.fetchRecoStatus.mockResolvedValue({ configured: true, librarySize: 0 });
    apiMocks.importLibrary.mockResolvedValue({
      items: [item('x')],
      sources: [{ provider: 'netease', count: 3, error: null }],
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    expect(apiMocks.importLibrary).toHaveBeenCalled();
    expect(apiMocks.runReco).toHaveBeenCalled();
    expect(playSearch).toHaveBeenCalled();
  });

  it('一个都没导到 → 明确报错并**不跑**推荐', async () => {
    apiMocks.fetchRecoStatus.mockResolvedValue({ configured: true, librarySize: 0 });
    apiMocks.importLibrary.mockResolvedValue({
      items: [],
      sources: [{ provider: 'netease', count: 0, error: '未登录' }],
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    expect(apiMocks.runReco).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(expect.stringContaining('没有可导入'));
  });

  it('结果喂给 playSearch（index=0）并带上 loadMore', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    expect(playSearch).toHaveBeenCalledWith(
      [expect.objectContaining({ title: '歌1' })],
      0,
      expect.any(Function),
    );
  });

  it('loadMore 续下一批（带 exclude 去重）', async () => {
    apiMocks.runReco
      .mockResolvedValueOnce({ items: [item('歌1')] })
      .mockResolvedValueOnce({ items: [item('歌2')] });
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    const loadMore = playSearch.mock.calls[0][2] as () => Promise<UnifiedSearchItem[]>;
    let more: UnifiedSearchItem[] = [];
    await act(async () => {
      more = await loadMore();
    });
    expect(more[0].title).toBe('歌2');
    expect(apiMocks.runReco).toHaveBeenLastCalledWith(
      expect.objectContaining({ count: 10, exclude: [{ title: '歌1', artist: 'A' }] }),
    );
  });

  it('结果为空 → 明确报错', async () => {
    apiMocks.runReco.mockResolvedValue({ items: [] });
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    expect(setError).toHaveBeenCalledWith(expect.stringContaining('推荐没拿到结果'));
    expect(playSearch).not.toHaveBeenCalled();
  });

  it('种子模式 → seed 传给 runReco', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      result.current.handleRecoSeed('歌名', '艺人');
    });
    await waitFor(() => expect(apiMocks.runReco).toHaveBeenCalled());
    expect(apiMocks.runReco).toHaveBeenCalledWith(
      expect.objectContaining({ seed: { title: '歌名', artist: '艺人' } }),
    );
  });

  it('种子缺 title/artist → 不跑', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      result.current.handleRecoSeed('只有歌名');
    });
    expect(apiMocks.runReco).not.toHaveBeenCalled();
  });

  it('推荐抛错 → 明确报错，running 归位', async () => {
    apiMocks.runReco.mockRejectedValue(new Error('DeepSeek 挂了'));
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleReco();
    });
    expect(setError).toHaveBeenCalledWith(expect.stringContaining('推荐失败'));
    expect(result.current.recoRunning).toBe(false);
  });

  it('saveRecoKey：key 太短 → 报错、不请求', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleSaveRecoKey('short');
    });
    expect(setError).toHaveBeenCalledWith('key 太短');
    expect(apiMocks.saveRecoKey).not.toHaveBeenCalled();
  });

  it('saveRecoKey：成功 → 关弹窗 + 刷新 status', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());
    act(() => {
      result.current.setRecoKeyOpen(true);
    });
    expect(result.current.recoKeyOpen).toBe(true);

    const before = apiMocks.fetchRecoStatus.mock.calls.length;
    await act(async () => {
      await result.current.handleSaveRecoKey('sk-12345678');
    });
    expect(apiMocks.saveRecoKey).toHaveBeenCalledWith('sk-12345678');
    expect(result.current.recoKeyOpen).toBe(false);
    await waitFor(() => expect(apiMocks.fetchRecoStatus.mock.calls.length).toBe(before + 1));
  });

  it('saveRecoKey 失败 → 报错', async () => {
    apiMocks.saveRecoKey.mockRejectedValue(new Error('网络不通'));
    const { result } = mount();
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());

    await act(async () => {
      await result.current.handleSaveRecoKey('sk-12345678');
    });
    expect(setError).toHaveBeenCalledWith(expect.stringContaining('保存 key 失败'));
  });

  it('suggestions 从队列位置派生：正在播 + 接下来 2', async () => {
    const items = [item('a'), item('b'), item('c'), item('d')];
    const { result } = mount({ queueIdx: 1, queueUnifiedItems: items });
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());
    expect(result.current.suggestions.map((s) => s.title)).toEqual(['b', 'c', 'd']);
  });

  it('没有队列（idx=-1）→ suggestions 为空', async () => {
    const { result } = mount({ queueIdx: -1, queueUnifiedItems: [item('a')] });
    await waitFor(() => expect(result.current.recoStatus).not.toBeNull());
    expect(result.current.suggestions).toEqual([]);
  });
});
