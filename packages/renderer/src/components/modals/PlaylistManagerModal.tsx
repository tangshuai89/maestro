/**
 * 歌单管理弹窗（specs/playlist-edit/）。
 *
 * ## 为什么单独一个弹窗
 *
 * NL 弹窗是「生成器」（说一句话 → 出队列），管理弹窗是「容器」（看/改/放/拿）。
 * 两个心智模型塞进同一个 Dialog 会互相干扰（用户在「我的歌单」区点歌单名
 * 的期望是「打开它看看」，不是「立刻播放」——所以这里**保留**了点名字=播放，
 * 另外加一个「管理」按钮）。
 *
 * ## 单一数据源
 *
 * 歌单的增删改由**持有 `usePlaylist()` 的组件**注入（`ops` prop）——
 * 不在本组件里再 `usePlaylist()` 一次。否则会多出一个独立 state 副本：
 * 这里改了歌单名，NL 弹窗里的列表还是旧名，直到手动刷新。
 *
 * ## 「已在歌单」判定
 *
 * 用 `@maestro/common` 的 `playlistTrackKey` —— 和 server 追加去重**同一个函数**。
 * 两端各写一份的话，用户点了「+」，服务端去重掉、长度不变，界面上也没提示，
 * 症状就是「点了没反应」。
 */
import * as React from 'react';
import { playlistTrackKey } from '@maestro/common';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { searchUnified, type Playlist, type UnifiedSearchItem } from '../../api';
import { clampText, formatDuration } from '../../lib/format';
import type { UsePlaylist } from '../../hooks/usePlaylist';
import { downloadPlaylistText } from '../../lib/playlistExport';

/** 服务端歌单名上限（`PlaylistService.MAX_NAME`）。 */
const MAX_NAME = 60;

export interface PlaylistManagerModalProps {
  open: boolean;
  onClose: () => void;
  /** 要管理的歌单；null = 不管理任何歌单（弹窗只显示空壳）。 */
  playlist: Playlist | null;
  /** 歌单操作句柄（由持有 usePlaylist 的组件注入）。 */
  ops: Pick<UsePlaylist, 'rename' | 'append' | 'remove'>;
  /** 播放整条歌单。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
}

export function PlaylistManagerModal({
  open,
  onClose,
  playlist,
  ops,
  onPlay,
}: PlaylistManagerModalProps) {
  // ── 改名态 ──────────────────────────────────────────────
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState('');
  const [savingName, setSavingName] = React.useState(false);
  /** 防重复提交：`Enter` 之后输入框卸载会再触发一次 blur → 两次 commitEdit。
   *  用 ref 而不是 state 兜住「同一次事件循环内」的第二次调用。 */
  const savingRef = React.useRef(false);

  // ── 添加歌曲面板 ────────────────────────────────────────
  const [adding, setAdding] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<UnifiedSearchItem[]>([]);
  const [searchError, setSearchError] = React.useState<string | null>(null);

  const [error, setError] = React.useState<string | null>(null);
  /** 正在处理中的曲目 key（加/移除时禁用该行的按钮）。 */
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  // 关掉就重置所有临时态（下次打开是干净的）。
  React.useEffect(() => {
    if (open) return;
    setEditing(false);
    setDraftName('');
    setAdding(false);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setError(null);
    setBusyKey(null);
  }, [open]);

  // 切到别的歌单 → 放弃当前的改名草稿。
  React.useEffect(() => {
    setEditing(false);
    setDraftName('');
  }, [playlist?.id]);

  // tracks 必须 memo：`playlist?.tracks ?? []` 每次渲染都是新数组，
  // 直接给下游 useMemo 当依赖会让它每次都重算。
  const tracks = React.useMemo(() => playlist?.tracks ?? [], [playlist?.tracks]);

  /** 已在歌单里的曲目 key 集合（与 server 追加去重同一个算法）。 */
  const existingKeys = React.useMemo(
    () => new Set(tracks.map((t) => playlistTrackKey(t))),
    [tracks],
  );

  // ── 改名 ────────────────────────────────────────────────
  const startEdit = () => {
    if (!playlist) return;
    setDraftName(playlist.name);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftName('');
  };

