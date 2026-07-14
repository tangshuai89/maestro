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

