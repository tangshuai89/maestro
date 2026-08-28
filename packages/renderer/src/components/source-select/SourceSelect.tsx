import { useEffect, useState } from 'react';
import type { MusicProvider } from '../../api';
import { getSpotifyStatus } from '../../api';

/**
 * AETHER SourceSelect — 选源页（Figma 03/Screen/SourceSelect 还原）。
 *
 * 设计稿结构（1440×900，node 314:1432）：
 *  - backdrop（星云 + 星尘 + 地平线，复用 TheaterView 背景层）
 *  - kicker-row（居中小标签 y=112）
 *  - title-box（heading + sub，y=150）
 *  - platform-cards（4 张竖卡 220×280，横排 y=390）
 *    每张：accent-bar + badge + name + desc + meta + enter
 *  - hint-row（底部提示 y=734）
 *
 * 画布等比缩放同 TheaterView：scale = min(w/1440, (h-40)/900)。
 */

interface SourceSelectProps {
  onSelect: (provider: MusicProvider) => void;
}

interface SourceDef {
  provider: MusicProvider;
  name: string;
  baseDesc: string;
  spotifyVariants?: Partial<Record<'premium' | 'free' | 'open' | 'unknown', string>>;
  /** Figma badge letter */
  badge: string;
  /** Accent bar + badge color */
  color: string;
  /** Meta line (login method) */
  meta: string;
  disabled?: boolean;
  disabledReason?: string;
}

const SOURCES: SourceDef[] = [
  {
    provider: 'qq',
    name: 'QQ 音乐',
    baseDesc: '登录后可搜索 + 播全曲',
    badge: 'Q',
    color: '#FFD93D',
    meta: '桌面扫码登录',
  },
  {
    provider: 'netease',
    name: '网易云音乐',
    baseDesc: '私人 FM 电台',
    badge: 'N',
    color: '#FF3B5C',
    meta: '手机扫码登录',
  },
  {
    provider: 'deezer',
    name: 'Deezer',
    baseDesc: '国际公开电台 · 30s 预览',
    badge: 'D',
    color: '#3D9BFF',
    meta: '无需登录',
  },
  {
    provider: 'spotify',
    name: 'Spotify',
    baseDesc: '国际曲库 · 30s 预览',
    spotifyVariants: {
      premium: '国际曲库 · 全曲播放',
      free: '国际曲库 · 30s 预览',
      open: '国际曲库 · 30s 预览',
      unknown: '国际曲库 · 30s 预览',
    },
    badge: 'S',
    color: '#3DFFA2',
    meta: 'OAuth 登录',
  },
];

export default function SourceSelect({ onSelect }: SourceSelectProps) {
  const [spotifyTier, setSpotifyTier] = useState<
    'premium' | 'free' | 'open' | 'unknown'
  >('unknown');
  useEffect(() => {
    void getSpotifyStatus()
      .then((s) => {
        if (s.loggedIn && s.tier) setSpotifyTier(s.tier);
      })
      .catch(() => {});
  }, []);

  // 1440×900 画布等比缩放（同 TheaterView）
  const [canvasScale, setCanvasScale] = useState(1);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = Math.min(w / 1440, Math.max(0.3, (h - 40) / 900));
      setCanvasScale(scale);
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return (
    <div className="ss-root">
      {/* ── 背景层（铺满窗口，不随画布缩放） ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="ss-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* kicker（y=112） */}
        <div className="ss-kicker">
          <span className="ss-kicker-text">AETHER ENGINE // SOURCE PROTOCOL</span>
        </div>

        {/* title-box（y=150） */}
        <div className="ss-title-box">
          <h1 className="ss-heading">选择音乐来源</h1>
          <p className="ss-sub">挑一个音源，开始你的宇宙剧场</p>
        </div>

        {/* platform-cards（y=390，4 张竖卡 220×280） */}
        <div className="ss-cards">
          {SOURCES.map((s) => {
            const desc =
              s.provider === 'spotify' && s.spotifyVariants
                ? s.spotifyVariants[spotifyTier]
                : s.baseDesc;
            return (
              <button
                key={s.provider}
                className={`ss-card${s.disabled ? ' ss-card--disabled' : ''}`}
                style={{ ['--card-accent' as string]: s.color }}
                onClick={() => {
                  if (s.disabled) return;
                  onSelect(s.provider);
                }}
                disabled={s.disabled}
                title={s.disabledReason ?? ''}
              >
                <div className="ss-card-accent" />
                <div className="ss-card-badge">{s.badge}</div>
                <div className="ss-card-name">{s.name}</div>
                <div className="ss-card-desc">{desc}</div>
                <div className="ss-card-meta">{s.meta}</div>
                <div className="ss-card-enter">ENTER →</div>
              </button>
            );
          })}
        </div>

        {/* hint-row（y=734） */}
        <div className="ss-hint">
          <span className="ss-hint-text">凭据本地存储 · 不上传任何服务器</span>
        </div>
      </div>
    </div>
  );
}
