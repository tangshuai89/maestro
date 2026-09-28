/**
 * 本地歌单 hook（specs/nl-playlist/ §Task B4）。
 *
 * 职责：拉 / 存 / 删 / 改 歌单 + 本地 optimistic 更新 + 错误态。
 * 状态来源：server `/api/library/playlists`（PlaylistService，见
 * `packages/server/src/library/playlist.service.ts`）。
 *
 * 不做：歌单内曲目排序 / 拖拽（spec §不做什么 v2）；跨设备同步。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  patchPlaylist,
  type Playlist,
  type UnifiedSearchItem,
} from '../api';

export interface UsePlaylist {
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  /** 首次拉取（幂等：已在 loading/已拉过则跳过） */
  refresh: () => Promise<void>;
  create: (body: {
    name: string;
    tracks: UnifiedSearchItem[];
    prompt?: string;
    source?: 'nl' | 'manual';
  }) => Promise<Playlist>;
  rename: (id: string, name: string) => Promise<void>;
  append: (id: string, tracks: UnifiedSearchItem[]) => Promise<void>;
  remove: (id: string, trackIds: string[]) => Promise<void>;
  remove_playlist: (id: string) => Promise<void>;
  clearError: () => void;
}

export function usePlaylist(): UsePlaylist {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPlaylists();
      setPlaylists(list);
      loadedRef.current = true;
    } catch (e) {
      setError((e as Error).message ?? '拉歌单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 首挂拉一次（弹窗打开时已经 mount 好了；这里做兜底预热）
  useEffect(() => {
    if (loadedRef.current) return;
    void refresh();
  }, [refresh]);

  const create = useCallback<UsePlaylist['create']>(async (body) => {
    setError(null);
    try {
      const p = await createPlaylist(body);
      // optimistic：新歌单插到最前（服务端按 updatedAt 倒序）
      setPlaylists((prev) => [p, ...prev]);
      return p;
    } catch (e) {
      setError((e as Error).message ?? '存歌单失败');
      throw e;
    }
  }, []);

  const rename = useCallback<UsePlaylist['rename']>(async (id, name) => {
    setError(null);
    try {
      const updated = await patchPlaylist(id, { name });
      setPlaylists((prev) =>
        prev.map((p) => (p.id === id ? updated : p)),
      );
    } catch (e) {
      setError((e as Error).message ?? '改歌单名失败');
      throw e;
    }
  }, []);

  const append = useCallback<UsePlaylist['append']>(async (id, tracks) => {
    setError(null);
    try {
      const updated = await patchPlaylist(id, { append: tracks });
      setPlaylists((prev) =>
        prev.map((p) => (p.id === id ? updated : p)),
      );
    } catch (e) {
      setError((e as Error).message ?? '追加曲目失败');
      throw e;
    }
  }, []);

  const remove = useCallback<UsePlaylist['remove']>(async (id, trackIds) => {
    setError(null);
    try {
      const updated = await patchPlaylist(id, { remove: trackIds });
      setPlaylists((prev) =>
        prev.map((p) => (p.id === id ? updated : p)),
      );
    } catch (e) {
      setError((e as Error).message ?? '删除曲目失败');
      throw e;
    }
  }, []);

  const remove_playlist = useCallback<UsePlaylist['remove_playlist']>(
    async (id) => {
      setError(null);
      try {
        await deletePlaylist(id);
        setPlaylists((prev) => prev.filter((p) => p.id !== id));
      } catch (e) {
        setError((e as Error).message ?? '删除歌单失败');
        throw e;
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    playlists,
    loading,
    error,
    refresh,
    create,
    rename,
    append,
    remove,
    remove_playlist,
    clearError,
  };
}
