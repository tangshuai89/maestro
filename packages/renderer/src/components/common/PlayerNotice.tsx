/**
 * AETHER PlayerNotice — 播放彻底失败后的轻量提示条。
 *
 * 设计背景（2026-10-19「交换余生」报障）：兜底链（同源重试 → 同平台换版本 →
 * 跨平台等价源）耗尽后，usePlayer 只 setError 了一个**没有任何组件渲染**的
 * 字符串 —— 界面停在歌名 + 00:00 + HUD READY，视觉上是「假死」。
 *
 * 产品策略（对齐 Spotify/Apple Music）：
 *  - 不遮罩、不抢焦点：底部浮条，播放器其它操作照常可用；
 *  - 分级文案：付费专辑/会员专属/无版权/音源故障 是**不同的用户动作**；
 *  - 有下一首时 4s 倒计时自动跳（「停留」可取消）；连续 ≥3 首失败由
 *    usePlayer 关掉 autoSkip，防整库死歌时空转刷屏；
 *  - 付费/锁曲给「去原平台查看」外链（系统浏览器打开，可单购）。
 *  - 泛用 error 字符串（非结构化 failure）也走这里显示——以前它完全隐形。
 */
import { useEffect, useRef, useState } from 'react';
import type { PlayFailure } from '../../hooks/usePlayer';
import type { MusicProvider } from '../../api';

const PROVIDER_LABEL: Record<MusicProvider, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
  deezer: 'Deezer',
  spotify: 'Spotify',
};

const PROVIDER_TRACK_URL: Record<MusicProvider, (id: string) => string> = {
  qq: (id) => `https://y.qq.com/n/ryqq/songDetail/${id}`,
  netease: (id) => `https://music.163.com/song?id=${id}`,
  spotify: (id) => `https://open.spotify.com/track/${id}`,
  deezer: (id) => `https://www.deezer.com/track/${id}`,
};

function openExternal(url: string): void {
  const api = window.electronAPI;
  if (api?.openExternal) {
    void api.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function reasonText(f: PlayFailure): string {
  const p = PROVIDER_LABEL[f.provider];
  switch (f.reason) {
    case 'paid-track':
      return `《${f.title}》为付费专辑曲目，需单独购买`;
    case 'vip-locked':
      return `《${f.title}》在已登录平台均为会员专属内容`;
    case 'entitlement-expired':
      // 凭据有效、但会员没了 —— 和「登录过期」是**相反**的动作：
      // 重新登录没用（会员状态在账号上，不在 cookie 里），要等会员恢复或换平台。
      return `《${f.title}》需要会员，但你的会员已失效 —— 重新登录没用，等会员恢复或换个平台`;
    case 'stream-failed':
      return `《${f.title}》音源暂时不可用（可尝试重新登录 ${p}）`;
    case 'no-match':
      return `《${f.title}》在各平台暂无可播版本`;
    default:
      return f.detail || `《${f.title}》播放失败`;
  }
}

const AUTO_SKIP_SEC = 4;

interface Props {
  /** 结构化失败（兜底链耗尽）——优先渲染。 */
  failure: PlayFailure | null;
  /** 泛用错误字符串（failure 为空时的降级显示）。 */
  error: string | null;
  onSkipNext: () => void;
  onDismiss: () => void;
}

export default function PlayerNotice({ failure, error, onSkipNext, onDismiss }: Props) {
  // key 语义由父级保证（failure 变化 → 倒计时重来）。
  const [remain, setRemain] = useState(AUTO_SKIP_SEC);
  const [stayed, setStayed] = useState(false);
  const failRef = useRef<PlayFailure | null>(failure);
  if (failRef.current !== failure) {
    failRef.current = failure;
    setRemain(AUTO_SKIP_SEC);
    setStayed(false);
  }

  const autoSkipping = Boolean(failure?.autoSkip) && !stayed;

  useEffect(() => {
    if (!autoSkipping) return;
    if (remain <= 0) {
      onSkipNext();
      return;
    }
    const t = setTimeout(() => setRemain((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [autoSkipping, remain, onSkipNext]);

  if (!failure && !error) return null;

  const text = failure ? reasonText(failure) : (error ?? '');
  const originalUrl =
    failure?.trackId != null ? PROVIDER_TRACK_URL[failure.provider](failure.trackId) : null;
  // 只有「可行动」的原因才给外链（付费/会员 → 去购买页有意义；无版权去了也没用）。
  const showOriginal =
    originalUrl && (failure?.reason === 'paid-track' || failure?.reason === 'vip-locked');

  return (
    <div className="player-notice" role="alert" aria-live="assertive">
      <span className="player-notice-icon" aria-hidden="true">
        ⚠
      </span>
      <span className="player-notice-text" title={failure?.detail ?? undefined}>
        {text}
      </span>
      <div className="player-notice-actions">
        {autoSkipping && <span className="player-notice-count">{remain}s 后自动下一首</span>}
        {showOriginal && (
          <button
            className="player-notice-btn"
            onClick={() => openExternal(originalUrl)}
            title="在系统浏览器打开原平台页面"
          >
            去{PROVIDER_LABEL[failure!.provider]}查看
          </button>
        )}
        {failure && (
          <button
            className="player-notice-btn player-notice-btn--primary"
            onClick={onSkipNext}
            title="跳到下一首（队列空/到头时自动回绕）"
          >
            下一首 ▸
          </button>
        )}
        {autoSkipping && (
          <button className="player-notice-btn" onClick={() => setStayed(true)}>
            停留
          </button>
        )}
        <button
          className="player-notice-btn player-notice-btn--close"
          onClick={onDismiss}
          aria-label="关闭提示"
        >
          ×
        </button>
      </div>
    </div>
  );
}
