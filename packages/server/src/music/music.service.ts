import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { MusicProvider, MUSIC_PROVIDERS } from '../common/provider';
import { StorageService } from '../common/storage';
import { ProviderSession, Session } from '../common/session';
import { QqMusicProvider, QqQuality } from './qq.provider';
import { NeteaseMusicProvider } from './netease.provider';
import { DeezerMusicProvider } from './deezer.provider';
import { SpotifyMusicProvider } from './spotify.provider';
import { type LyricLine } from '../common/lyrics';
import type {
  Track,
  UnifiedSearchResult,
  UnifiedSearchItem,
  ProviderSearchRaw,
  SourceInfo,
} from './types';
import {
  buildUnifiedItems,
  dedupTracks,
  normalizeKey,
  stripParensContent,
  VERSION_DURATION_TOLERANCE_SEC,
  DIFFERENT_VERSION_DURATION_TOLERANCE_SEC,
  mergeCrossScript,
} from './search.util';
import { extractVersionTag, type VersionTag } from '@maestro/common';
import { MatchService } from '../match/match.service';
import { jaroWinkler } from '../match/fuzzy';
import { artistTransliterationMatch, warmupJa, romanizeJa } from './translit';
import { withTimeout } from '../common/timeout';
import { LikeSyncQueue, type LikeSyncTask } from './like-sync.queue';
import { LyricsOvhProvider } from './lyricsovh.provider';

/** unified search 单平台硬超时——5s。超过这个时间视为该平台缺席，
 *  不阻塞其他平台。Spotify 偶发 504 较常见，所以这个时间不能太松。 */
const UNIFIED_SEARCH_TIMEOUT_MS = 5_000;

/** fanOut 状态上限——超过这个数 loadState 时按插入顺序淘汰最早的。
 *  5000 对应重度用户 1-2 年的累计 ❤ 量，再多就是滥用。 */
const FANOUT_MAX = 5_000;

/** 歌词多源回退顺序——QQ 匿名可用且 LRC 最全，其次网易云（需登录），
 *  Deezer 大多没词（公共 API 不带 lyrics）。Spotify 无歌词 API，不在列。 */
const LYRICS_SOURCE_PRIORITY: MusicProvider[] = ['qq', 'netease', 'deezer'];

/** 歌词结果（含 miss）的内存缓存 TTL / 容量上限。 */
const LYRICS_CACHE_TTL_MS = 10 * 60 * 1000;
const LYRICS_CACHE_MAX = 2_000;

/** 跨平台等价曲搜索（同 (session, platform, title+artist kw, 时长分桶)）的内存缓存。
 *  TTL 按结果性质分级：
 *  - **命中 / 干净缺席**（搜索成功但匹配不到——歌确实不在该平台）→ 1h。缺席是
 *    稳定事实，每次 detect 都重搜会白占队列（用户场景：Spotify 没有中文老歌，
 *    fanOut 永远不含它，skip-enqueue 短路不生效，每切一次歌都重搜一遍）。
 *  - **失败 / 超时**（网络抖动、API 报错——不代表缺席）→ 30s。给网络恢复留
 *    空间，下个 30s 窗口重新搜。
 *  容量上限不变。 */
const EQUIV_MATCH_CACHE_TTL_MS = 60 * 60 * 1000;
const EQUIV_FAIL_CACHE_TTL_MS = 30_000;
const EQUIV_SEARCH_CACHE_MAX_PER_SESSION = 256;

/** 有任何一行 time>0 才算 synced——lyrics.ovh / Deezer 纯文本歌词全部
 *  time=0，前端据此关掉滚动高亮和点击跳转。 */
function isSynced(lines: LyricLine[]): boolean {
  return lines.some((l) => l.time > 0);
}

/** 跨平台匹配用的曲目元数据。点 ❤ / 检测已红心时随请求带上，用来去其余已登录
 *  平台搜同名同时长的等价曲目（严格 duration gate），把红心真正同步过去。 */
export interface LikeMeta {
  title: string;
  artist: string;
  duration: number;
}

interface ProviderState {
  queue: Track[];
  liked: Set<string>;
  disliked: Set<string>;
}

/** Heart fan-out 在每个 session 下的完整状态。
 *  - providers: 老的 per-provider queue/liked/disliked（不变）
 *  - fanOut: mergedId → "这个统一 track 已经在哪些平台心动了"（fan-out 实现基础）
 *
 *  fanOut 只在 liked=true 路径被写入；liked=false 反向清除时按这里记录的
 *  平台列表 unlike——保证"只动我们之前心过的"，不会误清空用户原本单平台
 *  心过的同一首歌。 */
export interface MusicSessionState {
  providers: Record<MusicProvider, ProviderState>;
  /** mergedId → 在哪些平台心动了（含每平台的代表 trackId，用于 mergedId
   *  漂移时按曲目重合归一 + unlike 时兜底定位）。空对象 = 无 fan-out 记录。
   *  老格式（纯平台名数组）在 loadState 时被 coerce 成 trackId 缺省的条目。 */
  fanOut: Record<string, FanOutEntry[]>;
}

/** fanOut 记录里的单个平台条目。trackId 可能缺省（老格式迁移而来）。 */
export interface FanOutEntry {
  platform: MusicProvider;
  trackId?: string;
}

/** Some providers (Deezer) work without any auth — they don't need a
 * ProviderSession. We treat them as "always available". */
