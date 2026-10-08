/**
 * AlbumResults — 专辑搜索结果区（spec: specs/album-search，tasks 4.3-4.7）。
 *
 * 刻意做成**独立组件**而不是把逻辑塞进 SearchPanel：
 *   - SearchPanel 已经 584 行 + 493 行测试，再塞一套 debounce/abort/分页会失控
 *   - 专辑行与曲目行是两套渲染管线（封面尺寸、角标语义、展开模型都不同）
 *   - 关键词 `q` 由 SearchPanel 持有并传入，切 tab 因此天然不丢输入
 *
 * 复用 SearchPanel 的 `sp-*` 类名 → 视觉外壳自动一致，本文件几乎不需要新样式。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  searchAlbums,
  fetchAlbumTracks,
  PROVIDER_LABELS,
  isPlayableEntry,
  unplayableText,
} from '../../api';
import type { MusicProvider, UnifiedAlbum, UnifiedSearchItem } from '../../api';
import { formatDuration, clampText } from '../../lib/format';
import SourceChip from './SourceChip';

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;
const EMPTY_TIMEOUT_MS = 3000;

interface Props {
  /** 由 SearchPanel 持有 —— 切 tab 时不丢输入的关键。 */
  q: string;
  /** 点专辑行 → 展开曲目；点曲目行 → 播放。复用 SearchPanel 的 onPlay 契约。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  wpsReady?: boolean;
  /**
   * 滚动到底的信号。scroller 在 SearchPanel 里（两个 tab 共用），所以这里用
   * ref 把自己内部的 loadMore 注册出去，而不是让父组件托管 page/hasMore ——
   * 那样会把歌曲 tab 的分页状态和专辑 tab 的搅在一起。
   */
  loadMoreRef: React.MutableRefObject<(() => void) | null>;
}

interface TrackListState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  items: UnifiedSearchItem[];
  error?: string;
}

