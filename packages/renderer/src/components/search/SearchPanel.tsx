import { useState, useEffect, useRef, useCallback } from 'react';
import { searchUnified, searchOne, fetchLyricsAvailability } from '../../api';
import type { MusicProvider, UnifiedSearchItem } from '../../api';
import { PROVIDER_LABELS } from '../../api';
import { formatDuration, clampText } from '../../lib/format';

/** 镜像 server search.util.ts:versionTypeBadge。single source of truth 应该在
 * common 包但当前 common 只放归一函数——加 type 字符串 UI 字段会让 common 越界。
 * 维护方式：server 端加新 VersionType 时同步更新这里。 */
type VersionType = 'studio' | 'live' | 'acoustic' | 'remix' | 'instrumental';
function versionTypeBadge(type: VersionType): string {
  switch (type) {
    case 'live':         return '[LIVE]';
    case 'acoustic':     return '[ACOUSTIC]';
    case 'remix':        return '[REMIX]';
    case 'instrumental': return '[INSTRUMENTAL]';
    case 'studio':       return '';
  }
}
import SourceChip from './SourceChip';

/**
 * AETHER Search — 搜索全屏（Figma 03/Screen/Search 还原）。
 *
 * 设计稿结构（1440×900，node 365:1008）：
 *  - backdrop（星云 + 地平线，复用 th-bg）
 *  - top-hud（brand + source-toggle：chip-all + 4 Badge/Platform）
 *  - search-bar（960×56 @ y=112，Icon/Search + placeholder + × 关闭）
 *  - result-count（Tag/Stat @ y=196）
 *  - result-list（960×620 @ y=226，每行 960×72：
 *    cover 40×40 + title + meta + 平台 chip + play-icon）
 *
 * 搜索逻辑（debounce/分页/歌词探测/abort）完整保留，只换 UI 外壳。
 */

interface Props {
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  onClose: () => void;
}

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;
const LYRICS_PROBE_CONCURRENCY = 3;
const EMPTY_TIMEOUT_MS = 3000;

type SourceMode = 'all' | MusicProvider;

const PLATFORM_BADGE: Record<MusicProvider, { letter: string; color: string }> = {
  qq: { letter: 'Q', color: '#FFD93D' },
  netease: { letter: 'N', color: '#FF3B5C' },
  deezer: { letter: 'D', color: '#3D9BFF' },
  spotify: { letter: 'S', color: '#3DFFA2' },
};

