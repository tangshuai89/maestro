import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  fetchRecoStatus,
  importLibrary,
  runReco,
  saveRecoKey,
  PROVIDER_LABELS,
} from '../api';
import type { UnifiedSearchItem } from '../api';

interface RecoStatus {
  configured: boolean;
  librarySize: number;
}

/**
 * DeepSeek recommendation flow: status (key configured + library size), the
 * "run reco" action (auto-imports the user's likes into the library first if
 * empty), and saving the API key. Results are fed into the same playback
 * queue as search via the `playSearch` callback.
 */
export function useReco(
  playSearch: (
    items: UnifiedSearchItem[],
    index: number,
    loadMore?: () => Promise<UnifiedSearchItem[]>,
  ) => void,
  setError: Dispatch<SetStateAction<string | null>>,
  /** Reactive 镜像 of queueRef.idx —— 由 usePlayer 同步写入。默认 -1
   *  表示不在任何队列里（图鉴空态）。 */
  queueIdx: number,
  /** 当前队列里的 unified items（reactively mirrors queueRef.unifiedItems）。
   *  undefined = 没有队列。 */
  queueUnifiedItems: UnifiedSearchItem[] | undefined,
) {
  const [recoStatus, setRecoStatus] = useState<RecoStatus | null>(null);
  const [recoStatusVersion, setRecoStatusVersion] = useState(0);
  const [recoRunning, setRecoRunning] = useState(false);
  // Monster Beats 图鉴（ENCOUNTER LOG）用的推荐卡数据 ——
  // 派生自队列位置（queueIdx + queueUnifiedItems，由 usePlayer 提供），
  // 不再在 runRecoFlow 里手动同步「batch 1 的前 3 首」。idx 走到第 4 首时
  // 图鉴跟着翻页；loadMore 把第 11/12... 首加进队列后 idx=10 自动切到 batch 2。
  // 没有队列时（idx=-1）保持空数组 —— TheaterView 的空态文案接管显示。
  const suggestions = useMemo(
    () => deriveSuggestions(queueUnifiedItems, queueIdx),
    [queueUnifiedItems, queueIdx],
  );
  const [recoKeyOpen, setRecoKeyOpen] = useState(false);

  // Fetch reco status on mount + after every key save (version bump).
  useEffect(() => {
    fetchRecoStatus()
      .then(setRecoStatus)
      .catch(() => setRecoStatus({ configured: false, librarySize: 0 }));
  }, [recoStatusVersion]);

  /**
   * 跑一次推荐。`seed` 非空时以某首歌为种子（"放点像这首的"）——候选项会围绕
   * 它的艺人展开，服务端还会把这次点击记成一条强正信号（seed）。
   */
  const runRecoFlow = useCallback(async (seed?: { title: string; artist: string }) => {
    setError(null);
    // Re-fetch status (guard against stale).
    let status = recoStatus;
    try {
      status = await fetchRecoStatus();
      setRecoStatus(status);
    } catch (e) {
      setError(`推荐状态查询失败：${(e as Error).message}`);
      return;
    }
    if (!status.configured) {
      setRecoKeyOpen(true);
      return;
    }
    setRecoRunning(true);
    try {
      // Empty library → auto-import each platform's "my likes" (currently
      // NetEase / Spotify, both requiring login).
      if (status.librarySize === 0) {
        const lib = await importLibrary();
        const imported = lib.sources.reduce((n, s) => n + s.count, 0);
        if (imported === 0) {
          const hints = lib.sources
            .filter((s) => s.error)
            .map((s) => `${PROVIDER_LABELS[s.provider]}: ${s.error}`)
            .join('；');
          setError(
            `没有可导入的"我的喜欢"，先登录网易云或 Spotify 再试${
              hints ? `（${hints}）` : ''
            }`,
          );
          return;
        }
        status = { ...status, librarySize: lib.items.length };
        setRecoStatus(status);
      }
      const result = await runReco({ count: 10, ...(seed ? { seed } : {}) });
      if (result.items.length === 0) {
        setError('推荐没拿到结果，换个心情/语言试试？');
        return;
      }
      // Track everything recommended this session so the auto-continue batches
      // don't replay songs (the server dedups against the library but not
      // across reco runs). Seeded with this first batch.
      const recommended: Array<{ title: string; artist: string }> =
        result.items.map((it) => ({ title: it.title, artist: it.artist }));
      const loadMore = async (): Promise<UnifiedSearchItem[]> => {
        const next = await runReco({
          count: 10,
          // Cap the exclude list so the prompt/request stays bounded on long
          // listening sessions; the most recent picks matter most.
          exclude: recommended.slice(-100),
          // 种子模式续播时继续带着种子，保持"更多这种"的方向。
          ...(seed ? { seed } : {}),
        });
        for (const it of next.items) {
          recommended.push({ title: it.title, artist: it.artist });
        }
        return next.items;
      };
      // Reuse the same playback link as the search queue, plus the next-batch
      // loader so playback continues past the last recommendation.
      // (suggestions 现在从 queueIdx + queueUnifiedItems useMemo 派生 —
      // 见 runRecoFlow 外面的 suggestions —— 不再需要在跑 batch 时手动同步。)
      playSearch(result.items, 0, loadMore);
    } catch (e) {
      setError(`推荐失败：${(e as Error).message}`);
    } finally {
      setRecoRunning(false);
    }
  }, [recoStatus, playSearch, setError]);

  const handleReco = useCallback(() => runRecoFlow(), [runRecoFlow]);

  const handleRecoSeed = useCallback(
    (title?: string, artist?: string) => {
      if (!title || !artist) return;
      void runRecoFlow({ title, artist });
    },
    [runRecoFlow],
  );

  const handleSaveRecoKey = useCallback(
    async (key: string) => {
      if (!key || key.length < 8) {
        setError('key 太短');
        return;
      }
      try {
        const r = await saveRecoKey(key);
        setRecoKeyOpen(false);
        setRecoStatusVersion((v) => v + 1);
        setError(null);
        // Don't surface the tail in the UI; the user can infer from status.
        void r;
      } catch (e) {
        setError(`保存 key 失败：${(e as Error).message}`);
      }
    },
    [setError],
  );

  return {
    recoStatus,
    recoRunning,
    suggestions,
    recoKeyOpen,
    setRecoKeyOpen,
    handleReco,
    handleRecoSeed,
    handleSaveRecoKey,
  };
}

