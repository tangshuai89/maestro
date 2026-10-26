/**
 * 快捷键速查面板（specs/shortcut-cheatsheet/）。
 *
 * ## 为什么需要它
 *
 * App 里已经有一堆快捷键（App 内 5 个 + 全局 6 个 + 媒体键），但**用户不知道
 * 它们存在** —— 只能靠"试出来"。功能盘点里这条是 P3（成本 0.5 天）。
 *
 * ## 数据从哪来（关键：两段真源，互不重叠）
 *
 * | 段 | 真源 | 怎么拿到 |
 * |---|---|---|
 * | App 内快捷键 | `lib/shortcuts.ts` 的 `APP_SHORTCUTS` | 直接 import（同一进程） |
 * | 全局热键 | 主进程 `global-shortcuts.ts` 的 `GLOBAL_SHORTCUTS` | 只读 IPC `shortcuts:global` |
 * | 媒体键 | `navigator.mediaSession` | 说明文字（**不是** globalShortcut） |
 *
 * ⇒ 全局热键**不在 renderer 侧抄一份** —— 抄 = 迟早漂移 = 面板骗用户。
 *
 * ## 媒体键为什么单列一段
 *
 * 媒体键（耳机线控 / 键盘 / 锁屏控制）走 `navigator.mediaSession`，
 * **不能**注册成 `globalShortcut`：Electron 在 macOS 上把媒体键实现成
 * globalShortcut，走同一条 remote command center 通道 —— 一旦注册就会占住
 * 通道并**关掉 Chromium 自己的媒体键处理**（`navigator.mediaSession` 再也
 * 收不到 seek）。这条约束由主进程的 `registerGlobalShortcuts` 用代码守住。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { APP_SHORTCUTS, formatAccelerator, groupShortcuts } from '../../lib/shortcuts';

export interface ShortcutModalProps {
  open: boolean;
  onClose: () => void;
}

interface GlobalShortcut {
  accelerator: string;
  label: string;
}

export function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const [globals, setGlobals] = React.useState<GlobalShortcut[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  // 面板打开时拉一次全局热键清单（主进程的真源）。
  // 浏览器 dev（无 electronAPI）→ 空列表，App 内快捷键照常显示。
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const api = window.electronAPI;
    if (!api?.getGlobalShortcuts) {
      setLoaded(true);
      return;
    }
    void api
      .getGlobalShortcuts()
      .then((list) => {
        if (cancelled) return;
        setGlobals(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setGlobals([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = React.useMemo(() => groupShortcuts(APP_SHORTCUTS), []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>App 内的快捷键，以及 App 不在前台也能用的全局热键</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          {groups.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{g.group}</h3>
              <ul className="flex flex-col gap-1">
                {g.items.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-3">
                    <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-xs">
                      {s.keys}
                    </kbd>
                    <span className="min-w-0 flex-1">
                      {s.label}
                      {s.note && (
                        <span className="ml-1 text-xs text-muted-foreground">（{s.note}）</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section aria-label="全局热键">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">全局热键</h3>
            {globals.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {globals.map((g) => (
                  <li key={g.accelerator} className="flex items-baseline gap-3">
                    <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-xs">
                      {formatAccelerator(g.accelerator)}
                    </kbd>
                    <span className="min-w-0 flex-1">{g.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {loaded ? '当前环境没有全局热键（浏览器 dev 模式）' : '读取中…'}
              </p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              全局热键在 App **不在前台**时也能用。
            </p>
          </section>

          <section aria-label="媒体键">
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">媒体键</h3>
            <p className="text-xs text-muted-foreground">
              耳机线控 / 键盘上的播放、上一首、下一首键，以及 macOS 锁屏控制，走系统媒体通道 （
              <code>navigator.mediaSession</code>）—— 与上面的全局热键是**两条不同的路**。
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
