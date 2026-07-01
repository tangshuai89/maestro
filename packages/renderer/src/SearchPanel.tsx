import { useState } from 'react';
import type { Track, MusicProvider } from './api';
import { searchTracks } from './api';
import './SearchPanel.css';

interface Props {
  provider: MusicProvider;
  /** 点某一行播放：把整批结果作为客户端队列，从 index 开始播。 */
  onPlay: (results: Track[], index: number) => void;
  onClose: () => void;
}

/**
 * 搜索面板——产品核心入口：输入歌手/歌名 → 出结果 → 点一行播放，
 * 剩余结果成为播放队列（skip / 播完自动下一首）。
 */
export default function SearchPanel({ provider, onPlay, onClose }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = async () => {
    const kw = q.trim();
    if (!kw) return;
    setLoading(true);
    setError(null);
    try {
      const r = await searchTracks(provider, kw);
      setResults(r);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <input
            autoFocus
            className="search-input"
            placeholder="搜索歌手 / 歌名，回车"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="search-go" onClick={() => void run()} disabled={loading}>
            {loading ? '…' : '搜索'}
          </button>
          <button className="search-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {error && <div className="search-error">{error}</div>}

        <div className="search-results">
          {searched && !loading && results.length === 0 && (
            <div className="search-empty">没搜到结果，换个关键词试试</div>
          )}
          {results.map((t, i) => (
            <button
              key={`${t.id}-${i}`}
              className="search-row"
              onClick={() => onPlay(results, i)}
              title={`播放：${t.title} - ${t.artist}`}
            >
              {t.coverUrl ? (
                <img className="search-cover" src={t.coverUrl} alt="" />
              ) : (
                <div className="search-cover search-cover-ph" />
              )}
              <div className="search-row-meta">
                <div className="search-row-title">{t.title}</div>
                <div className="search-row-sub">
                  {t.artist}
                  {t.album ? ` · ${t.album}` : ''}
                </div>
              </div>
              <svg className="search-play-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
