import { Injectable, Logger, NotFoundException, BadGatewayException } from '@nestjs/common';
import { Track } from './types';
import type { AlbumSource, AlbumTrack } from './album-types';
import { type LyricLine, parseLrc } from '../common/lyrics';
import { ProviderSession } from '../common/session';

/**
 * Deezer 公共 API 音源。
 *
 * 为什么用 Deezer：
 *   - 完全公开 API（不需要 OAuth、API key、登录态）
 *   - 30s 预览 mp3 公开可用，跟"电台每次放一段"场景天然匹配
 *   - 全球 1 亿+ 曲目，覆盖中文流行/欧美/日韩
 *   - 文档稳定，不会主动反爬
 *
 * 限制：
 *   - 30s 预览（premium 才给完整流，我们走匿名永远只能拿预览）
 *   - preview URL 几小时过期——我们每次播放前现取，不缓存
 *
 * 文档：https://developers.deezer.com/api
 */
interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  duration: number;
  preview: string;
  artist: { id: number; name: string; picture_big?: string };
  album: {
    id: number;
    title: string;
    cover_big?: string;
    cover_medium?: string;
    cover_xl?: string;
  };
}

/** Deezer 专辑搜索条目（`/search/album`）。 */
interface DeezerAlbum {
  id: number;
  title: string;
  cover_xl?: string;
  cover_big?: string;
  cover_medium?: string;
  cover_small?: string;
  /** 曲目数 */
  nb_tracks?: number;
  /** "2003-07-28" */
  release_date?: string;
  record_type?: string;
  /** ⚠️ 常见罗马音（实测「叶惠美」→ "Jue Wang"），跨平台合并要靠 artistAlias 桥接 */
  artist?: { id: number; name: string };
}

interface DeezerAlbumDetail {
  id: number;
  title: string;
  nb_tracks?: number;
  cover_xl?: string;
  tracks?: { data?: DeezerTrack[] };
}

interface DeezerChartResponse {
  data: DeezerTrack[];
  total: number;
}

/** `/search/artist` 与 `/artist/{id}/related` 的条目（只用得上 id/name）。 */
interface DeezerArtist {
  id: number;
  name: string;
}

/**
 * Known Deezer editorials (curated genre charts).
 *  - 0   = All
 *  - 16  = Asian Music (J-Pop / K-Pop / C-Pop)
 *  - 132 = Pop (international)
 *  - 116 = Rap / Hip Hop
 *  - 152 = Rock
 *  - 113 = Dance
 *  - 165 = R&B
 *  - 98  = Classical
 *  - 129 = Jazz
 */
const DEEZER_EDITORIALS: Record<number, { name: string; region?: string }> = {
  0: { name: 'All' },
  16: { name: '亚洲流行', region: 'Asian · J/K/C-Pop' },
  132: { name: '国际流行', region: 'Pop' },
  116: { name: '说唱' },
  152: { name: '摇滚' },
  113: { name: '舞曲' },
  165: { name: 'R&B' },
  98: { name: '古典' },
  129: { name: '爵士' },
};

/** Preset name -> Deezer editorial id (curated genre chart). */
const DEEZER_EDITORIALS_PRESET: Record<string, number> = {
  all: 132, // 'International Pop' as a sensible default
  asia: 16, // Asian Music (J/K/C-Pop)
  pop: 132,
  rap: 116,
  rock: 152,
  dance: 113,
  rnb: 165,
  classical: 98,
  jazz: 129,
};

@Injectable()
export class DeezerMusicProvider {
  private readonly logger = new Logger(DeezerMusicProvider.name);
  private static readonly API = 'https://api.deezer.com';

  isConfigured(_session: ProviderSession | undefined): boolean {
    return true;
  }

  /** Source kind for fetchRadioBatch. */
  static readonly SOURCE_CHART = 'chart' as const;
  static readonly SOURCE_EDITORIAL = 'editorial' as const;

  /** Editorials we expose to the user. */
  static getEditorials(): { id: number; name: string; region?: string }[] {
    return Object.entries(DEEZER_EDITORIALS).map(([id, v]) => ({
      id: Number(id),
      name: v.name,
      region: v.region,
    }));
  }

  /** Valid preset names (keys of DEEZER_EDITORIALS_PRESET). */
  static getPresetNames(): string[] {
    return Object.keys(DEEZER_EDITORIALS_PRESET);
  }

