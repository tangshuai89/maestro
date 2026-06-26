import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchNextTrack,
  toggleLike,
  getAuthStatus,
  getLoginUrl,
  logout,
  PROVIDER_LABELS,
} from './api';
import type { Track, AuthStatus, MusicProvider } from './api';
import SourceSelect from './SourceSelect';
import './App.css';

const PROVIDER_STORAGE_KEY = 'music-provider';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function readStoredProvider(): MusicProvider | null {
  const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
  return stored === 'qq' || stored === 'netease' ? stored : null;
}

export default function App() {
  const [provider, setProvider] = useState<MusicProvider | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const fromCallback = params.get('provider');
    if (fromCallback === 'qq' || fromCallback === 'netease') {
      return fromCallback;
    }
    return readStoredProvider();
  });
  const [track, setTrack] = useState<Track | null>(null);
  const [auth, setAuth] = useState<AuthStatus>({
    provider: 'qq',
    loggedIn: false,
    user: null,
  });
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Check auth on mount and when returning from OAuth
  useEffect(() => {
    if (!provider) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('nickname')) {
      setAuth({
        provider,
        loggedIn: true,
        user: {
          nickname: params.get('nickname') || '',
          avatarUrl: '',
          openId: params.get('openId') || '',
        },
      });
      window.history.replaceState({}, '', '/');
    } else {
      getAuthStatus(provider).then(setAuth).catch(() => {});
    }
  }, [provider]);

  const loadNextTrack = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const nextTrack = await fetchNextTrack(provider);
      setTrack(nextTrack);
      setCurrentTime(0);
      setPlaying(true);
    } catch {
      console.error('Failed to load track');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  // Auto-load first track whenever the provider changes
  useEffect(() => {
    if (!provider) return;
    loadNextTrack();
  }, [provider, loadNextTrack]);

  // Audio element event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => loadNextTrack();
    const onCanPlay = () => {
      if (playing) {
        audio.play().catch(() => {});
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('canplay', onCanPlay);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [playing, loadNextTrack]);

  // Sync play/pause state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (playing) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, track]);

  const handleSelectSource = (next: MusicProvider) => {
    localStorage.setItem(PROVIDER_STORAGE_KEY, next);
    setProvider(next);
  };

  const handleSwitchSource = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setTrack(null);
    setCurrentTime(0);
    setDuration(0);
    setAuth({ provider: 'qq', loggedIn: false, user: null });
    localStorage.removeItem(PROVIDER_STORAGE_KEY);
    setProvider(null);
  };

  const handlePlayPause = () => {
    setPlaying((p) => !p);
  };

  const handleSkip = () => {
    loadNextTrack();
  };

  const handleLike = async () => {
    if (!track || !provider) return;
    const result = await toggleLike(provider, track.id);
    if (result.success) {
      setTrack((prev) => (prev ? { ...prev, liked: result.liked } : prev));
    }
  };

  const handleLogin = () => {
    if (!provider) return;
    window.location.href = getLoginUrl(provider);
  };

  const handleLogout = async () => {
    if (!provider) return;
    await logout(provider);
    setAuth({ provider, loggedIn: false, user: null });
  };

  if (!provider) {
    return <SourceSelect onSelect={handleSelectSource} />;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="app">
      {/* Title bar area for dragging */}
      <div className="titlebar">
        <button
          className="titlebar-text source-switch"
          onClick={handleSwitchSource}
          title="切换音源"
        >
          {PROVIDER_LABELS[provider]}
          <span className="source-switch-icon">⇄</span>
        </button>
        <div className="titlebar-auth">
          {auth.loggedIn ? (
            <button className="auth-btn" onClick={handleLogout} title="退出登录">
              {auth.user?.nickname || 'User'}
            </button>
          ) : (
            <button className="auth-btn login-btn" onClick={handleLogin}>
              登录
            </button>
          )}
        </div>
      </div>

      {/* Album cover */}
      <div className="cover-container">
        {track?.coverUrl ? (
          <img
            className={`cover-image ${playing ? 'spinning' : ''}`}
            src={track.coverUrl}
            alt={track.album}
          />
        ) : (
          <div className={`cover-placeholder ${playing ? 'spinning' : ''}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}
      </div>

      {/* Track info */}
      <div className="track-info">
        <div className="track-title">{track?.title || '...'}</div>
        <div className="track-artist">
          {track ? `${track.artist} · ${track.album}` : '正在加载'}
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-time">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <button
          className={`control-btn like-btn ${track?.liked ? 'liked' : ''}`}
          onClick={handleLike}
          disabled={!track}
          title="红心"
        >
          <svg viewBox="0 0 24 24" width="22" height="22">
            {track?.liked ? (
              <path
                fill="currentColor"
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              />
            ) : (
              <path
                fill="currentColor"
                d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"
              />
            )}
          </svg>
        </button>

        <button
          className="control-btn play-btn"
          onClick={handlePlayPause}
          disabled={!track || loading}
          title={playing ? '暂停' : '播放'}
        >
          {loading ? (
            <svg className="spinner" viewBox="0 0 24 24" width="28" height="28">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeDasharray="31.4 31.4"
              />
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
          onClick={handleSkip}
          disabled={loading}
          title="下一首"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      {/* Hidden audio element */}
      {track && <audio ref={audioRef} src={track.audioUrl} preload="auto" />}
    </div>
  );
}
