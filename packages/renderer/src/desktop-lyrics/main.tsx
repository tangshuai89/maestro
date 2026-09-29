import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopLyricsOverlay from './DesktopLyricsOverlay';
import '../styles/desktop-lyrics.scss';
import type { DesktopLyricsPrefsPayload, DesktopLyricsState } from '../../../electron/src/preload';

/**
 * 桌面歌词浮窗入口（NEXT-ITERATION §7.2）。
 *
 * 这是第二个 HTML 入口（lyrics.html）+ 第二个 BrowserWindow，跟主窗口共用
 * preload 和同一份产物。它**不碰 <audio>、不请求后端**：播放快照由主窗口
 * renderer 推给 main、main 再转发到这里（见 hooks/useDesktopLyrics.ts）。
 * 理由是歌词只有一个事实来源 —— 主窗口的 usePlayer —— 浮窗自己再拉一遍
 * 歌词只会引入"两边行号不一致"这类难查的问题。
 */

const EMPTY_STATE: DesktopLyricsState = {
  playing: false,
  current: null,
  next: null,
  progress: 0,
};

const DEFAULT_PREFS: DesktopLyricsPrefsPayload = {
  enabled: true,
  locked: false,
  fontScale: 1,
  stroke: true,
  palette: 'light',
};

function DesktopLyricsApp() {
  const [state, setState] = useState<DesktopLyricsState>(EMPTY_STATE);
  const [prefs, setPrefs] = useState<DesktopLyricsPrefsPayload>(DEFAULT_PREFS);
  const api = window.electronAPI?.desktopLyrics;

  // 播放快照 + 偏好：都只从 main 来，浮窗本地不留副本。
  useEffect(() => {
    if (!api) return;
    const offState = api.onState(setState);
    const offPrefs = api.onPrefs((p) => setPrefs(p));
    return () => {
      offState();
      offPrefs();
    };
  }, [api]);

  /**
   * 锁定 = 点击穿透（main 端 setIgnoreMouseEvents(true, {forward:true})）。
   * forward 把 mousemove 转发进来，于是「鼠标移入 → 临时恢复可交互」就能在
   * 浮窗里做：用户还能点开设置面板，移开后重新穿透。洛雪/WeMod 同一套交互。
   */
  useEffect(() => {
    if (!api || !prefs.locked) return;
    const onEnter = () => api.hover(true);
    const onLeave = () => api.hover(false);
    window.addEventListener('mouseenter', onEnter);
    window.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mouseenter', onEnter);
      window.removeEventListener('mouseleave', onLeave);
      api.hover(false);
    };
  }, [api, prefs.locked]);

  // 没装 preload（浏览器里直接开 lyrics.html 调试）→ 兜个空态，别白屏。
  if (!api) {
    return (
      <div className="lyric-overlay" data-palette="light" data-locked="true" data-stroke="on" data-playing="false">
        <p className="lyric-empty">♪ 需要在 Maestro 桌面端里打开</p>
      </div>
    );
  }

  const hasLyrics = state.current !== null || state.next !== null;

  return (
    <DesktopLyricsOverlay
      state={state}
      prefs={prefs}
      hasLyrics={hasLyrics}
      onToggleLock={(locked) => api.control({ action: 'lock', locked })}
      onPrefs={(patch) => api.control({ action: 'prefs', prefs: patch })}
      onClose={() => api.control({ action: 'close' })}
    />
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <DesktopLyricsApp />
    </StrictMode>,
  );
}
