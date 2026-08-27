import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Modal from '../common/Modal';
import { getLibrary, importLibrary } from '../../api';
import type { LibraryImportResult, UnifiedSearchItem, MusicProvider } from '../../api';
import { formatDuration } from '../../lib/format';
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

interface Props {
  onClose: () => void;
  /** 把点击的 ❤ 歌放进播放队列（与搜索结果同源）。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  /** 递增计数：外部（播到红心歌、跨平台补齐后）触发一次静默刷新。 */
  refreshSignal?: number;
  /** 重新导入完成（成功或失败）后回调。App 用来同步刷顶部 ❤ 角标；
   *  传入新库的 items 数（成功时）或 undefined（失败时）。 */
  onImportSettled?: (newCount: number | undefined) => void;
}

/** 平台徽章：一个平台一个色块。QQ=Q / 网易云=云 / Spotify=S / Deezer=D。
 *  versionTag 决定徽章配色（live=蓝 / acoustic=紫 / remix=橙 / 翻唱=灰等）；
 *  子行（展开后）传 versionTag 让每个成员染色，折叠行传 null 保持默认色。
 *  折叠行的「组级」徽章仍走原逻辑（无 versionTag 染色），便于一眼看出
 *  「这首歌在几个平台被心过」的总览；版本细节在子行。 */
