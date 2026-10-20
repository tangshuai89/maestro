/**
 * usePlayer **hook 体**测试（此前只有它导出的纯函数被测 —— hook 本体
 * 2040 行 / 0% 函数覆盖，见 `usePlayer.test.mjs` 的文件头说明）。
 *
 * 这里用 renderHook + 假 `<audio>` 驱动真实 hook，覆盖**主路径与兜底链**：
 *  1. playSearch → 选中曲目 / playing=true / src 真的装进 <audio>
 *  2. playSearch 全不可播 → 明确报错「没有可播放的音源」（不是静默）
 *  3. handlePlayPause → 播放/暂停切换
 *  4. handleSkip → 队列前进到下一首
 *  5. handleLike → 调 fanOutLike（红心 fan-out 的入口）
 *  6. <audio> 抛 error → 跨平台兜底链跑完仍无源 → **结构化 failure**
 *     （reason='no-match'，而不是一条看不清的英文错误串）
 *
 * 与 `usePlayer.test.mjs`（纯函数层）互补，不重叠。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { UnifiedSearchItem } from '../api';

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
// presentTrack 每次重建 → "provider/preset 变化时自动加载"那个 effect 的
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
  // crossfade 的 scheduleFade 会先取消在途的调度再起新的 —— 少这个方法会
  // 抛 "cancelScheduledValues is not a function"（unhandled rejection，
  // vitest 会因此整轮非零退出）。
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
const item = (id: string, platform: 'qq' | 'netease' = 'qq'): UnifiedSearchItem => ({
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

describe('usePlayer hook 体', () => {
  beforeEach(() => {
    // provider 存在 localStorage（readStoredProvider 读 'music-provider'，
    // 存的是裸字符串）。不种下去 → provider=null → handleLike/handleSkip
    // 直接 early-return（`if (!provider) return`），测不到主干。
    localStorage.setItem('music-provider', 'qq');
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
    // 「没过期」→ 不弹重登框，走结构化 failure 分支
    apiMocks.getAuthStatusValidated.mockResolvedValue({ expired: false });
  });

  it('playSearch → 选中曲目 / playing=true / src 装进 <audio>', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    expect(result.current.playing).toBe(true);
    expect(result.current.error).toBeNull();
    // src 真的装进了活跃槽位的元素（命令式装载，src 不再由 React 绑定）
    expect(a.src).toContain('/music/stream/qq/1');
  });

  it('playSearch 全不可播 → 明确报错「没有可播放的音源」', () => {
    const { result } = setup();
    const bad: UnifiedSearchItem = {
      ...item('x'),
      bestSource: null,
      sources: [{ platform: 'qq', trackId: 'x', hasCopyright: false, url: '' }],
      versions: [
        {
          id: 'ver-x',
          duration: 0,
          sources: [{ platform: 'qq', trackId: 'x', hasCopyright: false, url: '' }],
          bestSource: null,
        },
      ],
    };
    act(() => {
      result.current.playSearch([bad], 0);
    });
    expect(result.current.error).toBe('没有可播放的音源');
    expect(result.current.track).toBeNull();
  });

  it('handlePlayPause → 播放/暂停切换', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.playing).toBe(true));
    act(() => {
      result.current.handlePlayPause();
    });
    await waitFor(() => expect(result.current.playing).toBe(false));
    act(() => {
      result.current.handlePlayPause();
    });
    await waitFor(() => expect(result.current.playing).toBe(true));
  });

  it('handleSkip → 队列前进到下一首', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1'), item('2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    act(() => {
      result.current.handleSkip();
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-2'));
  });

  it('handleLike → 调 fanOutLike（红心 fan-out 入口）', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-1'));
    await act(async () => {
      await result.current.handleLike();
    });
    expect(apiMocks.fanOutLike).toHaveBeenCalled();
    const [mergedId, sources] = apiMocks.fanOutLike.mock.calls[0];
    expect(mergedId).toBe('qq:1');
    expect(sources[0]).toEqual(expect.objectContaining({ platform: 'qq', trackId: '1' }));
  });

  it('<audio> error → 兜底链耗尽 → 结构化 failure（reason=no-match）', async () => {
    // 兜底链有**故意的时间成本**：同源 transient 重试 800ms + 卡死探测 1500ms
    // ≈ 2.3s 才走到"彻底无源"。这两段是**真 setTimeout**。
    //
    // 为什么用假定时器（2026-10-20 实测踩坑）：CI 上高负载时这两段会被拖到
    // 10s 以上 → 「加预算」是治标（10s 不够就 20s、20s 不够就 30s，机器再慢
    // 一点又红）。假定时器把**墙钟依赖整个拿掉** → 这条测试在任何负载下都是
    // 同样快、同样结果。代价是「假定时器会不会掩盖真实时序」——
    // 不会：如果生产代码的定时器链坏了（卡死探测不触发 / 退避不重试），
    // failure 就永远不会被设置，waitFor 照样超时失败。**更严格，不是更松。**
    vi.useFakeTimers();
    try {
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item('1')], 0);
      });
      // 假定时器下 testing-library 的 waitFor **不会**自动推进时钟
      // （它的 `jestFakeTimersAreEnabled()` 只认 jest 全局，vitest 下返回 false）
      // → 所以这里不靠 waitFor 等，改成：同步断言 + 手动推进时钟。
      expect(result.current.track?.title).toBe('歌-1');

      // 播放失败：<audio> 抛 error → 跨平台兜底（findEquivalentSource 返 no-match）
      await act(async () => {
        a.dispatchEvent(new Event('error'));
        await Promise.resolve();
      });
      // 推进时钟，走完兜底链的两段等待：同源 transient 重试 800ms +
      // 卡死探测 1500ms。advanceTimersByTimeAsync 会在每个 tick 之间 flush
      // 微任务，所以链路上的 promise 链会正常接力。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.reason).toBe('no-match');
      expect(result.current.failure?.title).toBe('歌-1');
      // 兜底链找过等价源（而不是直接弹一条看不懂的英文错误）
      expect(apiMocks.findEquivalentSource).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
