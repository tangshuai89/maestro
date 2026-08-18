# Layouts — Shared Layout Components

All paths below are relative to `packages/renderer/src/`.

The app is a single-window Electron renderer. The persistent chrome is the **Titlebar** (fixed 40px top bar; the macOS drag region). The **SourceSelect** screen is the only full-window "page" outside the player view. All other layout primitives below hang off the Titlebar.

---

## Titlebar — `components/layout/Titlebar.tsx`

The top window bar rendered on the main player view (inside `.app`). Left→right: source switch pill → (Deezer preset select, only for deezer) → search → reco → liked → (quality menu, only when logged in on qq/netease) → login/account pushed right via `margin-left:auto` → settings gear → reset. The bar itself is the macOS drag region; children are `no-drag`.

```tsx
import type { DeezerEditorial, MusicProvider, QqQuality } from '../../api';
import SourceMenu from './SourceMenu';
import QualityMenu from './QualityMenu';
import DeezerPresetSelect from './DeezerPresetSelect';

interface Props {
  provider: MusicProvider;
  onSwitchProvider: (p: MusicProvider) => void;
  // Deezer preset
  deezerEditorials: DeezerEditorial[];
  deezerPreset: string;
  onChangeDeezerPreset: (p: string) => void;
  // Search
  onOpenSearch: () => void;
  // Reco
  recoStatus: { configured: boolean } | null;
  recoRunning: boolean;
  onReco: () => void;
  // Quality
  qqQuality: QqQuality;
  onChangeQuality: (q: QqQuality) => void;
  // Auth
  loggedIn: boolean;
  loggingIn: boolean;
  accountName: string | undefined;
  onLogin: () => void;
  onAccount: () => void;
  // Reset
  onReset: () => void;
  // Liked library
  likedCount: number;
  onOpenLiked: () => void;
  // Settings (backup / export / import)
  onOpenSettings: () => void;
}

/**
 * The top window bar. Left→right: source switch, provider-specific controls
 * (deezer preset / search / reco / quality), then auth + reset pushed right
 * (via margin-left:auto on .login-btn / .account-btn). The bar itself is the
 * macOS drag region.
 */
export default function Titlebar({
  provider,
  onSwitchProvider,
  deezerEditorials,
  deezerPreset,
  onChangeDeezerPreset,
  onOpenSearch,
  recoStatus,
  recoRunning,
  onReco,
  qqQuality,
  onChangeQuality,
  loggedIn,
  loggingIn,
  accountName,
  onLogin,
  onAccount,
  onReset,
  likedCount,
  onOpenLiked,
  onOpenSettings,
}: Props) {
  const showQuality =
    (provider === 'qq' || provider === 'netease') && loggedIn;

  return (
    <div className="titlebar">
      <SourceMenu provider={provider} onSelect={onSwitchProvider} />

      {provider === 'deezer' && deezerEditorials.length > 0 && (
        <DeezerPresetSelect
          editorials={deezerEditorials}
          value={deezerPreset}
          onChange={onChangeDeezerPreset}
        />
      )}

      <button
        className="titlebar-btn search-btn"
        onClick={onOpenSearch}
        title="搜索歌手 / 歌名（跨平台统一搜索）"
      >
        🔍 搜索
      </button>

      <button
        className="titlebar-btn reco-btn"
        onClick={onReco}
        disabled={recoRunning}
        title={
          recoStatus?.configured
            ? '基于你的统一库推荐新歌'
            : '设置 DeepSeek API key 后基于你的统一库推荐新歌'
        }
      >
        {recoRunning ? '…' : '🎲 推荐'}
        {recoStatus && !recoStatus.configured && (
          <span className="reco-key-dot" aria-hidden="true" />
        )}
      </button>

      <button
        className="titlebar-btn liked-btn"
        onClick={onOpenLiked}
        title="查看所有平台已 ❤ 的歌曲"
      >
        ❤
        {likedCount > 0 && (
          <span className="liked-count-badge" aria-label={`共 ${likedCount} 首`}>
            {likedCount > 999 ? '999+' : likedCount}
          </span>
        )}
      </button>

      {showQuality && (
        <QualityMenu quality={qqQuality} onSelect={onChangeQuality} />
      )}

      {loggedIn ? null : (
        <button
          className="titlebar-btn login-btn"
          onClick={onLogin}
          disabled={loggingIn}
        >
          {loggingIn ? '登录中…' : '登录'}
        </button>
      )}

      {loggedIn && (
        <button
          className="titlebar-btn account-btn"
          onClick={onAccount}
          title={provider === 'deezer' ? '切换音源' : '退出登录'}
        >
          {accountName || 'User'}
        </button>
      )}

      <button
        className="titlebar-btn settings-btn-icon"
        onClick={onOpenSettings}
        title="设置 · 备份 / 导出 / 导入会话快照"
      >
        ⚙
      </button>

      <button
        className="titlebar-btn reset-btn"
        onClick={onReset}
        title="清空本地缓存（localStorage + sessionStorage + 当前曲目）"
      >
        ↺
      </button>
    </div>
  );
}
```