export default function SearchPanel({ onPlay, onClose }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<UnifiedSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyTimedOut, setEmptyTimedOut] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lyricsAvail, setLyricsAvail] = useState<Record<string, boolean>>({});
  const [sourceMode, setSourceMode] = useState<SourceMode>('all');
  // Phase 2 修订：每个 item 独立展开/折叠版本，交互对齐 LikedLibraryModal 的
  // chevron（▸/▾）。点击 chevron 只展开版本，不触发播放；点击行体才播放。
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 1440×900 画布等比缩放（同 TheaterView）
  const [canvasScale, setCanvasScale] = useState(1);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = Math.min(w / 1440, Math.max(0.3, (h - 40) / 900));
      setCanvasScale(scale);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const runSearch = useCallback(
    async (keyword: string, nextPage: number, append: boolean, mode: SourceMode) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setItems([]);
        setPage(1);
        setHasMore(false);
        setError(null);
        setEmptyTimedOut(false);
        setSearched(true);
      }

      if (!append) {
        if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
        emptyTimerRef.current = setTimeout(() => {
          setEmptyTimedOut(true);
        }, EMPTY_TIMEOUT_MS);
      }

      try {
        let resultCount = 0;
        if (mode === 'all') {
          const res = await searchUnified(
            keyword, nextPage, PAGE_SIZE, controller.signal,
          );
          if (controller.signal.aborted) return;
          setItems((prev) => {
            if (!append) return res.items;
            const seen = new Set(prev.map((it) => it.id));
            const fresh = res.items.filter((it) => !seen.has(it.id));
            return [...prev, ...fresh];
          });
          setPage(res.page);
          setHasMore(res.page * res.pageSize < res.total);
          resultCount = res.items.length;
        } else {
          if (append) { setLoadingMore(false); return; }
          const fetched = await searchOne(mode, keyword, controller.signal);
          if (controller.signal.aborted) return;
          setItems(fetched);
          setHasMore(false);
          resultCount = fetched.length;
        }
        if (!append) {
          if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
          if (resultCount === 0) setEmptyTimedOut(true);
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (!append) { setError((e as Error).message); setItems([]); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); setLoadingMore(false); }
      }
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const kw = q.trim();
    if (!kw) {
      abortRef.current?.abort();
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
      setItems([]); setPage(1); setHasMore(false);
      setLoading(false); setLoadingMore(false);
      setError(null); setEmptyTimedOut(false); setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(kw, 1, false, sourceMode);
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, sourceMode, runSearch]);

  const handleSourceChange = useCallback(
    (mode: SourceMode) => {
      if (mode === sourceMode) return;
      setSourceMode(mode);
      const kw = q.trim();
      if (!kw) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void runSearch(kw, 1, false, mode);
    },
    [q, sourceMode, runSearch],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const pending = items.filter((it) => !(it.id in lyricsAvail));
    if (pending.length === 0) return;
    const controller = new AbortController();
    let idx = 0;
    const worker = async () => {
      while (idx < pending.length && !controller.signal.aborted) {
        const item = pending[idx++];
        try {
          const available = await fetchLyricsAvailability(
            item.sources.map((s) => ({ platform: s.platform, trackId: s.trackId })),
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setLyricsAvail((prev) => ({ ...prev, [item.id]: available }));
          }
        } catch { /* 探测失败不写入 */ }
      }
    };
    for (let i = 0; i < LYRICS_PROBE_CONCURRENCY; i++) void worker();
    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Phase 2: 接受 versionIdx 让 sub-row 播放指定 version。构造 view items
   * （把 items[index] 的 sources/bestSource/duration 临时换成所选 version），
   * 不改 onPlay 签名（保持向后兼容）。
   */
  const handleRowClick = (index: number, versionIdx: number = 0) => {
    const item = items[index];
    if (!item) return;
    const v = item.versions[versionIdx];
    if (!v || !v.bestSource) return;
    const view = items.map((it, idx) => {
      if (idx !== index) return it;
      return { ...it, sources: v.sources, bestSource: v.bestSource, duration: v.duration };
    });
    onPlay(view, index);
  };

  const handleLoadMore = () => {
    const kw = q.trim();
    if (!kw || loading || loadingMore || !hasMore) return;
    void runSearch(kw, page + 1, true, sourceMode);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) handleLoadMore();
  };

  return (
    <div className="sp-root">
      {/* ── 背景层（铺满窗口，不随画布缩放） ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="sp-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* top-hud（y=24，brand + source-toggle） */}
        <header className="sp-hud">
          <div className="sp-hud-brand">
            <span className="sp-hud-title">AETHER ENGINE v3.0</span>
            <span className="sp-hud-kicker">SYSTEM PROTOCOL</span>
          </div>
          <div className="sp-hud-toggle" role="tablist" aria-label="搜索 source">
            <button
              role="tab"
              aria-selected={sourceMode === 'all'}
              className={`sp-chip-all${sourceMode === 'all' ? ' is-active' : ''}`}
              onClick={() => handleSourceChange('all')}
            >
              ALL
            </button>
            {(['qq', 'netease', 'deezer', 'spotify'] as MusicProvider[]).map((p) => {
              const m = PLATFORM_BADGE[p];
              const active = sourceMode === p;
              return (
                <button
                  key={p}
                  role="tab"
                  aria-selected={active}
                  className={`sp-badge${active ? ' is-active' : ''}`}
                  style={{ ['--badge' as string]: m.color }}
                  onClick={() => handleSourceChange(p)}
                  title={PROVIDER_LABELS[p]}
                >
                  {m.letter}
                </button>
              );
            })}
          </div>
        </header>

        {/* search-bar（960×56 @ y=112） */}
        <div className="sp-search-bar">
          <svg className="sp-search-icon" viewBox="0 0 24 24" width="20" height="20"
            fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            className="sp-search-input"
            placeholder="搜索歌手 / 歌名（跨平台）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span className="sp-spinner" aria-hidden="true" />}
          <button
            className="sp-close"
            onClick={(e) => {
              // Bug #6 防御性：stopPropagation 防止冒泡。
              e.stopPropagation();
              onClose();
            }}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </div>

        {/* result-count（y=196） */}
        {searched && items.length > 0 && (
          <div className="sp-result-count">
            RESULTS // {items.length} MATCHES
          </div>
        )}

        {/* result-list（960×620 @ y=226） */}
        <div className="sp-results" ref={scrollerRef} onScroll={handleScroll}>
          {!searched && !loading && (
            <div className="sp-empty">输入歌名 / 歌手，回车搜</div>
          )}
          {searched && !loading && items.length === 0 && (
            <div className="sp-empty">暂无结果</div>
          )}
          {loading && emptyTimedOut && items.length === 0 && (
            <div className="sp-empty">暂无结果</div>
          )}
          {error && <div className="sp-error">{error}</div>}
          {items.map((it, i) => {
            const hasVersions = it.versions.length > 1;
            const isExpanded = expandedIds.has(it.id);
            const mainPlayable = it.bestSource !== null;
            const rowTitle = mainPlayable
              ? `播放：${it.title} - ${it.artist}`
              : '所有平台都无版权';
            return (
              <div key={it.id} className={`sp-item${isExpanded ? ' is-open' : ''}`}>
                <div
                  className={`sp-row${mainPlayable ? '' : ' sp-row--disabled'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowClick(i, 0)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(i, 0);
                    }
                  }}
                  title={rowTitle}
                >
                  {it.coverUrl ? (
                    <img className="sp-cover" src={it.coverUrl} alt="" />
                  ) : (
                    <div className="sp-cover sp-cover-ph">
                      <span className="sp-cover-note" aria-hidden="true">♪</span>
                    </div>
                  )}
                  <div className="sp-row-meta">
                    <div className="sp-row-title">
                      {clampText(it.title, 40)}
                      {it.versionType && it.versionType !== 'studio' && (
                        <span
                          className={`sp-ver-badge sp-ver-badge--${it.versionType}`}
                          title={`${it.versionType} 版本`}
                        >
                          {versionTypeBadge(it.versionType)}
                        </span>
                      )}
                    </div>
                    <div className="sp-row-sub">
                      {clampText(it.artist, 30)}
                      {it.album ? ` · ${clampText(it.album, 20)}` : ''}
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
                  {lyricsAvail[it.id] && (
                    <span className="sp-lyrics-badge" title="有歌词" aria-label="有歌词">词</span>
                  )}
                  {hasVersions && (
                    <button
                      type="button"
                      className="sp-ver-toggle"
                      aria-label={isExpanded ? '收起版本' : '展开版本'}
                      aria-expanded={isExpanded}
                      title={`${it.versions.length} 个录音版本`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(it.id);
                      }}
                    >
                      <span className="sp-ver-count">{it.versions.length}</span>
                      <span className="sp-ver-chevron">{isExpanded ? '▾' : '▸'}</span>
                    </button>
                  )}
                  {mainPlayable ? (
                    <svg className="sp-play-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <span className="sp-no-rights">无版权</span>
                  )}
                </div>
                {isExpanded &&
                  it.versions.slice(1).map((v, vi) => {
                    const versionIdx = vi + 1;
                    const playable = v.bestSource !== null;
                    return (
                      <div
                        key={`${it.id}-v${versionIdx}`}
                        className={`sp-row sp-row--sub${playable ? '' : ' sp-row--disabled'}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleRowClick(i, versionIdx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRowClick(i, versionIdx);
                          }
                        }}
                        title={playable ? `播放：${it.title} - ${it.artist}` : '所有平台都无版权'}
                      >
                        <span className="sp-sub-row-dot" aria-hidden="true" />
                        <div className="sp-row-meta">
                          <div className="sp-row-title">
                            <span className="sp-ver-num">v{versionIdx + 1}</span>
                          </div>
                          <div className="sp-row-sub">{formatDuration(v.duration)}</div>
                        </div>
                        <div className="sp-row-sources">
                          {v.sources.map((s, si) => (
                            <SourceChip
                              key={`${s.platform}-${s.trackId}-${si}`}
                              source={s}
                              isBest={s.platform === v.bestSource}
                            />
                          ))}
                        </div>
                        {playable ? (
                          <svg className="sp-play-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        ) : (
                          <span className="sp-no-rights">无版权</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {loadingMore && <div className="sp-loading-more">加载更多…</div>}
        </div>
      </div>
    </div>
  );
}
