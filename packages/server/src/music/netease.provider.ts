import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Track } from './music.service';
import { ProviderSession } from '../common/session';

/**
 * 网易云音乐：私人 FM + 播放 URL + 红心。
 *
 * 2026-07 实测：明文 `/api/*` 端点对服务端直连是放行的（此前认为必须经
 * Electron 内嵌 Chromium 转发 weapi 的结论只适用于加密 weapi 通道）。
 * 因此这里全部走服务端直连 + cookie header，架构大幅简化。
 *
 * 端点：
 *   - 私人 FM:      POST /api/radio/get
 *   - 播放 URL:      POST /api/song/enhance/player/url/v1
 *   - 红心:          POST /api/radio/like?alg=itembased
 *   - 垃圾桶:        POST /api/radio/trash/add
 *
 * 未登录/cookie 过期时接口返回 { code: 301 }。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface NeteaseSong {
  id: number;
  name: string;
  artists?: { id: number; name: string }[];
  album?: { id: number; name: string; picUrl?: string };
  duration?: number;
  alias?: string[];
}

interface RadioResponse {
  code: number;
  data?: NeteaseSong[];
}

interface SongUrlItem {
  id: number;
  url: string | null;
  br: number;
  size: number;
  type?: string;
  level?: string;
  code?: number;
}

interface SongUrlResponse {
  code: number;
  data?: SongUrlItem[];
}

@Injectable()
export class NeteaseMusicProvider {
  private readonly logger = new Logger(NeteaseMusicProvider.name);

  isConfigured(session: ProviderSession | undefined): boolean {
    return Boolean(session?.musicU);
  }

  /** 取一批私人 FM 歌曲。 */
  async fetchRadioBatch(
    session: ProviderSession,
    count = 3,
  ): Promise<Track[]> {
    const data = await this.apiCall<RadioResponse>(
      session,
      'https://music.163.com/api/radio/get',
      {},
    );
    if (data.code !== 200) {
      throw new BadRequestException(
        data.code === 301
          ? '网易云登录已过期，请重新扫码登录'
          : `netease radio failed: code=${data.code}`,
      );
    }
    const songs = (data.data ?? []).slice(0, count);
    return songs.map((s) => ({
      id: String(s.id),
      provider: 'netease' as const,
      title: s.name,
      artist: s.artists?.map((a) => a.name).join(' / ') ?? '未知艺人',
      album: s.album?.name ?? '',
      coverUrl: s.album?.picUrl ?? '',
      audioUrl: '', // 由 getStreamPath 在播放时动态获取
      duration: Math.round((s.duration ?? 0) / 1000),
      liked: false,
    }));
  }

  /** 取歌曲的真实播放 URL（有时效，即拉即用）。 */
  async getStreamPath(
    session: ProviderSession,
    songId: string,
  ): Promise<string> {
    const data = await this.apiCall<SongUrlResponse>(
      session,
      'https://music.163.com/api/song/enhance/player/url/v1',
      {
        ids: `[${Number(songId)}]`,
        level: 'exhigh',
        encodeType: 'aac',
      },
    );
    const item = data.data?.[0];
    if (!item?.url) {
      throw new BadRequestException(
        `netease stream url missing for ${songId}: code=${item?.code ?? data.code}`,
      );
    }
    return item.url;
  }

  /** 给一首歌点红心。 */
  async like(session: ProviderSession, songId: string): Promise<boolean> {
    const data = await this.apiCall<{ code: number }>(
      session,
      'https://music.163.com/api/radio/like',
      {
        alg: 'itembased',
        trackId: String(songId),
        like: 'true',
        time: '3',
      },
    );
    return data.code === 200;
  }

  /** 标记「不喜欢」，私人 FM 会减少推荐。 */
  async unlike(session: ProviderSession, songId: string): Promise<boolean> {
    const data = await this.apiCall<{ code: number }>(
      session,
      'https://music.163.com/api/radio/trash/add',
      {
        alg: 'itembased',
        songId: String(songId),
        time: '25',
      },
    );
    return data.code === 200;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async apiCall<T>(
    session: ProviderSession,
    endpoint: string,
    payload: Record<string, string>,
  ): Promise<T> {
    const cookie =
      `MUSIC_U=${session.musicU}; os=pc` +
      (session.csrfToken ? `; __csrf=${session.csrfToken}` : '');

    let text = '';
    let status = 0;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          Origin: 'https://music.163.com',
          Accept: 'application/json, text/plain, */*',
          Cookie: cookie,
        },
        body: new URLSearchParams(payload).toString(),
        redirect: 'manual',
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      throw new BadRequestException(
        `网易云请求失败: ${(err as Error).message}`,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.error(`netease response not JSON: ${text.slice(0, 200)}`);
      throw new BadRequestException(
        `网易云返回非 JSON（status=${status}，bodyLen=${text.length}）`,
      );
    }
  }
}
