/**
 * LiteView.test.tsx — 极简播放模式（specs/lite-mode）。
 *
 * 行为契约：
 *  1. 有 track → 歌名 + 歌手副行；无 track → 占位文案、无副行
 *  2. 交互面恰好 4 个按钮（上一首 / 下一首 / ✨ / ⛶），多一个少一个都红
 *  3. 上一首 / 下一首 / ✨ / ⛶ 四个按钮各自触发回调
 *  4. 无 track 或 loading → ◀▶ 禁用
 *  5. recoRunning → ✨ 禁用 + aria-busy + 文案切「推荐中…」
 *  6. recoConfigured=false 时 ✨ 仍可点、title 提示先填 key，并挂 is-unset 视觉态
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import LiteView, { type LiteViewProps } from './LiteView';
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

function makeProps(over: Partial<LiteViewProps> = {}): LiteViewProps {
  return {
    track: TRACK,
    loading: false,
    recoConfigured: true,
    recoRunning: false,
    onPrev: vi.fn(),
    onSkip: vi.fn(),
    onReco: vi.fn(),
    onExit: vi.fn(),
    ...over,
  };
}

/**
 * 当前 DOM 里的「可点击元素」——用 button 而非 data-lite-el。
 *
 * 为什么不用 data-lite-el：那是组件自己打给自己的标记，数它等于自证——
 * ⛶ 退出键就没有这个属性，却照样是界面的一部分；再加任意一个不带标记的
 * 元素测试也不会红。可点击元素数才是真正会失败的契约。
 */
function clickableLabels(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll('button, [role="button"], a[href]'),
  )
    .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '?')
    .sort();
}

describe('LiteView', () => {
  it('有 track：渲染歌名 + 歌手副行', () => {
    render(<LiteView {...makeProps()} />);
    expect(screen.getByText('你应该对我说谎')).toBeInTheDocument();
    expect(screen.getByText('张宇')).toBeInTheDocument();
  });

  it('无 track：占位文案 + 无副行', () => {
    render(<LiteView {...makeProps({ track: null })} />);
    expect(screen.getByText('Lite 模式')).toBeInTheDocument();
    expect(screen.queryByText('张宇')).toBeNull();
  });

  it('交互面恰好 4 个：上一首 / 下一首 / ✨ / ⛶（多一个少一个都红）', () => {
    const { container } = render(<LiteView {...makeProps()} />);
    // 顺序即 Array.sort() 的码点序，写死了免得改动时误以为是渲染顺序
    expect(clickableLabels(container)).toEqual([
      '上一首',
      '下一首',
      '智能推荐',
      '返回完整界面',
    ]);
    // 三类可视元素（歌名块 / ◀▶ / ✨）齐备 ⛶ 之外的契约主体
    expect(
      Array.from(container.querySelectorAll('[data-lite-el]'))
        .map((el) => el.getAttribute('data-lite-el'))
        .sort(),
    ).toEqual(['nav', 'reco', 'title']);
  });

  it('不引入 titlebar / 搜索 / 歌词 —— 仅覆盖 LiteView 自身渲染范围', () => {
    // 注意边界：这三条只证明「LiteView 不自己长出这些」，集成层（App 是否
    // 挂 Titlebar / SearchPanel）不在本用例射程内，要验得去 App 级用例。
    const { container } = render(<LiteView {...makeProps()} />);
    expect(container.querySelector('.titlebar')).toBeNull();
    expect(container.querySelector('.search-panel')).toBeNull();
    expect(container.querySelector('[class*="th-lyrics"]')).toBeNull();
    // 歌名块只出现在 title 一处
    expect(container.querySelectorAll('.lite-title')).toHaveLength(1);
  });

  it('四个按钮分别触发回调', () => {
    const props = makeProps();
    render(<LiteView {...props} />);
    fireEvent.click(screen.getByLabelText('上一首'));
    fireEvent.click(screen.getByLabelText('下一首'));
    fireEvent.click(screen.getByLabelText('智能推荐'));
    fireEvent.click(screen.getByLabelText('返回完整界面'));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onReco).toHaveBeenCalledTimes(1);
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('无 track 或 loading → ◀▶ 禁用，✨ 仍可用', () => {
    const { rerender } = render(<LiteView {...makeProps({ track: null })} />);
    expect(screen.getByLabelText('上一首')).toBeDisabled();
    expect(screen.getByLabelText('下一首')).toBeDisabled();
    expect(screen.getByLabelText('智能推荐')).toBeEnabled();

    rerender(<LiteView {...makeProps({ loading: true })} />);
    expect(screen.getByLabelText('上一首')).toBeDisabled();
    expect(screen.getByLabelText('下一首')).toBeDisabled();
  });

  it('recoRunning → ✨ 禁用 + aria-busy + 「推荐中…」', () => {
    render(<LiteView {...makeProps({ recoRunning: true })} />);
    const reco = screen.getByLabelText('智能推荐');
    expect(reco).toBeDisabled();
    expect(reco).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('推荐中…')).toBeInTheDocument();
  });

  it('未配 key：✨ 仍可点 + title 提示先填 key + 挂 is-unset 视觉态', () => {
    const { rerender } = render(
      <LiteView {...makeProps({ recoConfigured: false })} />,
    );
    const reco = screen.getByLabelText('智能推荐');
    expect(reco).toBeEnabled();
    expect(reco.getAttribute('title')).toContain('DeepSeek key');
    // 没配 key 又没有任何视觉提示，用户点了只会以为按钮坏了
    expect(reco).toHaveClass('is-unset');

    // 配上了就不该再挂着未配置态
    rerender(<LiteView {...makeProps({ recoConfigured: true })} />);
    expect(screen.getByLabelText('智能推荐')).not.toHaveClass('is-unset');

    // 推荐在飞时以 is-running 为准，不叠 is-unset
    rerender(
      <LiteView
        {...makeProps({ recoConfigured: false, recoRunning: true })}
      />,
    );
    const running = screen.getByLabelText('智能推荐');
    expect(running).toHaveClass('is-running');
    expect(running).not.toHaveClass('is-unset');
  });
});