---

## SourceMenu — `components/layout/SourceMenu.tsx`

Source-switch pill + its dropdown (used inside the Titlebar). Owns its own open state; a transparent fixed backdrop catches outside clicks. Four selectable providers: qq / netease / deezer / spotify.

```tsx
import { useState } from 'react';
import { PROVIDER_LABELS } from '../../api';
import type { MusicProvider } from '../../api';

interface Props {
  provider: MusicProvider;
  onSelect: (next: MusicProvider) => void;
}

const SELECTABLE: MusicProvider[] = ['qq', 'netease', 'deezer', 'spotify'];

/** Source-switch pill + its dropdown. Owns its own open state; a transparent
 *  fixed backdrop catches outside clicks without interrupting playback. */
export default function SourceMenu({ provider, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="source-switch-wrap">
      <button
        className="titlebar-btn source-switch"
        onClick={() => setOpen((v) => !v)}
        title="切换音源"
      >
        {PROVIDER_LABELS[provider]}
        <span className="source-switch-icon">⇄</span>
      </button>

      {open && (
        <>
          <div className="source-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="source-menu" role="menu">
            {SELECTABLE.map((p) => (
              <button
                key={p}
                className={`source-menu-item${
                  p === provider ? ' source-menu-item--active' : ''
                }`}
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                }}
                role="menuitem"
              >
                <span className="source-menu-check">{p === provider ? '✓' : ''}</span>
                <span className="source-menu-label">{PROVIDER_LABELS[p]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

---

## QualityMenu — `components/layout/QualityMenu.tsx`

Stream-quality picker (QQ / NetEase), shown in the Titlebar only when logged in on those platforms. Right-aligned dropdown (`source-menu--right`) so it doesn't overflow the window edge. Owns its own open state.

```tsx
import { useState } from 'react';
import { QQ_QUALITY_LABELS } from '../../api';
import type { QqQuality } from '../../api';

interface Props {
  quality: QqQuality;
  onSelect: (q: QqQuality) => void;
}

const QUALITIES: QqQuality[] = ['standard', 'high', 'lossless'];

/** Stream-quality picker (QQ / NetEase). Right-aligned dropdown so it doesn't
 *  overflow the window edge. Owns its own open state. */
