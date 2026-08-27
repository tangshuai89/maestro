import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Track, LyricLine, LyricsSource, MusicProvider, QqQuality } from '../../api';

/**
 * AETHER THEATER — 宇宙剧场主视图（v4 设计稿落地）。
 *
 * 设计语言（对应 Figma frame "AETHER THEATER — 宇宙剧场"）：
 *  - 深空黑径向渐变背景 + 3 团交错星云（电紫/霓虹青/酸紫）+ 星尘粒子 + 地平线
 *  - 悬浮全息封面（圆形渐变星球 + 轨道环 + LIVE 标签 + 发光）
 *  - 歌词文字流（当前行巨大发光 + 前后行渐隐）
 *  - 能量核心播放键（径向渐变 + 双层辉光 + 播放/暂停切换）
 *  - 星轨进度环（环形轨道 + 青色弧线 + 光点 + 时间）
 *  - DeepSeek 推荐（3 张渐变玻璃卡）
 *  - 顶部 HUD（协议条 + 平台徽章 + 状态读数）
 *
 * 动效（CSS 实现，对应 Figma Smart Animate 循环）：
 *  - 星尘漂移（stardust drift）
 *  - 声波环脉冲（sound-ring pulse）
 *  - 歌词推进（当前行切换 + 指示条跟随）
 *  - 进度弧增长（弧线随 currentTime 生长）
 *  - 播放键状态切换（▶/⏸ + 核心辉光呼吸）
 */

export interface TheaterViewProps {
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
  coverBackdropRef: RefObject<HTMLDivElement>;
  // ── lyrics ───────────────────────────────────────────────────
  lyrics: LyricLine[] | null;
  lyricsSynced: boolean;
  lyricsSource: LyricsSource | null;
  // ── reco / DeepSeek ──────────────────────────────────────────
  recoConfigured: boolean;
  recoLibrarySize: number;
  recoRunning: boolean;
  recoMatchRate: number;
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

/** Seeded pseudo-random from a string — stable across renders. */
function seededFromString(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619;
    h = h + ((h << 15) | 0) + ((h << 13) | 0) - (h << 6);
  }
  return Math.abs(h | 0);
}

/** 星尘：从 track id 派生 60 颗稳定粒子（位置/大小/透明度/漂移相位）。 */
function useStardust(trackId: string | undefined) {
  return useMemo(() => {
    const seed = trackId ?? 'void';
    const pts: Array<{
      x: number; y: number; s: number; a: number; d: number; delay: number;
    }> = [];
    for (let i = 0; i < 60; i++) {
      const r = seededFromString(`${seed}::${i}`, i + 1);
      pts.push({
        x: r % 100, // 百分位
        y: (r >> 4) % 100,
        s: 1 + ((r >> 8) % 20) / 10, // 1-3px
        a: 0.1 + ((r >> 12) % 80) / 100, // 0.1-0.9
        d: 6 + ((r >> 16) % 10), // 漂移距离 px
        delay: ((r >> 20) % 100) / 10, // 动画延迟 s
      });
    }
    return pts;
  }, [trackId]);
}

/** 当前歌词行 index（时间已过的最后一行）。 */
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

/** 进度弧的周长占比（环形进度）。 */
// (arcPct 已内联为 pct，保留注释说明设计意图)

// ── 演示循环（复刻 Figma prototype 的 A→B→C 自动循环） ─────────
// 无真实曲目时（track=null，如 demo 模式），用内置示例数据驱动
// 歌词推进/进度增长/播放键切换，让动效持续可见，对应 Figma
// prototype 的 ON_FRAME 自动循环。
const DEMO_LYRICS = [
  '我就像个走钢丝的人',
  '在云端漫步',
  '不曾想过退路',
  '平衡这孤独',
];

interface DemoLoop {
  /** 演示歌词当前行 index（0..n-1，循环） */
  demoLine: number;
  /** 演示进度 0-100（4.5s 一圈，循环） */
  demoPct: number;
  /** 演示播放状态（1.8s 切换一次 ▶/⏸） */
  demoPlaying: boolean;
  /** 演示当前时间（秒，用于时间显示） */
  demoTime: number;
  /** 演示总时长（固定 04:52 对应设计稿） */
  demoDuration: number;
}

