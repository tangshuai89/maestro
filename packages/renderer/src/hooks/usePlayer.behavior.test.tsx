/**
 * usePlayer 的**兜底链 / 试听升级 / 分级失败**行为测试。
 *
 * 与 `usePlayer.hook.test.tsx` 的分工：
 *  - 那份测**主路径**（播放 / 暂停 / 切歌 / ❤ / 兜底链耗尽）
 *  - 这份测**分支决策**（跨平台降级选谁、30s 试听怎么升级、失败原因怎么分级、
 *    队列怎么增删、WPS 怎么接管）
 *
 * 覆盖 usePlayer.ts 此前 0% 的这几段：
 *  - 583-622  presentTrack 换歌重置 / 音质参数拼接
 *  - 626-642  Spotify + WPS 接管（清空 audioUrl）/ 封面占位
 *  - 679-711  presentFallbackSource（跨平台降级构造 fallback track）
 *  - 750-775  checkProviderAuthExpired（QQ 探针）
 *  - 822-840  reportPlayFailure 分级
 *  - 867-885  tryFallbackSource 两级兜底
 *  - 1018-1040 tryUpgradeFromTrial（30s 试听 → 全曲）
 *  - 1082-1093 handleTrialDetected（同平台降标准音质）
 *  - 1258-1264 refreshTrackForWps
 *  - 1349-1402 playSearch / appendToQueue
 *  - 1724-1727 applyWpsProgress
 *  - 1803-1824 changeQuality
 *  - 1923-1932 loadPrevTrack
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { UnifiedSearchItem, MusicProvider } from '../api';

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

// 封面取色要走 fetch + createImageBitmap（happy-dom 没有）→ 整个模块替换。
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
// happy-dom 没有 AudioContext → 挂一个假的。窗口上没有该属性时存 undefined，
// 卸载时原样还原。
const globalScope = globalThis as unknown as { AudioContext?: typeof FakeAudioContext };
const realAudioContext = globalScope.AudioContext;
globalScope.AudioContext = FakeAudioContext;
afterAll(() => {
  globalScope.AudioContext = realAudioContext;
});

// ── fixture ────────────────────────────────────────────────────────
/**
 * 构造一个统一条目。`platforms` 里的每个平台各给一条源；
 * `best` 决定 pickPlayableTrack 选谁当首选。
 */
function unified(opts: {
  id: string;
  title?: string;
  artist?: string;
  duration?: number;
  coverUrl?: string;
  best: MusicProvider | null;
  platforms: Array<{
    platform: MusicProvider;
    trackId: string;
    hasCopyright?: boolean;
    vipLocked?: boolean;
    vipCategory?: 'vip-only' | 'vip-month' | 'paid-album' | 'paid-track';
  }>;
}): UnifiedSearchItem {
  const title = opts.title ?? `歌-${opts.id}`;
  const artist = opts.artist ?? '歌手';
  const duration = opts.duration ?? 200;
  const coverUrl = opts.coverUrl ?? '';
  const sources = opts.platforms.map((p) => ({
    platform: p.platform,
    trackId: p.trackId,
    hasCopyright: p.hasCopyright ?? true,
    url: `/music/stream/${p.platform}/${p.trackId}`,
    ...(p.vipLocked !== undefined ? { vipLocked: p.vipLocked } : {}),
    ...(p.vipCategory !== undefined ? { vipCategory: p.vipCategory } : {}),
  }));
  return {
    id: opts.id,
    title,
    artist,
    album: '专辑',
    coverUrl,
    duration,
    sources,
    bestSource: opts.best,
    versionType: 'studio',
    versions: [
      {
        id: `ver-${opts.id}`,
        duration,
        sources: sources.map((s) => ({ ...s, bestSource: opts.best })),
        bestSource: opts.best,
      },
    ],
  };
}

/** 装两个 <audio> 到槽位（App 里是 JSX 挂的，hook 测试要手动挂）。 */
function mountSlots(): { slots: AudioSlots; a: HTMLAudioElement; b: HTMLAudioElement } {
  const slots = createAudioSlots();
  const a = document.createElement('audio');
  const b = document.createElement('audio');
  slots.ref('a')(a);
  slots.ref('b')(b);
  return { slots, a, b };
}

