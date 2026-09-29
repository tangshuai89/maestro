import { useEffect, useState } from 'react';
import {
  getStateSnapshot,
  importState,
  triggerBackup,
  getBackupInfo,
  fetchRecoStatus,
  resetRecoKey,
  type RecoStatus,
} from '../../api';
import {
  encryptBundle,
  decryptBundle,
  generatePassphrase,
  type BackupBundle,
} from '../../lib/backup-crypto';
import { collectLocalStorage, restoreLocalStorage } from '../../lib/storage';
import type { PlayerMode } from '../../lib/storage';
import {
  EQ_BANDS,
  EQ_PRESETS,
  sliderMin,
  sliderMax,
  sliderStep,
  type AudioFxPrefs,
} from '../../lib/audioFx';
import RecoKeyModal from './RecoKeyModal';
import ChannelPriorityList from '../settings/ChannelPriorityList';
import AccountsList from '../settings/AccountsList';
import LibraryManager from '../settings/LibraryManager';
import SourceHealthSection from '../settings/SourceHealthSection';

/**
 * AETHER Settings — 设置全屏（Figma 03/Screen/Settings 还原）。
 *
 * §5 Settings 完整化后从 3 节 → 8 节，#6.3 Lite 模式 +1 → 9 节，
 * #7.1 EQ 再 +1 → 10 节：
 *   ① 播放模式（完整 / 迷你 / 极简 —— specs/lite-mode）
 *   ② 音频（EQ 开关 / 8 预置 / 10 滑块 —— specs/audio-fx）
 *   ③ DeepSeek key（状态 + 重置 / 设新 key）
 *   ④ 渠道优先级（拖拽排序 + 保存/重置）
 *   ⑤ 平台账号（4 平台登录态 + 登出）
 *   ⑥ 库管理（每平台独立清空 + 一键全清二次确认）
 *   ⑦ 源连接健康（近 24h 成功率 + 进度条）
 *   ⑧ 本地自动备份
 *   ⑨ 导出会话快照（加密 .maestro-backup）
 *   ⑩ 导入并合并
 *
 * 画布保留 1440×900 缩放，内部用 .set-scroll 可滚动列。
 */

interface Props {
  onClose: () => void;
  /** 当前播放视图（theater / mini / lite）—— 状态在 App，modal 只做选择器。 */
  playerMode: PlayerMode;
  onChangePlayerMode: (mode: PlayerMode) => void;
  /**
   * EQ 偏好的**镜像**（specs/audio-fx §2.1）。modal 自己不持有 EQ 状态：
   * 状态在 usePlayer 里，因为只有它能把增益推到 live BiquadFilter 上。
   * 这里只读它来渲染滑块位置与预置高亮，改动一律回调上去。
   */
  audioFx: AudioFxPrefs;
  onEqEnabled: (enabled: boolean) => void;
  onEqBandGain: (index: number, dB: number) => void;
  onApplyEqPreset: (presetId: string) => void;
}

/** ① 播放模式三态的中文名 + 快捷键提示（specs/lite-mode / specs/mini-player）。 */
const PLAYER_MODE_OPTIONS: Array<{
  mode: PlayerMode;
  label: string;
  hint: string;
}> = [
  { mode: 'theater', label: '完整', hint: 'AETHER 剧场界面（封面 / 歌词 / 推荐卡）' },
  { mode: 'mini', label: '迷你', hint: '底部悬浮播控条 · ⌘⇧M' },
  { mode: 'lite', label: '极简', hint: '只剩歌名 + 切歌 + ✨ 推荐 · ⌘⇧L' },
];

/**
 * dB 读数格式化：`+3.5` / `-2.0` / `0.0`。
 *
 * 0 不带 `+` 号 —— "+0.0" 读起来像"确实推了 0"，而 0 的语义是"没动"，
 * 两者在读数里必须能一眼分开。正负号保留且固定一位小数：
 * 步进是 0.5，一位小数刚好精确表示任何一档，多写是噪音。
 * 写死一位小数（而不是 `String(dB)`）还顺带避免了 0.30000000000000004
 * 这类浮点尾巴出现在 UI 上。
 */
function formatDb(dB: number): string {
  const v = Math.round(dB * 10) / 10;
  const body = Math.abs(v).toFixed(1);
  if (v === 0) return body;
  return v > 0 ? `+${body}` : `-${body}`;
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'err'; msg?: string };

const APP_VERSION = '1.0.0';

