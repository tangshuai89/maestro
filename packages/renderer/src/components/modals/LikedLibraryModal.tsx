import { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import { getLibrary, importLibrary } from '../../api';
import type { LibraryImportResult, UnifiedSearchItem } from '../../api';

interface Props {
  onClose: () => void;
  /** 把点击的 ❤ 歌放进播放队列（与搜索结果同源）。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
}

/**
 * "我的喜欢" 总览弹窗：展示所有平台已 ❤ 合并后的库（QQ + 网易云 v1，
 * Deezer / Spotify 留 TODO），支持滚动浏览千级条目；底部"重新导入"
 * 按钮触发一次全量 importLibrary 刷新库。
 *
 * 数据来源：服务端 /music/library 返回的 UnifiedSearchItem[]，本身已经
 * 跨平台去重合并，所以一首歌不会因为 QQ + 网易云都 ❤ 而出现两次。
 */
export default function LikedLibraryModal({ onClose, onPlay }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<LibraryImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开弹窗时拉一次缓存（不强制 import；如果从未导入过就是空态）。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLibrary()
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await importLibrary();
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const items = data?.items ?? [];
  // 平台计数从「合并后的 items」里数（有多少行含该平台的源），而不是用
  // sources[].count（那是去重前的原始拉取数）。否则会出现"总数 985 <
  // QQ 1000"这种自相矛盾——因为 QQ 1000 + 网易云 6 合并去重后才是 985。
  // 从 items 数保证：每个平台数 ≤ 总数，且与每行显示的徽章一一对应。
  // 跨平台都 ❤ 的歌会同时计入两个平台（所以两者之和可能 > 总数，这符合直觉）。
  const qqCount = items.filter((it) =>
    it.sources.some((s) => s.platform === 'qq'),
  ).length;
  const neCount = items.filter((it) =>
    it.sources.some((s) => s.platform === 'netease'),
  ).length;

  return (
    <Modal onClose={onClose} panelClassName="liked-modal-panel">
      <div className="liked-modal-header">
        <span className="liked-modal-title">❤ 我的喜欢</span>
        <span className="liked-modal-count">
          共 {items.length} 首
          {qqCount + neCount > 0 && (
            <span className="liked-modal-count-detail">
              {' '}· QQ {qqCount} · 网易云 {neCount}
            </span>
          )}
        </span>
        <button
          className="liked-modal-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="liked-modal-body">
        {loading && <div className="liked-modal-loading">加载中…</div>}

        {error && <div className="liked-modal-error">⚠ {error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="liked-modal-empty">
            <div className="liked-modal-empty-icon">♡</div>
            <div className="liked-modal-empty-text">
              还没有导入任何红心歌曲
            </div>
            <button
              className="liked-modal-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '导入中…' : '现在导入'}
            </button>
          </div>
        )}

        {!loading && items.length > 0 && (
          <ul className="liked-modal-list">
            {items.map((it, idx) => (
              <li
                key={it.id}
                className="liked-modal-row"
                onClick={() => onPlay(items, idx)}
              >
                {it.coverUrl ? (
                  <img
                    className="liked-modal-cover"
                    src={it.coverUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="liked-modal-cover liked-modal-cover-empty">
                    ♪
                  </div>
                )}
                <div className="liked-modal-meta">
                  <div className="liked-modal-track">{it.title}</div>
                  <div className="liked-modal-artist">
                    {it.artist}
                    {it.album && (
                      <span className="liked-modal-album"> · {it.album}</span>
                    )}
                  </div>
                </div>
                <div className="liked-modal-sources">
                  {/* 一个平台一个徽章：合并后同一首歌可能有多条同平台的
                      source（QQ 里的重复版本合并进同一 item），按平台去重，
                      否则 key 会撞（React "two children with the same key"）。 */}
                  {[...new Set(it.sources.map((s) => s.platform))].map(
                    (platform) => (
                      <span
                        key={platform}
                        className={`liked-modal-badge liked-modal-badge-${platform}`}
                        title={platform}
                      >
                        {platform === 'qq'
                          ? 'Q'
                          : platform === 'netease'
                            ? '云'
                            : platform === 'spotify'
                              ? 'S'
                              : 'D'}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <div className="liked-modal-footer">
          <button
            className="liked-modal-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '重新导入中…' : '🔄 重新导入'}
          </button>
          <span className="liked-modal-hint">点击曲目直接播放</span>
        </div>
      )}
    </Modal>
  );
}