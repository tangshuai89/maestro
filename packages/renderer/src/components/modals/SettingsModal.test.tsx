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
 *  9. ② 音频（EQ）节：10 滑块 + 8 预置渲染、拖动/点选/开关翻译成回调
 * 10. EQ 的状态归属：presetId=null 时无高亮；WPS 提示与开关状态无关
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EQ_BANDS, EQ_PRESETS, sliderMin, sliderMax, sliderStep } from '../../lib/audioFx';

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
  // §5 新增的 api wrappers（被 SettingsModal 内嵌子组件调用）
  fetchRecoStatus: vi.fn(() =>
    Promise.resolve({ configured: false, librarySize: 0 }),
  ),
  resetRecoKey: vi.fn(() => Promise.resolve({ ok: true })),
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
  fetchRecoStatus: mockFetchRecoStatus,
  resetRecoKey: mockResetRecoKey,
} = mocks;

vi.mock('../../api', () => ({
  // 直接传 vi.fn，调用时返回 mock 配的 resolved value
  // （不能套 () => mocks.fn() 否则 vi.fn 默认返回 undefined，.then 报 TypeError）
  getBackupInfo: mocks.getBackupInfo,
  triggerBackup: mocks.triggerBackup,
  getStateSnapshot: mocks.getStateSnapshot,
  importState: mocks.importState,
  fetchRecoStatus: mocks.fetchRecoStatus,
  resetRecoKey: mocks.resetRecoKey,
}));