  /** Check if a preset name is valid. */
  static isValidPreset(preset: string): boolean {
    return preset in DEEZER_EDITORIALS_PRESET;
  }

  /**
   * 取一批电台歌曲。默认走国际流行榜（editorial 132），可用 source 切
   * 到具体榜单（'editorial' 走 /editorial/{id}/charts 包括亚洲流行
   * J-Pop/K-Pop/C-Pop）。
   *
   * @param session  当前会话（未使用，保留签名一致）
   * @param opts.preset  'all' | 'asia' | 'pop' | 'rap' | 'rock' | 'dance' | 'rnb' | 'classical' | 'jazz'
   * @param count        一次性拿多少首
   */
  /**
   * Search tracks by keyword. Deezer's public search API is anonymous
   * — no auth required. Returns up to `count` tracks.
   *
   * Endpoint: GET https://api.deezer.com/search?q={keyword}&limit={count}
   */
  async search(_session: ProviderSession, keyword: string, count = 20): Promise<Track[]> {
    const url = new URL(`${DeezerMusicProvider.API}/search`);
    url.searchParams.set('q', keyword);
    url.searchParams.set('limit', String(Math.min(count, 50)));

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' },
    });
    if (!res.ok) {
      throw new Error(`deezer search failed: ${res.status}`);
    }
    const json = (await res.json()) as { data?: DeezerTrack[]; total?: number };
    const data = json.data ?? [];
    this.logger.log(`Deezer search "${keyword}" → ${data.length} 首`);
    return data.map((t) => this.toTrack(t));
  }

  /**
   * 搜专辑。`GET /search/album?q=&limit=` —— 公开匿名 API。
   *
   * ⚠️ 限流（2026-09-30 实测）：连续压测会从正常掉到 0 结果，一度 TLS 断连
   * （ECONNRESET），~40s 冷却后恢复。所以**"返回空"不能直接当成"没搜到"**，
   * 上层要能区分限流与真空 —— 限流时抛错让 service 标 error，否则用户看到
   * 「暂无结果」正是 specs/unified-search/tasks.md:19 踩过的坑。
   *
   * limit 无 50 上限（实测 25/50/100 均通过），但这里仍 clamp 到 count，
   * 避免单次拉太多被限得更狠。
   */
  async searchAlbums(
    _session: ProviderSession,
    keyword: string,
    count = 20,
  ): Promise<AlbumSource[]> {
    const url = new URL(`${DeezerMusicProvider.API}/search/album`);
    url.searchParams.set('q', keyword);
    url.searchParams.set('limit', String(Math.max(1, Math.min(count, 50))));

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' },
    });
    if (!res.ok) {
      throw new BadGatewayException(`deezer album search failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: DeezerAlbum[];
      total?: number;
      error?: { message?: string; type?: string };
    };
    // Deezer 用 200 + {error:{...}} 表达业务错误（限流就是 error.code=4）。
    if (json.error) {
      // 限流/风控用 200+{error} 表达，属于上游故障 → 502，交 service 层
      // fail-soft 记进 errors（绝不能变成 500 把整次搜索带崩）。
      throw new BadGatewayException(
        `deezer album search error: ${json.error.type ?? ''} ${json.error.message ?? ''}`.trim(),
      );
    }
    const data = json.data ?? [];
    this.logger.log(`Deezer searchAlbums "${keyword}" → ${data.length} 张`);
    return data
      .filter((a): a is typeof a & { id: number } => typeof a.id === 'number')
      .map((a, i) => ({
        platform: 'deezer' as const,
        albumId: String(a.id),
        title: a.title ?? '未知专辑',
        artist: a.artist?.name ?? '未知艺人',
        coverUrl: a.cover_xl ?? a.cover_big ?? a.cover_medium ?? '',
        trackCount: a.nb_tracks ?? 0,
        year: Number.parseInt((a.release_date ?? '').slice(0, 4), 10) || 0,
        rank: i,
      }));
  }

  /**
   * 拉专辑曲目。`GET /album/{id}` → `tracks.data[]`。
   *
   * ⚠️ Deezer **不给 trackNumber / discNumber**（2026-09-30 实测），所以返回的
   * `trackNumber` 恒为 undefined，上层按「可得即用、缺失保序」处理 —— 不要为了
   * 跟 QQ 对齐去重排，那是 Deezer 上的真实编曲顺序。
   */
  async getAlbumTracks(_session: ProviderSession, albumId: string): Promise<AlbumTrack[]> {
    const url = `${DeezerMusicProvider.API}/album/${encodeURIComponent(albumId)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' },
    });
    if (!res.ok) {
      // 404 = 专辑 id 无效；其余（5xx / 限流）= 上游故障 → 502
      if (res.status === 404) {
        throw new NotFoundException(`Deezer album not found: ${albumId}`);
      }
      throw new BadGatewayException(`deezer album tracks failed: ${res.status}`);
    }
    const json = (await res.json()) as DeezerAlbumDetail & {
      error?: { message?: string };
    };
    if (json.error) {
      // Deezer 用 **HTTP 200 + {error:{type:'DataException',message:'no data',code:800}}**
      // 表达"查无此专辑"（实测 2026-09-30），不是 404。所以必须看 body 里的
      // error.message 才知道是 404 还是上游故障。
      const msg = json.error.message ?? 'unknown';
      if (/no data/i.test(msg)) {
        throw new NotFoundException(`Deezer album not found: ${albumId}`);
      }
      // 其余 error（Deezer 限流也走 200+error）= 上游故障 → 502
      throw new BadGatewayException(`deezer album tracks error: ${msg}`);
    }
    const list = json.tracks?.data ?? [];
    this.logger.log(`Deezer getAlbumTracks "${albumId}" → ${list.length} 首`);
    return list.map((t): AlbumTrack => {
      const base = this.toTrack(t);
      return {
        ...base,
        // 曲目所属专辑的封面：/album/{id} 顶层有 cover_xl，条目内的
        // t.album 可能为空（实测），所以用顶层兜。
        coverUrl: base.coverUrl || json.cover_xl || '',
        trackNumber: undefined,
        discNumber: undefined,
      };
    });
  }

  async fetchRadioBatch(
    _session: ProviderSession,
    preset: string = 'all',
    count = 5,
  ): Promise<Track[]> {
    const editorialId = DEEZER_EDITORIALS_PRESET[preset] ?? 132;
    return this.fetchEditorialCharts(editorialId, count);
  }

  /**
   * 相邻艺人（reco 候选池用）：`/search/artist` 定位艺人 id →
   * `/artist/{id}/related` 取 Deezer 的相关艺人列表。
   *
   * 为什么这是有价值的信号：Deezer 的 related 是平台侧基于真实收听行为算出来
   * 的相似度（协同过滤结果），比让 LLM 凭空想"哪些歌手风格相近"可靠得多。
   * Deezer 公开 API 匿名可用，不需要登录态。
   *
   * 失败即抛（由 MusicService 那层 fail-soft 兜成空数组）。
   */
  async fetchRelatedArtists(
    _session: ProviderSession,
    artistName: string,
    count = 6,
  ): Promise<string[]> {
    const name = artistName.trim();
    if (!name) return [];
    const headers = { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' };

    const searchUrl = new URL(`${DeezerMusicProvider.API}/search/artist`);
    searchUrl.searchParams.set('q', name);
    searchUrl.searchParams.set('limit', '1');
    const searchRes = await fetch(searchUrl.toString(), { headers });
    if (!searchRes.ok) {
      throw new Error(`deezer artist search failed: ${searchRes.status}`);
    }
    const searched = (await searchRes.json()) as { data?: DeezerArtist[] };
    const artistId = searched.data?.[0]?.id;
    if (!artistId) return [];

    const relatedUrl = new URL(`${DeezerMusicProvider.API}/artist/${artistId}/related`);
    relatedUrl.searchParams.set('limit', String(Math.max(1, Math.min(count * 2, 50))));
    const relRes = await fetch(relatedUrl.toString(), { headers });
    if (!relRes.ok) {
      throw new Error(`deezer related artists failed: ${relRes.status}`);
    }
    const related = (await relRes.json()) as { data?: DeezerArtist[] };
    // 去掉"相关艺人"里混进来的自己（Deezer 偶尔把同一艺人的另一种写法给回来）。
    const selfKey = name.toLowerCase();
    return (related.data ?? [])
      .map((a) => a.name?.trim())
      .filter((n): n is string => Boolean(n) && n.toLowerCase() !== selfKey)
      .slice(0, Math.max(1, count));
  }

  /**
   * Pull a batch of tracks from a Deezer editorial chart
   * (e.g. editorial/16 = Asian Music, editorial/132 = International Pop).
   * These are Deezer's curated rankings, not the user's chart endpoint.
   */
  private async fetchEditorialCharts(editorialId: number, count: number): Promise<Track[]> {
    const url = `${DeezerMusicProvider.API}/editorial/${editorialId}/charts?limit=${count}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' },
    });
    if (!res.ok) {
      throw new Error(`deezer editorial fetch failed: ${res.status}`);
    }
    // Editorial charts response shape: { tracks: { data: [...] }, ... }
    const json = (await res.json()) as { tracks?: { data?: DeezerTrack[] } };
    const data = json.tracks?.data ?? [];
    if (!data.length) {
      throw new Error(`deezer editorial ${editorialId} returned no tracks`);
    }
    return data.map((t) => this.toTrack(t));
  }

  /**
   * Deezer 的 preview URL 已经在 fetchRadioBatch 里给出，但有时效。
   * 这里重新拉一次保证 URL 是新鲜的（防止队列里靠后的歌 preview 过期）。
   */
  async getStreamPath(_session: ProviderSession, trackId: string): Promise<string> {
    const res = await fetch(`${DeezerMusicProvider.API}/track/${trackId}`, {
      headers: { 'User-Agent': 'Maestro/1.0 (Deezer anonymous)' },
    });
    if (!res.ok) {
      throw new Error(`deezer track fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as DeezerTrack;
    if (!json.preview) {
      throw new Error('deezer track has no preview url');
    }
    return json.preview;
  }

  private toTrack(t: DeezerTrack): Track {
    return {
      id: String(t.id),
      provider: 'deezer' as const,
      title: t.title_short || t.title,
      artist: t.artist?.name ?? '未知艺人',
      album: t.album?.title ?? '',
      coverUrl: t.album?.cover_xl ?? t.album?.cover_big ?? t.album?.cover_medium ?? '',
      // We give the 30s preview URL directly to the renderer. The deezer
      // CDN URL is hot-linkable and works for ~1 day; for a station that
      // plays 30s clips and then advances, this is plenty.
      audioUrl: t.preview,
      duration: Math.round(t.duration),
      liked: false,
    };
  }

  /**
   * Best-effort lyrics for a Deezer track. NOTE: Deezer's *public* API
   * (`/track/{id}`) usually does NOT include a `lyrics` field — synced
   * lyrics live behind an authenticated endpoint — so this most often
   * returns null, and the UI shows "暂无歌词". We still parse the two
   * shapes in case a token-bearing / regional response includes them:
   *   - `lyrics.data[*].syncText` — synced LRC body ([mm:ss.xx] tags);
   *     reuses NetEase's parseLrc.
   *   - `lyrics.data[*].text`     — unsynced plain text; each verse
   *     becomes its own untimed LyricLine.
   */
  async getLyrics(trackId: string): Promise<LyricLine[] | null> {
    try {
      const res = await fetch(`${DeezerMusicProvider.API}/track/${trackId}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        lyrics?: {
          data?: Array<{
            text?: string;
            syncText?: string;
          }>;
        };
      };
      const entries = data.lyrics?.data ?? [];
      // Try synced first — much better UX than unsynced.
      for (const entry of entries) {
        if (entry.syncText) {
          // Deezer's syncText is LRC-formatted; use the shared
          // parseLrc from common/lyrics.ts (same format as NetEase:
          // [mm:ss.xx] timestamps at the start of each line).
          const parsed = parseLrc(entry.syncText);
          if (parsed && parsed.length > 0) return parsed;
        }
      }
      // Fall back to unsynced plain text — show as a single block
      // line at time=0 so the user still sees the lyrics.
      for (const entry of entries) {
        if (entry.text) {
          // Split on newlines so each verse is its own line.
          const verses = entry.text
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (verses.length === 0) continue;
          return verses.map((text, i) => ({ time: i, text }));
        }
      }
      return null;
    } catch (err) {
      this.logger.warn(`deezer lyrics fetch failed for ${trackId}: ${(err as Error).message}`);
      return null;
    }
  }
}
