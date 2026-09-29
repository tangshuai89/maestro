import { useState } from 'react';
import type {
  DesktopLyricsPrefsPayload,
  DesktopLyricsState,
} from '../../../electron/src/preload';

/**
 * 桌面歌词浮窗的展示组件（NEXT-ITERATION §7.2）。
 *
 * 纯展示：不碰 <audio>、不发请求、不直接调 electronAPI。所有对外动作都通过
 * props 回调交给入口 `main.tsx`（那里才有 IPC 通道），所以这个组件能整块单测。
 *
 * 层级：当前行（大、高亮、带行内进度） + 下一行（小、45% 透明度做预告）。
 */

export type PaletteName = DesktopLyricsPrefsPayload['palette'];

/** 字号三档 → fontScale。中间档是 spec 的默认值 1。 */
const SIZE_STEPS: Array<{ label: string; scale: number }> = [
  { label: '小', scale: 0.8 },
  { label: '中', scale: 1 },
  { label: '大', scale: 1.35 },
];

const PALETTES: Array<{ id: PaletteName; label: string }> = [
  { id: 'light', label: '亮' },
  { id: 'dark', label: '暗' },
  { id: 'cyan', label: '青' },
  { id: 'amber', label: '琥珀' },
];

export interface DesktopLyricsOverlayProps {
  /** main 推来的播放快照 */
  state: DesktopLyricsState;
  /** main 持有的权威偏好（字号/配色/描边/锁定） */
  prefs: DesktopLyricsPrefsPayload;
  /** 当前曲目有歌词吗？没有就显示提示而不是空白 */
  hasLyrics: boolean;
  onToggleLock: (locked: boolean) => void;
  onPrefs: (patch: Partial<Pick<DesktopLyricsPrefsPayload, 'fontScale' | 'stroke' | 'palette'>>) => void;
  onClose: () => void;
}

/** progress 来自 IPC，防御性夹到 0..1 —— 越界会让进度条撑破窗口。 */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export default function DesktopLyricsOverlay({
  state,
  prefs,
  hasLyrics,
  onToggleLock,
  onPrefs,
  onClose,
}: DesktopLyricsOverlayProps) {
  const [panelOpen, setPanelOpen] = useState(false);

  const showLyrics = hasLyrics && (state.current !== null || state.next !== null);
  const currentSize =
    SIZE_STEPS.reduce((best, step) =>
      Math.abs(step.scale - prefs.fontScale) < Math.abs(best.scale - prefs.fontScale) ? step : best,
    ) ?? SIZE_STEPS[1];

  return (
    <div
      className="lyric-overlay"
      data-palette={prefs.palette}
      data-locked={prefs.locked}
      data-stroke={prefs.stroke ? 'on' : 'off'}
      data-playing={state.playing}
      style={{ '--lyric-scale': prefs.fontScale } as React.CSSProperties}
    >
      {showLyrics ? (
        <>
          {/* 歌名行：`state.title/artist` 从第一天就在 IPC 契约里（useDesktopLyrics
              每次推送都带），但组件一直没读——审查时按"推了没人用的死字段"记下。
              现在把它用上：桌面歌词只有这一处能说明"这是谁的歌"，且多数桌面歌词
              工具都带。刻意做得很轻（默认 45% 透明、跟随字号缩放），不跟歌词抢视线。 */}
          {(state.title || state.artist) && (
            <p className="lyric-song" data-testid="lyric-song">
              {[state.title, state.artist].filter(Boolean).join(' — ')}
            </p>
          )}
          <p className="lyric-line lyric-line--current" data-testid="lyric-current">
            {!state.playing && <span className="lyric-paused-mark">‖</span>}
            {state.current ?? ''}
          </p>
          <div className="lyric-progress" aria-hidden="true">
            <div
              className="lyric-progress__fill"
              style={{ width: `${Math.round(clamp01(state.progress) * 100)}%` }}
            />
          </div>
          <p className="lyric-line lyric-line--next" data-testid="lyric-next">
            {state.next ?? ''}
          </p>
        </>
      ) : (
        <>
          {(state.title || state.artist) && (
            <p className="lyric-song" data-testid="lyric-song">
              {[state.title, state.artist].filter(Boolean).join(' — ')}
            </p>
          )}
          <p className="lyric-empty" data-testid="lyric-empty">
            ♪ 暂无歌词
          </p>
        </>
      )}

      {!prefs.locked && (
        <button
          type="button"
          className="lyric-gear"
          aria-expanded={panelOpen}
          aria-label="桌面歌词设置"
          title="桌面歌词设置"
          onClick={() => setPanelOpen((v) => !v)}
        >
          ⚙
        </button>
      )}

      {panelOpen && !prefs.locked && (
        <div className="lyric-settings" role="group" aria-label="桌面歌词设置">
          <div className="lyric-settings__group">
            <span className="lyric-settings__label">字号</span>
            <div className="lyric-settings__row">
              {SIZE_STEPS.map((step) => (
                <button
                  key={step.label}
                  type="button"
                  className="lyric-chip"
                  aria-pressed={currentSize.label === step.label}
                  onClick={() => onPrefs({ fontScale: step.scale })}
                >
                  {step.label}
                </button>
              ))}
            </div>
          </div>

          <div className="lyric-settings__group">
            <span className="lyric-settings__label">配色</span>
            <div className="lyric-settings__row">
              {PALETTES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="lyric-chip lyric-chip--swatch"
                  aria-pressed={prefs.palette === p.id}
                  aria-label={`配色：${p.label}`}
                  title={p.label}
                  onClick={() => onPrefs({ palette: p.id })}
                />
              ))}
            </div>
          </div>

          <div className="lyric-settings__group">
            <span className="lyric-settings__label">描边</span>
            <div className="lyric-settings__row">
              <button
                type="button"
                className="lyric-chip"
                aria-pressed={prefs.stroke}
                onClick={() => onPrefs({ stroke: !prefs.stroke })}
              >
                {prefs.stroke ? '开' : '关'}
              </button>
              <button
                type="button"
                className="lyric-chip"
                aria-pressed={prefs.locked}
                onClick={() => onToggleLock(!prefs.locked)}
              >
                {prefs.locked ? '已锁定' : '锁定（点击穿透）'}
              </button>
            </div>
          </div>

          <div className="lyric-settings__row">
            <button type="button" className="lyric-chip lyric-chip--close" onClick={onClose}>
              关闭浮窗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
