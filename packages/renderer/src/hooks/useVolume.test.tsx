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
 *
 * 2026-10-20 接线时改了签名：参数从「单个 audioRef」换成「**AudioSlots**」——
 * crossfade 之后 App 常驻两个 `<audio>`，只推活跃的那个会让**淡出中的歌留在旧
 * 音量上**（用户拖滑块时正在淡出的歌突然变响）。所以契约多了一条：**两个槽位
 * 都要收到音量**。
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

/**
 * 假 A/B 槽位：happy-dom 的 HTMLMediaElement 不实现 volume 语义。
 * 返回两个假元素 + slots 容器（只用 all()，但做成真的 AudioSlots 形状，
 * 免得将来 hook 改了用法测试就失真）。
 */
function makeSlots(volume = 0.5) {
  const a = { volume } as HTMLAudioElement;
  const b = { volume } as HTMLAudioElement;
  const slots = {
    ref: () => () => {},
    get: () => a,
    el: (slot: 'a' | 'b') => (slot === 'a' ? a : b),
    active: () => 'a' as const,
    other: () => 'b' as const,
    setActive: () => false,
    all: () => [a, b],
    subscribe: () => () => {},
  };
  return { slots: slots as never, a, b };
}

describe('useVolume', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始 volume / muted 从 localStorage 读出', () => {
    seedVolume(0.42, true);
    const { result } = renderHook(() => useVolume(makeSlots().slots, null));
    expect(result.current.volume).toBe(0.42);
    expect(result.current.muted).toBe(true);
  });

  it('没有存过 → 音量 1（满音量）/ 未静音（storage 的默认值）', () => {
    const { result } = renderHook(() => useVolume(makeSlots().slots, null));
    expect(result.current.volume).toBe(1);
    expect(result.current.muted).toBe(false);
  });

  it('音量 + 静音写回 localStorage（单 JSON key）', () => {
    const { result } = renderHook(() => useVolume(makeSlots().slots, null));
    act(() => {
      result.current.toggleMute();
    });
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.volume) as string);
    expect(raw.muted).toBe(true);
    expect(raw.volume).toBe(1);
  });

  it('偏好推到 live <audio>：未静音时是 volume，muted 时是 0', () => {
    seedVolume(0.42, false);
    const { slots, a, b } = makeSlots(0);
    const { result } = renderHook(() => useVolume(slots, track));
    expect(a.volume).toBe(0.42);
    expect(b.volume).toBe(0.42);

    act(() => {
      result.current.toggleMute();
    });
    expect(a.volume).toBe(0);
    expect(b.volume).toBe(0);
  });

  it('两个槽位都收到音量（淡出中的歌不能留在旧音量上）', () => {
    // 这是接线的核心不变式：crossfade 之后有两个 <audio>，只推活跃的那个
    // → 用户拖滑块时，正在淡出的那首会突然变响/变轻。
    seedVolume(0.3, false);
    const { slots, a, b } = makeSlots(1);
    const { result } = renderHook(() => useVolume(slots, track));
    expect(a.volume).toBe(0.3);
    expect(b.volume).toBe(0.3);

    act(() => {
      result.current.changeVolume(0.9);
    });
    expect(a.volume).toBe(0.9);
    expect(b.volume).toBe(0.9);
  });

  it('拖动滑块：从 0 往上拖会自动取消静音', () => {
    seedVolume(0, true);
    const { slots, a } = makeSlots(0);
    const { result } = renderHook(() => useVolume(slots, track));
    expect(result.current.muted).toBe(true);

    act(() => {
      result.current.handleVolumeChange({ target: { value: '40' } } as never);
    });
    expect(result.current.volume).toBe(0.4);
    expect(result.current.muted).toBe(false);
    expect(a.volume).toBe(0.4);
  });

  it('拖动滑块不会取消静音（已非静音状态）', () => {
    const { result } = renderHook(() => useVolume(makeSlots().slots, null));
    act(() => {
      result.current.handleVolumeChange({ target: { value: '70' } } as never);
    });
    expect(result.current.volume).toBe(0.7);
    expect(result.current.muted).toBe(false);
  });

  it('toggleMute 只翻静音位，不动 volume（取消静音能恢复原音量）', () => {
    const { slots, a } = makeSlots(1);
    const { result } = renderHook(() => useVolume(slots, track));
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
    expect(a.volume).toBe(0);

    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(false);
    expect(result.current.volume).toBe(level);
    expect(a.volume).toBe(level);
  });
});
