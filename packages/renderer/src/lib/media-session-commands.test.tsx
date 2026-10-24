/**
 * `buildMediaSessionCommands` 单测。
 *
 * ## 这个测试守的是什么
 *
 * 系统媒体控件分 `play` / `pause` 两个动作，而 `usePlayer` 只有一个
 * `handlePlayPause`（toggle）。**接错的后果是"按播放键反而暂停"** ——
 * 而且这种错在开发时很难发现（用户得真的按媒体键才看得到）。
 *
 * 所以这里逐条断言：**每个 action 调到了哪个命令、在什么条件下才调**。
 */
import { describe, it, expect, vi } from 'vitest';
import { buildMediaSessionCommands } from './media-session-commands';

const makeSources = (playing: boolean) => ({
  playing,
  handlePlayPause: vi.fn(),
  handlePrev: vi.fn(),
  handleSkip: vi.fn(),
  seek: vi.fn(),
});

describe('buildMediaSessionCommands', () => {
  it('play：暂停中 → toggle 一次（恢复播放）', () => {
    const s = makeSources(false);
    buildMediaSessionCommands(s).play();
    expect(s.handlePlayPause).toHaveBeenCalledTimes(1);
  });

  it('play：已经在播 → **不** toggle（否则会变成暂停）', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).play();
    expect(s.handlePlayPause).not.toHaveBeenCalled();
  });

  it('pause：正在播 → toggle 一次', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).pause();
    expect(s.handlePlayPause).toHaveBeenCalledTimes(1);
  });

  it('pause：已经暂停 → **不** toggle', () => {
    const s = makeSources(false);
    buildMediaSessionCommands(s).pause();
    expect(s.handlePlayPause).not.toHaveBeenCalled();
  });

  it('stop：正在播 → toggle 一次（桌面播放器没有独立 stop 语义）', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).stop();
    expect(s.handlePlayPause).toHaveBeenCalledTimes(1);
  });

  it('stop：已暂停 → 不 toggle', () => {
    const s = makeSources(false);
    buildMediaSessionCommands(s).stop();
    expect(s.handlePlayPause).not.toHaveBeenCalled();
  });

  it('prev → handlePrev', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).prev();
    expect(s.handlePrev).toHaveBeenCalledTimes(1);
  });

  it('next → handleSkip', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).next();
    expect(s.handleSkip).toHaveBeenCalledTimes(1);
  });

  it('seek → handleSeek(秒数)', () => {
    const s = makeSources(true);
    buildMediaSessionCommands(s).seek(123);
    expect(s.seek).toHaveBeenCalledWith(123);
  });
});
