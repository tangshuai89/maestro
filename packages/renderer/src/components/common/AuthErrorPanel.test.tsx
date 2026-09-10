/**
 * AuthErrorPanel.test.tsx — 登录失败恢复全屏。
 *
 * 行为契约：
 *  1. error=null → 不渲染任何内容
 *  2. 渲染 FRIENDLY 文案（中文友好提示）
 *  3. SEVERITY 标签：FATAL/WARN/INFO 三色
 *  4. 粘贴 cookie 按钮：仅 provider=qq/netease 且传了 onPasteCookie 时显示
 *  5. 展开 stack trace：message 含 \n 时用 <pre>，否则用普通 div
 *  6. ESC 调 onDismiss
 *  7. 5 个按钮：重试 / 重新登录 / 粘贴cookie / 切换音源 / 关闭
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import AuthErrorPanel from './AuthErrorPanel';
import type { AuthError } from '../../auth/types';

const baseErr: AuthError = {
  code: 'AUTH_TIMEOUT',
  message: '登录超时',
  provider: 'qq',
  attemptId: 'a-1',
  at: Date.now(),
};

describe('AuthErrorPanel', () => {
  it('error=null 不渲染', () => {
    const { container } = render(
      <AuthErrorPanel
        provider="qq"
        error={null}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('渲染 FRIENDLY 中文文案 + 错误码标签', () => {
    render(
      <AuthErrorPanel
        provider="qq"
        error={baseErr}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/登录超时/)).toBeInTheDocument();
    expect(screen.getByText('AUTH_TIMEOUT')).toBeInTheDocument();
    // WARN severity
    expect(screen.getByText('WARN')).toBeInTheDocument();
  });

  it('AUTH_INVALID 显示 FATAL', () => {
    render(
      <AuthErrorPanel
        provider="spotify"
        error={{ ...baseErr, code: 'AUTH_INVALID' }}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('FATAL')).toBeInTheDocument();
    expect(screen.getByText(/凭据无效/)).toBeInTheDocument();
  });

  it('粘贴 cookie：qq + onPasteCookie → 显示；spotify → 不显示', () => {
    const onPaste = vi.fn();
    const { rerender } = render(
      <AuthErrorPanel
        provider="qq"
        error={baseErr}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onPasteCookie={onPaste}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('粘贴 cookie')).toBeInTheDocument();

    rerender(
      <AuthErrorPanel
        provider="spotify"
        error={baseErr}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onPasteCookie={onPaste}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText('粘贴 cookie')).not.toBeInTheDocument();
  });

  it('粘贴 cookie：qq 但未传 onPasteCookie → 也不显示', () => {
    render(
      <AuthErrorPanel
        provider="qq"
        error={baseErr}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText('粘贴 cookie')).not.toBeInTheDocument();
  });

  it('message 含 \\n 时展开后用 <pre>；不含时用普通 div', () => {
    const { rerender } = render(
      <AuthErrorPanel
        provider="qq"
        error={{ ...baseErr, message: '单行' }}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('展开详情'));
    // 单行 → .aep-detail
    expect(document.querySelector('.aep-detail')).toBeInTheDocument();
    expect(document.querySelector('.aep-stack')).not.toBeInTheDocument();

    // 收起后 rerender（按钮的 aria-label 也会重置）
    fireEvent.click(screen.getByLabelText('收起详情'));
    rerender(
      <AuthErrorPanel
        provider="qq"
        error={{ ...baseErr, message: 'line1\nline2' }}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('展开详情'));
    expect(document.querySelector('.aep-stack')).toBeInTheDocument();
  });

  it('5 个操作按钮各自调对应回调', () => {
    const onRetry = vi.fn();
    const onReLogin = vi.fn();
    const onSwitch = vi.fn();
    const onPaste = vi.fn();
    const onDismiss = vi.fn();
    render(
      <AuthErrorPanel
        provider="qq"
        error={baseErr}
        onRetry={onRetry}
        onReLogin={onReLogin}
        onSwitch={onSwitch}
        onPasteCookie={onPaste}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('重试'));
    fireEvent.click(screen.getByText('重新登录'));
    fireEvent.click(screen.getByText('粘贴 cookie'));
    fireEvent.click(screen.getByText('切换音源'));
    fireEvent.click(screen.getByText('关闭'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onReLogin).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('按 ESC 调 onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <AuthErrorPanel
        provider="qq"
        error={baseErr}
        onRetry={() => {}}
        onReLogin={() => {}}
        onSwitch={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
