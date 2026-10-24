/**
 * main.test.tsx — 桌面歌词浮窗入口（`desktop-lyrics/main.tsx`）。
 *
 * ## 为什么补这个文件
 *
 * 这个入口整个是 **0% 覆盖**（102 行）—— 它是**第二个 HTML 入口**
 * （`lyrics.html`）+ 第二个 BrowserWindow 的挂载点，**从没被任何测试跑到过**。
 * 覆盖率报告里那一行 `main.tsx | 0 | 0 | 0` 就是它。
 *
 * 它测的东西也不轻：浮窗是**只读镜像**（播放快照由主窗口推给 main、
 * main 再转发过来），一旦订阅/退订/锁定态的 hover 回报写错，
 * 症状是"浮窗关不掉"、"鼠标移进去点不动"、"关掉后穿透还开着" ——
 * 都是**用户能看见、但很难定位**的问题。
 *
 * ## 覆盖的行为契约
 *
 *  1. 没装 preload（浏览器里直接开 `lyrics.html` 调试）→ 兜个空态，**别白屏**
 *  2. 装了 preload → 订阅播放快照 + 样式偏好；**卸载时退订**
 *  3. 锁定态 → `mouseenter` / `mouseleave` → 回报 hover（临时解除点击穿透）
 *  4. 锁定态卸载 → 收尾 `hover(false)`（不留"穿透还开着"的状态）
 *  5. `#root` 存在时，**import 就把浮窗挂上去**（入口接线本身）
 *
 * ## 手法
 *
 * `window.electronAPI` 是 preload 注入的（浏览器里没有）→ 用一个**假 api**
 * 顶上去，并**捕获订阅回调**，这样能主动把"播放快照 / 样式偏好"推进去 ——
 * 模拟 main 推数据的样子。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DesktopLyricsApp } from './main';
import type { DesktopLyricsPrefsPayload, DesktopLyricsState } from '../../../electron/src/preload';

const DEFAULT_PREFS: DesktopLyricsPrefsPayload = {
  enabled: true,
  locked: false,
  fontScale: 1,
  stroke: true,
  palette: 'light',
};

const STATE_WITH_LYRICS: DesktopLyricsState = {
  playing: true,
  current: '第一行歌词',
  next: '第二行歌词',
  progress: 0.5,
  title: '测试曲目',
  artist: '测试歌手',
};

/** 假 preload API：捕获订阅回调，好让测试主动推数据。 */
function makeFakeApi() {
  const offState = vi.fn();
  const offPrefs = vi.fn();
  // ⚠️ 这里**不要**写占位实现（如 `vi.fn((_cb) => offState)`）：
  //   占位实现的形参用不上 → eslint `no-unused-vars` 报 error（CI 会红）；
  //   而且占位实现会被下面的 `mockImplementation` 立刻覆盖，纯多余。
  const onState = vi.fn();
  const onPrefs = vi.fn();
  const hover = vi.fn();
  const control = vi.fn();
  let pushState: ((s: DesktopLyricsState) => void) | null = null;
  let pushPrefs: ((p: DesktopLyricsPrefsPayload) => void) | null = null;
  onState.mockImplementation((cb: (s: DesktopLyricsState) => void) => {
    pushState = cb;
    return offState;
  });
  onPrefs.mockImplementation((cb: (p: DesktopLyricsPrefsPayload) => void) => {
    pushPrefs = cb;
    return offPrefs;
  });
  return {
    api: { onState, onPrefs, hover, control },
    offState,
    offPrefs,
    hover,
    control,
    pushState: (s: DesktopLyricsState): void => pushState?.(s),
    pushPrefs: (p: DesktopLyricsPrefsPayload): void => pushPrefs?.(p),
  };
}

