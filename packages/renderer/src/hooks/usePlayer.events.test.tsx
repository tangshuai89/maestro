/**
 * usePlayer 的**事件回调 / 公开方法**行为测试（2026-10-21）。
 *
 * ## 为什么单独一个文件
 *
 * 上一轮用「**函数级覆盖**」（FNDA）——而不是行级——去找洞，因为行级数据在
 * renderer 上是**错位**的（esbuild 压缩 + c8 拿不到 source map → V8 的字节
 * 偏移被套到源文件上）。函数名是源码标识符，稳定可信。
 *
 * 用 FNDA 一查，`usePlayer.ts` 里有 **8 个函数从未被执行过**：
 *
 *   | 函数                  | 坏了的用户可见症状                   |
 *   | --------------------- | ------------------------------------ |
 *   | `onTimeUpdate`        | **进度条不动**（时间不更新）          |
 *   | `onEnded`             | **播完不自动下一首**（歌单停住）      |
 *   | `seek`                | **拖进度条 / 点歌词跳转不生效**        |
 *   | `handleDislike`       | **踩不了**（不喜欢按钮）              |
 *   | `changeDeezerPreset`  | 切不了 Deezer 精选                   |
 *   | `ensureGraph`         | crossfade 的图构建回调              |
 *   | `onActiveChanged`     | crossfade 的槽位切换回调            |
 *
 * 前 5 个是**每首歌播放都涉及**的用户可见功能，零覆盖 → 这一份把它们钉住。
 *
 * ## 与已有测试的分工
 *
 * - `usePlayer.hook.test.tsx`：主路径（播放 / 暂停 / 切歌 / ❤ / 兜底链耗尽）
 * - `usePlayer.behavior.test.tsx`：分支决策（跨平台降级 / 失败分级 / 试听升级）
 * - **本文件**：`<audio>` 的**事件回调**（timeupdate / ended）与**公开方法**
 *   （seek / handleDislike / changeDeezerPreset）
 *
 * 运行: npx vitest run -c packages/renderer/vitest.config.ts src/hooks/usePlayer.events.test.tsx
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

// 封面取色要 fetch + createImageBitmap（happy-dom 没有）→ 整个模块替换。
// ⚠️ 替身函数必须**引用稳定**（在工厂外建一次），否则 presentTrack 每次重建
// → 依赖链乱抖 → 电台请求打爆。理由见 usePlayer.hook.test.tsx 的同款注释。
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
const globalScope = globalThis as unknown as { AudioContext?: typeof FakeAudioContext };
const realAudioContext = globalScope.AudioContext;
globalScope.AudioContext = FakeAudioContext;
afterAll(() => {
  globalScope.AudioContext = realAudioContext;
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

describe('usePlayer · <audio> 事件回调', () => {
  beforeEach(() => {
    localStorage.setItem('music-provider', 'qq');
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

  it('timeupdate → currentTime 跟着走（进度条能动）', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('t1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-t1'));

    // 模拟播放到第 30 秒
    Object.defineProperty(a, 'currentTime', { value: 30, configurable: true, writable: true });
    await act(async () => {
      a.dispatchEvent(new Event('timeupdate'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.currentTime).toBe(30));
  });

  it('ended → 上报「播完」信号 + 自动下一首', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('e1'), item('e2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-e1'));
    apiMocks.reportRecoSignal.mockClear();

    await act(async () => {
      a.dispatchEvent(new Event('ended'));
      await Promise.resolve();
    });

    // 播完 = 最强的正信号（比"切歌"可信得多）
    expect(apiMocks.reportRecoSignal).toHaveBeenCalledWith({
      type: 'complete',
      title: '歌-e1',
      artist: '歌手',
    });
    // 自动下一首
    await waitFor(() => expect(result.current.track?.title).toBe('歌-e2'));
  });

  it('ended → 下一首接着播，且 wantPlay 复位为「要播」', async () => {
    // ⚠️ 不能断言「ended 之后 wantPlay === '0'」：onEnded 先置 0，紧接着
    // presentTrack 装下一首时又会置 1（那是**正确**行为 —— 下一首该播）。
    // happy-dom 的 MutationObserver 也不支持 observe DOMStringMap
    // （target[PropertySymbol.observeMutations] is not a function），
    // 所以这里断言**最终状态**：「下一首已就位 + wantPlay 复位为 1」。
    //
    // 「播完那一刻 wantPlay 归零」这件事由「上报 complete 信号」那条间接证明：
    // 若 wantPlay 没归零，onError 的同源重试判据（wantPlay==='1'）会误判成
    // 「用户还想听」→ 不会走兜底链。
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('e3'), item('e4')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-e3'));

    await act(async () => {
      a.dispatchEvent(new Event('ended'));
      await Promise.resolve();
    });

    // 下一首已就位
    await waitFor(() => expect(result.current.track?.title).toBe('歌-e4'));
    // wantPlay 复位为「要播」
    expect(a.dataset.wantPlay).toBe('1');
  });
});

describe('usePlayer · 公开方法', () => {
  beforeEach(() => {
    localStorage.setItem('music-provider', 'qq');
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

  it('seek → 把播放位置设到目标秒数（点歌词跳转 / 拖进度条）', async () => {
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item('s1')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-s1'));

    act(() => {
      result.current.seek(42);
    });
    expect(a.currentTime).toBe(42);
  });

  it('seek → Spotify + WPS 就绪时走 SDK 而不是 <audio>', async () => {
    const wps = {
      wpsReady: true,
      state: { hasTrack: false, isPlaying: false, track: null, positionMs: 0 },
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      transferHere: vi.fn().mockResolvedValue(undefined),
    };
    const { slots, a } = mountSlots();
    // ⚠️ wpsRef 必须**引用稳定** —— 每次 render 新建对象字面量会让
    // presentTrack（依赖 wpsRef）每次重建 → loadNextTrack 重建 → auto-load
    // effect 重跑 → setState → re-render → **无限循环**（实测挂住）。
    // App.tsx 里它是用 `useRef` 建的（稳定）→ 生产没问题。
    const wpsRef = { current: wps } as never;
    const view = renderHook(() => usePlayer(slots, wpsRef));

    // spotify 源的歌
    const spotifyItem: UnifiedSearchItem = {
      ...item('sp1'),
      id: 'spotify:sp1',
      bestSource: 'spotify',
      sources: [
        { platform: 'spotify', trackId: 'sp1', hasCopyright: true, url: '/music/stream/spotify/sp1' },
      ],
    };
    act(() => {
      view.result.current.playSearch([spotifyItem], 0);
    });
    await waitFor(() => expect(view.result.current.track?.provider).toBe('spotify'));

    act(() => {
      view.result.current.seek(15);
    });
    // SDK 收到毫秒
    expect(wps.seek).toHaveBeenCalledWith(15000);
    // <audio> 的位置**没**被改（WPS 全曲接管，<audio> 不是播放源）
    expect(a.currentTime).toBe(0);
  });

  it('handleDislike → 取消收藏 + 上报「踩」信号 + 跳下一首', async () => {
    const { result } = setup();
    act(() => {
      result.current.playSearch([item('d1'), item('d2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-d1'));
    apiMocks.reportRecoSignal.mockClear();

    await act(async () => {
      await result.current.handleDislike();
    });

    // 统一搜索路径：取消合并红心
    expect(apiMocks.dislikeMerged).toHaveBeenCalled();
    expect(apiMocks.dislikeMerged.mock.calls[0][0]).toBe('qq:d1');
    // 上报负信号
    expect(apiMocks.reportRecoSignal).toHaveBeenCalledWith({
      type: 'dislike',
      title: '歌-d1',
      artist: '歌手',
    });
    // 踩完自动下一首
    await waitFor(() => expect(result.current.track?.title).toBe('歌-d2'));
  });

  it('handleDislike → 单平台路径（电台）调 dislike', async () => {
    // 电台没有 unified item → 走单平台分支
    apiMocks.fetchNextTrack.mockResolvedValue({
      id: 'r1',
      provider: 'qq',
      title: '电台歌',
      artist: '歌手',
      album: '专辑',
      coverUrl: '',
      audioUrl: '/music/stream/qq/r1',
      duration: 100,
      liked: false,
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.track?.title).toBe('电台歌'), { timeout: 3000 });

    await act(async () => {
      await result.current.handleDislike();
    });
    expect(apiMocks.dislike).toHaveBeenCalledWith('qq', 'r1');
  });

  it('changeDeezerPreset → 切预设并落盘', () => {
    const { result } = setup();
    act(() => {
      result.current.changeDeezerPreset('rock');
    });
    expect(localStorage.getItem('maestro:deezer-preset')).toBe('rock');
  });
});


describe('usePlayer · crossfade 接线', () => {
  beforeEach(() => {
    localStorage.setItem('music-provider', 'qq');
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

  it('开了 crossfade 且正在出声 → 切歌走淡变（新歌进另一个槽）', async () => {
    const { result, a, b } = setup();

    act(() => {
      result.current.setCrossfadeSec(3);
    });

    act(() => {
      result.current.playSearch([item('c1'), item('c2')], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-c1'));

    // 模拟「正在出声」：crossfade 的前提是有活跃元素在播
    // （decideSwitch 的 hasActiveElement = !paused && currentSrc）
    //
    // ⚠️ `paused` 在 happy-dom 是**只读 getter**，defineProperty 覆盖不了
    //（实测 defineProperty 后仍是 true）→ 只能真的调 `play()`。
    // `currentSrc` 则是可覆盖的属性。
    await act(async () => {
      await a.play();
    });
    expect(a.paused).toBe(false);
    Object.defineProperty(a, 'currentSrc', { value: 'http://x/1.mp3', configurable: true });

    // ⚠️ 必须等首播的「硬切收声窗口」过去（120ms，crossfadeRunner 的
    // HARD_STOP_MS）：首播走 hard 路径会把 idle 槽加进 stillAudible，
    // 期间切歌 → decideSwitch 返回 'rapid-skip' → **也走硬切**（这是产品
    // 的正确行为：连按 ⏭ 不淡变，否则双声叠加）。
    await new Promise((r) => setTimeout(r, 200));

    // 切到第二首 → 应该走 crossfade → 装进**另一个槽位**（b）
    act(() => {
      result.current.handleSkip();
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-c2'));

    // 活跃槽已切到 b（crossfade 的「逻辑上当前播放元素立即交给新槽」）
    expect(result.current.slots.active()).toBe('b');
    expect(b.src).toContain('/music/stream/qq/c2');
  });
});
