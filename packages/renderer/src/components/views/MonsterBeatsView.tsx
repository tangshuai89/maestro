import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Track, LyricLine, LyricsSource, MusicProvider, QqQuality } from '../../api';
import { PROVIDER_LABELS } from '../../api';

export interface MonsterBeatsViewProps {
  // ── player core ─────────────────────────────────────────────
  track: Track | null;
  playing: boolean;
  loading: boolean;
  liked: boolean;
  fanOutCount: number;
  currentTime: number;
  duration: number;
  provider: MusicProvider;
  qqQuality: QqQuality;
  trialFellBack?: boolean;
  accountName: string;
  likedCount: number;
  // cover art backdrop (same ref pattern the original CoverCard used —
  // useCoverArt writes background-image into it)
  coverBackdropRef: RefObject<HTMLDivElement>;
  // ── lyrics ───────────────────────────────────────────────────
  lyrics: LyricLine[] | null;
  lyricsSynced: boolean;
  lyricsSource: LyricsSource | null;
  // ── reco / DeepSeek ──────────────────────────────────────────
  recoConfigured: boolean;
  recoLibrarySize: number;
  recoRunning: boolean;
  recoMatchRate: number; // 0-100, derived from reco status / library size
  recoSuggestions: { title: string; artist: string; coverColor: string; type: string; match: number }[];
  // ── transport callbacks ──────────────────────────────────────
  onPlayPause: () => void;
  onSkip: () => void;
  onPrev: () => void;
  onLike: () => void;
  onDislike: () => void;
  onSeek: (seconds: number) => void;
  onOpenLiked: () => void;
  onSwitchProvider: () => void;
}

// ── helpers ──────────────────────────────────────────────────

/** Seeded small int from a string — keeps a track's "stats" stable across renders. */
function seededFromString(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619;
    h = h + ((h << 15) | 0) + ((h << 13) | 0) - (h << 6);
  }
  return Math.abs(h | 0);
}

/** Derive a "creature card" stat block from the track. */
function deriveStats(track: Track | null) {
  if (!track) {
    return { hp: 0, atk: 0, def: 0, spd: 0, level: 42, year: 2001 };
  }
  const seed = `${track.id}::${track.provider}`;
  // HP 跟时长挂钩：3 分钟 = 3000 HP
  const hp = Math.max(800, Math.round(track.duration * 10) + (seededFromString(seed, 1) % 1500));
  // ATK 跟标题长度挂钩，DEF 跟艺术家长度挂钩，SPD 随机
  const atk = 600 + ((track.title.length * 47 + seededFromString(seed, 2)) % 600);
  const def = 600 + ((track.artist.length * 53 + seededFromString(seed, 3)) % 700);
  const spd = 60 + (seededFromString(seed, 4) % 80);
  // Level from year (between 1-99)
  const yr = parseInt(track.album?.match(/\d{4}/)?.[0] ?? '2001', 10) || 2001;
  const level = ((yr - 1950) % 99) + 1;
  return { hp, atk, def, spd, level, year: yr };
}

const TYPE_COLORS: Record<string, { bg: string; fg: string; label: string; edge: string }> = {
  wild: { bg: '#FFD60A', fg: '#0A1F3C', label: 'WILD', edge: '#FFD60A' },
  fire: { bg: '#FF3B3B', fg: '#FFFFFF', label: 'FIRE', edge: '#FF3B3B' },
  water: { bg: '#2D7FFF', fg: '#FFFFFF', label: 'WATER', edge: '#2D7FFF' },
  grass: { bg: '#4CD964', fg: '#0A1F3C', label: 'GRASS', edge: '#4CD964' },
  electric: { bg: '#FFD60A', fg: '#0A1F3C', label: 'ELEC', edge: '#FFD60A' },
  // 终极：wildcard — 彩虹渐变描边
  ultra: { bg: '#FFFFFF', fg: '#0A1F3C', label: 'ULTRA-ELEMENTAL', edge: 'linear-gradient(90deg, #FF3B3B 25%, #FFD60A 25% 50%, #4CD964 50% 75%, #2D7FFF 75%)' },
};

