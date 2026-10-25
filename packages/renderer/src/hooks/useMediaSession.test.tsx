/**
 * `useMediaSession` 单测 —— 系统媒体控件 / 耳机媒体键 / macOS「正在播放」的接线。
 *
 * ## 这个测试守的是什么
 *
 * **不是**"handler 注册了就算"。每个 action handler 都必须**真的调到对应的
 * 播放命令** —— 否则用户按媒体键没反应，而代码看起来完全正常。
 * 这也是「变异验证」的落点：把任一 handler 里的调用去掉，本文件必须变红。
 *
 * ## 环境说明
 *
 * happy-dom **不实现** `navigator.mediaSession` / `MediaMetadata`，
 * 所以这里自己造桩（`Object.defineProperty`，和 `test/setup.ts` 里
 * `navigator.clipboard` 的做法一致）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMediaSession, type MediaSessionCommands } from './useMediaSession';
import type { Track } from '../api';

const TRACK: Track = {
  id: 't1',
  provider: 'qq',
  title: '光辉岁月',
  artist: 'Beyond',
  album: '命运派对',
  coverUrl: 'https://y.gtimg.cn/cover.jpg',
  audioUrl: '/music/stream/qq/1',
  duration: 320,
  liked: false,
} as Track;

/** 假 mediaSession：记录 handler，测试直接调用它模拟"用户按了媒体键"。 */
class FakeMediaSession {
  metadata: unknown = null;
  playbackState = 'none';
  setPositionState = vi.fn();
  handlers = new Map<string, (details?: unknown) => void>();

  setActionHandler = vi.fn((action: string, handler: ((d?: unknown) => void) | null) => {
    if (handler) this.handlers.set(action, handler);
    else this.handlers.delete(action);
  });
}

let fake: FakeMediaSession;

/** 假命令集：每个都是 mock，测试直接断言"被调用了几次、参数是什么"。 */
type MockedCommands = {
  [K in keyof MediaSessionCommands]: ReturnType<typeof vi.fn>;
};

const makeCommands = (): MockedCommands => ({
  play: vi.fn(),
  pause: vi.fn(),
  prev: vi.fn(),
  next: vi.fn(),
  seek: vi.fn(),
  stop: vi.fn(),
});

beforeEach(() => {
  fake = new FakeMediaSession();
  Object.defineProperty(navigator, 'mediaSession', {
    value: fake,
    configurable: true,
  });
  // happy-dom 没有 MediaMetadata 全局
  class FakeMediaMetadata {
    title: string;
    artist: string;
    album: string;
    artwork?: unknown;
    constructor(init: Record<string, unknown>) {
      this.title = init.title as string;
      this.artist = init.artist as string;
      this.album = init.album as string;
      this.artwork = init.artwork as unknown;
    }
  }
  (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata = FakeMediaMetadata;
});

afterEach(() => {
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
});

describe('useMediaSession · 系统媒体控件接线', () => {
  it('metadata 组装正确（歌名 / 歌手 / 专辑 / 封面用原始远端 URL）', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    const md = fake.metadata as {
      title: string;
      artist: string;
      album: string;
      artwork?: { src: string }[];
    };
    expect(md.title).toBe('光辉岁月');
    expect(md.artist).toBe('Beyond');
    expect(md.album).toBe('命运派对');
    // 封面必须是**原始 CDN URL**，不能是 127.0.0.1 的 sidecar 地址 ——
    // macOS 的「正在播放」是操作系统进程去取图，它取不到本地端口。
    expect(md.artwork?.[0]?.src).toBe('https://y.gtimg.cn/cover.jpg');
  });

  it('没有当前曲目 → metadata 清空、playbackState = none', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(null, false, 0, 0, cmds));
    expect(fake.metadata).toBeNull();
    expect(fake.playbackState).toBe('none');
  });

  it('playbackState 随播放状态翻转（playing ⇄ paused）', () => {
    const cmds = makeCommands();
    const { rerender } = renderHook(
      ({ playing }: { playing: boolean }) =>
        useMediaSession(TRACK, playing, 0, TRACK.duration, cmds),
      { initialProps: { playing: true } },
    );
    expect(fake.playbackState).toBe('playing');
    rerender({ playing: false });
    expect(fake.playbackState).toBe('paused');
  });

  it('setPositionState 被调用且参数正确（duration / position / playbackRate）', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 42, TRACK.duration, cmds));
    expect(fake.setPositionState).toHaveBeenCalled();
    const arg = fake.setPositionState.mock.calls.at(-1)?.[0];
    expect(arg).toMatchObject({ duration: 320, position: 42, playbackRate: 1 });
  });

  it('position 超过 duration 时被夹住（setPositionState 会抛）', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 999, TRACK.duration, cmds));
    const arg = fake.setPositionState.mock.calls.at(-1)?.[0];
    expect(arg.position).toBe(320);
  });

  it('duration 未知（0）→ 不调 setPositionState', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, 0, cmds));
    expect(fake.setPositionState).not.toHaveBeenCalled();
  });
});

