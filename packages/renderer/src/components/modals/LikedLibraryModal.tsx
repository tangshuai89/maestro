import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getLibrary, importLibrary } from '../../api';
import type { LibraryImportResult, UnifiedSearchItem, MusicProvider } from '../../api';
import { formatDuration, clampText } from '../../lib/format';
import {
  groupLibraryItems,
  itemPlatforms,
  versionTagLabel,
} from '../../lib/groupLibrary';
import {
  displayKey,
  titleAliasMatch,
  type VersionTag,
} from '@maestro/common';
import { placeholderCover } from '../../lib/placeholderCover';
import {
  readCachedLibrary,
  writeCachedLibrary,
} from '../../lib/likedCache';

/**
 * AETHER Library — 红心库全屏（Figma 03/Screen/Library 还原）。
 *
 * 设计稿结构（1440×900，node 390:1081）：
 *  - backdrop（星云 + 地平线，复用 th-bg）
 *  - top-hud（❤ + "LIBRARY // LIKED" + close 按钮）
 *  - platform-counts（4 Badge/Platform + 各平台收藏数）
 *  - search-bar（960×48 @ y=148）
 *  - song-list（960×580 @ y=216，每行 960×56：
 *    cover 40×40 + info + spacer + 时长 + 平台 badges）
 *  - footer（重新导入按钮 + "点击曲目直接播放"）
 *
 * 搜索/分组/虚拟滚动/SWR 缓存/重新导入逻辑完整保留。
 */

interface Props {
  onClose: () => void;
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  refreshSignal?: number;
  onImportSettled?: (newCount: number | undefined) => void;
}

const PLATFORM_BADGE: Record<MusicProvider, { letter: string; color: string }> = {
  qq: { letter: 'Q', color: '#FFD93D' },
  netease: { letter: 'N', color: '#FF3B5C' },
  deezer: { letter: 'D', color: '#3D9BFF' },
  spotify: { letter: 'S', color: '#3DFFA2' },
};

