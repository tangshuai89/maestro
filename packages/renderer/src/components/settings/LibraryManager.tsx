import { useState, useEffect } from 'react';
import {
  getLibrary,
  clearProviderLibrary,
  clearAllLibraries,
  type MusicProvider,
  type LibraryImportResult,
  PROVIDER_LABELS,
} from '../../api';
import Modal from '../common/Modal';

/**
 * §5 Settings「库管理」。每平台独立清空（Deezer 不算）。
 * 节顶部"清空全部库"按钮 → 二次确认弹窗。
 */
export default function LibraryManager() {
  const [lib, setLib] = useState<LibraryImportResult | null>(null);
  const [busyProvider, setBusyProvider] = useState<MusicProvider | null>(null);
  const [showClearAll, setShowClearAll] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg?: string } | null>(null);

  const refresh = () => {
    void getLibrary()
      .then((r) => setLib(r))
      .catch(() => setLib(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  // 每个平台的 liked 计数（按 sources[] 算）
  const countByProvider: Record<MusicProvider, number> = { qq: 0, netease: 0, deezer: 0, spotify: 0 };
  if (lib) {
    for (const item of lib.items) {
      for (const s of item.sources) {
        countByProvider[s.platform]++;
      }
    }
  }

  const order: MusicProvider[] = ['qq', 'netease', 'spotify']; // deezer 不算

  const handleClearProvider = async (p: MusicProvider) => {
    setBusyProvider(p);
    setStatus(null);
    try {
      const r = await clearProviderLibrary(p);
      setStatus({ kind: 'ok', msg: `已清除 ${r.removed} 项 ${PROVIDER_LABELS[p]} 库贡献` });
      refresh();
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    } finally {
      setBusyProvider(null);
    }
  };

  const handleClearAll = async () => {
    setShowClearAll(false);
    setStatus(null);
    try {
      await clearAllLibraries();
      setStatus({ kind: 'ok', msg: '已清空整库' });
      refresh();
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  return (
    <div className="set-library-manager">
      {order.map((p) => {
        const count = countByProvider[p];
        return (
          <div key={p} className="set-row">
            <span className={`set-row-platform set-row-platform--${p}`}>
              {PROVIDER_LABELS[p]}
            </span>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <div className="set-row-name">{count} 首</div>
              <div className="set-row-meta">
                {count === 0 ? '该平台在库里没有 liked 贡献' : '由你的红心导入而来'}
              </div>
            </div>
            <button
              className="set-btn-sm set-btn--danger"
              onClick={() => void handleClearProvider(p)}
              disabled={count === 0 || busyProvider === p}
              title="清空此平台的库贡献"
            >
              {busyProvider === p ? '清除中…' : '清空此平台'}
            </button>
          </div>
        );
      })}

      <div className="set-section-actions" style={{ marginTop: 14 }}>
        <button
          className="set-btn set-btn--danger"
          onClick={() => setShowClearAll(true)}
          disabled={!lib || lib.items.length === 0}
          title="一键清空全部库（含各平台的 likeSync 队列）"
        >
          清空全部库
        </button>
      </div>

      {status && (
        <div className={`set-status set-status--${status.kind}`} role="status">
          {status.msg}
        </div>
      )}

      {showClearAll && (
        <Modal onClose={() => setShowClearAll(false)}>
          <div style={{ padding: 24, color: 'var(--text-main)' }}>
            <h3 style={{ margin: '0 0 12px' }}>清空全部库？</h3>
            <p style={{ marginTop: 0 }}>
              这将清空你导入的所有 liked 库（共 {lib?.items.length ?? 0} 首），各平台
              远程收藏不会被删除，但下次 ❤ 同步会重新建立。
            </p>
            <div className="set-section-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="set-btn" onClick={() => setShowClearAll(false)}>
                取消
              </button>
              <button
                className="set-btn set-btn--danger"
                onClick={() => void handleClearAll()}
              >
                确认清空
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}