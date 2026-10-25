/**
 * 队列面板（specs/queue-panel/）。
 *
 * ## 为什么需要它
 *
 * 播放队列一直是**用户看不见的黑盒**：搜了 20 首点了第 3 首，剩下的 17 首在哪？
 * 能不能跳到第 7 首？能不能把第 12 首从队列里拿掉？全都不知道。
 * （数据层早就齐备 —— `usePlayer` 的 `queueUnifiedItems` / `queueIdx`；
 * 缺的只是「看得见 + 能操作」。）
 *
 * ## 数据从哪来
 *
 * 队列快照由 `usePlayer` 持有（`queueUnifiedItems` + `queueIdx`），本组件**只渲染、
 * 只派发动作**，不自己存队列 —— 单一数据源。
 *
 * ## 「已在歌单」类的 key 一致性
 *
 * 本组件不判定曲目身份（那是歌单那边的活）→ 不需要 `playlistTrackKey`。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import type { UnifiedSearchItem } from '../../api';
import { clampText, formatDuration } from '../../lib/format';

export interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
  /** 队列（`usePlayer` 的 `queueUnifiedItems`）；undefined = 当前不是队列播放（电台模式） */
  items: UnifiedSearchItem[] | undefined;
  /** 当前播放的下标（`usePlayer` 的 `queueIdx`；-1 = 不在队列里） */
  currentIndex: number;
  /** 跳到队列第 N 首 */
  onJump: (index: number) => void;
  /** 把队列第 N 首移出 */
  onRemove: (index: number) => void;
}

export function QueuePanel({
  open,
  onClose,
  items,
  currentIndex,
  onJump,
  onRemove,
}: QueuePanelProps) {
  // list 必须 memo：`items ?? []` 每次渲染都是新数组 → 给下游 useMemo 当依赖
  // 会让它每次都重算。
  const list = React.useMemo(() => items ?? [], [items]);

  const totalSec = React.useMemo(
    () => list.reduce((sum, t) => sum + (t.duration > 0 ? t.duration : 0), 0),
    [list],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>播放队列</DialogTitle>
          <DialogDescription>
            {list.length > 0 ? (
              <>
                {list.length} 首 · 总时长 {formatDuration(totalSec)}
              </>
            ) : (
              '当前不是队列播放（电台模式）—— 搜一首歌或放一个歌单就会出现在这里'
            )}
          </DialogDescription>
        </DialogHeader>

        {list.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            队列是空的
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm">
            {list.map((t, i) => {
              const isCurrent = i === currentIndex;
              return (
                <li
                  key={`${t.id}-${i}`}
                  data-current={isCurrent ? 'true' : undefined}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                    isCurrent ? 'bg-accent/25' : 'hover:bg-accent/10'
                  }`}
                >
                  <span
                    className={`w-6 shrink-0 text-right text-xs ${
                      isCurrent ? 'text-accent-foreground font-semibold' : 'text-muted-foreground'
                    }`}
                    aria-label={isCurrent ? '正在播放' : undefined}
                  >
                    {isCurrent ? '▶' : i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJump(i)}
                    aria-label={`播放 ${t.title}`}
                    className="flex min-w-0 flex-1 flex-col items-start text-left hover:text-accent-foreground"
                  >
                    <span className="w-full truncate" title={t.title}>
                      {clampText(t.title, 40)}
                    </span>
                    <span
                      className="w-full truncate text-xs text-muted-foreground"
                      title={t.artist}
                    >
                      {clampText(t.artist, 30)}
                    </span>
                  </button>
                  {t.duration > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDuration(t.duration)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`把 ${t.title} 移出队列`}
                    title="移出队列"
                    onClick={() => onRemove(i)}
                    className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
