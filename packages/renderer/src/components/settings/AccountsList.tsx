import { useState, useEffect } from 'react';
import {
  fetchAuthStatusAll,
  logout,
  type MusicProvider,
  type AuthStatusExtended,
  PROVIDER_LABELS,
} from '../../api';

/**
 * §5 Settings「平台账号」列表。4 行，每行显示 nickname + 上次校验时间。
 * Deezer 行：标"匿名公开电台"，登出按钮 disabled。
 */
export default function AccountsList() {
  const [statuses, setStatuses] = useState<Record<MusicProvider, AuthStatusExtended> | null>(
    null,
  );
  const [busyProvider, setBusyProvider] = useState<MusicProvider | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg?: string } | null>(null);

  const refresh = () => {
    void fetchAuthStatusAll()
      .then(setStatuses)
      .catch(() => setStatus({ kind: 'err', msg: '无法读取平台账号状态' }));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleLogout = async (p: MusicProvider) => {
    setBusyProvider(p);
    setStatus(null);
    try {
      await logout(p);
      setStatus({ kind: 'ok', msg: `已登出 ${PROVIDER_LABELS[p]}` });
      refresh();
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    } finally {
      setBusyProvider(null);
    }
  };

  const fmtValidatedAt = (ts: number | null): string => {
    if (!ts) return '未登录';
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚校验';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前校验`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前校验`;
    return `${Math.floor(diff / 86_400_000)} 天前校验`;
  };

  const order: MusicProvider[] = ['qq', 'netease', 'deezer', 'spotify'];

  return (
    <div className="set-accounts-list">
      {order.map((p) => {
        const s = statuses?.[p];
        const isAnonymous = p === 'deezer';
        const loggedIn = !!s?.loggedIn;
        return (
          <div key={p} className="set-row">
            <span className={`set-row-platform set-row-platform--${p}`}>
              {PROVIDER_LABELS[p]}
            </span>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div className="set-row-name">
                {isAnonymous
                  ? '匿名公开电台'
                  : loggedIn && s?.user
                    ? s.user.nickname
                    : '未登录'}
              </div>
              <div className="set-row-meta">
                {isAnonymous
                  ? '无需账号，搜得到的就是能放的'
                  : loggedIn
                    ? fmtValidatedAt(s?.lastValidatedAt ?? null)
                    : '点 Titlebar 平台徽章登录'}
              </div>
            </div>
            <button
              className="set-btn-sm set-btn--danger"
              onClick={() => void handleLogout(p)}
              disabled={isAnonymous || !loggedIn || busyProvider === p}
              title={isAnonymous ? '匿名音源无法登出' : '登出'}
            >
              {busyProvider === p ? '登出中…' : '登出'}
            </button>
          </div>
        );
      })}
      {status && (
        <div className={`set-status set-status--${status.kind}`} role="status">
          {status.msg}
        </div>
      )}
    </div>
  );
}