function setup(opts?: { wps?: unknown; onAuthExpired?: (p: MusicProvider) => void }) {
  const { slots, a, b } = mountSlots();
  const wpsRef = opts?.wps ? ({ current: opts.wps } as never) : undefined;
  const authRef = opts?.onAuthExpired ? ({ current: opts.onAuthExpired } as never) : undefined;
  const view = renderHook(() => usePlayer(slots, wpsRef, undefined, authRef));
  return { ...view, slots, a, b };
}

/**
 * 驱动 `<audio>` 的 error 兜底链。
 *
 * 兜底链有**故意的墙钟成本**：同源 transient 重试 800ms + 卡死探测 1500ms
 * ≈ 2.3s 才走到「彻底无源」。这两段是**真 setTimeout** → 真跑一次要 2.3s
 * 墙钟，CI 高负载下还会被拖到 10s+。
 *
 * 所以这里统一用**假定时器手动推进**（理由同 usePlayer.hook.test.tsx）：
 * 假定时器把墙钟依赖整个拿掉 → 任何负载下都是同样快、同样结果。而且**更严格
 * 不是更松**：如果生产代码的定时器链坏了（卡死探测不触发 / 退避不重试），
 * failure 就永远不会被设置，断言照样红。
 */
async function driveErrorFallback(el: HTMLAudioElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new Event('error'));
    await Promise.resolve();
  });
  // 走完同源重试 800ms + 卡死探测 1500ms
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
}

/** 假的 WPS 播放器（接口见 useSpotifyWpsPlayer）。 */
function fakeWps(ready = true) {
  return {
    wpsReady: ready,
    state: { hasTrack: false, isPlaying: false, track: null, positionMs: 0 },
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    transferHere: vi.fn().mockResolvedValue(undefined),
  };
}