describe('useMediaSession · 媒体键动作（每个 handler 必须真的调到播放命令）', () => {
  it('play → 调 commands.play', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, false, 0, TRACK.duration, cmds));
    fake.handlers.get('play')!();
    expect(cmds.play).toHaveBeenCalledTimes(1);
  });

  it('pause → 调 commands.pause', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    fake.handlers.get('pause')!();
    expect(cmds.pause).toHaveBeenCalledTimes(1);
  });

  it('previoustrack → 调 commands.prev', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    fake.handlers.get('previoustrack')!();
    expect(cmds.prev).toHaveBeenCalledTimes(1);
  });

  it('nexttrack → 调 commands.next', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    fake.handlers.get('nexttrack')!();
    expect(cmds.next).toHaveBeenCalledTimes(1);
  });

  it('stop → 调 commands.stop', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    fake.handlers.get('stop')!();
    expect(cmds.stop).toHaveBeenCalledTimes(1);
  });

  it('seekto → 调 commands.seek(seekTime)', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    fake.handlers.get('seekto')!({ seekTime: 123 });
    expect(cmds.seek).toHaveBeenCalledWith(123);
  });

  it('seekbackward → 调 commands.seek(当前位置 - 步长)', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 100, TRACK.duration, cmds));
    fake.handlers.get('seekbackward')!({ seekOffset: 15 });
    expect(cmds.seek).toHaveBeenCalledWith(85);
  });

  it('seekforward → 调 commands.seek(当前位置 + 步长)', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 100, TRACK.duration, cmds));
    fake.handlers.get('seekforward')!({ seekOffset: 15 });
    expect(cmds.seek).toHaveBeenCalledWith(115);
  });

  it('seekbackward / seekforward 没给 seekOffset → 用默认 10 秒', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 100, TRACK.duration, cmds));
    fake.handlers.get('seekbackward')!({});
    fake.handlers.get('seekforward')!({});
    expect(cmds.seek).toHaveBeenNthCalledWith(1, 90);
    expect(cmds.seek).toHaveBeenNthCalledWith(2, 110);
  });

  it('handler 读的是**当下**的播放位置（切歌后仍准）', () => {
    const cmds = makeCommands();
    const { rerender } = renderHook(
      ({ t }: { t: number }) => useMediaSession(TRACK, true, t, TRACK.duration, cmds),
      { initialProps: { t: 10 } },
    );
    rerender({ t: 200 });
    fake.handlers.get('seekforward')!({ seekOffset: 10 });
    expect(cmds.seek).toHaveBeenCalledWith(210);
  });

  it('8 个 action handler 全部注册了', () => {
    const cmds = makeCommands();
    renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    const expected = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto',
      'stop',
    ];
    for (const action of expected) {
      expect(fake.handlers.has(action), `缺少 action handler: ${action}`).toBe(true);
    }
  });

  it('卸载 → 全部 handler 注销', () => {
    const cmds = makeCommands();
    const { unmount } = renderHook(() => useMediaSession(TRACK, true, 0, TRACK.duration, cmds));
    expect(fake.handlers.size).toBeGreaterThan(0);
    unmount();
    expect(fake.handlers.size).toBe(0);
  });
});

describe('useMediaSession · 降级', () => {
  it('浏览器没有 navigator.mediaSession → 不抛（不炸整个 App）', () => {
    delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
    const cmds = makeCommands();
    expect(() =>
      renderHook(() => useMediaSession(TRACK, true, 10, TRACK.duration, cmds)),
    ).not.toThrow();
  });

  it('浏览器没有 MediaMetadata → 不抛', () => {
    delete (globalThis as unknown as { MediaMetadata?: unknown }).MediaMetadata;
    const cmds = makeCommands();
    expect(() =>
      renderHook(() => useMediaSession(TRACK, true, 10, TRACK.duration, cmds)),
    ).not.toThrow();
  });

  it('setActionHandler 抛错（该平台不支持这个 action）→ 跳过，不炸', () => {
    const cmds = makeCommands();
    fake.setActionHandler.mockImplementation(() => {
      throw new Error('unsupported action');
    });
    expect(() =>
      renderHook(() => useMediaSession(TRACK, true, 10, TRACK.duration, cmds)),
    ).not.toThrow();
  });

  it('卸载时 setActionHandler 抛错 → 吞掉（不能因为清理失败而崩）', () => {
    const cmds = makeCommands();
    const { unmount } = renderHook(() => useMediaSession(TRACK, true, 10, TRACK.duration, cmds));
    fake.setActionHandler.mockImplementation(() => {
      throw new Error('cleanup boom');
    });
    expect(() => unmount()).not.toThrow();
  });

  it('setPositionState 抛错（duration 未就绪）→ 忽略，不炸', () => {
    const cmds = makeCommands();
    fake.setPositionState.mockImplementation(() => {
      throw new Error('position boom');
    });
    expect(() =>
      renderHook(() => useMediaSession(TRACK, true, 10, TRACK.duration, cmds)),
    ).not.toThrow();
  });
});
