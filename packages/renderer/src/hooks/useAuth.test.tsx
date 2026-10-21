/**
 * useAuth 测试（此前零覆盖）。
 *
 * 覆盖的是**行为契约** —— 对外可见的状态 / 回调 / api 调用参数，
 * 不是 reducer 内部实现细节。
 *
 * 契约清单（编号 → 用例）：
 *
 *  A. 初始状态与挂载行为
 *   A1 挂载（provider 非空）→ 自动拉一次该 provider 的登录态
 *   A2 初始状态：未登录 / 无错误 / 不在登录中
 *   A3 provider 为 null → 不拉登录态，provider 回退成 'qq'
 *   A4 登录态查询成功 → auth.loggedIn / auth.user 同步
 *   A5 登录态查询失败 → 走 setError 通道（不把用户踢下线）
 *
 *  B. provider 切换
 *   B1 切换 provider → 重新拉一次新 provider 的状态
 *   B2 切换 provider → 旧 provider 的登录快照立刻清空（不等新状态）
 *
 *  C. 过期检测（stale probe）
 *   C1 已登录 + 校验时间缺失/超 24h → 触发 validate=1 探针
 *   C2 探针判定 expired → 进入 AUTH_EXPIRED 错误态
 *   C3 校验时间很新（<24h）→ 不打探针
 *   C4 探针失败 → 不把用户踢下线（保持登录态、无错误）
 *   C5 登录成功后的 10min 宽限期内 → 探针报 expired 也压成不误报
 *
 *  D. QQ 登录
 *   D1 没有 Electron 登录 IPC → 明确报错，且不进入登录中
 *   D2 登录成功 → 登录态更新 + loadNextTrack + 上报 ok
 *   D3 用户取消（login_cancelled）→ AUTH_CANCELLED
 *   D4 IPC 抛错 → AUTH_UNKNOWN
 *   D5 后端返回 success:false → 不会误判成登录成功
 *
 *  E. 网易云登录
 *   E1 没有 Electron 登录 IPC → 弹 cookie 兜底弹窗，不打后端
 *   E2 登录成功 → 登录态更新 + loadNextTrack + 上报 ok
 *   E3 登录失败 → AUTH_UNKNOWN
 *   E4 cookie 兜底手动成功 → 登录态更新 + loadNextTrack
 *
 *  F. Spotify 登录
 *   F1 没有 client_id → 收集并提交 client_id
 *   F2 client_id 为空 → AUTH_CANCELLED，且不提交
 *   F3 OAuth 成功 → 兑换 code → 登录态 + tier
 *   F4 OAuth 返回 error（用户拒绝）→ AUTH_CANCELLED
 *   F5 redeem 失败 → AUTH_INVALID
 *   F6 OAuth 回调 2s 超时 → 转 IPC listener + 3s poll 兜底
 *   F7 浏览器兜底轮询 90s 仍未登录 → AUTH_TIMEOUT
 *
 *  G. 定时器
 *   G1 登录尝试 120s 未完成 → 取消（timeout）+ 上报 cancel
 *   G2 登录成功后 120s 不会误杀已登录态
 *
 *  H. 取消 / 重试 / 重置
 *   H1 取消登录 → cancelled(user) + 上报 cancel
 *   H2 重试 → 清错误 + 重新触发对应平台的登录流程
 *   H3 关闭错误面板 → 错误清空
 *   H4 重置登录态 → 快照清空
 *
 *  I. 外部上报登录态失效（markExpired）
 *   I1 宽限期外 → 进入 AUTH_EXPIRED
 *   I2 宽限期内 → 忽略（探针误报保护）
 *
 *  J. 登出
 *   J1 登出 → 调后端 + 本地快照清空
 *   J2 登出接口失败 → 本地快照照样清空
 *
 *  K. OAuth 回调排空
 *   K1 挂载时排空一次 OAuth 回调 buffer（不自动登录）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getAuthStatusExtended: vi.fn(),
  getAuthStatusValidated: vi.fn(),
  getSpotifyStatus: vi.fn(),
  loginNeteaseCookie: vi.fn(),
  loginQqCookie: vi.fn(),
  logout: vi.fn(),
  redeemSpotifyCode: vi.fn(),
  reportAuthEvent: vi.fn(),
  setSpotifyClientId: vi.fn(),
  startSpotify: vi.fn(),
  cancelSpotifyAuth: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...apiMocks };
});

/**
 * preload 桥（window.electronAPI）。
 *
 * 必须在 `import './useAuth'` **之前**挂上：useAuth 在模块加载期就把
 * `window.electronAPI.isElectron` 读成了模块级常量（isElectron）。
 */
