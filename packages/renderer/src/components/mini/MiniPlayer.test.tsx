/**
 * MiniPlayer.test.tsx — mini 浮层播控条。
 *
 * 行为契约：
 *  1. 无 track → 空态文案 + transport 禁用（expand 仍可用）
 *  2. 有 track → 渲染标题 / 歌手—专辑 / 封面 img / 进度比例 / 时间
 *  3. prev / play / next / like / expand 五个按钮各自触发回调
 *  4. 点进度条 → onSeek(ratio × duration)
 *  5. liked → .is-liked + aria-pressed；loading → play 禁用 + spinner
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import MiniPlayer, { type MiniPlayerProps } from './MiniPlayer';
import type { Track } from '../../api';

const TRACK: Track = {
  id: 't1',
  provider: 'qq',
  title: '你应该对我说谎',
  artist: '张宇',
  album: '男人的好（新歌+精选）',
  coverUrl: 'https://y.gtimg.cn/cover.jpg',
  audioUrl: '/music/stream/qq/t1',
  duration: 151,
  liked: false,
};

function makeProps(over: Partial<MiniPlayerProps> = {}): MiniPlayerProps {
  return {
    track: TRACK,
    playing: false,
    loading: false,
    liked: false,
    currentTime: 30,
    duration: 151,
    onPlayPause: vi.fn(),
    onSkip: vi.fn(),
    onPrev: vi.fn(),
    onLike: vi.fn(),
    onSeek: vi.fn(),
    onExpand: vi.fn(),
    ...over,
  };
}

describe('MiniPlayer', () => {
  it('无 track：空态文案 + transport 禁用、expand 可用', () => {
    const props = makeProps({ track: null });
    render(<MiniPlayer {...props} />);
    expect(screen.getByText('等待播放')).toBeInTheDocument();
    expect(screen.getByLabelText('播放')).toBeDisabled();
    expect(screen.getByLabelText('上一首')).toBeDisabled();
    expect(screen.getByLabelText('下一首')).toBeDisabled();
    expect(screen.getByLabelText('红心')).toBeDisabled();
    expect(screen.getByLabelText('展开剧场模式')).toBeEnabled();
  });

  it('有 track：渲染标题 / 歌手—专辑 / 封面 / 时间', () => {
    const { container } = render(<MiniPlayer {...makeProps()} />);
    expect(screen.getByText('你应该对我说谎')).toBeInTheDocument();
    expect(
      screen.getByText('张宇 — 男人的好（新歌+精选）'),
    ).toBeInTheDocument();
    const img = container.querySelector<HTMLImageElement>('.mini-cover img');
    expect(img?.src).toBe('https://y.gtimg.cn/cover.jpg');
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByText('-2:01')).toBeInTheDocument(); // 151-30=121s 剩余
  });

  it('无 coverUrl：渲染占位封面 ♪ 而无 <img>', () => {
    const { container } = render(
      <MiniPlayer {...makeProps({ track: { ...TRACK, coverUrl: '' } })} />,
    );
    expect(container.querySelector('.mini-cover img')).toBeNull();
    expect(container.querySelector('.mini-cover-symbol')).not.toBeNull();
  });

  it('五个按钮分别触发回调', () => {
    const props = makeProps();
    render(<MiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('上一首'));
    fireEvent.click(screen.getByLabelText('播放'));
    fireEvent.click(screen.getByLabelText('下一首'));
    fireEvent.click(screen.getByLabelText('红心'));
    fireEvent.click(screen.getByLabelText('展开剧场模式'));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onPlayPause).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onLike).toHaveBeenCalledTimes(1);
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });

  it('点封面也触发 onExpand（Apple Music miniPlayer 行为）', () => {
    const props = makeProps();
    render(<MiniPlayer {...props} />);
    fireEvent.click(screen.getByLabelText('封面 · 展开剧场模式'));
    expect(props.onExpand).toHaveBeenCalledTimes(1);
  });

  it('点进度条中点 → onSeek(0.5 × duration)', () => {
    const props = makeProps();
    const { container } = render(<MiniPlayer {...props} />);
    const bar = container.querySelector<HTMLDivElement>('.mini-progress')!;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 3,
      height: 3,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.click(bar, { clientX: 100 });
    expect(props.onSeek).toHaveBeenCalledWith(75.5);
  });

  it('无 track 时点进度条不触发 onSeek', () => {
    const props = makeProps({ track: null });
    const { container } = render(<MiniPlayer {...props} />);
    fireEvent.click(container.querySelector('.mini-progress')!);
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it('liked → is-liked + aria-pressed；播放中 → is-playing + 暂停语义', () => {
    const { container, rerender } = render(
      <MiniPlayer {...makeProps({ liked: true })} />,
    );
    const like = screen.getByLabelText('取消红心');
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(like.className).toContain('is-liked');

    rerender(<MiniPlayer {...makeProps({ liked: true, playing: true })} />);
    const play = screen.getByLabelText('暂停');
    expect(play.className).toContain('is-playing');
    expect(container.querySelector('.mini-player')).not.toBeNull();
  });

  it('loading → play 禁用 + spinner', () => {
    const { container } = render(<MiniPlayer {...makeProps({ loading: true })} />);
    expect(screen.getByLabelText('播放')).toBeDisabled();
    expect(container.querySelector('.mini-spinner')).not.toBeNull();
  });
});