const ANONYMOUS_PROVIDERS: ReadonlySet<MusicProvider> = new Set<MusicProvider>([
  'deezer',
]);

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  /**
   * getLibrary 派生结果缓存（per session）。3000+ 首库 + ~5000 fanOut 条目
   * 场景下，原 `getLibrary` 每调一次都要遍历全部 items 做 fanOut 合并，O(I×S×F)
   * ≈ 30M ops —— 几百 ms。加入缓存后 fanOut / storage.items 任一未变就直接
   * return，命中时 < 1ms。
   *
   * cache key：
   *  - sessionId
   *  - fanOutSignature：fanOut 总 key 数 + 每个 key 的 entry 数。任何 fanOut
   *    真变更（增/删/替换条目）都改签名 → invalidate。幂等"未变更"路径签名
   *    不变 → cache hit。fanOut 真假变更（mergeFanOutEntries 同内容覆盖）极
   *    罕见且结果一致，可接受。
   *  - storedRef：`StorageService.cache[library:{id}]` 的引用。importLiked
   *    会把整个 items 数组替换为新对象 → storedRef 变 → invalidate。
   */
  private readonly libraryCache = new Map<
    string,
    {
      result: {
        items: UnifiedSearchItem[];
        sources: Array<{
          provider: MusicProvider;
          count: number;
          error?: string;
        }>;
        importedAt: number;
      };
      fanOutSignature: string;
      storedRef: object;
    }
  >();

  private fanOutSignature(fanOut: Record<string, FanOutEntry[]>): string {
    const keys = Object.keys(fanOut);
    let h = `${keys.length}|`;
    for (const k of keys) {
      const e = fanOut[k];
      if (!e) continue;
      h += `${k}=${e.length};`;
    }
    return h;
  }

  constructor(
    private readonly storage: StorageService,
    private readonly qq: QqMusicProvider,
    private readonly netease: NeteaseMusicProvider,
    private readonly deezer: DeezerMusicProvider,
    private readonly spotify: SpotifyMusicProvider,
    private readonly lyricsOvh: LyricsOvhProvider,
    private readonly match: MatchService,
    private readonly likeSync: LikeSyncQueue,
  ) {
    // 把「同步一首歌的红心到某平台」的实际写操作交给同步队列的 worker 回调。
    // 队列负责合并去重 / 串行 / 退避重试；这里只提供「怎么写一次」的逻辑。
    this.likeSync.registerProcessor((session, platform, trackId, liked) =>
      this.syncLikeRemoteOnce(session, platform, trackId, liked),
    );
    // 跨平台匹配回调：队列消费 like 任务时，先去其余已登录平台搜等价曲目
    // 并落地本地 liked/fanOut，返回新目标供队列同步远端（严格 duration gate）。
    this.likeSync.registerDiscoverResolver((task) =>
      this.resolveEquivalents(task),
    );
    // 后台预热 kuromoji 日文形态素词典（跨脚本艺人音译佐证用）。fire-and-forget：
    // 加载 ~15 个词典分片需几百 ms，趁启动到用户第一次切歌之间完成；没就绪时
    // artistTransliterationMatch 优雅降级到纯拼音/假名路线，不阻塞、不抛。
    void warmupJa();
  }

  private stateKey(sessionId: string): string {
    return `music:${sessionId}`;
  }

  private loadState(session: Session): MusicSessionState {
    const fresh = (): ProviderState => ({
      queue: [],
      liked: new Set<string>(),
      disliked: new Set<string>(),
    });
    // 始终以完整默认骨架起步，再叠加持久化数据，保证三个 provider 都存在。
    const providers: Record<MusicProvider, ProviderState> = {
      qq: fresh(),
      netease: fresh(),
      deezer: fresh(),
      spotify: fresh(),
    };
    const fanOut: Record<string, FanOutEntry[]> = {};

    const persisted = this.storage.get<Record<string, unknown>>(
      this.stateKey(session.id),
    );
    if (persisted) {
      // 兼容老格式：持久化里直接是 {qq: {queue, liked, ...}, netease: ..., deezer: ...}
      // 新格式：在 providers 之外多一层 fanOut 字段。
      const persistedProviders =
        (persisted as { providers?: Record<string, unknown> }).providers ??
        (persisted as unknown as Record<string, unknown>);
      for (const key of ['qq', 'netease', 'deezer', 'spotify'] as MusicProvider[]) {
        const s = persistedProviders[key] as Partial<ProviderState> | undefined;
        if (!s) continue;
        // 稳健还原：无论持久化里是数组、旧版 Set→{} 空对象、还是 undefined，
        // 一律 coerce 成 Set / 数组，避免 `.has is not a function`。
        providers[key] = {
          queue: Array.isArray(s.queue) ? (s.queue as Track[]) : [],
          liked: new Set(
            Array.isArray(s.liked) ? (s.liked as unknown as string[]) : [],
          ),
          disliked: new Set(
            Array.isArray(s.disliked)
              ? (s.disliked as unknown as string[])
              : [],
          ),
        };
      }
      // fanOut 是新加的，老持久化文件没这个字段是正常的。
      const rawFanOut = (persisted as { fanOut?: unknown }).fanOut;
      if (rawFanOut && typeof rawFanOut === 'object') {
        const isLikeableName = (p: unknown): p is MusicProvider =>
          // deezer 不再参与红心记账：过滤掉历史污染进 fanOut 的 deezer。
          p === 'qq' || p === 'netease' || p === 'spotify';
        for (const [k, v] of Object.entries(rawFanOut)) {
          if (!Array.isArray(v)) continue;
          const entries: FanOutEntry[] = [];
          for (const item of v) {
            // 老格式：平台名字符串；新格式：{platform, trackId}。
            if (isLikeableName(item)) {
              entries.push({ platform: item });
            } else if (
              item &&
              typeof item === 'object' &&
              isLikeableName((item as FanOutEntry).platform)
            ) {
              const e = item as FanOutEntry;
              entries.push({
                platform: e.platform,
                trackId:
                  typeof e.trackId === 'string' ? e.trackId : undefined,
              });
            }
          }
          if (entries.length) fanOut[k] = entries;
        }
      }
    }
    // 匿名源（deezer）无收藏概念：清掉历史 bug 污染进 liked 的记录，
    // 否则 deezer 电台会显示假红心、角标虚高。disliked 是合法的（电台过滤用），保留。
    for (const p of ANONYMOUS_PROVIDERS) {
      providers[p].liked.clear();
    }
    // fanOut GC：
    //  1) orphan：mergedId 对应的所有 platform 都没在 liked 集合里 → 删
    //     （理论上 fanOutLike 写时已经保证一致，但用户可能在外部 JSON
    //     改过 state.json，或者 unified-search mergedId 重建后变孤儿）
    //  2) LRU 上限：超过 FANOUT_MAX 就按插入顺序淘汰最早的
    // （unified track 是按"被心动"的顺序写入的，对应 Object 插入顺序）
    for (const [mergedId, entries] of Object.entries(fanOut)) {
      const stillLiked = entries.some(
        (e) => providers[e.platform].liked.size > 0,
      );
      // 粗粒度判断：只要该平台有任意 liked 就算 mergedId 仍可能有效。
      // 实际"哪首歌在哪个平台 liked"是精确匹配；这里做廉价启发式，
      // 误删概率低（删了用户重新 heart 即可）。
      const orphan = !stillLiked;
      if (orphan) {
        delete fanOut[mergedId];
      }
    }
    const keys = Object.keys(fanOut);
    if (keys.length > FANOUT_MAX) {
      const drop = keys.length - FANOUT_MAX;
      for (let i = 0; i < drop; i++) delete fanOut[keys[i]];
    }
    return { providers, fanOut };
  }

  private saveState(session: Session, state: MusicSessionState): void {
    const serializable = {
      providers: {
        qq: {
          ...state.providers.qq,
          liked: [...state.providers.qq.liked],
          disliked: [...state.providers.qq.disliked],
        },
        netease: {
          ...state.providers.netease,
          liked: [...state.providers.netease.liked],
          disliked: [...state.providers.netease.disliked],
        },
        deezer: {
          ...state.providers.deezer,
          liked: [...state.providers.deezer.liked],
          disliked: [...state.providers.deezer.disliked],
        },
        spotify: {
          ...state.providers.spotify,
          liked: [...state.providers.spotify.liked],
          disliked: [...state.providers.spotify.disliked],
        },
      },
      fanOut: state.fanOut,
    };
    this.storage.set(this.stateKey(session.id), serializable);
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

  private async refillQueue(
    session: Session,
    provider: MusicProvider,
    state: MusicSessionState,
  ): Promise<void> {
    const ps = this.requireProviderSession(session, provider);
    let batch: Track[];
    if (provider === 'qq') {
      if (!ps || !this.qq.isConfigured(ps)) {
        throw new BadRequestException('QQ session not configured');
      }
      batch = await this.qq.fetchRadioBatch(ps);
    } else if (provider === 'netease') {
      if (!ps || !this.netease.isConfigured(ps)) {
        throw new BadRequestException('NetEase session not configured');
      }
      batch = await this.netease.fetchRadioBatch(ps);
    } else {
      // Deezer / future anonymous providers. Honour the user's preset
      // (set via /music/deezer/preset) and default to 'all' = international
      // pop. Storing it in the session keeps the picker persistent.
      const preset = session.prefs?.deezerPreset ?? 'all';
      batch = await this.deezer.fetchRadioBatch(ps as ProviderSession, preset);
    }
    const psState = state.providers[provider];
    batch = batch
      .filter((t) => !psState.disliked.has(t.id))
      .map((t) => {
        // Deezer's preview URL is a hot-linkable mp3. We expose it
        // directly (instead of routing through /music/stream/... like
        // QQ/NetEase) because the audio element then loads it with the
        // browser's own headers, and the cross-origin request is
        // allowed by Deezer's CDN (Access-Control-Allow-Origin: *).
        // The hdnea=… signature isn't strictly required to be honoured
        // for the 30s clip — the server-side redirect path was an
        // over-engineered workaround that turned out to break autoplay.
        const audioUrl = provider === 'deezer' && t.audioUrl && t.audioUrl.startsWith('http')
          ? t.audioUrl
          : this.streamPath(t);
        return {
          ...t,
          audioUrl,
          liked: psState.liked.has(t.id),
        };
      });
    psState.queue.push(...batch);
    this.saveState(session, state);
  }

  /** Get the next track from the radio. Auto-refills if the queue is empty. */
  async getNextTrack(session: Session, provider: MusicProvider): Promise<Track> {
    const state = this.loadState(session);
    const psState = state.providers[provider];
    while (psState.queue.length === 0) {
      try {
        await this.refillQueue(session, provider, state);
      } catch (err) {
        this.logger.warn(
          `refill failed (session=${session.id.slice(0, 8)}…, provider=${provider}): ${(err as Error).message}`,
        );
        // 兜底：返回一首占位让前端不卡死
        return this.placeholder(provider, (err as Error).message);
      }
      if (psState.queue.length === 0) break;
    }
    // refill 成功但产出 0 首（例如整批都被 disliked 过滤掉，或平台返回空）
    // → queue 仍空。此时 shift() 会返回 undefined，被 `!` 断言成 Track 传给
    // 前端造成"空曲目"。显式返回占位，别让 undefined 漏出去。
    if (psState.queue.length === 0) {
      return this.placeholder(provider, '暂无更多曲目');
    }
    const track = psState.queue.shift()!;
    this.saveState(session, state);
    return track;
  }

  /**
   * Resolve a stream URL by track ID. We re-fetch from the provider every time
   * because QQ/NetEase URLs expire within minutes. Deezer's preview URLs are
   * already inlined into the track payload, but we still route through
   * here for a consistent interface.
   */
  async getStreamUrl(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    opts?: { mediaMid?: string; quality?: QqQuality },
  ): Promise<string> {
    const ps = this.requireProviderSession(session, provider);
    if (provider === 'qq') {
      return this.qq.getStreamPath(
        ps!,
        trackId,
        opts?.mediaMid,
        opts?.quality ?? 'standard',
      );
    }
    if (provider === 'netease') {
      return this.netease.getStreamPath(ps!, trackId, opts?.quality ?? 'standard');
    }
    if (provider === 'spotify') {
      return this.spotify.getStreamPath(ps!, trackId);
    }
    return this.deezer.getStreamPath(ps!, trackId);
  }

  /**
   * 实时跨平台匹配：给定当前 track 的元数据（title/artist/duration），去
   * 「当前 session 已登录且能写红心」的其余平台搜同名同时长的等价曲目，返回
   * 首个命中的源（含可播放的后端代理 audioUrl），让前端在 code=4 失败时直接切
   * 过去播放。按 PLAY_PRIORITY 取首个命中（qq > netease > spotify）。
   *
   * 与 `resolveEquivalents`（同步队列 discover 步）互补：那个只写 liked 状态、
   * 不返回可播放 URL；这里只查 + 返回、**不写状态**。修的是「当前在播的
   * unified item 只有 netease 一个 source，netease 挂了就无源可退」的播放盲点。
   *
   * 严格匹配：normalizeKey(歌名+歌手) 一致 + duration ±VERSION_DURATION_TOLERANCE_SEC。
   * 未登录 / 搜不到 / 异常 → null（best-effort）。
   */
  async findPlayableEquivalent(
    session: Session,
    seedProvider: MusicProvider,
    seed: LikeMeta,
  ): Promise<SourceInfo | null> {
    const priority: MusicProvider[] = ['qq', 'netease', 'spotify'];
    const candidates = priority.filter(
      (p) => p !== seedProvider && this.canSyncLike(session, p),
    );
    if (!candidates.length) return null;

    const found = await Promise.all(
      candidates.map(async (p) => {
        const t = await this.searchEquivalent(session, p, seed);
        return [p, t] as const;
      }),
    );

    // 按优先级取首个命中，转成带可播放代理 URL 的 SourceInfo。
    for (const p of priority) {
      const hit = found.find(([pp]) => pp === p);
      const t = hit?.[1];
      if (!t) continue;
      const playable = this.toPlayableTrack(t);
      return {
        platform: p,
        trackId: t.id,
        hasCopyright: true,
        url: playable.audioUrl,
        mediaMid: t.mediaMid,
      };
    }
    return null;
  }

  /**
   * 按关键词搜索（当前仅 QQ）。搜索不强制登录——用户可以先搜再登录；
   * 但真正播放（getStreamUrl）需要登录态。返回的 audioUrl 统一是后端
   * 代理相对路径，前端拿不到 raw URL。
   */
  async searchTracks(
    session: Session,
    provider: MusicProvider,
    keyword: string,
  ): Promise<Track[]> {
    const kw = keyword.trim();
    if (!kw) return [];

    let tracks: Track[];
    if (provider === 'qq') {
      const ps = session.providers.qq; // 可能未登录（QQ 搜索允许匿名）
      tracks = await this.qq.search(ps ?? {}, kw);
    } else if (provider === 'netease') {
      // 网易云搜索需要登录态（cookie）。未登录时 requireProviderSession 抛 404。
      const ps = this.requireProviderSession(session, 'netease');
      tracks = await this.netease.search(ps!, kw);
    } else if (provider === 'spotify') {
      const ps = this.requireProviderSession(session, 'spotify');
      tracks = await this.spotify.search(ps!, kw);
    } else {
      throw new BadRequestException(`搜索暂不支持 ${provider}`);
    }

    const state = this.loadState(session);
    const { liked, disliked } = state.providers[provider];
    return tracks
      .filter((t) => !disliked.has(t.id))
      .map((t) => ({
        ...t,
        audioUrl: this.streamPath(t),
        liked: liked.has(t.id),
      }));
  }

  /**
   * 跨平台统一搜索。同时查 QQ/网易云/Deezer，合并去重后返回统一结果。
   * 单个平台挂了不影响其他平台——部分结果仍然返回，失败的平台标记 error。
   *
   * 去重: ISRC 不可用时用"歌名+歌手"标准化匹配。
   * 排序: bestSource 优先（qq > netease > deezer，且 hasCopyright）。
   */
  async searchUnified(
    session: Session,
    keyword: string,
    page = 1,
    pageSize = 20,
  ): Promise<UnifiedSearchResult> {
    const kw = keyword.trim();
    if (!kw || kw.length > 100) {
      throw new BadRequestException('q 参数无效：1-100 字符');
    }
    // 输入清洗：page / pageSize 来自 query string，可能是 "abc"/"-1"/"999"。
    // 不防御性 cast 直接传到 slice 会产生 NaN slice / 负 length 数组。
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const effectivePageSize = Number.isFinite(pageSize)
      ? Math.min(50, Math.max(1, Math.floor(pageSize)))
      : 20;

    // 并行搜索三个平台，单个超时 5 秒不阻塞其他平台。
    const results = await Promise.all(
      MUSIC_PROVIDERS.map((p) => this.searchOneProvider(session, p, kw)),
    );

    // 合并所有平台的搜索结果到一个扁平数组。
    const allTracks: { track: Track; platform: MusicProvider }[] = [];
    for (const r of results) {
      for (const t of r.tracks) {
        allTracks.push({ track: t, platform: r.platform });
      }
    }

    // 去重: 歌名+歌手标准化 → 第一个出现的 track 作为主记录。
    const deduped = dedupTracks(allTracks);

    // 构建 UnifiedSearchItem，每个 item 聚合各平台的 source。
    const items = buildUnifiedItems(deduped, allTracks);

    // 分页（服务端分页，不依赖前端截断）。
    const total = items.length;
    const start = (safePage - 1) * effectivePageSize;
    const paged = items.slice(start, start + effectivePageSize);

    // 记录失败平台（不影响返回，前端可选展示）。
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      this.logger.warn(
        `unified search "${kw}" partial: ${errors.map((e) => `${e.platform}(${e.error})`).join(', ')}`,
      );
    }

    return { q: kw, total, page: safePage, pageSize: effectivePageSize, items: paged };
  }

  /** 查单个平台，带 5 秒超时。失败返回空 track + error。 */
  private async searchOneProvider(
    session: Session,
    provider: MusicProvider,
    keyword: string,
  ): Promise<ProviderSearchRaw> {
    return withTimeout(
      () => this.doSearchOneProvider(session, provider, keyword),
      UNIFIED_SEARCH_TIMEOUT_MS,
      () =>
        this.logger.warn(
          `unified search "${keyword}" on ${provider} timed out (>${UNIFIED_SEARCH_TIMEOUT_MS}ms)`,
        ),
    ).then(
      (res) => res ?? { platform: provider, tracks: [], total: 0, error: 'timeout' },
      // 兜底：doSearchOneProvider 契约上不 throw，但如果它意外 reject
      // （withTimeout 只 race、不 catch），这里必须把 reject 转成 error 结果。
      // 绝不能让单平台的 reject 冒泡到 searchUnified 的 Promise.all——否则
      // 一个平台没登录就会把整个统一搜索打成 404/500（回归 bug）。
      (err: unknown) => ({
        platform: provider,
        tracks: [],
        total: 0,
        error: (err as Error)?.message ?? 'error',
      }),
    );
  }

  /** 真正发请求的逻辑。剥离出来便于在 searchOneProvider 外面套 withTimeout。
   *  **契约：本方法绝不 throw**——某平台未登录 / 报错时返回带 error 的空结果，
   *  保证统一搜索永远是"部分结果 > 全盘失败"。 */
  private async doSearchOneProvider(
    session: Session,
    provider: MusicProvider,
    keyword: string,
  ): Promise<ProviderSearchRaw> {
    try {
      let tracks: Track[];
      if (provider === 'qq') {
        tracks = await this.qq.search(session.providers.qq ?? {}, keyword, 30);
      } else if (provider === 'netease') {
        // 网易云搜索需要登录态；未登录时 requireProviderSession 抛 404。
        const ps = this.requireProviderSession(session, 'netease');
        tracks = await this.netease.search(ps!, keyword, 30);
      } else if (provider === 'spotify') {
        // Spotify 搜索需要登录态；未登录时 requireProviderSession 抛 404。
        const ps = this.requireProviderSession(session, 'spotify');
        tracks = await this.spotify.search(ps!, keyword, 30);
      } else {
        tracks = await this.deezer.search(
          session.providers.deezer ?? {},
          keyword,
          30,
        );
      }
      // 统一搜索结果里 sources[].url 要带可播放的代理路径——provider.search()
      // 返回的 track.audioUrl 可能是空（QQ/网易云 URL 短期过期，播放时由
      // getStreamUrl 重新拿）。toPlayableTrack 统一换成后端代理相对路径，前端
      // 拼 base 后直接当 <audio src> 用（与「我的喜欢」导入共用同一归一化）。
      tracks = tracks.map((t) => this.toPlayableTrack(t));
      return { platform: provider, tracks, total: tracks.length };
    } catch (err) {
      // 未登录（NotFoundException）/ 平台报错 → 记一条 error 返回空结果。
      this.logger.warn(
        `unified search "${keyword}" on ${provider} failed: ${(err as Error).message}`,
      );
      return {
        platform: provider,
        tracks: [],
        total: 0,
        error: (err as Error).message,
      };
    }
  }

  /** 歌名+歌手标准化: 全角→半角、去空格、去标点、全小写。
   *  实际逻辑在 search.util.ts，方便白盒测试。 */
  private normalizeKey(title: string, artist: string): string {
    return normalizeKey(title, artist);
  }

  /** 后端代理相对路径；QQ 带上 media_mid 以便播放时选高音质。 */
  private streamPath(track: Track): string {
    const base = `/music/stream/${track.provider}/${encodeURIComponent(
      track.id,
    )}`;
    return track.provider === 'qq' && track.mediaMid
      ? `${base}?mm=${encodeURIComponent(track.mediaMid)}`
      : base;
  }

  /**
   * 把 provider.search() / fetchLiked() 返回的 track 归一成前端可直接当
   * <audio src> 用的形状：audioUrl 换成后端代理相对路径（QQ/网易云的原始
   * audioUrl 是空的——短期过期，播放时由 getStreamUrl 重新拿）。Deezer 的
   * audioUrl 已是 http 完整 URL（30s 预览）则保留。
   *
   * 统一搜索和「我的喜欢」导入共用同一份归一化，避免两条路径漂移——曾因为
   * 只有搜索做了这步、库导入没做，导致红心列表点击拿到空 audioUrl、无法切歌。
   */
  private toPlayableTrack(track: Track): Track {
    return {
      ...track,
      audioUrl:
        track.provider === 'deezer' &&
        track.audioUrl &&
        track.audioUrl.startsWith('http')
          ? track.audioUrl
          : this.streamPath(track),
    };
  }

  async markDisliked(
    session: Session,
    provider: MusicProvider,
    trackId: string,
  ): Promise<{ success: boolean }> {
    const state = this.loadState(session);
    state.providers[provider].disliked.add(trackId);
    state.providers[provider].liked.delete(trackId);
    this.saveState(session, state);

    const ps = session.providers[provider];
    if (provider === 'netease' && ps?.musicU) {
      try {
        // 踩 = 私人 FM「不喜欢」→ 走 fmTrash（垃圾桶），不是取消红心。
        await this.netease.fmTrash(ps, trackId);
      } catch (err) {
        this.logger.warn(
          `netease trash sync failed: ${(err as Error).message}`,
        );
      }
    }
    return { success: true };
  }

  /**
   * 统一 track 的「踩」：跨平台彻底不想再听这首。一次性做三件事——
   *  1. **取消跨平台红心**：走 fanOutLike(false)，按 state.fanOut[mergedId] 记录
   *     的平台真正 unlike（网易云用正确接口从「我喜欢的音乐」移除，见
   *     netease.unlike）+ 清 fanOut 记录 + 入队远端 unlike。这是本方法存在的
   *     核心理由——修「踩了一首 fan-out 的歌，其它平台红心还在、下次 detect
   *     又把它点亮/收藏回来」的复活循环。
   *  2. **本地 disliked 标记**（每平台一首）：电台补歌时过滤，不再刷到。
   *  3. **netease FM「不喜欢」**：best-effort 减少推荐（≠ 取消红心，第 1 步已做）。
   *
   * 与单平台 markDisliked 的区别：markDisliked 只动一个平台、且不碰红心；这里
   * 是跨平台，并且把收藏也一并清掉。幂等：未曾心动过的歌，第 1 步是 no-op。
   */
  async dislikeMerged(
    session: Session,
    mergedId: string,
    sources: Array<{ platform: MusicProvider; trackId: string }>,
  ): Promise<{ success: boolean }> {
    // 1. 取消跨平台红心（fanOutLike false 内部会 loadState/saveState + 入队，
    //    await 完成后其状态已落盘，下面的 loadState 读到的是清理后的态）。
    await this.fanOutLike(session, mergedId, sources, false);

    // 2. 本地 disliked 标记（每平台一首，和 fan-out「每平台一首」口径一致）。
    const state = this.loadState(session);
    const byPlatform = this.groupByPlatform(sources);
    const neteaseTargets: string[] = [];
    for (const [platform, trackIds] of byPlatform) {
      const trackId = trackIds[0];
      state.providers[platform].disliked.add(trackId);
      state.providers[platform].liked.delete(trackId); // fanOutLike 已清，双保险
      if (platform === 'netease') neteaseTargets.push(trackId);
    }
    this.saveState(session, state);

    // 3. netease FM「不喜欢」（减少推荐）。best-effort，失败不影响踩本身。
    const ps = session.providers.netease;
    if (ps?.musicU) {
      for (const trackId of neteaseTargets) {
        try {
          await this.netease.fmTrash(ps, trackId);
        } catch (err) {
          this.logger.warn(
            `netease fmTrash failed: ${(err as Error).message}`,
          );
        }
      }
    }
    return { success: true };
  }

  async getLikedTracks(
    session: Session,
    provider: MusicProvider,
  ): Promise<Track[]> {
    const state = this.loadState(session);
    const psState = state.providers[provider];
    // 简化：返回 liked 集合里的占位记录，真实元数据需要按需拉
    return [...psState.liked].map((id) => ({
      id,
      provider,
      title: '(已收藏)',
      artist: '',
      album: '',
      coverUrl: '',
      audioUrl: `/music/stream/${provider}/${encodeURIComponent(id)}`,
      duration: 0,
      liked: true,
    }));
  }

  /**
   * 在给定 state 上「反转」某平台的 like 状态，返回反转前是否已 like。
   * 纯内存操作（不 IO）。单平台 toggleLike 用它——用户点 ❤ 是"翻转"语义。
   */
  private applyLikeToggle(
    state: MusicSessionState,
    provider: MusicProvider,
    trackId: string,
  ): boolean {
    const psState = state.providers[provider];
    const wasLiked = psState.liked.has(trackId);
    if (wasLiked) {
      psState.liked.delete(trackId);
    } else {
      psState.liked.add(trackId);
    }
    return wasLiked;
  }

  /**
   * 该平台是否有「收藏 / 红心」概念。Deezer 是匿名源、没有 per-user library
   * （importLiked 也把它标记为 anonymous_no_user_likes），所以它**永不参与红心
   * 记账**：本地 liked 集合、fanOut 记录、角标数、远端同步队列一律跳过。
   *
   * 未登录的 likeable 平台（QQ/网易云/Spotify）不在此列——它们仍会记本地「意图」，
   * 登录后 detect 会补同步；只有 Deezer 是结构性排除。
   */
  private isLikeable(provider: MusicProvider): boolean {
    return !ANONYMOUS_PROVIDERS.has(provider);
  }

  /**
   * 在给定 state 上把某平台的 like 状态「设为」目标值（幂等），返回是否
   * 发生了改变。fanOutLike 用它——fan-out 是"确保为目标态"语义，不是翻转：
   * 重复 like 一首已心动的歌不应把它 unlike。
   *
   * （回归测试 like.e2e #4 曾因 fanOutLike 误用 applyLikeToggle 翻转导致
   * "重复 like → 实际 unlike" 的 bug。）
   */
  private setLike(
    state: MusicSessionState,
    provider: MusicProvider,
    trackId: string,
    liked: boolean,
  ): boolean {
    // Deezer 等匿名源无收藏概念：任何写红心都 no-op（bulletproof——无论哪条
    // 路径误传 deezer，都不会污染本地 liked 集合 / 角标）。
    if (!this.isLikeable(provider)) return false;
    const psState = state.providers[provider];
    const has = psState.liked.has(trackId);
    if (liked && !has) {
      psState.liked.add(trackId);
      return true;
    }
    if (!liked && has) {
      psState.liked.delete(trackId);
      return true;
    }
    return false; // 已是目标态，无改变
  }

  /** 某平台当前 session 是否具备写红心的能力（有收藏概念 + 已登录）。
   *  Deezer 匿名没有 user 红心概念 → 永远 false，不会入同步队列。 */
  private canSyncLike(session: Session, provider: MusicProvider): boolean {
    if (!this.isLikeable(provider)) return false;
    const ps = session.providers[provider];
    switch (provider) {
      case 'qq':
        return !!ps?.qqCookie;
      case 'netease':
        return !!ps?.musicU;
      case 'spotify':
        return !!ps?.spotify;
      default:
        return false; // deezer
    }
  }

  /**
   * 同步一首歌的红心到某个平台的远端——**单次**写，供 LikeSyncQueue 的 worker
   * 回调。成功 → 乐观更新本地缓存；失败 → throw（队列据此退避重试）。
   *
   * 与旧的 fire-and-forget `syncLikeRemote` 的区别：
   *  - 不再自己吞异常，交给队列统一重试 + 记日志；
   *  - 平台返回 code≠0 / success=false 视为失败并 throw（旧实现静默丢弃）。
   *
   * 未登录 / Deezer 匿名 → 直接返回（视为「无需同步」，不 throw、不占重试）。
   */
  private async syncLikeRemoteOnce(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    liked: boolean,
  ): Promise<void> {
    const ps = session.providers[provider];
    if (provider === 'qq') {
      if (!ps?.qqCookie) return;
      const ts = Date.now();
      const ok = liked
        ? await this.qq.like(ps, trackId, ts)
        : await this.qq.unlike(ps, trackId, ts);
      if (!ok) throw new Error(`qq setFav(${liked}) returned false`);
      this.updateLikedCache(session, 'qq', trackId, liked);
      return;
    }
    if (provider === 'netease') {
      if (!ps?.musicU) return;
      // like → 加入「我喜欢的音乐」；unlike → radio/like?like=false 真正移除
      // （不是 trash，见 netease.unlike 注释）。
      const ok = liked
        ? await this.netease.like(ps, trackId)
        : await this.netease.unlike(ps, trackId);
      if (!ok) {
        throw new Error(`netease ${liked ? 'like' : 'unlike'} returned false`);
      }
      this.updateLikedCache(session, 'netease', trackId, liked);
      return;
    }
    if (provider === 'spotify') {
      if (!ps?.spotify) return;
      const res = liked
        ? await this.spotify.like(ps, trackId)
        : await this.spotify.unlike(ps, trackId);
      if (!res.success) {
        throw new Error(`spotify ${liked ? 'like' : 'unlike'} failed`);
      }
      this.updateLikedCache(session, 'spotify', trackId, liked);
      return;
    }
    // deezer：匿名，无远端红心 → 无需同步。
  }

  /** 把「每平台一首」的红心同步目标推入队列（MQ 思路：合并去重 + 异步重试）。
   *  discover（仅 liked=true）带上后，队列会先去其余已登录平台跨平台匹配补齐。
   *  targets 与 discover 都空才忽略；不能写红心的平台（deezer/未登录）由入队方
   *  提前过滤。 */
  private enqueueLikeSync(
    session: Session,
    mergedId: string,
    liked: boolean,
    targets: Array<{ platform: MusicProvider; trackId: string }>,
    discover?: LikeSyncTask['discover'],
  ): void {
    if (!targets.length && !discover) return;
    // 全覆盖短路：detect 触发的 discover-only 入队（renderer 在 ❤ 播放后 2.5s
    // 主动 refreshLikedState → 再次调 detect），并且所有 likeable 平台都已经在
    // fanOut 里 → 完全跳过队列。否则后台会再跑一遍 resolveEquivalents，打
    // "no candidates (..., already in fanOut)" debug、跑 6 次指数退避重试、最终
    // 还是 0 输出。
    //
    // 注意边界：这条短路只在 (liked && discover && !targets.length) 三个条件全
    // 满足时生效——即"redetect 一个已全覆盖的歌"。toggleLike ❤ 按钮点击 +
    // fanOutLike 首次心 的 path 都不受影响（它们带 targets / 状态不一样）。
    if (liked && discover && !targets.length) {
      const state = this.loadState(session);
      const canonicalId = this.canonicalMergedId(state, mergedId, targets);
      const fanned = new Set(
        (state.fanOut[canonicalId] ?? []).map((e) => e.platform),
      );
      const allLikeableCovered = (['qq', 'netease', 'spotify'] as MusicProvider[])
        .every((p) => !this.canSyncLike(session, p) || fanned.has(p));
      if (allLikeableCovered) {
        this.logger.debug?.(
          `like-sync skip enqueue ${mergedId} — fanOut 已全覆盖 likeable 平台`,
        );
        return;
      }
    }
    this.likeSync.enqueue({ session, mergedId, liked, targets, discover });
  }

  /** 组装跨平台匹配元数据：have = 已有 source 的平台（匹配时跳过，不重复搜索）。
   *  meta 缺省（老客户端不带）→ 返回 undefined，退化成「只写已有 source」的老行为。 */
  private buildDiscover(
    meta: LikeMeta | undefined,
    have: MusicProvider[],
  ): LikeSyncTask['discover'] {
    if (!meta || (!meta.title && !meta.artist)) return undefined;
    return {
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration,
      have: [...new Set(have)],
    };
  }

  /**
   * 跨平台匹配 resolver（LikeSyncQueue 后台调）：给定一个带 discover 元数据的
   * like 任务，去「已登录、likeable、且还没有这首歌 source」的平台搜同名同时长
   * 的等价曲目，找到就本地乐观点亮 + 合并进 fanOut，并返回新目标供队列同步远端。
   * 严格：normalizeKey（歌名+歌手）一致 + duration ±3s。找不到返回空数组。
   */
  private async resolveEquivalents(
    task: LikeSyncTask,
  ): Promise<Array<{ platform: MusicProvider; trackId: string }>> {
    const meta = task.discover;
    if (!meta) return [];
    // 已覆盖 = 已有 source 的平台 ∪ 本任务已排定的 target 平台
    // ∪ **fanOut 里已经记过的平台**（上次 discover 已经匹配过了，别再重复搜）。
    // 这份 state 只用来算 dedup（读旧的可接受）；真正写入前会在 await 之后
    // **重新 loadState**，避免搜索那几秒内别处的写被这份旧 state 覆盖（lost update）。
    const preState = this.loadState(task.session);
    const alreadyFanned = new Set(
      (
        preState.fanOut[
          this.canonicalMergedId(preState, task.mergedId, task.targets)
        ] ?? []
      ).map((e) => e.platform),
    );
    const covered = new Set<MusicProvider>([
      ...meta.have,
      ...task.targets.map((t) => t.platform),
      ...alreadyFanned,
    ]);
    const candidates = (['qq', 'netease', 'spotify'] as MusicProvider[]).filter(
      (p) => !covered.has(p) && this.canSyncLike(task.session, p),
    );
    if (!candidates.length) {
      const skipped = [...covered].filter((p) => alreadyFanned.has(p));
      this.logger.debug?.(
        `resolveEquivalents "${meta.title}": no candidates` +
          (skipped.length ? ` (${skipped.join(', ')} already in fanOut)` : ''),
      );
      return [];
    }

    this.logger.debug?.(
      `resolveEquivalents "${meta.title} - ${meta.artist}"` +
        ` dur=${meta.duration} → trying [${candidates.join(', ')}]`,
    );

    // 保留完整 Track（不只是 id）——补库快照时要用它拼可播放的 source url。
    const found = await Promise.all(
      candidates.map(async (p) => {
        const t = await this.searchEquivalent(task.session, p, meta);
        return t ? { platform: p, track: t } : null;
      }),
    );
    const matches = found.filter(
      (m): m is { platform: MusicProvider; track: Track } => Boolean(m),
    );
    if (!matches.length) {
      this.logger.log(
        `resolveEquivalents "${meta.title}": no match on any of [${candidates.join(', ')}]`,
      );
      return [];
    }

    const targets = matches.map((m) => ({
      platform: m.platform,
      trackId: m.track.id,
    }));

    // 落地：**重新** loadState（await 期间别处可能已写入，用旧 preState 保存会
    // 丢它们的更新）。本地 liked 乐观点亮 + 合并进 fanOut（漂移归一 + 每平台去重）。
    const state = this.loadState(task.session);
    const fullCanonicalId = this.canonicalMergedId(state, task.mergedId, [
      ...task.targets,
      ...targets,
    ]);
    for (const m of targets) this.setLike(state, m.platform, m.trackId, true);
    state.fanOut[fullCanonicalId] = this.mergeFanOutEntries(
      state.fanOut[fullCanonicalId] ?? [],
      targets,
    );
    this.saveState(task.session, state);

    // bug3：把新匹配到的平台源增量补进「我的喜欢」库快照，让弹窗刷新/重开即可
    // 看到新平台徽章（fan-out 只改 live liked 状态，不会动这个快照）。
    this.patchLibraryWithSources(
      task.session,
      meta,
      matches.map((m) => this.toSourceInfo(m.track)),
    );

    this.logger.log(
      `cross-platform match "${meta.title} - ${meta.artist}" → ` +
        targets.map((m) => `${m.platform}/${m.trackId}`).join(', '),
    );
    return targets;
  }

  /** 把一个平台的 Track 转成库/搜索用的 SourceInfo（带可播放的后端代理 url）。 */
  private toSourceInfo(track: Track): SourceInfo {
    return {
      platform: track.provider,
      trackId: track.id,
      hasCopyright: true,
      url: this.toPlayableTrack(track).audioUrl,
      mediaMid: track.mediaMid,
    };
  }

  /**
   * bug3：跨平台匹配补齐红心后，把新平台的 source 增量写进「我的喜欢」库快照
   * （library.json）。fan-out 本身只改 live 的 `providers[p].liked`，不动这个
   * 快照，所以要显式补，否则弹窗重开也看不到新平台徽章。
   *
   * 定位库条目：normalizeKey(歌名+歌手) 一致 + duration ±容差（复用等价匹配的
   * 严格口径，不依赖 mergedId——mergedId 会漂移）。每平台最多一个 source、不
   * 覆盖已有。这首歌不在库里（例如从搜索直接点❤的新歌）→ no-op。
   */
  private patchLibraryWithSources(
    session: Session,
    meta: LikeMeta,
    newSources: SourceInfo[],
  ): void {
    if (!newSources.length) return;
    const stored = this.storage.get<{
      importedAt: number;
      items: UnifiedSearchItem[];
      sources: Array<{ provider: MusicProvider; count: number; error?: string }>;
    }>(this.libraryKey(session.id));
    if (!stored) return;
    const wantKey = this.normalizeKey(meta.title, meta.artist);
    const wantTitleKey = this.normalizeKey(meta.title, '');
    const wantArtistKey = this.normalizeKey(meta.artist, '');

    // 先精确 normalizeKey，再宽松（歌名+歌手双向包含——兼容"手嶌葵" vs "手嶌葵(てしまあおい)"）。
    const item =
      stored.items.find((it) => {
        if (this.normalizeKey(it.title, it.artist) !== wantKey) return false;
        return !this.durationMismatch(meta.duration, it.duration);
      }) ??
      stored.items.find((it) => {
        const tt = this.normalizeKey(it.title, '');
        const ta = this.normalizeKey(it.artist, '');
        if (
          !tt ||
          !wantTitleKey ||
          (!tt.includes(wantTitleKey) && !wantTitleKey.includes(tt))
        )
          return false;
        // 艺人跨脚本这里也走**音译佐证**（与 artistLooseMatch 同口径），不再
        // 裸 isCrossScript——否则会把补进来的 source 挂到同名不同艺人的库条目上。
        // 2026-08-03: 音译佐证传**原始串**（保留假名读音括号）——「德永英明
        // (とくなが ひであき)」的读音是音译真相，normalizeKey 会把它剥掉。
        if (
          ta &&
          wantArtistKey &&
          !ta.includes(wantArtistKey) &&
          !wantArtistKey.includes(ta) &&
          !artistTransliterationMatch(it.artist, meta.artist)
        )
          return false;
        return !this.durationMismatch(meta.duration, it.duration);
      });
    if (!item) {
      this.logger.debug?.(
        `patchLibrary: no item for "${meta.title} - ${meta.artist}"` +
          ` (wantKey="${wantKey}" dur=${meta.duration})`,
      );
      return;
    }
    const have = new Set(item.sources.map((s) => s.platform));
    let changed = false;
    for (const src of newSources) {
      if (have.has(src.platform)) continue; // 每平台一个，不覆盖已有
      item.sources.push(src);
      have.add(src.platform);
      changed = true;
    }
    if (!changed) return;
    // 原本没有可播放 bestSource（罕见）→ 用新补的有版权源兜底。
    if (!item.bestSource) {
      const copyrighted = newSources.find((s) => s.hasCopyright);
      if (copyrighted) item.bestSource = copyrighted.platform;
    }
    this.storage.set(this.libraryKey(session.id), stored);
    this.logger.log(
      `library patched: "${item.title} - ${item.artist}" += ` +
        newSources.map((s) => s.platform).join(', '),
    );
  }

  /**
   * 后台「自愈」library item：对只有 1 个 source 的 item，用 library 自身的
   * title+artist+duration 当种子，去「尚未 source 的平台」跑 searchEquivalent
   * （复用 fan-out discover 那套 4-tier 匹配：normalizeKey 严格 / 双向 includes
   * / 跨脚本 / JW fuzzy），命中就 patchLibraryWithSources 补 source。
   *
   * 触发场景：library item.id 是用 netease 作 main 拼出来的（merged-netease-XXX），
   * 但用户其实在 QQ/Spotify 上也已 ❤——只是 importLiked 时 QQ/Spotify 没有返
   * 回这条（搜索超时 / API 没收录该 cover / 用户当时没在那俩平台登录）。
   * 之后用户播放这首歌，detectLikedAndSync 把 QQ/Spotify 写进 fanOut（key 是
   * merged-qq-YYY），但因为 skip-enqueue 短路，resolveEquivalents + patchLibrary
   * 链没机会跑。结果：library item 永远只有 netease 一条 source，likedPlatforms
   * 也只有 [netease]，badge 漏。
   *
   * 这个自愈任务等价于「手动对单首 library item 跑一遍 detect+resolveEquivalents」
   * ——只是入口换成 library item 的 title/artist/duration，而不是搜索结果。
   * 异步后台跑（fire-and-forget），不阻塞 getLibrary。
   *
   * 去重：session 级 Set 记录正在自愈的 item.id，同一会话内不会并发触发同一首。
   * 跨会话去重靠 storage 的 sources 数变化（修好后 likedPlatforms 满 3，下次
   * getLibrary 看到 < 3 不再触发）。
   */
  private readonly healingInFlight = new Set<string>();

  healLibraryItem(session: Session, item: UnifiedSearchItem): void {
    if (!item.title || !item.artist) return;
    if (this.healingInFlight.has(item.id)) return;
    this.healingInFlight.add(item.id);
    void this.runHealLibraryItem(session, item).finally(() => {
      this.healingInFlight.delete(item.id);
    });
  }

  private async runHealLibraryItem(
    session: Session,
    item: UnifiedSearchItem,
  ): Promise<void> {
    const have = new Set(item.sources.map((s) => s.platform));
    // Deezer 匿名无收藏，skip；其余 likeable 平台逐一搜。
    const candidates: MusicProvider[] = (
      ['qq', 'netease', 'spotify'] as MusicProvider[]
    ).filter((p) => !have.has(p) && this.canSyncLike(session, p));
    if (!candidates.length) return;
    const meta: LikeMeta = {
      title: item.title,
      artist: item.artist,
      duration: item.duration,
    };
    const matches: Track[] = [];
    for (const platform of candidates) {
      try {
        const t = await this.searchEquivalent(session, platform, meta);
        if (t) matches.push(t);
      } catch {
        /* 单平台失败不阻塞其他 */
      }
    }
    if (!matches.length) {
      this.logger.debug?.(
        `healLibrary: no matches for "${item.title} - ${item.artist}"`,
      );
      return;
    }
    // 走 patchLibraryWithSources（已存在的增量合并路径，会按 normalizeKey 找
    // 这条 library item 并把 QQ/Spotify source 补进去；同时把 likedPlatforms
    // 落进 storage）。同步再写一遍 fanOut，让 getLibrary 的反向索引也能命中。
    this.patchLibraryWithSources(
      session,
      meta,
      matches.map((m) => this.toSourceInfo(m)),
    );
    // fanOut: 用 library item.id 作 key（resolveEquivalents 用 canonicalId，
    // 这里直接用 item.id 更稳——item.id 在 storage 里是稳定的）。
    const state = this.loadState(session);
    const fresh: FanOutEntry[] = matches.map((m) => ({
      platform: m.provider,
      trackId: m.id,
    }));
    state.fanOut[item.id] = this.mergeFanOutEntries(
      state.fanOut[item.id] ?? [],
      fresh,
    );
    this.saveState(session, state);
    this.logger.log(
      `healLibrary: "${item.title} - ${item.artist}" += ` +
        matches.map((m) => `${m.provider}/${m.id}`).join(', '),
    );
  }

  /**
   * 去单个平台搜「同一首歌」的等价曲目（严格匹配）。normalizeKey 一致 +
   * （两边时长都已知时）duration ±VERSION_DURATION_TOLERANCE_SEC。未登录 /
   * 搜不到 / 异常 → null（best-effort，绝不 throw 打断队列）。
   */
  private async searchEquivalent(
    session: Session,
    platform: MusicProvider,
    meta: LikeMeta,
  ): Promise<Track | null> {
    const kw = `${meta.title} ${meta.artist}`.trim();
    if (!kw) return null;
    // 结果缓存：同一 session 对同一 (platform, kw, 时长分桶) 的等价曲搜索返回
    // 同样结果——like sync 的 resolveEquivalents 与 renderer 的
    // tryUpgradeFromTrial 都会调 searchEquivalent，二者经常并发（VIP 试听
    // 检测触发降级的同时用户也在点 ❤ 触发 discover），不去重会把平台后端
    // 当成并行批量搜索来打。两层 log 也跟着刷。
    // TTL 分级：命中 / **干净缺席**（搜索成功但歌确实不在该平台）缓存 1h——
    // 缺席是稳定事实，每次 detect 重搜只浪费串行队列；失败 / 超时缓存 30s，
    // 给网络恢复留窗口（失败 ≠ 缺席，不能按缺席长缓存）。
    // key 带时长分桶（±3s 匹配容差的取整）：同歌不同版本（studio/live 差
    // 秒级）不会互相吞掉搜索结果。key 用 sessionId 隔离多用户；null 结果也
    // 缓存（避免被打挂的 platform 反复探）。每 session 上限 256 条，超出按
    // 时间淘汰最早的。
    const durationBucket = Math.round(meta.duration / 3);
    const cacheKey = `${session.id}|${platform}|${kw}|${durationBucket}`;
    const cached = this.equivSearchCache.get(cacheKey);
    if (cached) {
      const ttl = cached.clean
        ? EQUIV_MATCH_CACHE_TTL_MS
        : EQUIV_FAIL_CACHE_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.track;
    }

    const result = await this.searchEquivalentUncached(session, platform, meta, kw);
    this.equivSearchCache.set(cacheKey, {
      at: Date.now(),
      track: result.track,
      clean: result.clean,
    });
    this.pruneEquivSearchCache();
    return result.track;
  }

  /**
   * 真搜（无缓存）。返回 { track, clean }：
   *  - clean=true：搜索**成功**（命中 / 全部变体跑完确认缺席）——结果稳定，
   *    可长 TTL 缓存（命中 1h / 缺席 1h）。
   *  - clean=false：抛异常（网络失败 / 平台报错）——**不代表缺席**，只短
   *    TTL 缓存（30s），给网络恢复留重搜窗口。
   */
  private async searchEquivalentUncached(
    session: Session,
    platform: MusicProvider,
    meta: LikeMeta,
    kw: string,
  ): Promise<{ track: Track | null; clean: boolean }> {
    try {
      // 准备 N 组搜索变体 + 各自的 limit。对每个变体跑「搜索 → 4 tier 匹配」，
      // 任意一组命中即返回。修两类回归：
      //  1) 原 kw 0 候选（Spotify 对"盛夏的灰姑娘"这类中译括号命中率为 0）→
      //     剥括号重搜。
      //  2) 原 kw 非 0 但候选全是无关歌（Spotify 把"サマータイムシンデレラ (盛夏的灰姑娘)
      //     緑黄色社会"匹配成 おつかれSUMMER / summertime / Remember Summer Days）
      //     → 4 tier 匹配失败，再用 title-only/author-only 收紧搜。
      // 匹配阶段仍按 normalizeKey 严格判等 + 时长门限，只把搜索词放宽。
      const cleanedTitle = stripParensContent(meta.title);
      const cleanedArtist = stripParensContent(meta.artist);
      const cleanedKw = `${cleanedTitle} ${cleanedArtist}`.trim();
      const variants: Array<{ kw: string; limit: number; tag: string }> = [];
      variants.push({ kw, limit: 5, tag: 'original' });
      if (cleanedKw && cleanedKw !== kw) {
        // 2026-08-07 recall 调优：「虹 手嶌葵」这类**通用标题 + 汉字艺名**的
        // 场景，Spotify 按 romanized 名（Aoi Teshima）索引、按热度排序，会把
        // 该艺人的热门曲（恋するしっぽ / 元気を出して）+ 现场版排在前面，
        // studio 版被挤到 top-5 之外——但它确实在结果里。这是**艺人限定**
        // 的搜索（噪声低），放宽到 15 让 rank 6-15 的正确 studio 版也进匹配。
        // 匹配阶段仍走 4-tier 严格判等（title + 艺人桥 + 时长），多扫候选不放宽。
        variants.push({ kw: cleanedKw, limit: 15, tag: 'strip-parens' });
      }
      if (cleanedTitle && cleanedTitle !== kw && cleanedTitle !== cleanedKw) {
        // title-only 兜底：Spotify 等严格 API 对「<title> <artist>」格式
        // 把含中译假名/括号的 artist 解析偏，最后再 title-only 强调一遍。
        // limit 比 strip-parens 略高（无艺人约束、命中位次更深），但通用标题
        // （「虹」）扫太多意义有限——艺人桥 + 时长门仍是防误配的硬门。
        variants.push({ kw: cleanedTitle, limit: 15, tag: 'title-only' });
      }
      // 2026-08-07: 标题罗马音变体——Spotify 按罗马音索引日文歌名（「恋」→
      // Koi），搜汉字/假名召回不到（星野源 恋 场景）。用 kuromoji 读日文读音
      // 生成变体：先 title+artist，再 title-only。匹配阶段仍走 4-tier 严格判等
      // （title 跨脚本 isCrossScript + 艺人桥 + ±3s），只放宽搜索词不放宽判定。
      // 注意：只对「原文 ≠ 罗马音」的日文歌名生效——英文/罗马音歌名不变体
      // （kuromoji 读英文会原样返回，与归一后相等 → 跳过）；中文歌名会读成
      // 日文音（晴天→seiten）白搜一次，tier 判等兜住不会误配。
      //
      // ⚠️ 必须先等 kuromoji 预热完成：romanizeJa 在词典未就绪时返回空串
      // （只静默触发后台预热）——app 启动后立即检测时会把变体吞掉、退回
      // 老路径。warmupJa 幂等，首次多等 ~1s 词典加载，可接受。
      await warmupJa();
      const romajiTitle = romanizeJa(cleanedTitle);
      const romajiArtist = romanizeJa(cleanedArtist);
      if (
        romajiTitle &&
        romajiTitle !== this.normalizeKey(cleanedTitle, '')
      ) {
        // title-romaji + 原文 artist：Spotify 艺人名若是日文原文（星野源）
        // 能直接召回；若是英文（Gen Hoshino）则走下方 title-romaji-only 的
        // 宽召回 + tier 艺人桥。
        variants.push({
          kw: `${romajiTitle} ${cleanedArtist}`,
          limit: 5,
          tag: 'title-romaji',
        });
        // title-romaji + artist-romaji：覆盖 Spotify 艺人名也是罗马音的
        // 情况（Gen Hoshino → genhoshino），组合 kw 召回更准。
        if (romajiArtist && romajiArtist !== this.normalizeKey(cleanedArtist, '')) {
          variants.push({
            kw: `${romajiTitle} ${romajiArtist}`,
            limit: 5,
            tag: 'title-romaji-artist-romaji',
          });
        }
        variants.push({ kw: romajiTitle, limit: 10, tag: 'title-romaji-only' });
      }

      const tried: string[] = [];
      let timedOut = false; // 任一变体超时 → 无法断定"该平台没有这首歌" → clean=false
      for (const v of variants) {
        const tracks = await this.runPlatformSearch(session, platform, v.kw, v.limit);
        if (tracks === null) {
          // 5s 超时：视为该变体缺席（不阻塞后续变体），但结果不能算"干净缺席"。
          timedOut = true;
          tried.push(`${v.tag}=${v.kw}→timeout`);
          continue;
        }
        // 把 top 3 候选挂在 tried 上：no-match 时一眼能看出"Spotify 实际返回了什么",
        // 区分"歌曲不在该平台"vs"匹配规则漏过"。诊断比"kw→count"信息密度高得多。
        const samples = tracks.slice(0, 3).map(
          (t) => `"${t.title} - ${t.artist}" dur=${t.duration}`,
        );
        tried.push(
          `${v.tag}=${v.kw}→${tracks.length}` +
            (samples.length ? ` [${samples.join(', ')}]` : ''),
        );
        if (tracks.length === 0) continue;
        const matched = this.matchEquivalentTrack(platform, meta, tracks, v.tag);
        if (matched) return { track: matched, clean: true };
      }
      // 全部变体都跑过且没命中 → 记日志，明确告诉调用方"试过哪些变体 + 各自
      // 候选"。diagnostics: 这种 no-match 是很常见的（该平台没有这首歌），但
      // 排查时需要候选列表才能判断"是搜不到还是匹配不到"。
      this.logger.debug?.(
        `searchEquivalent ${platform} no match for "${meta.title} - ${meta.artist}"` +
          ` (kw="${kw}" dur=${meta.duration}, tried: [${tried.join(', ')}])`,
      );
      // title-romaji 变体存在却仍 no-match → 升 LOG 级：日文歌名 + 跨脚本
      // 失败罕见且难排查，把每个变体的召回数暴露在默认日志里，一眼区分
      // 「罗马音召回 0」vs「召回但匹配拒（时长/艺人）」。
      if (
        variants.some((v) => v.tag.startsWith('title-romaji')) &&
        tried.some((t) => t.startsWith('title-romaji'))
      ) {
        this.logger.log(
          `searchEquivalent ${platform} romaji-miss: "${meta.title}" ` +
            `tried=[${tried.filter((t) => t.startsWith('title-romaji')).join(' | ')}]`,
        );
      }
      // clean = 所有变体都**正常完成**且无命中（歌确实不在该平台，长 TTL 缓存）；
      // 任一变体超时/失败（timedOut）→ 不确定缺席，只短 TTL 缓存。
      return { track: null, clean: !timedOut };
    } catch (err) {
      this.logger.warn(
        `searchEquivalent ${platform} "${kw}" failed: ${(err as Error).message}`,
      );
      // 失败 ≠ 缺席：网络抖动 / 平台抽风时这首可能其实存在。clean=false →
      // 只短 TTL 缓存，别把「搜索失败」当「没有这首歌」记 1 小时。
      return { track: null, clean: false };
    }
  }

  /** 单平台单 kw 的搜索分发（剥掉各 provider 的 null session 守卫）。
   *  ⚠️ 必须套 withTimeout（单平台 5s，见 AGENTS.md 硬约束）：等价曲搜索是
   *  同步队列 discover 的一环，队列**串行**消费——一个平台的 fetch 悬挂会把
   *  整条队列堵死（用户实测：Spotify 搜索 fetch failed 悬挂 30s，netease 的
   *  落账和所有后续 detect 全被拖过 waitForSettled 的 6s 窗口，❤ 角标停 1）。
   *  @returns Track[] 正常结果（可能为空）；**null = 超时**——超时是"搜索失败"
   *  不是"歌确实不在该平台"，调用方必须据此把结果标成 clean=false（只短 TTL
   *  缓存），绝不能把超时当成缺席记 1 小时。 */
  private async runPlatformSearch(
    session: Session,
    platform: MusicProvider,
    kw: string,
    limit: number,
  ): Promise<Track[] | null> {
    const search = (): Promise<Track[]> => {
      if (platform === 'qq') {
        return this.qq.search(session.providers.qq ?? {}, kw, limit);
      }
      if (platform === 'netease') {
        const ps = session.providers.netease;
        if (!ps?.musicU) return Promise.resolve([]);
        return this.netease.search(ps, kw, limit);
      }
      if (platform === 'spotify') {
        const ps = session.providers.spotify;
        if (!ps?.spotify) return Promise.resolve([]);
        return this.spotify.search(ps, kw, limit);
      }
      return Promise.resolve([]); // deezer 匿名无收藏，不参与
    };
    return withTimeout(
      search,
      UNIFIED_SEARCH_TIMEOUT_MS,
      () =>
        this.logger.warn(
          `equivalent search "${kw}" on ${platform} timed out (>${UNIFIED_SEARCH_TIMEOUT_MS}ms)`,
        ),
    ); // 超时 → null（不阻塞其他平台 / 后续变体）
  }

  /** 4 tier 匹配：strict → loose → title-exact → cross-script。
   *  任一命中即返回 + 写日志。tag 用于日志标注命中来自哪个搜索变体。 */
  private matchEquivalentTrack(
    platform: MusicProvider,
    meta: LikeMeta,
    tracks: Track[],
    tag: string,
  ): Track | null {
    const wantKey = this.normalizeKey(meta.title, meta.artist);
    const wantTitleKey = this.normalizeKey(meta.title, '');
    const wantArtistKey = this.normalizeKey(meta.artist, '');
    const wantVersion = extractVersionTag(meta.title);

    // 候选池前置过滤：任何候选是「翻唱/COVER」（标题含 (Cover by X) / (翻唱)
    // / (COVER) / (原唱：X) / (翻自) / (翻)）一律踢出，不进入后续 6 tier。
    // 这是 #17 防线之外的最后一道兜底——历史上 KiraCola 这类翻唱曾借 Tier 5b
    // 的「title 含原唱名」误命中，污染红心跨平台同步。Step 1 的 stripVersionTags
    // 已把翻唱归到 key 含「COVER」字样，但**额外**走 extractVersionTag 直接判
    // 类别更明确，避免任何「key 巧合」（如某原创曲名撞「COVER」字面）漏过去。
    //
    // 重要边界：**不**只过滤 cand 是 COVER —— 若 seed 自己是 COVER（用户 ❤ 的
    // 本就是翻唱版），cand 必须也是 COVER 才算同翻唱底版 → 双向守卫：
    //   - 任一侧是 COVER 且另一侧不是 → 拒
    //   - 两侧都是 COVER → 仍走后续 tier（同翻唱底版的另外翻唱匹配，照常）
    const filtered = tracks.filter((t) => {
      const cv = extractVersionTag(t.title);
      if (wantVersion === 'COVER' && cv !== 'COVER') return false;
      if (cv === 'COVER' && wantVersion !== 'COVER') return false;
      return true;
    });

    // 2026-08-07「选错版本」修复：各 tier 是「命中即返回第一个」，同一 tier
    // 内不挑最优——Spotify 对「告别的时代」这类曲返回多个版本（同专辑母带版
    // + 精选集 / 现场 / 重录版），谁排搜索结果前面就 star 谁 → 选错版本。
    // seed（QQ/网易云）与「同专辑同母带版」时长几乎完全一致（共享 master），
    // 精选/现场/重录版时长会差。这里把候选**按与 seed 时长的接近度稳定排序**，
    // 让每个 tier 的「第一个命中」自动是时长最接近的同母带版本。
    // 只在 seed 时长已知时排序；时长未知（=0）的候选排最后（proximity=∞）。
    // 稳定排序：接近度相同的保留原搜索序（热度）作 tiebreak。
    if (meta.duration > 0) {
      const proximity = (d: number): number =>
        d > 0 ? Math.abs(d - meta.duration) : Number.POSITIVE_INFINITY;
      filtered.sort((a, b) => proximity(a.duration) - proximity(b.duration));
    }

    // 第一遍：精确 normalizeKey 匹配。
    for (const t of filtered) {
      const tk = this.normalizeKey(t.title, t.artist);
      if (tk !== wantKey) continue;
      if (this.durationMismatch(meta.duration, t.duration)) continue;
      this.logger.debug?.(
        `searchEquivalent ${platform} exact match [${tag}]: "${t.title} - ${t.artist}"`,
      );
      return t;
    }

    // 第二遍：宽松匹配（歌名+歌手双向包含）。修复"QQ 歌手名带日文读法括号
    // → normalizeKey('手嶌葵(てしまあおい)') ≠ 网易云 normalizeKey('手嶌葵')"。
    // 再加上跨文字系统兜底：歌名对上 + 时长接近 + 双方艺人名一个 CJK 一个
    // 拉丁字母（如 Spotify 用 "Fujii Kaze" 而 QQ 用 "藤井风"），放宽艺人名约束。
    //
    // ⚠️ 2026-07-30 hardening: 旧代码的 `!ta || !wantArtistKey` 会在任意一
    //    方艺人名为空时**直接放行**（不做艺人校验）。这会让 NetEase/Spotify
    //    返回的封面/伴奏（ar 字段缺失或不匹配）在 title+duration 对得上的
    //    情况下被自动 ❤，导致"周杰伦的歌被 star 到一个翻唱版本"这类数据
    //    污染。现在改为：任意一方艺人缺失 → 拒绝（不做匹配），杜绝此路径。
    for (const t of filtered) {
      const tt = this.normalizeKey(t.title, '');
      const ta = this.normalizeKey(t.artist, '');
      const titleOk =
        tt && wantTitleKey && (tt.includes(wantTitleKey) || wantTitleKey.includes(tt));
      if (!titleOk) continue;
      // 长度门：单/双字标题双向 includes 必撞（任何 ≥2 字标题都含 `诱` / `虹` /
      // `Love`）。只放过双方任一已 ≥3 字符的情形，否则仍走 Tier 1/3 严格。
      if (
        Math.min(tt.length, wantTitleKey.length) < 3 &&
        Math.max(tt.length, wantTitleKey.length) > 3
      ) continue;
      if (!ta || !wantArtistKey) continue; // reject empty-artist bypass
      // 跨脚本艺人走**音译佐证**（artistLooseMatch），不再裸 isCrossScript——
      // 否则 title 只要双向 includes（QQ 常带译名后缀），CJK 艺人就会 cross-script
      // 命中任意拉丁艺人（铃木爱理 ≈ Lefty Hand Cream / wacci）。纯汉字日文/
      // 罗马化艺名（藤井风↔Fujii Kaze、王力宏↔Leohom Wang）音译对不上的，由
      // 下方 Tier 3b「标题完全相等 + 时长 ±3s 严格」强佐证通道兜底。
      if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
      if (this.durationMismatch(meta.duration, t.duration)) continue;
      this.logger.log(
        `searchEquivalent ${platform} loose match [${tag}]: ` +
          `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
          ` (exact key mismatch: want="${wantKey}" got="${this.normalizeKey(t.title, t.artist)}")`,
      );
      return t;
    }

    // 第三遍：歌名**完全相同**（normalizeKey 后逐字相等）+ 艺人宽松命中（双
    // 向 includes / 跨脚本）+ duration 跨版本容差（±30s）→ 接受。
    //
    // 历史：本层最初是「title-exact + artist ignored」，用来处理
    //   「浜崎あゆみ」vs「Ayumi Hamasaki」这种跨脚本同字；后来发现「artist
    //   ignored」会误把「花田错 — 王力宏」跟「花田错 — 王馨卓」撞上（标题撞
    //   名的不同歌手），于是收回到「艺人也要宽松命中」。跨脚本 / 前后缀的
    //   同人异名仍通过 includes / isCrossScript 命中。
    // duration 容差放宽到 30s：title-exact + artist 通过已是强信号，常见的
    //   跨版本（single vs album / 带 intro-outro vs 短版）会差 15-30s，3s
    //   严苛的话同歌搜不到。仍排除 title 仅 includes 的（防 "Love" 撞
    //   "Love Story" 这种巧合）。
    for (const t of filtered) {
      const tt = this.normalizeKey(t.title, '');
      if (!tt || tt !== wantTitleKey) continue;
      if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
      // 跨版本守卫：长时长门（30s）只在 seed 与 cand 同版本标签时启用。
      // 任一边是 LIVE / ACOUSTIC / REMIX / INST / KARAOKE / DEMO / EDIT
      // → 改用 ±3s 严格，不让 30s 把 live 拉进 studio ❤ 的 fan-out 圈。
      const candVersion = extractVersionTag(t.title);
      if (
        this.durationMismatchVersionSafe(
          wantVersion,
          candVersion,
          meta.duration,
          t.duration,
        )
      ) continue;
      this.logger.log(
        `searchEquivalent ${platform} title-exact match [${tag}]: ` +
          `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
          ` (dur=${meta.duration}≈${t.duration}, version=${candVersion ?? 'studio'})`,
      );
      return t;
    }

    // 第三遍-b：纯汉字日文名的「强佐证」跨脚本通道。
    //
    // 「藤井风」(QQ/网易云汉字) ↔ 「Fujii Kaze」(Spotify 罗马字) 是真·同一艺人，
    // 但拼音("tengjingfeng") 给的是**中文**读音、对不上日文读音("fujiikaze")，
    // 所以 artistLooseMatch 的音译佐证会拒它（第三遍走不通）。这里给这类名字
    // 留一条窄通道：**标题 normalizeKey 完全相等** + 艺人**跨脚本**（裸
    // isCrossScript）+ **时长 ±3s 严格**（双方都已知）。三重强佐证同时满足才认。
    //
    // 为什么安全（不会再放翻唱链进来）：同名不同艺人的翻唱（wacci / 铃木爱理 /
    // Lefty Hand Cream 版）时长普遍差 >3s（本例 305/298/310），严格时长门直接
    // 拒；即便偶有巧合同长，也已比旧代码（宽松 30s + 剥括号 substring）窄得多。
    // 代价：跨脚本 + 大版本时长差（album vs single 差 15-30s）会退化成两条——
    // 安全侧取舍。
    for (const t of filtered) {
      const tt = this.normalizeKey(t.title, '');
      if (!tt || tt !== wantTitleKey) continue;
      const ta = this.normalizeKey(t.artist, '');
      // 已被上一遍的 artistLooseMatch 命中的（includes/音译）不会走到这里；
      // 这里专收「跨脚本但音译对不上」的纯汉字日文名，且必须严格时长。
      if (!this.isCrossScript(ta, wantArtistKey)) continue;
      if (meta.duration <= 0 || t.duration <= 0) continue; // 强佐证要求双方时长已知
      if (this.durationMismatch(meta.duration, t.duration)) continue; // ±3s 严格
      this.logger.log(
        `searchEquivalent ${platform} cross-script strong match [${tag}]: ` +
          `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
          ` (title-exact + xscript-artist + dur=${meta.duration}≈${t.duration} ±3s)`,
      );
      return t;
    }

    // 第四遍：跨文字系统**标题** + 艺人宽松命中 + 时长接近 → 接受。
    // "調子のっちゃって"（日文）≠ "Cho Si Noccha Te"（罗马字），normalizeKey 后
    // 一个是 CJK、一个是 Latin，标题看不出等同；两者 duration 相同说明是同一首。
    // 此类在日音库常见（Spotify 罗马字标题，QQ/网易云汉字/假名）。
    //
    // ⚠️ 2026-07-31 hardening: 旧代码这里比的是 **full key**（title+artist 拼一起）
    //    的 isCrossScript，**完全不校验艺人**——只要 seed 全 CJK、候选含拉丁
    //    （或反之）+ 时长对上就接受。这会把「同名不同艺人」的翻唱误并。改为：
    //    (1) 只在**标题**层判跨脚本，(2) 艺人仍要 artistLooseMatch（includes/
    //    音译）命中，(3) 时长 ±3s 严格。防「花田错 王力宏 vs 王馨卓」跨脚本变体。
    for (const t of filtered) {
      const candTitleKey = this.normalizeKey(t.title, '');
      if (!candTitleKey || !wantTitleKey) continue;
      if (!this.isCrossScript(candTitleKey, wantTitleKey)) continue;
      const ta = this.normalizeKey(t.artist, '');
      if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
      if (this.durationMismatch(meta.duration, t.duration)) continue;
      this.logger.log(
        `searchEquivalent ${platform} cross-script title match [${tag}]: ` +
          `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
          ` (xscript-title candTitle="${candTitleKey}" wantTitle="${wantTitleKey}", dur=${meta.duration}≈${t.duration})`,
      );
      return t;
    }

    // 第五遍：relaxed title match — 先把两侧标题的"括号内容"剥掉再做 substring。
    // 修「胸の煙 (焚心如火) vs 胸の煙 (胸の煙 胸の煙 - Single / 胸の煙 (Official MV)」
    // 类回归：seed 和候选标题共享同一个"原版标题"，但都有 extra 内容（版本标签、
    // 译名括号、MV 标签）。Tier 1-4 在「双向 normalizeKey includes」上都失败
    // （双方各自有独有的尾缀），但剥掉括号内容后应当完全相等或互为子串。
    // 长度差门限 50% 是防止「胸」撞「胸の煙」这种短名误并。
    // 仍要求艺人宽松命中（双向 includes / 跨脚本）— 防止「花田错 王力宏」vs
    // 「花田错 王馨卓」这种"同名曲不同歌手"在标题容错后撞上。duration 同样
    //  用跨版本容差 30s：典型 case 是「何なんw 藤井风」QQ 源 vs Spotify 源
    //  album vs single 版差 15-30s。
    const wantTitleClean = stripParensContent(meta.title);
    const wantTitleNormClean = this.normalizeKey(wantTitleClean, '');
    if (wantTitleNormClean) {
      for (const t of filtered) {
        const candTitleClean = stripParensContent(t.title);
        const candTitleNormClean = this.normalizeKey(candTitleClean, '');
        if (!candTitleNormClean) continue;
        const lenDiff =
          Math.abs(candTitleNormClean.length - wantTitleNormClean.length) /
          Math.max(candTitleNormClean.length, wantTitleNormClean.length);
        if (lenDiff > 0.5) continue;
        const isSub =
          candTitleNormClean === wantTitleNormClean ||
          candTitleNormClean.includes(wantTitleNormClean) ||
          wantTitleNormClean.includes(candTitleNormClean);
        if (!isSub) continue;
        if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
        // 跨版本守卫（与 Tier 3 一致）：版本标签不等 → 改用 ±3s 严格。
        const candVersion = extractVersionTag(t.title);
        if (
          this.durationMismatchVersionSafe(
            wantVersion,
            candVersion,
            meta.duration,
            t.duration,
          )
        ) continue;
        this.logger.log(
          `searchEquivalent ${platform} relaxed title match [${tag}]: ` +
            `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
            ` (cleanTitle cand="${candTitleNormClean}" want="${wantTitleNormClean}"` +
            ` dur=${meta.duration}≈${t.duration}, lenient)`,
);
         return t;
       }
     }

    // 第五遍-b：Spotify-style「title + co-author suffix」识别。修
    // 「PLACEBO (安慰剂) - 米津玄師 / 野田洋次郎」↔「PLACEBO ＋ 野田洋次郎 -
    // Kenshi Yonezu / Yojiro Noda」：seed 标题剥括号 = PLACEBO，候选标题
    // = PLACEBO ＋ 野田洋次郎——后者多了一段「野田洋次郎」恰好是候选的另一位
    // 协作者。Tier 5 的 50% 长度门把这种「短 seed + 拼了协作者名的 cand」挡掉
    // （15 vs 7 = 53% > 50%），JW 0.857 也卡在 0.88 门外。这里走「longer 是
    // shorter 的严格前缀 + 剥首部分隔符后命中某侧艺人别名」的兜底。
    //
    // ⚠️ 2026-08-07 hardening：原 `||` 第二分支
    // `artistAppearsInField(extraNorm, meta.artist)` 把「标题里出现原唱名」
    // 当正信号——这是**翻唱**的最强标注形式（`诱丨林宥嘉` =
    // 「诱 + 分隔符 + 原唱 林宥嘉」）。改为：
    //   - extra 命中 cand 自己的艺人 → 接受（PLACEBO 场景「+ 协作者名」）；
    //   - extra 命中 seed 自己的艺人 → 拒绝（翻唱场景「+ 原唱名」是负信号）；
    //   - 两者都命中（罕见，对称情况如 2 人对 2 人双拼）→ 拒，避免歧义。
    // 此外命中后必须 `artistLooseMatch(t.artist, meta.artist)` 复查——Tier 5b
    // 之前完全跳过此步，**下游推翻上游**的正确判断（如 PLACEBO 仍能过但
    // KiraCola 那种「同 title 弱同 artist」也漏过来）。本步使 Tier 5b 与
    // 上游 tier 在艺人语义上对齐。
    {
      const wantBase = wantTitleNormClean;
      for (const t of filtered) {
        const candTitleClean = stripParensContent(t.title);
        const candBase = this.normalizeKey(candTitleClean, '');
        if (!candBase || !wantBase) continue;
        // 判 longer/shorter：只处理「cand 是 want 的真前缀」或反之。
        let base = '';
        let extra = '';
        if (candBase.length > wantBase.length && candBase.startsWith(wantBase)) {
          base = wantBase;
          extra = candBase.slice(wantBase.length);
        } else if (
          wantBase.length > candBase.length &&
          wantBase.startsWith(candBase)
        ) {
          base = candBase;
          extra = wantBase.slice(candBase.length);
        }
        if (!extra) continue;
        // 剥掉前缀里的分隔符（＋/+/&/·/空白）后再做艺人匹配。
        const extraNorm = extra.replace(/^[+＋&/／·・\s]+/, '');
        if (!extraNorm) continue;
        // 反转「命中 seed 自己的艺人」分支（修诱丨林宥嘉 bug）：
        // extra 命中 cand 自己的艺人 → 接受（PLACEBO「+ 协作者名」场景）；
        // extra 命中 seed 自己的艺人 → 拒绝（「+ 原唱名」是翻唱的负信号）；
        // 两侧都命中 → 按歧义拒，强制走 Tier 1-4 严格判。
        const extraHitsCand = this.artistAppearsInField(extraNorm, t.artist);
        const extraHitsSeed = this.artistAppearsInField(extraNorm, meta.artist);
        if (!extraHitsCand) continue;
        if (extraHitsSeed) continue;
        // PLACEBO 修复：seed 也有「野田洋次郎」导致 extraHitsSeed=true → 反转
        // 规则误拒这条合法 collab。discriminator：PLACEBO 的 extra **等于**
        // cand 自己的某位艺人（精确整串 normalizeKey 相等，不是 substring），
        // 而翻唱的 extra（如「林宥嘉」）不等于 cand 的「KiraCola」。
        // 加一道「extra 字面命中 cand 自己艺人整串」的检查，若 extra 真是
        // cand 的别名/罗马化整串 → 放行（PLACEBO 场景）；否则仍按翻唱拒。
        const extraIsExactCandArtist = artistTransliterationMatch(
          extraNorm,
          t.artist,
        );
        if (!extraIsExactCandArtist) continue;
        // 艺人语义复查：标题里说「+ 协作者」不等于本体艺人相同——PLACEBO
        // 仍是「米津玄師 + 野田洋次郎」对「Kenshi Yonezu + Yojiro Noda」，两
        // 人对两人，artistLooseMatch 多艺人兜底配对命中 ≥ ceil(n/2) 才过。
        // KiraCola 那种「同 title + 完全不同艺人」在此处被拒。
        if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
        if (this.durationMismatch(meta.duration, t.duration)) continue;
        this.logger.log(
          `searchEquivalent ${platform} co-author-suffix match [${tag}]: ` +
            `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}" ` +
            `(want="${wantBase}" cand="${candBase}", extra="${extraNorm}" matched artist)`,
        );
        return t;
      }
    }

    // 第六遍：JW fuzzy title-only。Tier 5 在「共享前缀」型（「胸の煙vs 胸の煙MV」）
    // 已能命中。Tier 6 兜底「JW 在阈值内且长度差 ≤ 40%」的容错——典型场景
    // 是候选标题是原版的轻微改写（如「聖夜」vs「聖夜☆」，一个字符差）。
    // JW 阈值 0.88 + 长度门限 0.4 + 艺人宽松 + duration 三重过滤。
    const FUZZY_TITLE_JW_THRESHOLD = 0.88;
    const FUZZY_TITLE_LENGTH_GATE = 0.4;
    for (const t of filtered) {
      const tt = this.normalizeKey(t.title, '');
      if (!tt) continue;
      const lenDiff = Math.abs(tt.length - wantTitleKey.length) / Math.max(tt.length, wantTitleKey.length);
      if (lenDiff > FUZZY_TITLE_LENGTH_GATE) continue;
      const score = jaroWinkler(tt, wantTitleKey);
      if (score < FUZZY_TITLE_JW_THRESHOLD) continue;
      const ta = this.normalizeKey(t.artist, '');
      if (!this.artistLooseMatch(t.artist, meta.artist)) continue;
      if (this.durationMismatch(meta.duration, t.duration)) continue;
      this.logger.log(
        `searchEquivalent ${platform} fuzzy title match [${tag}]: ` +
          `"${t.title} - ${t.artist}" ← "${meta.title} - ${meta.artist}"` +
          ` (score=${score.toFixed(3)} candKey="${tt}" wantKey="${wantTitleKey}")`,
      );
      return t;
    }

    return null;
  }

  /**
   * 艺人宽松命中：双向 includes（前后缀 / 缩写 / 全名含半名）+ 跨脚本**音译佐证**
   * （CJK vs Latin：把 CJK 侧罗马化后与拉丁侧比对，对得上才算同一艺人）。
   *
   * ⚠️ 2026-07-30 hardening: 旧代码的 `!ta || !wantArtistKey → true` 会在
   *    任意一方艺人名为空时直接放行——这会让平台返回的 UGC / 封面 / 伴奏
   *    （ar 字段缺失或不匹配的条目）在 title+duration 对得上的情况下被自动
   *    ❤。已改为：任意一方缺失 → 拒绝（false），不做匹配。
   *
   * ⚠️ 2026-07-31 hardening: 旧代码这里用**裸** `isCrossScript`——只看「一边
   *    CJK、一边拉丁」就判同一艺人。这会把「铃木爱理」和「Lefty Hand Cream」
   *    在歌名撞上时判成同一人（同名翻唱链被 CJK 名当桥传递性合并，红心被错误
   *    跨平台同步）。改为 `artistTransliterationMatch`：跨脚本必须**音译对得上**
   *    才认。纯汉字日文名（藤井风→拼音≠日文读音）音译对不上——那类由
   *    matchEquivalentTrack 的「标题完全相等 + 时长 ±3s 严格」强佐证通道兜底
   *    （Tier 3b），不走这里。
   *
   * ⚠️ 2026-08-03: 参数改为**原始 artist 串**（非 normalizeKey 后）。原因：
   *    「德永英明 (とくなが ひであき)」的假名读音括号在 normalizeKey 的
   *    stripFuriganaParens 里被剥掉，音译佐证就丢了发音真相——kuromoji 拆
   *    不对「德永英明」这个姓名（IPADIC 无此人名），导致 Spotify 的
   *    "Hideaki Tokunaga"（名前颠倒）匹配不上。传原始串让 artistTransliterationMatch
   *    能提取假名括号读音。includes 仍用 normalizeKey 后比较（一致口径）。
   *
   * 2026-08-03 多艺人兜底：collab 场景（QQ 给「米津玄師 (よねづ けんし) / 
   *    野田洋次郎」，Spotify 给「Kenshi Yonezu / Yojiro Noda」），单艺人
   *    blob 不在别名表/罗马化命中。拆 /／,&; 后做配对别名/罗马化匹配，命中
   *    多数（ceil(n/2)）即过。仍然只信任别名表 + kuromoji + romanize 三条
   *    现有桥——不引入新模糊度，仅在「双方都 ≥2 协作者」时才走这条路，避免
   *    单艺人场景下走火入魔。
   */
  private artistLooseMatch(rawA: string, rawB: string): boolean {
    if (!rawA || !rawB) return false;
    const a = this.normalizeKey(rawA, '');
    const b = this.normalizeKey(rawB, '');
    if (!a || !b) return false;
    if (
      a.includes(b) ||
      b.includes(a) ||
      artistTransliterationMatch(rawA, rawB)
    ) {
      return true;
    }
    // 多艺人兜底：双方都 ≥2 协作者时按配对别名/罗马化匹配。
    const partsA = this.splitArtists(rawA);
    const partsB = this.splitArtists(rawB);
    if (partsA.length >= 2 && partsB.length >= 2) {
      let matched = 0;
      for (const pa of partsA) {
        const normPa = this.normalizeKey(pa, '');
        if (!normPa) continue;
        for (const pb of partsB) {
          const normPb = this.normalizeKey(pb, '');
          if (!normPb) continue;
          if (
            normPa.includes(normPb) ||
            normPb.includes(normPa) ||
            artistTransliterationMatch(pa, pb)
          ) {
            matched++;
            break;
          }
        }
      }
      return matched >= Math.ceil(partsA.length / 2);
    }
    return false;
  }

  /**
   * 把多艺人字符串按常见分隔符切分。collab 场景：「米津玄師 / 野田洋次郎」
   * → ['米津玄師', '野田洋次郎']；「A, B & C」→ ['A', 'B', 'C']。
   * 只切显式分隔符（/／,&;），不切括号内容里的连字符——括号注释交给
   * stripFuriganaParens/stripFeatTags 在 normalizeKey 里剥。
   */
  private splitArtists(raw: string): string[] {
    return raw
      .split(/\s*[\/／,;&]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * 「给定的 rawArtist 是不是某 artist 字段（可能多艺人）里的某位艺人的
   * 别名/罗马化」。用于 Tier 5b：判断 cand 标题末尾追加的 co-author 段是否
   * 真匹配某侧艺人。配对走与 artistLooseMatch 相同的别名 + kuromoji + 
   * romanize 三条桥，但不要求双方都 ≥2 人（单艺人对单段 extra 也行）。
   */
  private artistAppearsInField(rawArtist: string, field: string): boolean {
    if (!rawArtist || !field) return false;
    // 先直接整串桥（单艺人场景）。
    if (artistTransliterationMatch(rawArtist, field)) return true;
    // 拆字段按位桥。
    const parts = this.splitArtists(field);
    for (const p of parts) {
      if (artistTransliterationMatch(rawArtist, p)) return true;
      const np = this.normalizeKey(p, '');
      const ne = this.normalizeKey(rawArtist, '');
      if (np && ne && (np.includes(ne) || ne.includes(np))) return true;
    }
    return false;
  }

  private durationMismatch(seedDuration: number, candDuration: number): boolean {
    return (
      seedDuration > 0 &&
      candDuration > 0 &&
      Math.abs(candDuration - seedDuration) > VERSION_DURATION_TOLERANCE_SEC
    );
  }

  /**
   * 「跨版本守卫」—当 seed 与 cand 的版本标签不一致时（一方 LIVE/COVER/…
   * 另一方 studio），拒绝长时长门、放回 ±3s 严格。
   *
   * 设计动机：原 `durationMismatchLenient` 是「同歌跨源（QQ 258s vs Spotify
   * 243s，差 15s）兜底」，不是「跨版本（studio 300s vs live 320s，差 20s）
   * 兜底」——后者会污染用户 ❤ 的 studio，让 live 也被 star 上。**长时长
   * 门只在「版本标签同 / 都是 null」时启用**；任一边是 LIVE / COVER /
   * ACOUSTIC / REMIX / INST 等标签 → 一律用 ±3s strict。
   *
   * 用途：Tier 3 title-exact / Tier 5 relaxed title 跨版本场景。
   */
  private durationMismatchVersionSafe(
    seedVersion: VersionTag,
    candVersion: VersionTag,
    seedDuration: number,
    candDuration: number,
  ): boolean {
    const sameV = seedVersion === candVersion;
    const tol = sameV
      ? DIFFERENT_VERSION_DURATION_TOLERANCE_SEC
      : VERSION_DURATION_TOLERANCE_SEC;
    return (
      seedDuration > 0 &&
      candDuration > 0 &&
      Math.abs(candDuration - seedDuration) > tol
    );
  }

  /**
   * 跨版本 duration 容差：title-exact / 剥括号后 substring 等强信号匹配的
   *  "同歌不同版本"情况。差 30s 以内都接受（QQ 源 258s vs Spotify 源 243s
   *  的 15s 差、album vs single 的典型 15-30s 差）。本规则的"宽"是为了
   *  找回用户已经在听但跨平台搜不到的歌，避免让用户手动按"重新搜索"。
   *  仍然比"任意两首同歌"严格（remix 普遍 ≥30s，不在范围内）。
   */
  private durationMismatchLenient(
    seedDuration: number,
    candDuration: number,
  ): boolean {
    return (
      seedDuration > 0 &&
      candDuration > 0 &&
      Math.abs(candDuration - seedDuration) > DIFFERENT_VERSION_DURATION_TOLERANCE_SEC
    );
  }

  /**
   * 检测两个 normalizeKey 后的艺人名字是否属于"不同文字系统"（一个 CJK，一个
   * 拉丁字母）。用于放宽跨平台匹配：Spotify 常用罗马字（"Fujii Kaze"）而 QQ/
   * 网易云用汉字（"藤井风"）——歌名+时长已对上时，不应因艺人脚本不同而拒绝。
   */
  private isCrossScript(a: string, b: string): boolean {
    // \u6c49\u5b57 + \u5e73\u5047\u540d + \u7247\u5047\u540d \u90fd\u7b97\u300cCJK \u4fa7\u300d\u2014\u2014\u300c\u3082\u3063\u3068\u300d(\u5047\u540d) vs "Motto"(\u62c9\u4e01)
    // \u4e5f\u662f\u8de8\u811a\u672c\uff08aiko \u3082\u3063\u3068 \u2194 Motto \u573a\u666f\uff09\uff0c\u53ea\u770b\u6c49\u5b57\u4f1a\u628a\u5047\u540d\u6f0f\u6389\u3002
    const hasCjk = (s: string) =>
      /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(s);
    const hasLatin = (s: string) => /[a-z]/.test(s);
    const aCjk = hasCjk(a);
    const bCjk = hasCjk(b);
    if (aCjk && !bCjk && hasLatin(b)) return true;
    if (bCjk && !aCjk && hasLatin(a)) return true;
    return false;
  }

  // ── 跨平台红心检测 + 自动同步（切歌时用） ──────────────────

  /**
   * 每 session 每平台的「已红心 trackId 集合」缓存，避免每次切歌都拉整份
   * 收藏列表（QQ 1000+ 首）。TTL 内直接查集合。
   */
  private readonly likedCache = new Map<
    string,
    { set: Set<string>; at: number }
  >();
  private static readonly LIKED_CACHE_TTL_MS = 5 * 60 * 1000;

  private likedCacheKey(session: Session, provider: MusicProvider): string {
    return `${session.id}:${provider}`;
  }

  /** 乐观更新缓存（我们自己写了 like/unlike 之后）。 */
  private updateLikedCache(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    liked: boolean,
  ): void {
    const entry = this.likedCache.get(this.likedCacheKey(session, provider));
    if (!entry) return; // 还没建缓存就不管，下次拉的时候是新鲜的
    if (liked) entry.set.add(trackId);
    else entry.set.delete(trackId);
  }

  /** 用一份已拉到的红心列表整体填充缓存。importLiked 拉全量收藏时顺手复用，
   *  避免紧接着的切歌 detect 又把 QQ 1000+ 首重拉一遍（importLiked 与 detect
   *  之前是各拉各的，互不复用）。 */
  private primeLikedCache(
    session: Session,
    provider: MusicProvider,
    trackIds: string[],
  ): void {
    this.likedCache.set(this.likedCacheKey(session, provider), {
      set: new Set(trackIds),
      at: Date.now(),
    });
    this.reconcileLiked(session, provider, new Set(trackIds));
  }

  /**
   * 两套真值源主动对账（#5）：拿到一份**新鲜的**远端红心全量后，把本地
   * `providers[p].liked` 收敛到「远端 ∪ 同步队列在途的 like − 在途的 unlike」。
   * 远端是权威；在途的乐观写还没落到远端，不能被当作失配抹掉。
   * 只在远端拉取**成功**时调用（失败保留本地状态，绝不误清）；未登录 /
   * Deezer 永远不会走到这里。顺带把 fanOut 记录里该平台已不再红心的条目
   * 移除（外部在官方 App 取消了收藏 → 角标不再多算）。
   */
  private reconcileLiked(
    session: Session,
    provider: MusicProvider,
    remote: Set<string>,
  ): void {
    if (!this.isLikeable(provider)) return;
    const state = this.loadState(session);
    const local = state.providers[provider].liked;

    // CONSERVATIVE GUARD: 各 provider 的 fetchLiked 在「找不到对应歌单」
    // （NetEase 缺 specialType=5 / QQ 缺 dirid=201 / Spotify 接口 shape 变
    // 化）等场景下都会返回空 Set——这不是「用户真的没有 ❤」而是「拉不到数据」。
    // 当前空远端 + 非空本地 → 跳过 reconcile，避免一次性抹掉用户多年的
    // ❤ 列表。下次成功的拉取会自然收敛。代价：用户真在官方 App 取消全部
    // ❤ 后，本地角标要等下一次 fetch 才同步；这是更小的代价。
    if (remote.size === 0 && local.size > 0) {
      this.logger.warn(
        `reconcileLiked(${provider}): remote=0 but local=${local.size}, ` +
          'treating as transient fetch miss; skipping reconcile to avoid clobber',
      );
      return;
    }

    const next = new Set(remote);
    for (const t of this.likeSync.pendingTargets(session.id)) {
      if (t.platform !== provider) continue;
      if (t.liked) next.add(t.trackId);
      else next.delete(t.trackId);
    }

    const unchanged =
      next.size === local.size && [...next].every((id) => local.has(id));
    if (unchanged) return;

    state.providers[provider].liked = next;
    for (const [mergedId, entries] of Object.entries(state.fanOut)) {
      const kept = entries.filter(
        (e) => e.platform !== provider || !e.trackId || next.has(e.trackId),
      );
      if (kept.length === entries.length) continue;
      if (kept.length) state.fanOut[mergedId] = kept;
      else delete state.fanOut[mergedId];
    }
    this.saveState(session, state);
    this.logger.log(
      `reconciled ${provider} liked: local ${local.size} → ${next.size}`,
    );
  }

  /**
   * 取某平台「已红心 trackId 集合」（带 TTL 缓存）。只对已登录平台有效，
   * 未登录 / Deezer 返回 null。
   */
  private async getLikedSet(
    session: Session,
    provider: MusicProvider,
  ): Promise<Set<string> | null> {
    const key = this.likedCacheKey(session, provider);
    const cached = this.likedCache.get(key);
    if (cached && Date.now() - cached.at < MusicService.LIKED_CACHE_TTL_MS) {
      return cached.set;
    }
    const ps = session.providers[provider];
    let set: Set<string> | null = null;
    try {
      if (provider === 'qq' && ps?.qqCookie) {
        set = await this.qq.fetchLikedMidSet(ps);
      } else if (provider === 'netease' && ps?.musicU) {
        const tracks = await this.netease.fetchLiked(ps, 2000);
        set = new Set(tracks.map((t) => t.id));
      } else if (provider === 'spotify' && ps?.spotify) {
        const tracks = await this.spotify.fetchLiked(ps, 2000);
        set = new Set(tracks.map((t) => t.id));
      }
    } catch (err) {
      this.logger.warn(
        `getLikedSet(${provider}) failed: ${(err as Error).message}`,
      );
    }
    if (set) {
      this.likedCache.set(key, { set, at: Date.now() });
      this.reconcileLiked(session, provider, set);
    }
    return set;
  }

  private async isLikedOn(
    session: Session,
    provider: MusicProvider,
    trackId: string,
  ): Promise<boolean> {
    const set = await this.getLikedSet(session, provider);
    return set?.has(trackId) ?? false;
  }

  /**
   * mergedId 漂移归一（#6）：mergedId 是“时长聚类 + 平台优先级”派生的，不同次
   * 搜索可能不同（某平台超时缺席 / 变体聚类不同 → main 换了）。fanOut 记录
   * 里存有每平台的代表 trackId：新来的 (mergedId, sources) 若与某条已有记录的
   * 任一 (platform, trackId) 重合，就认定是同一首歌，复用那条记录的 key——
   * 避免同一首歌在不同 mergedId 下分裂成两条记录（角标乱 / 踩了又复活）。
   * 无重合则原样返回。扫全表是 O(记录数×条目)，上限 FANOUT_MAX，纯内存可接受。
   */
  private canonicalMergedId(
    state: MusicSessionState,
    mergedId: string,
    sources: Array<{ platform: MusicProvider; trackId: string }>,
  ): string {
    if (state.fanOut[mergedId]) return mergedId;
    const wanted = new Set(sources.map((s) => `${s.platform}:${s.trackId}`));
    for (const [key, entries] of Object.entries(state.fanOut)) {
      if (
        entries.some(
          (e) => e.trackId && wanted.has(`${e.platform}:${e.trackId}`),
        )
      ) {
        return key;
      }
    }
    return mergedId;
  }

  /** 把新的 (platform, repId) 合并进 fanOut 条目列表：按平台去重，新 trackId
   *  补全老格式缺省的条目；只留 likeable 平台。 */
  private mergeFanOutEntries(
    prev: FanOutEntry[],
    next: FanOutEntry[],
  ): FanOutEntry[] {
    const byPlatform = new Map<MusicProvider, FanOutEntry>();
    for (const e of [...prev, ...next]) {
      if (!this.isLikeable(e.platform)) continue;
      const existing = byPlatform.get(e.platform);
      if (!existing) {
        byPlatform.set(e.platform, { ...e });
      } else if (!existing.trackId && e.trackId) {
        existing.trackId = e.trackId;
      }
    }
    return [...byPlatform.values()];
  }

  /**
   * 把 sources 按平台归组。统一搜索的合并 key 只按「歌名+歌手」归一化、没有
   * 时长门槛，所以一首歌（如 "If I Ain't Got You"）常把同平台的十几个变体
   * 版本塞进同一个 unified item 的 sources。fan-out 必须**每个平台最多一首**，
   * 否则会把十几个变体全部收藏（实测 bug：点一首收藏一大堆）。
   */
  private groupByPlatform(
    sources: Array<{ platform: MusicProvider; trackId: string }>,
  ): Map<MusicProvider, string[]> {
    const m = new Map<MusicProvider, string[]>();
    for (const s of sources) {
      const arr = m.get(s.platform) ?? [];
      arr.push(s.trackId);
      m.set(s.platform, arr);
    }
    return m;
  }

  /**
   * 切歌时调：查这首统一 track 在各平台的红心情况。
   *  - 任一平台已红心 → 把「其余有版权但还没红心」的平台也补上红心（fan-out），
   *    返回 liked=true + 现在红心的完整平台列表。
   *  - 全都没红心 → 返回 liked=false（不写任何东西）。
   *
   * **每个平台最多操作一首**：同平台若有多个变体源，只认/只写一首（优先已在
   * 收藏里的那个变体，否则第一首）——否则会把同名的一堆变体全收藏。
   * 只对已登录平台生效；Deezer / 未登录平台跳过。幂等：已红心的平台不重复写。
   */
  async detectLikedAndSync(
    session: Session,
    mergedId: string,
    sources: Array<{ platform: MusicProvider; trackId: string }>,
    meta?: LikeMeta,
  ): Promise<{ liked: boolean; fannedOutTo: MusicProvider[]; settled: boolean }> {
    const byPlatform = this.groupByPlatform(sources);

    // 每个平台：判断是否已红心（任一变体在收藏里就算），并选一个代表 trackId
    // （已收藏的那个变体优先，否则第一个）。**每平台只认一首**——统一搜索会把
    // 同名的一堆变体塞进同一 item，这里就是「不同步 20 个音源」的第一道闸。
    const perPlatform = await Promise.all(
      [...byPlatform.entries()].map(async ([platform, trackIds]) => {
        const set = await this.getLikedSet(session, platform);
        const likedId = set ? trackIds.find((id) => set.has(id)) : undefined;
        return {
          platform,
          liked: Boolean(likedId),
          canSync: this.canSyncLike(session, platform),
          repId: likedId ?? trackIds[0],
        };
      }),
    );

    const anyLiked = perPlatform.some((p) => p.liked);
    if (!anyLiked) {
      // 没有任何平台红心 → 只读检测，什么都不写。但如果这首歌有 fan-out
      // 记录（可能挂在漂移前的老 mergedId 下），说明它曾被心过但远端已被
      // 对账/取消——不在这里清理（交给 loadState 的 GC 启发式）。
      // 无任何红心：不写不排队，没有 discover 可等 → settled=true。
      return { liked: false, fannedOutTo: [], settled: true };
    }

    // 有红心 → 检测本身只读；真正的「补齐其余平台」交给同步队列异步做。
    //  - 已红心的平台：确认态，反映到本地 + 计入角标；
    //  - 还没红心但能写的平台：乐观点亮本地 + 入队（每平台一首）后台补；
    //  - 不能写红心的平台（deezer/未登录）：既不入队也不计角标。
    const state = this.loadState(session);
    // mergedId 漂移归一（#6）：若同一首歌已挂在老 key 下，复用老 key。
    const canonicalId = this.canonicalMergedId(state, mergedId, sources);
    const fresh: FanOutEntry[] = [];
    const targets: Array<{ platform: MusicProvider; trackId: string }> = [];
    for (const p of perPlatform) {
      if (p.liked) {
        this.setLike(state, p.platform, p.repId, true);
        fresh.push({ platform: p.platform, trackId: p.repId });
      } else if (p.canSync) {
        this.setLike(state, p.platform, p.repId, true); // 乐观点亮
        fresh.push({ platform: p.platform, trackId: p.repId });
        targets.push({ platform: p.platform, trackId: p.repId });
      }
    }
    // 与已有 fanOut 记录**合并**而非覆盖：某次搜索可能没返回某平台的 source
    // （平台超时缺席 / 变体聚类不同），但那首歌在该平台仍是红心的——直接覆盖
    // 会把它从记录里抹掉、角标少算。合并保留旧平台（dislikeMerged 已 delete
    // 整条记录，所以这里不会复活被取消的红心）。只留 likeable 平台。
    const merged = this.mergeFanOutEntries(
      state.fanOut[canonicalId] ?? [],
      fresh,
    );
    state.fanOut[canonicalId] = merged;
    this.saveState(session, state);

    // 关键改动：远端写不再在切歌时内联执行，而是推入同步队列（MQ 思路）——
    // 每平台一首、失败自动重试、不阻塞播放。检测→入队→后台同步解耦。
    // discover：这首歌已有红心 → 顺带去「其余已登录但还没这首 source」的平台
    // 跨平台匹配补齐（后台，严格 ±3s）。targets 可能为空（已红心平台不需要
    // 重写远端）但 discover 仍要跑，所以 enqueue 允许 discover-only。
    this.enqueueLikeSync(
      session,
      canonicalId,
      true,
      targets,
      this.buildDiscover(meta, [...byPlatform.keys()]),
    );

    // 等 discover 落定再返回 fannedOutTo——否则前端 refreshLikedState 的 detect
    // 会和后台搜索竞态：响应里的角标数还是「补平台之前」的状态，UI 上永远
    // 不涨（用户侧现象：日志已 "library patched += qq, spotify"，❤ 角标没显示
    // 数字 2）。等待期间队列把跨平台匹配 + 库补源写完，这里重新读 state 拿
    // 最终记录。超时（6s）返回当前状态——best-effort，下次 refresh 再等。
    //
    // settled=false（超时）是关键信号：discover 还在跑 / 排在队列后面，本次
    // fannedOutTo 是**中间态**（如只有 qq，netease 还没落账）。前端必须
    // 据此**继续轮询**，绝不能把两个相同中间值当稳定（否则 Spotify 搜索
    // 悬挂时角标永远停在 1，discover 落定后也没人再刷新——本次 bug 的根）。
    const settled = await this.likeSync.waitForSettled(
      session.id,
      canonicalId,
      6000,
    );
    const stateAfterWait = this.loadState(session);
    // 同曲不同版本（时长差 >±3s → mergeLibrary 拆成独立 item / 独立 fanOut
    // 记录）的兄弟库条目：把它们已红心的 source 平台并入当前记录，让 ❤ 角标
    // 按「歌」算而不是按「版本」算。canonicalMergedId 只按 (platform, trackId)
    // 桥——兄弟版本 trackId 不同，桥不到，不加这步角标就漏（用户播放 258s
    // 版本时看不到 275s 版本已补上的 qq/spotify）。
    this.mergeSiblingLibraryLikes(stateAfterWait, session, canonicalId, meta);
    this.saveState(session, stateAfterWait);
    const record = stateAfterWait.fanOut[canonicalId] ?? [];
    return {
      liked: true,
      fannedOutTo: record.map((e) => e.platform),
      settled,
    };
  }

  /**
   * 同曲不同版本的兄弟库条目并账：把「我的喜欢」库里 normalizeKey 相同
   * （歌名+歌手完全一致）的所有 item 的已红心 source 平台并入 canonicalId
   * 的 fanOut 记录。
   *
   * 背景：同一首歌的两个版本（时长差 >±3s）在 mergeLibrary 里是两条独立
   * item，fanOut 记录也按各自 mergedId 分开。discover 只给「被播放的那个
   * 版本」的记录补平台；播放另一版本时 canonicalMergedId 按 (platform,
   * trackId) 桥不到兄弟记录 → ❤ 角标只显示本版本自己的平台数。
   *
   * 只读合并（不 setLike）：兄弟 source 来自「我的喜欢」库快照，本来就是
   * 已红心的平台。库可能略旧（用户后来在官方 App 取消）——接受，下一次
   * importLiked / 对账会收敛。
   */
  private mergeSiblingLibraryLikes(
    state: MusicSessionState,
    session: Session,
    canonicalId: string,
    meta: LikeMeta | undefined,
  ): void {
    if (!meta?.title || !meta.artist) return;
    const stored = this.storage.get<{ items: UnifiedSearchItem[] }>(
      this.libraryKey(session.id),
    );
    if (!stored?.items?.length) return;
    const wantKey = this.normalizeKey(meta.title, meta.artist);
    const record = state.fanOut[canonicalId] ?? [];
    const extra: FanOutEntry[] = [];
    for (const it of stored.items) {
      if (this.normalizeKey(it.title, it.artist) !== wantKey) continue;
      for (const s of it.sources) {
        if (!s.trackId || !this.isLikeable(s.platform)) continue;
        if (
          record.some((e) => e.platform === s.platform && e.trackId === s.trackId)
        ) {
          continue;
        }
        extra.push({ platform: s.platform, trackId: s.trackId });
      }
    }
    if (!extra.length) return;
    state.fanOut[canonicalId] = this.mergeFanOutEntries(record, extra);
  }

  async toggleLike(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    meta?: LikeMeta,
  ): Promise<{ success: boolean; liked: boolean }> {
    // Deezer 等匿名源没有收藏概念：点 ❤ 静默 no-op，不写本地、不入队、不点亮。
    if (!this.isLikeable(provider)) {
      return { success: true, liked: false };
    }
    const state = this.loadState(session);
    const wasLiked = this.applyLikeToggle(state, provider, trackId);
    this.saveState(session, state);
    const nowLiked = !wasLiked;
    // 远端同步走队列（best-effort + 重试，不阻塞本地）。单平台用一个稳定
    // 的合成 key，避免和统一搜索的 mergedId 撞车。
    // discover：这是电台单平台 track（如 QQ 私人 FM），点 ❤ 时顺带去其余
    // 已登录平台跨平台匹配，把红心同步过去（仅收藏方向，取消不匹配）。
    this.enqueueLikeSync(
      session,
      `single:${provider}:${trackId}`,
      nowLiked,
      [{ platform: provider, trackId }],
      nowLiked ? this.buildDiscover(meta, [provider]) : undefined,
    );
    return { success: true, liked: nowLiked };
  }

  /**
   * Heart fan-out：把"心动"一次性写到一个统一 track 的所有平台 source。
   *
   * liked=true：对每个 source 反转 like 状态，收集成功（wasLiked=false → 写入）
   *   的平台，写入 state.fanOut[mergedId]（作为未来 unlike 的幂等依据）。
   * liked=false：按 state.fanOut[mergedId] 里的平台列表反写 unlike（保证幂等
   *   ——只动我们之前心过的）。
   *
   * 单平台失败不阻塞其他平台；fannedOutTo 列出真正被这次操作影响的平台。
   *
   * 本地 like 集合**同步**更新（GET /music/liked 立即可见，e2e 依赖此），
   * 远端写则统一推入同步队列（每平台一首 + 失败重试），不内联阻塞。
   *
   * 实现要点：必须复用 setLike + 同步队列，**不能**直接调 toggleLike——
   * 因为 toggleLike 内部 loadState / saveState 会和 fanOut 的外层 saveState
   * 互相覆盖，导致"内层修改被外层旧 state 写回去"。
   */
  async fanOutLike(
    session: Session,
    mergedId: string,
    sources: Array<{ platform: MusicProvider; trackId: string }>,
    liked: boolean,
    meta?: LikeMeta,
  ): Promise<{
    success: boolean;
    liked: boolean;
    /**
     * 当前 mergedId 在所有平台上心动过的**完整列表**——也就是
     * `state.fanOut[mergedId]` 的真值。UI 拿这个当 ❤ 角标数。
     *
     * 之前实现里 fannedOutTo 只含"本次 flip"的平台，但用户可能之前
     * 单平台心过同一个 track，那部分不计入——导致 UI 显示 "1❤" 实际
     * 是 2 平台已 ❤ 的歧义。改成"全集"消除歧义。
     */
    fannedOutTo: MusicProvider[];
  }> {
    const state = this.loadState(session);
    // mergedId 漂移归一（#6）：若同一首歌已挂在老 key 下，复用老 key——
    // 保证“同一首歌只有一条 fan-out 记录”，unlike/踩能找到完整平台列表。
    const canonicalId = this.canonicalMergedId(state, mergedId, sources);
    /** 本次要推入同步队列的远端目标（每平台一首）。 */
    const targets: Array<{ platform: MusicProvider; trackId: string }> = [];

    if (liked) {
      // **每个平台只收藏一首**：统一搜索会把同名的一堆变体塞进同一 item 的
      // sources（无时长门槛），遍历全部会把十几个变体全收藏。按平台取第一首。
      const fresh: FanOutEntry[] = [];
      const byPlatform = this.groupByPlatform(sources);
      for (const [platform, trackIds] of byPlatform) {
        // Deezer 匿名无收藏概念 → 不记账、不计角标、不入队。
        if (!this.isLikeable(platform)) continue;
        const trackId = trackIds[0];
        fresh.push({ platform, trackId });
        // setLike 是幂等的：已心动的不会被翻回 unlike（本地即时可见）。
        this.setLike(state, platform, trackId, true);
        targets.push({ platform, trackId });
      }
      // 与已有记录合并：这次 sources 里没列的旧平台也保留——避免“老
      // fan-out 记录被覆盖”丢状态；历史污染的 deezer 在合并时被过滤。
      state.fanOut[canonicalId] = this.mergeFanOutEntries(
        state.fanOut[canonicalId] ?? [],
        fresh,
      );
    } else {
      // 取消心动：按之前 fanOut 记录的平台列表 unlike（幂等）。定位 trackId
      // 优先用记录里存的代表 trackId（漂移后本次 sources 可能缺某平台），
      // 没有再兜底用本次 sources 里同平台的第一首。
      const toUnlike = state.fanOut[canonicalId] ?? [];
      for (const entry of toUnlike) {
        if (!this.isLikeable(entry.platform)) continue; // 跳过历史 deezer 记录
        const trackId =
          entry.trackId ??
          sources.find((s) => s.platform === entry.platform)?.trackId;
        if (!trackId) continue;
        this.setLike(state, entry.platform, trackId, false);
        targets.push({ platform: entry.platform, trackId });
      }
      delete state.fanOut[canonicalId];
    }

    this.saveState(session, state);
    // 远端写走同步队列：合并去重、每平台一首、失败重试，不阻塞本次响应。
    // discover：收藏方向时，顺带去「搜索结果里没有、但用户已登录」的平台
    // 跨平台匹配补齐（后台，严格 ±3s）。取消方向不匹配（只按 fanOut 记录 unlike）。
    this.enqueueLikeSync(
      session,
      canonicalId,
      liked,
      targets,
      liked ? this.buildDiscover(meta, [...this.groupByPlatform(sources).keys()]) : undefined,
    );
    // 返回"全集"——liked=true 时就是当前 fan-out 列表；liked=false 时空数组
    const fannedOutTo = liked
      ? (state.fanOut[canonicalId] ?? []).map((e) => e.platform)
      : [];
    return { success: true, liked, fannedOutTo };
  }

  /** 当前 session 中某 mergedId 是否已被 fan-out 心动过。 */
  isFanOutLiked(state: MusicSessionState, mergedId: string): boolean {
    return (state.fanOut[mergedId]?.length ?? 0) > 0;
  }

  private libraryKey(sessionId: string): string {
    return `library:${sessionId}`;
  }

  /**
   * 拉取各平台"我的喜欢" → 合并为统一库 → 持久化到 .storage。
   *
   * 当前实现：
   *   - NetEase: 三步拉"我喜欢的音乐"歌单（/api/v6/playlist/detail）
   *   - QQ: 两步拉"我喜欢"（splcloud/getmyfav → qzone/cdinfo_byids_cp），
   *     详见 QqMusicProvider.fetchLiked
   *   - Spotify: 已登录 → /me/tracks；未登录 → not_logged_in
   *   - Deezer: 匿名模式无 user 概念
   *
   * 单平台失败不阻塞——返回的 `sources` 数组里如实记录每个平台的拉取状态
   * （{provider, count, error?}），前端可以分别展示。
   */
  async importLiked(session: Session): Promise<{
    items: UnifiedSearchItem[];
    sources: Array<{
      provider: MusicProvider;
      count: number;
      error?: string;
    }>;
    importedAt: number;
  }> {
    const sourceResults: Array<{
      provider: MusicProvider;
      count: number;
      error?: string;
    }> = [];
    const allTracks: Track[] = [];

    // NetEase
    try {
      const ps = session.providers.netease;
      if (!ps?.musicU) {
        sourceResults.push({
          provider: 'netease',
          count: 0,
          error: 'not_logged_in',
        });
      } else {
        const tracks = await this.netease.fetchLiked(ps, 1000);
        sourceResults.push({ provider: 'netease', count: tracks.length });
        allTracks.push(...tracks);
        this.primeLikedCache(session, 'netease', tracks.map((t) => t.id));
      }
    } catch (err) {
      this.logger.warn(
        `netease fetchLiked failed: ${(err as Error).message}`,
      );
      sourceResults.push({
        provider: 'netease',
        count: 0,
        error: (err as Error).message,
      });
    }

    // QQ: 两步拉取（getmyfav dirid=201 → songlist detail），详见
    // QqMusicProvider.fetchLiked。失败不阻塞其他平台。
    try {
      const ps = session.providers.qq;
      if (!ps?.qqCookie) {
        sourceResults.push({
          provider: 'qq',
          count: 0,
          error: 'not_logged_in',
        });
      } else {
        // 上限 2000（fetchLiked 内部按 1000/页分页）—— 覆盖绝大多数用户的
        // 收藏规模；1093 首的用户不会被 1000 截断。
        const tracks = await this.qq.fetchLiked(ps, 2000);
        sourceResults.push({ provider: 'qq', count: tracks.length });
        allTracks.push(...tracks);
        this.primeLikedCache(session, 'qq', tracks.map((t) => t.id));
      }
    } catch (err) {
      this.logger.warn(`qq fetchLiked failed: ${(err as Error).message}`);
      sourceResults.push({
        provider: 'qq',
        count: 0,
        error: (err as Error).message,
      });
    }

    // Spotify: 已登录 → 走 /me/tracks；未登录 → not_logged_in
    try {
      const ps = session.providers.spotify;
      if (!ps?.spotify) {
        sourceResults.push({
          provider: 'spotify',
          count: 0,
          error: 'not_logged_in',
        });
      } else {
        const tracks = await this.spotify.fetchLiked(ps, 1000);
        sourceResults.push({ provider: 'spotify', count: tracks.length });
        allTracks.push(...tracks);
        this.primeLikedCache(session, 'spotify', tracks.map((t) => t.id));
      }
    } catch (err) {
      this.logger.warn(
        `spotify fetchLiked failed: ${(err as Error).message}`,
      );
      sourceResults.push({
        provider: 'spotify',
        count: 0,
        error: (err as Error).message,
      });
    }

    // Deezer: 匿名模式无 user 概念
    sourceResults.push({
      provider: 'deezer',
      count: 0,
      error: 'deezer_anonymous_no_user_likes',
    });

    // 合并去重（走 MatchService.mergeLibrary → 内部复用 buildUnifiedItems）。
    // 先把每首 track 的 audioUrl 归一成后端代理路径（fetchLiked 返回的是空），
    // 否则 sources[].url 为空、红心列表点击时前端拿不到可播放的 <audio src>。
    const items = this.match.mergeLibrary(
      allTracks.map((t) => this.toPlayableTrack(t)),
    );
    // Cross-script merge: "横顔" (QQ kanji) + "Yokogao" (Spotify romaji)
    // → 相同的 normalizeKey(artist) + cross-script title + same duration →
    // one entry with all three platform sources.
    const merged = mergeCrossScript(items);

    const importedAt = Date.now();
    // 落地时给每个 item 填 likedPlatforms（= import 时刻的 sources 平台）。
    // 后续运行时 fanOut 跨平台同步会用到这个字段——getLibrary 会再叠加 fanOut。
    const enrichedItems = merged.map((it) => ({
      ...it,
      likedPlatforms: it.sources.map((s) => s.platform),
    }));
    this.storage.set(this.libraryKey(session.id), {
      importedAt,
      items: enrichedItems,
      sources: sourceResults,
    });

    // 重建本地 fanOut：import 是「各平台真实红心」的全量快照——已按 artist-strict
    // + 音译佐证合并，当前跨平台真值都落进了每个 item 的 sources。运行时 fanOut
    // 只是叠加其上的「运行中新发现的跨平台链」，而历史 fanOut 里可能残留旧匹配
    // 逻辑（裸 isCrossScript）误并的**同名不同艺人**组（wacci/铃木爱理/Lefty 那种），
    // 导致 badge 与平台计数虚高。全量 import 时清空 fanOut，让它按收紧后的 detect
    // 逻辑重新积累——避免污染跟着走。远端红心不动（用户此前的决定）。
    const musicState = this.loadState(session);
    const hadFanOut = Object.keys(musicState.fanOut).length;
    if (hadFanOut) {
      musicState.fanOut = {};
      this.saveState(session, musicState);
      this.logger.log(
        `importLiked: cleared ${hadFanOut} fanOut group(s) for rebuild ` +
          `(session=${session.id.slice(0, 8)}…)`,
      );
    }

    return { items: enrichedItems, sources: sourceResults, importedAt };
  }

  /** 读取最近一次 import 的库（无则返回 null）。
   *
   * **运行时叠加 fanOut 状态**：import 时刻只覆盖了 import 时的 ❤ 列表；
   * 假设用户之后通过 detect / fanOutLike 在其他平台 ❤ 了这首歌（典型场景：
   * 播过一次、detect 自动跨平台同步），库 badge 需要反映出来。这里把
   * `fanOut[mergedId]` 里的平台与 `likedPlatforms`（或 sources）取并集，
   * 保证 UI 看到的"红心来源"始终是真相。
   *
   * **Deezer 不参与**：fanOut 在 fanOutLike 写时已过滤，但历史持久化可能
   * 渗入——这里再过一遍 isLikeable，双保险。
   *
   * **性能（≥ 3000 首库）**：
   *  - **派生缓存**：fanOutSignature + storedRef 双 key。fanOut 任何真变更
   *    或 importLiked 覆盖 storage → cache miss → 重算。命中 < 1ms 直接
   *    return。同 session 内连续打开 modal / 切歌 detect 触发 reloadLikedCount
   *    等高频路径零成本。
   *  - **增量合并**：先构建 `(platform, trackId) → library item indices` 反向
   *    索引一次（O(I×S) ≈ 6000 ops for 3000 items），扫 fanOut 找出受影响的
   *    item indices（O(F)）。**只对受影响的 item** 走 fanOut 合并；未受影响的
   *    item 直接复用 storage 里的 `likedPlatforms`（import 时已写好）。fanOut
   *    真变更通常 < 数百 entry → 受影响 item 通常 < 数百，**实际工作量从
   *    O(I×S×F) ≈ 30M ops 降到 O(I×S + F + 数百×S) ≈ 数十 K ops**。 */
  getLibrary(session: Session): {
    items: UnifiedSearchItem[];
    sources: Array<{
      provider: MusicProvider;
      count: number;
      error?: string;
    }>;
    importedAt: number;
  } | null {
    const stored = this.storage.get<{
      importedAt: number;
      items: UnifiedSearchItem[];
      sources: Array<{ provider: MusicProvider; count: number; error?: string }>;
    }>(this.libraryKey(session.id));
    if (!stored) return null;
    const state = this.loadState(session);
    const sig = this.fanOutSignature(state.fanOut);

    // 缓存命中：fanOut 签名 + storage 引用都没变 → 直接 return。
    const cached = this.libraryCache.get(session.id);
    if (
      cached &&
      cached.fanOutSignature === sig &&
      cached.storedRef === (stored as unknown as object)
    ) {
      return cached.result;
    }

    // ── 缓存 miss：重算 likedPlatforms ────────────────────────────────
    //
    // 第一遍反向索引（一次摊销）：
    //   (platform, trackId) → library item indices 列表。
    // 这让我们扫 fanOut 时，能 O(1) 知道哪些 library item 受 fanOut 影响，
    // 避免对每个 item 都跑一次 fanOut 扫描（O(I×S×F)）。
    const ptToItemIdx = new Map<string, number[]>();
    for (let i = 0; i < stored.items.length; i++) {
      const item = stored.items[i];
      for (const s of item.sources) {
        const k = `${s.platform}:${s.trackId}`;
        const arr = ptToItemIdx.get(k);
        if (arr) arr.push(i);
        else ptToItemIdx.set(k, [i]);
      }
    }
    // 第二反向索引（fanOut 内部，把 entry 映射回它所在的 fanOut key）：
    //   (platform, trackId) → fanOut keys 列表。命中后取整组 entries 并入
    //   likedPlatforms（不仅匹配的 entry 本身）。
    const ptToFanOutKeys = new Map<string, string[]>();
    for (const [key, entries] of Object.entries(state.fanOut)) {
      for (const e of entries) {
        if (!e.trackId) continue;
        const k = `${e.platform}:${e.trackId}`;
        const arr = ptToFanOutKeys.get(k);
        if (arr) {
          if (!arr.includes(key)) arr.push(key);
        } else {
          ptToFanOutKeys.set(k, [key]);
        }
      }
    }
    // 收集「受 fanOut 影响」的 item indices：
    //   - fanOut key === library item.id（直查命中，library 与 fanOut 同 key）
    //   - fanOut 任一 entry (platform, trackId) 命中 library item 的 sources
    const affected = new Set<number>();
    for (const [key, entries] of Object.entries(state.fanOut)) {
      for (let i = 0; i < stored.items.length; i++) {
        if (stored.items[i].id === key) {
          affected.add(i);
          break;
        }
      }
      for (const e of entries) {
        if (!e.trackId) continue;
        const idxs = ptToItemIdx.get(`${e.platform}:${e.trackId}`);
        if (!idxs) continue;
        for (const i of idxs) affected.add(i);
      }
    }
    const items = stored.items.map((item, idx) => {
      // 未受 fanOut 影响：直接复用 storage 里的 likedPlatforms（import 时
      // 已写好）。老 storage 没这字段时 fallback sources 平台。
      if (!affected.has(idx)) {
        if (item.likedPlatforms !== undefined) return item;
        const fb = item.sources.map((s) => s.platform);
        return { ...item, likedPlatforms: fb };
      }

      // 受影响 item：合并 fanOut（与原逻辑一致——双层 fanOut 查找 + Deezer 排除）。
      const basePlatforms = item.likedPlatforms ?? item.sources.map((s) => s.platform);
      const hadLikedPlatforms = item.likedPlatforms !== undefined;
      const set = new Set<MusicProvider>(basePlatforms);
      const direct = state.fanOut[item.id];
      if (direct) {
        for (const e of direct) {
          if (this.isLikeable(e.platform)) set.add(e.platform);
        }
      }
      const seenFanOutKeys = new Set<string>();
      for (const src of item.sources) {
        const keys = ptToFanOutKeys.get(`${src.platform}:${src.trackId}`);
        if (!keys) continue;
        for (const k of keys) seenFanOutKeys.add(k);
      }
      for (const k of seenFanOutKeys) {
        for (const e of state.fanOut[k] ?? []) {
          if (this.isLikeable(e.platform)) set.add(e.platform);
        }
      }
      const likedPlatforms = Array.from(set);

      // 复用原对象：仅当 likedPlatforms 已存在且值未变（避免 React 重渲染）。
      // 迁移路径（老 storage 无 likedPlatforms）必须显式落地，否则字段缺失。
      const same =
        hadLikedPlatforms &&
        likedPlatforms.length === basePlatforms.length &&
        likedPlatforms.every((p, i) => p === basePlatforms[i]);
      return same ? item : { ...item, likedPlatforms };
    });
    const result = { ...stored, items };
    this.libraryCache.set(session.id, {
      result,
      fanOutSignature: sig,
      storedRef: stored as unknown as object,
    });
    return result;
  }

  /**
   * Fetch synced lyrics for a track. Returns null when the provider
   * doesn't expose lyrics (QQ — public lyric API is gated behind
   * signature) or when the track has no lyric data (instrumental,
   * newer releases, region restrictions).
   *
   * Per-provider quirks:
   *  - NetEase: GET /api/song/lyric returns a flat { lyric, tlyric }
   *    structure where `lyric` is the LRC body. We parse it into
   *    LyricLine[] (translation strings tacked onto the matching
   *    line are out of scope for v1).
   *  - Deezer: /track/{id} includes `lyrics` (plain text only, no
   *    timestamps) when the rights-holder uploaded them. We try to
   *    match the Deezer `track_lyrics` style of unsynced lyrics via
   *    a separate endpoint that does exist but returns the timestamp
   *    format we want. Falls back to null otherwise.
   *  - QQ: GET c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg with a
   *    y.qq.com Referer returns the LRC body (trackId here is the
   *    songmid). Works anonymously; the session cookie is passed through
   *    when present but isn't required.
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
        // QQ: lyrics work anonymously; pass the session cookie if we have
        // one (harmless) but fall back to an empty session otherwise.
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

  /** (provider:trackId | ovh:artist|title) → 最近一次歌词结果。miss（null）
   *  也缓存，availability 扫描一页搜索结果时不至于反复打同一批接口。 */
  private readonly lyricsCache = new Map<
    string,
    { at: number; lines: LyricLine[] | null }
  >();

  private pruneLyricsCache(): void {
    if (this.lyricsCache.size <= LYRICS_CACHE_MAX) return;
    for (const key of this.lyricsCache.keys()) {
      this.lyricsCache.delete(key);
      if (this.lyricsCache.size <= LYRICS_CACHE_MAX) break;
    }
  }

  /** (sessionId|platform|kw|时长分桶) → 最近一次等价曲搜索结果。null 也缓存。
   *  `clean` = 这次搜索是否**正常完成**（命中 / 干净缺席）——决定 TTL：
   *  命中 / 干净缺席 1h（歌不在该平台是稳定事实，别每次 detect 重搜）；
   *  失败 / 超时 30s（网络抖动 ≠ 缺席，留重搜窗口）。 */
  private readonly equivSearchCache = new Map<
    string,
    { at: number; track: Track | null; clean: boolean }
  >();

  private pruneEquivSearchCache(): void {
    if (this.equivSearchCache.size <= EQUIV_SEARCH_CACHE_MAX_PER_SESSION) {
      return;
    }
    for (const key of this.equivSearchCache.keys()) {
      this.equivSearchCache.delete(key);
      if (this.equivSearchCache.size <= EQUIV_SEARCH_CACHE_MAX_PER_SESSION) {
        break;
      }
    }
  }

  /**
   * 多源歌词聚合：主平台 → 其余平台 source（按 LYRICS_SOURCE_PRIORITY 顺序）
   * → lyrics.ovh 兜底。第一个命中即返回，并标注来源与是否带时间戳（synced）。
   * 全部落空返回 { lines: null }。
   */
  async getLyricsAggregated(
    session: Session,
    provider: MusicProvider,
    trackId: string,
    extras: Array<{ platform: MusicProvider; trackId: string }>,
    title: string,
    artist: string,
  ): Promise<{
    lines: LyricLine[] | null;
    synced: boolean;
    source: MusicProvider | 'lyricsovh' | null;
  }> {
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
   * 「换个源找歌词」按钮触发：按"歌名 + 歌手"去每个有歌词 API 的平台（QQ /
   * 网易云 / Deezer）搜同名同时长的曲目，找到一个就拿它的歌词返回。
   *
   * 这是 `getLyricsAggregated` 失败后的手动兜底：当前 track id 的平台 + 已
   * 知 altSources + lyrics.ovh 都没词时（比如 Spotify 单平台搜索、或只在
   * Spotify 上的日区曲），允许用户主动触发「去其他平台用名搜」再拉一次。
   * 搜索复用 `searchEquivalent` 已有逻辑（精确 → 宽松 → 跨文字系统），命中
   * 后走 `getLyrics` 拿词；找不到任何平台返回 null。
   */
  async getLyricsByName(
    session: Session,
    title: string,
    artist: string,
    duration: number,
  ): Promise<{
    lines: LyricLine[] | null;
    synced: boolean;
    source: MusicProvider | 'lyricsovh' | null;
  }> {
    if (!title || !artist) return { lines: null, synced: false, source: null };
    const tried = new Set<string>();
    for (const platform of LYRICS_SOURCE_PRIORITY) {
      if (tried.has(platform)) continue;
      tried.add(platform);
      const t = await this.searchEquivalent(session, platform, {
        title,
        artist,
        duration,
      });
      if (!t) continue;
      const lines = await this.getLyrics(session, platform, t.id);
      if (lines && lines.length > 0) {
        return { lines, synced: isSynced(lines), source: platform };
      }
    }
    return { lines: null, synced: false, source: null };
  }

  /**
   * 歌词可用性——搜索结果行的「词」指示用。只查平台源（不打 lyrics.ovh，
   * 避免为一页 20 行结果轰第三方），第一个命中即停。命中/未命中都会进
   * lyricsCache，所以之后打开这首歌的歌词面板是即时的。
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

  /** When the provider is unavailable, return a minimal placeholder so the UI
   * doesn't appear broken. */
  private placeholder(
    provider: MusicProvider,
    reason: string,
  ): Track {
    return {
      id: `placeholder-${Date.now()}`,
      provider,
      title: '暂时没有可播放的曲目',
      artist: reason,
      album: '',
      coverUrl: '',
      audioUrl: '',
      duration: 0,
      liked: false,
    };
  }
}