function PlatformBadges({
  platforms,
  versionTag,
}: {
  platforms: MusicProvider[];
  versionTag?: VersionTag;
}) {
  const vtClass = versionTag ? ` liked-modal-badges--${versionTag.toLowerCase()}` : '';
  return (
    <div className={`liked-modal-sources${vtClass}`}>
      {platforms.map((platform) => (
        <span
          key={platform}
          className={`liked-modal-badge liked-modal-badge-${platform}`}
          title={versionTag && versionTagLabel(versionTag) ? `${platform} · ${versionTagLabel(versionTag)}` : platform}
        >
          {platform === 'qq'
            ? 'Q'
            : platform === 'netease'
              ? '云'
              : platform === 'spotify'
                ? 'S'
                : 'D'}
          {versionTag && versionTag !== null && versionTag !== 'COVER' && (
            <span className="liked-modal-badge-version">{versionTagLabel(versionTag)}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * 首次打开、无 sessionStorage 缓存时的骨架行。和真实行等高（封面 40px +
 * 两行 meta），避免真数据到达时整个列表突然下沉。Pulse 动画见 scss。
 */
function SkeletonRow({ delayMs }: { delayMs: number }) {
  return (
    <li className="liked-modal-row liked-modal-skeleton" style={{ animationDelay: `${delayMs}ms` }}>
      <div className="liked-modal-cover liked-modal-skeleton-block" />
      <div className="liked-modal-meta">
        <div className="liked-modal-skeleton-line liked-modal-skeleton-line-track" />
        <div className="liked-modal-skeleton-line liked-modal-skeleton-line-artist" />
      </div>
    </li>
  );
}

/**
 * 「重新导入」中悬在列表上的中央卡片。❤ 心形脉动 + 文字。
 * 不用 SVG，纯 CSS keyframes（已用全局 search-spin 风格的心形符号做缩放）。
 */
function RefreshingOverlay() {
  return (
    <div className="liked-modal-refresh-overlay" aria-live="polite">
      <div className="liked-modal-refresh-card">
        <div className="liked-modal-refresh-heart" aria-hidden>
          ♥
        </div>
        <div className="liked-modal-refresh-title">正在重新导入喜欢的歌曲…</div>
        <div className="liked-modal-refresh-sub">从 QQ / 网易云 / Spotify 同步</div>
      </div>
    </div>
  );
}

/**
 * "我的喜欢" 总览弹窗：展示所有平台已 ❤ 合并后的库（QQ / 网易云 /
 * Spotify / Deezer），支持滚动浏览千级条目；底部"重新导入"
 * 按钮触发一次全量 importLibrary 刷新库。
 *
 * 数据来源：服务端 /music/library 返回的 UnifiedSearchItem[]，本身已经
 * 跨平台去重合并，所以一首歌不会因为 QQ + 网易云都 ❤ 而出现两次。
 *
 * UX：
 *  - 二次打开时从 sessionStorage 读上次结果首帧渲染（无白屏），后台静默
 *    拉新数据覆盖（stale-while-revalidate）。
 *  - 首次打开用 6 行 skeleton 占位，避免布局抖动。
 *  - 重新导入：列表上方一条渐变「同步条」+ 中央心形脉动 + 模糊遮罩。
 *  - 关闭弹窗不取消正在进行的重新导入；完成后通过 onImportSettled 通知
 *    App 刷角标。
 */
export default function LikedLibraryModal({
  onClose,
  onPlay,
  refreshSignal,
  onImportSettled,
}: Props) {
  // 拿过的库数据。首次打开：先看 sessionStorage，没有再走 loading。
  const [data, setData] = useState<LibraryImportResult | null>(() =>
    readCachedLibrary(),
  );
  // 首次打开且无缓存时为 true（显示 skeleton）；拿到数据（无论来自缓存还是网络）后置 false。
  const [loading, setLoading] = useState<boolean>(data == null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 后台拉新中（即便有缓存也置 true，让用户看到「正在同步」指示——避免误以为
  // sessionStorage 里的旧数据就是当前真值，常见于「上一首歌刚 fan-out 完但还没
  // 在 library view 里看到新 badge」的时差）。
  const [syncing, setSyncing] = useState(false);

  // refreshSignal 触发的静默刷新：只换数据、不闪 loading。首个值跳过（挂载
  // 时下面的 effect 已经拉过一次），避免打开就双拉。
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
        // 关键：cache 写入**不受** cancelled 影响——关闭弹窗也要让后台请求把
        // 最新数据落进 sessionStorage，下次打开首帧就是新鲜数据，不会再看到
        // 旧的 1-badged 列表。React 的 setState 必须在 cancelled 时跳过，否则
        // 会触发 "setState on unmounted" 警告并被忽略。
        if (res) writeCachedLibrary(res);
        if (cancelled) return;
        if (res) setData(res);
      })
      .catch(() => {
        // 静默刷新失败不打扰用户（列表保持现状）。
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  // 打开弹窗时拉一次（不强制 import；如果从未导入过就是空态）。
  // 有缓存时仍是「后台刷新」语义——不闪 loading、不显示 skeleton，只是拉到了就覆盖。
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSyncing(true);
    getLibrary()
      .then((res) => {
        // cache 写入先于 cancelled 检查——同 refreshSignal effect，关闭弹窗也要
        // 让最新数据落到 sessionStorage。
        if (res) writeCachedLibrary(res);
        if (cancelled) return;
        if (res) setData(res);
        // null = 从未导入过；保留缓存（如果有）或空态占位。
      })
      .catch((e) => {
        if (cancelled) return;
        // 只有在确实没有数据可看时才报错；老用户只是新拉失败，保留旧数据继续看。
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSyncing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 重新导入：不传 cancelled flag——关闭弹窗也要让请求跑完，下次打开直接是新数据。
  // 通过 onImportSettled 通知 App 刷 ❤ 角标，避免 App 再发起一次 getLibrary。
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
  // 搜索：按歌名/歌手不区分大小写包含匹配 + 跨脚本/别名兜底。在分组**之前**
  // 过滤 items——命中的 item 进分组，天然只显示匹配组。
  // ⚠️ 下标映射：filtered 保留「过滤后在原始 items 里的下标」——groupLibraryItems
  // 返回的 member.index 是 filteredItems 内的位置，onPlay 必须用 originalIndex
  // 在原始 items 里定位，否则搜索过滤后点击播放会错位（播默认列表第 1 首）。
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim();
    const indexed = items.map((item, originalIndex) => ({ item, originalIndex }));
    if (!q) return indexed;
    const ql = q.toLowerCase();
    // 2026-08-14 扩：原来只 substring 包含——导致「motto」搜不到「もっと」
    // （合并后 title 保留 3 字符的「もっと」，substring 永远不撞）。三道兜底：
    //  1. substring（最宽松，原行为）
    //  2. `titleAliasMatch`：跨写法同名（「悲歌」/「애절가」、「もっと」/「Motto」
    //     等策展表已收录）
    //  3. `displayKey` 双向包含：归一后 substring（大小写/标点/JP 假名归一差异
    //     都抹平，「Lemon.」vs「lemon」命中）
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
  // 展示级跨平台分组：把后端没并起来的同名副本（QQ 加了译名括号那种）折叠成
  // 一个可展开的组。仅影响展示，onPlay 仍按成员在 items 里的原始下标定位。
  const groups = useMemo(() => groupLibraryItems(filteredItems), [filteredItems]);
  // 哪些组当前展开（按 group.key）。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── 虚拟滚动（≥3000 首库必备）───────────────────────────────────
  // 滚动容器 = modal body（自带 overflow-y: auto + flex: 1 + min-height: 0，
  // 高度由 modal panel 减去 header/footer 决定）。把 ref 挂到 body 上，
  // virtualizer 用它算 visible range。estimateSize 给一个保守值；真实
  // 行高由 measureElement 在 mounted 后测量（覆盖默认值）。
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const GROUP_ROW_H = 56; // cover 40 + padding 8*2
  const SUB_ROW_H = 36; // ~24 内容 + padding 6*2
  const rowVirtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: (index) => {
      const g = groups[index];
      // 折叠态 = 单行 group row；展开态 = group row + N × subrow。
      // 这里只是 initial estimate；真实行高由 measureElement 在 ref
      // 上调用时覆盖。展开/折叠切换时 React 触发重渲染，virtualizer
      // 会重新调用 measureElement。
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

  // ── 渲染 helper ────────────────────────────────────────────────────
  // 把 group row + 可选 sublist 抽成函数，在虚拟化列表和未来其他地方复用。
  // 接收 isOpen/multi/toggle 外部传入避免闭包陷阱（虚拟化渲染里 onClick
  // 必须从 props 取最新 state）。
  const renderGroup = (
    g: ReturnType<typeof groupLibraryItems>[number],
    isOpen: boolean,
  ) => {
    const rep = g.representative;
    const multi = g.members.length > 1;
    return (
      <>
        <div
          className={`liked-modal-row${isOpen ? ' is-open' : ''}`}
          onClick={() =>
            onPlay(items, filtered[g.representativeIndex].originalIndex)
          }
        >
          {rep.coverUrl ? (
            <img
              className="liked-modal-cover"
              src={rep.coverUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <div
              className="liked-modal-cover liked-modal-cover-empty"
              style={{
                backgroundImage: placeholderCover(
                  `${rep.title}·${rep.artist}`,
                ).background,
              }}
            >
              ♪
            </div>
          )}
          <div className="liked-modal-meta">
            <div className="liked-modal-track">{rep.title}</div>
            <div className="liked-modal-artist">
              {rep.artist}
              {rep.album && (
                <span className="liked-modal-album"> · {rep.album}</span>
              )}
            </div>
          </div>
          <PlatformBadges platforms={g.platforms} />
          {rep.duration > 0 && (
            <span className="liked-modal-duration" aria-label={`时长 ${formatDuration(rep.duration)}`}>
              {formatDuration(rep.duration)}
            </span>
          )}
          {g.hasCover && (
            <span
              className="liked-modal-cover-warn"
              title="组内包含翻唱版本，展开查看"
              aria-label="含翻唱版本"
            >
              ⚠
            </span>
          )}
          {multi && (
            <button
              className="liked-modal-toggle"
              aria-label={isOpen ? '收起' : '展开各平台版本'}
              aria-expanded={isOpen}
              title={`${g.members.length} 个平台版本`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(g.key);
              }}
            >
              <span className="liked-modal-toggle-count">
                {g.members.length}
              </span>
              <span className="liked-modal-toggle-chevron">
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
          )}
        </div>

        {isOpen && (
          <ul className="liked-modal-sublist">
            {g.members.map((m) => (
              <li
                key={m.item.id}
                className={`liked-modal-subrow${m.versionTag ? ` liked-modal-subrow--${m.versionTag.toLowerCase()}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(items, filtered[m.index].originalIndex);
                }}
              >
                <span className="liked-modal-subrow-dot" aria-hidden />
                <div className="liked-modal-meta">
                  <div className="liked-modal-track">
                    {m.item.title}
                    {m.versionTag && (
                      <span className={`liked-modal-version-tag liked-modal-version-tag--${m.versionTag.toLowerCase()}`}>
                        {versionTagLabel(m.versionTag)}
                      </span>
                    )}
                  </div>
                  <div className="liked-modal-artist">
                    {m.item.artist}
                    {m.item.album && (
                      <span className="liked-modal-album"> · {m.item.album}</span>
                    )}
                  </div>
                </div>
                <PlatformBadges
                  platforms={itemPlatforms(m.item)}
                  versionTag={m.versionTag}
                />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <Modal onClose={onClose} panelClassName="liked-modal-panel">
      <div className="liked-modal-header">
        <span className="liked-modal-title">
          ❤ 我的喜欢
          {syncing && (
            <span
              className="liked-modal-syncing-dot"
              aria-label="正在同步新数据"
              title="正在同步新数据…"
            />
          )}
        </span>
        <span className="liked-modal-count">共 {groups.length} 首</span>
        <div className="liked-modal-platform-stats" aria-label="各平台红心数">
          {qqCount > 0 && (
            <span className="liked-modal-platform-stat liked-modal-platform-stat--qq" title={`QQ 音乐 ${qqCount} 首`}>
              <span className="liked-modal-platform-letter">Q</span>
              <span className="liked-modal-platform-num">{qqCount.toLocaleString()}</span>
            </span>
          )}
          {neCount > 0 && (
            <span className="liked-modal-platform-stat liked-modal-platform-stat--netease" title={`网易云 ${neCount} 首`}>
              <span className="liked-modal-platform-letter">N</span>
              <span className="liked-modal-platform-num">{neCount.toLocaleString()}</span>
            </span>
          )}
          {spCount > 0 && (
            <span className="liked-modal-platform-stat liked-modal-platform-stat--spotify" title={`Spotify ${spCount} 首`}>
              <span className="liked-modal-platform-letter">S</span>
              <span className="liked-modal-platform-num">{spCount.toLocaleString()}</span>
            </span>
          )}
          {dzCount > 0 && (
            <span className="liked-modal-platform-stat liked-modal-platform-stat--deezer" title={`Deezer ${dzCount} 首`}>
              <span className="liked-modal-platform-letter">D</span>
              <span className="liked-modal-platform-num">{dzCount.toLocaleString()}</span>
            </span>
          )}
        </div>
        <button
          className="liked-modal-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* 「正在同步」条：refreshing 时显示。position:absolute 浮在 header 下边缘。 */}
      {refreshing && <div className="liked-modal-syncbar" aria-hidden />}

      {/* 搜索条：只库非空时显示。过滤在分组前，命中即显示匹配组。 */}
      {items.length > 0 && (
        <div className="liked-modal-search">
          <input
            type="text"
            className="liked-modal-search-input"
            placeholder="搜索歌名或歌手…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索我的喜欢"
          />
          {query && (
            <button
              className="liked-modal-search-clear"
              onClick={() => setQuery('')}
              aria-label="清除搜索"
              title="清除搜索"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div
        className="liked-modal-body"
        ref={bodyRef}
        data-virtualized={showList ? 'true' : 'false'}
      >
        {loading && (
          <ul className="liked-modal-list liked-modal-skeleton-list" aria-busy="true">
            <SkeletonRow delayMs={0} />
            <SkeletonRow delayMs={60} />
            <SkeletonRow delayMs={120} />
            <SkeletonRow delayMs={180} />
            <SkeletonRow delayMs={240} />
            <SkeletonRow delayMs={300} />
          </ul>
        )}

        {error && !loading && groups.length === 0 && (
          <div className="liked-modal-error">⚠ {error}</div>
        )}

        {showEmpty && (
          <div className="liked-modal-empty">
            <div className="liked-modal-empty-icon">♡</div>
            <div className="liked-modal-empty-text">
              {items.length > 0
                ? `未找到匹配「${query.trim()}」的歌曲`
                : '还没有导入任何红心歌曲'}
            </div>
            {items.length === 0 && (
              <button
                className="liked-modal-refresh"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing && <span className="liked-modal-btn-spinner" aria-hidden />}
                {refreshing ? '导入中…' : '现在导入'}
              </button>
            )}
          </div>
        )}

        {showList && (
          // 虚拟滚动：3000+ 首库只渲染可见 ~30 个 group row，滚动流畅。
          // 外层 div 用 `liked-modal-virtual-list` 拿 position:relative 给
          // 内层 absolute 行做坐标系；总高度 = virtualizer.getTotalSize()。
          // 展开/折叠时 expanded Set 引用变 → React 重渲染 → estimateSize
          // closure 取新值 → virtualizer 自动重排；不需要 force key。
          <div
            className="liked-modal-virtual-list"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
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
                  className="liked-modal-group"
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

      {showList && (
        <div className="liked-modal-footer">
          <button
            className="liked-modal-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing && <span className="liked-modal-btn-spinner" aria-hidden />}
            {refreshing ? '重新导入中…' : '🔄 重新导入'}
          </button>
          <span className="liked-modal-hint">点击曲目直接播放</span>
        </div>
      )}
    </Modal>
  );
}