export default function AlbumResults({ q, onPlay, wpsReady = false, loadMoreRef }: Props) {
  const [albums, setAlbums] = useState<UnifiedAlbum[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyTimedOut, setEmptyTimedOut] = useState(false);
  const [searched, setSearched] = useState(false);
  const [platformErrors, setPlatformErrors] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trackLists, setTrackLists] = useState<Record<string, TrackListState>>({});

  const abortRef = useRef<AbortController | null>(null);
  const trackAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 展开某张专辑 → 拉曲目（首次点才拉，之后走缓存）。 */
  const openAlbum = useCallback(
    async (album: UnifiedAlbum) => {
      if (expandedId === album.id) {
        // 再点一次 = 收起
        trackAbortRef.current?.abort();
        setExpandedId(null);
        return;
      }
      setExpandedId(album.id);
      const cached = trackLists[album.id];
      if (cached && cached.status === 'ok') return;

      trackAbortRef.current?.abort();
      const controller = new AbortController();
      trackAbortRef.current = controller;
      setTrackLists((prev) => ({
        ...prev,
        [album.id]: { status: 'loading', items: [] },
      }));
      try {
        // 一张专辑只属于一个平台 —— 用代表 source 的平台即可。
        const platform = album.sources[0].platform;
        const albumId = album.sources[0].albumId;
        const items = await fetchAlbumTracks(platform, albumId, controller.signal);
        if (controller.signal.aborted) return;
        setTrackLists((prev) => ({
          ...prev,
          [album.id]: { status: 'ok', items },
        }));
      } catch (e) {
        if (controller.signal.aborted) return;
        setTrackLists((prev) => ({
          ...prev,
          [album.id]: {
            status: 'error',
            items: [],
            error: (e as Error).message,
          },
        }));
      }
    },
    [expandedId, trackLists],
  );

  const runSearch = useCallback(async (keyword: string, nextPage: number, append: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) {
      // loadingMore 由父组件驱动
    } else {
      setLoading(true);
      setAlbums([]);
      setPage(1);
      setError(null);
      setEmptyTimedOut(false);
      setSearched(true);
      setPlatformErrors([]);
      // 换关键词时收起展开态 + 清曲目缓存（否则会显示上一关键词的曲目）
      setExpandedId(null);
      setTrackLists({});
      trackAbortRef.current?.abort();
    }

    if (!append) {
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = setTimeout(() => setEmptyTimedOut(true), EMPTY_TIMEOUT_MS);
    }

    try {
      const res = await searchAlbums(keyword, nextPage, PAGE_SIZE, controller.signal);
      if (controller.signal.aborted) return;
      setAlbums((prev) => {
        if (!append) return res.items;
        // 按 id 去重：翻页时同一张专辑可能因为合并结果变化而重复出现
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...res.items.filter((a) => !seen.has(a.id))];
      });
      setPage(res.page);
      setHasMore(res.page * res.pageSize < res.total);
      // 部分平台失败 → 非阻塞提示条（不算"暂无结果"）
      setPlatformErrors(
        Object.entries(res.errors ?? {}).map(
          ([p, msg]) => `${PROVIDER_LABELS[p as MusicProvider]}：${msg}`,
        ),
      );
      if (!append) {
        if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
        if (res.items.length === 0) setEmptyTimedOut(true);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (!append) {
        setError((e as Error).message);
        setAlbums([]);
      }
    } finally {
      // ⚠️ 不能在 finally 里 `return` —— 那会吞掉 try 块抛出的异常
      // （eslint no-unsafe-finally）。用条件块表达同一个意图。
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // debounce：切到专辑 tab 时 q 不变也会重新跑一次（依赖里带 tab 之外的
  // 触发源 = q 本身，SearchPanel 用 key 重挂载本组件来强制刷新）
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const kw = q.trim();
    if (!kw) {
      abortRef.current?.abort();
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
      setAlbums([]);
      setPage(1);
      setHasMore(false);
      setLoadingMore(false);
      setLoading(false);
      setError(null);
      setEmptyTimedOut(false);
      setSearched(false);
      setPlatformErrors([]);
      setExpandedId(null);
      setTrackLists({});
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(kw, 1, false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, runSearch]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      trackAbortRef.current?.abort();
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
    };
  }, []);

  const loadMore = useCallback(() => {
    const kw = q.trim();
    if (!kw || loading || loadingMore || !hasMore) return;
    void runSearch(kw, page + 1, true);
  }, [q, loading, loadingMore, hasMore, page, runSearch]);

  // 把 loadMore 注册给父组件的滚动处理
  useEffect(() => {
    loadMoreRef.current = loadMore;
    return () => {
      if (loadMoreRef.current === loadMore) loadMoreRef.current = null;
    };
  }, [loadMore, loadMoreRef]);

  /** 曲目行点击 → 播放（与 SearchPanel.handleRowClick 同契约）。 */
  const handleTrackClick = (album: UnifiedAlbum, index: number) => {
    const list = trackLists[album.id];
    if (!list || list.status !== 'ok') return;
    const item = list.items[index];
    if (!item) return;
    const playable = isPlayableEntry(item, wpsReady);
    if (!playable) return;
    onPlay(list.items, index);
  };

  /** 「播放全部」→ 整张专辑入队，从第 1 首开始（不新增队列机制）。 */
  const playAll = (album: UnifiedAlbum) => {
    const list = trackLists[album.id];
    if (!list || list.status !== 'ok' || list.items.length === 0) return;
    // 只收可播的曲目，否则播放会静默失败（见 api.isPlayableEntry 注释）
    const playable = list.items.filter((it) => isPlayableEntry(it, wpsReady));
    if (playable.length === 0) return;
    onPlay(playable, 0);
  };

  return (
    <>
      {/* 结果计数 */}
      {searched && albums.length > 0 && (
        <div className="sp-result-count">ALBUMS // {albums.length} MATCHES</div>
      )}

      <div className="sp-results sp-results--albums">
        {!searched && !loading && <div className="sp-empty">输入专辑名，回车搜</div>}
        {searched && !loading && albums.length === 0 && !error && (
          <div className="sp-empty">暂无结果</div>
        )}
        {loading && emptyTimedOut && albums.length === 0 && (
          <div className="sp-empty">暂无结果</div>
        )}
        {error && <div className="sp-error">{error}</div>}

        {/* 部分平台失败 → 非阻塞提示条。用户仍能看已返回的结果。 */}
        {platformErrors.length > 0 && (
          <div className="sp-album-warn" role="status">
            部分平台不可用：{platformErrors.join('；')}
          </div>
        )}

        {albums.map((album) => {
          const list = trackLists[album.id];
          const isOpen = expandedId === album.id;
          const isLoadingTracks = list?.status === 'loading';
          const trackError = list?.status === 'error' ? list.error : undefined;
          const playableCount =
            list?.status === 'ok'
              ? list.items.filter((it) => isPlayableEntry(it, wpsReady)).length
              : 0;
          return (
            <div key={album.id} className={`sp-item${isOpen ? ' is-open' : ''}`}>
              <div
                className="sp-row sp-row--album"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => void openAlbum(album)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void openAlbum(album);
                  }
                }}
                title={isOpen ? '收起曲目' : '展开曲目'}
              >
                <span className="sp-cover-wrap">
                  {album.coverUrl ? (
                    <img className="sp-cover" src={album.coverUrl} alt="" />
                  ) : (
                    <span className="sp-cover sp-cover-ph">
                      <span className="sp-cover-note" aria-hidden="true">
                        ♪
                      </span>
                    </span>
                  )}
                </span>
                <div className="sp-row-meta">
                  <div className="sp-row-title">
                    {clampText(album.title, 40)}
                    {album.variantMismatch && (
                      <span
                        className="sp-album-variant"
                        title="各平台曲目数不一致，未跨平台合并 —— 这可能是再版/豪华版/翻唱"
                      >
                        版本分歧
                      </span>
                    )}
                  </div>
                  <div className="sp-row-sub">
                    {clampText(album.artist, 30)}
                    {album.trackCount > 0 ? ` · ${album.trackCount} 首` : ''}
                    {album.year > 0 ? ` · ${album.year}` : ''}
                  </div>
                </div>
                <div className="sp-row-sources">
                  {album.sources.map((s, i) => (
                    <span
                      key={`${s.platform}-${s.albumId}-${i}`}
                      className="sp-album-chip"
                      title={PROVIDER_LABELS[s.platform]}
                    >
                      {s.platform === 'netease'
                        ? 'N'
                        : s.platform === 'deezer'
                          ? 'D'
                          : s.platform === 'spotify'
                            ? 'S'
                            : 'Q'}
                    </span>
                  ))}
                </div>
                <span className="sp-album-caret" aria-hidden="true">
                  {isOpen ? '▴' : '▾'}
                </span>
              </div>

              {isOpen && (
                <div className="sp-album-tracks">
                  {isLoadingTracks && <div className="sp-album-hint">曲目加载中…</div>}
                  {trackError && (
                    <div className="sp-album-hint sp-album-hint--err">
                      曲目加载失败：{trackError}
                    </div>
                  )}
                  {list?.status === 'ok' && list.items.length === 0 && (
                    <div className="sp-album-hint">这张专辑没有可显示的曲目</div>
                  )}
                  {list?.status === 'ok' && list.items.length > 0 && (
                    <>
                      <div className="sp-album-actions">
                        <button
                          type="button"
                          className="sp-album-playall"
                          onClick={(e) => {
                            e.stopPropagation();
                            playAll(album);
                          }}
                          disabled={playableCount === 0}
                        >
                          ▶ 播放全部{playableCount > 0 ? `（${playableCount}）` : ''}
                        </button>
                        {playableCount < list.items.length && (
                          <span className="sp-album-hint">
                            {list.items.length - playableCount} 首当前不可播
                          </span>
                        )}
                      </div>
                      {list.items.map((it, i) => {
                        const playable = isPlayableEntry(it, wpsReady);
                        return (
                          <div
                            key={`${album.id}-t${i}`}
                            className={`sp-row sp-row--sub${playable ? '' : ' sp-row--disabled'}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleTrackClick(album, i)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleTrackClick(album, i);
                              }
                            }}
                            title={
                              playable
                                ? `播放：${it.title} - ${it.artist}`
                                : (unplayableText(it, wpsReady) ?? '当前没有可播的音源')
                            }
                          >
                            <span className="sp-sub-row-dot" aria-hidden="true" />
                            <div className="sp-row-meta">
                              <div className="sp-row-title">{clampText(it.title, 40)}</div>
                              <div className="sp-row-sub">
                                {clampText(it.artist, 30)}
                                {it.duration > 0 ? ` · ${formatDuration(it.duration)}` : ''}
                              </div>
                            </div>
                            <div className="sp-row-sources">
                              {it.sources.map((s, si) => (
                                <SourceChip
                                  key={`${s.platform}-${s.trackId}-${si}`}
                                  source={s}
                                  isBest={s.platform === it.bestSource}
                                />
                              ))}
                            </div>
                            {!playable && <span className="sp-no-rights">无音源</span>}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {albums.length > 0 && hasMore && (
          <button type="button" className="sp-load-more" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? '加载中…' : '加载更多专辑'}
          </button>
        )}
      </div>
    </>
  );
}
