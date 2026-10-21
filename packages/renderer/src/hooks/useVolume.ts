import { useEffect, useState, type ChangeEvent } from 'react';
import { readStoredMuted, readStoredVolume, writeStoredVolume } from '../lib/storage';
import type { Track } from '../api';
import type { AudioSlots } from '../lib/audioSlots';

/**
 * Volume + mute, persisted to localStorage and pushed onto the live <audio>
 * elements. `muted` is kept separate from `volume` so unmuting restores the
 * user's previous level — the effective output is `muted ? 0 : volume`.
 *
 * `track` is a dependency of the push effect so a freshly-mounted source
 * starts at the persisted level without a flash of full-volume audio.
 *
 * ## 为什么推给**所有**槽位，而不是只推活跃的那个
 *
 * crossfade 之后 App 常驻**两个** `<audio>`（specs/audio-fx §2.2 的 A/B 槽位）。
 * 只推活跃槽位的话，淡出的那一个会**留在旧音量上** —— 用户拖滑块时正在淡出的
 * 歌突然变响/变轻。`slots.all()` 一次拿到两个元素，都要推。
 */
export function useVolume(slots: AudioSlots, track: Track | null) {
  const [volume, setVolume] = useState<number>(() => readStoredVolume());
  const [muted, setMuted] = useState<boolean>(() => readStoredMuted());

  // Persist volume + muted (single JSON key).
  useEffect(() => {
    writeStoredVolume(volume, muted);
  }, [volume, muted]);

  // Push the preference onto every live <audio> element whenever it changes.
  useEffect(() => {
    for (const audio of slots.all()) {
      audio.volume = muted ? 0 : volume;
    }
  }, [volume, muted, track, slots]);

  /**
   * 改音量（0..1）。
   *
   * 从 0 往上拖时**自动取消静音** —— 这个手势的意思是"我要声音了"。
   * （滑块在静音态下显示 0，用户往上拖 → 立刻出声，比"还要再点一下取消静音"
   *  符合直觉。）
   */
  const changeVolume = (v: number) => {
    const next = Math.min(1, Math.max(0, v));
    setVolume(next);
    if (next > 0 && muted) setMuted(false);
  };

  /** Slider 的 change 事件包装（DOM 事件 → 数值）。 */
  const handleVolumeChange = (e: ChangeEvent<HTMLInputElement>) => {
    changeVolume(Number(e.target.value) / 100);
  };

  /** Toggle muted without touching volume, so unmuting restores the level. */
  const toggleMute = () => setMuted((m) => !m);

  return { volume, muted, changeVolume, handleVolumeChange, toggleMute };
}