const ipc = vi.hoisted(() => {
  const api: Record<string, unknown> = { isElectron: true };
  Object.defineProperty(window, 'electronAPI', {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
});

import { useAuth } from './useAuth';
import { __resetReloginGrace } from '../auth/relogin-grace';
import type { MusicProvider } from '../api';

const ipcMocks = {
  qqLogin: vi.fn(),
  neteaseLogin: vi.fn(),
  openExternal: vi.fn(),
  consumeOAuthCallback: vi.fn(),
  onIpc: vi.fn(),
};

const promptMock = vi.fn();
const openMock = vi.fn();

const loadNextTrack = vi.fn();
const setError = vi.fn();

const QQ_USER = { nickname: 'QQ用户', avatarUrl: 'qq.png', provider: 'qq' } as const;
const NETEASE_USER = { nickname: '网易用户', avatarUrl: 'ne.png', provider: 'netease' } as const;

/** 统一挂载入口。 */
function mount(provider: MusicProvider | null = 'qq') {
  return renderHook(() => useAuth(provider, loadNextTrack, setError));
}

/** 需要切 provider 时用这个（rerender 换 props）。 */
function mountSwitchable(initial: MusicProvider | null) {
  return renderHook(
    (props: { provider: MusicProvider | null }) => useAuth(props.provider, loadNextTrack, setError),
    { initialProps: { provider: initial } },
  );
}

/**
 * 让挂起的 promise 链 + React 渲染全部落地。
 *
 * 为什么需要：waitFor 的第一次检查是**同步**的 —— 条件一成立就立刻 resolve，
 * 此刻 React 可能还没把最近一次 dispatch 渲染出来（读到的还是旧 state）。
 * 这里用一个宏任务边界（setTimeout 0）把所有微任务链跑完，再由 act 收口。
 *
 * 只在**真定时器**的用例里用；假定时器用例里 setTimeout 是假的，会卡死。
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useAuth', () => {
  beforeEach(() => {
    loadNextTrack.mockReset();
    setError.mockReset();

    apiMocks.getAuthStatus.mockReset().mockImplementation(async (p: MusicProvider) => ({
      provider: p,
      loggedIn: false,
      user: null,
    }));
    apiMocks.getAuthStatusExtended.mockReset().mockImplementation(async (p: MusicProvider) => ({
      provider: p,
      loggedIn: false,
      user: null,
      lastValidatedAt: Date.now(),
    }));
    apiMocks.getAuthStatusValidated.mockReset().mockImplementation(async (p: MusicProvider) => ({
      provider: p,
      loggedIn: false,
      user: null,
      lastValidatedAt: Date.now(),
    }));
    apiMocks.getSpotifyStatus
      .mockReset()
      .mockResolvedValue({ hasClientId: true, loggedIn: false, tier: null });
    apiMocks.loginQqCookie.mockReset().mockResolvedValue({ success: true, user: QQ_USER });
    apiMocks.loginNeteaseCookie
      .mockReset()
      .mockResolvedValue({ success: true, user: NETEASE_USER });
    apiMocks.redeemSpotifyCode
      .mockReset()
      .mockResolvedValue({ ok: true, profile: { displayName: 'Spotify用户' } });
    apiMocks.setSpotifyClientId.mockReset().mockResolvedValue({ ok: true, tail: '***' });
    apiMocks.startSpotify
      .mockReset()
      .mockResolvedValue({ authorizeUrl: 'https://accounts.spotify.com/authorize?client_id=x' });
    apiMocks.logout.mockReset().mockResolvedValue(undefined);
    apiMocks.reportAuthEvent.mockReset().mockResolvedValue(undefined);
    apiMocks.cancelSpotifyAuth.mockReset().mockResolvedValue({ ok: true });

    ipcMocks.qqLogin
      .mockReset()
      .mockResolvedValue({ success: true, cookie: 'qq-cookie', uin: '10001' });
    ipcMocks.neteaseLogin
      .mockReset()
      .mockResolvedValue({ success: true, musicU: 'MUSIC_U', csrfToken: 'csrf-token' });
    ipcMocks.openExternal.mockReset().mockResolvedValue(undefined);
    ipcMocks.consumeOAuthCallback.mockReset().mockResolvedValue(null);
    ipcMocks.onIpc.mockReset().mockReturnValue(() => undefined);

    ipc.qqLogin = ipcMocks.qqLogin;
    ipc.neteaseLogin = ipcMocks.neteaseLogin;
    ipc.openExternal = ipcMocks.openExternal;
    ipc.consumeOAuthCallback = ipcMocks.consumeOAuthCallback;
    ipc.onIpc = ipcMocks.onIpc;

    promptMock.mockReset();
    openMock.mockReset();
    window.prompt = promptMock;
    window.open = openMock;

    // 宽限期是模块级 Map（跨用例共享），必须逐例清干净
    __resetReloginGrace();
  });

  // ── A. 初始状态与挂载行为 ────────────────────────────────────────────

  it('A1 挂载时自动拉一次当前 provider 的登录态', () => {
    mount('qq');
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(1);
    expect(apiMocks.getAuthStatus).toHaveBeenCalledWith('qq');
  });

  it('A2 初始状态：未登录 / 无错误 / 不在登录中', () => {
    const { result } = mount('qq');
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.auth.user).toBeNull();
    expect(result.current.authError).toBeNull();
    expect(result.current.loggingIn).toBe(false);
    expect(result.current.authPhase.kind).toBe('idle');
  });

  it('A3 provider 为 null → 不拉登录态，provider 回退成 qq', () => {
    const { result } = mount(null);
    expect(apiMocks.getAuthStatus).not.toHaveBeenCalled();
    expect(result.current.auth.provider).toBe('qq');
  });

  it('A4 登录态查询成功 → auth.loggedIn / auth.user 同步', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    const { result } = mount('qq');
    await waitFor(() => expect(result.current.auth.loggedIn).toBe(true));
    await settle();
    expect(result.current.auth.user?.nickname).toBe('QQ用户');
  });

  it('A5 登录态查询失败 → 走 setError 通道，不把用户踢下线', async () => {
    apiMocks.getAuthStatus.mockRejectedValue(new Error('后端挂了'));
    const { result } = mount('qq');
    await waitFor(() => expect(setError).toHaveBeenCalledWith('后端挂了'));
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.authError).toBeNull();
  });

  // ── B. provider 切换 ─────────────────────────────────────────────────

  it('B1 切换 provider → 重新拉一次新 provider 的状态', async () => {
    const { rerender } = mountSwitchable('qq');
    await waitFor(() => expect(apiMocks.getAuthStatus).toHaveBeenCalledWith('qq'));
    rerender({ provider: 'netease' });
    await waitFor(() => expect(apiMocks.getAuthStatus).toHaveBeenCalledWith('netease'));
    await settle();
    expect(apiMocks.getAuthStatus).toHaveBeenCalledTimes(2);
  });

  it('B2 切换 provider → 旧 provider 的登录快照立刻清空', async () => {
    apiMocks.getAuthStatus.mockImplementation((p: MusicProvider) =>
      p === 'netease'
        ? // 新 provider 的状态迟迟不到：快照必须**已经被清空**，而不是等它
          new Promise(() => {})
        : Promise.resolve({ provider: p, loggedIn: true, user: QQ_USER }),
    );
    const { result, rerender } = mountSwitchable('qq');
    await waitFor(() => expect(result.current.auth.loggedIn).toBe(true));

    act(() => {
      rerender({ provider: 'netease' });
    });
    expect(result.current.auth.provider).toBe('netease');
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.auth.user).toBeNull();
  });

  // ── C. 过期检测（stale probe） ───────────────────────────────────────

  it('C1 已登录且校验时间缺失 → 触发 validate=1 探针', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.getAuthStatusExtended.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
      lastValidatedAt: null,
    });
    mount('qq');
    await waitFor(() => expect(apiMocks.getAuthStatusValidated).toHaveBeenCalledWith('qq'));
  });

  it('C2 探针判定 expired → 进入 AUTH_EXPIRED 错误态', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.getAuthStatusExtended.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
      lastValidatedAt: null,
    });
    apiMocks.getAuthStatusValidated.mockResolvedValue({
      provider: 'qq',
      loggedIn: false,
      user: null,
      lastValidatedAt: null,
      expired: true,
      message: '登录已过期，请重新登录',
    });
    const { result } = mount('qq');
    await waitFor(() => expect(result.current.authError?.code).toBe('AUTH_EXPIRED'));
    expect(result.current.authError?.message).toBe('登录已过期，请重新登录');
    expect(result.current.auth.loggedIn).toBe(false);
  });

  it('C3 校验时间很新（<24h）→ 不打探针', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.getAuthStatusExtended.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
      lastValidatedAt: Date.now(),
    });
    mount('qq');
    await waitFor(() => expect(apiMocks.getAuthStatusExtended).toHaveBeenCalled());
    await settle();
    expect(apiMocks.getAuthStatusValidated).not.toHaveBeenCalled();
  });

  it('C4 探针失败 → 不把用户踢下线（保持登录态、无错误）', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.getAuthStatusExtended.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
      lastValidatedAt: null,
    });
    apiMocks.getAuthStatusValidated.mockRejectedValue(new Error('探针 500'));
    const { result } = mount('qq');
    await waitFor(() => expect(apiMocks.getAuthStatusValidated).toHaveBeenCalled());
    await settle();
    expect(result.current.auth.loggedIn).toBe(true);
    expect(result.current.authError).toBeNull();
  });

  it('C5 登录成功后的宽限期内 → 探针报 expired 也不误标过期', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.getAuthStatusExtended.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
      lastValidatedAt: null,
    });
    apiMocks.getAuthStatusValidated.mockResolvedValue({
      provider: 'qq',
      loggedIn: false,
      user: null,
      lastValidatedAt: null,
      expired: true,
    });

    // 先完成一次真实登录成功 → reducer 进入 authenticated → 埋宽限期
    const first = mount('qq');
    await act(async () => {
      await first.result.current.handleQqLogin();
    });
    expect(first.result.current.authPhase.kind).toBe('authenticated');
    await settle(); // 等「进入 authenticated → 埋宽限期」这个 effect 落地

    // 再挂一个同 provider 的实例 → 它挂载时会重新拉状态并打探针；
    // 宽限期内的 expired 应当被压掉（探针误报保护）
    const second = mount('qq');
    await waitFor(() => expect(apiMocks.getAuthStatusValidated).toHaveBeenCalled());
    await settle();
    expect(second.result.current.authError).toBeNull();
    expect(second.result.current.auth.loggedIn).toBe(true);
  });

  // ── D. QQ 登录 ───────────────────────────────────────────────────────

  it('D1 没有 Electron 登录 IPC → 明确报错，且不进入登录中', async () => {
    delete ipc.qqLogin;
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(setError).toHaveBeenCalledWith(
      'QQ 音乐登录需要在桌面 App 中进行(浏览器无法捕获登录 cookie)',
    );
    expect(result.current.loggingIn).toBe(false);
    expect(result.current.authError).toBeNull();
    expect(ipcMocks.qqLogin).not.toHaveBeenCalled();
  });

  it('D2 QQ 登录成功 → 登录态更新 + loadNextTrack + 上报 ok', async () => {
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(apiMocks.loginQqCookie).toHaveBeenCalledWith('qq-cookie', '10001', undefined);
    expect(result.current.auth.loggedIn).toBe(true);
    expect(result.current.auth.user?.nickname).toBe('QQ用户');
    expect(result.current.authPhase.kind).toBe('authenticated');
    expect(loadNextTrack).toHaveBeenCalledTimes(1);
    expect(apiMocks.reportAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'qq', outcome: 'ok' }),
    );
  });

  it('D3 QQ 登录被用户取消 → AUTH_CANCELLED', async () => {
    ipcMocks.qqLogin.mockResolvedValue({ success: false, error: 'login_cancelled' });
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_CANCELLED');
    expect(result.current.authPhase.kind).toBe('failed');
    expect(result.current.auth.loggedIn).toBe(false);
  });

  it('D4 QQ 登录 IPC 抛错 → AUTH_UNKNOWN', async () => {
    ipcMocks.qqLogin.mockRejectedValue(new Error('窗口崩了'));
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_UNKNOWN');
    expect(result.current.authError?.message).toBe('窗口崩了');
  });

  it('D5 后端返回 success:false → 不会误判成登录成功', async () => {
    apiMocks.loginQqCookie.mockResolvedValue({ success: false, user: null });
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.auth.loggedIn).toBe(false);
    expect(loadNextTrack).not.toHaveBeenCalled();
  });

  // ── E. 网易云登录 ────────────────────────────────────────────────────

  it('E1 没有 Electron 登录 IPC → 弹 cookie 兜底弹窗，不打后端', async () => {
    delete ipc.neteaseLogin;
    const { result } = mount('netease');
    await act(async () => {
      await result.current.handleNeteaseLogin();
    });
    expect(result.current.showCookieFallback).toBe(true);
    expect(apiMocks.loginNeteaseCookie).not.toHaveBeenCalled();
  });

  it('E2 网易云登录成功 → 登录态更新 + loadNextTrack + 上报 ok', async () => {
    const { result } = mount('netease');
    await act(async () => {
      await result.current.handleNeteaseLogin();
    });
    expect(apiMocks.loginNeteaseCookie).toHaveBeenCalledWith('MUSIC_U', 'csrf-token', undefined);
    expect(result.current.auth.loggedIn).toBe(true);
    expect(result.current.auth.user?.nickname).toBe('网易用户');
    expect(loadNextTrack).toHaveBeenCalledTimes(1);
    expect(apiMocks.reportAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'netease', outcome: 'ok' }),
    );
  });

  it('E3 网易云登录失败 → AUTH_UNKNOWN', async () => {
    ipcMocks.neteaseLogin.mockResolvedValue({ success: false, error: 'login_failed' });
    const { result } = mount('netease');
    await act(async () => {
      await result.current.handleNeteaseLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_UNKNOWN');
    expect(result.current.authPhase.kind).toBe('failed');
  });

  it('E4 cookie 兜底手动成功 → 登录态更新 + loadNextTrack', async () => {
    delete ipc.neteaseLogin;
    const { result } = mount('netease');
    await act(async () => {
      await result.current.handleNeteaseLogin();
    });
    expect(result.current.showCookieFallback).toBe(true);

    await act(async () => {
      result.current.handleCookieFallbackSuccess(NETEASE_USER);
    });
    expect(result.current.auth.loggedIn).toBe(true);
    expect(result.current.auth.user?.nickname).toBe('网易用户');
    expect(loadNextTrack).toHaveBeenCalledTimes(1);
  });

  // ── F. Spotify 登录 ──────────────────────────────────────────────────

  it('F1 没有 client_id → 收集并提交 client_id', async () => {
    apiMocks.getSpotifyStatus.mockResolvedValue({
      hasClientId: false,
      loggedIn: false,
      tier: null,
    });
    promptMock.mockReturnValue('  client-abc  ');
    ipcMocks.consumeOAuthCallback.mockResolvedValue({
      code: 'code-1',
      state: 'state-1',
      receivedAt: 1,
    });
    const { result } = mount('spotify');
    await act(async () => {
      await result.current.handleSpotifyLogin();
    });
    expect(promptMock).toHaveBeenCalled();
    expect(apiMocks.setSpotifyClientId).toHaveBeenCalledWith('client-abc');
    expect(result.current.auth.loggedIn).toBe(true);
  });

  it('F2 client_id 为空 → AUTH_CANCELLED，且不提交', async () => {
    apiMocks.getSpotifyStatus.mockResolvedValue({
      hasClientId: false,
      loggedIn: false,
      tier: null,
    });
    promptMock.mockReturnValue('');
    const { result } = mount('spotify');
    await act(async () => {
      await result.current.handleSpotifyLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_CANCELLED');
    expect(apiMocks.setSpotifyClientId).not.toHaveBeenCalled();
    expect(apiMocks.redeemSpotifyCode).not.toHaveBeenCalled();
  });

  it('F3 Spotify OAuth 成功 → 兑换 code → 登录态 + tier', async () => {
    apiMocks.getSpotifyStatus.mockResolvedValue({
      hasClientId: true,
      loggedIn: false,
      tier: 'premium',
    });
    ipcMocks.consumeOAuthCallback.mockResolvedValue({
      code: 'code-1',
      state: 'state-1',
      receivedAt: 1,
    });
    const { result } = mount('spotify');
    await act(async () => {
      await result.current.handleSpotifyLogin();
    });
    expect(apiMocks.startSpotify).toHaveBeenCalledWith('maestro://spotify-callback');
    expect(ipcMocks.openExternal).toHaveBeenCalledWith(
      'https://accounts.spotify.com/authorize?client_id=x',
    );
    expect(apiMocks.redeemSpotifyCode).toHaveBeenCalledWith('code-1', 'state-1');
    expect(result.current.auth.loggedIn).toBe(true);
    expect(result.current.auth.user?.nickname).toBe('Spotify用户');
    expect(result.current.auth.tier).toBe('premium');
  });

  it('F4 Spotify OAuth 被拒绝 → AUTH_CANCELLED', async () => {
    ipcMocks.consumeOAuthCallback.mockResolvedValue({
      error: 'access_denied',
      state: 'state-1',
      receivedAt: 1,
    });
    const { result } = mount('spotify');
    await act(async () => {
      await result.current.handleSpotifyLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_CANCELLED');
    expect(result.current.authError?.message).toContain('Spotify 登录被拒绝');
    expect(apiMocks.redeemSpotifyCode).not.toHaveBeenCalled();
  });

  it('F5 Spotify redeem 失败 → AUTH_INVALID', async () => {
    ipcMocks.consumeOAuthCallback.mockResolvedValue({
      code: 'code-1',
      state: 'state-1',
      receivedAt: 1,
    });
    apiMocks.redeemSpotifyCode.mockResolvedValue({ ok: false });
    const { result } = mount('spotify');
    await act(async () => {
      await result.current.handleSpotifyLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_INVALID');
    expect(result.current.auth.loggedIn).toBe(false);
  });

  it('F6 OAuth 回调 2s 超时 → 转 IPC listener + 3s poll 兜底', async () => {
    // 假定时器：2s 硬超时 + 3s poll 间隔都是墙钟依赖，不能真等
    vi.useFakeTimers();
    try {
      ipcMocks.consumeOAuthCallback.mockResolvedValue(null);
      const { result } = mount('spotify');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      let flow: Promise<void> = Promise.resolve();
      act(() => {
        flow = result.current.handleSpotifyLogin();
      });
      // 推进 2s → consumeOAuthCallback 的硬超时触发 → 进 else 兜底分支
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(ipcMocks.onIpc).toHaveBeenCalledWith('spotify:oauth-protocol', expect.any(Function));

      // IPC listener 收到 code+state → 流程继续兑换
      const onIpcCb = ipcMocks.onIpc.mock.calls[0][1] as (data: unknown) => void;
      await act(async () => {
        onIpcCb({ code: 'code-ipc', state: 'state-ipc' });
        await vi.advanceTimersByTimeAsync(1);
      });
      await act(async () => {
        await flow;
      });

      expect(apiMocks.redeemSpotifyCode).toHaveBeenCalledWith('code-ipc', 'state-ipc');
      expect(result.current.auth.loggedIn).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('F7 浏览器兜底轮询 90s 仍未登录 → AUTH_TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      delete ipc.openExternal;
      const { result } = mount('spotify');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      let flow: Promise<void> = Promise.resolve();
      act(() => {
        flow = result.current.handleSpotifyLogin();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(95_000);
      });
      await act(async () => {
        await flow;
      });

      expect(apiMocks.startSpotify).toHaveBeenCalledWith();
      expect(openMock).toHaveBeenCalledWith(
        'https://accounts.spotify.com/authorize?client_id=x',
        '_blank',
        'noopener',
      );
      expect(result.current.authError?.code).toBe('AUTH_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── G. 定时器 ────────────────────────────────────────────────────────

  it('G1 登录尝试 120s 未完成 → 取消（timeout）+ 上报 cancel', async () => {
    vi.useFakeTimers();
    try {
      ipcMocks.qqLogin.mockImplementation(() => new Promise(() => {})); // 永不回来
      const { result } = mount('qq');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      act(() => {
        void result.current.handleQqLogin();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(result.current.authPhase).toMatchObject({ kind: 'cancelled', reason: 'timeout' });
      expect(result.current.authError?.code).toBe('AUTH_TIMEOUT');
      expect(apiMocks.reportAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'qq', outcome: 'cancel', errorCode: 'AUTH_TIMEOUT' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('G2 登录成功后 120s 不会误杀已登录态', async () => {
    vi.useFakeTimers();
    try {
      const { result } = mount('qq');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      await act(async () => {
        await result.current.handleQqLogin();
      });
      expect(result.current.authPhase.kind).toBe('authenticated');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(result.current.authPhase.kind).toBe('authenticated');
      expect(result.current.auth.loggedIn).toBe(true);
      expect(apiMocks.reportAuthEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'cancel' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // ── H. 取消 / 重试 / 重置 ─────────────────────────────────────────────

  it('H1 取消登录 → cancelled(user) + 上报 cancel', async () => {
    ipcMocks.qqLogin.mockImplementation(() => new Promise(() => {}));
    const { result } = mount('qq');
    act(() => {
      void result.current.handleQqLogin();
    });
    await act(async () => {
      result.current.handleCancel();
    });
    expect(result.current.authPhase).toMatchObject({ kind: 'cancelled', reason: 'user' });
    expect(apiMocks.reportAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'qq', outcome: 'cancel', errorCode: 'AUTH_CANCELLED' }),
    );
  });

  it('H2 重试 → 清错误 + 重新触发对应平台的登录流程', async () => {
    ipcMocks.qqLogin.mockResolvedValue({ success: false, error: 'login_cancelled' });
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.authError?.code).toBe('AUTH_CANCELLED');

    ipcMocks.qqLogin.mockResolvedValue({ success: true, cookie: 'qq-cookie', uin: '10001' });
    await act(async () => {
      result.current.handleRetry();
    });
    await waitFor(() => expect(ipcMocks.qqLogin).toHaveBeenCalledTimes(2));
    await settle();
    expect(result.current.authError).toBeNull();
    expect(result.current.auth.loggedIn).toBe(true);
  });

  it('H3 关闭错误面板 → 错误清空', async () => {
    ipcMocks.qqLogin.mockResolvedValue({ success: false, error: 'login_cancelled' });
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.authError).not.toBeNull();

    act(() => {
      result.current.handleDismissError();
    });
    expect(result.current.authError).toBeNull();
    expect(result.current.authPhase.kind).toBe('idle');
  });

  it('H4 重置登录态 → 快照清空', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    const { result } = mount('qq');
    await waitFor(() => expect(result.current.auth.loggedIn).toBe(true));

    act(() => {
      result.current.resetAuth();
    });
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.auth.user).toBeNull();
    expect(result.current.authError).toBeNull();
  });

  // ── I. 外部上报登录态失效 ─────────────────────────────────────────────

  it('I1 宽限期外上报登录态失效 → 进入 AUTH_EXPIRED', async () => {
    const { result } = mount('qq');
    act(() => {
      result.current.markExpired('qq', '服务端说这条登录挂了');
    });
    expect(result.current.authError?.code).toBe('AUTH_EXPIRED');
    expect(result.current.authError?.message).toBe('服务端说这条登录挂了');
    expect(result.current.auth.loggedIn).toBe(false);
  });

  it('I2 宽限期内上报登录态失效 → 忽略（探针误报保护）', async () => {
    const { result } = mount('qq');
    await act(async () => {
      await result.current.handleQqLogin();
    });
    expect(result.current.authPhase.kind).toBe('authenticated');

    act(() => {
      result.current.markExpired('qq');
    });
    expect(result.current.authError).toBeNull();
    expect(result.current.auth.loggedIn).toBe(true);
  });

  // ── J. 登出 ──────────────────────────────────────────────────────────

  it('J1 登出 → 调后端 + 本地快照清空', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    const { result } = mount('qq');
    await waitFor(() => expect(result.current.auth.loggedIn).toBe(true));
    await settle();

    await act(async () => {
      await result.current.handleLogout();
    });
    expect(apiMocks.logout).toHaveBeenCalledWith('qq');
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.auth.user).toBeNull();
  });

  it('J2 登出接口失败 → 本地快照照样清空', async () => {
    apiMocks.getAuthStatus.mockResolvedValue({
      provider: 'qq',
      loggedIn: true,
      user: QQ_USER,
    });
    apiMocks.logout.mockRejectedValue(new Error('登出接口 500'));
    const { result } = mount('qq');
    await waitFor(() => expect(result.current.auth.loggedIn).toBe(true));

    await act(async () => {
      await result.current.handleLogout();
    });
    expect(result.current.auth.loggedIn).toBe(false);
    expect(result.current.auth.user).toBeNull();
  });

  // ── K. OAuth 回调排空 ────────────────────────────────────────────────

  it('K1 挂载时排空一次 OAuth 回调 buffer（不自动登录）', async () => {
    ipcMocks.consumeOAuthCallback.mockResolvedValue({
      code: 'code-1',
      state: 'state-1',
      receivedAt: 1,
    });
    mount('spotify');
    await waitFor(() => expect(ipcMocks.consumeOAuthCallback).toHaveBeenCalledTimes(1));
    await settle();
    expect(apiMocks.redeemSpotifyCode).not.toHaveBeenCalled();
    expect(apiMocks.startSpotify).not.toHaveBeenCalled();
  });
});
