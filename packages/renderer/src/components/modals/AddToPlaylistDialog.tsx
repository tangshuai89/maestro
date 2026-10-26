/**
 * 「加到歌单」选择器（specs/playlist-add-from-search/）。
 *
 * 从**统一搜索结果**一键把一首歌放进本地歌单 —— 这是攒歌单最自然的路径
 * （`specs/playlist-edit/` 的「不做」清单里把它留到了这一批）。
 *
 * ## 为什么「已在歌单」判定要用共享 key
 *
 * 服务端追加时按 `platform:trackId` 去重（`PlaylistService`）。如果这里按
 * `item.id` 判，客户端说「不在歌单」放行、服务端说「重复」跳过 ⇒
 * **点了没反应**。⇒ 复用 `@maestro/common` 的 `playlistTrackKey`
 * （与 `specs/playlist-edit/` 是**同一个函数**，不是各写一份）。
 *
 * ## 状态来源
 *
 * 自己 `usePlaylist()`（不接外部注入）：这个弹窗是**独立入口**，
 * 不依附于 NL 弹窗。它在**打开时**才挂载 → 拉歌单列表的请求也只在那时发。
 * 代价：NL 弹窗里那份列表不会同步更新（那边有「刷新」按钮）——
 * 比「两个组件共享一份 state」要简单，也不会引出「谁负责刷新」的耦合。
 */
import * as React from 'react';
import { playlistTrackKey } from '@maestro/common';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type { UnifiedSearchItem } from '../../api';
import { usePlaylist } from '../../hooks/usePlaylist';
import { clampText } from '../../lib/format';

/** 服务端歌单名上限（`PlaylistService.MAX_NAME`）。 */
const MAX_NAME = 60;

export interface AddToPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  /** 要加入歌单的那一首（null = 没有目标，弹窗只显示空壳）。 */
  track: UnifiedSearchItem | null;
}

export function AddToPlaylistDialog({ open, onClose, track }: AddToPlaylistDialogProps) {
  const pl = usePlaylist();

  // 新建歌单
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // 成功反馈（比"弹窗直接关掉"更明确：用户能看到进了哪个歌单）
  const [addedTo, setAddedTo] = React.useState<string | null>(null);

  const trackKey = React.useMemo(() => (track ? playlistTrackKey(track) : null), [track]);

  React.useEffect(() => {
    if (open) return;
    setCreating(false);
    setNewName('');
    setBusy(false);
    setAddedTo(null);
  }, [open]);

  // 换目标曲目 → 反馈清掉
  React.useEffect(() => {
    setAddedTo(null);
  }, [trackKey]);

  const contains = React.useCallback(
    (playlistTracks: UnifiedSearchItem[]) =>
      trackKey != null && playlistTracks.some((t) => playlistTrackKey(t) === trackKey),
    [trackKey],
  );

  const addTo = async (playlistId: string, playlistName: string) => {
    if (!track) return;
    setBusy(true);
    setAddedTo(null);
    try {
      await pl.append(playlistId, [track]);
      setAddedTo(playlistName);
    } catch {
      // pl.error 已记录（hook 内部设置），下面统一渲染
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    if (!track) return;
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setAddedTo(null);
    try {
      const p = await pl.create({
        name,
        tracks: [track],
        source: 'manual',
      });
      setNewName('');
      setCreating(false);
      setAddedTo(p.name);
    } catch {
      // pl.error 已记录
    } finally {
      setBusy(false);
    }
  };

  if (!track) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加到歌单</DialogTitle>
            <DialogDescription>没有选中的歌曲</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>加到歌单</DialogTitle>
          <DialogDescription>
            {clampText(track.title, 40)} — {clampText(track.artist, 30)}
          </DialogDescription>
        </DialogHeader>

        {addedTo && (
          <div role="status" className="rounded-md border border-border bg-accent/20 p-2 text-sm">
            已加入「{addedTo}」
          </div>
        )}

        {pl.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            {pl.error}
          </div>
        )}

        {pl.loading && pl.playlists.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">加载歌单…</div>
        ) : pl.playlists.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-center text-sm text-muted-foreground">
            还没有歌单 —— 下面新建一个
          </div>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {pl.playlists.map((p) => {
              const inList = contains(p.tracks);
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/20"
                >
                  <span className="min-w-0 flex-1 truncate" title={p.name}>
                    {p.name}
                    <span className="text-muted-foreground">（{p.tracks.length}）</span>
                  </span>
                  {inList ? (
                    <span className="shrink-0 text-xs text-muted-foreground">已在歌单</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`加入歌单 ${p.name}`}
                      disabled={busy}
                      onClick={() => void addTo(p.id, p.name)}
                    >
                      + 加入
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 新建歌单并加入 */}
        {creating ? (
          <div className="flex gap-2">
            <Input
              value={newName}
              autoFocus
              maxLength={MAX_NAME}
              placeholder="新歌单名（≤ 60 字）"
              aria-label="新歌单名"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void createAndAdd();
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => void createAndAdd()}
              disabled={busy || !newName.trim()}
            >
              {busy ? '创建中…' : '创建'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              取消
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              + 新建歌单并加入
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
