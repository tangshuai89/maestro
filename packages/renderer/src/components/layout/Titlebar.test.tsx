/**
 * Titlebar.test.tsx — 顶部窗口栏（此前 0% 覆盖）。
 *
 * 契约（都是"看得见"的行为，坏了用户立刻会发现）：
 *  1. 音源菜单常驻；Deezer 预置下拉**只在** provider=deezer 且有 editorials 时出现
 *  2. 未登录 → 「登录」按钮（登录中 → disabled + 文案变「登录中…」）；
 *     已登录 → 账号按钮（显示账号名，没有则 'User'）
 *  3. 音质菜单**只在** provider∈{qq,netease} 且已登录时出现
 *  4. ♤ 按钮上的计数徽标：0 → 不显示；>999 → 「999+」
 *  5. 推荐按钮：运行中 → disabled + 文案「…」；未配 key → 有小红点
 *  6. 桌面歌词按钮：aria-pressed 跟随开关态，类名 is-on 同步
 *  7. 播放模式按钮：mini ⛶ / 剧场 ▭，aria-label 跟着变
 *
 * 子组件（SourceMenu / QualityMenu / DeezerPresetSelect）**真渲染** ——
 * 它们只依赖 api 的类型和常量，不发网络请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Titlebar from './Titlebar';

const props = (over: Record<string, unknown> = {}) => ({
  provider: 'qq' as const,
  onSwitchProvider: vi.fn(),
  deezerEditorials: [],
  deezerPreset: '',
  onChangeDeezerPreset: vi.fn(),
  onOpenSearch: vi.fn(),
  recoStatus: { configured: true } as { configured: boolean } | null,
  recoRunning: false,
  onReco: vi.fn(),
  qqQuality: 'standard' as const,
  onChangeQuality: vi.fn(),
  loggedIn: false,
  loggingIn: false,
  accountName: undefined as string | undefined,
  onLogin: vi.fn(),
  onAccount: vi.fn(),
  onReset: vi.fn(),
  likedCount: 0,
  onOpenLiked: vi.fn(),
  queueCount: 0,
  onOpenQueue: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onOpenSettings: vi.fn(),
  playerMode: 'theater' as const,
  onTogglePlayerMode: vi.fn(),
  desktopLyricsOn: false,
  onToggleDesktopLyrics: vi.fn(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Titlebar', () => {
  it('音源菜单常驻', () => {
    render(<Titlebar {...props()} />);
    expect(screen.getByTitle('切换音源')).toBeInTheDocument();
  });

  it('快捷键按钮：点了就打开速查面板（specs/shortcut-cheatsheet/）', () => {
    const onOpenShortcuts = vi.fn();
    render(<Titlebar {...props({ onOpenShortcuts })} />);
    const btn = screen.getByLabelText('快捷键');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it('Deezer 预置下拉：仅 provider=deezer 且有 editorials 时出现', () => {
    const { unmount } = render(
      <Titlebar {...props({ provider: 'deezer', deezerEditorials: [] })} />,
    );
    expect(screen.queryByTitle('Deezer 榜单')).toBeNull();
    unmount();

    render(
      <Titlebar
        {...props({
          provider: 'deezer',
          deezerEditorials: [{ id: 'e1', name: 'Rock', region: 'FR' }],
        })}
      />,
    );
    expect(screen.getByTitle('Deezer 榜单')).toBeInTheDocument();
  });

  it('非 deezer provider 不显示 Deezer 预置', () => {
    render(
      <Titlebar
        {...props({
          provider: 'qq',
          deezerEditorials: [{ id: 'e1', name: 'Rock', region: 'FR' }],
        })}
      />,
    );
    expect(screen.queryByTitle('Deezer 榜单')).toBeNull();
  });

  it('未登录 → 「登录」按钮；登录中 → disabled + 文案「登录中…」', () => {
    const { unmount } = render(<Titlebar {...props({ loggedIn: false })} />);
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    unmount();

    render(<Titlebar {...props({ loggedIn: false, loggingIn: true })} />);
    const btn = screen.getByRole('button', { name: '登录中…' });
    expect(btn).toBeDisabled();
  });

  it('已登录 → 账号按钮（显示账号名，没有则 User）', () => {
    const { unmount } = render(<Titlebar {...props({ loggedIn: true, accountName: '小明' })} />);
    expect(screen.getByRole('button', { name: '小明' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录' })).toBeNull();
    unmount();

    render(<Titlebar {...props({ loggedIn: true, accountName: undefined })} />);
    expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument();
  });

  it('音质菜单：仅 qq/netease 且已登录时出现', () => {
    const { unmount } = render(<Titlebar {...props({ provider: 'qq', loggedIn: true })} />);
    expect(screen.getByTitle('音质（无损需会员）')).toBeInTheDocument();
    unmount();

    render(<Titlebar {...props({ provider: 'deezer', loggedIn: true })} />);
    expect(screen.queryByTitle('音质（无损需会员）')).toBeNull();
    unmount();

    render(<Titlebar {...props({ provider: 'qq', loggedIn: false })} />);
    expect(screen.queryByTitle('音质（无损需会员）')).toBeNull();
  });

  it('❤ 计数徽标：0 → 不显示；>999 → 「999+」', () => {
    const { unmount } = render(<Titlebar {...props({ likedCount: 0 })} />);
    expect(screen.queryByLabelText(/共 \d+ 首/)).toBeNull();
    unmount();

    render(<Titlebar {...props({ likedCount: 12 })} />);
    expect(screen.getByLabelText('共 12 首')).toHaveTextContent('12');
    unmount();

    render(<Titlebar {...props({ likedCount: 1500 })} />);
    expect(screen.getByLabelText('共 1500 首')).toHaveTextContent('999+');
  });

  it('队列按钮（specs/queue-panel/）：有队列 → 可点 + 首数徽章；无队列 → disabled', () => {
    const onOpenQueue = vi.fn();
    const { unmount } = render(<Titlebar {...props({ queueCount: 0, onOpenQueue })} />);
    // 电台模式：没有队列 → 禁用
    expect(screen.getByRole('button', { name: '播放队列' })).toBeDisabled();
    expect(screen.queryByLabelText(/队列 \d+ 首/)).not.toBeInTheDocument();
    unmount();

    render(<Titlebar {...props({ queueCount: 12, onOpenQueue })} />);
    const btn = screen.getByRole('button', { name: '播放队列' });
    expect(btn).toBeEnabled();
    expect(screen.getByLabelText('队列 12 首')).toHaveTextContent('12');

    fireEvent.click(btn);
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
  });

  it('队列按钮：>999 首 → 徽章显示「999+」', () => {
    render(<Titlebar {...props({ queueCount: 1500 })} />);
    expect(screen.getByLabelText('队列 1500 首')).toHaveTextContent('999+');
  });

  it('推荐按钮：运行中 → disabled + 文案「…」', () => {
    const { unmount } = render(<Titlebar {...props({ recoRunning: false })} />);
    expect(screen.getByRole('button', { name: /推荐/ })).toBeEnabled();
    unmount();

    render(<Titlebar {...props({ recoRunning: true })} />);
    const btn = screen.getByRole('button', { name: '…' });
    expect(btn).toBeDisabled();
  });

  it('未配 DeepSeek key → 推荐按钮上有小红点', () => {
    const { container } = render(<Titlebar {...props({ recoStatus: { configured: false } })} />);
    expect(container.querySelector('.reco-key-dot')).toBeTruthy();
  });

  it('桌面歌词按钮：aria-pressed + is-on 类跟随开关态', () => {
    const { unmount } = render(<Titlebar {...props({ desktopLyricsOn: false })} />);
    const off = screen.getByRole('button', { name: '开启桌面歌词' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off.className).not.toMatch(/is-on/);
    unmount();

    render(<Titlebar {...props({ desktopLyricsOn: true })} />);
    const on = screen.getByRole('button', { name: '关闭桌面歌词' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on.className).toMatch(/is-on/);
  });

  it('播放模式按钮：mini ⛶ / 剧场 ▭，aria-label 跟着变', () => {
    const { unmount } = render(<Titlebar {...props({ playerMode: 'theater' })} />);
    expect(screen.getByRole('button', { name: '切换到 Mini 模式' })).toHaveTextContent('▭');
    unmount();

    render(<Titlebar {...props({ playerMode: 'mini' })} />);
    expect(screen.getByRole('button', { name: '展开剧场模式' })).toHaveTextContent('⛶');
  });

  it('各按钮把回调接上', () => {
    const p = props();
    render(<Titlebar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
    expect(p.onOpenSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /推荐/ }));
    expect(p.onReco).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '❤' }));
    expect(p.onOpenLiked).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(p.onLogin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Mini 模式|展开剧场/ }));
    expect(p.onTogglePlayerMode).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /桌面歌词/ }));
    expect(p.onToggleDesktopLyrics).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/设置/));
    expect(p.onOpenSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/清空本地缓存/));
    expect(p.onReset).toHaveBeenCalled();
  });
});