export default function QualityMenu({ quality, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="quality-wrap">
      <button
        className="titlebar-btn"
        onClick={() => setOpen((v) => !v)}
        title="音质（无损需会员）"
      >
        {QQ_QUALITY_LABELS[quality]}
      </button>
      {open && (
        <>
          <div className="source-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="source-menu source-menu--right" role="menu">
            {QUALITIES.map((q) => (
              <button
                key={q}
                className={`source-menu-item${
                  q === quality ? ' source-menu-item--active' : ''
                }`}
                onClick={() => {
                  onSelect(q);
                  setOpen(false);
                }}
                role="menuitem"
              >
                <span className="source-menu-check">{q === quality ? '✓' : ''}</span>
                <span className="source-menu-label">{QQ_QUALITY_LABELS[q]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

---

## DeezerPresetSelect — `components/layout/DeezerPresetSelect.tsx`

Deezer editorial (chart) picker, shown in the Titlebar only for the Deezer source. Maps display names to preset codes; unknown names fall back to `'all'`.

```tsx
import type { DeezerEditorial } from '../../api';

interface Props {
  editorials: DeezerEditorial[];
  value: string;
  onChange: (preset: string) => void;
}

/** Map a Deezer editorial's display name to its preset code (the value the
 *  radio endpoint expects). Unknown names fall back to 'all'. */
const PRESET_CODES: Record<string, string> = {
  All: 'all',
  亚洲流行: 'asia',
  国际流行: 'pop',
  说唱: 'rap',
  摇滚: 'rock',
  舞曲: 'dance',
  'R&B': 'rnb',
  古典: 'classical',
  爵士: 'jazz',
};

function presetCode(name: string): string {
  return PRESET_CODES[name] ?? 'all';
}

/** Deezer editorial (chart) picker, shown only for the Deezer source. */
export default function DeezerPresetSelect({ editorials, value, onChange }: Props) {
  return (
    <select
      className="preset-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Deezer 榜单"
    >
      {editorials.map((e) => (
        <option key={e.id} value={presetCode(e.name)}>
          {e.name}
          {e.region ? ` · ${e.region}` : ''}
        </option>
      ))}
    </select>
  );
}
```

---

## SourceSelect — `components/source-select/SourceSelect.tsx`

First-run source picker — the full-window screen shown when no provider is set. Centred card list (NetEase / QQ / Deezer / Spotify) with per-platform brand-coloured logo tiles. Spotify card's description adapts to the user's tier fetched from `getSpotifyStatus()`.

```tsx
import { useEffect, useState } from 'react';
import type { MusicProvider } from '../../api';
import { getSpotifyStatus } from '../../api';

interface SourceSelectProps {
  onSelect: (provider: MusicProvider) => void;
}

interface SourceDef {
  provider: MusicProvider;
  name: string;
  /** Static desc shown when we have no Spotify status. */
  baseDesc: string;
  /** Optional desc variant, keyed by Spotify tier. */
  spotifyVariants?: Partial<Record<'premium' | 'free' | 'open' | 'unknown', string>>;
  className: string;
  initial: string;
  /** Disabled sources still render but can't be clicked. */
  disabled?: boolean;
  disabledReason?: string;
}

const SOURCES: SourceDef[] = [
  {
    provider: 'netease',
    name: '网易云音乐',
    baseDesc: '私人 FM 电台 · 手机扫码登录',
    className: 'source-netease',
    initial: '云',
  },
  {
    provider: 'qq',
    name: 'QQ 音乐',
    baseDesc: '登录后可搜索 + 播全曲（桌面扫码登录）',
    className: 'source-qq',
    initial: 'Q',
  },
  {
    provider: 'deezer',
    name: 'Deezer',
    baseDesc: '国际公开电台 · 30s 预览 · 无需登录',
    className: 'source-deezer',
    initial: 'D',
  },
  {
    provider: 'spotify',
    name: 'Spotify',
    baseDesc: '国际曲库 · 30s 预览 · 需 OAuth 登录',
    spotifyVariants: {
      premium: '国际曲库 · 全曲播放（Premium）',
      free: '国际曲库 · 30s 预览 · 需 OAuth 登录',
      open: '国际曲库 · 30s 预览 · 需 OAuth 登录',
      unknown: '国际曲库 · 30s 预览 · 需 OAuth 登录',
    },
    className: 'source-spotify',
    initial: 'S',
  },
];

export default function SourceSelect({ onSelect }: SourceSelectProps) {
  // Spotify tier drives the desc on its card. Default to "unknown" — when
  // the user just opens the app and the status fetch is still pending, we
  // fall back to the conservative "30s 预览" wording.
  const [spotifyTier, setSpotifyTier] = useState<
    'premium' | 'free' | 'open' | 'unknown'
  >('unknown');
  useEffect(() => {
    void getSpotifyStatus()
      .then((s) => {
        if (s.loggedIn && s.tier) setSpotifyTier(s.tier);
      })
      .catch(() => {
        // ignore — keep "unknown" / 30s 预览 wording
      });
  }, []);

  return (
    <div className="source-select">
      <div className="source-titlebar" />
      <div className="source-heading">
        <div className="source-title">选择音乐来源</div>
        <div className="source-subtitle">挑一个音源，开始你的电台</div>
      </div>
      <div className="source-list">
        {SOURCES.map((s) => {
          const desc =
            s.provider === 'spotify' && s.spotifyVariants
              ? s.spotifyVariants[spotifyTier]
              : s.baseDesc;
          return (
            <button
              key={s.provider}
              className={`source-card ${s.className}${s.disabled ? ' source-card-disabled' : ''}`}
              onClick={() => {
                if (s.disabled) return;
                onSelect(s.provider);
              }}
              disabled={s.disabled}
              title={s.disabledReason ?? ''}
            >
              <div className="source-logo">{s.initial}</div>
              <div className="source-meta">
                <div className="source-name">{s.name}</div>
                <div className="source-desc">{desc}</div>
              </div>
              <svg
                className="source-arrow"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
              >
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```
