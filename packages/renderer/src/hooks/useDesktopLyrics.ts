import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeLineWindow } from '../lib/lyrics';
import type { LyricLine } from '../api';
import type {
  DesktopLyricsState,
  DesktopLyricsStatus,
} from '../../../electron/src/preload';

/**
 * 主窗口侧的桌面歌词浮窗接线（NEXT-ITERATION §7.2）。
 *
 * 浮窗是纯展示端：这里算出「当前行 / 下一行 / 行内进度」推给 main，main 转发
 * 到浮窗窗口。**不建第二个播放实例** —— <audio> / Web Audio graph 仍只有主窗口
 * 那一套（和 mini 模式的约束同源）。
 *
 * 去抖：currentTime 每秒好几跳，逐帧推 IPC 没意义。进度按 5% 分桶，其余字段
 * 按值比对，签名不变就不发。
 */

/** 进度分桶粒度：一条歌词平均 4~6s，5% ≈ 250ms 一跳，肉眼跟得上又不刷屏。 */
const PROGRESS_BUCKETS = 20;

export interface UseDesktopLyricsArgs {
  /** 当前曲目的歌词行（useLyrics 的 lyrics，可能还没到 / 为 null） */
  lines: LyricLine[] | null;
  currentTime: number;
  playing: boolean;
  title?: string;
  artist?: string;
}

export function useDesktopLyrics({
  lines,
  currentTime,
  playing,
  title,
  artist,
}: UseDesktopLyricsArgs) {
  const [enabled, setEnabledState] = useState(false);
  const lastSignature = useRef<string>('');

  // 首帧读一次 main 端的真实开关态：Titlebar 图标不能先亮后暗地闪一下。
  useEffect(() => {
    const api = window.electronAPI?.desktopLyrics;
    if (!api) return;
    let active = true;
    // catch 必须有：`desktop-lyrics:status` 是 ipcMain.handle，main 还没 ready
    // 或 handler 抛错就是一个 unhandled rejection（Electron 主进程会把它打到
    // stderr，renderer 里表现为一条红色警告，用户完全看不懂）。读不到就按
    // "浮窗没开" 处理——Titlebar 图标不亮是安全的一侧。
    void api
      .getStatus()
      .then((s: DesktopLyricsStatus) => {
        if (active) setEnabledState(s.enabled);
      })
      .catch(() => {
        if (active) setEnabledState(false);
      });
    // Tray / 浮窗面板改了开关时回灌，保证三个入口（Titlebar / ⌘⇧L / Tray）永远一致。
    const off = api.onChanged((s) => {
      if (active) setEnabledState(s.enabled);
    });
    return () => {
      active = false;
      off();
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    window.electronAPI?.desktopLyrics?.setEnabled(next);
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  // 签名用 useMemo 稳定：currentTime 每跳一次重算一次，值不变就不推。
  const signature = useMemo(() => {
    const w = activeLineWindow(lines, currentTime);
    const bucket = Math.round(w.progress * PROGRESS_BUCKETS);
    return [
      w.current?.text ?? '',
      w.next?.text ?? '',
      playing ? '1' : '0',
      String(bucket),
      lines ? 'l' : '-',
    ].join('|');
  }, [lines, currentTime, playing]);

  useEffect(() => {
    // 先判 enabled 再记签名：否则「关着的时候算出的签名」会把后面那次
    // 「开着 + 同一签名」当成没变化，首帧歌词就永远推不出去。
    if (!enabled) return;
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    const api = window.electronAPI?.desktopLyrics;
    if (!api) return;
    const w = activeLineWindow(lines, currentTime);
    const payload: DesktopLyricsState = {
      playing,
      current: w.current?.text ?? null,
      next: w.next?.text ?? null,
      progress: w.progress,
      title,
      artist,
    };
    api.pushState(payload);
  }, [signature, enabled, lines, currentTime, playing, title, artist]);

  // 关掉浮窗时把签名也清了：下次开启第一帧一定要重推，否则浮窗停在旧歌的歌词上。
  useEffect(() => {
    if (!enabled) lastSignature.current = '';
  }, [enabled]);

  return { enabled, setEnabled, toggle };
}
