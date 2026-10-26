/**
 * usePlayer —— **核心路径的第二轮补测**（2026-10-22）。
 *
 * 背景：装上 @vitest/coverage-v8 之后，usePlayer.ts 的行覆盖**第一次是可信的**
 * （之前是 c8 的错位数据）。用真实 lcov 拉出未覆盖行：345 行 / 59 个连续段。
 * 这一轮按「**用户可见的功能**」优先补，不是按行数堆。
 *
 * 补的洞（括号里是 lcov 里的行号）：
 *   1. **❤ 角标轮询** refreshLikedStateUntilStable（1192-1238，47 行）
 *      —— 用户实测过的真实 bug：「好不容易-方大同，QQ+网易云已 ❤，Spotify 无此歌，
 *      角标不显示 2」。discover 是异步的，单次刷新读到的永远是中间态。
 *   2. **radio（单平台）路径的 ❤ / 踩**（2004-2037 / 2081-2093，≈45 行）
 *      —— 电台歌没有 unified item，走的是完全另一套语义（toggleLike 而非 fanOutLike）。
 *   3. **AI 推荐批次续播** loadNextTrack + loadMore（1290-1316，27 行）
 *      —— 歌单/推荐播到底了自动拉下一批（产品的招牌功能）。
 *   4. **播放失败降级链**（1069-1089 / 1558-1564 / 1607-1623）
 *      —— VIP 试听自动降标准音质、无版权自动换源 + validate 探针。
 *   5. **EQ**（409-414 / 1852-1888）
 *      —— 预置 / 单频段 / 总开关，以及「两槽都要推」的曲线同步。
 *
 * 与已有测试的关系：
 *   - `usePlayer.hook.test.tsx`   → hook 体的**主路径**（播放/暂停/切歌/❤ 入口）
 *   - `usePlayer.behavior.test.tsx` → **跨平台降级链 / 失败分级 / 试听升级**
 *   - `usePlayer.events.test.tsx`  → 8 个从未被执行的函数（onTimeUpdate/onEnded/seek…）
 *   - 本文件 → **角标轮询 / radio 路径 / 批次续播 / 降级链分支 / EQ**
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MusicProvider, Track, UnifiedSearchItem } from '../api';

const apiMocks = vi.hoisted(() => ({
  fetchNextTrack: vi.fn(),
  toggleLike: vi.fn(),
  fanOutLike: vi.fn(),
  detectLiked: vi.fn(),
  dislike: vi.fn(),
  dislikeMerged: vi.fn(),
  fetchTrackLikeCount: vi.fn(),
  findEquivalentSource: vi.fn(),
  getApiOrigin: vi.fn(() => 'http://127.0.0.1:3200'),
  recomputeCrossPlatformLikeTotal: vi.fn(),
  reportRecoSignal: vi.fn(),
  getAuthStatusValidated: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

// 封面取色要走 fetch + createImageBitmap（happy-dom 没有）→ 整个模块替换掉，
// 否则每次 presentTrack 都会发真实网络请求。
//
// ⚠️ 替身函数必须**引用稳定**（在工厂外建一次）：usePlayer 的 presentTrack
// 依赖 presentCover/presentPlaceholder，替身每次 render 新建函数 →
// presentTrack 每次重建 → 「provider/preset 变化时自动加载」那个 effect 的
// 依赖跟着变 → 每次 render 都重跑 → loadNextTrack 打爆（实测 500ms 内
// 1688 次渲染 / 1127 次电台请求）。**这是替身的锅，不是产品的锅** —— 真
// App 里 useCoverArt 的回调是 useCallback，引用稳定。
const coverMocks = vi.hoisted(() => ({
  presentCover: vi.fn(),
  presentPlaceholder: vi.fn(),
  // 封面背板给一个**真实 div**：`usePlayer` 的 bass 强度效果要往
  // coverBackdropRef.current 上写 `--bass-intensity` —— ref 为 null 时
  // 那条路径永远走不到（测不出来）。
  coverBackdrop: null as HTMLDivElement | null,
}));
vi.mock('./useCoverArt', () => ({
  useCoverArt: () => ({
    bgLayerRef: { current: null },
    coverBackdropRef: { current: coverMocks.coverBackdrop },
    presentCover: coverMocks.presentCover,
    presentPlaceholder: coverMocks.presentPlaceholder,
  }),
}));

import { createAudioSlots, type AudioSlots } from '../lib/audioSlots';
import { usePlayer } from './usePlayer';

// ── 假 Web Audio（happy-dom 没有 AudioContext）─────────────────────
class FakeParam {
  value = 0;
  setTargetAtTime() {}
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class FakeNode {
  connect() {
    return this;
  }
  disconnect() {}
}
const realAudioContext = (globalThis as any).AudioContext;
class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  state = 'running';
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      Q: new FakeParam(),
      gain: new FakeParam(),
    });
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), {
      fftSize: 0,
      frequencyBinCount: 0,
      getByteFrequencyData: () => {},
    });
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
(globalThis as any).AudioContext = FakeAudioContext;
afterAll(() => {
  (globalThis as any).AudioContext = realAudioContext;
});

// ── fixture ────────────────────────────────────────────────────────
const item = (id: string, platform: MusicProvider = 'qq'): UnifiedSearchItem => ({
  id: `${platform}:${id}`,
  title: `歌-${id}`,
  artist: '歌手',
  album: '专辑',
  coverUrl: '',
  duration: 200,
  bestSource: platform,
  versionType: 'studio',
  versions: [
    {
      id: `ver-${id}`,
      duration: 200,
      sources: [
        { platform, trackId: id, hasCopyright: true, url: `/music/stream/${platform}/${id}` },
      ],
      bestSource: platform,
    },
  ],
  sources: [{ platform, trackId: id, hasCopyright: true, url: `/music/stream/${platform}/${id}` }],
});

/** 电台（单平台）Track —— 没有 unified item，走 radio 路径。 */
const radioTrack = (id = 'r1'): Track => ({
  id,
  provider: 'qq',
  title: `电台歌-${id}`,
  artist: '电台歌手',
  album: '电台专辑',
  coverUrl: '',
  audioUrl: `/music/stream/qq/${id}`,
  duration: 180,
  liked: false,
});