describe('桌面歌词浮窗入口', () => {
  const original = (window as unknown as { electronAPI?: unknown }).electronAPI;

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = original;
    document.body.innerHTML = '';
  });

  it('没装 preload → 兜个空态，别白屏', () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
    render(<DesktopLyricsApp />);
    // 有内容（不是白屏），且明确告诉用户"要在桌面端里打开"
    // ⚠️ 用**文案**找而不是 data-testid：入口的兜底分支写的是
    //    `<p className="lyric-empty">`（**没有** data-testid），
    //    只有 DesktopLyricsOverlay 里那份才有 —— 两处 DOM 契约不一致，
    //    这里不去改生产代码，按现状断言。
    expect(screen.getByText(/需要在 Maestro 桌面端里打开/)).toBeInTheDocument();
  });

  it('装了 preload → 订阅播放快照 + 样式偏好', async () => {
    const fake = makeFakeApi();
    (window as unknown as { electronAPI?: unknown }).electronAPI = { desktopLyrics: fake.api };

    render(<DesktopLyricsApp />);
    expect(fake.api.onState).toHaveBeenCalledTimes(1);
    expect(fake.api.onPrefs).toHaveBeenCalledTimes(1);

    // main 推来播放快照 → 浮窗显示当前行 + 下一行
    fake.pushState(STATE_WITH_LYRICS);
    await waitFor(() => {
      expect(screen.getByTestId('lyric-current')).toHaveTextContent('第一行歌词');
    });
    expect(screen.getByTestId('lyric-next')).toHaveTextContent('第二行歌词');
  });

  it('卸载 → 退订（否则浮窗关不掉，订阅一直挂着）', () => {
    const fake = makeFakeApi();
    (window as unknown as { electronAPI?: unknown }).electronAPI = { desktopLyrics: fake.api };

    const { unmount } = render(<DesktopLyricsApp />);
    expect(fake.offState).not.toHaveBeenCalled();
    expect(fake.offPrefs).not.toHaveBeenCalled();

    unmount();
    expect(fake.offState).toHaveBeenCalledTimes(1);
    expect(fake.offPrefs).toHaveBeenCalledTimes(1);
  });

  it('锁定态 → mouseenter / mouseleave → 回报 hover（临时解除点击穿透）', async () => {
    const fake = makeFakeApi();
    (window as unknown as { electronAPI?: unknown }).electronAPI = { desktopLyrics: fake.api };

    render(<DesktopLyricsApp />);
    fake.pushPrefs({ ...DEFAULT_PREFS, locked: true });
    await waitFor(() => {
      expect(document.querySelector('.lyric-overlay')).toHaveAttribute('data-locked', 'true');
    });

    fireEvent.mouseEnter(window);
    expect(fake.hover).toHaveBeenCalledWith(true);
    fireEvent.mouseLeave(window);
    expect(fake.hover).toHaveBeenCalledWith(false);
  });

  it('锁定态卸载 → 收尾 hover(false)（不留"穿透还开着"的状态）', async () => {
    const fake = makeFakeApi();
    (window as unknown as { electronAPI?: unknown }).electronAPI = { desktopLyrics: fake.api };

    const { unmount } = render(<DesktopLyricsApp />);
    fake.pushPrefs({ ...DEFAULT_PREFS, locked: true });
    await waitFor(() => {
      expect(document.querySelector('.lyric-overlay')).toHaveAttribute('data-locked', 'true');
    });

    unmount();
    expect(fake.hover).toHaveBeenCalledWith(false);
  });

  it('没锁定 → 不注册 hover 监听（不打扰鼠标）', async () => {
    const fake = makeFakeApi();
    (window as unknown as { electronAPI?: unknown }).electronAPI = { desktopLyrics: fake.api };

    render(<DesktopLyricsApp />);
    fake.pushPrefs({ ...DEFAULT_PREFS, locked: false });
    await waitFor(() => {
      expect(document.querySelector('.lyric-overlay')).toHaveAttribute('data-locked', 'false');
    });

    fireEvent.mouseEnter(window);
    expect(fake.hover).not.toHaveBeenCalled();
  });

  it('#root 存在 → import 就把浮窗挂上去（入口接线本身）', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    // 动态 import：让它在 #root 已就位的情况下重新执行入口那段接线
    await import('./main');
    await waitFor(() => {
      expect(document.querySelector('#root')?.children.length ?? 0).toBeGreaterThan(0);
    });
  });
});