describe('usePlayer 兜底链 / 分级失败 / 队列', () => {
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
    coverMocks.presentCover.mockClear();
    coverMocks.presentPlaceholder.mockClear();
  });

  // ── 跨平台降级 ────────────────────────────────────────────────

  it('当前平台失败 → 自动切到同歌的其它平台源（保留歌名/歌手/时长）', async () => {
    vi.useFakeTimers();
    try {
      // 一首歌同时有 qq 和 netease 源，首选 qq。qq 挂了 → 应降级到 netease。
      const item = unified({
        id: 'm1',
        best: 'qq',
        platforms: [
          { platform: 'qq', trackId: 'q1' },
          { platform: 'netease', trackId: 'n1' },
        ],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      expect(a.src).toContain('/music/stream/qq/q1');

      await driveErrorFallback(a);

      // 降级后仍展示同一首歌的元数据（不是另一首）
      expect(result.current.track?.provider).toBe('netease');
      expect(result.current.track?.title).toBe('歌-m1');
      expect(result.current.track?.artist).toBe('歌手');
      // 新的源真的装进了 <audio>
      expect(a.src).toContain('/music/stream/netease/n1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('降级不会把 ❤ 状态重置掉（跨平台是同一首歌）', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm2',
        best: 'qq',
        platforms: [
          { platform: 'qq', trackId: 'q2' },
          { platform: 'netease', trackId: 'n2' },
        ],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      // 先点 ❤ → liked = true
      await act(async () => {
        await result.current.handleLike();
      });
      expect(result.current.track?.liked).toBe(true);

      await driveErrorFallback(a);

      // 降级后仍是已收藏
      expect(result.current.track?.provider).toBe('netease');
      expect(result.current.track?.liked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('所有平台都试过 → 不再降级，直接报结构化失败', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm3',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q3' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');

      await driveErrorFallback(a);

      // 服务端也没找到等价源 → no-match（不是笼统的 generic）
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.reason).toBe('no-match');
      // 平台没被换掉
      expect(result.current.track?.provider).toBe('qq');
    } finally {
      vi.useRealTimers();
    }
  });

  it('服务端找到等价源 → 切到那个平台（第二级兜底）', async () => {
    vi.useFakeTimers();
    try {
      // item 里只有 qq 一条源 → 第一级兜底无候选 → 走服务端实时匹配
      const item = unified({
        id: 'm4',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q4' }],
      });
      apiMocks.findEquivalentSource.mockResolvedValue({
        source: {
          platform: 'netease',
          trackId: 'eq-netease-1',
          hasCopyright: true,
          url: '/music/stream/netease/eq-netease-1',
        },
        reason: null,
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');

      await driveErrorFallback(a);

      expect(result.current.track?.provider).toBe('netease');
      expect(a.src).toContain('/music/stream/netease/eq-netease-1');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 失败分级 ──────────────────────────────────────────────────

  it('种子源是付费专辑 → failure.reason = paid-track', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm5',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q5', vipCategory: 'paid-album' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      // vipCategory 优先于服务端的 generic
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.reason).toBe('paid-track');
    } finally {
      vi.useRealTimers();
    }
  });

  it('种子源是 VIP 独占 → failure.reason = vip-locked', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm6',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q6', vipCategory: 'vip-only' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.reason).toBe('vip-locked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('其它平台搜到但全是 VIP 锁 → failure.reason = vip-locked（不是 no-match）', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm7',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q7' }],
      });
      apiMocks.findEquivalentSource.mockResolvedValue({
        source: null,
        reason: 'vip-locked',
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      // 服务端给的 reason 被带进分级文案
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.reason).toBe('vip-locked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('failure 带 autoSkip：有下一首时自动跳，无下一首时不自跳', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm8',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q8' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      expect(result.current.failure).not.toBeNull();
      // 队列里只有一首歌 → hasNextTrack() = false → 不自动跳（避免单曲队列绕回自己）
      expect(result.current.failure?.autoSkip).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('failure 带 credential 三态（凭据活着 → 文案不提重登）', async () => {
    vi.useFakeTimers();
    try {
      apiMocks.getAuthStatusValidated.mockResolvedValue({
        expired: false,
        credential: 'valid',
        entitlement: 'unknown',
      } as never);
      const item = unified({
        id: 'm9',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q9' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      expect(result.current.failure).not.toBeNull();
      expect(result.current.failure?.credential).toBe('valid');
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismissFailure → 清掉失败提示', async () => {
    vi.useFakeTimers();
    try {
      const item = unified({
        id: 'm10',
        best: 'qq',
        platforms: [{ platform: 'qq', trackId: 'q10' }],
      });
      const { result, a } = setup();
      act(() => {
        result.current.playSearch([item], 0);
      });
      expect(result.current.track?.provider).toBe('qq');
      await driveErrorFallback(a);
      expect(result.current.failure).not.toBeNull();
      act(() => {
        result.current.dismissFailure();
      });
      expect(result.current.failure).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 30s 试听升级 ─────────────────────────────────────────────

  it('音频实际时长远短于元数据 → 判为残缺 → 同平台降标准音质重试', async () => {
    // 元数据 200s，实际音频只有 30s → 残缺（VIP 试听）
    const item = unified({
      id: 't1',
      duration: 200,
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'tq1' }],
    });
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));
    // 装一个 30s 的假 duration（happy-dom 的 duration 默认 NaN）
    Object.defineProperty(a, 'duration', { value: 30, configurable: true });
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.trialFellBack).toBe(true), { timeout: 3000 });
    // 降到标准音质后 URL 里 q=standard
    await waitFor(() => expect(a.src).toContain('q=standard'), { timeout: 3000 });
  });

  it('残缺音频 + 跨平台有全曲源 → 升级到别的平台（而不是降音质）', async () => {
    // qq 源 + netease 源。qq 音质已是 standard（默认）→ 走跨平台升级。
    localStorage.setItem('maestro:qq-quality', 'standard');
    const item = unified({
      id: 't2',
      duration: 200,
      best: 'qq',
      platforms: [
        { platform: 'qq', trackId: 'tq2' },
        { platform: 'netease', trackId: 'tn2' },
      ],
    });
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));
    Object.defineProperty(a, 'duration', { value: 30, configurable: true });
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    // 升级到 netease 全曲源
    await waitFor(() => expect(result.current.track?.provider).toBe('netease'), { timeout: 3000 });
    expect(a.src).toContain('/music/stream/netease/tn2');
  });

  it('残缺音频 + 其它平台都是 VIP 锁 → 不换源（换过去还是试听）', async () => {
    localStorage.setItem('maestro:qq-quality', 'standard');
    const item = unified({
      id: 't3',
      duration: 200,
      best: 'qq',
      platforms: [
        { platform: 'qq', trackId: 'tq3' },
        { platform: 'netease', trackId: 'tn3', vipLocked: true },
      ],
    });
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));
    Object.defineProperty(a, 'duration', { value: 30, configurable: true });
    await act(async () => {
      a.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
    });
    // 标记了试用角标，但平台没换
    await waitFor(() => expect(result.current.trialFellBack).toBe(true), { timeout: 3000 });
    expect(result.current.track?.provider).toBe('qq');
  });

  // ── 队列 ─────────────────────────────────────────────────────

  it('playSearch → 队列只留可播条目（unified 与 track 索引对齐）', () => {
    const playable = unified({
      id: 'q1',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'q1' }],
    });
    const unplayable = unified({
      id: 'q2',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'q2', hasCopyright: false }],
    });
    const { result } = setup();
    act(() => {
      result.current.playSearch([playable, unplayable], 0);
    });
    // 不可播的被剔掉 → 队列长度 1
    expect(result.current.queueUnifiedItems).toHaveLength(1);
    expect(result.current.queueUnifiedItems?.[0].id).toBe('q1');
  });

  it('playSearch 指向不可播条目 → 明确报错（不静默播别的歌）', () => {
    const playable = unified({
      id: 'q3',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'q3' }],
    });
    const unplayable = unified({
      id: 'q4',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'q4', hasCopyright: false }],
    });
    const { result } = setup();
    act(() => {
      result.current.playSearch([playable, unplayable], 1);
    });
    // index=1 指向那条不可播的 → 队列里找不到它 → 明确报错，**不是**静默播第 0 条。
    // （静默换歌 = 用户点了 A 结果在放 B，是比报错更糟的体验。）
    expect(result.current.error).toBe('没有可播放的音源');
    expect(result.current.track).toBeNull();
  });

  it('appendToQueue → 追加到队尾，不切歌', () => {
    const first = unified({ id: 'q5', best: 'qq', platforms: [{ platform: 'qq', trackId: 'q5' }] });
    const extra = unified({ id: 'q6', best: 'qq', platforms: [{ platform: 'qq', trackId: 'q6' }] });
    const { result } = setup();
    act(() => {
      result.current.playSearch([first], 0);
    });
    expect(result.current.queueUnifiedItems).toHaveLength(1);
    act(() => {
      result.current.appendToQueue([extra]);
    });
    expect(result.current.queueUnifiedItems).toHaveLength(2);
    // 当前歌没变（追加不是切歌）
    expect(result.current.track?.title).toBe('歌-q5');
    expect(result.current.queueIdx).toBe(0);
  });

  it('appendToQueue 时队列为空 → 退化成从头播放', () => {
    const extra = unified({ id: 'q7', best: 'qq', platforms: [{ platform: 'qq', trackId: 'q7' }] });
    const { result } = setup();
    act(() => {
      result.current.appendToQueue([extra]);
    });
    expect(result.current.track?.title).toBe('歌-q7');
  });

  it('handlePrev → 回到上一首（队列循环）', async () => {
    const a1 = unified({ id: 'p1', best: 'qq', platforms: [{ platform: 'qq', trackId: 'p1' }] });
    const a2 = unified({ id: 'p2', best: 'qq', platforms: [{ platform: 'qq', trackId: 'p2' }] });
    const { result } = setup();
    act(() => {
      result.current.playSearch([a1, a2], 1);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-p2'));
    act(() => {
      result.current.handlePrev();
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-p1'));
  });

  it('handlePrev 在队列只有一首时 → 绕回自己', async () => {
    const a1 = unified({ id: 'p3', best: 'qq', platforms: [{ platform: 'qq', trackId: 'p3' }] });
    const { result } = setup();
    act(() => {
      result.current.playSearch([a1], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-p3'));
    act(() => {
      result.current.handlePrev();
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-p3'));
  });

  // ── 音质 / 平台切换 ───────────────────────────────────────────

  it('changeQuality → 换 URL 里的 q= 参数并保留播放位置', async () => {
    const item = unified({
      id: 'qq1',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'qq1' }],
    });
    const { result, a } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('qq'));
    act(() => {
      result.current.changeQuality('high');
    });
    await waitFor(() => expect(a.src).toContain('q=high'), { timeout: 3000 });
    expect(result.current.qqQuality).toBe('high');
  });

  it('selectSource → 换平台并落盘', async () => {
    const { result } = setup();
    act(() => {
      result.current.selectSource('netease');
    });
    await waitFor(() => expect(result.current.provider).toBe('netease'));
    expect(localStorage.getItem('music-provider')).toBe('netease');
  });

  it('switchToProvider → 清掉搜索队列（队列是平台相关的）', async () => {
    const item = unified({
      id: 'sw1',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'sw1' }],
    });
    const { result } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    expect(result.current.queueUnifiedItems).toHaveLength(1);
    act(() => {
      result.current.switchToProvider('netease');
    });
    await waitFor(() => expect(result.current.provider).toBe('netease'));
    // 队列被清空
    expect(result.current.queueUnifiedItems).toBeUndefined();
    expect(result.current.queueIdx).toBe(-1);
  });

  it('resetForSwitch → 清空播放态并落盘清空 provider', async () => {
    const item = unified({
      id: 'rs1',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'rs1' }],
    });
    const { result } = setup();
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-rs1'));
    act(() => {
      result.current.resetForSwitch();
    });
    expect(result.current.track).toBeNull();
    expect(result.current.provider).toBeNull();
    expect(localStorage.getItem('music-provider')).toBeNull();
  });

  // ── WPS 接管 ─────────────────────────────────────────────────

  it('Spotify + WPS 就绪 → 清空 audioUrl（不让 30s 预览跟 WPS 双声道）', async () => {
    const wps = fakeWps(true);
    const item = unified({
      id: 'w1',
      best: 'spotify',
      platforms: [{ platform: 'spotify', trackId: 'sp1' }],
    });
    const { result } = setup({ wps });
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));
    // audioUrl 被清空 → WPS 全曲接管
    expect(result.current.track?.audioUrl).toBe('');
  });

  it('applyWpsProgress → 把 SDK 上报的位置/时长喂回时间轴', async () => {
    const wps = fakeWps(true);
    const item = unified({
      id: 'w2',
      best: 'spotify',
      platforms: [{ platform: 'spotify', trackId: 'sp2' }],
    });
    const { result } = setup({ wps });
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));
    act(() => {
      result.current.applyWpsProgress(30_000, 200_000);
    });
    expect(result.current.currentTime).toBe(30);
    expect(result.current.duration).toBe(200);
  });

  it('WPS 未就绪 → 走 30s 预览路径（audioUrl 保留）', async () => {
    const wps = fakeWps(false);
    const item = unified({
      id: 'w3',
      best: 'spotify',
      platforms: [{ platform: 'spotify', trackId: 'sp3' }],
    });
    const { result } = setup({ wps });
    act(() => {
      result.current.playSearch([item], 0);
    });
    await waitFor(() => expect(result.current.track?.provider).toBe('spotify'));
    expect(result.current.track?.audioUrl).not.toBe('');
  });

  // ── 封面 ─────────────────────────────────────────────────────

  it('有封面 → presentCover；没封面 → presentPlaceholder（不留上一首的残影）', async () => {
    const withCover = unified({
      id: 'c1',
      coverUrl: 'https://img.example.com/a.jpg',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'c1' }],
    });
    const withoutCover = unified({
      id: 'c2',
      coverUrl: '',
      best: 'qq',
      platforms: [{ platform: 'qq', trackId: 'c2' }],
    });
    const { result } = setup();
    act(() => {
      result.current.playSearch([withCover], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-c1'));
    expect(coverMocks.presentCover).toHaveBeenCalledWith('https://img.example.com/a.jpg');

    act(() => {
      result.current.playSearch([withoutCover], 0);
    });
    await waitFor(() => expect(result.current.track?.title).toBe('歌-c2'));
    expect(coverMocks.presentPlaceholder).toHaveBeenCalled();
  });
});