const PROVIDER_BADGE: Record<MusicProvider, { letter: string; color: string; name: string }> = {
  qq: { letter: 'Q', color: '#FFD60A', name: 'QQ 音乐' },
  netease: { letter: 'N', color: '#FF3B3B', name: '网易云' },
  deezer: { letter: 'D', color: '#2D7FFF', name: 'Deezer' },
  spotify: { letter: 'S', color: '#4CD964', name: 'Spotify' },
};

const PROVIDER_HEART_DEFAULT: Record<MusicProvider, number> = {
  qq: 1248,
  netease: 842,
  deezer: 0, // not connected
  spotify: 3102,
};

/** Pick a fake "element type" from the track provider for the creature card. */
function pickType(track: Track | null): keyof typeof TYPE_COLORS {
  if (!track) return 'wild';
  const map: Record<MusicProvider, keyof typeof TYPE_COLORS> = {
    qq: 'fire',
    netease: 'grass',
    deezer: 'water',
    spotify: 'electric',
  };
  return map[track.provider] ?? 'wild';
}

/** Find the current lyric line (the one whose time just passed). */
function activeLineIndex(lines: LyricLine[] | null, t: number): number {
  if (!lines || lines.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t + 0.05) idx = i;
    else break;
  }
  return idx;
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

// ── icons (lucide-style inline SVG, no CDN) ─────────────────