function useDemoLoop(enabled: boolean): DemoLoop {
  const [demoLine, setDemoLine] = useState(0);
  const [demoPct, setDemoPct] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(true);
  const [demoTime, setDemoTime] = useState(0);
  const demoDuration = 292; // 04:52

  useEffect(() => {
    if (!enabled) return;
    // 行推进：每 2.8s 换一行（循环）
    const lineTimer = setInterval(() => {
      setDemoLine((i) => (i + 1) % DEMO_LYRICS.length);
    }, 2800);
    // 进度：每 100ms 推进（4.5s 一圈）
    const progTimer = setInterval(() => {
      setDemoTime((t) => {
        const next = t + 0.1;
        if (next >= demoDuration) return 0;
        return next;
      });
      setDemoPct((p) => (p >= 100 ? 0 : p + 100 / 45));
    }, 100);
    // 播放键切换：1.8s 一次
    const playTimer = setInterval(() => {
      setDemoPlaying((p) => !p);
    }, 1800);
    return () => {
      clearInterval(lineTimer);
      clearInterval(progTimer);
      clearInterval(playTimer);
    };
  }, [enabled]);

  return { demoLine, demoPct, demoPlaying, demoTime, demoDuration };
}

// ── platform badges ──────────────────────────────────────────

const PLATFORM_META: Record<MusicProvider, { letter: string; color: string; name: string }> = {
  qq: { letter: 'Q', color: '#FFD93D', name: 'QQ 音乐' },
  netease: { letter: 'N', color: '#FF3B5C', name: '网易云' },
  deezer: { letter: 'D', color: '#3D9BFF', name: 'Deezer' },
  spotify: { letter: 'S', color: '#3DFFA2', name: 'Spotify' },
};

// ── icons (lucide-style inline SVG, no CDN) ─────────────────

