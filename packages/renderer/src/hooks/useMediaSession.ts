import { useEffect, useRef } from 'react';
import type { Track } from '../api';

/**
 * 系统媒体控件 / 耳机媒体键 / macOS「正在播放」的接线。
 *
 * ## 为什么是这一个 API 顶三件事
 *
 * `navigator.mediaSession` 是标准 Web API（Chromium 内置）。在 macOS 上，
 * Chromium 的 media session **底层接的就是 `MPNowPlayingInfoCenter`** ——
 * 所以设一次 metadata，**系统媒体控件（控制中心 / 锁屏）、耳机与键盘媒体键、
 * macOS「正在播放」**三件事一起点亮，不需要写原生模块。
 *
 * 前提条件：Chromium 只在**页面有真实 `<audio>` 元素播放**时才发布 session。
 * Maestro 的 A/B 槽位（`specs/audio-fx` §2.2）是常驻 `<audio>` → 天然满足。
 *
 * ## 媒体键**只能走这一条路**
 *
 * Electron 在 macOS 上把媒体键实现成 `globalShortcut` 走同一条 remote command
 * center 通道；**一旦注册就会占住通道并关掉 Chromium 自己的媒体键处理** →
 * 页面的 media session 再也收不到 seek 等远程命令。
 * ⇒ 媒体键归这里，`globalShortcut` **只注册非媒体键**（见
 * `packages/electron/src/global-shortcuts.ts`）。
 *
 * ## handler 只注册一次
 *
 * 每次切歌都重注册 handler 会有两个问题：① `setActionHandler` 反复调用会
 * 短暂地"没有 handler"（系统按键正好落在这个窗口里就丢事件）；② 无谓的抖动。
 * ⇒ handler 在 mount 时注册一次，**每次触发都从 ref 读当下状态**。
 */

/** 播放命令 —— 由 App 层接到 `usePlayer` 的动作上。 */
export interface MediaSessionCommands {
  /** 恢复播放 */
  play: () => void;
  /** 暂停 */
  pause: () => void;
  /** 上一首 */
  prev: () => void;
  /** 下一首 */
  next: () => void;
  /** 跳到指定秒数 */
  seek: (seconds: number) => void;
  /** 停止（= 暂停，桌面播放器没有独立的 stop 语义） */
  stop: () => void;
}

/** 系统没给 seekOffset 时，前进/后退的默认步长（秒）。 */
const DEFAULT_SEEK_STEP_SEC = 10;

/**
 * 取 `navigator.mediaSession`。**每次都现取**（不缓存）——
 * 浏览器里它是只读属性，但测试要能替换掉它，缓存会挡住替换。
 */
function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.mediaSession ?? null;
}

/** 能不能构造 MediaMetadata —— happy-dom 等环境里没有这个全局。 */
function hasMediaMetadata(): boolean {
  return typeof MediaMetadata !== 'undefined';
}

/**
 * 把播放状态接到系统的媒体控件上。
 *
 * @param track 当前曲目（null = 没有在播的东西）
 * @param playing 是否在播
 * @param currentTime 当前播放位置（秒）
 * @param duration 总时长（秒）
 * @param commands 播放命令
 */
export function useMediaSession(
  track: Track | null,
  playing: boolean,
  currentTime: number,
  duration: number,
  commands: MediaSessionCommands,
): void {
  // 最新状态进 ref —— handler 只注册一次，但每次触发都要读到**当下**的状态。
  const stateRef = useRef({ track, playing, currentTime, duration, commands });
  stateRef.current = { track, playing, currentTime, duration, commands };

  // ── 1. action handler（只注册一次，卸载时全部注销）────────────────
  useEffect(() => {
    const ms = getMediaSession();
    if (!ms) return;

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => stateRef.current.commands.play()],
      ['pause', () => stateRef.current.commands.pause()],
      ['previoustrack', () => stateRef.current.commands.prev()],
      ['nexttrack', () => stateRef.current.commands.next()],
      [
        'seekbackward',
        (details: MediaSessionActionDetails) => {
          const step = details.seekOffset ?? DEFAULT_SEEK_STEP_SEC;
          stateRef.current.commands.seek(stateRef.current.currentTime - step);
        },
      ],
      [
        'seekforward',
        (details: MediaSessionActionDetails) => {
          const step = details.seekOffset ?? DEFAULT_SEEK_STEP_SEC;
          stateRef.current.commands.seek(stateRef.current.currentTime + step);
        },
      ],
      [
        'seekto',
        (details: MediaSessionActionDetails) => {
          stateRef.current.commands.seek(details.seekTime ?? 0);
        },
      ],
      ['stop', () => stateRef.current.commands.stop()],
    ];

    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // 该平台/该浏览器不支持这个 action —— 跳过，别让整条链路挂掉
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // 同上
        }
      }
    };
  }, []);

  // ── 2. metadata（歌名 / 歌手 / 专辑 / 封面）──────────────────────
  useEffect(() => {
    const ms = getMediaSession();
    if (!ms) return;
    if (!track) {
      ms.metadata = null;
      return;
    }
    if (!hasMediaMetadata()) return;
    // 封面用**原始远端 URL**（`track.coverUrl`），不是 cover-proxy：
    // macOS 的「正在播放」是**操作系统进程**去取这张图，
    // 它取不到 127.0.0.1 的 sidecar 地址，但能取公网 CDN。
    const artwork = track.coverUrl
      ? [{ src: track.coverUrl, sizes: '512x512', type: '' }]
      : undefined;
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      ...(artwork ? { artwork } : {}),
    });
  }, [track?.id, track?.title, track?.artist, track?.album, track?.coverUrl]);

  // ── 3. playbackState（系统据此显示 播放/暂停 图标）────────────────
  useEffect(() => {
    const ms = getMediaSession();
    if (!ms) return;
    ms.playbackState = !track ? 'none' : playing ? 'playing' : 'paused';
  }, [track?.id, playing]);

  // ── 4. setPositionState（系统据此画进度条）────────────────────────
  useEffect(() => {
    const ms = getMediaSession();
    if (!ms) return;
    const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (dur <= 0) return;
    try {
      // position 必须 ≤ duration，否则 setPositionState 会抛。
      const pos = Math.max(0, Math.min(currentTime, dur));
      ms.setPositionState({ duration: dur, position: pos, playbackRate: 1 });
    } catch {
      // 某些环境在 duration 尚未就绪时会抛 —— 忽略，下一次 timeupdate 会补
    }
  }, [currentTime, duration]);
}