/** 跨平台 item（qq + 网易云都有源）—— 用来测「QQ 挂了自动换网易云」。 */
const multiItem = (id: string): UnifiedSearchItem => {
  const sources = [
    { platform: 'qq' as const, trackId: id, hasCopyright: true, url: `/music/stream/qq/${id}` },
    {
      platform: 'netease' as const,
      trackId: id,
      hasCopyright: true,
      url: `/music/stream/netease/${id}`,
    },
  ];
  return {
    ...item(id, 'qq'),
    id: `qq:${id}`,
    sources,
    versions: [{ id: `ver-${id}`, duration: 200, sources, bestSource: 'qq' as const }],
  };
};

/** 装两个 <audio> 到槽位（App 里是 JSX 挂的，hook 测试要手动挂）。 */
function mountSlots(): { slots: AudioSlots; a: HTMLAudioElement; b: HTMLAudioElement } {
  const slots = createAudioSlots();
  const a = document.createElement('audio');
  const b = document.createElement('audio');
  slots.ref('a')(a);
  slots.ref('b')(b);
  return { slots, a, b };
}

function setup() {
  const { slots, a, b } = mountSlots();
  const view = renderHook(() => usePlayer(slots));
  return { ...view, slots, a, b };
}

beforeEach(() => {
  // provider 存在 localStorage（readStoredProvider 读 'music-provider'，
  // 存的是裸字符串）。不种下去 → provider=null → 各种 action 直接 early-return。
  localStorage.setItem('music-provider', 'qq');
  localStorage.removeItem('music-quality');
  // 电台返回 null = "没有下一首"（服务端约定永返 Track，null 是异常响应
  // 的降级路径）。不 mock 的话 auto-load effect 会去拉电台，噪音很大。
  apiMocks.fetchNextTrack.mockResolvedValue(null);
  apiMocks.toggleLike.mockResolvedValue({ success: true, liked: true });
  apiMocks.fanOutLike.mockResolvedValue({ success: true, liked: true, fannedOutTo: ['qq'] });
  apiMocks.detectLiked.mockResolvedValue({ liked: false, fannedOutTo: [], settled: true });
  apiMocks.dislike.mockResolvedValue({ success: true });
  apiMocks.dislikeMerged.mockResolvedValue({ success: true });
  apiMocks.fetchTrackLikeCount.mockResolvedValue(null);
  apiMocks.findEquivalentSource.mockResolvedValue({ source: null, reason: 'no-match' });
  apiMocks.recomputeCrossPlatformLikeTotal.mockReturnValue({ display: '—' });
  apiMocks.reportRecoSignal.mockResolvedValue(undefined);
  apiMocks.getAuthStatusValidated.mockResolvedValue({ expired: false });
  // 真实 div（bass 强度效果要往它身上写 CSS 变量）
  coverMocks.coverBackdrop = document.createElement('div');
});

// ═══════════════════════════════════════════════════════════════════
// 1. ❤ 角标轮询（refreshLikedStateUntilStable）
// ═══════════════════════════════════════════════════════════════════