const ICONS: Record<string, string[]> = {
  play: ['M8 5v14l11-7z'],
  pause: ['M6 19h4V5H6v14zm8-14v14h4V5h-4z'],
  skipBack: ['M19 20 9 12l10-8z', 'M5 19V5'],
  skipForward: ['M5 4l10 8-10 8z', 'M19 5v14'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z'],
  thumbsDown: ['M7 10v12', 'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 16.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z'],
  shuffle: ['M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22', 'm18 2 4 4-4 4', 'M2 6h1.9c1.5 0 2.9.9 3.6 2.2', 'M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8', 'm18 14 4 4-4 4'],
  repeat: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'],
  swap: ['M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
  music: ['M9 18V5l12-2v13', 'M9 9l12-2'],
  sparkle: ['M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z'],
};

function ThIcon({ icon, size = 16, color, fill }: { icon: string; size?: number; color?: string; fill?: boolean }) {
  const paths = ICONS[icon] ?? [];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" color={color} aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ── main component ───────────────────────────────────────────

export default function TheaterView(props: TheaterViewProps) {
  const {
    track, playing, loading, liked, fanOutCount,
    currentTime, duration,
    provider, qqQuality, trialFellBack, likedCount,
    coverBackdropRef,
    lyrics,
    recoConfigured, recoLibrarySize, recoRunning, recoMatchRate, recoSuggestions,
    onPlayPause, onSkip, onPrev, onSeek, onLike,
    onSwitchProvider,
  } = props;

  // ── 1440×900 设计稿等比缩放（Electron 窗口任意拖拽） ──
  // 固定尺寸设计画布 + transform: scale()。scale = min(winW/1440, winH/900)，
  // 整个画布（含动效）随窗口等比缩放；背景星云固定铺满窗口不缩放。
  const [canvasScale, setCanvasScale] = useState(1);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // 顶部 40px 是 Titlebar（macOS 拖拽区），画布可用高度 = h - 40
      const scale = Math.min(w / 1440, Math.max(0.3, (h - 40) / 900));
      setCanvasScale(scale);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const stardust = useStardust(track?.id);

  // 演示循环：无真实曲目时接管（prototype 自动循环效果）
  const demo = useDemoLoop(!track);
  const hasTrack = Boolean(track);
  // 歌词：真实曲目用真实歌词，否则用演示歌词循环
  // （useMemo 必须无条件调用——Hooks 规则）
  const realActiveLine = useMemo(
    () => activeLineIndex(lyrics, currentTime),
    [lyrics, currentTime],
  );
  const activeLine = hasTrack ? realActiveLine : demo.demoLine;
  const currentLine = hasTrack
    ? (activeLine >= 0 ? lyrics?.[activeLine]?.text : null)
    : DEMO_LYRICS[demo.demoLine];
  // 当前行之后的 3 行（对应设计稿 lyric-stream 的 3 条渐隐后行）
  const followingLines: string[] = hasTrack
    ? (lyrics ?? [])
        .slice(Math.max(activeLine + 1, 0), Math.max(activeLine + 1, 0) + 3)
        .map((l) => l.text)
    : [1, 2, 3].map((k) => DEMO_LYRICS[(demo.demoLine + k) % DEMO_LYRICS.length]);
  const prevLine = hasTrack
    ? (activeLine - 1 >= 0 ? lyrics?.[activeLine - 1]?.text : null)
    : DEMO_LYRICS[(demo.demoLine - 1 + DEMO_LYRICS.length) % DEMO_LYRICS.length];
  // 进度/时间：真实曲目用真实值，否则用演示循环
  const effTime = hasTrack ? currentTime : demo.demoTime;
  const effDuration = hasTrack ? duration : demo.demoDuration;
  // pct 驱动弧长 + dot 轨道位置（Archive B→C 弧增长阶段）：
  // 真实播放随播放进度；demo 用 demoPct（4.5s 一圈循环增长，见 useDemoLoop），
  // 使飞线扫过（streaks）与弧增长（arc）时序联动 —— 完整还原 Archive 三帧动效
  const pct = hasTrack
    ? (effDuration > 0 ? Math.min(100, (effTime / effDuration) * 100) : 0)
    : demo.demoPct;
  // 播放状态：真实曲目用真实状态，否则演示切换
  const effPlaying = hasTrack ? playing : demo.demoPlaying;


  // 进度弧的 SVG 参数：圆周长 2πr，r=149（viewBox 300x300，圆心 150,150）
  const R = 149;
  const CIRC = 2 * Math.PI * R;
  const arcOffset = CIRC * (1 - pct / 100);

  // 播放键脉冲：playing 时核心辉光更强
  const [hover, setHover] = useState(false);

  // 封面渐变主色（从 track 派生，稳定）
  const coverHue = useMemo(() => (track ? seededFromString(track.id, 99) % 360 : 265), [track]);
  return (
    <div className={`th-root${effPlaying ? " is-playing" : ""}`}>
      {/* ── 背景层（铺满窗口，不随画布缩放） ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-stardust">
          {stardust.map((p, i) => (
            <span key={i} className="th-star"
              style={{
                left: `${p.x}%`, top: `${p.y}%`,
                width: `${p.s}px`, height: `${p.s}px`,
                opacity: p.a,
                ['--drift' as string]: `${p.d}px`,
                animationDelay: `${p.delay}s`,
              }} />
          ))}
        </div>
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布（整体等比缩放，含动效） ── */}
      <div className="th-canvas"
        style={{ ['--canvas-scale' as string]: String(canvasScale) }}>

        {/* 顶部 HUD（1440 稿 y 24：brand 64 / telemetry 1072 / badges 1228） */}
        <header className="th-hud">
          <div className="th-hud-brand">
            <span className="th-hud-title">AETHER ENGINE v3.0</span>
            <span className="th-hud-kicker">SYSTEM PROTOCOL</span>
          </div>
          <div className="th-hud-telemetry">
            <span className="th-hud-buff">
              BUFF 99.4% // LAT 47ms
              <span className="th-hud-dot" aria-hidden="true" />
            </span>
            <span className="th-hud-sync">
              <span className="th-hud-heart" aria-hidden="true">♥</span>
              <span>{likedCount > 0 ? likedCount.toLocaleString() : (fanOutCount > 0 ? `${fanOutCount}/4` : '1,284')}</span>
            </span>
          </div>
          <div className="th-hud-badges" role="group" aria-label="平台">
            {(['qq', 'netease', 'deezer', 'spotify'] as MusicProvider[]).map((p) => {
              const m = PLATFORM_META[p];
              const active = provider === p;
              return (
                <button key={p} type="button"
                  className={`th-badge${active ? ' is-active' : ''}`}
                  style={{ ['--badge' as string]: m.color }}
                  title={`${m.name}${active ? '（当前）' : ''}`}
                  onClick={p === provider ? undefined : onSwitchProvider}
                  disabled={p === provider}
                >
                  {m.letter}
                </button>
              );
            })}
          </div>
        </header>

        {/* 封面行星系统（1440 稿中心 430,420） */}
        <div className="th-cover-stage">
          <div className="th-ring th-ring--outer" />
          <div className="th-ring th-ring--mid" />
          <div className="th-ring th-ring--inner" />
          <div className="th-orbit">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className={`th-orbit-tick${i % 2 === 0 ? ' is-gold' : ''}`}
                style={{ transform: `rotate(${i * 30}deg) translate(-6.5px, -196.5px)` }} />
            ))}
          </div>
          {/* 流星飞线（Figma A 帧 progress-arc 原始矢量，Smart Animate 扫过效果）
              外层 300×324 overflow 裁切 = 设计稿 star-orbit 容器，只露出容器内的线段 */}
          <div className="th-streaks-clip" aria-hidden="true">
            <svg className="th-streaks" viewBox="0 0 360.781 454.773">
              <path className="th-streaks-path"
                d="M1 1C199.613 2 367.224 89.2524 123.054 64.5371C422.991 168.896 447.655 356.24 141.014 200.961C414.402 447.604 275.085 575.264 39.564 293.923"
                fill="none" stroke="#00E5FF" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <svg className="th-scan" viewBox="0 0 390 390" aria-hidden="true">
            <path className="th-scan-arc"
              d="M 195 20 A 175 175 0 0 1 316.4 73.6"
              fill="none" stroke="rgba(0, 229, 255, 0.5)" strokeWidth="3"
              strokeLinecap="round" />
          </svg>
          <div className="th-cover" ref={coverBackdropRef}
            style={{ ['--hue' as string]: `${coverHue}` }}
            onError={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundImage = 'none'; }}>
            {!track?.coverUrl && (
              <span className="th-cover-symbol" aria-hidden="true">♪</span>
            )}
          </div>
          <span className="th-live-tag"><span className="th-live-dot" />LIVE</span>
          <span className="th-heart-stat">
            <span className="th-heart-stat-icon" aria-hidden="true">♥</span>
            <span>{likedCount > 0 ? likedCount.toLocaleString() : '1,284'}</span>
          </span>
          {/* 星轨进度环（同心套在封面外） */}
          <div className="th-orbit-progress" role="group" aria-label="播放进度">
            <svg viewBox="0 0 300 300" className="th-orbit-svg"
              onClick={(e) => {
                const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const ang = Math.atan2(e.clientY - cy, e.clientX - cx);
                const deg = ((ang * 180) / Math.PI + 90 + 360) % 360;
                onSeek((deg / 360) * effDuration);
              }}>
              <circle className="th-orbit-track" cx="150" cy="150" r="149" fill="none" strokeWidth="2" />
              <circle className="th-orbit-arc" cx="150" cy="150" r="149" fill="none" strokeWidth="2"
                strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={arcOffset}
                transform="rotate(-90 150 150)" />
              <defs>
                {/* Figma orbit-dot：白核→#8CF2FF→透明青的径向渐变 */}
                <radialGradient id="thOrbitDotGrad" cx="0.4" cy="0.4" r="0.62">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.45" stopColor="#8CF2FF" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#00E5FF" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle className="th-orbit-dot" cx="150" cy="150" r="4" fill="url(#thOrbitDotGrad)"
                style={{
                  transform: `rotate(${pct * 3.6}deg) translateY(-149px)`,
                  transformOrigin: '150px 150px',
                }} />
            </svg>
            <div className="th-orbit-times">
              <span className="th-time th-time--cur">{fmtTime(effTime)}</span>
              <span className="th-time-divider" aria-hidden="true" />
              <span className="th-time th-time--total">{fmtTime(effDuration)}</span>
            </div>
          </div>
        </div>

        {/* 歌名信息（1440 稿 430,590） */}
        <div className="th-track-info">
          <h1 className="th-track-title">{track?.title ?? '走钢丝的人'}</h1>
          <p className="th-track-sub">
            {track ? `${track.artist} // ${track.album || '未知专辑'}` : '李泉 // 2001 · 寓言'}
          </p>
          <p className="th-track-hires">
            HI-RES {qqQuality === 'lossless' ? '24/96' : qqQuality === 'high' ? '320K' : '24/96'} · DOLBY ATMOS
            {trialFellBack ? ' · TRIAL' : ''}
          </p>
        </div>

        {/* 歌词文字流（1440 稿 820,320；无面板 chrome，纯文字流） */}
        <section className="th-lyrics-panel" aria-label="歌词">
          {prevLine && <p className="th-lyric th-lyric--dim">{prevLine}</p>}
          <div className="th-lyric-active">
            <span className="th-lyric-bar" aria-hidden="true" />
            <p key={currentLine ?? 'idle'} className="th-lyric th-lyric--current">
              {currentLine ?? (loading ? '正在搜寻信号…' : '等待播放')}
            </p>
          </div>
          {followingLines.map((line, i) => (
            <p key={`${i}-${line}`} className="th-lyric th-lyric--dim">{line}</p>
          ))}
        </section>

        {/* 左下：能量核心（1440 稿 266,700；顺序 prev|like|play|next） */}
        <div className="th-core-cluster">
          <button type="button" className="th-ctrl th-ctrl--prev" onClick={onPrev} disabled={!track} title="上一首">
            <ThIcon icon="skipBack" size={18} />
          </button>
          <button type="button"
            className={`th-like${liked ? ' is-liked' : ''}${liked && fanOutCount > 1 ? ' is-fanout' : ''}`}
            onClick={onLike} disabled={!track}
            title={liked ? (fanOutCount > 0 ? `已心动 ${fanOutCount} 个平台，再点取消红心` : '再点取消红心') : '红心'}
            aria-pressed={liked}
          >
            <ThIcon icon="heart" size={18} />
            {liked && fanOutCount > 1 && <span className="th-like-badge">{fanOutCount}</span>}
          </button>
          <button type="button" className={`th-core${effPlaying ? ' is-playing' : ''}${hover ? ' is-hover' : ''}`}
            onClick={onPlayPause} disabled={!track || loading} title={effPlaying ? '暂停' : '播放'}
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            <span className="th-core-inner" aria-hidden="true" />
            {loading ? (
              <span className="th-core-spinner" aria-label="加载中" />
            ) : effPlaying ? (
              <ThIcon icon="pause" size={26} fill />
            ) : (
              <ThIcon icon="play" size={26} fill />
            )}
          </button>
          <button type="button" className="th-ctrl th-ctrl--next" onClick={onSkip} disabled={!track} title="下一首">
            <ThIcon icon="skipForward" size={18} />
          </button>
        </div>

        {/* 右下：DeepSeek 推荐（1440 稿 1000,700） */}
        <div className="th-reco">
          <div className="th-reco-head">
            <span className="th-reco-label">DEEP.SEEK // NEURAL FEED</span>
            {recoRunning && <span className="th-reco-running" aria-label="推荐生成中">…</span>}
          </div>
          <div className="th-reco-cards">
            {recoSuggestions.slice(0, 3).map((s, i) => (
              <button key={i} type="button" className="th-reco-card"
                style={{ ['--card-color' as string]: s.coverColor }} title={`${s.title} · ${s.artist}`}>
                <span className="th-reco-art" aria-hidden="true" />
                <span className="th-reco-name">{s.title}</span>
                <span className="th-reco-artist">{s.artist}</span>
                <span className="th-reco-match">{s.match}%</span>
              </button>
            ))}
            {recoSuggestions.length === 0 && (
              <div className="th-reco-empty">
                {recoConfigured
                  ? `已根据 ${recoLibrarySize} 首库内歌曲生成推荐`
                  : '配置 DEEPSEEK KEY 后开启 AI 推荐'}
              </div>
            )}
          </div>
          {recoConfigured && (
            <div className="th-reco-foot">AI 评估：{recoMatchRate}% MATCH</div>
          )}
        </div>

        {/* 版本行（1440 稿右下） */}
        <div className="th-footer-version" aria-hidden="true">NEURAL.SYNC // AES.ENGINE v3.0</div>
      </div>
    </div>
  );
}