function PlatformBadges({
  platforms,
  versionTag,
}: {
  platforms: MusicProvider[];
  versionTag?: VersionTag;
}) {
  const vtClass = versionTag ? ` lib-badges--${versionTag.toLowerCase()}` : '';
  return (
    <div className={`lib-sources${vtClass}`}>
      {platforms.map((platform) => (
        <span
          key={platform}
          className={`lib-badge lib-badge-${platform}`}
          title={versionTag && versionTagLabel(versionTag) ? `${platform} · ${versionTagLabel(versionTag)}` : platform}
        >
          {PLATFORM_BADGE[platform].letter}
          {versionTag && versionTag !== null && versionTag !== 'COVER' && (
            <span className="lib-badge-version">{versionTagLabel(versionTag)}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function SkeletonRow({ delayMs }: { delayMs: number }) {
  return (
    <li className="lib-row lib-skeleton" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="lib-cover lib-skeleton-block" />
      <div className="lib-meta">
        <div className="lib-skeleton-line lib-skeleton-line-track" />
        <div className="lib-skeleton-line lib-skeleton-line-artist" />
      </div>
    </li>
  );
}

function RefreshingOverlay() {
  return (
    <div className="lib-refresh-overlay" aria-live="polite">
      <div className="lib-refresh-card">
        <div className="lib-refresh-heart" aria-hidden>♥</div>
        <div className="lib-refresh-title">正在重新导入喜欢的歌曲…</div>
        <div className="lib-refresh-sub">从 QQ / 网易云 / Spotify 同步</div>
      </div>
    </div>
  );
}

export default function LikedLibraryModal({
  onClose,
  onPlay,
  refreshSignal,
  onImportSettled,
}: Props) {
  const [data, setData] = useState<LibraryImportResult | null>(() =>
    readCachedLibrary(),
  );
  const [loading, setLoading] = useState<boolean>(data == null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    let cancelled = false;
    setSyncing(true);
    getLibrary()
      .then((res) => {
        if (res) writeCachedLibrary(res);
        if (cancelled) return;
        if (res) setData(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => { cancelled = true; };
  }, [refreshSignal]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSyncing(true);
    getLibrary()
      .then((res) => {
        if (res) writeCachedLibrary(res);
        if (cancelled) return;
        if (res) setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); setSyncing(false); }
      });
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    let newCount: number | undefined;
    try {
      const res = await importLibrary();
      setData(res);
      writeCachedLibrary(res);
      newCount = res.items.length;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
      onImportSettled?.(newCount);
    }
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim();
    const indexed = items.map((item, originalIndex) => ({ item, originalIndex }));
    if (!q) return indexed;
    const ql = q.toLowerCase();
    const qKey = displayKey(q, '');
    return indexed.filter(({ item }) => {
      if (item.title.toLowerCase().includes(ql)) return true;
      if (item.artist.toLowerCase().includes(ql)) return true;
      if (titleAliasMatch(q, item.title)) return true;
      if (qKey) {
        const titleKey = displayKey(item.title, '');
        if (titleKey && titleKey.includes(qKey)) return true;
      }
      return false;
    });
  }, [items, query]);
  const filteredItems = useMemo(() => filtered.map((f) => f.item), [filtered]);
  const groups = useMemo(() => groupLibraryItems(filteredItems), [filteredItems]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 虚拟滚动
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const GROUP_ROW_H = 56;
  const SUB_ROW_H = 36;
  const rowVirtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: (index) => {
      const g = groups[index];
      const subN = expanded.has(g.key) ? Math.max(0, g.members.length - 1) : 0;
      return GROUP_ROW_H + subN * SUB_ROW_H;
    },
    overscan: 5,
  });

  const qqCount = groups.filter((g) => g.platforms.includes('qq')).length;
  const neCount = groups.filter((g) => g.platforms.includes('netease')).length;
  const spCount = groups.filter((g) => g.platforms.includes('spotify')).length;
  const dzCount = groups.filter((g) => g.platforms.includes('deezer')).length;

  const showList = !loading && groups.length > 0;
  const showEmpty = !loading && !error && groups.length === 0;

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

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const renderGroup = (
    g: ReturnType<typeof groupLibraryItems>[number],
    isOpen: boolean,
  ) => {
    const rep = g.representative;
    const multi = g.members.length > 1;
    return (
      <>
        <div
          className={`lib-row${isOpen ? ' is-open' : ''}`}
          onClick={() =>
            onPlay(items, filtered[g.representativeIndex].originalIndex)
          }
        >
          {rep.coverUrl ? (
            <img className="lib-cover" src={rep.coverUrl} alt="" loading="lazy" />
          ) : (
            <div
              className="lib-cover lib-cover-empty"
              style={{
                backgroundImage: placeholderCover(
                  `${rep.title}·${rep.artist}`,
                ).background,
              }}
            >
              ♪
            </div>
          )}
          <div className="lib-meta">
            <div className="lib-track">{clampText(rep.title, 40)}</div>
            <div className="lib-artist">
              {clampText(rep.artist, 30)}
              {rep.album && (
                <span className="lib-album"> · {clampText(rep.album, 25)}</span>
              )}
            </div>
          </div>
          <PlatformBadges platforms={g.platforms} />
          {rep.duration > 0 && (
            <span className="lib-duration" aria-label={`时长 ${formatDuration(rep.duration)}`}>
              {formatDuration(rep.duration)}
            </span>
          )}
          {g.hasCover && (
            <span className="lib-cover-warn" title="组内包含翻唱版本，展开查看" aria-label="含翻唱版本">
              ⚠
            </span>
          )}
          {multi && (
            <button
              className="lib-toggle"
              aria-label={isOpen ? '收起' : '展开各平台版本'}
              aria-expanded={isOpen}
              title={`${g.members.length} 个平台版本`}
              onClick={(e) => { e.stopPropagation(); toggle(g.key); }}
            >
              <span className="lib-toggle-count">{g.members.length}</span>
              <span className="lib-toggle-chevron">{isOpen ? '▾' : '▸'}</span>
            </button>
          )}
        </div>

        {isOpen && (
          <ul className="lib-sublist">
            {g.members.map((m) => (
              <li
                key={m.item.id}
                className={`lib-subrow${m.versionTag ? ` lib-subrow--${m.versionTag.toLowerCase()}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(items, filtered[m.index].originalIndex);
                }}
              >
                <span className="lib-subrow-dot" aria-hidden />
                <div className="lib-meta">
                  <div className="lib-track">
                    {clampText(m.item.title, 40)}
                    {m.versionTag && (
                      <span className={`lib-version-tag lib-version-tag--${m.versionTag.toLowerCase()}`}>
                        {versionTagLabel(m.versionTag)}
                      </span>
                    )}
                  </div>
                  <div className="lib-artist">
                    {clampText(m.item.artist, 30)}
                    {m.item.album && (
                      <span className="lib-album"> · {clampText(m.item.album, 25)}</span>
                    )}
                  </div>
                </div>
                <PlatformBadges platforms={itemPlatforms(m.item)} versionTag={m.versionTag} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <div className="lib-root">
      {/* ── 背景层（铺满窗口，不随画布缩放） ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="lib-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* top-hud（y=24，❤ + LIBRARY // LIKED + close） */}
        <header className="lib-hud">
          <div className="lib-hud-brand">
            <span className="lib-hud-heart">❤</span>
            <span className="lib-hud-title">LIBRARY // LIKED</span>
            {syncing && (
              <span className="lib-syncing-dot" aria-label="正在同步新数据" title="正在同步新数据…" />
            )}
          </div>
          <button className="lib-close" onClick={onClose} aria-label="关闭" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* platform-counts（y=112，4 Badge/Platform + 数字） */}
        <div className="lib-platform-counts" aria-label="各平台红心数">
          {qqCount > 0 && (
            <span className="lib-platform-stat" style={{ ['--badge' as string]: PLATFORM_BADGE.qq.color }} title={`QQ 音乐 ${qqCount} 首`}>
              <span className="lib-platform-letter">Q</span>
              <span className="lib-platform-num">{qqCount.toLocaleString()}</span>
            </span>
          )}
          {neCount > 0 && (
            <span className="lib-platform-stat" style={{ ['--badge' as string]: PLATFORM_BADGE.netease.color }} title={`网易云 ${neCount} 首`}>
              <span className="lib-platform-letter">N</span>
              <span className="lib-platform-num">{neCount.toLocaleString()}</span>
            </span>
          )}
          {dzCount > 0 && (
            <span className="lib-platform-stat" style={{ ['--badge' as string]: PLATFORM_BADGE.deezer.color }} title={`Deezer ${dzCount} 首`}>
              <span className="lib-platform-letter">D</span>
              <span className="lib-platform-num">{dzCount.toLocaleString()}</span>
            </span>
          )}
          {spCount > 0 && (
            <span className="lib-platform-stat" style={{ ['--badge' as string]: PLATFORM_BADGE.spotify.color }} title={`Spotify ${spCount} 首`}>
              <span className="lib-platform-letter">S</span>
              <span className="lib-platform-num">{spCount.toLocaleString()}</span>
            </span>
          )}
          <span className="lib-count">共 {groups.length} 首</span>
        </div>

        {/* search-bar（960×48 @ y=148） */}
        {items.length > 0 && (
          <div className="lib-search-bar">
            <svg className="lib-search-icon" viewBox="0 0 24 24" width="18" height="18"
              fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              className="lib-search-input"
              placeholder="搜索歌名或歌手…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索我的喜欢"
            />
            {query && (
              <button className="lib-search-clear" onClick={() => setQuery('')} aria-label="清除搜索" title="清除搜索">
                ×
              </button>
            )}
          </div>
        )}

        {/* song-list（960×580 @ y=216） */}
        <div className="lib-body" ref={bodyRef} data-virtualized={showList ? 'true' : 'false'}>
          {loading && (
            <ul className="lib-skeleton-list" aria-busy="true">
              <SkeletonRow delayMs={0} />
              <SkeletonRow delayMs={60} />
              <SkeletonRow delayMs={120} />
              <SkeletonRow delayMs={180} />
              <SkeletonRow delayMs={240} />
              <SkeletonRow delayMs={300} />
            </ul>
          )}

          {error && !loading && groups.length === 0 && (
            <div className="lib-error">⚠ {error}</div>
          )}

          {showEmpty && (
            <div className="lib-empty">
              <div className="lib-empty-icon">♡</div>
              <div className="lib-empty-text">
                {items.length > 0
                  ? `未找到匹配「${query.trim()}」的歌曲`
                  : '还没有导入任何红心歌曲'}
              </div>
              {items.length === 0 && (
                <button className="lib-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
                  {refreshing && <span className="lib-btn-spinner" aria-hidden />}
                  {refreshing ? '导入中…' : '现在导入'}
                </button>
              )}
            </div>
          )}

          {showList && (
            <div className="lib-virtual-list" style={{ height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const g = groups[virtualRow.index];
                if (!g) return null;
                const multi = g.members.length > 1;
                const isOpen = multi && expanded.has(g.key);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="lib-group"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {renderGroup(g, isOpen)}
                  </div>
                );
              })}
            </div>
          )}

          {refreshing && showList && <RefreshingOverlay />}
        </div>

        {/* footer（y=812，重新导入 + 提示） */}
        {showList && (
          <div className="lib-footer">
            <button className="lib-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
              {refreshing && <span className="lib-btn-spinner" aria-hidden />}
              {refreshing ? '重新导入中…' : '🔄 重新导入'}
            </button>
            <span className="lib-footer-hint">点击曲目直接播放</span>
          </div>
        )}
      </div>
    </div>
  );
}