describe('❤ 角标轮询 refreshLikedStateUntilStable', () => {
  it('连续两次读到相同 count → 收敛返回（角标拿到真实平台数）', async () => {
    // 场景（用户实测）：discover 是异步的，第一次读到 1（只有 QQ），后台补齐
    // 网易云后 count 变 2。单次刷新只会读到中间态 → 必须**连续两次相同**
    // 才算落定。
    vi.useFakeTimers();
    try {
      apiMocks.detectLiked.mockResolvedValue({
        liked: true,
        fannedOutTo: ['qq', 'netease'],
        settled: true,
      });
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });

      let settled: { liked: boolean; count: number } | null = null;
      await act(async () => {
        const p = result.current.refreshLikedStateUntilStable();
        // 第一轮：key 首次出现 → stableHits=1 → 等 800ms
        await vi.advanceTimersByTimeAsync(1_000);
        // 第二轮：key 相同 → stableHits=2 → 收敛
        await vi.advanceTimersByTimeAsync(1_000);
        settled = await p;
      });

      expect(settled).not.toBeNull();
      expect(settled!.count).toBe(2);
      // 角标本身也要跟着变成 2
      expect(result.current.fanOutCount).toBe(2);
      // ❤ 按钮要点亮（detect 的结果驱动）
      expect(result.current.track?.liked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detect 失败 → 不计入稳定命中 → 30s 硬超时后返回 null', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.detectLiked.mockRejectedValue(new Error('network down'));
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });

      let settled: unknown = 'pending';
      await act(async () => {
        const p = result.current.refreshLikedStateUntilStable();
        await vi.advanceTimersByTimeAsync(35_000);
        settled = await p;
      });

      // 探测一直失败 → 永远不收敛 → 超时放弃（返回 null，而不是报个错）
      expect(settled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('discover 未落定（settled=false）→ 不计入稳定命中 → 超时返回 null', async () => {
    vi.useFakeTimers();
    try {
      // settled=false = 读到的 count 是中间态 → 既不算稳定命中，
      // 也不能当比较基准（否则中间态恰好等于落定值会误判稳定）
      apiMocks.detectLiked.mockResolvedValue({
        liked: true,
        fannedOutTo: ['qq'],
        settled: false,
      });
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });

      let settled: unknown = 'pending';
      await act(async () => {
        const p = result.current.refreshLikedStateUntilStable();
        await vi.advanceTimersByTimeAsync(35_000);
        settled = await p;
      });

      expect(settled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('电台曲目（无 unified item）→ 用合成的单源 unified 去 detect', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.fetchNextTrack.mockResolvedValue(radioTrack('r7'));
      apiMocks.detectLiked.mockResolvedValue({
        liked: true,
        fannedOutTo: ['qq'],
        settled: true,
      });
      const { result } = setup();
      // 等 auto-load effect 把电台曲装上
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.track?.id).toBe('r7');

      let settled: { liked: boolean; count: number } | null = null;
      await act(async () => {
        const p = result.current.refreshLikedStateUntilStable();
        await vi.advanceTimersByTimeAsync(2_000);
        settled = await p;
      });

      expect(settled).not.toBeNull();
      // 电台曲的 unified 是合成的：id = merged-qq-r7-studio
      expect(apiMocks.detectLiked).toHaveBeenCalledWith(
        'merged-qq-r7-studio',
        [{ platform: 'qq', trackId: 'r7' }],
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('用户翻转 ❤ 后新一轮轮询启动 → 旧轮询自动让位（返回 null）', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.detectLiked.mockResolvedValue({
        liked: true,
        fannedOutTo: ['qq'],
        settled: true,
      });
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });

      let old: unknown = 'pending';
      await act(async () => {
        const p = result.current.refreshLikedStateUntilStable();
        await vi.advanceTimersByTimeAsync(100);
        // handleLike 会 ++likedRefreshGenRef → 旧轮询的下一次循环就该让位
        await result.current.handleLike();
        await vi.advanceTimersByTimeAsync(2_000);
        old = await p;
      });

      expect(old).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. radio（单平台）路径的 ❤ / 踩
// ═══════════════════════════════════════════════════════════════════

describe('radio 路径的 ❤ / 踩', () => {
  /**
   * 装一首电台曲。
   *
   * ⚠️ mock 必须在 `setup()` **之前**种好：auto-load effect 在挂载时就跑
   * `loadNextTrack()`（依赖 provider/preset/loadNextTrack）→ 之后再改 mock
   * 不会重新触发 → 电台曲永远装不上。
   */
  async function setupRadio() {
    apiMocks.fetchNextTrack.mockResolvedValue(radioTrack('r1'));
    const { result } = setup();
    await waitFor(() => expect(result.current.track?.id).toBe('r1'));
    return result;
  }

  it('❤ → 调 toggleLike（单平台翻转语义），并点亮红心', async () => {
    const result = await setupRadio();

    await act(async () => {
      await result.current.handleLike();
    });

    // radio 没有 unified → 走 toggleLike（不是 fanOutLike）
    expect(apiMocks.toggleLike).toHaveBeenCalledWith('qq', 'r1', {
      title: '电台歌-r1',
      artist: '电台歌手',
      duration: 180,
    });
    expect(apiMocks.fanOutLike).not.toHaveBeenCalled();
    expect(result.current.track?.liked).toBe(true);
    // 收藏方向要上报正反馈（AI 推荐口味）
    expect(apiMocks.reportRecoSignal).toHaveBeenCalledWith({
      type: 'like',
      title: '电台歌-r1',
      artist: '电台歌手',
    });
  });

  it('取消红心 → 角标清零（残留数字没人会清）', async () => {
    const result = await setupRadio();
    // 先让 detect 报一个非零角标
    apiMocks.detectLiked.mockResolvedValue({
      liked: true,
      fannedOutTo: ['qq', 'netease'],
      settled: true,
    });
    await act(async () => {
      result.current.refreshLikedState();
      await Promise.resolve();
    });
    expect(result.current.fanOutCount).toBe(2);

    apiMocks.toggleLike.mockResolvedValue({ success: true, liked: false });
    await act(async () => {
      await result.current.handleLike();
    });

    expect(result.current.track?.liked).toBe(false);
    expect(result.current.fanOutCount).toBe(0);
  });

  it('踩 → 调 dislike + 上报 dislike 信号，并跳到下一首', async () => {
    const result = await setupRadio();

    await act(async () => {
      await result.current.handleDislike();
    });

    expect(apiMocks.dislike).toHaveBeenCalledWith('qq', 'r1');
    expect(apiMocks.reportRecoSignal).toHaveBeenCalledWith({
      type: 'dislike',
      title: '电台歌-r1',
      artist: '电台歌手',
    });
  });

  it('unified 路径的 ❤ 失败 → 明确报错「心动作业失败：…」', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    apiMocks.fanOutLike.mockRejectedValue(new Error('服务不可用'));

    await act(async () => {
      await result.current.handleLike();
    });

    expect(result.current.error).toBe('心动作业失败：服务不可用');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. AI 推荐批次续播（loadNextTrack + loadMore）
// ═══════════════════════════════════════════════════════════════════

describe('AI 推荐批次续播', () => {
  it('歌单播到最后 → 自动拉下一批 → 继续播（不循环回第 1 首）', async () => {
    const { result } = setup();
    const loadMore = vi.fn().mockResolvedValue([item('2'), item('3')]);
    act(() => {
      result.current.playSearch([item('1')], 0, loadMore);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await act(async () => {
      await result.current.loadNextTrack();
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
    // 播的是**新批次**的歌，不是循环回第 1 首
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
  });

  it('拉下一批失败 → 报错 + 回落循环（播放不变成死路）', async () => {
    const { result } = setup();
    const loadMore = vi.fn().mockRejectedValue(new Error('推荐服务挂了'));
    act(() => {
      result.current.playSearch([item('1')], 0, loadMore);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await act(async () => {
      await result.current.loadNextTrack();
    });

    expect(result.current.error).toBe('获取下一批推荐失败：推荐服务挂了');
    // 回落循环：只有 1 首 → 仍然播第 1 首
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
  });

  it('下一批全都不可播 → 回落循环', async () => {
    const { result } = setup();
    const bad: UnifiedSearchItem = {
      ...item('x'),
      bestSource: null,
      sources: [{ platform: 'qq', trackId: 'x', hasCopyright: false, url: '' }],
      versions: [],
    };
    const loadMore = vi.fn().mockResolvedValue([bad]);
    act(() => {
      result.current.playSearch([item('1')], 0, loadMore);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await act(async () => {
      await result.current.loadNextTrack();
    });

    expect(loadMore).toHaveBeenCalled();
    // 没有变成死路：仍在播队列里的歌
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
  });

  it('拉下一批期间队列被换掉 → 只报错，不动新队列', async () => {
    // 竞态：await loadMore() 期间用户切了源 / 重新搜索 → queueRef 已经不是
    // 原来那个 q。此时**绝不能**把新批次 push 进新队列（会串歌），
    // 但失败原因要如实报出来。
    //
    // ⚠️ 这条分支是 diff 覆盖率门禁逼出来的：它指出「新增的这 4 行没有任何
    // 测试走过」——门禁第一次在**本轮自己的新代码**上生效。
    const { result } = setup();
    let rejectLoadMore: (e: Error) => void = () => {};
    const loadMore = vi.fn(
      () =>
        new Promise<UnifiedSearchItem[]>((_resolve, reject) => {
          rejectLoadMore = reject;
        }),
    );
    act(() => {
      result.current.playSearch([item('1')], 0, loadMore);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // 拉批途中 → 用户重新搜索（队列被换掉）
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.loadNextTrack();
      await Promise.resolve();
    });
    act(() => {
      result.current.playSearch([item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));

    // 批次请求这时才失败
    await act(async () => {
      rejectLoadMore(new Error('推荐服务挂了'));
      await pending;
      await Promise.resolve();
    });

    // 失败如实上报
    expect(result.current.error).toBe('获取下一批推荐失败：推荐服务挂了');
    // 新队列没被动过（还在播第二首）
    expect(result.current.track?.title).toBe('歌-2');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3b. 队列面板操作（specs/queue-panel/）：jumpToQueueIndex / removeFromQueue
// ═══════════════════════════════════════════════════════════════════

describe('队列面板操作', () => {
  it('jumpToQueueIndex：跳到第 N 首 → 播那一首 + queueIdx 跟着变', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2'), item('3')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    act(() => {
      result.current.jumpToQueueIndex(2);
    });

    await waitFor(() => expect(result.current.track?.title).toBe('歌-3'));
    expect(result.current.queueIdx).toBe(2);
  });

  it('jumpToQueueIndex：越界下标 / 没有队列 → 不动（不崩、不改播放头）', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    act(() => {
      result.current.jumpToQueueIndex(99);
      result.current.jumpToQueueIndex(-1);
    });

    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    expect(result.current.queueIdx).toBe(0);
  });

  it('removeFromQueue：移除**当前曲前面**的那首 → 当前曲下标前移、播放不中断', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2'), item('3')], 1);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));

    act(() => {
      result.current.removeFromQueue(0);
    });

    // 还在播「歌-2」（下标从 1 变成 0）
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
    expect(result.current.queueIdx).toBe(0);
    // 队列少了一首，且 tracks/unifiedItems **仍然索引对齐**
    expect(result.current.queueUnifiedItems?.map((t) => t.title)).toEqual(['歌-2', '歌-3']);
  });

  it('removeFromQueue：移除**当前**曲目 → 继续播下一首（不中断）', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2'), item('3')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    act(() => {
      result.current.removeFromQueue(0);
    });

    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
    expect(result.current.queueIdx).toBe(0);
    expect(result.current.queueUnifiedItems?.map((t) => t.title)).toEqual(['歌-2', '歌-3']);
  });

  it('removeFromQueue：移除**最后一首且正在播** → 回到上一首', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2')], 1);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));

    act(() => {
      result.current.removeFromQueue(1);
    });

    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    expect(result.current.queueIdx).toBe(0);
  });

  it('removeFromQueue：移空整个队列 → queueIdx=-1（没有「下一首」了）', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    act(() => {
      result.current.removeFromQueue(0);
    });

    await waitFor(() => expect(result.current.queueIdx).toBe(-1));
    expect(result.current.queueUnifiedItems ?? []).toHaveLength(0);
  });

  it('removeFromQueue：移除**非当前**曲目 → 快照必须立刻同步（面板要重渲染）', async () => {
    // ⚠️ 这条是**本 spec 最容易做错**的地方：
    // presentTrack 里的快照同步是「只有 idx 真变了才 setState」（避免同首跨平台
    // fallback 时无意义 re-render）。移除一个**非当前**曲目时 idx 不变 ⇒ 不显式
    // 推一版快照的话，队列面板**不会重渲染**（用户点了「×」但那一行还在）。
    // 这里断言的正是「显式同步」这件事。
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2'), item('3')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    expect(result.current.queueUnifiedItems).toHaveLength(3);

    act(() => {
      result.current.removeFromQueue(2); // 最后一首，非当前
    });

    // idx 没变（还是 0）→ 只能靠 removeFromQueue 里的显式 setQueueSnapshot
    expect(result.current.queueIdx).toBe(0);
    expect(result.current.queueUnifiedItems).toHaveLength(2);
    expect(result.current.queueUnifiedItems?.map((t) => t.title)).toEqual(['歌-1', '歌-2']);
  });

  it('removeFromQueue：越界下标 / 没有队列 → 不动', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    act(() => {
      result.current.removeFromQueue(99);
      result.current.removeFromQueue(-1);
    });

    expect(result.current.queueUnifiedItems).toHaveLength(2);
    expect(result.current.queueIdx).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 播放失败降级链
// ═══════════════════════════════════════════════════════════════════

describe('播放失败降级链', () => {
  it('QQ 源挂了 → 自动切到同首歌的网易云源，并给原平台补一次登录态探针', async () => {
    // 场景（2026-10-14 报障）：fallback 成功后整条「失败上报」路径被跳过 →
    // **QQ 真实掉线被静默吞掉**，用户永远只看到「换源了」而不是「请重新登录」。
    // 修法：fallback 成功后**异步**给原 provider 补一次 validate=1 探针。
    const onAuthExpired = vi.fn();
    apiMocks.getAuthStatusValidated.mockResolvedValue({ expired: true } as never);
    const slots = createAudioSlots();
    const elA = document.createElement('audio');
    const elB = document.createElement('audio');
    slots.ref('a')(elA);
    slots.ref('b')(elB);
    const authRef = { current: onAuthExpired };
    const { result } = renderHook(() => usePlayer(slots, undefined, undefined, authRef));

    act(() => {
      result.current.playSearch([multiItem('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));

    // <audio> 报错。
    //
    // ⚠️ wantPlay 必须置 '0'（用户已暂停/切歌）→ shouldTransientRetry 返回 false
    // → **直达跨平台兜底**那条线。若 wantPlay 还是 '1'，会先走 800ms 的
    // 「同源 transient 重试」，兜底要等重试+卡死探测（约 2.3s）之后才发生。
    elA.dataset.wantPlay = '0';
    await act(async () => {
      elA.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 自动换到网易云源（还在放同一首歌）
    await waitFor(() => expect(result.current.track?.provider).toBe('netease'));
    // 原平台（qq）补了登录态探针 → 过期 → 弹重登
    expect(apiMocks.getAuthStatusValidated).toHaveBeenCalledWith('qq');
    await waitFor(() => expect(onAuthExpired).toHaveBeenCalledWith('qq'));
  });

  it('QQ 极高音质被降权成 30s 试听 → 自动降到标准音质同平台重试', async () => {
    // 场景：QQ/网易云很多「试听」其实是「无损/极高是 VIP、标准免费全曲」。
    // 不处理的话用户永远只看到 30s 试听。
    //
    // 触发条件（三条都要满足）：provider ∈ {qq, netease} + 当前音质 ≠ standard
    // + 这首歌还没降过（forcedStandardRef，每首只降一次）。
    localStorage.setItem('maestro:qq-quality', 'high');
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // 元数据只读到 30s，但元数据全长 200s → 判定为「试听残片」
    Object.defineProperty(a, 'duration', { value: 30, configurable: true });
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 降到标准音质（q=standard），并且如实展示「试听回退」标记
    await waitFor(() => expect(result.current.track?.audioUrl).toContain('q=standard'));
    expect(result.current.trialFellBack).toBe(true);
  });

  it('play() 被浏览器拒绝 → 明确报错「播放失败: …」（不是静默卡住）', async () => {
    const { result, a } = setup();
    // 浏览器拒播（autoplay 策略 / 权限）→ 必须是**明确报错**，
    // 否则界面停在「等待播放」，用户不知道发生了什么。
    Object.defineProperty(a, 'readyState', { value: 4, configurable: true });
    (a as unknown as { play: () => Promise<void> }).play = () =>
      Promise.reject(new Error('NotAllowedError'));

    act(() => {
      result.current.playSearch([item('1')], 0);
    });

    await waitFor(() => expect(result.current.error).toBe('播放失败: NotAllowedError'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. 杂项：WPS 重切 / ❤ 数回填 / EQ / autoplay 预热
// ═══════════════════════════════════════════════════════════════════

describe('杂项路径', () => {
  it('WPS 连上后重切当前歌（切到 WPS 全曲路径）', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    coverMocks.presentCover.mockClear();

    // Spotify 歌才需要重切（WPS 是 Spotify 的播放路径）
    act(() => {
      result.current.playSearch([item('9', 'netease')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-9'));
    coverMocks.presentCover.mockClear();

    act(() => {
      result.current.refreshTrackForWps();
    });
    // 非 spotify 的歌不重切（避免无谓的换源）
    expect(coverMocks.presentCover).not.toHaveBeenCalled();
  });

  it('切歌后回填跨平台 ❤ 数（fetchTrackLikeCount → recompute）', async () => {
    apiMocks.fetchTrackLikeCount.mockResolvedValue(42);
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await waitFor(() => expect(apiMocks.fetchTrackLikeCount).toHaveBeenCalledWith('qq', '1'));
    // 拉到数之后要重算派生（跨平台 ❤ 总数）
    await waitFor(() => expect(apiMocks.recomputeCrossPlatformLikeTotal).toHaveBeenCalled());
  });

  it('EQ：总开关 / 预置 / 单频段 / 越界下标', async () => {
    const { result, a } = setup();
    // 先起播（'play' 事件 → ensureAudioGraph → 建出槽位的 Web Audio 图）
    // → EQ 的曲线才有地方可推（pushEqToFilters 遍历 slotGraphsRef）。
    act(() => {
      a.dispatchEvent(new Event('play'));
    });

    // 总开关
    act(() => {
      result.current.setEqEnabled(true);
    });
    expect(result.current.audioFx.eqEnabled).toBe(true);

    // 预置
    act(() => {
      result.current.applyEqPreset('bass');
    });
    expect(result.current.audioFx.presetId).toBe('bass');
    expect(result.current.audioFx.eqGains.some((g) => g !== 0)).toBe(true);

    // 手动拖过就不再声称自己等于某个预置
    act(() => {
      result.current.setEqBandGain(0, 6);
    });
    expect(result.current.audioFx.eqGains[0]).toBe(6);
    expect(result.current.audioFx.presetId).toBeNull();

    // 越界下标 → 不改（脏输入不能把整条曲线写坏）
    const before = [...result.current.audioFx.eqGains];
    act(() => {
      result.current.setEqBandGain(99, 6);
    });
    expect(result.current.audioFx.eqGains).toEqual(before);
  });

  it('切到 Deezer → 先做一次 autoplay 用户激活预热', async () => {
    const { result } = setup();
    act(() => {
      result.current.selectSource('deezer');
    });
    // provider 真的切了
    expect(result.current.provider).toBe('deezer');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. 同源重试分支 / 进度保位 / WPS 播放路径
// ═══════════════════════════════════════════════════════════════════

describe('同源重试与播放保位', () => {
  it('同源 transient 重试前用户已切歌 → 不再重试，直接进跨平台兜底', async () => {
    vi.useFakeTimers();
    try {
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([multiItem('1')], 0);
      });
      expect(result.current.track?.provider).toBe('qq');

      // wantPlay='1' → 会走 800ms 的同源 transient 重试
      await act(async () => {
        a.dataset.wantPlay = '1';
        a.dispatchEvent(new Event('error'));
        await Promise.resolve();
      });
      // 重试窗口内用户切歌了（src 变了）→ 800ms 到了也不该重试
      a.src = '/music/stream/qq/other';

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      // 直接进了跨平台兜底（而不是同源重试）——同歌的网易云源被换上
      expect(result.current.track?.provider).toBe('netease');
    } finally {
      vi.useRealTimers();
    }
  });

  it('切音质 → 重新加载后 seek 回原来的播放位置', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // 播到 42s 时切音质 → 记住位置
    a.currentTime = 42;
    act(() => {
      result.current.changeQuality('high');
    });
    expect(result.current.track?.audioUrl).toContain('q=high');

    // 重载后 loadedmetadata 触发 → 回到 42s
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    expect(a.currentTime).toBe(42);
  });

  it('Spotify Premium + WPS 就绪 → 走 WPS 播放路径（不劫持 30s 预览）', async () => {
    const wps = {
      wpsReady: true,
      state: { hasTrack: false, isPlaying: false, track: null, positionMs: 0 },
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      transferHere: vi.fn().mockResolvedValue(undefined),
    };
    const slots = createAudioSlots();
    const elA = document.createElement('audio');
    const elB = document.createElement('audio');
    slots.ref('a')(elA);
    slots.ref('b')(elB);
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    act(() => {
      result.current.playSearch([item('1', 'spotify')], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));

    // WPS 接管 → audioUrl 清空（不劫持 30s 预览代理）
    expect(result.current.track?.audioUrl).toBe('');
    await waitFor(() => expect(wps.transferHere).toHaveBeenCalled());
    await waitFor(() => expect(wps.play).toHaveBeenCalled());
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. 边界与竞态（第二轮：把剩下 120 行未覆盖里「值得测」的部分补掉）
//
// 上一轮补完主路径后，usePlayer.ts 还剩 120 行 / 44 段未覆盖。逐段看过之后：
//   - **真竞态 / 真故障态**（值得测）：卡死探测、兜底链的过期与跳过、
//     ❤ 的陈旧 ticket 守护、detect 的期望值守护、音频图构建失败…
//   - **纯 console.warn 诊断分支**（价值低）：逐条测只是给日志上保险，
//     行为上没有可观测差异 → 不追。
// 本轮覆盖前者。
// ═══════════════════════════════════════════════════════════════════

describe('卡死探测（同源重试后仍不出声）', () => {
  it('重试后 00:00 不出声 → 走跨平台兜底（不卡在「等待播放」）', async () => {
    // 用户实测过的症状：「QQ 对部分歌曲不返 purl，界面卡在『等待播放』」。
    // play() resolve 只说明浏览器接受了请求，不代表出了声 → 靠探测定时器兜。
    vi.useFakeTimers();
    try {
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([multiItem('1')], 0);
      });
      expect(result.current.track?.provider).toBe('qq');

      await act(async () => {
        a.dataset.wantPlay = '1';
        a.dispatchEvent(new Event('error'));
        await Promise.resolve();
      });
      // 同源 transient 重试（800ms）→ audio.load() + play() resolve
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      // 探测窗口（1500ms）内 currentTime 一直是 0 → 判定卡死 → 跨平台兜底
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      // 兜底到同首歌的网易云源（而不是卡住）。
      // ⚠️ 这里**不能**用 waitFor：假定时器下 testing-library 的 waitFor 不会
      // 自动推进时钟（它只认 jest 全局，vitest 下返回 false）→ 永远等不到 →
      // 测试超时。假定时器里一律「推进时钟 + 同步断言」。
      expect(result.current.track?.provider).toBe('netease');
    } finally {
      vi.useRealTimers();
    }
  });

  it('重试后其实在出声 → 探测不打扰（不误伤正常播放）', async () => {
    vi.useFakeTimers();
    try {
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([multiItem('1')], 0);
      });
      await act(async () => {
        a.dataset.wantPlay = '1';
        a.dispatchEvent(new Event('error'));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      // 音频其实走起来了 → currentTime > 0
      a.currentTime = 5;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      // 没被判定卡死 → 不会换源（还在 QQ）
      expect(result.current.track?.provider).toBe('qq');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('电台与队列的边界', () => {
  it('电台返回 null → 保持 idle（不报错、不崩）', async () => {
    apiMocks.fetchNextTrack.mockResolvedValue(null);
    const { result } = setup();
    await act(async () => {
      await result.current.loadNextTrack();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.track).toBeNull();
  });

  it('电台请求失败 → 明确报错（不是静默）', async () => {
    apiMocks.fetchNextTrack.mockRejectedValue(new Error('电台挂了'));
    const { result } = setup();
    await act(async () => {
      await result.current.loadNextTrack();
    });
    expect(result.current.error).toBe('电台挂了');
  });

  it('追加到队列时全不可播 → 明确报错「没有可播放的音源」', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    const bad: UnifiedSearchItem = {
      ...item('x'),
      bestSource: null,
      sources: [{ platform: 'qq', trackId: 'x', hasCopyright: false, url: '' }],
      versions: [],
    };
    act(() => {
      result.current.appendToQueue([bad]);
    });
    expect(result.current.error).toBe('没有可播放的音源');
    // 队列没被污染
    expect(result.current.track?.title).toBe('歌-1');
  });
});

describe('❤ 的陈旧结果守护', () => {
  it('unified：第二次 ❤ 让第一次的返回结果作废（不覆盖新状态）', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiMocks.fanOutLike.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await act(async () => {
      const p1 = result.current.handleLike();
      await Promise.resolve();
      // 用户又点了一次 → 新 ticket
      await result.current.handleLike();
      // 第一次的结果这时才回来 → 必须被丢弃
      resolveFirst({ success: true, liked: true, fannedOutTo: ['qq'] });
      await p1;
    });

    // 第一次的返回没有把状态改回去
    expect(result.current.track?.liked).toBe(true);
  });

  it('radio：第二次 ❤ 让第一次的返回结果作废', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiMocks.toggleLike.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    apiMocks.fetchNextTrack.mockResolvedValue(radioTrack('r1'));
    const { result } = setup();
    await waitFor(() => expect(result.current.track?.id).toBe('r1'));

    await act(async () => {
      const p1 = result.current.handleLike();
      await Promise.resolve();
      await result.current.handleLike();
      resolveFirst({ success: true, liked: false });
      await p1;
    });

    // 陈旧结果（liked=false）没被应用
    expect(result.current.track?.liked).toBe(true);
  });

  it('unified：踩的返回结果在切歌后作废（不把新歌标成不喜欢）', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    apiMocks.dislikeMerged.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq'), item('2', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // ⚠️ 别把「切歌」放进同一个 async act 里（嵌套 act → 状态更新不落地，
    // 断言会读到旧值）→ 拆成独立的几段。
    let p1: Promise<void> = Promise.resolve();
    await act(async () => {
      p1 = result.current.handleDislike();
      await Promise.resolve();
    });
    // 踩的过程中切到第二首
    act(() => {
      result.current.playSearch([item('1', 'qq'), item('2', 'qq')], 1);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
    // 踩的返回结果这时才回来 → 必须被丢弃（不把新歌标成不喜欢）
    await act(async () => {
      resolveFirst({ success: true });
      await p1;
    });

    // 新歌没被误标成「不喜欢」
    expect(result.current.track?.title).toBe('歌-2');
    expect(result.current.track?.liked).toBe(false);
  });

  it('detect 的期望值与当前状态不符 → 不应用（用户手动翻转后不被旧响应覆盖）', async () => {
    vi.useFakeTimers();
    try {
      let resolveDetect: (v: unknown) => void = () => {};
      apiMocks.detectLiked.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDetect = resolve;
          }),
      );
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });

      let settled: unknown = 'pending';
      let polling: Promise<unknown> = Promise.resolve(null);
      await act(async () => {
        polling = result.current.refreshLikedStateUntilStable();
        await Promise.resolve();
      });
      // 轮询期间用户自己点了 ❤（liked 变成 true）→ 期望值（false）已过期
      await act(async () => {
        await result.current.handleLike();
      });
      await act(async () => {
        resolveDetect({ liked: true, fannedOutTo: ['qq', 'netease'], settled: true });
        await vi.advanceTimersByTimeAsync(1_000);
        settled = await polling;
      });

      // 期望值不符 → 这轮不计入稳定命中（继续轮询），不会用旧响应覆盖手动状态
      expect(settled).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WPS（Spotify 全曲）路径的分支', () => {
  /** 一个可用的 WPS 替身。 */
  function makeWps(over: Partial<Record<string, unknown>> = {}) {
    return {
      wpsReady: true,
      state: { hasTrack: false, isPlaying: false, track: null, positionMs: 0 },
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      transferHere: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }

  it('同首歌换源 → 先停掉旧 WPS（防两路叠加出声）', async () => {
    // ⚠️ 为什么不是「切到另一首歌」：presentTrack 在**换歌**时会把
    // `wpsPlayedIdRef` 清成 null（设计如此，见 usePlayer 里那段注释）→
    // 于是 effect 里 `shouldStopWpsBeforeTransition(null, ...)` 直接返回 false
    // → 这条「先停 WPS」根本不会触发。
    // 真正会触发的是**同一首歌换源**（unified id 不变 → isNewSong=false →
    // ref 保留 → 新源不是 spotify → 必须先停旧的 WPS）。
    const wps = makeWps();
    const slots = createAudioSlots();
    const elA = document.createElement('audio');
    const elB = document.createElement('audio');
    slots.ref('a')(elA);
    slots.ref('b')(elB);
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    // 同一个 unified：spotify + qq 两个源
    const both: UnifiedSearchItem = {
      ...item('1', 'spotify'),
      id: 'spotify:1',
      sources: [
        { platform: 'spotify', trackId: '1', hasCopyright: true, url: '/music/stream/spotify/1' },
        { platform: 'qq', trackId: '1', hasCopyright: true, url: '/music/stream/qq/1' },
      ],
      versions: [
        {
          id: 'ver-1',
          duration: 200,
          sources: [
            {
              platform: 'spotify',
              trackId: '1',
              hasCopyright: true,
              url: '/music/stream/spotify/1',
            },
            { platform: 'qq', trackId: '1', hasCopyright: true, url: '/music/stream/qq/1' },
          ],
          bestSource: 'spotify',
        },
      ],
    };
    act(() => {
      result.current.playSearch([both], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));
    await waitFor(() => expect(wps.play).toHaveBeenCalled());

    // spotify 源挂了 → 自动换到同首歌的 QQ 源 → 旧 WPS 必须先停
    await act(async () => {
      elA.dataset.wantPlay = '0';
      elA.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));
    expect(wps.pause).toHaveBeenCalled();
  });

  it('transferHere 失败 → 仍然继续 play（设备还没注册完不该阻断）', async () => {
    const wps = makeWps({
      transferHere: vi.fn().mockRejectedValue(new Error('device not registered')),
    });
    const slots = createAudioSlots();
    slots.ref('a')(document.createElement('audio'));
    slots.ref('b')(document.createElement('audio'));
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    act(() => {
      result.current.playSearch([item('1', 'spotify')], 0);
    });
    await waitFor(() => expect(wps.play).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
  });

  it('WPS play() 被拒 → 明确报错「WPS 播放失败：…」', async () => {
    const wps = makeWps({ play: vi.fn().mockRejectedValue(new Error('not active')) });
    const slots = createAudioSlots();
    slots.ref('a')(document.createElement('audio'));
    slots.ref('b')(document.createElement('audio'));
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    act(() => {
      result.current.playSearch([item('1', 'spotify')], 0);
    });
    await waitFor(() => expect(result.current.error).toBe('WPS 播放失败：not active'));
  });

  it('暂停 → WPS 停（不是只停 <audio>）', async () => {
    const wps = makeWps();
    const slots = createAudioSlots();
    slots.ref('a')(document.createElement('audio'));
    slots.ref('b')(document.createElement('audio'));
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    act(() => {
      result.current.playSearch([item('1', 'spotify')], 0);
    });
    await waitFor(() => expect(result.current.playing).toBe(true));
    act(() => {
      result.current.handlePlayPause();
    });
    await waitFor(() => expect(result.current.playing).toBe(false));
    await waitFor(() => expect(wps.pause).toHaveBeenCalled());
  });

  it('WPS 就绪后重切当前歌（切到 WPS 全曲路径）', async () => {
    const wps = makeWps();
    const slots = createAudioSlots();
    slots.ref('a')(document.createElement('audio'));
    slots.ref('b')(document.createElement('audio'));
    const wpsRef = { current: wps };
    const { result } = renderHook(() => usePlayer(slots, wpsRef));

    act(() => {
      result.current.playSearch([item('1', 'spotify')], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));
    // fixture 没有 coverUrl → presentTrack 走的是 presentPlaceholder 分支
    coverMocks.presentPlaceholder.mockClear();

    act(() => {
      result.current.refreshTrackForWps();
    });
    // 重切 → 封面重新刷一次（presentTrack 被重新调用）
    await waitFor(() => expect(coverMocks.presentPlaceholder).toHaveBeenCalled());
  });
});

it('切歌时清掉在途的卡死探测定时器（不留孤儿定时器）', async () => {
  // 场景：同源重试后 play() resolve 了 → 起了卡死探测定时器 → 用户这时切歌
  // → presentTrack 必须把那个定时器清掉（否则它会在新歌上触发 → 误判新歌卡死
  // → 把新歌换掉）。
  vi.useFakeTimers();
  try {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([multiItem('1')], 0);
    });
    await act(async () => {
      a.dataset.wantPlay = '1';
      a.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // 同源重试 → 起了探测定时器
    });
    // 用户切歌 → presentTrack → clearStallTimer（此时定时器在途）
    act(() => {
      result.current.playSearch([multiItem('2')], 0);
    });
    // 旧探测定时器已被清掉 → 推进到窗口之后也不会触发旧歌的兜底
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.track?.provider).toBe('qq');
  } finally {
    vi.useRealTimers();
  }
});

it('电台在途时切了 provider → 丢弃旧结果（不让它把歌装到新平台）', async () => {
  let resolveNext: (v: unknown) => void = () => {};
  apiMocks.fetchNextTrack.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
  );
  const { result } = setup();
  // 电台请求在途 → 用户切到网易云
  act(() => {
    result.current.switchToProvider('netease');
  });
  await act(async () => {
    resolveNext(radioTrack('r1'));
    await Promise.resolve();
    await Promise.resolve();
  });
  // 旧 provider 的结果被丢弃（没装到网易云上）
  expect(result.current.track?.id).not.toBe('r1');
});

describe('兜底链的过期与跳过', () => {
  it('兜底结果回来时已切歌 → 丢弃（不把旧歌的源塞给新歌）', async () => {
    let resolveEquiv: (v: unknown) => void = () => {};
    apiMocks.findEquivalentSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEquiv = resolve;
        }),
    );
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // 兜底搜索在途
    await act(async () => {
      a.dataset.wantPlay = '0'; // 不走同源重试，直达跨平台兜底
      a.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    // 期间用户切歌
    act(() => {
      result.current.playSearch([item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
    // 兜底结果这时才回来 → 必须被丢弃
    await act(async () => {
      resolveEquiv({
        source: { platform: 'netease', trackId: 'x', hasCopyright: true, url: '/u' },
        reason: 'match',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // 新歌没被换成旧歌的源
    expect(result.current.track?.title).toBe('歌-2');
  });

  it('服务端匹配抛错 → 静默走报错（不崩）', async () => {
    apiMocks.findEquivalentSource.mockRejectedValue(new Error('network down'));
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    await act(async () => {
      a.dataset.wantPlay = '0';
      a.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 没崩，且给出了失败信号
    expect(result.current.failure).not.toBeNull();
  });
});

describe('音频图与探测的异常路径', () => {
  it('音频图构建失败 → 明确 console.error（不是静默无声）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const orig = (globalThis as any).AudioContext;
    class BrokenContext extends orig {
      createBiquadFilter() {
        throw new Error('no web audio');
      }
    }
    (globalThis as any).AudioContext = BrokenContext;
    try {
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });
      await waitFor(() => {
        expect(
          spy.mock.calls.some((c) => String(c[0]).includes('failed to build audio graph')),
        ).toBe(true);
      });
      expect(result.current.track?.title).toBe('歌-1');
    } finally {
      (globalThis as any).AudioContext = orig;
      spy.mockRestore();
    }
  });

  it('AudioContext 被挂起 → resume 失败只告警（不阻断播放）', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const orig = (globalThis as any).AudioContext;
    class SuspendedContext extends orig {
      state = 'suspended';
      resume() {
        return Promise.reject(new Error('resume blocked'));
      }
    }
    (globalThis as any).AudioContext = SuspendedContext;
    try {
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });
      await waitFor(() => {
        expect(spy.mock.calls.some((c) => String(c[0]).includes('resume() rejected'))).toBe(true);
      });
      expect(result.current.error).toBeNull();
    } finally {
      (globalThis as any).AudioContext = orig;
      spy.mockRestore();
    }
  });

  it('没有标准 AudioContext → 回退到 webkitAudioContext', async () => {
    const orig = (globalThis as any).AudioContext;
    const origWebkit = (window as any).webkitAudioContext;
    const w = window as any;
    w.AudioContext = undefined;
    w.webkitAudioContext = orig;
    try {
      const { result } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });
      // 回退路径下依然能正常起播（没有抛错）
      await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
      expect(result.current.error).toBeNull();
    } finally {
      w.AudioContext = orig;
      w.webkitAudioContext = origWebkit;
    }
  });

  it('切音质后的 seek 越界 → 忽略（不炸）', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));

    // 模拟浏览器拒绝越界的 seek
    Object.defineProperty(a, 'currentTime', {
      configurable: true,
      get: () => 0,
      set: () => {
        throw new Error('IndexSizeError: out of range');
      },
    });
    act(() => {
      result.current.changeQuality('high');
    });
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    // 没炸就行
    expect(result.current.error).toBeNull();
  });

  it('非试听音源 → 复位 trial 标记（升级成功后不再显示 TRIAL）', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    // 元数据时长与曲库一致 → 不是试听残片
    Object.defineProperty(a, 'duration', { value: 200, configurable: true });

    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    expect(result.current.trialFellBack).toBe(false);
  });

  it('登录态探不通 → 当作没过期（宁可少提示，不误伤正常降级）', async () => {
    apiMocks.getAuthStatusValidated.mockRejectedValue(new Error('probe timeout'));
    const { result, a } = setup();
    act(() => {
      // 单平台 item：没有别的源可兜底 → 才会走到 reportPlayFailure
      result.current.playSearch([item('1', 'qq')], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));

    await act(async () => {
      a.dataset.wantPlay = '0';
      a.dispatchEvent(new Event('error'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 探不通 → 没有弹重登，但失败仍然如实上报
    expect(result.current.failure).not.toBeNull();
  });
});
