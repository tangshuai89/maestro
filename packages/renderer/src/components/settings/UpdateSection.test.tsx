import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UpdateSection from './UpdateSection';
import type { UpdateState } from '../../../../electron/src/preload';

/**
 * 设置里的「应用更新」段（specs/auto-update）。
 *
 * 守的是：
 *  ① 状态真源在**主进程**（订阅 `updater:state` + 问一次 `updater:get-state`）
 *  ② 「检查更新」调主进程；「重启并安装」**只在「已就绪」时**出现
 *  ③ 没有 electronAPI（浏览器 dev）⇒ 不炸，显示「不检查更新」
 */
const api = vi.hoisted(() => ({
  getUpdateState: vi.fn(),
  checkForAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  listeners: [] as Array<(s: unknown) => void>,
}));

beforeEach(() => {
  api.getUpdateState.mockReset();
  api.checkForAppUpdate.mockReset();
  api.installAppUpdate.mockReset();
  api.listeners = [];
  api.getUpdateState.mockResolvedValue({ kind: 'idle' });
  api.checkForAppUpdate.mockResolvedValue({ kind: 'checking' });
  api.installAppUpdate.mockResolvedValue({ ok: true });
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    getUpdateState: api.getUpdateState,
    checkForAppUpdate: api.checkForAppUpdate,
    installAppUpdate: api.installAppUpdate,
    onIpc: (channel: string, cb: (s: unknown) => void) => {
      if (channel !== 'updater:state') return () => undefined;
      api.listeners.push(cb);
      return () => {
        api.listeners = api.listeners.filter((l) => l !== cb);
      };
    },
  };
});

/** 模拟主进程推了一个状态。 */
function push(state: UpdateState) {
  for (const l of api.listeners) l(state);
}

describe('UpdateSection', () => {
  it('挂载时问主进程要一次当前状态', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalledTimes(1));
  });

  it('主进程推的状态会显示出来', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalled());
    push({ kind: 'ready', version: '1.2.0' });
    await waitFor(() => expect(screen.getByText(/1\.2\.0 已就绪/)).toBeInTheDocument());
  });

  it('「检查更新」调主进程', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalled());
    screen.getByRole('button', { name: '检查更新' }).click();
    await waitFor(() => expect(api.checkForAppUpdate).toHaveBeenCalledTimes(1));
  });

  it('「已就绪」时才出现「重启并安装」，点了调主进程', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalled());
    // 还只是「有更新」⇒ 不能出现安装按钮（下载还没完）
    push({ kind: 'available', version: '1.2.0' });
    await waitFor(() => expect(screen.getByText(/发现新版本 1\.2\.0/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '重启并安装' })).toBeNull();

    push({ kind: 'ready', version: '1.2.0' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重启并安装' })).toBeInTheDocument(),
    );
    screen.getByRole('button', { name: '重启并安装' }).click();
    await waitFor(() => expect(api.installAppUpdate).toHaveBeenCalledTimes(1));
  });

  it('检查中 ⇒ 按钮禁用且文案是「检查中…」', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalled());
    push({ kind: 'checking' });
    await waitFor(() => expect(screen.getByRole('button', { name: '检查中…' })).toBeDisabled());
  });

  it('出错 ⇒ 显示错误文案（不崩）', async () => {
    render(<UpdateSection />);
    await waitFor(() => expect(api.getUpdateState).toHaveBeenCalled());
    push({ kind: 'error', message: 'No published versions on GitHub' });
    await waitFor(() => expect(screen.getByText(/检查更新失败/)).toBeInTheDocument());
  });

  it('没有 electronAPI（浏览器 dev）⇒ 不炸，也不发请求', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    render(<UpdateSection />);
    await waitFor(() => expect(screen.getByText(/浏览器 dev 模式不检查更新/)).toBeInTheDocument());
    expect(api.getUpdateState).not.toHaveBeenCalled();
  });
});
