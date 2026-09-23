/**
 * 各平台品牌 logo 的简化 inline SVG。
 *
 * 设计约束：
 *  - 不抄官方 logo 像素（避免品牌版权），只用简化品牌色 + 视觉符号
 *    （QQ 音符 / 网易云音符 / Spotify 圆 / Deezer EQ）。
 *  - inline SVG，不依赖任何网络资源（Electron 桌面应用离线可用）。
 *  - viewBox 统一 24x24，组件用 width/height 12px chip 内显示。
 *  - 颜色用当前 color（currentColor）让父 chip 控制文字色，白色填色
 *    适合放在黄/紫/红/绿等饱和背景上看清。
 */

import type { JSX } from 'react';

export type ProviderLogoName = 'qq' | 'netease' | 'deezer' | 'spotify';

interface LogoProps {
  size?: number;
  title?: string;
}

/** QQ 音乐 —— 黄色圆角方 + 白色音符（经典 QQ 音乐 logo 形状） */
export function QqLogo({ size = 12, title = 'QQ 音乐' }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#fff" />
      <path
        d="M14.5 6.5v9.2a3.2 3.2 0 1 1-2.2-3.06V9.85l-4.3 0.86v5.84a3.2 3.2 0 1 1-2.2-3.06V8.65l6.7-1.4z"
        fill="#000"
      />
    </svg>
  );
}

/** 网易云 —— 红色圆角方 + 白色音符（QQ 音符镜像变体，颜色不同） */
export function NeteaseLogo({ size = 12, title = '网易云音乐' }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {title && <title>{title}</title>}
      <rect width="24" height="24" rx="5" fill="#fff" />
      <path
        d="M14.5 6.5v9.2a3.2 3.2 0 1 1-2.2-3.06V9.85l-4.3 0.86v5.84a3.2 3.2 0 1 1-2.2-3.06V8.65l6.7-1.4z"
        fill="#e60026"
      />
    </svg>
  );
}

/** Spotify —— 经典绿圆 + 黑色弧线（Spotify 官方 logo 的简化） */
export function SpotifyLogo({ size = 12, title = 'Spotify' }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="11" fill="#000" />
      <path
        d="M7 9.6c3.5-1.2 7.8-1.1 11.2 0.9"
        stroke="#1db954"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M7.5 12.6c3-1 6.5-0.9 9.5 0.7"
        stroke="#1db954"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8 15.4c2.4-0.8 5.2-0.7 7.5 0.5"
        stroke="#1db954"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Deezer —— 紫色方 + 4 条白竖条（类比 iconic：Deezer logo 风格） */
export function DeezerLogo({ size = 12, title = 'Deezer' }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {title && <title>{title}</title>}
      <rect x="0" y="13" width="3" height="11" fill="#fff" />
      <rect x="6" y="9" width="3" height="15" fill="#fff" />
      <rect x="12" y="5" width="3" height="19" fill="#fff" />
      <rect x="18" y="11" width="3" height="13" fill="#fff" />
    </svg>
  );
}

/** Provider → Logo 映射。SourceChip 直接用 lookup。 */
export function ProviderLogo({
  platform,
  size = 12,
}: {
  platform: ProviderLogoName;
  size?: number;
}): JSX.Element {
  switch (platform) {
    case 'qq':
      return <QqLogo size={size} />;
    case 'netease':
      return <NeteaseLogo size={size} />;
    case 'spotify':
      return <SpotifyLogo size={size} />;
    case 'deezer':
      return <DeezerLogo size={size} />;
  }
}
