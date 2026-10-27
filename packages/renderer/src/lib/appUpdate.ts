import type { UpdateState } from '../../../electron/src/preload';

/**
 * 更新状态的**人话描述**（纯展示）。
 *
 * ⚠️ 为什么在渲染层而不是 electron 侧：这段文案只给界面看，
 * electron 那边用不上 ⇒ 放两边各一份就是**复制品**（改一处忘另一处）。
 * （状态**类型** `UpdateState` 还是在 electron/preload 里 —— 那是 IPC 载荷的
 * 形状，跨包用 `import type` 共享，**运行时**不共享。）
 */
export function describeUpdateState(state: UpdateState): string {
  switch (state.kind) {
    case 'idle':
      return '还没检查过更新';
    case 'unsupported':
      return state.reason;
    case 'checking':
      return '正在检查更新…';
    case 'not-available':
      return state.version ? `已是最新版本（${state.version}）` : '已是最新版本';
    case 'available':
      return `发现新版本 ${state.version}${state.notes ? ' —— 正在下载' : ''}`;
    case 'downloading':
      return `正在下载新版本…${state.percent}%`;
    case 'ready':
      return `新版本 ${state.version} 已就绪 —— 重启即可安装`;
    case 'error':
      return `检查更新失败：${state.message}`;
  }
}

/** 当前状态是否意味着「有更新可以装」。 */
export function isInstallable(state: UpdateState): boolean {
  return state.kind === 'ready';
}
