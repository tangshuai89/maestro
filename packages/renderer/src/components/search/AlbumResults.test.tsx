/**
 * AlbumResults.test.tsx — 专辑收藏（fan-out）UI 契约。
 *
 * 行为契约（spec: specs/album-fanout）：
 *  1. 专辑行右侧有 ❤ 按钮（未收藏态）
 *  2. 点 ❤ → 调 fanOutAlbumSave(album.id, sources, true)；回包 fannedOutTo
 *     里的平台数 = 角标数字
 *  3. 服务端给过 savedPlatforms → 初始就是收藏态（aria-pressed + 角标）
 *  4. 点已收藏的 ❤ → saved=false（取消）
 *  5. fannedOutTo 为空 → 提示「没有可收藏的平台」（不是静默失败）
 *  6. 请求失败 → 回滚到服务端真值 + 提示
 *  7. 点 ❤ **不**触发行展开（整行是展开/收起，必须 stopPropagation）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnifiedAlbum, AlbumSource } from '../../api';

const apiMocks = vi.hoisted(() => ({
  searchAlbums: vi.fn(),
  fetchAlbumTracks: vi.fn(),
  fanOutAlbumSave: vi.fn(),
}));
const { searchAlbums, fetchAlbumTracks, fanOutAlbumSave } = apiMocks;

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    searchAlbums: apiMocks.searchAlbums,
    fetchAlbumTracks: apiMocks.fetchAlbumTracks,
    fanOutAlbumSave: apiMocks.fanOutAlbumSave,
  };
});

import AlbumResults from './AlbumResults';

const src = (platform: AlbumSource['platform'], albumId: string): AlbumSource => ({
  platform,
  albumId,
  title: '叶惠美',
  artist: '周杰伦',
  coverUrl: '',
  trackCount: 11,
  year: 2003,
  rank: 0,
});

const ALBUM: UnifiedAlbum = {
  id: 'merged-a',
  title: '叶惠美',
  artist: '周杰伦',
  coverUrl: '',
  trackCount: 11,
  year: 2003,
  sources: [src('qq', 'qq-album-1'), src('netease', 'ne-album-1')],
};

function renderResults() {
  const loadMoreRef = { current: null as null | (() => void) };
  return render(
    <AlbumResults
      q="叶惠美"
      onPlay={vi.fn()}
      loadMoreRef={loadMoreRef as React.MutableRefObject<(() => void) | null>}
    />,
  );
}

describe('AlbumResults 专辑收藏', () => {
  beforeEach(() => {
    searchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [ALBUM],
    });
    fetchAlbumTracks.mockResolvedValue([]);
    fanOutAlbumSave.mockResolvedValue({ success: true, saved: true, fannedOutTo: ['netease'] });
  });

  it('专辑行有 ❤ 按钮（未收藏态）', async () => {
    renderResults();
    await screen.findByText('叶惠美');
    const btn = screen.getByRole('button', { name: '收藏专辑' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('点 ❤ → 调 fanOutAlbumSave(albumId, sources, true)，回包平台数 = 角标', async () => {
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '收藏专辑' }));

    await waitFor(() => expect(fanOutAlbumSave).toHaveBeenCalledTimes(1));
    const [mergedId, sources, saved] = fanOutAlbumSave.mock.calls[0];
    expect(mergedId).toBe('merged-a');
    expect(saved).toBe(true);
    expect(sources).toEqual([
      expect.objectContaining({ platform: 'qq', albumId: 'qq-album-1' }),
      expect.objectContaining({ platform: 'netease', albumId: 'ne-album-1' }),
    ]);

    // 收藏态：♥ + 角标 1（= 真实写入成功的平台数）
    await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏专辑' })).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('服务端给的 savedPlatforms → 初始就是收藏态', async () => {
    searchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...ALBUM, savedPlatforms: ['netease'] }],
    });
    renderResults();
    await screen.findByText('叶惠美');
    const btn = screen.getByRole('button', { name: '取消收藏专辑' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('点已收藏的 ❤ → saved=false（取消）', async () => {
    searchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...ALBUM, savedPlatforms: ['netease'] }],
    });
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '取消收藏专辑' }));
    await waitFor(() => expect(fanOutAlbumSave).toHaveBeenCalledTimes(1));
    expect(fanOutAlbumSave.mock.calls[0][2]).toBe(false);
  });

  it('fannedOutTo 为空 → 提示「没有可收藏的平台」（不静默失败）', async () => {
    fanOutAlbumSave.mockResolvedValue({ success: true, saved: true, fannedOutTo: [] });
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '收藏专辑' }));
    expect(await screen.findByText(/没有可收藏的平台/)).toBeTruthy();
  });

  it('请求失败 → 回滚 + 提示「收藏失败」', async () => {
    fanOutAlbumSave.mockRejectedValue(new Error('network down'));
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '收藏专辑' }));
    expect(await screen.findByText(/收藏失败/)).toBeTruthy();
    // 回滚：按钮仍是未收藏态
    expect(screen.getByRole('button', { name: '收藏专辑' })).toBeTruthy();
  });

  it('请求里带该平台自己的 trackCount（服务端靠它挡 EP vs LP）', async () => {
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '收藏专辑' }));
    await waitFor(() => expect(fanOutAlbumSave).toHaveBeenCalled());
    const sources = fanOutAlbumSave.mock.calls[0][1];
    expect(sources[0]).toEqual(expect.objectContaining({ platform: 'qq', trackCount: 11 }));
    expect(sources[1]).toEqual(expect.objectContaining({ platform: 'netease', trackCount: 11 }));
  });

  it('A 专辑保存中 → B 专辑仍能点（不被单槽静默吞掉）', async () => {
    const second = { ...ALBUM, id: 'merged-b', title: '范特西' };
    searchAlbums.mockResolvedValue({
      q: '叶惠美',
      total: 2,
      page: 1,
      pageSize: 20,
      items: [ALBUM, second],
    });
    // 第一次调用挂住（模拟慢网络）
    let release: (() => void) | null = null;
    fanOutAlbumSave.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = () => r({ success: true, saved: true, fannedOutTo: ['netease'] });
        }),
    );
    renderResults();
    await screen.findByText('叶惠美');
    const buttons = screen.getAllByRole('button', { name: '收藏专辑' });
    await userEvent.click(buttons[0]);
    // A 在保存中 → B 的按钮必须还能点并发出请求
    const buttons2 = screen.getAllByRole('button', { name: '收藏专辑' });
    await userEvent.click(buttons2[1]);
    await waitFor(() => expect(fanOutAlbumSave).toHaveBeenCalledTimes(2));
    release!();
  });

  it('某平台拉不到曲目 → 自动回退到下一个源（不整卡作废）', async () => {
    // qq 抛错（模拟"该平台专辑详情拿不到"），netease 有数据
    fetchAlbumTracks.mockImplementation(async (platform: string) => {
      if (platform === 'qq') throw new Error('该平台暂不支持专辑详情（qq）');
      return [
        {
          id: 'netease:t1',
          title: '游览指南',
          artist: '裘德',
          album: '最后的水族馆',
          coverUrl: '',
          duration: 100,
          bestSource: 'netease',
          versionType: 'studio',
          sources: [{ platform: 'netease', trackId: 't1', hasCopyright: true, url: '' }],
          versions: [{ id: 'v1', duration: 100, sources: [] }],
        },
      ] as never;
    });
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByText('叶惠美'));
    // 回退成功 → 显示曲目，不显示错误
    expect(await screen.findByText('游览指南')).toBeTruthy();
    expect(screen.queryByText(/曲目加载失败/)).toBeNull();
    // 两个源都试过
    expect(fetchAlbumTracks.mock.calls.map((c) => c[0])).toEqual(['qq', 'netease']);
  });

  it('所有源都拉不到 → 保留明确的中文错误提示', async () => {
    fetchAlbumTracks.mockRejectedValue(new Error('请先登录网易云'));
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByText('叶惠美'));
    expect(await screen.findByText(/请先登录网易云/)).toBeTruthy();
  });

  it('点 ❤ 不触发行展开（stopPropagation）', async () => {
    renderResults();
    await screen.findByText('叶惠美');
    await userEvent.click(screen.getByRole('button', { name: '收藏专辑' }));
    // 展开会拉曲目；没拉 = 行没被展开
    expect(fetchAlbumTracks).not.toHaveBeenCalled();
  });
});
