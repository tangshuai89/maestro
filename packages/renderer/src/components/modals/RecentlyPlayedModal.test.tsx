/**
 * 最近播放弹窗（specs/play-history/）。
 *
 * 盯三件事：
 *  1. 条目渲染出来（歌名 / 歌手 / 相对时间 / 时长）
 *  2. 点一条 → 派发 onPlay(items, index)，且 **items 是可播的 unified item**
 *  3. 空态 / 清空
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  RecentlyPlayedModal,
  relativeTime,
  historyEntryToUnified,
  type PlayHistoryItem,
} from './RecentlyPlayedModal';

function entry(over: Partial<PlayHistoryItem> = {}): PlayHistoryItem {
  return {
    id: 'qq:mid1',
    platform: 'qq',
    trackId: 'mid1',
    title: 'Drip Dry Eyes',
    artist: 'YUKIHIRO TAKAHASHI',
    album: '专辑',
    coverUrl: '',
    duration: 330,
    playedAt: 1_700_000_000_000,
    ...over,
  };
}

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  it('一分钟内 → 刚刚', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚');
  });
  it('分钟级', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
  });
  it('小时级', () => {
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前');
  });
  it('天级', () => {
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前');
  });
  it('月级', () => {
    expect(relativeTime(now - 40 * 86_400_000, now)).toBe('1 个月前');
  });
});

describe('historyEntryToUnified', () => {
  it('拼出可播的 unified item（一条 source 指向自己的平台）', () => {
    const u = historyEntryToUnified(entry());
    expect(u.id).toBe('qq:mid1');
    expect(u.bestSource).toBe('qq');
    expect(u.sources).toHaveLength(1);
    expect(u.sources[0].platform).toBe('qq');
    expect(u.sources[0].trackId).toBe('mid1');
    expect(u.sources[0].url).toContain('/music/stream/qq/mid1');
    expect(u.duration).toBe(330);
  });
});

describe('RecentlyPlayedModal', () => {
  it('渲染条目（歌名 / 歌手 / 时长）', () => {
    render(
      <RecentlyPlayedModal
        open
        onClose={() => {}}
        entries={[entry()]}
        onPlay={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText('Drip Dry Eyes')).toBeInTheDocument();
    expect(screen.getByText('YUKIHIRO TAKAHASHI')).toBeInTheDocument();
    expect(screen.getByText('5:30')).toBeInTheDocument();
  });

  it('点一条 → 派发 onPlay(items, index)', () => {
    const onPlay = vi.fn();
    render(
      <RecentlyPlayedModal
        open
        onClose={() => {}}
        entries={[entry(), entry({ id: 'netease:mid2', trackId: 'mid2', title: '歌二' })]}
        onPlay={onPlay}
        onClear={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('播放 歌二'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    const [items, index] = onPlay.mock.calls[0];
    expect(index).toBe(1);
    expect(items).toHaveLength(2);
    expect(items[1].id).toBe('netease:mid2');
  });

  it('空历史 → 空态文案', () => {
    render(
      <RecentlyPlayedModal
        open
        onClose={() => {}}
        entries={[]}
        onPlay={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/还没有播放记录/)).toBeInTheDocument();
  });

  it('点「清空历史」→ 派发 onClear', () => {
    const onClear = vi.fn();
    render(
      <RecentlyPlayedModal
        open
        onClose={() => {}}
        entries={[entry()]}
        onPlay={() => {}}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByLabelText('清空播放历史'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
