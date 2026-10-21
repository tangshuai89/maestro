/**
 * SourceSelect.test.tsx — 选源页（此前 0% 覆盖）。
 *
 * 这是**没有凭据时的第一屏**（无凭据首屏，视觉回归的 baseline 之一）。
 *
 * 契约：
 *  1. 四个平台各一张卡：QQ 音乐 / 网易云音乐 / Deezer / Spotify
 *  2. 点卡 → onSelect(provider)
 *  3. Spotify 卡片文案随登录档位变（premium → 全曲播放；free/open/unknown → 30s 预览）
 *  4. 底部固定提示「凭据本地存储 · 不上传任何服务器」
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getSpotifyStatus: vi.fn(),
}));
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, getSpotifyStatus: mocks.getSpotifyStatus };
});

import SourceSelect from './SourceSelect';

beforeEach(() => {
  mocks.getSpotifyStatus.mockReset().mockResolvedValue({ loggedIn: false, tier: 'unknown' });
});

describe('SourceSelect', () => {
  it('渲染四个平台卡', () => {
    render(<SourceSelect onSelect={vi.fn()} />);
    for (const name of ['QQ 音乐', '网易云音乐', 'Deezer', 'Spotify']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('底部固定提示「凭据本地存储」', () => {
    render(<SourceSelect onSelect={vi.fn()} />);
    expect(screen.getByText(/凭据本地存储 · 不上传任何服务器/)).toBeInTheDocument();
  });

  it('点卡 → onSelect(provider)', () => {
    const onSelect = vi.fn();
    render(<SourceSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText('网易云音乐'));
    expect(onSelect).toHaveBeenCalledWith('netease');
  });

  it('Spotify 卡片：未登录 → 30s 预览文案', () => {
    render(<SourceSelect onSelect={vi.fn()} />);
    expect(screen.getByText('国际曲库 · 30s 预览')).toBeInTheDocument();
  });

  it('Spotify 卡片：premium 档 → 「全曲播放」文案', async () => {
    mocks.getSpotifyStatus.mockResolvedValue({ loggedIn: true, tier: 'premium' });
    render(<SourceSelect onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('国际曲库 · 全曲播放')).toBeInTheDocument());
  });

  it('Spotify 卡片：free 档 → 仍是 30s 预览', async () => {
    mocks.getSpotifyStatus.mockResolvedValue({ loggedIn: true, tier: 'free' });
    render(<SourceSelect onSelect={vi.fn()} />);
    await waitFor(() => expect(mocks.getSpotifyStatus).toHaveBeenCalled());
    expect(screen.getByText('国际曲库 · 30s 预览')).toBeInTheDocument();
  });

  it('getSpotifyStatus 抛错 → 不炸，仍渲染 30s 预览文案', async () => {
    mocks.getSpotifyStatus.mockRejectedValue(new Error('boom'));
    render(<SourceSelect onSelect={vi.fn()} />);
    await waitFor(() => expect(mocks.getSpotifyStatus).toHaveBeenCalled());
    expect(screen.getByText('国际曲库 · 30s 预览')).toBeInTheDocument();
  });
});
