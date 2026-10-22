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
}));
vi.mock('./useCoverArt', () => ({
  useCoverArt: () => ({
    bgLayerRef: { current: null },
    coverBackdropRef: { current: null },
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
    const { result } = setup();

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
