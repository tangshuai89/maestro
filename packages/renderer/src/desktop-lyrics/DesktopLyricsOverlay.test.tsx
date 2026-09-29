/**
 * DesktopLyricsOverlay.test.tsx — 桌面歌词浮窗展示组件。
 *
 * 行为契约：
 *  1. 双行渲染：当前行 + 下一行，行内进度按 progress 取宽度
 *  2. 暂停：当前行带 ‖ 标记 + 根节点 data-playing=false（CSS 负责降透明度）
 *  3. 无歌词 → 提示文案，不渲染空行
 *  4. 配色/描边/锁定 → 根节点 data-* + CSS 变量 --lyric-scale
 *  5. 设置面板：锁定时不出现入口；字号/配色/描边/锁定/关闭各回调一次
 *  6. 歌名行：state.title/artist 渲染成 `歌名 — 歌手`；两者都空时整行不渲染
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DesktopLyricsOverlay, {
  type DesktopLyricsOverlayProps,
} from './DesktopLyricsOverlay';
import type {
  DesktopLyricsPrefsPayload,
  DesktopLyricsState,
} from '../../../electron/src/preload';

const STATE: DesktopLyricsState = {
  playing: true,
  current: '你应该对我说谎',
  next: '别管我怎么说',
  progress: 0.42,
  title: '你应该对我说谎',
  artist: '张宇',
};

const PREFS: DesktopLyricsPrefsPayload = {
  enabled: true,
  locked: false,
  fontScale: 1,
  stroke: true,
  palette: 'light',
};

function makeProps(over: Partial<DesktopLyricsOverlayProps> = {}): DesktopLyricsOverlayProps {
  return {
    state: STATE,
    prefs: PREFS,
    hasLyrics: true,
    onToggleLock: vi.fn(),
    onPrefs: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

const root = (): HTMLElement => document.querySelector('.lyric-overlay') as HTMLElement;

describe('DesktopLyricsOverlay', () => {
  it('渲染当前行 + 下一行 + 行内进度', () => {
    render(<DesktopLyricsOverlay {...makeProps()} />);
    expect(screen.getByTestId('lyric-current')).toHaveTextContent('你应该对我说谎');
    expect(screen.getByTestId('lyric-next')).toHaveTextContent('别管我怎么说');
    const fill = document.querySelector('.lyric-progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('42%');
  });

  it('暂停：当前行前缀 ‖ 标记 + data-playing=false', () => {
    render(<DesktopLyricsOverlay {...makeProps({ state: { ...STATE, playing: false } })} />);
    expect(screen.getByTestId('lyric-current')).toHaveTextContent('‖你应该对我说谎');
    expect(root()).toHaveAttribute('data-playing', 'false');
  });

  it('进度夹到 0..100%', () => {
    render(<DesktopLyricsOverlay {...makeProps({ state: { ...STATE, progress: 3 } })} />);
    expect((document.querySelector('.lyric-progress__fill') as HTMLElement).style.width).toBe('100%');
  });

  it('无歌词：提示文案，不渲染歌词行', () => {
    render(
      <DesktopLyricsOverlay
        {...makeProps({ hasLyrics: false, state: { ...STATE, current: null, next: null } })}
      />,
    );
    expect(screen.getByTestId('lyric-empty')).toHaveTextContent('暂无歌词');
    expect(screen.queryByTestId('lyric-current')).not.toBeInTheDocument();
  });

  it('hasLyrics=true 但还没开口：current 空、下一句预告', () => {
    render(
      <DesktopLyricsOverlay
        {...makeProps({ state: { ...STATE, current: null, next: '第一句' } })}
      />,
    );
    expect(screen.getByTestId('lyric-current')).toHaveTextContent('');
    expect(screen.getByTestId('lyric-next')).toHaveTextContent('第一句');
  });

  it('配色 / 描边 / 锁定映射到根节点 data-*，字号映射到 CSS 变量', () => {
    render(
      <DesktopLyricsOverlay
        {...makeProps({
          prefs: { ...PREFS, palette: 'amber', stroke: false, locked: true, fontScale: 1.35 },
        })}
      />,
    );
    const el = root();
    expect(el).toHaveAttribute('data-palette', 'amber');
    expect(el).toHaveAttribute('data-stroke', 'off');
    expect(el).toHaveAttribute('data-locked', 'true');
    expect(el.style.getPropertyValue('--lyric-scale')).toBe('1.35');
  });

  it('锁定：连设置入口都不渲染（锁定 = 只看不碰）', () => {
    render(<DesktopLyricsOverlay {...makeProps({ prefs: { ...PREFS, locked: true } })} />);
    expect(screen.queryByLabelText('桌面歌词设置')).not.toBeInTheDocument();
  });

  it('设置面板：字号 / 配色 / 描边 各自回调', () => {
    const onPrefs = vi.fn();
    render(<DesktopLyricsOverlay {...makeProps({ onPrefs })} />);
    fireEvent.click(screen.getByLabelText('桌面歌词设置'));
    expect(screen.getByRole('group', { name: '桌面歌词设置' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('大'));
    expect(onPrefs).toHaveBeenCalledWith({ fontScale: 1.35 });

    fireEvent.click(screen.getByLabelText('配色：青'));
    expect(onPrefs).toHaveBeenCalledWith({ palette: 'cyan' });

    fireEvent.click(screen.getByText('开')); // 当前描边=开 → 点一下变关
    expect(onPrefs).toHaveBeenCalledWith({ stroke: false });
  });

  it('设置面板：锁定 / 关闭 各回调一次', () => {
    const onToggleLock = vi.fn();
    const onClose = vi.fn();
    render(<DesktopLyricsOverlay {...makeProps({ onToggleLock, onClose })} />);
    fireEvent.click(screen.getByLabelText('桌面歌词设置'));
    fireEvent.click(screen.getByText('锁定（点击穿透）'));
    expect(onToggleLock).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('关闭浮窗'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('歌名行：title — artist 都渲染；缺一也能出；都空则整行不渲染', () => {
    const { unmount } = render(<DesktopLyricsOverlay {...makeProps()} />);
    expect(screen.getByTestId('lyric-song')).toHaveTextContent('你应该对我说谎 — 张宇');
    unmount();

    const onlyTitle = render(
      <DesktopLyricsOverlay
        {...makeProps({
          state: { ...STATE, artist: undefined },
        })}
      />,
    );
    expect(screen.getByTestId('lyric-song')).toHaveTextContent('你应该对我说谎');
    expect(screen.getByTestId('lyric-song').textContent).not.toContain('—');
    onlyTitle.unmount();

    render(
      <DesktopLyricsOverlay
        {...makeProps({
          state: { ...STATE, title: undefined, artist: undefined },
        })}
      />,
    );
    expect(screen.queryByTestId('lyric-song')).toBeNull();
  });

  it('歌名行：无歌词态同样显示（否则浮窗只剩一行「暂无歌词」）', () => {
    render(
      <DesktopLyricsOverlay
        {...makeProps({ hasLyrics: false, state: { ...STATE, current: null, next: null } })}
      />,
    );
    expect(screen.getByTestId('lyric-empty')).toBeInTheDocument();
    expect(screen.getByTestId('lyric-song')).toHaveTextContent('张宇');
  });

  it('字号档位高亮按 fontScale 就近匹配', () => {
    render(<DesktopLyricsOverlay {...makeProps({ prefs: { ...PREFS, fontScale: 1.1 } })} />);
    fireEvent.click(screen.getByLabelText('桌面歌词设置'));
    expect(screen.getByText('中')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('大')).toHaveAttribute('aria-pressed', 'false');
  });
});