const ICON_PATHS: Record<string, string[]> = {
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z'],
  zap: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
  swords: ['M14.5 17.5 3 6V3h3l11.5 11.5', 'M13 19l6-6', 'M16 16l4 4', 'M19 21l2-2'],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
  briefcase: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M18 8h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h4'],
  star: ['M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'],
  play: ['M8 5v14l11-7z'],
  pause: ['M6 19h4V5H6v14zm8-14v14h4V5h-4z'],
  skipBack: ['M19 20 9 12l10-8z', 'M5 19V5'],
  skipForward: ['M5 4l10 8-10 8z', 'M19 5v14'],
  shuffle: ['M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22', 'm18 2 4 4-4 4', 'M2 6h1.9c1.5 0 2.9.9 3.6 2.2', 'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8', 'm18 14 4 4-4 4'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  check: ['M20 6 9 17l-5-5'],
  chevronRight: ['m9 18 6-6-6-6'],
  music: ['M9 18V5l12-2v13', 'M9 9l12-2'],
};

function MbIcon({ icon, size = 16, color, fill }: { icon: string; size?: number; color?: string; fill?: boolean }) {
  const paths = ICON_PATHS[icon] ?? [];
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
      color={color}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** 本地生成的机器人头像（近似 dicebear bottts，离线可用）。 */
function BotAvatar({ seed, size = 56, active }: { seed: string; size?: number; active?: boolean }) {
  const hue = seededFromString(seed, 7) % 360;
  const body = `hsl(${hue} 60% 88%)`;
  const edge = `hsl(${hue} 60% 45%)`;
  const antenna = `hsl(${(hue + 60) % 360} 70% 55%)`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="mb-bot">
      <line x1="32" y1="16" x2="32" y2="7" stroke={edge} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="5" r="4" fill={antenna} stroke={edge} strokeWidth="1.5" />
      <rect x="8" y="14" width="48" height="42" rx="11" fill={body} stroke={edge} strokeWidth="3" />
      <rect x="16" y="22" width="32" height="12" rx="6" fill={edge} opacity="0.25" />
      <circle cx="23" cy="34" r="5" fill="#0A1F3C" />
      <circle cx="41" cy="34" r="5" fill="#0A1F3C" />
      {active && <circle cx="25" cy="36" r="1.8" fill="#fff" />}
      {active && <circle cx="43" cy="36" r="1.8" fill="#fff" />}
      <path d="M24 46 q8 6 16 0" stroke={edge} strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ── component ────────────────────────────────────────────────

export default function MonsterBeatsView(props: MonsterBeatsViewProps) {
  const {
    track, playing, loading, liked, fanOutCount,
    currentTime, duration,
    provider, qqQuality, trialFellBack, accountName, likedCount,
    coverBackdropRef,
    lyrics, lyricsSource,
    recoConfigured, recoLibrarySize, recoMatchRate, recoSuggestions,
    onPlayPause, onSkip, onPrev, onLike, onDislike, onSeek,
    onOpenLiked, onSwitchProvider,
  } = props;

  const stats = useMemo(() => deriveStats(track), [track]);
  const cardType = useMemo(() => pickType(track), [track]);
  const activeLine = useMemo(() => activeLineIndex(lyrics, currentTime), [lyrics, currentTime]);
  const currentLine = activeLine >= 0 ? lyrics?.[activeLine]?.text : null;
  const nextLine = activeLine + 1 < (lyrics?.length ?? 0) ? lyrics?.[activeLine + 1]?.text : null;
  const prevLine = activeLine - 1 >= 0 ? lyrics?.[activeLine - 1]?.text : null;

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const [stageScale, setStageScale] = useState(1);
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight - 110; // 顶栏（40 Titlebar + 70 设计条）
      setStageScale(Math.min(Math.max(Math.min(w / 1440, h / 900), 0.4), 1.15));
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // 顶栏 HUD 四条：❤=跨平台红心 / ⚡=播放进度 / 🗡=战斗能量 / 🛡=同步完成
  const hudHeartPct = fanOutCount > 0 ? Math.min(100, fanOutCount * 25) : 8;
  const hudZapPct = progressPct;
  const hudSwordPct = loading ? 30 : track ? 40 + (seededFromString(track.id, 11) % 60) : 0;
  const hudShieldPct = 80;

  return (
    <div className="mb-root">
      {/* 全屏装饰：sparkles + scanlines + 渐变背景（不随舞台缩放） */}
      <span className="mb-sparkle" style={{ top: '15%', left: '10%', animationDelay: '0.2s' }} aria-hidden="true" />
      <span className="mb-sparkle" style={{ top: '25%', left: '85%', animationDelay: '0.8s' }} aria-hidden="true" />
      <span className="mb-sparkle" style={{ top: '62%', left: '42%', animationDelay: '1.5s' }} aria-hidden="true" />
      <span className="mb-sparkle" style={{ top: '82%', left: '18%', animationDelay: '2.1s' }} aria-hidden="true" />
      {/* ── TOP STRIP ───────────────────────────────────────── */}
      <div className="mb-top-strip">
        <div className="mb-radar" aria-label="radar">
          <div className="mb-radar-ring mb-radar-ring--1" />
          <div className="mb-radar-ring mb-radar-ring--2" />
          <div className="mb-radar-ring mb-radar-ring--3" />
          <div className="mb-radar-sweep" />
          <div className="mb-radar-blip" />
          <span className="mb-radar-label">YOU</span>
        </div>

        <div className="mb-hud-stats" aria-label="player stats">
          <HUDStat icon="heart" color="#FF3B3B" pct={hudHeartPct} label="跨平台红心" />
          <HUDStat icon="zap" color="#2D7FFF" pct={hudZapPct} label="播放进度" />
          <HUDStat icon="swords" color="#FFD60A" pct={hudSwordPct} label="战斗能量" />
          <HUDStat icon="shield" color="#4CD964" pct={hudShieldPct} label="同步完成度" />
        </div>

        <div className="mb-top-right">
          <div className="mb-sync-bar" title="跨平台同步进度">
            <span className="mb-sync-bar-text">Syncing {fanOutCount}/4</span>
            <div className="mb-sync-bar-track">
              <div className="mb-sync-bar-fill" style={{ width: `${hudShieldPct}%` }} />
              <span className="mb-sync-ball mb-sync-ball--start" />
              <span className="mb-sync-ball mb-sync-ball--end" />
            </div>
          </div>
          <div className="mb-bag" title="红心收藏">
            <MbIcon icon="briefcase" size={16} color="#FFD60A" />
            <span className="mb-bag-count">{likedCount > 0 ? likedCount : fanOutCount}</span>
            <MbIcon icon="star" size={12} color="#FFD60A" fill />
          </div>
        </div>
      </div>
      <div className="mb-stage" style={{ ['--mb-scale' as string]: String(stageScale) }}>

      {/* ── TOP-RIGHT: 4 大 source badges（独立于顶部条） ─────── */}
      <div className="mb-source-badges" aria-label="跨平台接入">
        {(['qq', 'netease', 'deezer', 'spotify'] as MusicProvider[]).map((p) => {
          const meta = PROVIDER_BADGE[p];
          const isActive = provider === p;
          const heartCount = isActive
            ? Math.max(fanOutCount * 312, PROVIDER_HEART_DEFAULT[p])
            : PROVIDER_HEART_DEFAULT[p];
          return (
            <button
              key={p}
              type="button"
              className={`mb-source-badge${isActive ? ' is-active' : ''}`}
              style={{ ['--badge-color' as string]: meta.color }}
              title={`${meta.name} · ♥ ${heartCount.toLocaleString()}`}
            >
              {p === 'qq' && <span className="mb-source-badge-star"><MbIcon icon="star" size={12} color="#0A1F3C" fill /></span>}
              <span className="mb-source-badge-letter">{meta.letter}</span>
              <span className="mb-source-badge-heart">
                <MbIcon icon="heart" size={8} color="#fff" fill />
                {(heartCount / 1000).toFixed(1)}k
              </span>
            </button>
          );
        })}
      </div>

      {/* ── LEFT: LEGENDARY CREATURE CARD (absolute, -3° rotation) ── */}
      <div className="mb-creature-card" key={track?.id ?? 'empty'}>
        <div className="mb-creature-banner">LEGENDARY CREATURE</div>
        <div className="mb-creature-art">
          <div
            className="mb-creature-art-img"
            ref={coverBackdropRef}
            onError={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundImage = 'none'; }}
          />
          {!track?.coverUrl && <div className="mb-creature-art-placeholder">♪</div>}
          <div className="mb-creature-art-shine" aria-hidden="true" />
          <div className="mb-creature-art-holo" aria-hidden="true" />
        </div>
        <div className="mb-creature-nameplate">
          <div className="mb-creature-name-block">
            <span className="mb-creature-name">
              {track?.title || '未在播放'}
            </span>
            {track?.album && (
              <span className="mb-creature-album">ALBUM: {track.album.toUpperCase()}</span>
            )}
          </div>
          <span className="mb-creature-name-star"><MbIcon icon="star" size={16} color="#FFD60A" fill /></span>
        </div>
        <div className="mb-creature-stats">
          <CreatureStat label="HP"  value={stats.hp}  max={6000} color="#FF3B3B" />
          <CreatureStat label="ATK" value={stats.atk} max={2000} color="#FFD60A" />
          <CreatureStat label="DEF" value={stats.def} max={2000} color="#2D7FFF" />
          <CreatureStat label="SPD" value={stats.spd} max={200}  color="#4CD964" />
        </div>
        <div className="mb-creature-type">
          <span
            className="mb-creature-type-badge"
            style={{ ['--type-edge' as string]: TYPE_COLORS[cardType].edge, ['--type-fg' as string]: TYPE_COLORS[cardType].fg }}
          >
            {TYPE_COLORS[cardType].label}
          </span>
        </div>
      </div>

      {/* ── RIGHT: BATTLE DIALOG (absolute) ──────────────────── */}
      <div className="mb-battle-dialog">
        <div className="mb-battle-status">
          <div className="mb-battle-status-left">
            <span className="mb-battle-status-item dim">LV.{stats.level}</span>
            <span className="mb-battle-status-item">YEAR: {stats.year}</span>
            <span className="mb-battle-status-item">TYPE: {TYPE_COLORS[cardType].label}</span>
            <span className="mb-battle-status-item dim">SOURCE: {PROVIDER_LABELS[provider]}</span>
            <span className="mb-battle-status-item dim">{qqQuality.toUpperCase()} {trialFellBack ? '(TRIAL)' : ''}</span>
          </div>
          <div className="mb-battle-dots" aria-hidden="true">
            <span className="mb-battle-dot mb-battle-dot--red" />
            <span className="mb-battle-dot mb-battle-dot--yellow" />
            <span className="mb-battle-dot mb-battle-dot--green" />
          </div>
        </div>
        <div className="mb-battle-body">
          <div className="mb-speaker-portrait">
            <MbIcon icon="music" size={36} color="#FF3B3B" />
          </div>
          <div className="mb-battle-text">
            <div className="mb-battle-line mb-battle-line--prev">
              {prevLine || '　'}
            </div>
            <div className="mb-battle-line mb-battle-line--current">
              <span className="mb-battle-cursor">▶</span>
              {currentLine || (loading ? '正在搜寻猎物…' : '点击播放来开始')}
            </div>
            <div className="mb-battle-line mb-battle-line--next">
              {nextLine || '　'}
            </div>
            {lyricsSource && (
              <div className="mb-battle-source">
                来源 {lyricsSource === 'lyricsovh' ? 'lyrics.ovh' : PROVIDER_LABELS[lyricsSource]}
              </div>
            )}
            <div className="mb-battle-account">
              {accountName} · 跨平台红心 {fanOutCount}/4
            </div>
          </div>
        </div>
        <button
          type="button"
          className="mb-battle-next"
          onClick={onSkip}
          disabled={!track}
          title="下一首"
        >
          NEXT <MbIcon icon="chevronRight" size={18} color="#fff" />
        </button>
      </div>

      {/* ── BOTTOM-LEFT: DEEPSEEK ENCOUNTER LOG (absolute) ──────── */}
      <div className="mb-encounter">
        <div className="mb-encounter-banner">
          <span className="mb-encounter-banner-prefix">#</span>092
          <span className="mb-encounter-banner-sep">·</span>
          DEEP.SEEK
          <span className="mb-encounter-banner-sep">·</span>
          ENCOUNTER LOG
        </div>
        <div className="mb-encounter-grid">
          {recoSuggestions.slice(0, 3).map((s, i) => (
            <div
              key={i}
              className={`mb-mini-card${i === 1 ? ' is-active' : ''}`}
              style={{ ['--card-color' as string]: s.coverColor }}
            >
              <div className="mb-mini-card-creature">
                <BotAvatar seed={`${s.title}::${i}`} size={64} active={i === 1} />
              </div>
              <div className="mb-mini-card-type">{s.type}</div>
              <div className="mb-mini-card-name">{s.title}</div>
              <div className="mb-mini-card-match">{s.match}% MATCH</div>
              {i === 1 && (
                <span className="mb-mini-card-check"><MbIcon icon="check" size={12} color="#0A1F3C" /></span>
              )}
            </div>
          ))}
          {recoSuggestions.length === 0 && (
            <div className="mb-encounter-empty">
              {recoConfigured
                ? `已根据 ${recoLibrarySize} 首库内歌曲生成推荐`
                : '配置 DEEPSEEK KEY 后开启 AI 推荐'}
            </div>
          )}
        </div>
        <div className="mb-encounter-foot">
          「{recoConfigured ? 'AI 评估：' + recoMatchRate + '% MATCH' : 'ENCOUNTER PENDING'}」
        </div>
      </div>

      {/* ── BOTTOM-RIGHT: BATTLE MENU — 左2×2 + 中▶ + 右2×2 ────── */}
      <div className="mb-battle-menu">
        <div className="mb-menu-col">
          <button type="button" className="mb-menu-btn mb-menu-btn--red" onClick={onDislike} disabled={!track} title="不感兴趣（踩）">
            FIGHT
          </button>
          <button
            type="button"
            className={`mb-menu-btn mb-menu-btn--yellow${liked ? ' is-on' : ''}`}
            onClick={onLike}
            disabled={!track}
            title="红心收藏"
          >
            {liked ? '♥ BAG' : 'BAG'}
          </button>
          <button type="button" className="mb-menu-btn mb-menu-btn--green" onClick={onOpenLiked} title="我的喜欢库">
            PKMN
          </button>
          <button type="button" className="mb-menu-btn mb-menu-btn--blue" onClick={onSwitchProvider} title="切换来源">
            RUN
          </button>
        </div>

        <button
          type="button"
          className="mb-mega-play"
          onClick={onPlayPause}
          disabled={!track || loading}
          title={playing ? '暂停' : '播放'}
        >
          {loading ? (
            <span className="mb-mega-play-spinner">…</span>
          ) : playing ? (
            <MbIcon icon="pause" size={36} color="#fff" fill />
          ) : (
            <MbIcon icon="play" size={36} color="#fff" fill />
          )}
        </button>

        <div className="mb-menu-col">
          <button type="button" className="mb-menu-btn mb-menu-btn--pink" onClick={onPrev} disabled={!track} title="上一首">
            <MbIcon icon="skipBack" size={22} color="#fff" />
          </button>
          <button type="button" className="mb-menu-btn mb-menu-btn--pink" onClick={onSkip} disabled={!track} title="下一首">
            <MbIcon icon="skipForward" size={22} color="#fff" />
          </button>
          <button type="button" className="mb-menu-btn mb-menu-btn--white" disabled title="随机播放（待实现）">
            <MbIcon icon="shuffle" size={20} color="#0A1F3C" />
          </button>
          <button type="button" className="mb-menu-btn mb-menu-btn--white" disabled title="循环播放（待实现）">
            <MbIcon icon="repeat" size={20} color="#0A1F3C" />
          </button>
        </div>
      </div>

      {/* ── BOTTOM: PROGRESS BAR (absolute) ─────────────────────── */}
      <div className="mb-progress">
        <span className="mb-progress-time">{fmtTime(currentTime)}</span>
        <div
          className="mb-progress-track"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const pct = (e.clientX - r.left) / r.width;
            onSeek(Math.max(0, Math.min(1, pct)) * duration);
          }}
        >
          <div className="mb-progress-fill" style={{ width: `${progressPct}%` }} />
          <div className="mb-progress-handle" style={{ left: `${progressPct}%` }} />
        </div>
        <span className="mb-progress-time">{fmtTime(duration)}</span>
      </div>

      </div>
      {/* ── BOTTOM: RAINBOW STRIP（全宽，不缩放） ─────────── */}
      <div className="mb-bottom-rainbow" aria-hidden="true" />
    </div>
  );
}

// ── subcomponents ────────────────────────────────────────────

function HUDStat({ icon, color, pct, label }: { icon: string; color: string; pct: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="mb-hud-stat" title={`${label} ${Math.round(clamped)}%`}>
      <span className="mb-hud-stat-icon" style={{ background: color }}>
        <MbIcon icon={icon} size={12} color="#fff" fill={icon === 'heart' || icon === 'star'} />
      </span>
      <div className="mb-hud-stat-track">
        <div className="mb-hud-stat-fill" style={{ width: `${clamped}%`, background: color }} />
      </div>
    </div>
  );
}

function CreatureStat({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-creature-stat">
      <div className="mb-creature-stat-label">{label}</div>
      <div className="mb-creature-stat-track">
        <div className="mb-creature-stat-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mb-creature-stat-value" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
