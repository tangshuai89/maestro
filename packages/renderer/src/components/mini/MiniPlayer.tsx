import type { MouseEvent } from 'react';
import type { Track } from '../../api';
import { clampText, formatTime } from '../../lib/format';
import { placeholderCover } from '../../lib/placeholderCover';

/**
 * MiniPlayer —— 底部悬浮播控条（theater ↔ mini，`⌘⇧M` 或顶栏按钮切换）。
 * spec：specs/mini-player/spec.md（设计愿景见 docs/mini-player-mode-spec.md）。
 *
 * 只消费 usePlayer 已暴露的状态，不碰 audio 元素 —— `<audio>` 常驻 App.tsx，
 * 切 mode 只是 TheaterView/MiniPlayer 的条件渲染，Web Audio graph 不重建。
 */

export type PlayerMode = 'theater' | 'mini';

export interface MiniPlayerProps {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  liked: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onLike: () => void;
  onSeek: (seconds: number) => void;
  /** 回 theater 模式。 */
  onExpand: () => void;
}

// lucide 风格内联 SVG（stroke 制，currentColor 上色）——与 TheaterView 同一套
// 路径语法；各组件自带小图标集是本项目惯例（无共享 icon 库）。
const ICONS: Record<string, string[]> = {
  play: ['M8 5v14l11-7z'],
  pause: ['M6 19h4V5H6v14zm8-14v14h4V5h-4z'],
  skipBack: ['M19 20 9 12l10-8z', 'M5 19V5'],
  skipForward: ['M5 4l10 8-10 8z', 'M19 5v14'],
  heart: [
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z',
  ],
  expand: [
    'M8 3H5a2 2 0 0 0-2 2v3',
    'M21 8V5a2 2 0 0 0-2-2h-3',
    'M16 21h3a2 2 0 0 0 2-2v-3',
    'M3 16v3a2 2 0 0 0 2 2h3',
  ],
};

function MiniIcon({
  icon,
  size = 16,
  fill,
}: {
  icon: string;
  size?: number;
  fill?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(ICONS[icon] ?? []).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export default function MiniPlayer({
  track,
  playing,
  loading,
  liked,
  currentTime,
  duration,
  onPlayPause,
  onSkip,
  onPrev,
  onLike,
  onSeek,
  onExpand,
}: MiniPlayerProps) {
  const hasTrack = Boolean(track);
  const effTime = hasTrack ? currentTime : 0;
  const effDuration = hasTrack ? duration : 0;
  const pct =
    effDuration > 0 ? Math.min(100, (effTime / effDuration) * 100) : 0;
  const effPlaying = hasTrack && playing;

  // 封面：<img> 直接渲染跨域 URL 没问题（CORS 只影响像素提取，那是
  // cover-proxy 的职责）；失败/无封面 → placeholderCover 渐变 + ♪。
  const placeholder = placeholderCover(
    track ? `${track.title}·${track.artist}` : 'maestro',
  );

  const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
    if (!hasTrack || effDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * effDuration);
  };

  return (
    <div className="mini-player" role="region" aria-label="迷你播放器">
      {/* 封面点击 = 展开回 theater（Apple Music miniPlayer 行为）。 */}
      <button
        type="button"
        className="mini-cover"
        style={{ background: placeholder.background }}
        onClick={onExpand}
        title="封面 · 展开剧场模式（⌘⇧M）"
        aria-label="封面 · 展开剧场模式"
      >
        {track?.coverUrl && (
          <img
            src={track.coverUrl}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        {!track?.coverUrl && (
          <span className="mini-cover-symbol" aria-hidden="true">
            ♪
          </span>
        )}
      </button>

      <div className="mini-info">
        <div className="mini-title">
          {track ? clampText(track.title, 24) : '等待播放'}
        </div>
        <div className="mini-sub">
          {track
            ? clampText(`${track.artist} — ${track.album || '未知专辑'}`, 40)
            : '展开剧场模式挑选一首歌'}
        </div>
        {/* Apple Music 式双侧时间：当前 ──bar── -剩余 */}
        <div className="mini-progress-row">
          <span className="mini-time">{formatTime(effTime)}</span>
          <div
            className="mini-progress"
            role="slider"
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(effDuration)}
            aria-valuenow={Math.round(effTime)}
            tabIndex={hasTrack ? 0 : -1}
            onClick={handleSeek}
          >
            <div
              className="mini-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mini-time">
            -{formatTime(Math.max(0, effDuration - effTime))}
          </span>
        </div>
      </div>

      <div className="mini-buttons">
        <button
          type="button"
          className="mini-btn"
          onClick={onPrev}
          disabled={!hasTrack}
          title="上一首"
          aria-label="上一首"
        >
          <MiniIcon icon="skipBack" size={16} />
        </button>
        <button
          type="button"
          className={`mini-btn mini-btn--play${effPlaying ? ' is-playing' : ''}`}
          onClick={onPlayPause}
          disabled={!hasTrack || loading}
          title={effPlaying ? '暂停' : '播放'}
          aria-label={effPlaying ? '暂停' : '播放'}
        >
          {loading ? (
            <span className="mini-spinner" aria-label="加载中" />
          ) : effPlaying ? (
            <MiniIcon icon="pause" size={18} fill />
          ) : (
            <MiniIcon icon="play" size={18} fill />
          )}
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={onSkip}
          disabled={!hasTrack}
          title="下一首"
          aria-label="下一首"
        >
          <MiniIcon icon="skipForward" size={16} />
        </button>
        <button
          type="button"
          className={`mini-btn mini-btn--like${liked ? ' is-liked' : ''}`}
          onClick={onLike}
          disabled={!hasTrack}
          title={liked ? '取消红心' : '红心'}
          aria-label={liked ? '取消红心' : '红心'}
          aria-pressed={liked}
        >
          <MiniIcon icon="heart" size={16} fill={liked} />
        </button>
        <button
          type="button"
          className="mini-btn mini-btn--expand"
          onClick={onExpand}
          title="展开剧场模式（⌘⇧M）"
          aria-label="展开剧场模式"
        >
          <MiniIcon icon="expand" size={15} />
        </button>
      </div>
    </div>
  );
}
