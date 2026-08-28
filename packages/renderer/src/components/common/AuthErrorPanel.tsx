import { useState, useEffect } from 'react';
import type { AuthError, AuthErrorCode } from '../../auth/types';
import type { MusicProvider } from '../../api';

/**
 * AETHER AuthErrorPanel — 登录失败恢复全屏（Figma 03/Screen/Error 还原）。
 *
 * 设计稿结构（1440×900，node 401:1287）：
 *  - backdrop（星云 + 地平线，复用 th-bg）
 *  - Tag/Stat 错误码标签（y=564）
 *  - error-panel（800×200 @ x=320, y=600）：
 *    summary（错误码 + 展开箭头 + Tag/Stat）+ stack trace + 4 Button/Text 操作
 *
 * 操作按钮：重试 / 重新登录 / 粘贴 cookie（QQ/网易）/ 切换音源 / 关闭
 */

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

const SEVERITY: Record<AuthErrorCode, 'FATAL' | 'WARN' | 'INFO'> = {
  AUTH_CANCELLED: 'INFO',
  AUTH_TIMEOUT: 'WARN',
  AUTH_INVALID: 'FATAL',
  AUTH_EXPIRED: 'FATAL',
  AUTH_PROTOCOL_MISSING: 'WARN',
  AUTH_BACKEND_DOWN: 'FATAL',
  AUTH_UNKNOWN: 'FATAL',
};

const SEVERITY_COLOR: Record<string, string> = {
  fatal: '#FF3B5C',
  warn: '#FFD93D',
  info: '#3D9BFF',
};

export default function AuthErrorPanel({
  provider,
  error,
  onRetry,
  onReLogin,
  onSwitch,
  onPasteCookie,
  onDismiss,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // 1440×900 画布等比缩放
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

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (!error) return null;
  const title = FRIENDLY[error.code];
  const severity = SEVERITY[error.code];
  const sevColor = SEVERITY_COLOR[severity.toLowerCase()] ?? '#FF3B5C';
  const showPaste = (provider === 'qq' || provider === 'netease') && Boolean(onPasteCookie);
  const hasStack = error.message.includes('\n');

  return (
    <div className="aep-root">
      {/* ── 背景层 ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="aep-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* Tag/Stat 错误码标签（y=564） */}
        <div className="aep-code-tag" style={{ ['--sev' as string]: sevColor }}>
          <span className="aep-code-severity">{severity}</span>
          <span className="aep-code-text">{error.code}</span>
        </div>

        {/* error-panel（800×200 @ x=320, y=600） */}
        <div className="aep-panel" role="alert">
          {/* summary 行 */}
          <div className="aep-summary">
            <span className="aep-summary-text">{title}</span>
            <button
              className="aep-expand"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? '收起详情' : '展开详情'}
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? '▾' : '▸'}
            </button>
          </div>

          {/* stack trace / detail */}
          {expanded && hasStack && (
            <pre className="aep-stack">{error.message}</pre>
          )}
          {expanded && !hasStack && (
            <div className="aep-detail">{error.message}</div>
          )}

          {/* actions（4 Button/Text） */}
          <div className="aep-actions">
            <button className="aep-btn aep-btn--primary" onClick={onRetry} title="用相同方式重试">
              重试
            </button>
            <button className="aep-btn" onClick={onReLogin} title="从头开始登录">
              重新登录
            </button>
            {showPaste && (
              <button className="aep-btn" onClick={onPasteCookie} title="手动粘贴 cookie 登录">
                粘贴 cookie
              </button>
            )}
            <button className="aep-btn" onClick={onSwitch} title="回到音源选择页">
              切换音源
            </button>
            <button className="aep-btn aep-btn--ghost" onClick={onDismiss} title="关闭错误">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
