/**
 * NeteaseCookieModal.test.tsx — 网易云扫码登录弹窗（此前 0% 覆盖）。
 *
 * 契约：
 *  1. 挂载 → 调 startNeteaseQr → 显示二维码 + 「打开手机网易云音乐 App 扫码」
 *  2. 轮询 checkNeteaseQr：
 *     - 803（+user）→ 登录成功 → onSuccess(user)，**停止轮询**
 *     - 800 → 二维码过期 → 显示「刷新二维码」按钮
 *     - 802 → 已扫码待确认 → 文案变「已扫码，请在手机上确认登录」
 *  3. 轮询抛错 → 显示错误
 *  4. startNeteaseQr 抛错 → 显示错误 + 「二维码生成失败」
 *  5. 手动粘贴兜底：空 MUSIC_U → 「请粘贴 MUSIC_U」；有值 → loginNeteaseCookie
 *     → 成功调 onSuccess
 *  6. 点关闭 / 点遮罩 → onClose；点弹窗**内部**不关（stopPropagation）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  startNeteaseQr: vi.fn(),
  checkNeteaseQr: vi.fn(),
  loginNeteaseCookie: vi.fn(),
}));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    startNeteaseQr: mocks.startNeteaseQr,
    checkNeteaseQr: mocks.checkNeteaseQr,
    loginNeteaseCookie: mocks.loginNeteaseCookie,
  };
});

import NeteaseCookieModal from './NeteaseCookieModal';

const QR = 'data:image/png;base64,AAA';
const USER = { id: 'u1', nickname: '小明' };

/** 推进 1500ms 触发一次轮询。 */
async function poll() {
  await act(async () => {
    vi.advanceTimersByTime(1500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.startNeteaseQr.mockReset().mockResolvedValue({ key: 'k1', qrImg: QR });
  mocks.checkNeteaseQr.mockReset().mockResolvedValue({ code: 801 });
  mocks.loginNeteaseCookie.mockReset().mockResolvedValue({ success: true, user: USER });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NeteaseCookieModal', () => {
  it('挂载 → 生成二维码 + 提示扫码', async () => {
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(mocks.startNeteaseQr).toHaveBeenCalled();
    expect(screen.getByAltText('网易云登录二维码')).toHaveAttribute('src', QR);
    expect(screen.getByText('打开手机网易云音乐 App 扫码')).toBeInTheDocument();
  });

  it('轮询 803 → 登录成功 → onSuccess(user)', async () => {
    const onSuccess = vi.fn();
    mocks.checkNeteaseQr.mockResolvedValue({ code: 803, user: USER });
    render(<NeteaseCookieModal onSuccess={onSuccess} onClose={vi.fn()} />);
    await act(async () => {});
    await poll();
    expect(onSuccess).toHaveBeenCalledWith(USER);
    expect(screen.getByText('登录成功')).toBeInTheDocument();
  });

  it('轮询 800 → 二维码过期 + 出现「刷新二维码」', async () => {
    mocks.checkNeteaseQr.mockResolvedValue({ code: 800 });
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await poll();
    expect(screen.getByText('二维码已过期')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新二维码' })).toBeInTheDocument();
  });

  it('点「刷新二维码」→ 重新调 startNeteaseQr', async () => {
    mocks.checkNeteaseQr.mockResolvedValue({ code: 800 });
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await poll();
    mocks.startNeteaseQr.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }));
    });
    expect(mocks.startNeteaseQr).toHaveBeenCalled();
  });

  it('轮询 802 → 文案变「已扫码，请在手机上确认登录」', async () => {
    mocks.checkNeteaseQr.mockResolvedValue({ code: 802 });
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await poll();
    expect(screen.getByText('已扫码，请在手机上确认登录')).toBeInTheDocument();
  });

  it('轮询抛错 → 显示错误信息', async () => {
    mocks.checkNeteaseQr.mockRejectedValue(new Error('服务不可达'));
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await poll();
    expect(screen.getByText('服务不可达')).toBeInTheDocument();
  });

  it('startNeteaseQr 抛错 → 显示错误 + 「二维码生成失败」', async () => {
    mocks.startNeteaseQr.mockRejectedValue(new Error('生成失败'));
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText('生成失败')).toBeInTheDocument();
    expect(screen.getByText('二维码生成失败')).toBeInTheDocument();
  });

  it('手动粘贴：空 MUSIC_U → 「请粘贴 MUSIC_U」，不发请求', async () => {
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /手动粘贴 Cookie/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });
    expect(screen.getByText('请粘贴 MUSIC_U')).toBeInTheDocument();
    expect(mocks.loginNeteaseCookie).not.toHaveBeenCalled();
  });

  it('手动粘贴：有值 → loginNeteaseCookie → 成功调 onSuccess', async () => {
    const onSuccess = vi.fn();
    render(<NeteaseCookieModal onSuccess={onSuccess} onClose={vi.fn()} />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /手动粘贴 Cookie/ }));
    });
    const input = screen.getByPlaceholderText('从 music.163.com DevTools 复制');
    await act(async () => {
      fireEvent.change(input, { target: { value: '  MUSIC_U_VALUE  ' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });
    // 值要 trim 过再发
    expect(mocks.loginNeteaseCookie).toHaveBeenCalledWith('MUSIC_U_VALUE');
    expect(onSuccess).toHaveBeenCalledWith(USER);
  });

  it('手动粘贴：loginNeteaseCookie 抛错 → 显示错误', async () => {
    mocks.loginNeteaseCookie.mockRejectedValue(new Error('MUSIC_U 无效'));
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /手动粘贴 Cookie/ }));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('从 music.163.com DevTools 复制'), {
        target: { value: 'bad' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });
    expect(screen.getByText('MUSIC_U 无效')).toBeInTheDocument();
  });

  it('点关闭按钮 → onClose', async () => {
    const onClose = vi.fn();
    render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={onClose} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('点遮罩 → onClose；点弹窗内部 → 不关', async () => {
    const onClose = vi.fn();
    const { container } = render(<NeteaseCookieModal onSuccess={vi.fn()} onClose={onClose} />);
    await act(async () => {});
    fireEvent.click(container.querySelector('.qr-modal') as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.qr-modal-overlay') as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
