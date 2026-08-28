import { useState } from 'react';

/**
 * AETHER ErrorPanel — TheaterView 内联错误面板（AETHER 视觉风格）。
 *
 * 这是 TheaterView 内的播放/传输错误面板，不是全屏。
 * 可展开：一行摘要 → 完整文本 + 复制 + 关闭。
 * 对应 Figma Screen/Error 的 error-panel 子组件语义。
 */

interface Props {
  message: string;
  onClose: () => void;
}

export default function ErrorPanel({ message, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const firstLine = message.split('\n')[0].slice(0, 120);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard 不可用时降级：什么都不做
    }
  };

  return (
    <div className={`err-panel ${expanded ? 'err-panel--expanded' : ''}`}>
      <button
        className="err-summary"
        onClick={() => setExpanded((v) => !v)}
        title="点击查看完整错误"
      >
        <span className="err-icon">⚠</span>
        <span className="err-summary-text">{firstLine}</span>
        <span className="err-toggle">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="err-detail">
          <pre className="err-pre">{message}</pre>
          <div className="err-actions">
            <button className="err-action" onClick={handleCopy} title="复制完整错误信息">
              {copied ? '已复制 ✓' : '复制'}
            </button>
            <button className="err-action" onClick={onClose} title="关闭">
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
