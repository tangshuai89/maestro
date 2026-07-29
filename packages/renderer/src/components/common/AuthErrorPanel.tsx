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