  const commitEdit = async () => {
    if (!playlist) return;
    if (savingRef.current) return;
    const name = draftName.trim();
    if (!name) {
      setError('歌单名不能为空');
      return;
    }
    if (name.length > MAX_NAME) {
      setError(`歌单名不能超过 ${MAX_NAME} 字`);
      return;
    }
    if (name === playlist.name) {
      // 没改就不发请求（避免无意义的 PATCH）
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSavingName(true);
    setError(null);
    try {
      await ops.rename(playlist.id, name);
      setEditing(false);
      setDraftName('');
    } catch (e) {
      setError((e as Error).message ?? '改名失败');
    } finally {
      savingRef.current = false;
      setSavingName(false);
    }
  };

  // ── 移除单首 ────────────────────────────────────────────
  const removeTrack = async (track: UnifiedSearchItem) => {
    if (!playlist) return;
    const key = playlistTrackKey(track);
    setBusyKey(key);
    setError(null);
    try {
      // 传**平台曲目身份**（platform:trackId）而不是 item.id：
      // 同一首歌的 QQ 版和 Spotify 版在歌单里是两条（id 相同），
      // 按 item.id 移除会一次干掉两条。
      await ops.remove(playlist.id, [key]);
    } catch (e) {
      setError((e as Error).message ?? '移除失败');
    } finally {
      setBusyKey(null);
    }
  };

  // ── 添加歌曲 ────────────────────────────────────────────
  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchUnified(q);
      setResults(res.items ?? []);
    } catch (e) {
      setSearchError((e as Error).message ?? '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const addTrack = async (item: UnifiedSearchItem) => {
    if (!playlist) return;
    const key = playlistTrackKey(item);
    if (existingKeys.has(key)) return;
    setBusyKey(key);
    setError(null);
    try {
      await ops.append(playlist.id, [item]);
    } catch (e) {
      setError((e as Error).message ?? '添加失败');
    } finally {
      setBusyKey(null);
    }
  };

  if (!playlist) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>歌单管理</DialogTitle>
            <DialogDescription>歌单不存在或已被删除</DialogDescription>
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
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        // ⚠️ 改名时按 ESC **只取消改名**，不关弹窗。
        // Radix 的 `useEscapeKeydown` 在 document 上用 **capture: true** 注册
        // → 捕获阶段先于目标元素触发 ⇒ 在输入框的 onKeyDown 里
        // `stopPropagation()` / `preventDefault()` **都太晚**，必须走这里。
        onEscapeKeyDown={(e) => {
          if (editing) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>歌单管理</DialogTitle>
          <DialogDescription>{tracks.length} 首 · 改名、加歌、移除单曲</DialogDescription>
        </DialogHeader>

        {/* ── 标题行（点 ✎ 改名） ── */}
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Input
                value={draftName}
                autoFocus
                maxLength={MAX_NAME}
                aria-label="歌单名"
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitEdit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                onBlur={() => void commitEdit()}
              />
              <Button size="sm" onClick={() => void commitEdit()} disabled={savingName}>
                {savingName ? '保存中…' : '保存'}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                取消
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 truncate text-base font-medium" data-testid="pm-name">
                {playlist.name}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="重命名歌单"
                title="重命名"
                onClick={startEdit}
              >
                ✎
              </Button>
            </>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </div>
        )}

        {/* ── 曲目列表 ── */}
        {tracks.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            这个歌单还没有歌曲 —— 点下面「+ 添加歌曲」放几首进来
          </div>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {tracks.map((t, i) => {
              const key = playlistTrackKey(t);
              return (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/20"
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={`${t.title} — ${t.artist}`}>
                    {clampText(t.title, 40)}
                    <span className="text-muted-foreground"> — {clampText(t.artist, 30)}</span>
                  </span>
                  {t.duration > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDuration(t.duration)}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`从歌单移除 ${t.title}`}
                    title="从歌单移除"
                    disabled={busyKey === key}
                    onClick={() => void removeTrack(t)}
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── 底部操作 ── */}
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" onClick={() => onPlay(tracks, 0)} disabled={tracks.length === 0}>
            ▶ 播放全部
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding((v) => !v);
                setSearchError(null);
              }}
            >
              {adding ? '收起' : '+ 添加歌曲'}
            </Button>
            {/* 导出（specs/playlist-export/）：把歌单导成 .txt 发给别人 */}
            <Button
              size="sm"
              variant="ghost"
              aria-label="导出歌单"
              title="导出歌单（.txt）"
              disabled={tracks.length === 0}
              onClick={() => downloadPlaylistText(playlist)}
            >
              导出
            </Button>
          </div>
        </div>

        {/* ── 添加歌曲（在本弹窗内展开，不跳走） ── */}
        {adding && (
          <div className="rounded-md border border-border p-3">
            <div className="flex gap-2">
              <Input
                value={query}
                placeholder="搜索歌名或歌手…"
                aria-label="搜索要添加的歌曲"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runSearch();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => void runSearch()}
                disabled={searching || !query.trim()}
              >
                {searching ? '搜索中…' : '搜索'}
              </Button>
            </div>

            {searchError && (
              <div
                role="alert"
                className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm"
              >
                {searchError}
              </div>
            )}

            {results.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {results.map((it) => {
                  const key = playlistTrackKey(it);
                  const inList = existingKeys.has(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/20"
                    >
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={`${it.title} — ${it.artist}`}
                      >
                        {clampText(it.title, 40)}
                        <span className="text-muted-foreground"> — {clampText(it.artist, 30)}</span>
                      </span>
                      {inList ? (
                        <span
                          className="shrink-0 text-xs text-muted-foreground"
                          data-testid="pm-in-list"
                        >
                          已在歌单
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`添加到歌单 ${it.title}`}
                          disabled={busyKey === key}
                          onClick={() => void addTrack(it)}
                        >
                          + 加
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
