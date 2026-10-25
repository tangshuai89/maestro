/**
 * QueuePanel.test.tsx — 播放队列面板（specs/queue-panel/）。
 *
 * 组件**只渲染 + 派发动作**：队列数据在 `usePlayer` 里（单一数据源），
 * 组件不自己存队列。所以这里的断言全部是「渲染对了 + 动作传出去了」。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { QueuePanel } from './QueuePanel';
import type { UnifiedSearchItem } from '../../api';

function makeItem(over: Partial<UnifiedSearchItem> = {}): UnifiedSearchItem {
  return {
    id: 'qq:1',
    title: '夜空中最亮的星',
    artist: '逃跑计划',
    album: '世界',
    coverUrl: '',
    duration: 251,
    sources: [{ platform: 'qq', trackId: '1', hasCopyright: true, url: 'https://x/1.mp3' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
    ...over,
  };
}

const A = makeItem();
const B = makeItem({ id: 'qq:2', title: '平凡之路', artist: '朴树', duration: 300 });

function renderPanel(over: Partial<React.ComponentProps<typeof QueuePanel>> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    items: [A, B],
    currentIndex: 0,
    onJump: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  const utils = render(<QueuePanel {...props} />);
  return { ...utils, props };
}

describe('QueuePanel · 列表', () => {
  it('列出队列全部曲目（序号 / 标题 / 艺术家 / 时长）', () => {
    renderPanel();
    expect(screen.getByText('播放队列')).toBeInTheDocument();
    expect(screen.getByText('夜空中最亮的星')).toBeInTheDocument();
    expect(screen.getByText('逃跑计划')).toBeInTheDocument();
    expect(screen.getByText('平凡之路')).toBeInTheDocument();
    expect(screen.getByText('朴树')).toBeInTheDocument();
    // 时长（4:11 / 5:00）
    expect(screen.getByText('4:11')).toBeInTheDocument();
    expect(screen.getByText('5:00')).toBeInTheDocument();
  });

  it('当前播放的那首高亮（▶ 标记 + data-current）', () => {
    renderPanel({ currentIndex: 1 });
    const current = document.querySelector('[data-current="true"]');
    expect(current).toBeTruthy();
    expect(current?.textContent).toContain('平凡之路');
    // 非当前的那首没有标记
    expect(document.querySelectorAll('[data-current="true"]')).toHaveLength(1);
  });

  it('空队列 → 显示空态文案', () => {
    renderPanel({ items: [] });
    expect(screen.getByText('队列是空的')).toBeInTheDocument();
  });

  it('没有队列（电台模式，items undefined）→ 明确说明为什么是空的', () => {
    renderPanel({ items: undefined });
    expect(screen.getByText('队列是空的')).toBeInTheDocument();
    expect(screen.getByText(/电台模式/)).toBeInTheDocument();
  });
});

describe('QueuePanel · 动作', () => {
  it('点某首 → onJump(index)', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '播放 平凡之路' }));
    expect(props.onJump).toHaveBeenCalledWith(1);
  });

  it('点「×」→ onRemove(index)', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '把 平凡之路 移出队列' }));
    expect(props.onRemove).toHaveBeenCalledWith(1);
  });

  it('「×」不会连带触发「跳到这一首」（两个按钮互不串扰）', () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '把 平凡之路 移出队列' }));
    expect(props.onRemove).toHaveBeenCalledWith(1);
    expect(props.onJump).not.toHaveBeenCalled();
  });
});
