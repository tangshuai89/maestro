# Components — Shared / Reusable UI Primitives

## App stack (detection)

- **Framework**: React 18 + TypeScript + Vite (`packages/renderer`), rendered inside Electron.
- **Meta-framework**: none (no Next/Nuxt). Single-window renderer; `main.tsx` mounts `<App/>` into `#root`.
- **Component library**: none (no shadcn/Ant/MUI/Radix). Fully custom components + SCSS.
- **CSS approach**: one global SCSS stylesheet (`packages/renderer/src/styles/main.scss`) imported once in `main.tsx`. Components never import styles; they reference semantic class-name strings. Design tokens are CSS custom properties (`:root` + `[data-theme]`) with a few compile-time SCSS constants.
- **State**: React hooks + context-free composition in `App.tsx` (no Redux). All logic lives in `hooks/`, markup in `components/`.

All paths below are relative to `packages/renderer/src/`.

---

## ErrorPanel — `components/common/ErrorPanel.tsx`

Collapsible error panel: always shows a one-line summary, expands to full text (monospace, wrapped) with copy + close buttons. Used for transport/playback errors.

Key props: `message: string`, `onClose: () => void`.

```tsx
import { useState } from 'react';

interface Props {
  message: string;
  onClose: () => void;
}

/**
 * 可展开的错误面板——始终显示一行摘要，点击展开完整文本（等宽字体、自动换行），
 * 带复制按钮与关闭按钮。调试 NetEase 扫码登录 / OAuth 这种长错误信息必备。
 */
export default function ErrorPanel({ message, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const firstLine = message.split('\n')[0].slice(0, 120);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard 不可用时降级：什么都不做
    }
  };

  return (
    <div className={`error-panel ${expanded ? 'expanded' : ''}`}>
      <button
        className="error-summary"
        onClick={() => setExpanded((v) => !v)}
        title="点击查看完整错误"
      >
        <span className="error-icon">⚠</span>
        <span className="error-summary-text">{firstLine}</span>
        <span className="error-toggle">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="error-detail">
          <pre className="error-pre">{message}</pre>
          <div className="error-actions">
            <button
              className="error-action"
              onClick={handleCopy}
              title="复制完整错误信息"
            >
              {copied ? '已复制 ✓' : '复制'}
            </button>
            <button className="error-action" onClick={onClose} title="关闭">
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Modal — `components/common/Modal.tsx`

Shared overlay + panel shell (scrim click closes; panel clicks stopped). Frosted-dark, theme-independent look lives in `styles/components/_modal.scss`. Used by search / reco-key / liked / settings dialogs.

Key props: `onClose: () => void`, `panelClassName?: string`, `children: ReactNode`.

```tsx
import type { MouseEvent, ReactNode } from 'react';

