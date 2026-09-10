/**
 * SettingsModal.test.tsx — AETHER 设置全屏。
 *
 * 行为契约：
 *  1. 挂载时 useEffect 调 getBackupInfo 拿 backupDir + count
 *  2. 拿不到时显示「（无法读取备份目录）」
 *  3. 按 ESC 调 onClose
 *  4. 「立即备份」 → triggerBackup 成功 → 显示「已备份 · 共 N 份」
 *  5. 「立即备份」失败 → 显示 err 状态 + 错误消息
 *  6. 「导出加密快照」 → getStateSnapshot + encryptBundle + a.click
 *  7. 「导入并合并」需先选文件 + 输入口令；缺一显示对应 err
 *  8. 「导入并合并」成功 → decryptBundle + importState + restoreLocalStorage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── mocks ──────────────────────────────────────────────────────
// vi.mock 会 hoist 到文件顶部，工厂闭包访问的变量必须用 vi.hoisted
// 同步声明。所有 vi.fn() 都给默认 mock 行为；用例里可用 mockResolvedValue
// 等覆盖。
const mocks = vi.hoisted(() => ({
  getBackupInfo: vi.fn(() => Promise.resolve({ backupDir: '/default', backupCount: 0 })),
  triggerBackup: vi.fn(() => Promise.resolve({ path: '/default/0.zip', count: 0 })),
  getStateSnapshot: vi.fn(() => Promise.resolve({ stateJson: '{}' })),
  importState: vi.fn(() => Promise.resolve({ merged: [] })),
  encryptBundle: vi.fn(() => Promise.resolve(new Uint8Array([0]))),
  decryptBundle: vi.fn(() =>
    Promise.resolve({
      manifest: { version: 1, exportedAt: '2026-01-01', appVersion: '1.0.0' },
      stateJson: '{}',
      localStorage: {},
    }),
  ),
  collectLocalStorage: vi.fn(() => ({ theme: 'dark' })),
  restoreLocalStorage: vi.fn(),
}));
const {
  getBackupInfo: mockGetBackupInfo,
  triggerBackup: mockTriggerBackup,
  getStateSnapshot: mockGetStateSnapshot,
  importState: mockImportState,
  encryptBundle: mockEncryptBundle,
  decryptBundle: mockDecryptBundle,
  collectLocalStorage: mockCollectLocalStorage,
  restoreLocalStorage: mockRestoreLocalStorage,
} = mocks;

vi.mock('../../api', () => ({
  // 直接传 vi.fn，调用时返回 mock 配的 resolved value
  // （不能套 () => mocks.fn() 否则 vi.fn 默认返回 undefined，.then 报 TypeError）
  getBackupInfo: mocks.getBackupInfo,
  triggerBackup: mocks.triggerBackup,
  getStateSnapshot: mocks.getStateSnapshot,
  importState: mocks.importState,
}));

// backup-crypto 替换 IO 路径（encrypt/decrypt 用 crypto.subtle 走真实流程，
// 但测试只关心是否调用 + 返回值；crypto.subtle 在 happy-dom 下也偶发 flakiness）
// 保留 generatePassphrase/type 走真模块。
vi.mock('../../lib/backup-crypto', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/backup-crypto')>(
      '../../lib/backup-crypto',
    );
  return {
    ...actual,
    encryptBundle: mocks.encryptBundle,
    decryptBundle: mocks.decryptBundle,
  };
});

vi.mock('../../lib/storage', () => ({
  collectLocalStorage: mocks.collectLocalStorage,
  restoreLocalStorage: mocks.restoreLocalStorage,
}));

// click spy on <a>（导出流程依赖 a.click）
const clickSpy = vi.fn();
const realCreateElement = document.createElement.bind(document);
beforeEach(() => {
  // 用 mockClear 而不是 mockReset——后者会清掉 vi.hoisted 里设的默认实现
  mockGetBackupInfo.mockClear();
  mockTriggerBackup.mockClear();
  mockGetStateSnapshot.mockClear();
  mockImportState.mockClear();
  mockEncryptBundle.mockClear();
  mockDecryptBundle.mockClear();
  mockCollectLocalStorage.mockClear();
  mockRestoreLocalStorage.mockClear();
  clickSpy.mockReset();

  // 默认 a.click 不炸
  document.createElement = ((tag: string) => {
    const el = realCreateElement(tag) as HTMLElement;
    if (tag === 'a') {
      (el as HTMLAnchorElement).click = clickSpy;
    }
    return el;
  }) as typeof document.createElement;
});

import SettingsModal from './SettingsModal';

describe('SettingsModal', () => {
  it('挂载时调 getBackupInfo；成功时显示 backupDir 和 count', async () => {
    mockGetBackupInfo.mockResolvedValue({
      backupDir: '/Users/me/.maestro/backups',
      backupCount: 5,
    });
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/Users/me/.maestro/backups')).toBeInTheDocument();
    });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('getBackupInfo 失败时显示「（无法读取备份目录）」', async () => {
    mockGetBackupInfo.mockRejectedValue(new Error('EACCES'));
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/无法读取备份目录/)).toBeInTheDocument();
    });
  });

  it('按 ESC 调 onClose', () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('「立即备份」成功 → status 显示「已备份 · 共 N 份」', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockTriggerBackup.mockResolvedValue({ path: '/x/1.zip', count: 7 });
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /立即备份/ });
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/已备份.*共 7 份/)).toBeInTheDocument();
    });
    // count 也会更新
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('「立即备份」失败 → status 显示 err + 错误消息', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockTriggerBackup.mockRejectedValue(new Error('disk full'));
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    const btn = screen.getByRole('button', { name: /立即备份/ });
    await userEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText('disk full')).toBeInTheDocument();
    });
  });

  it('「导出加密快照」成功 → 调 getStateSnapshot + encryptBundle + a.click', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockGetStateSnapshot.mockResolvedValue({ stateJson: '{"a":1}' });
    mockEncryptBundle.mockResolvedValue(new Uint8Array([1, 2, 3]));
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /导出加密快照/ }));
    await waitFor(() => {
      expect(mockGetStateSnapshot).toHaveBeenCalled();
    });
    expect(mockEncryptBundle).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/已导出/)).toBeInTheDocument();
    });
  });

  it('「导入并合并」未选文件 → err「请先选择备份文件」', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    const importBtn = screen.getByRole('button', { name: /导入并合并/ });
    await userEvent.click(importBtn);
    await waitFor(() => {
      expect(screen.getByText('请先选择备份文件')).toBeInTheDocument();
    });
    expect(mockDecryptBundle).not.toHaveBeenCalled();
  });

  it('「导入并合并」选了文件但未输口令 → err「请输入导出时设置的口令」', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    // 选文件（input[type=file]）
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'backup.maestro-backup', {
      type: 'application/octet-stream',
    });
    await userEvent.upload(fileInput, file);
    // 不输口令直接点导入
    await userEvent.click(screen.getByRole('button', { name: /导入并合并/ }));
    await waitFor(() => {
      expect(screen.getByText('请输入导出时设置的口令')).toBeInTheDocument();
    });
  });

  it('「导入并合并」完整流程成功 → 显示「已合并 N 项」', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockDecryptBundle.mockResolvedValue({
      manifest: { version: 1, exportedAt: '2026-01-01', appVersion: '1.0.0' },
      stateJson: '{"x":2}',
      localStorage: { theme: 'light' },
    });
    mockImportState.mockResolvedValue({ merged: [{ id: 'a' }, { id: 'b' }] } as never);

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    // 选文件
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'backup.maestro-backup', {
      type: 'application/octet-stream',
    });
    await userEvent.upload(fileInput, file);
    // 输口令（第二个 input[type=password] 是导入口令，第一个是导出）
    const passInputs = document.querySelectorAll('input[type="password"]');
    await userEvent.type(passInputs[passInputs.length - 1] as HTMLInputElement, 'my-pass');
    // 点导入
    await userEvent.click(screen.getByRole('button', { name: /导入并合并/ }));
    await waitFor(() => {
      expect(screen.getByText(/已合并 2 项/)).toBeInTheDocument();
    });
    expect(mockDecryptBundle).toHaveBeenCalled();
    expect(mockImportState).toHaveBeenCalledWith('{"x":2}');
    expect(mockRestoreLocalStorage).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('「导入并合并」decryptBundle 抛错 → 显示错误消息', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockDecryptBundle.mockRejectedValue(new Error('wrong password'));

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('/x')).toBeInTheDocument();
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'backup.maestro-backup', {
      type: 'application/octet-stream',
    });
    await userEvent.upload(fileInput, file);
    const passInputs = document.querySelectorAll('input[type="password"]');
    await userEvent.type(passInputs[passInputs.length - 1] as HTMLInputElement, 'bad');
    await userEvent.click(screen.getByRole('button', { name: /导入并合并/ }));
    await waitFor(() => {
      expect(screen.getByText('wrong password')).toBeInTheDocument();
    });
  });
});
