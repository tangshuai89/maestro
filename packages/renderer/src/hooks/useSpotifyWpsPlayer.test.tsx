/**
 * useSpotifyWpsPlayer 测试（此前零覆盖）。
 *
 * 契约（Premium-only 的 WPS 播放路径）：
 *  - enabled=false → **不 connect**，wpsReady=false（回退 30s 预览）
 *  - token 的 tier 不是 premium → 不 connect，wpsReady=false
 *  - connect 成功 **且** emeOk && hasDeviceId → wpsReady=true
 *  - ready 检查失败（emeOk=false / 超时）→ wpsReady=false
 *  - connect 抛错 → wpsReady=false（不冒到界面）
 *  - WPS 的 player_state_changed → 镜像到本 hook 的 state
 *  - play / pause / resume / seek / transferHere → 转发给 wrapper
 *  - 卸载 → disconnect 本 effect 创建的那个 wrapper（不是 wrapperRef 里的）
 *
 * 替身策略：mock `../api`（getSpotifyToken）和 `../lib/spotify-wps`（createWpsWrapper）。
 * 假 wrapper 的 `emeOk` / `hasDeviceId` 可配，用来驱动 ready 分支。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  getSpotifyToken: vi.fn(),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

const wpsMocks = vi.hoisted(() => ({
  createWpsWrapper: vi.fn(),
}));
vi.mock('../lib/spotify-wps', async () => {
  const actual = await vi.importActual<typeof import('../lib/spotify-wps')>('../lib/spotify-wps');
  return { ...actual, ...wpsMocks };
});

import { useSpotifyWpsPlayer } from './useSpotifyWpsPlayer';

type StateCb = (s: unknown) => void;

/** 假 WPS wrapper。emeOk/hasDeviceId 可配 —— 决定 ready 分支走哪条。 */
function makeWrapper(
  opts: { emeOk?: boolean; hasDeviceId?: boolean; connectThrows?: boolean } = {},
) {
  const w = {
    emeOk: opts.emeOk ?? true,
    hasDeviceId: opts.hasDeviceId ?? true,
    connect: vi.fn(async () => {
      if (opts.connectThrows) throw new Error('SDK 超时');
    }),
    disconnect: vi.fn(),
    refreshToken: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    seek: vi.fn(async () => {}),
    transferHere: vi.fn(async () => {}),
    onStateChange: vi.fn((cb: StateCb) => {
      w.stateCb = cb;
      return () => {};
    }),
    stateCb: null as StateCb | null,
  };
  return w;
}

const token = (tier = 'premium') => ({
  accessToken: 'tok',
  tier,
  expiresAt: Date.now() + 3600_000,
});

describe('useSpotifyWpsPlayer', () => {
  beforeEach(() => {
    apiMocks.getSpotifyToken.mockReset().mockResolvedValue(token());
    wpsMocks.createWpsWrapper.mockReset();
  });

  it('enabled=false → 不 connect，wpsReady=false', async () => {
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: false }));
    await waitFor(() => expect(result.current.wpsReady).toBe(false));
    expect(apiMocks.getSpotifyToken).not.toHaveBeenCalled();
    expect(wpsMocks.createWpsWrapper).not.toHaveBeenCalled();
  });

  it('tier 不是 premium → 不 connect，wpsReady=false', async () => {
    apiMocks.getSpotifyToken.mockResolvedValue(token('free'));
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(apiMocks.getSpotifyToken).toHaveBeenCalled());
    expect(wpsMocks.createWpsWrapper).not.toHaveBeenCalled();
    expect(result.current.wpsReady).toBe(false);
  });

  it('connect 成功且 emeOk && hasDeviceId → wpsReady=true', async () => {
    const w = makeWrapper();
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(result.current.wpsReady).toBe(true));
    expect(w.connect).toHaveBeenCalledWith('tok');
  });

  it('emeOk=false → wpsReady=false（不 connect 出可用状态）', async () => {
    const w = makeWrapper({ emeOk: false });
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(w.connect).toHaveBeenCalled());
    expect(result.current.wpsReady).toBe(false);
  });

  it('hasDeviceId=false → wpsReady=false', async () => {
    const w = makeWrapper({ hasDeviceId: false });
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(w.connect).toHaveBeenCalled());
    expect(result.current.wpsReady).toBe(false);
  });

  it('connect 抛错 → wpsReady=false（不冒到界面）', async () => {
    const w = makeWrapper({ connectThrows: true });
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(w.connect).toHaveBeenCalled());
    await waitFor(() => expect(result.current.wpsReady).toBe(false));
  });

  it('WPS 的 state 变化 → 镜像到本 hook 的 state', async () => {
    const w = makeWrapper();
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(result.current.wpsReady).toBe(true));

    act(() => {
      w.stateCb?.({
        hasTrack: true,
        isPlaying: true,
        track: { id: 's1' },
        positionMs: 1234,
      });
    });
    expect(result.current.state.hasTrack).toBe(true);
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.positionMs).toBe(1234);
  });

  it('play / pause / resume / seek / transferHere → 转发给 wrapper', async () => {
    const w = makeWrapper();
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(result.current.wpsReady).toBe(true));

    await act(async () => {
      await result.current.play('spotify:track:x');
      await result.current.pause();
      await result.current.resume();
      await result.current.seek(5000);
      await result.current.transferHere();
    });
    expect(w.play).toHaveBeenCalledWith('spotify:track:x');
    expect(w.pause).toHaveBeenCalled();
    expect(w.resume).toHaveBeenCalled();
    expect(w.seek).toHaveBeenCalledWith(5000);
    expect(w.transferHere).toHaveBeenCalled();
  });

  it('没连上时调 play 也不炸（静默 no-op）', async () => {
    const { result } = renderHook(() => useSpotifyWpsPlayer({ enabled: false }));
    await waitFor(() => expect(result.current.wpsReady).toBe(false));
    await act(async () => {
      await result.current.play('spotify:track:x');
    });
    expect(result.current.wpsReady).toBe(false);
  });

  it('卸载 → disconnect', async () => {
    const w = makeWrapper();
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result, unmount } = renderHook(() => useSpotifyWpsPlayer({ enabled: true }));
    await waitFor(() => expect(result.current.wpsReady).toBe(true));
    unmount();
    expect(w.disconnect).toHaveBeenCalled();
  });

  it('enabled 从 true 变 false → 断连 + wpsReady=false', async () => {
    const w = makeWrapper();
    wpsMocks.createWpsWrapper.mockReturnValue(w);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useSpotifyWpsPlayer({ enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.wpsReady).toBe(true));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.wpsReady).toBe(false));
    expect(w.disconnect).toHaveBeenCalled();
  });
});
