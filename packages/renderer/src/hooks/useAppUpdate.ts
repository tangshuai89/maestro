import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '../../../electron/src/preload';

/**
 * 自动更新（specs/auto-update）的渲染层状态。
 *
 * ## 数据从哪来
 *
 * - **初始状态**：挂载时问主进程一次（`updater:get-state`）——
 *   主进程可能在渲染层订阅之前就变了状态（启动时的静默检查）。
 * - **之后的变化**：主进程每次状态变化推 `updater:state` ⇒ 这里订阅。
 *
 * ## 浏览器 dev（没有 electronAPI）
 *
 * ⇒ 状态直接是 `unsupported`，**不发任何请求**（浏览器里没有 main 进程可问）。
 */
export interface AppUpdate {
  state: UpdateState;
  /** 手动检查一次。 */
  check: () => Promise<void>;
  /** 退出并安装已下载的更新。 */
  install: () => Promise<void>;
  /** electron 环境？（浏览器 dev ⇒ false） */
  supported: boolean;
}

const BROWSER_UNSUPPORTED: UpdateState = {
  kind: 'unsupported',
  reason: '浏览器 dev 模式不检查更新',
};

export function useAppUpdate(): AppUpdate {
  const [state, setState] = useState<UpdateState>(BROWSER_UNSUPPORTED);
  const api = typeof window === 'undefined' ? undefined : window.electronAPI;

  useEffect(() => {
    if (!api) {
      setState(BROWSER_UNSUPPORTED);
      return;
    }
    // 先订阅再问初始状态 —— 反过来的话，问的那一瞬间来的事件会丢。
    let dispose: (() => void) | undefined;
    try {
      dispose = api.onIpc?.<UpdateState>('updater:state', (s) => setState(s));
    } catch {
      // 通道不在白名单里（老 preload）⇒ 只靠问一次初始状态
    }
    void api
      .getUpdateState?.()
      .then((s) => setState(s as UpdateState))
      .catch(() => undefined);
    return () => dispose?.();
  }, [api]);

  const check = useCallback(async () => {
    if (!api) return;
    try {
      const next = await api.checkForAppUpdate?.();
      if (next) setState(next as UpdateState);
    } catch {
      // 主进程已经把错误状态推过来了；这里不重复报错
    }
  }, [api]);

  const install = useCallback(async () => {
    if (!api) return;
    try {
      await api.installAppUpdate?.();
    } catch {
      // 同上：状态由主进程推
    }
  }, [api]);

  return { state, check, install, supported: Boolean(api) };
}
