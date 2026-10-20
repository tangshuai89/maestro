/**
 * useVolume 测试（此前零覆盖）。
 *
 * 覆盖的是**契约**，不是实现细节：
 *  - 初始 volume / muted 从 localStorage 读出（重启后恢复）
 *  - 音量 + 静音写回 localStorage（单 JSON key）
 *  - 偏好真的推到 live `<audio>` 元素上（muted 时输出 0）
 *  - 拖动滑块：从 0 往上拖会**自动取消静音**（手势 = 「我要声音」）
 *  - toggleMute 只翻静音位，**不动 volume**（取消静音要恢复原音量）
 *
 * 用真实 storage lib（不 mock），这样「读 → 用 → 写」的整条链都被覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVolume } from './useVolume';
import { STORAGE_KEYS } from '../lib/storage';
import type { Track } from '../api';

const track = { id: 't1', provider: 'qq' } as unknown as Track;

function seedVolume(volume: number, muted: boolean) {
  localStorage.setItem(STORAGE_KEYS.volume, JSON.stringify({ volume, muted }));
}

/** 假 `<audio>`：happy-dom 的 HTMLMediaElement 不实现 volume 语义。 */
function makeAudioRef(volume = 0.5) {
  const el = { volume } as HTMLAudioElement;
  return { current: el };
}

describe('useVolume', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始 volume / muted 从 localStorage 读出', () => {
    seedVolume(0.42, true);
    const { result } = renderHook(() => useVolume(makeAudioRef(), null));
    expect(result.current.volume).toBe(0.42);
    expect(result.current.muted).toBe(true);
  });

  it('没有存过 → 音量 1（满音量）/ 未静音（storage 的默认值）', () => {
    const { result } = renderHook(() => useVolume(makeAudioRef(), null));
    expect(result.current.volume).toBe(1);
    expect(result.current.muted).toBe(false);
  });

  it('音量 + 静音写回 localStorage（单 JSON key）', () => {
    const { result } = renderHook(() => useVolume(makeAudioRef(), null));
    act(() => {
      result.current.toggleMute();
    });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.volume) as string);
    expect(raw.muted).toBe(true);
    expect(raw.volume).toBe(1);
  });

  it('偏好推到 live <audio>：未静音时是 volume，muted 时是 0', () => {
    seedVolume(0.42, false);
    const ref = makeAudioRef(0);
    const { result } = renderHook(() => useVolume(ref, track));
    expect(ref.current!.volume).toBe(0.42);

    act(() => {
      result.current.toggleMute();
    });
    expect(ref.current!.volume).toBe(0);
  });

  it('拖动滑块：从 0 往上拖会自动取消静音', () => {
    seedVolume(0, true);
    const ref = makeAudioRef(0);
    const { result } = renderHook(() => useVolume(ref, track));
    expect(result.current.muted).toBe(true);

    act(() => {
      result.current.handleVolumeChange({ target: { value: '40' } } as never);
    });
    expect(result.current.volume).toBe(0.4);
    expect(result.current.muted).toBe(false);
    expect(ref.current!.volume).toBe(0.4);
  });

  it('拖动滑块不会取消静音（已非静音状态）', () => {
    const { result } = renderHook(() => useVolume(makeAudioRef(), null));
    act(() => {
      result.current.handleVolumeChange({ target: { value: '70' } } as never);
    });
    expect(result.current.volume).toBe(0.7);
    expect(result.current.muted).toBe(false);
  });

  it('toggleMute 只翻静音位，不动 volume（取消静音能恢复原音量）', () => {
    const ref = makeAudioRef(1);
    const { result } = renderHook(() => useVolume(ref, track));
    act(() => {
      result.current.handleVolumeChange({ target: { value: '80' } } as never);
    });
    const level = result.current.volume;
    expect(level).toBe(0.8);

    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(true);
    expect(result.current.volume).toBe(level);
    expect(ref.current!.volume).toBe(0);

    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(false);
    expect(result.current.volume).toBe(level);
    expect(ref.current!.volume).toBe(level);
  });
});