/** Map unified item → TheaterView suggestion card 的展示形状。idx 0/1/2 决定
 *  coverColor（5 色循环）和 match %（hash from title/artist）。纯函数，
 *  TheaterView 也直接复用——见 specs/reco-deepseek 2026-09-21「推荐卡跟随
 * 队列位置」段落。 */
function toSuggestion(
  item: UnifiedSearchItem,
  i: number,
): { title: string; artist: string; coverColor: string; type: string; match: number } {
  const h = (item.title.length * 31 + item.artist.length * 7 + i * 13) % 100;
  const prov = item.bestSource ?? 'qq';
  const typeMap: Record<string, string> = {
    qq: 'FIRE',
    netease: 'GRASS',
    deezer: 'WATER',
    spotify: 'ELEC',
  };
  return {
    title: item.title,
    artist: item.artist,
    coverColor: ['#FF3B3B', '#FFD60A', '#4CD964', '#2D7FFF', '#FF2D87'][i % 5],
    type: typeMap[prov] ?? 'WILD',
    match: Math.max(35, h),
  };
}

/** 从队列位置派生「正在播 + 接下来 2」三张图鉴卡。queueIdx < 0（无队列）或
 *  unifiedItems 缺失 → 返回空数组（让 TheaterView 走空态文案）。 */
function deriveSuggestions(
  items: UnifiedSearchItem[] | undefined,
  idx: number,
): Array<{ title: string; artist: string; coverColor: string; type: string; match: number }> {
  if (!items || idx < 0) return [];
  return items.slice(idx, idx + 3).map(toSuggestion);
}
