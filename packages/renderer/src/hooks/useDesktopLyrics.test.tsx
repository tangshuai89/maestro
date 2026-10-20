/**
 * useDesktopLyrics 测试（此前零覆盖）。
 *
 * 契约（主窗口侧接线，浮窗是纯展示端）：
 *  - 首帧读一次 main 的开关态（`getStatus`）→ 按钮图标不闪错状态
 *  - `getStatus` 抛错 → 按「浮窗没开」处理（不亮是安全的一侧）
 *  - main 侧改开关（Tray / 浮窗面板）→ `onChanged` 回灌，三个入口永远一致
 *  - `setEnabled` / `toggle` 同时通知 main
 *  - 开启时按**签名**去抖推状态：签名不变就不推（currentTime 每秒跳好几下）
 *  - 关掉浮窗时签名清空 → 下次开启第一帧**一定重推**（否则浮窗停在旧歌的词上）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const lyricLines = [
  { time: 0, text: '第一句' },
  { time: 10, text: '第二句' },
];

type ChangedCb = (s: { enabled: boolean; locked?: boolean }) => void;

const ipcMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  setEnabled: vi.fn(),
  pushState: vi.fn(),
  onChanged: vi.fn(),
}));

beforeEach(() => {
  ipcMocks.getStatus.mockReset().mockResolvedValue({ enabled: false });
  ipcMocks.setEnabled.mockReset();
  ipcMocks.pushState.mockReset();
  ipcMocks.onChanged.mockReset().mockReturnValue(() => {});
  (globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI = {
    desktopLyrics: ipcMocks,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window: Record<string, unknown> }).window.electronAPI;
});

import { useDesktopLyrics } from './useDesktopLyrics';

const args = (over: Partial<Parameters<typeof useDesktopLyrics>[0]> = {}) => ({
  lines: lyricLines as never,
  currentTime: 0,
  playing: true,
  title: 'T',
  artist: 'A',
  ...over,
});

describe('useDesktopLyrics', () => {
  it('首帧读 main 的开关态', async () => {
    ipcMocks.getStatus.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(ipcMocks.getStatus).toHaveBeenCalledTimes(1);
  });

  it('getStatus 抛错 → 按「没开」处理（不抛到界面）', async () => {
    ipcMocks.getStatus.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(ipcMocks.getStatus).toHaveBeenCalled());
    expect(result.current.enabled).toBe(false);
  });

  it('main 侧改开关 → onChanged 回灌', async () => {
    let cb: ChangedCb | null = null;
    ipcMocks.onChanged.mockImplementation((c: ChangedCb) => {
      cb = c;
      return () => {};
    });
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(ipcMocks.onChanged).toHaveBeenCalled());
    act(() => {
      cb?.({ enabled: true });
    });
    expect(result.current.enabled).toBe(true);
  });

  it('setEnabled / toggle 通知 main', async () => {
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(ipcMocks.getStatus).toHaveBeenCalled());
    act(() => {
      result.current.setEnabled(true);
    });
    expect(ipcMocks.setEnabled).toHaveBeenCalledWith(true);
    expect(result.current.enabled).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(ipcMocks.setEnabled).toHaveBeenLastCalledWith(false);
    expect(result.current.enabled).toBe(false);
  });

  it('开启时把当前行 / 下一行 / 进度推给 main', async () => {
    ipcMocks.getStatus.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useDesktopLyrics(args({ currentTime: 0 })));
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() => expect(ipcMocks.pushState).toHaveBeenCalled());
    const payload = ipcMocks.pushState.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.current).toBe('第一句');
    expect(payload.next).toBe('第二句');
    expect(payload.playing).toBe(true);
    expect(payload.title).toBe('T');
  });

  it('签名不变 → 不重复推（去抖）', async () => {
    ipcMocks.getStatus.mockResolvedValue({ enabled: true });
    const { rerender } = renderHook(
      ({ ct }: { ct: number }) => useDesktopLyrics(args({ currentTime: ct })),
      { initialProps: { ct: 0 } },
    );
    await waitFor(() => expect(ipcMocks.pushState).toHaveBeenCalledTimes(1));
    // 同一时间点再 render 一次 → 签名没变 → 不该再推
    rerender({ ct: 0 });
    expect(ipcMocks.pushState).toHaveBeenCalledTimes(1);
  });

  it('关着的时候不推', async () => {
    ipcMocks.getStatus.mockResolvedValue({ enabled: false });
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(ipcMocks.getStatus).toHaveBeenCalled());
    expect(ipcMocks.pushState).not.toHaveBeenCalled();
    expect(result.current.enabled).toBe(false);
  });

  it('关掉 → 再开启 → 第一帧重推（浮窗不能停在旧歌的词上）', async () => {
    ipcMocks.getStatus.mockResolvedValue({ enabled: true });
    const { result } = renderHook(() => useDesktopLyrics(args()));
    await waitFor(() => expect(ipcMocks.pushState).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setEnabled(false);
    });
    const afterOff = ipcMocks.pushState.mock.calls.length;

    act(() => {
      result.current.setEnabled(true);
    });
    expect(ipcMocks.pushState.mock.calls.length).toBe(afterOff + 1);
  });
});
