/**
 * 歌词服务（ISSUES.md §5.1）。
 *
 * 从 music.service.ts 拆出，集中管理：
 *   - getLyrics：单平台抓歌词（带 TTL 缓存）
 *   - getLyricsAggregated：多源并行拉取 → LRC 合并去重 → lyrics.ovh 兜底
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
import {
  type LyricLine,
  type LyricSourceBundle,
  isSyncedLyrics,
  mergeLyricSources,
} from '../common/lyrics';
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


/** 参与合并的来源标识——平台源或 lyrics.ovh 第三方兜底。 */
export type LyricsSourceId = MusicProvider | 'lyricsovh';

export interface LyricsAggregatedResult {
  lines: LyricLine[] | null;
  synced: boolean;
  /** 主来源（优先级最高的贡献者）——向后兼容的旧字段，语义不变。 */
  source: LyricsSourceId | null;
  /** 实际贡献了行的来源（优先级降序）。length > 1 = 发生了多源合并。 */
  mergedFrom: LyricsSourceId[];
  /** 低优先级源补进来的行数（并集增量）。 */
  added: number;
  /** 文本重复被去重丢弃的行数。 */
  dropped: number;
  /** 时间轴对不齐、被整源放弃的来源。 */
  rejected: LyricsSourceId[];
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

  /**
   * In-flight coalescing for `getLyrics`（稳定性扫描：同 searchEquivalent
   * 的 race 模式）。availability 扫描（getLyricsAvailability 顺序调每个源）
   * 会同 key 触发多次——加 inflight 让 N 个 awaiter 共享一次 fetch。
   */
  private readonly inflightLyrics = new Map<string, Promise<LyricLine[] | null>>();

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
    // In-flight coalescing：同 key 已有未完成请求 → 共享同一 Promise。
    const inflight = this.inflightLyrics.get(cacheKey);
    if (inflight) return inflight;
    const p = (async () => {
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
    })();
    this.inflightLyrics.set(cacheKey, p);
    p.finally(() => {
      if (this.inflightLyrics.get(cacheKey) === p) {
        this.inflightLyrics.delete(cacheKey);
      }
    });
    return p;
  }

  /**
   * 候选源（按优先级排序）：主平台 trackId 优先，其后按
   * LYRICS_SOURCE_PRIORITY 排 extras（同一首歌在其他平台的等价曲目）。
   * 平台去重——同一个 (platform, trackId) 只出现一次。
   */
  private buildCandidates(
    provider: MusicProvider,
    trackId: string,
    extras: Array<{ platform: MusicProvider; trackId: string }>,
  ): Array<{ platform: MusicProvider; trackId: string; priority: number }> {
    const out: Array<{
      platform: MusicProvider;
      trackId: string;
      priority: number;
    }> = [];
    const seen = new Set<string>();
    const push = (
      platform: MusicProvider,
      id: string,
      priority: number,
    ): void => {
      if (!id) return;
      const key = `${platform}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ platform, trackId: id, priority });
    };
    push(provider, trackId, 0);
    for (const p of LYRICS_SOURCE_PRIORITY) {
      for (const e of extras) {
        if (e.platform === p) push(e.platform, e.trackId, out.length);
      }
    }
    return out;
  }

  /**
   * 多源歌词聚合（NEXT-ITERATION §4）。
   *
   * 默认 `merge` 模式：**并行**拉所有候选源 → 交给 mergeLyricSources 做
   * LRC 合并去重（并集 + 按时间容差去重 + 错位源整源丢弃）→ 平台全落空
   * 才走 lyrics.ovh 第三方兜底（纯文本）。
   *
   * `merge: false` 走旧的 first-hit-wins 快路径（第一个命中即返回，
   * 不打其余源），保留给「只想知道有没有词」的轻量场景。
   *
   * 为什么 ovh 不参与合并：lyrics.ovh 返回的是纯文本（无时间戳），
   * 落不进时间轴；且为一首歌轰第三方只应在平台全落空时才发生
   * （与 getLyricsAvailability 的合规口径一致）。
   */
  async getLyricsAggregated(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    extras: Array<{ platform: MusicProvider; trackId: string }>,
    title: string,
    artist: string,
    opts?: { merge?: boolean },
  ): Promise<LyricsAggregatedResult> {
    const candidates = this.buildCandidates(provider, trackId, extras);
    if (candidates.length === 0) {
      return this.emptyResult();
    }

    if (opts?.merge === false) {
      for (const c of candidates) {
        const lines = await this.getLyrics(session, c.platform, c.trackId);
        if (lines && lines.length > 0) {
          return {
            lines,
            synced: isSyncedLyrics(lines),
            source: c.platform,
            mergedFrom: [c.platform],
            added: 0,
            dropped: 0,
            rejected: [],
          };
        }
      }
    } else {
      // 并行拉取：合并要看到所有源才能算并集，串行会白等 N 个 RTT。
      // getLyrics 内部已 catch（未登录 / 网络错 → null）且带 TTL 缓存 +
      // in-flight 合并，allSettled 只是再加一层保险。
      const settled = await Promise.allSettled(
        candidates.map((c) =>
          this.getLyrics(session, c.platform, c.trackId),
        ),
      );
      const bundles: LyricSourceBundle[] = [];
      settled.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const lines = r.value;
        if (!lines || lines.length === 0) return;
        bundles.push({
          source: candidates[i].platform,
          priority: candidates[i].priority,
          lines,
        });
      });
      const merged = mergeLyricSources(bundles);
      if (merged && merged.lines.length > 0) {
        const mergedFrom = merged.sources as LyricsSourceId[];
        return {
          lines: merged.lines,
          synced: merged.synced,
          source: mergedFrom[0] ?? provider,
          mergedFrom,
          added: merged.added,
          dropped: merged.dropped,
          rejected: merged.rejected as LyricsSourceId[],
        };
      }
    }

    // 平台全落空 → 第三方兜底（纯文本，无时间戳）
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
        return {
          lines,
          synced: false,
          source: 'lyricsovh',
          mergedFrom: ['lyricsovh'],
          added: 0,
          dropped: 0,
          rejected: [],
        };
      }
    }
    return this.emptyResult();
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

  private emptyResult(): LyricsAggregatedResult {
    return {
      lines: null,
      synced: false,
      source: null,
      mergedFrom: [],
      added: 0,
      dropped: 0,
      rejected: [],
    };
  }

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
