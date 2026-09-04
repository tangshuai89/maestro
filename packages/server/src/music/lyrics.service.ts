/**
 * 歌词服务（ISSUES.md §5.1）。
 *
 * 从 music.service.ts 拆出，集中管理：
 *   - getLyrics：单平台抓歌词（带 TTL 缓存）
 *   - getLyricsAggregated：主源 → 其余 source → lyrics.ovh 兜底
 *   - getLyricsAvailability：搜索结果行的「词」指示（只查平台源，不打 ovh）
 *
 * 留 MusicService：
 *   - getLyricsByName（手动「换个源找歌词」按钮）：依赖 searchEquivalent，
 *     而 searchEquivalent 又是 MusicService 的核心方法之一；为避免循环
 *     依赖暂留原位。MusicService 自身调 getLyrics 时走本 service。
 *
 * Cache：独立 lyricsCache Map（与 MusicService 完全隔离），按容量淘汰
 * （LYRICS_CACHE_MAX）+ 时间维度（LYRICS_CACHE_TTL_MS）。
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type LyricLine } from '../common/lyrics';
import { type Session } from '../common/session';
import { type MusicProvider } from '../common/provider';
import { QqMusicProvider } from './qq.provider';
import { NeteaseMusicProvider } from './netease.provider';
import { DeezerMusicProvider } from './deezer.provider';
import { LyricsOvhProvider } from './lyricsovh.provider';
import { type ProviderSession } from '../common/session';

const ANONYMOUS_PROVIDERS = new Set<MusicProvider>(['deezer']);

const LYRICS_SOURCE_PRIORITY: MusicProvider[] = ['qq', 'netease', 'deezer'];
const LYRICS_CACHE_TTL_MS = 10 * 60 * 1000;
const LYRICS_CACHE_MAX = 2_000;

/** 有任何一行 time>0 才算 synced——lyrics.ovh / Deezer 纯文本歌词全部
 *  返回非 synced。 */
function isSynced(lines: LyricLine[]): boolean {
  return lines.some((l) => l.time > 0);
}

export interface LyricsAggregatedResult {
  lines: LyricLine[] | null;
  synced: boolean;
  source: MusicProvider | 'lyricsovh' | null;
}

@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);
  /** (provider:trackId | ovh:artist|title) → 最近一次歌词结果。miss（null）
   *  也缓存，availability 扫描一页搜索结果时不至于反复打同一批接口。 */
  private readonly lyricsCache = new Map<
    string,
    { at: number; lines: LyricLine[] | null }
  >();

  constructor(
    private readonly netease: NeteaseMusicProvider,
    private readonly deezer: DeezerMusicProvider,
    private readonly qq: QqMusicProvider,
    private readonly lyricsOvh: LyricsOvhProvider,
  ) {}

  /**
   * 单平台抓歌词（带 TTL 缓存）。失败不缓存（下次还有机会重试）。
   */
  async getLyrics(
    session: Session,
    provider: MusicProvider,
    trackId: string,
  ): Promise<LyricLine[] | null> {
    const cacheKey = `${provider}:${trackId}`;
    const cached = this.lyricsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LYRICS_CACHE_TTL_MS) {
      return cached.lines;
    }
    let lines: LyricLine[] | null = null;
    try {
      if (provider === 'netease') {
        const ps = this.requireProviderSession(session, provider);
        if (ps) lines = await this.netease.getLyrics(ps, trackId);
      } else if (provider === 'deezer') {
        lines = await this.deezer.getLyrics(trackId);
      } else if (provider === 'qq') {
        // QQ: lyrics work anonymously; pass session cookie if we have one
        // (harmless) but fall back to an empty session otherwise.
        lines = await this.qq.getLyrics(session.providers.qq ?? {}, trackId);
      }
      // Spotify exposes no lyrics API — falls through as null.
    } catch (err) {
      this.logger.warn(
        `lyrics fetch failed (${provider}/${trackId}): ${(err as Error).message}`,
      );
      return null; // 失败不缓存，下次还有机会
    }
    this.lyricsCache.set(cacheKey, { at: Date.now(), lines });
    this.pruneLyricsCache();
    return lines;
  }

  /**
   * 多源歌词聚合：主平台 → 其余 source（按 LYRICS_SOURCE_PRIORITY 顺序）
   * → lyrics.ovh 兜底。第一个命中即返回，并标注来源与是否带时间戳（synced）。
   */
  async getLyricsAggregated(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    extras: Array<{ platform: MusicProvider; trackId: string }>,
    title: string,
    artist: string,
  ): Promise<LyricsAggregatedResult> {
    const tried = new Set<string>();
    const attempts: Array<{ platform: MusicProvider; trackId: string }> = [];
    if (trackId) attempts.push({ platform: provider, trackId });
    for (const p of LYRICS_SOURCE_PRIORITY) {
      for (const e of extras) {
        if (e.platform === p && e.trackId) attempts.push(e);
      }
    }
    for (const a of attempts) {
      const key = `${a.platform}:${a.trackId}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const lines = await this.getLyrics(session, a.platform, a.trackId);
      if (lines && lines.length > 0) {
        return { lines, synced: isSynced(lines), source: a.platform };
      }
    }
    // 第三方兜底（纯文本，无时间戳）
    if (title && artist) {
      const ovhKey = `ovh:${artist}|${title}`;
      const cached = this.lyricsCache.get(ovhKey);
      let lines: LyricLine[] | null;
      if (cached && Date.now() - cached.at < LYRICS_CACHE_TTL_MS) {
        lines = cached.lines;
      } else {
        lines = await this.lyricsOvh.getLyrics(artist, title);
        this.lyricsCache.set(ovhKey, { at: Date.now(), lines });
        this.pruneLyricsCache();
      }
      if (lines && lines.length > 0) {
        return { lines, synced: false, source: 'lyricsovh' };
      }
    }
    return { lines: null, synced: false, source: null };
  }

  /**
   * 歌词可用性——搜索结果行的「词」指示用。只查平台源（不打 lyrics.ovh，
   * 避免为一页 20 行结果轰第三方），第一个命中即停。
   */
  async getLyricsAvailability(
    session: Session,
    sources: Array<{ platform: MusicProvider; trackId: string }>,
  ): Promise<{ available: boolean; source: MusicProvider | null }> {
    const ordered = [...sources].sort(
      (a, b) =>
        LYRICS_SOURCE_PRIORITY.indexOf(a.platform) -
        LYRICS_SOURCE_PRIORITY.indexOf(b.platform),
    );
    for (const s of ordered) {
      if (!s.trackId) continue;
      if (!LYRICS_SOURCE_PRIORITY.includes(s.platform)) continue;
      const lines = await this.getLyrics(session, s.platform, s.trackId);
      if (lines && lines.length > 0) {
        return { available: true, source: s.platform };
      }
    }
    return { available: false, source: null };
  }

  // ── helpers ───────────────────────────────────────────────────────

  private requireProviderSession(
    session: Session,
    provider: MusicProvider,
  ): ProviderSession | undefined {
    if (ANONYMOUS_PROVIDERS.has(provider)) return undefined;
    const ps = session.providers[provider];
    if (!ps) {
      throw new NotFoundException(`Not logged in to ${provider}`);
    }
    return ps;
  }

  private pruneLyricsCache(): void {
    if (this.lyricsCache.size <= LYRICS_CACHE_MAX) return;
    for (const key of this.lyricsCache.keys()) {
      this.lyricsCache.delete(key);
      if (this.lyricsCache.size <= LYRICS_CACHE_MAX) break;
    }
  }
}
