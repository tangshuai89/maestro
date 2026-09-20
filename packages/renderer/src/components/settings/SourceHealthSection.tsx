import { useState, useEffect } from 'react';
import {
  fetchSourceHealth,
  type MusicProvider,
  PROVIDER_LABELS,
} from '../../api';

/**
 * §5 Settings「源连接健康」：每平台近 24h 成功率 + 横向进度条。
 * total=0 → "近 24h 无请求"。
 */
export default function SourceHealthSection() {
  const [items, setItems] = useState<
    Array<{
      provider: MusicProvider;
      total: number;
      successRate: number;
      lastFailureAt: number | null;
    }>
  >([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setBusy(true);
    void fetchSourceHealth()
      .then((r) => setItems(r.items))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    refresh();
    // 每 30s 自动刷新一次（不打扰用户）
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const rateClass = (rate: number, total: number): string => {
    if (total === 0) return 'set-health-bar-fill--zero';
    if (rate >= 0.9) return 'set-health-bar-fill--good';
    if (rate >= 0.6) return 'set-health-bar-fill--mid';
    return 'set-health-bar-fill--bad';
  };

  return (
    <div className="set-source-health">
      {items.map((it) => (
        <div key={it.provider} className="set-row">
          <span className={`set-row-platform set-row-platform--${it.provider}`}>
            {PROVIDER_LABELS[it.provider]}
          </span>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div className="set-row-name">
              {it.total === 0
                ? '近 24h 无请求'
                : `${it.total} 次请求 · 成功率 ${Math.round(it.successRate * 100)}%`}
            </div>
            <div className="set-row-meta">
              {it.lastFailureAt
                ? `最近失败：${formatRelativeTime(it.lastFailureAt)}`
                : it.total > 0
                  ? '近 24h 无失败'
                  : '点 Titlebar 平台徽章搜首歌试试'}
            </div>
          </div>
          <div className="set-health-bar">
            <div
              className={`set-health-bar-fill ${rateClass(it.successRate, it.total)}`}
              style={{
                width: it.total === 0 ? '0%' : `${Math.round(it.successRate * 100)}%`,
              }}
            />
          </div>
          <div className="set-health-rate">
            {it.total === 0 ? '—' : `${Math.round(it.successRate * 100)}%`}
          </div>
        </div>
      ))}
      <div className="set-section-actions" style={{ marginTop: 14 }}>
        <button className="set-btn-ghost" onClick={refresh} disabled={busy} title="刷新">
          {busy ? '…' : '↻'}
        </button>
      </div>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}