export default function SettingsModal({
  onClose,
  playerMode,
  onChangePlayerMode,
  audioFx,
  onEqEnabled,
  onEqBandGain,
  onApplyEqPreset,
}: Props) {
  // ── §5 DeepSeek key 节 ─────────────────────────────────────
  const [recoStatus, setRecoStatus] = useState<RecoStatus | null>(null);
  const [recoKeyStatus, setRecoKeyStatus] = useState<Status>({ kind: 'idle' });
  const [showKeyModal, setShowKeyModal] = useState(false);

  // ── §5 平台账号节 / 库节 / 源健康节内部状态由各自组件管理 ──

  // ── §5 备份节 ──────────────────────────────────────────────
  const [backupDir, setBackupDir] = useState<string>('…');
  const [backupCount, setBackupCount] = useState<number>(0);
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' });

  // ── §5 导出节 ──────────────────────────────────────────────
  const [exportPass, setExportPass] = useState(generatePassphrase());
  const [exportStatus, setExportStatus] = useState<Status>({ kind: 'idle' });

  // ── §5 导入节 ──────────────────────────────────────────────
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
    void fetchRecoStatus()
      .then(setRecoStatus)
      .catch(() => setRecoStatus({ configured: false, librarySize: 0 }));
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

  // ── 备份节 handler ─────────────────────────────────────────
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

  // ── 导出节 handler ─────────────────────────────────────────
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

  // ── 导入节 handler ─────────────────────────────────────────
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

  // ── §5 DeepSeek key 节 handler ──────────────────────────────
  const handleResetRecoKey = async () => {
    setRecoKeyStatus({ kind: 'busy' });
    try {
      await resetRecoKey();
      setRecoStatus({ configured: false, librarySize: 0 });
      setRecoKeyStatus({ kind: 'ok', msg: 'DeepSeek key 已清空' });
    } catch (e) {
      setRecoKeyStatus({ kind: 'err', msg: (e as Error).message });
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
        {/* top-hud */}
        <header className="set-hud">
          <span className="set-hud-title">SETTINGS // CONFIG</span>
          <button className="set-close" onClick={onClose} aria-label="关闭" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* 可滚动主体（10 节） */}
        <div className="set-scroll">
          {/* ① 播放模式 */}
          <section className="set-section set-section--compact">
            <h3 className="set-section-title">播放模式</h3>
            <p className="set-section-hint">
              切换即时生效并记住选择 · 播放进度与队列不受影响
            </p>
            <div className="set-mode-group" role="group" aria-label="播放模式">
              {PLAYER_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  className={`set-btn${
                    playerMode === opt.mode ? ' set-btn--accent' : ''
                  }`}
                  aria-pressed={playerMode === opt.mode}
                  title={opt.hint}
                  onClick={() => onChangePlayerMode(opt.mode)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>


          {/* ② 音频（EQ）—— specs/audio-fx */}
          <section className="set-section set-section--compact audio-fx">
            <h3 className="set-section-title">音频</h3>
            <p className="set-section-hint">
              10 段均衡器 · 改动即时生效并记住，关掉 EQ 时曲线仍保留在下面
            </p>

            <div className="audio-fx-actions">
              <button
                type="button"
                className={`set-btn${audioFx.eqEnabled ? ' set-btn--accent' : ''}`}
                aria-pressed={audioFx.eqEnabled}
                onClick={() => onEqEnabled(!audioFx.eqEnabled)}
              >
                {audioFx.eqEnabled ? 'EQ 开' : 'EQ 关'}
              </button>
              <div className="audio-fx-presets" role="group" aria-label="EQ 预置">
                {EQ_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`set-btn${
                      audioFx.presetId === preset.id ? ' set-btn--accent' : ''
                    }`}
                    aria-pressed={audioFx.presetId === preset.id}
                    title={preset.hint}
                    onClick={() => onApplyEqPreset(preset.id)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 手动拖过滑块后 presetId 变成 null，于是没有任何预置高亮 ——
                这就是"已修改"的表达。不额外加提示文字：AETHER 的视觉语言里
                多一句解释不如让状态自己说话（见 spec §2.1）。 */}
            <div
              className={`audio-fx-bands${audioFx.eqEnabled ? '' : ' is-bypassed'}`}
              role="group"
              aria-label="EQ 频段增益"
            >
              {EQ_BANDS.map((band, i) => (
                <div className="audio-fx-band" key={band.hz}>
                  <span className="audio-fx-band-label">{band.label}</span>
                  <input
                    className="audio-fx-slider"
                    type="range"
                    aria-label={`${band.label} Hz`}
                    min={sliderMin}
                    max={sliderMax}
                    step={sliderStep}
                    value={audioFx.eqGains[i]}
                    onChange={(e) => onEqBandGain(i, Number(e.target.value))}
                  />
                  <span className="audio-fx-band-db">{formatDb(audioFx.eqGains[i])}</span>
                </div>
              ))}
            </div>

            {/* EQ 关着的时候要说清"还能拖"：滑块没被禁用，但声音不变，
                用户拖了没反应会以为坏了。 */}
            {!audioFx.eqEnabled && (
              <p className="audio-fx-note">
                EQ 已关闭 —— 滑块仍可调整，改动会保留，但当前不参与出声。
              </p>
            )}

            {/* 诚实提示（spec §1.1 / §4 验收）：WPS 由 SDK 自己解码输出，
                renderer 的 <audio> 不参与，所以这条路径上 EQ 一定无效。
                写成"适用范围"而不是"bug"——它不是缺陷，是路径的客观边界。 */}
            <p className="set-section-hint">
              适用范围：Spotify Premium 全曲（WPS）路径下 EQ 不生效 —— 该路径由 SDK 直接解码输出
            </p>
          </section>

          {/* ③ DeepSeek key */}
          <section className="set-section">
            <h3 className="set-section-title">DeepSeek API key</h3>
            <p className="set-section-hint">
              AI 推荐需要的密钥，只存在本机 .storage/secrets.json，不上传任何服务器
            </p>
            <div className="set-row">
              <span
                className="set-row-platform"
                style={{ background: 'linear-gradient(135deg,#4b9eff,#0050b3)' }}
              >
                DEEPSEEK
              </span>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div className="set-row-name">
                  {recoStatus === null
                    ? '正在读取…'
                    : recoStatus.configured
                      ? '已配置 · 推荐可用'
                      : '未配置'}
                </div>
                <div className="set-row-meta">
                  {recoStatus?.configured
                    ? `基于你的 ${recoStatus.librarySize} 首 liked 库做推荐`
                    : '设了 key 就能用「AI 推荐」功能'}
                </div>
              </div>
              <button
                className="set-btn-sm"
                onClick={() => setShowKeyModal(true)}
                title={recoStatus?.configured ? '换一个新 key' : '设置 key'}
              >
                {recoStatus?.configured ? '换 key' : '设置'}
              </button>
              <button
                className="set-btn-sm set-btn--danger"
                onClick={() => void handleResetRecoKey()}
                disabled={!recoStatus?.configured || recoKeyStatus.kind === 'busy'}
                title="清掉 DeepSeek key"
                style={{ marginLeft: 8 }}
              >
                重置
              </button>
            </div>
            <StatusLine status={recoKeyStatus} />
          </section>

          {/* ④ 渠道优先级 */}
          <section className="set-section">
            <h3 className="set-section-title">渠道优先级</h3>
            <p className="set-section-hint">
              决定同名曲目优先选哪个平台播放。从列表移除某平台 = 该平台永不被自动选中
            </p>
            <ChannelPriorityList />
          </section>

          {/* ⑤ 平台账号 */}
          <section className="set-section">
            <h3 className="set-section-title">平台账号</h3>
            <p className="set-section-hint">各音乐平台的登录态 · 未登录时不能跨平台匹配 ❤</p>
            <AccountsList />
          </section>

          {/* ⑥ 库管理 */}
          <section className="set-section">
            <h3 className="set-section-title">库管理</h3>
            <p className="set-section-hint">
              管理已导入的「我的喜欢」库 · 各平台远程收藏不会被删除
            </p>
            <LibraryManager />
          </section>

          {/* ⑦ 源连接健康 */}
          <section className="set-section set-section--compact">
            <h3 className="set-section-title">源连接健康</h3>
            <p className="set-section-hint">近 24h 每个平台的搜索成功率（进程内计数）</p>
            <SourceHealthSection />
          </section>

          {/* ⑧ 本地自动备份 */}
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

          {/* ⑨ 导出会话快照 */}
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

          {/* ⑩ 导入并合并 */}
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

      {/* 重新设置 DeepSeek key 弹窗（共用 RecoKeyModal） */}
      {showKeyModal && (
        <RecoKeyModal
          onSave={() => {
            setShowKeyModal(false);
            void fetchRecoStatus().then(setRecoStatus);
          }}
          onClose={() => setShowKeyModal(false)}
        />
      )}
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