// §5 新增的 4 个子组件：mock 占位符，不发网络请求。SettingsModal 集成测试只关心备份/导出/导入流程。
vi.mock('../settings/ChannelPriorityList', () => ({
  default: () => <div data-testid="mock-channel-priority" />,
}));
vi.mock('../settings/AccountsList', () => ({
  default: () => <div data-testid="mock-accounts-list" />,
}));
vi.mock('../settings/LibraryManager', () => ({
  default: () => <div data-testid="mock-library-manager" />,
}));
vi.mock('../settings/SourceHealthSection', () => ({
  default: () => <div data-testid="mock-source-health" />,
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
  mockFetchRecoStatus.mockClear();
  mockResetRecoKey.mockClear();
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

/**
 * Props 一律给全：#7.1 起 Props 有 7 个成员（onClose / playerMode / onChangePlayerMode
 * + EQ 四件套）。这里给的是**默认平直态**，用例要测别的形态就用 over 覆盖。
 * 为什么不在 baseProps 里塞可断言的 spy：现有用例（备份/导出/导入）跟 EQ 无关，
 * 给它们挂没人看的 spy 只会让"哪些用例真的碰了 EQ"变得要看实现才知道。
 */
const flatEq = {
  eqEnabled: false,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  presetId: 'flat',
  crossfadeSec: 0,
};
const baseProps = (over: Partial<React.ComponentProps<typeof SettingsModal>> = {}) => ({
  onClose: () => {},
  playerMode: 'theater' as const,
  onChangePlayerMode: () => {},
  audioFx: flatEq,
  onEqEnabled: () => {},
  onEqBandGain: () => {},
  onApplyEqPreset: () => {},
  ...over,
});

describe('SettingsModal', () => {
  it('挂载时调 getBackupInfo；成功时显示 backupDir 和 count', async () => {
    mockGetBackupInfo.mockResolvedValue({
      backupDir: '/Users/me/.maestro/backups',
      backupCount: 5,
    });
    render(<SettingsModal {...baseProps()} />);
    await waitFor(() => {
      expect(screen.getByText('/Users/me/.maestro/backups')).toBeInTheDocument();
    });
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('getBackupInfo 失败时显示「（无法读取备份目录）」', async () => {
    mockGetBackupInfo.mockRejectedValue(new Error('EACCES'));
    render(<SettingsModal {...baseProps()} />);
    await waitFor(() => {
      expect(screen.getByText(/无法读取备份目录/)).toBeInTheDocument();
    });
  });

  it('按 ESC 调 onClose', () => {
    const onClose = vi.fn();
    render(<SettingsModal {...baseProps({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('「立即备份」成功 → status 显示「已备份 · 共 N 份」', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockTriggerBackup.mockResolvedValue({ path: '/x/1.zip', count: 7 });
    render(<SettingsModal {...baseProps()} />);
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
    render(<SettingsModal {...baseProps()} />);
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
    render(<SettingsModal {...baseProps()} />);
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
    render(<SettingsModal {...baseProps()} />);
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
    render(<SettingsModal {...baseProps()} />);
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

    render(<SettingsModal {...baseProps()} />);
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

  it('① 播放模式：当前态 aria-pressed 点选 → onChangePlayerMode(target)', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    const onChangePlayerMode = vi.fn();
    render(<SettingsModal {...baseProps({ playerMode: 'mini', onChangePlayerMode })} />);
    await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: '迷你' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '极简' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: '极简' }));
    expect(onChangePlayerMode).toHaveBeenCalledWith('lite');
    await userEvent.click(screen.getByRole('button', { name: '完整' }));
    expect(onChangePlayerMode).toHaveBeenLastCalledWith('theater');
  });

  it('「导入并合并」decryptBundle 抛错 → 显示错误消息', async () => {
    mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
    mockDecryptBundle.mockRejectedValue(new Error('wrong password'));

    render(<SettingsModal {...baseProps()} />);
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
  // ── ② 音频（EQ）节 · specs/audio-fx ────────────────────────────
  // 这一组只断言"UI 把用户动作翻译成 usePlayer 的调用"，不断言音频链本身
  // （那在 usePlayer 侧测）。分工理由：SettingsModal 是纯展示 + 回调，
  // 它唯一的失败模式就是"按钮点下去回调参数错"或"某块 UI 压根没渲染"。
  describe('② 音频（EQ）', () => {
    it('渲染出 10 个频段滑块 + 8 个预置按钮', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      render(<SettingsModal {...baseProps()} />);
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      // 10 个 slider —— 数量来自 EQ_BANDS，不在组件里写死
      const sliders = screen.getAllByRole('slider');
      expect(sliders).toHaveLength(EQ_BANDS.length);
      expect(EQ_BANDS).toHaveLength(10);

      // 8 个预置：aria-label="EQ 预置" 的 group 里正好 8 个 button，
      // 且名字与 EQ_PRESETS 的 name 一一对应（少一个就是渲染漏了）
      const presetGroup = screen.getByRole('group', { name: 'EQ 预置' });
      const presetBtns = within(presetGroup).getAllByRole('button');
      expect(presetBtns).toHaveLength(EQ_PRESETS.length);
      expect(EQ_PRESETS).toHaveLength(8);
      expect(presetBtns.map((b) => b.textContent)).toEqual(EQ_PRESETS.map((p) => p.name));

      // 频段标签也在（标签来自 EQ_BANDS，不是组件里另抄一份）
      for (const band of EQ_BANDS) {
        expect(screen.getByText(band.label)).toBeInTheDocument();
      }
    });

    it('滑块的 min/max/step 与 audioFx 常量一致（±12 / 0.5）', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      render(<SettingsModal {...baseProps()} />);
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
      for (const s of sliders) {
        expect(s).toHaveAttribute('min', String(sliderMin));
        expect(s).toHaveAttribute('max', String(sliderMax));
        expect(s).toHaveAttribute('step', String(sliderStep));
      }
      expect([sliderMin, sliderMax, sliderStep]).toEqual([-12, 12, 0.5]);
    });

    it('拖第 3 个滑块 → onEqBandGain(2, 新值)，且值被夹在 ±12 内', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      const onEqBandGain = vi.fn();
      render(<SettingsModal {...baseProps({ onEqBandGain })} />);
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
      // 用 fireEvent.change 而不是 userEvent.type('{arrowright}')：
      // happy-dom 下 userEvent 的键盘路径不会驱动 <input type=range> 的 value，
      // 断言会变成"测的是测试环境的键盘实现"而不是组件行为。change 事件正是
      // 真实拖动滑块时浏览器派发的那一个，也是 React onChange 绑定的那个。
      // 拖到 +6：既不是 0（排除"没触发"）也不是 ±12 边界（排除"只是夹取生效"）
      fireEvent.change(sliders[2], { target: { value: '6' } });

      expect(onEqBandGain).toHaveBeenCalled();
      const [idx, val] = onEqBandGain.mock.calls[0];
      expect(idx).toBe(2);
      expect(typeof val).toBe('number');
      expect(val).toBeGreaterThanOrEqual(sliderMin);
      expect(val).toBeLessThanOrEqual(sliderMax);
      expect(val).not.toBe(0);

      // 反向断言：只有第 3 段被动过，前两段的回调不得出现
      expect(onEqBandGain.mock.calls.every((c: number[]) => c[0] === 2)).toBe(true);
    });

    it('点某个预置 → onApplyEqPreset(该预置 id)', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      const onApplyEqPreset = vi.fn();
      render(<SettingsModal {...baseProps({ onApplyEqPreset })} />);
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const presetGroup = screen.getByRole('group', { name: 'EQ 预置' });
      // 点第 3 个（rock），下标写死是有意的：断言的是"点哪个就传哪个 id"
      const target = within(presetGroup).getAllByRole('button')[2];
      await userEvent.click(target);

      expect(onApplyEqPreset).toHaveBeenCalledTimes(1);
      expect(onApplyEqPreset).toHaveBeenCalledWith('rock');
      // 反查：传出去的 id 必须真的存在于预置表里，否则是 UI 与数据表漂了
      expect(EQ_PRESETS.some((p) => p.id === 'rock')).toBe(true);
    });

    it('点开关 → onEqEnabled(反值)', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      const onEqEnabled = vi.fn();
      // 从「关」出发：第一次点应当要 true
      render(
        <SettingsModal
          {...baseProps({ audioFx: { ...flatEq, eqEnabled: false }, onEqEnabled })}
        />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const btn = screen.getByRole('button', { name: 'EQ 关' });
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(btn);
      expect(onEqEnabled).toHaveBeenCalledWith(true);
    });

    it('EQ 已开时开关文案变成「EQ 开」且 aria-pressed=true', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      const onEqEnabled = vi.fn();
      render(
        <SettingsModal
          {...baseProps({ audioFx: { ...flatEq, eqEnabled: true }, onEqEnabled })}
        />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const btn = screen.getByRole('button', { name: 'EQ 开' });
      expect(btn).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(btn);
      expect(onEqEnabled).toHaveBeenCalledWith(false);
    });

    it('presetId 为 null（已手动改过）→ 8 个预置全部 aria-pressed=false', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      render(
        <SettingsModal {...baseProps({ audioFx: { ...flatEq, presetId: null } })} />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const presetGroup = screen.getByRole('group', { name: 'EQ 预置' });
      const btns = within(presetGroup).getAllByRole('button');
      const pressed = btns.filter((b) => b.getAttribute('aria-pressed') === 'true');
      expect(pressed).toHaveLength(0);
      // className 也要一起断：aria-pressed 管无障碍播报，set-btn--accent 管眼睛看到的高亮。
      // 只断前者的话，"语义上选中了但视觉上没高亮"这种错会一路溜到目视验收才发现 ——
      // 而 UI 目视验收恰恰是本项目最容易被跳过的一环。
      expect(btns.filter((b) => b.className.includes('set-btn--accent'))).toHaveLength(0);
    });

    it('presetId 非 null → 恰好 1 个预置高亮，且是 id 对应的那个', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      render(
        <SettingsModal {...baseProps({ audioFx: { ...flatEq, presetId: 'vocal' } })} />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const presetGroup = screen.getByRole('group', { name: 'EQ 预置' });
      const btns = within(presetGroup).getAllByRole('button');
      const pressed = btns.filter((b) => b.getAttribute('aria-pressed') === 'true');
      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toHaveTextContent('人声');
      // 高亮的 className 也要落在**同一个**按钮上，不能出现"aria 说 A、class 说 B"
      const accented = btns.filter((b) => b.className.includes('set-btn--accent'));
      expect(accented).toHaveLength(1);
      expect(accented[0]).toBe(pressed[0]);
      expect(accented[0]).toHaveTextContent('人声');
    });

    it('EQ 关闭时 WPS 适用范围提示仍然出现（不能被开关状态吞掉）', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      // eqEnabled: false —— 验收要求这条提示与开关状态无关
      render(
        <SettingsModal
          {...baseProps({ audioFx: { ...flatEq, eqEnabled: false, presetId: null } })}
        />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const hint = screen.getByText(/WPS/);
      expect(hint).toBeInTheDocument();
      expect(hint).toHaveClass('set-section-hint');
    });

    it('EQ 关闭时滑块仍可拖（不因旁路被禁用），并额外说明当前不参与出声', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      const onEqBandGain = vi.fn();
      render(
        <SettingsModal
          {...baseProps({
            audioFx: { ...flatEq, eqEnabled: false },
            onEqBandGain,
          })}
        />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
      for (const s of sliders) expect(s).not.toBeDisabled();

      fireEvent.change(sliders[0], { target: { value: '3' } });
      expect(onEqBandGain).toHaveBeenCalledTimes(1);
      expect(onEqBandGain).toHaveBeenCalledWith(0, 3);

      // 旁路提示：解释了"能拖但没声音"，避免用户以为滑块坏了
      expect(screen.getByText(/当前不参与出声/)).toBeInTheDocument();
    });

    it('EQ 开启时不再显示旁路提示', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      render(
        <SettingsModal {...baseProps({ audioFx: { ...flatEq, eqEnabled: true } })} />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());
      expect(screen.queryByText(/当前不参与出声/)).not.toBeInTheDocument();
    });

    it('dB 读数：正数带 +、负数带 -、0 不带符号', async () => {
      mockGetBackupInfo.mockResolvedValue({ backupDir: '/x', backupCount: 0 });
      // 三档读数各占一段：+3.5 / -2 / 0
      const gains = [3.5, -2, 0, 0, 0, 0, 0, 0, 0, 0];
      render(
        <SettingsModal {...baseProps({ audioFx: { ...flatEq, eqGains: gains } })} />,
      );
      await waitFor(() => expect(screen.getByText('/x')).toBeInTheDocument());

      // 标签列和读数列共用同一个数字（"0"既是标签也是读数），所以按
      // .audio-fx-band-db 精确定位而不是 getByText
      const readouts = document.querySelectorAll('.audio-fx-band-db');
      expect(readouts[0]).toHaveTextContent('+3.5');
      expect(readouts[1]).toHaveTextContent('-2.0');
      // 0 是最容易写错的一个：写成 "+0.0" 会让人以为"确实推了 0"
      expect(readouts[2]).toHaveTextContent('0.0');
      expect(readouts[2].textContent).not.toMatch(/[+-]/);
    });
  });
});
