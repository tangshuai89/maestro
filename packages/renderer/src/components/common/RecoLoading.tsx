import { useEffect, useState } from 'react';

/**
 * AETHER RecoLoading — AI 推荐生成中全屏（Figma 03/Screen/RecoLoading 还原）。
 *
 * 设计稿结构（1440×900，node 408:1402）：
 *  - backdrop（星云 + 地平线，复用 th-bg）
 *  - top-hud（DEEP.SEEK // NEURAL FEED + close 按钮）
 *  - 中央 Card/Neural × 3（skeleton 占位，pulse 动画）
 *  - 进度条 + STEP 文案
 *  - 底部 Tag/Stat（库内歌曲数 + MATCH%）
 *
 * 这是一个纯展示组件：父组件传 recoRunning / librarySize / step / onClose。
 * 推荐完成后父组件卸载本组件，TheaterView 接管展示结果。
 */

interface Props {
  librarySize: number;
  onClose?: () => void;
}

/**
 * 阶段文案按服务端 v2 链路的真实阶段排（口味档案 → 找相似歌手与候选 →
 * 挑选 → 填源），由**已耗时**推进、走到最后一步就停住——原来是无脑循环播放，
 * 用户等 20s 会看到文案绕回第一句，反而像是卡住了。
 */
const STEPS = [
  { until: 2_500, label: '正在读取你的口味档案…' },
  { until: 7_000, label: '正在找相似歌手与候选…' },
  { until: 14_000, label: '正在挑选并核对音源…' },
  { until: Number.POSITIVE_INFINITY, label: '正在填实可播音源…' },
];

export default function RecoLoading({ librarySize, onClose }: Props) {
  // 累计等待时长 → 推阶段。用真实耗时而不是固定间隔循环。
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const step = STEPS.findIndex((s) => elapsedMs < s.until);
  const stepIndex = step === -1 ? STEPS.length - 1 : step;

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
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rl-root">
      {/* ── 背景层 ── */}
      <div className="th-bg" aria-hidden="true">
        <div className="th-bg-radial" />
        <div className="th-nebula th-nebula--violet" />
        <div className="th-nebula th-nebula--cyan" />
        <div className="th-nebula th-nebula--acid" />
        <div className="th-horizon" />
      </div>

      {/* ── 1440×900 设计画布 ── */}
      <div className="rl-canvas" style={{ ['--canvas-scale' as string]: String(canvasScale) }}>
        {/* top-hud（y=24） */}
        <header className="rl-hud">
          <span className="rl-hud-title">DEEP.SEEK // NEURAL FEED</span>
          {onClose && (
            <button className="rl-close" onClick={onClose} aria-label="关闭" title="关闭">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </header>

        {/* 中央 Card/Neural × 3 skeleton（y=300） */}
        <div className="rl-cards" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rl-card" style={{ animationDelay: `${i * 200}ms` }}>
              <div className="rl-card-art" />
              <div className="rl-card-line rl-card-line--title" />
              <div className="rl-card-line rl-card-line--artist" />
              <div className="rl-card-match" />
            </div>
          ))}
        </div>

        {/* 进度条 + STEP 文案（y=560） */}
        <div className="rl-progress" role="status" aria-live="polite">
          <div className="rl-progress-bar" aria-hidden="true" />
          <div className="rl-progress-text">
            <span className="rl-step-label">STEP {stepIndex + 1}/{STEPS.length}</span>
            <span className="rl-step-desc">
              {STEPS[stepIndex].label}
              {elapsedMs >= 4_000 && (
                <span className="rl-step-elapsed"> ({Math.round(elapsedMs / 1000)}s)</span>
              )}
            </span>
          </div>
        </div>

        {/* 底部 Tag/Stat（y=640） */}
        <div className="rl-stats">
          <span className="rl-stat">
            <span className="rl-stat-label">LIBRARY</span>
            <span className="rl-stat-value">
              {librarySize > 0 ? librarySize.toLocaleString() : '…'}
            </span>
          </span>
          <span className="rl-stat rl-stat--accent">
            <span className="rl-stat-label">MATCH</span>
            <span className="rl-stat-value">PENDING</span>
          </span>
        </div>
      </div>
    </div>
  );
}