interface Props {
  onClose: () => void;
  /** Extra class on the panel (e.g. width overrides for a specific modal). */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * Shared overlay + panel shell for the search / reco-key dialogs. Clicking
 * the scrim closes; clicks inside the panel are stopped so they don't bubble
 * to the scrim. The frosted-dark look lives in components/_modal.scss.
 */
export default function Modal({ onClose, panelClassName, children }: Props) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-panel${panelClassName ? ` ${panelClassName}` : ''}`}
        onClick={stop}
      >
        {children}
      </div>
    </div>
  );
}
```

---

## AuthErrorPanel — `components/common/AuthErrorPanel.tsx`

Recovery panel shown at App level when an auth attempt fails. Always surfaces typed actions (retry / re-login / paste cookie / switch source / dismiss), never a raw error string. Distinct from `<ErrorPanel>`.

Key props: `provider`, `error: AuthError | null`, `onRetry`, `onReLogin`, `onSwitch`, `onPasteCookie?`, `onDismiss`.

```tsx
import type { AuthError, AuthErrorCode } from '../../auth/types';
import type { MusicProvider } from '../../api';

interface Props {
  provider: MusicProvider;
  error: AuthError | null;
  onRetry: () => void;
  onReLogin: () => void;
  onSwitch: () => void;
  onPasteCookie?: () => void;
  onDismiss: () => void;
}

const FRIENDLY: Record<AuthErrorCode, string> = {
  AUTH_CANCELLED: '登录已取消',
  AUTH_TIMEOUT: '登录超时（120s），请重试',
  AUTH_INVALID: '凭据无效，请重新登录',
  AUTH_EXPIRED: '会话已过期，请重新登录',
  AUTH_PROTOCOL_MISSING: 'Spotify 没收到回调，请检查默认浏览器关联',
  AUTH_BACKEND_DOWN: '后端不可达',
  AUTH_UNKNOWN: '登录失败',
};

/**
 * Recovery panel shown when an auth attempt fails. Always surfaces typed
 * actions; never just a raw error string. Mounts at App level so it stays
 * visible across cover card swaps. Distinct from <ErrorPanel> (which
 * shows transport-level playback errors).
 */
export default function AuthErrorPanel({
  provider,
  error,
  onRetry,
  onReLogin,
  onSwitch,
  onPasteCookie,
  onDismiss,
}: Props) {
  if (!error) return null;
  const title = FRIENDLY[error.code];
  const showPaste = (provider === 'qq' || provider === 'netease') && Boolean(onPasteCookie);
  return (
    <div className="auth-error-panel" role="alert">
      <div className="auth-error-title">{title}</div>
      <div className="auth-error-detail">{error.message}</div>
      <div className="auth-error-actions">
        <button className="auth-error-btn" onClick={onRetry} title="用相同方式重试">
          重试
        </button>
        <button className="auth-error-btn" onClick={onReLogin} title="从头开始登录">
          重新登录
        </button>
        {showPaste && (
          <button
            className="auth-error-btn"
            onClick={onPasteCookie}
            title="手动粘贴 cookie 登录"
          >
            粘贴 cookie
          </button>
        )}
        <button
          className="auth-error-btn"
          onClick={onSwitch}
          title="回到音源选择页"
        >
          切换音源
        </button>
        <button className="auth-error-btn auth-error-btn-ghost" onClick={onDismiss} title="关闭错误">
          关闭
        </button>
      </div>
    </div>
  );
}
```

---

## ProgressBar — `components/player/ProgressBar.tsx`

Full-width progress row: click-to-seek bar with hover-grown thumb + time codes (left) and a slot for the volume group (right). Fill width fed via the `--progress` CSS custom property (0–100).

Key props: `currentTime: number`, `duration: number`, `onSeek: (seconds: number) => void`, `children?: ReactNode`.

```tsx
import type { CSSProperties, ReactNode, MouseEvent } from 'react';
import { formatTime } from '../../lib/format';

interface Props {
  currentTime: number;
  duration: number;
  /** Seek to an absolute time in seconds. */
  onSeek: (seconds: number) => void;
  /** Right-hand slot on the meta line — the volume control. */
  children?: ReactNode;
}

/**
 * Full-width progress row: a click-to-seek bar with a hover-grown thumb, and
 * below it the time codes (left) + a slot for the volume group (right). The
 * fill width is fed via the --progress custom property (0–100) so the width
 * rule stays in SCSS.
 */
export default function ProgressBar({
  currentTime,
  duration,
  onSeek,
  children,
}: Props) {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleBarClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div className="progress-row">
      <div className="progress-bar" onClick={handleBarClick}>
        <div className="progress-fill" style={{ '--progress': pct } as CSSProperties} />
      </div>
      <div className="progress-meta">
        <div className="progress-time">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
```

---

## VolumeControl — `components/player/VolumeControl.tsx`

Mute button + slim range slider. Slider fill driven by the `--volume` CSS custom property (0–100).

Key props: `volume: number`, `muted: boolean`, `onVolumeChange: (e: ChangeEvent<HTMLInputElement>) => void`, `onToggleMute: () => void`.

```tsx
import type { ChangeEvent, CSSProperties } from 'react';
import VolumeIcon from './VolumeIcon';

interface Props {
  volume: number;
  muted: boolean;
  onVolumeChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onToggleMute: () => void;
}

/**
 * Mute button + slim range slider. The slider's filled portion is driven by
 * the --volume custom property (0–100) rather than an inline gradient rule —
 * the styling lives in SCSS, tsx only feeds the value.
 */
export default function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: Props) {
  return (
    <div className="volume-group">
      <button
        className={`volume-btn${muted ? ' is-muted' : ''}`}
        onClick={onToggleMute}
        title={muted ? '取消静音' : '静音'}
        aria-label={muted ? '取消静音' : '静音'}
      >
        <VolumeIcon volume={volume} muted={muted} />
      </button>
      <input
        type="range"
        className="volume-slider"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        onChange={onVolumeChange}
        aria-label="音量"
        style={{ '--volume': volume * 100 } as CSSProperties}
      />
    </div>
  );
}
```

---

## VolumeIcon — `components/player/VolumeControl.tsx` sibling: `components/player/VolumeIcon.tsx`

Volume icon with four states — muted / low / mid / high — derived from `(volume, muted)`. SVG paths from Material Design Icons, sized 14×14 to match transport buttons.

Key props: `volume: number`, `muted: boolean`.

```tsx
/**
 * Volume icon with four states — muted / low / mid / high — derived from
 * (volume, muted). We pick the icon set rather than the slider position
 * because the icon must stay readable at 14×14px. SVG paths from Material
 * Design Icons, to match the transport buttons' visual vocabulary.
 */
export default function VolumeIcon({
  volume,
  muted,
}: {
  volume: number;
  muted: boolean;
}) {
  if (muted || volume === 0) {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        {/* Speaker with a slash — explicit "audio off" state */}
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
      </svg>
    );
  }
  if (volume < 0.5) {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        {/* Speaker alone, no waves — quiet */}
        <path d="M7 9v6h4l5 5V4l-5 5H7z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      {/* Speaker + two waves — loud */}
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}
```

---

## TransportBar — `components/player/TransportBar.tsx`

Bottom transport: dislike / like (with fan-out badge) / play-pause (spinner while loading) / skip. All inline Material-style SVG.

Key props: `hasTrack`, `loading`, `playing`, `liked`, `fanOutCount`, `onDislike`, `onLike`, `onPlayPause`, `onSkip`.

```tsx
interface Props {
  hasTrack: boolean;
  loading: boolean;
  playing: boolean;
  liked: boolean;
  fanOutCount: number;
  onDislike: () => void;
  onLike: () => void;
  onPlayPause: () => void;
  onSkip: () => void;
}

/** Bottom transport: dislike / like / play-pause / skip. */
export default function TransportBar({
  hasTrack,
  loading,
  playing,
  liked,
  fanOutCount,
  onDislike,
  onLike,
  onPlayPause,
  onSkip,
}: Props) {
  return (
    <div className="transport-row">
      <button
        className="control-btn dislike-btn"
        onClick={onDislike}
        disabled={!hasTrack}
        title="不感兴趣"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>

      <button
        className={`control-btn like-btn${liked ? ' liked' : ''}`}
        onClick={onLike}
        disabled={!hasTrack}
        title={
          liked
            ? fanOutCount > 0
              ? `已心动 ${fanOutCount} 个平台，再点取消红心`
              : '再点取消红心'
            : '红心'
        }
      >
        {liked ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" />
          </svg>
        )}
        {fanOutCount > 1 && <span className="like-btn-badge">{fanOutCount}❤</span>}
      </button>

      <button
        className="control-btn play-btn"
        onClick={onPlayPause}
        disabled={!hasTrack || loading}
        title={playing ? '暂停' : '播放'}
      >
        {loading ? (
          <svg className="spinner" viewBox="0 0 24 24" width="28" height="28">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="31.4 31.4" />
          </svg>
        ) : playing ? (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button
        className="control-btn skip-btn"
        onClick={onSkip}
        disabled={loading}
        title="下一首"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>
  );
}
```

---

## SourceChip — `components/search/SourceChip.tsx`

Platform chip marking which platforms a unified search result exists on. The `bestSource` platform gets its brand colour + ★; no-copyright sources are greyed with a strikethrough.

Key props: `source: UnifiedSourceInfo`, `isBest: boolean`.

```tsx
import { PROVIDER_LABELS } from '../../api';
import type { MusicProvider, UnifiedSourceInfo } from '../../api';

/** Short platform label for the compact chips. */
function providerShort(p: MusicProvider): string {
  switch (p) {
    case 'qq':
      return 'QQ';
    case 'netease':
      return '网易';
    case 'deezer':
      return 'DZ';
    case 'spotify':
      return 'SP';
  }
}

/** Platform chip — marks which platforms a unified search result exists on.
 *  The bestSource platform gets its brand colour + ★; no-copyright ones are
 *  greyed with a strikethrough. */
export default function SourceChip({
  source,
  isBest,
}: {
  source: UnifiedSourceInfo;
  isBest: boolean;
}) {
  return (
    <span
      className={`source-chip source-chip--${source.platform}${
        source.hasCopyright ? '' : ' source-chip--no-rights'
      }${isBest ? ' source-chip--best' : ''}`}
      title={
        source.hasCopyright
          ? `${PROVIDER_LABELS[source.platform]} · 有版权${isBest ? ' · 推荐' : ''}`
          : `${PROVIDER_LABELS[source.platform]} · 无版权`
      }
    >
      {providerShort(source.platform)}
      {isBest && <span className="source-chip-best">★</span>}
    </span>
  );
}
```

---

## Notes on page-specific / legacy player components

- `components/player/CoverCard.tsx`, `NowPlayingCard.tsx`, `LyricsCard.tsx`, `LyricsPanel.tsx` are **legacy pre-Monster-Beats player-view components**. They are no longer imported by any active view (MonsterBeatsView replaced the old hero/side-card layout; only a comment references CoverCard). They are page-specific leftovers — not shared primitives — and are omitted here.
- The current main player view (`MonsterBeatsView`) is fully self-contained: its subcomponents (`HUDStat`, `CreatureStat`, `MbIcon`, `BotAvatar`, plus helpers) are defined inside `components/views/MonsterBeatsView.tsx`, not in separate files. See `pages.md` / `extractable-components.md`.
