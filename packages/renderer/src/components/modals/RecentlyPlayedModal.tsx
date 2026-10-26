/**
 * 最近播放（specs/play-history/）。
 *
 * ## 为什么需要它
 *
 * 用户回头找「昨天那首」的唯一途径 —— 功能盘点 P1：
 * `播放历史 / 最近播放 · playHistory / 播放历史 → 0 处`。
 *
 * ## 数据从哪来
 *
 * 服务端按 **session 分片**存（`history:<sessionId>`），跟 ❤ 库/歌单一样 ——
 * 播放历史是**用户数据**，不是本机使用痕迹（搜索历史才是，见
 * `specs/search-history/`）。⇒ 换 session 就是另一份，互不串。
 *
 * 记录时机在 `usePlayer.presentTrack`：**换歌**时记一条；同一首歌的跨平台降级
 * 不记（否则一次 code=4 降级会在历史里塞三条同一首歌）。
 *
 * ## 语义：「最近播放」不是「播放流水」
 *
 * 同一首歌再听一次 → 移到最前 + 更新时间，**不追加第二条**。流水账对
 * 「找回昨天那首」这个用途没用，还会让列表被同一首歌刷屏。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import type { MusicProvider, UnifiedSearchItem, UnifiedSourceInfo } from '../../api';
import { clampText, formatDuration } from '../../lib/format';

export interface PlayHistoryItem {
  id: string;
  platform: string;
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration: number;
  playedAt: number;
}

export interface RecentlyPlayedModalProps {
  open: boolean;
  onClose: () => void;
  /** 最近播放的条目（最近优先） */
  entries: PlayHistoryItem[];
  loading?: boolean;
  /** 点一条 → 播放它（modal 只派发，不自己播） */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  /** 清空历史 */
  onClear: () => void;
}

/** 相对时间（够用即可，不引日期库）。 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

/**
 * 历史条目 → 可播放的 unified item。
 *
 * 历史的来源可能是任意平台（甚至没在 ❤ 库里），所以这里**自己拼**一个最小的
 * unified item：只有一条 source，指向它自己的平台/trackId。
 */
export function historyEntryToUnified(entry: PlayHistoryItem): UnifiedSearchItem {
  const platform = entry.platform as MusicProvider;
  const url = `/music/stream/${platform}/${encodeURIComponent(entry.trackId)}`;
  const source: UnifiedSourceInfo = {
    platform,
    trackId: entry.trackId,
    hasCopyright: true,
    url,
  };
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album ?? '',
    coverUrl: entry.coverUrl ?? '',
    duration: entry.duration,
    sources: [source],
    bestSource: platform,
    versionType: 'studio',
    versions: [
      {
        id: `ver-${entry.id}`,
        duration: entry.duration,
        sources: [source],
        bestSource: platform,
      },
    ],
  };
}

export function RecentlyPlayedModal({
  open,
  onClose,
  entries,
  loading,
  onPlay,
  onClear,
}: RecentlyPlayedModalProps) {
  const items = React.useMemo(() => entries.map(historyEntryToUnified), [entries]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>最近播放</DialogTitle>
          <DialogDescription>
            {entries.length > 0 ? `${entries.length} 首 · 最多保留 200 首` : '（空）'}
          </DialogDescription>
        </DialogHeader>

        {entries.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-destructive"
              onClick={onClear}
              aria-label="清空播放历史"
            >
              清空历史
            </button>
          </div>
        )}

        {loading && <div className="py-6 text-center text-sm text-muted-foreground">读取中…</div>}

        {!loading && entries.length === 0 && (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            还没有播放记录 —— 听过的歌会出现在这里
          </div>
        )}

        {entries.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm">
            {entries.map((e, i) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/10"
              >
                <button
                  type="button"
                  onClick={() => onPlay(items, i)}
                  aria-label={`播放 ${e.title}`}
                  className="flex min-w-0 flex-1 flex-col items-start text-left hover:text-accent-foreground"
                >
                  <span className="w-full truncate" title={e.title}>
                    {clampText(e.title, 40)}
                  </span>
                  <span className="w-full truncate text-xs text-muted-foreground" title={e.artist}>
                    {clampText(e.artist, 30)}
                  </span>
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(e.playedAt)}
                </span>
                {e.duration > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDuration(e.duration)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
