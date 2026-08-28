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

const STEPS = [
  '正在导入红心库…',
  '正在分析你的音乐偏好…',
  '正在生成推荐列表…',
  '正在匹配跨平台音源…',
];

export default function RecoLoading({ librarySize, onClose }: Props) {
  const [step, setStep] = useState(0);

  // 步骤自动推进（每 2.4s 推进一步，循环）
  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((s) => (s + 1) % STEPS.length);
    }, 2400);
    return () => window.clearInterval(timer);
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
            <span className="rl-step-label">STEP {step + 1}/{STEPS.length}</span>
            <span className="rl-step-desc">{STEPS[step]}</span>
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
