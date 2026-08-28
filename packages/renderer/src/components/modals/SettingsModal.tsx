import { useEffect, useState } from 'react';
import {
  getStateSnapshot,
  importState,
  triggerBackup,
  getBackupInfo,
} from '../../api';
import {
  encryptBundle,
  decryptBundle,
  generatePassphrase,
  type BackupBundle,
} from '../../lib/backup-crypto';
import { collectLocalStorage, restoreLocalStorage } from '../../lib/storage';

/**
 * AETHER Settings — 设置全屏（Figma 03/Screen/Settings 还原）。
 *
 * 设计稿结构（1440×900，node 399:1153）：
 *  - backdrop（星云 + 地平线，复用 th-bg）
 *  - top-hud（"SETTINGS // CONFIG" + close 按钮）
 *  - 3 个 section（960×180 @ y=120/340/560）：
 *    section-0：本地自动备份（目录路径 + Tag/Stat + Button/Text）
 *    section-1：导出会话快照（Button/Text + Input/Text 口令框）
 *    section-2：导入并合并（Input/Text 文件 + Input/Text 口令 + Button/Text）
 *
 * 备份/导出/导入逻辑完整保留。
 */

interface Props {
  onClose: () => void;
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'err'; msg?: string };

const APP_VERSION = '1.0.0';

export default function SettingsModal({ onClose }: Props) {
  const [backupDir, setBackupDir] = useState<string>('…');
  const [backupCount, setBackupCount] = useState<number>(0);
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' });

  const [exportPass, setExportPass] = useState(generatePassphrase());
  const [exportStatus, setExportStatus] = useState<Status>({ kind: 'idle' });

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importStatus, setImportStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void getBackupInfo()
      .then((info) => {
        setBackupDir(info.backupDir);
        setBackupCount(info.backupCount);
      })
      .catch(() => setBackupDir('（无法读取备份目录）'));
  }, []);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackupNow = async () => {
    setBackupStatus({ kind: 'busy' });
    try {
      const r = await triggerBackup();
      setBackupCount(r.count);
      setBackupStatus({ kind: 'ok', msg: `已备份 · 共 ${r.count} 份` });
    } catch (e) {
      setBackupStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  const handleExport = async () => {
    if (!exportPass) {
      setExportStatus({ kind: 'err', msg: '请先设置导出口令' });
      return;
    }
    setExportStatus({ kind: 'busy' });
    try {
      const { stateJson } = await getStateSnapshot();
      const bundle: BackupBundle = {
        manifest: {
          version: 1,
          exportedAt: new Date().toISOString(),
          appVersion: APP_VERSION,
        },
        stateJson,
        localStorage: collectLocalStorage(),
      };
      const blob = await encryptBundle(bundle, exportPass);
      const file = new Blob([blob], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `maestro-${stamp}.maestro-backup`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportStatus({ kind: 'ok', msg: '已导出 · 记住口令，导入时需要它' });
    } catch (e) {
      setExportStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      setImportStatus({ kind: 'err', msg: '请先选择备份文件' });
      return;
    }
    if (!importPass) {
      setImportStatus({ kind: 'err', msg: '请输入导出时设置的口令' });
      return;
    }
    setImportStatus({ kind: 'busy' });
    try {
      const text = await importFile.text();
      const bundle = await decryptBundle(text, importPass);
      const { merged } = await importState(bundle.stateJson);
      restoreLocalStorage(bundle.localStorage);
      setImportStatus({ kind: 'ok', msg: `已合并 ${merged.length} 项 · 重启 App 生效` });
    } catch (e) {
      setImportStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  return (
    <div className="set-root">
      {/* ── 背景层 ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="set-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* top-hud（y=24） */}
        <header className="set-hud">
          <span className="set-hud-title">SETTINGS // CONFIG</span>
          <button className="set-close" onClick={onClose} aria-label="关闭" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* section-0：本地自动备份（960×180 @ y=120） */}
        <section className="set-section">
          <h3 className="set-section-title">本地自动备份</h3>
          <p className="set-section-hint">每日自动备份会话快照到本地目录</p>
          <div className="set-path" title={backupDir}>{backupDir}</div>
          <div className="set-section-actions">
            <span className="set-stat-tag">
              <span className="set-stat-label">BACKUPS</span>
              <span className="set-stat-value">{backupCount}</span>
            </span>
            <button
              className="set-btn"
              onClick={() => void handleBackupNow()}
              disabled={backupStatus.kind === 'busy'}
            >
              {backupStatus.kind === 'busy' ? '备份中…' : '立即备份'}
            </button>
          </div>
          <StatusLine status={backupStatus} />
        </section>

        {/* section-1：导出会话快照（960×180 @ y=340） */}
        <section className="set-section">
          <h3 className="set-section-title">导出会话快照</h3>
          <p className="set-section-hint">加密导出全部凭据 + 收藏 + 偏好</p>
          <div className="set-section-actions">
            <button
              className="set-btn set-btn--accent"
              onClick={() => void handleExport()}
              disabled={exportStatus.kind === 'busy'}
            >
              {exportStatus.kind === 'busy' ? '导出中…' : '导出加密快照'}
            </button>
          </div>
          <label className="set-label">口令（自动生成，可修改）</label>
          <div className="set-input-row">
            <input
              type="text"
              className="set-input"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
            />
            <button
              className="set-btn-ghost"
              onClick={() => setExportPass(generatePassphrase())}
              title="重新生成"
            >
              ↻
            </button>
          </div>
          <StatusLine status={exportStatus} />
        </section>

        {/* section-2：导入并合并（960×180 @ y=560） */}
        <section className="set-section">
          <h3 className="set-section-title">导入并合并</h3>
          <p className="set-section-hint">从 .maestro-backup 文件恢复数据</p>
          <label className="set-label">备份文件</label>
          <input
            type="file"
            accept=".maestro-backup,application/octet-stream"
            className="set-file-input"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          />
          <label className="set-label">口令</label>
          <input
            type="password"
            className="set-input"
            placeholder="导出时设置的口令"
            value={importPass}
            onChange={(e) => setImportPass(e.target.value)}
          />
          <div className="set-section-actions">
            <button
              className="set-btn"
              onClick={() => void handleImport()}
              disabled={importStatus.kind === 'busy'}
            >
              {importStatus.kind === 'busy' ? '导入中…' : '导入并合并'}
            </button>
          </div>
          <StatusLine status={importStatus} />
        </section>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle' || status.kind === 'busy') return null;
  return (
    <div className={`set-status set-status--${status.kind}`} role="status">
      {status.msg}
    </div>
  );
}
