import type { Track } from '../../api';
import { clampText } from '../../lib/format';

/**
 * LiteView —— 极简播放模式（specs/lite-mode）。
 *
 * 整屏只有三类可视元素：歌名块 / 上一首·下一首 / ✨ 推荐。
 * **只消费 usePlayer 已暴露的状态**，不碰 <audio> —— `<audio>` 常驻 App.tsx，
 * 切 mode 只是这里的条件渲染，Web Audio graph 不重建、播放态天然不丢。
 */

export interface LiteViewProps {
  track: Track | null;
  loading: boolean;
  /** DeepSeek key 是否已配置（未配置时 ✨ 仍可点，App 会转去弹 key 框）。 */
  recoConfigured: boolean;
  recoRunning: boolean;
  onPrev: () => void;
  /** 下一首。 */
  onSkip: () => void;
  onReco: () => void;
  /** 回 theater（⛶ 键 / Esc / ⌘⇧L 三条路径都指到这里）。 */
  onExit: () => void;
}

// lucide 风格内联 SVG（stroke 制，currentColor 上色）——与 TheaterView /
// MiniPlayer 同一套路径语法；各组件自带小图标集是本项目惯例（无共享 icon 库）。
const ICONS: Record<string, string[]> = {
  skipBack: ['M19 20 9 12l10-8z', 'M5 19V5'],
  skipForward: ['M5 4l10 8-10 8z', 'M19 5v14'],
  expand: [
    'M8 3H5a2 2 0 0 0-2 2v3',
    'M21 8V5a2 2 0 0 0-2-2h-3',
    'M16 21h3a2 2 0 0 0 2-2v-3',
    'M3 16v3a2 2 0 0 0 2 2h3',
  ],
  sparkle: [
    'M12 2l2.2 6.2L20.5 10l-6.3 1.8L12 18l-2.2-6.2L3.5 10l6.3-1.8z',
    'M19 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z',
  ],
};

function LiteIcon({
  icon,
  size = 22,
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

export default function LiteView({
  track,
  loading,
  recoConfigured,
  recoRunning,
  onPrev,
  onSkip,
  onReco,
  onExit,
}: LiteViewProps) {
  const idle = !track || loading;
  // 未配 DeepSeek key 时 ✨ 仍可点（App 会转去弹 key 框），但界面得给个提示 ——
  // 否则点了"没反应"，用户不知道要先填 key。is-unset 只改描边/字色（走令牌），
  // 不加新元素、不动三元素契约。
  const unset = !recoConfigured && !recoRunning;
  const recoTitle = recoRunning
    ? '正在向 DeepSeek 要推荐…'
    : recoConfigured
      ? '✨ 智能推荐 —— 让 DeepSeek 接着放'
      : '✨ 智能推荐 —— 先填 DeepSeek key';

  return (
    <div className="lite-view" role="region" aria-label="极简播放模式">
      {/* 退出键常驻 DOM 但默认透明（hover / 键盘 focus 显形）——
          "只能靠快捷键退出"对纯鼠标用户是死路，见 spec §6 偏离 2。 */}
      <button
        type="button"
        className="lite-exit"
        onClick={onExit}
        title="返回完整界面（Esc / ⌘⇧L）"
        aria-label="返回完整界面"
      >
        <LiteIcon icon="expand" size={16} />
      </button>

      <div className="lite-stage">
        <div className="lite-title-block" data-lite-el="title">
          <h1 className="lite-title">
            {track ? clampText(track.title, 40) : 'Lite 模式'}
          </h1>
          {/* 歌手副行归入歌名块（同一 data-lite-el），不算第四类元素 */}
          {track && (
            <p className="lite-artist">{clampText(track.artist, 40)}</p>
          )}
        </div>

        <div className="lite-controls" data-lite-el="nav">
          <button
            type="button"
            className="lite-btn"
            onClick={onPrev}
            disabled={idle}
            title="上一首"
            aria-label="上一首"
          >
            <LiteIcon icon="skipBack" />
          </button>
          <button
            type="button"
            className="lite-btn"
            onClick={onSkip}
            disabled={idle}
            title="下一首"
            aria-label="下一首"
          >
            <LiteIcon icon="skipForward" />
          </button>
        </div>

        <button
          type="button"
          className={`lite-reco${recoRunning ? ' is-running' : ''}${unset ? ' is-unset' : ''}`}
          onClick={onReco}
          disabled={recoRunning}
          title={recoTitle}
          aria-label="智能推荐"
          aria-busy={recoRunning}
          data-lite-el="reco"
        >
          <LiteIcon icon="sparkle" size={20} />
          <span className="lite-reco-label">
            {recoRunning ? '推荐中…' : '智能推荐'}
          </span>
        </button>
      </div>
    </div>
  );
}
