/**
 * 快捷键速查面板（specs/shortcut-cheatsheet/）。
 *
 * 面板的价值全在**「列出来的就是真的」**——所以用例盯两件事：
 *  1. App 内快捷键的条目**等于** `APP_SHORTCUTS`（不是手抄的第二份）
 *  2. 全局热键**来自主进程**（IPC `shortcuts:global`），不是 renderer 硬编码
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ShortcutModal } from './ShortcutModal';
import { APP_SHORTCUTS } from '../../lib/shortcuts';

const globalShortcuts = vi.hoisted(() => ({
  getGlobalShortcuts: vi.fn(),
}));

beforeEach(() => {
  globalShortcuts.getGlobalShortcuts.mockReset();
  globalShortcuts.getGlobalShortcuts.mockResolvedValue([]);
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    getGlobalShortcuts: globalShortcuts.getGlobalShortcuts,
  };
});

function renderModal() {
  return render(<ShortcutModal open onClose={() => {}} />);
}

describe('ShortcutModal', () => {
  it('App 内快捷键的条目 == 定义表（面板不能少列、也不能多列）', async () => {
    renderModal();
    for (const s of APP_SHORTCUTS) {
      await waitFor(() => expect(screen.getByText(s.keys)).toBeInTheDocument());
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
    // 每条快捷键一个 <kbd>（外加全局热键的 kbd）→ 不该出现定义表之外的键位
    const kbds = screen.getAllByText(/⌘⇧|Space|Esc/).length;
    expect(kbds).toBeGreaterThanOrEqual(APP_SHORTCUTS.length);
  });

  it('全局热键从主进程拉取并渲染（renderer 不硬编码）', async () => {
    // ⚠️ 用 **Electron 的写法**（Right，不是 DOM 的 ArrowRight）——
    //    主进程注册的就是这个串，写错会让 register 抛异常、App 起不来。
    globalShortcuts.getGlobalShortcuts.mockResolvedValue([
      { accelerator: 'Control+Option+Right', label: '下一首' },
      { accelerator: 'Control+Option+Space', label: '播放 / 暂停' },
    ]);
    renderModal();
    await waitFor(() => expect(screen.getByText('下一首')).toBeInTheDocument());
    expect(screen.getByText('⌃⌥→')).toBeInTheDocument();
    // 「播放 / 暂停」在 App 内（Space）和全局（⌃⌥Space）各有一条 → 两处都该出现
    expect(screen.getAllByText('播放 / 暂停').length).toBe(2);
    expect(globalShortcuts.getGlobalShortcuts).toHaveBeenCalled();
  });

  it('没有 electronAPI（浏览器 dev）→ 不崩，显示说明', async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
    renderModal();
    await waitFor(() => expect(screen.getByText(/当前环境没有全局热键/)).toBeInTheDocument());
    // App 内快捷键照常显示
    expect(screen.getByText(APP_SHORTCUTS[0].label)).toBeInTheDocument();
  });

  it('IPC 失败（全局热键拿不到）→ 不崩，显示说明', async () => {
    globalShortcuts.getGlobalShortcuts.mockRejectedValue(new Error('boom'));
    renderModal();
    await waitFor(() => expect(screen.getByText(/当前环境没有全局热键/)).toBeInTheDocument());
    // App 内快捷键照常显示
    expect(screen.getByText(APP_SHORTCUTS[0].label)).toBeInTheDocument();
  });

  it('媒体键单独一段（它走 mediaSession，不是 globalShortcut）', async () => {
    renderModal();
    expect(screen.getByText('媒体键')).toBeInTheDocument();
    expect(screen.getByText(/navigator\.mediaSession/)).toBeInTheDocument();
  });
});
