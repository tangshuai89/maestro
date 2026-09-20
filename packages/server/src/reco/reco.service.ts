import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '../common/config';
import { StorageService } from '../common/storage';
import { Session, SessionService } from '../common/session';
import { MusicService } from '../music/music.service';
import { normalizeKey } from '../music/search.util';
import type { UnifiedSearchItem } from '../music/types';
import {
  buildProfileCore,
  librarySignature,
  pickExploreArtists,
  pickTasteSeeds,
  TASTE_ANCHOR_COUNT,
  TASTE_EXPLORE_RATIO,
  TASTE_SEED_COUNT,
  type TasteProfile,
  type TasteProfileCore,
} from './taste-profile';
import {
  buildCandidatePool,
  type CandidatePoolResult,
  type RecoCandidate,
} from './candidate-pool';
import {
  appendSignals,
  artistSignalScores,
  bannedArtistKeys,
  negativeTracks,
  normalizeSignal,
  type RecoSignal,
} from './signals';
import {
  PEN_BAD,
  versionPenalty,
  durationPenalty,
  isBadVersionTitle,
} from './version-filter';

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat';
/** prompt 里点名的主干艺人条数（口味档案 anchors 的口径，见 taste-profile）。 */
const TOP_ARTISTS_HINT = TASTE_ANCHOR_COUNT;
/** 挑选模式下口味采样的行数——候选清单已经承担了"具体歌"的职责，采样节选
 *  只用来交代口味轮廓，没必要把 150 行全塞进去。 */
const SELECT_PROMPT_SAMPLE = 40;
/** 挑选模式下 prompt 里列出多少条候选。池子可以更大（供补位），但**送进
 *  prompt 的行数**直接决定输入 token 与首字延迟——40 条足够挑 10 首。 */
const SELECT_PROMPT_CANDIDATES = 40;
/** 挑选模式向模型要的条数倍数：候选池已确认可播，损耗小，略超一点即可。 */
const SELECT_OVERASK = 1.5;
/** 挑选模式的输出上限。挑选结果只是 `{picks:[{id,reason}]}`，几百 token 足够；
 *  不设上限时模型偶尔长篇大论，25s 硬超时就是这么被摸到的。 */
const SELECT_MAX_TOKENS = 900;
/** 自由生成路径的输出上限（要给 20-40 条歌名 + 理由，留宽一些）。 */
const GENERATE_MAX_TOKENS = 1_500;
/** 候选池缓存有效期。同会话内连点「推荐」/ 续播取下一批时直接复用上一次的池
 *  （池子构建是整条链路里最慢的一段：相邻艺人查询 + 十几个艺人搜索）。 */
const POOL_CACHE_TTL_MS = 10 * 60_000;
/** 每轮轮换的"探索艺人"个数（主干之外的中频艺人）。 */
const EXPLORE_ARTIST_COUNT = 2;
/** 同一归一艺人在最终推荐里的上限——防"一位歌手占满整批"。 */
const ARTIST_CAP = 2;
/** 候选池：按艺人搜索时取多少条（越大越可能捞到冷门曲，但每多一条就多一份
 *  解析成本；20 条足够覆盖搜索首屏）。 */
const CANDIDATE_SEARCH_PAGE_SIZE = 10;
/** 每位主干艺人取几个相邻艺人（相邻艺人会各自再触发一次艺人搜索，
 *  2 个是"够有新鲜感"与"别把 QQ/网易云搜爆/别让用户干等"之间的折中）。 */
const RELATED_PER_ANCHOR = 2;
/** 候选池：每个可用平台的 FM / 榜单取几首。 */
const RADIO_PER_PROVIDER = 6;
/** 向模型「超额要」的倍数：dedup + 匹配校验会滤掉一部分，多要一些兜底，
 *  保证最终能凑够 count。上限 40 防 token 爆 / 响应过长。 */
const OVERASK_FACTOR = 2;
const OVERASK_MAX = 40;
/** fillPlatforms 每波并行搜索的额外余量（need + 这个数），补匹配失败的坑。 */
const FILL_WAVE_SLACK = 3;
/** fillPlatforms 单波最大并发搜索数。每个 searchUnified 会并行打 4 个平台，
 *  所以这里压住并发，避免几十个请求同时砸 netease/QQ 触发「操作频繁」限流。 */
const FILL_CONCURRENCY = 6;
/** 每 session「最近推荐过」历史上限——手动连点推荐也据此自动去重复读。 */
const RECO_HISTORY_MAX = 200;
/** DeepSeek chat 补全的硬超时——LLM 偶尔卡很久，25s 后 abort。 */
const RECOMMEND_TIMEOUT_MS = 25_000;

/** 用户填的 key 存哪。 */
const SECRETS_KEY = 'secrets:deepseek';

/** 解析后的推荐条目（先只有 title + artist，等下拿这俩去搜真实平台）。 */
export interface RecoRawItem {
  title: string;
  artist: string;
  reason?: string;
}

/** Reco 响应。 */
export interface RecoResult {
  items: UnifiedSearchItem[];
  model: string;
  runAt: number;
  /** 调试用：模型原始响应，方便排查 prompt 调优。 */
  raw: string;
  /** 本次走的是哪条路径：'select' = 目录锚定候选池里挑（v2 主路径），
   *  'generate' = 回退到自由生成（候选池不足/挑选失败）。 */
  mode: 'select' | 'generate';
  /** 候选池规模（0 = 没建成池）。 */
  candidateCount: number;
  /** 候选池各来源贡献条数（调效果时看哪条路在供血）。 */
  candidateOrigins: Record<string, number>;
  /** 分阶段耗时（毫秒）——用户实测"慢"时用它对账，别猜。 */
  timings: {
    poolMs: number;
    llmMs: number;
    fillMs: number;
    totalMs: number;
    /** 本次候选池是复用缓存还是现构建的。 */
    cachedPool: boolean;
  };
}

interface DeepSeekChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string };
}

@Injectable()
export class RecoService {
  private readonly logger = new Logger(RecoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly sessionService: SessionService,
    private readonly musicService: MusicService,
  ) {}

  // ── Key 管理 ────────────────────────────────────────────

  /**
   * 把用户填的 key 写到 .storage/secrets.json（git-ignored）。
   * 同时 process.env.DEEPSEEK_API_KEY 同步设上，方便当次会话立刻用。
   * ⚠️ 不进任何日志——logger 只记 key 末 4 位。
   */
  setApiKey(apiKey: string): { ok: true; tail: string } {
    if (!apiKey || apiKey.length < 8) {
      throw new BadRequestException('apiKey 太短');
    }
    const tail = apiKey.slice(-4);
    this.storage.set(SECRETS_KEY, { apiKey });
    process.env.DEEPSEEK_API_KEY = apiKey;
    this.logger.log(`DeepSeek key set (tail=${tail})`);
    return { ok: true, tail };
  }

  /** 探测当前是否已设 key（不返回 key 本身）。 */
  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  /** 拿 key。优先 process.env（容器部署用），回退到 storage。 */
  private getApiKey(): string | null {
    const fromEnv = process.env.DEEPSEEK_API_KEY;
    if (fromEnv && fromEnv.length >= 8) return fromEnv;
    const stored = this.storage.get<{ apiKey?: string }>(SECRETS_KEY);
    return stored?.apiKey ?? null;
  }

  // ── 状态查询 ────────────────────────────────────────────

  status(session: Session): { configured: boolean; librarySize: number } {
    const lib = this.musicService.getLibrary(session);
    return { configured: this.isConfigured(), librarySize: lib?.items.length ?? 0 };
  }

  // ── 主体：跑一次推荐 ────────────────────────────────────

  async run(
    session: Session,
    opts: {
      count?: number;
      language?: string;
      mood?: string;
      /** 额外排除的歌（在库排除之外）。auto-continue 用它避免续播复读上一批。 */
      exclude?: Array<{ title: string; artist: string }>;
      /** 以某首歌为种子开推荐（"放点像这首的"）——候选围绕它的艺人展开。 */
      seed?: { title: string; artist: string };
    } = {},
  ): Promise<RecoResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new HttpException(
        'deepseek_key_not_configured',
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    const lib = this.musicService.getLibrary(session);
    if (!lib || lib.items.length === 0) {
      throw new BadRequestException('library_empty：先 POST /music/library/import');
    }

    const count = Math.min(Math.max(opts.count ?? 10, 1), 30);
    const t0 = Date.now();
    const tPoolStart = t0;
    let llmMs = 0;
    let fillMs = 0;

    // #5 排除集合 = 前端传的（auto-continue 队列里的歌）∪ 本 session 最近推荐过
    // 的历史 ∪ **行为负样本**（跳过/踩过的歌）。后者让用户的行为立刻生效，
    // 不用等下一轮 prompt 调优。
    const history = this.loadRecoHistory(session);
    const signals = this.loadSignals(session);
    const negatives = negativeTracks(signals);
    const exclude = this.mergeExclude(opts.exclude, [...history, ...negatives]);
    // P0-b：行为信号（带时间衰减）折进口味档案 + 拉黑被反复跳过的艺人。
    const signalScores = artistSignalScores(signals);
    const bannedArtists = bannedArtistKeys(signalScores);
    // 种子模式本身就是一次强正反馈（用户主动说"我要更多这种"）。
    if (opts.seed?.title && opts.seed?.artist) {
      this.recordSignals(session, [{ ...opts.seed, type: 'seed' }]);
    }

    // 口味档案：主干（anchors）稳定、种子每轮换（P0-a）。见 taste-profile.ts。
    const profile = this.getTasteProfile(
      session,
      lib.items,
      lib.importedAt,
      signals,
      signalScores,
    );

    // 目录锚定候选池（P0-c）：候选只来自真实目录，模型只负责挑选与排序。
    // 这是 v2 的主路径；候选池不够（离线/未登录/搜索全失败）时回退自由生成，
    // 保证"推荐永远能出结果"这条既有契约不被打破。
    const built = await this.buildPool(
      session,
      profile,
      lib.items,
      exclude,
      count,
      opts.seed,
      bannedArtists,
    );
    const pool = built.pool;
    const poolMs = Date.now() - tPoolStart;
    const useSelect = pool.candidates.length >= count;
    // prompt 只列前 N 条（输入 token 直接决定首字延迟）；池子仍是全量，供补位。
    const listed = pool.candidates.slice(0, SELECT_PROMPT_CANDIDATES);
    let rawItems: RecoRawItem[];
    let raw: string;
    let mode: 'select' | 'generate';
    const tLlmStart = Date.now();

    if (useSelect) {
      raw = await this.callDeepSeek(
        apiKey,
        this.buildSelectPrompt(profile, listed, {
          count: Math.min(
            Math.ceil(count * SELECT_OVERASK),
            listed.length,
          ),
          language: opts.language,
          mood: opts.mood,
          exclude,
          seed: opts.seed,
        }),
        { maxTokens: SELECT_MAX_TOKENS },
      );
      // 白名单按**列出的**条数校验：prompt 里没有的下标不该被模型选出来。
      const picks = this.parseSelection(raw, listed.length);
      if (picks.length > 0) {
        rawItems = this.fillFromPool(picks, pool.candidates, count);
        mode = 'select';
      } else {
        // 模型没给出可用挑选（解析失败/越界/拒答）→ 回退自由生成。
        this.logger.warn('reco: 挑选模式未产出可用 picks，回退自由生成');
        const fb = await this.callDeepSeek(
          apiKey,
          this.buildGeneratePrompt(profile, opts, exclude, count),
          { maxTokens: GENERATE_MAX_TOKENS },
        );
        raw = fb;
        rawItems = this.parseRecommendations(fb);
        mode = 'generate';
      }
    } else {
      this.logger.log(
        `reco: 候选池不足（${pool.candidates.length} < ${count}），走自由生成`,
      );
      raw = await this.callDeepSeek(
        apiKey,
        this.buildGeneratePrompt(profile, opts, exclude, count),
        { maxTokens: GENERATE_MAX_TOKENS },
      );
      rawItems = this.parseRecommendations(raw);
      mode = 'generate';
    }
    llmMs = Date.now() - tLlmStart;

    // 2026-08-14 防御性预筛：即便 prompt 写得很清楚，模型仍可能输出 DJ/伴奏/
    // 慢摇这种"二次加工"歌名（实测「推荐 DJ 版晴天」「推荐 XXX 伴奏」）。
    // 在去重 / fill 之前先按 VERSION_BAD 扫一遍，命中即丢——OVERASK_FACTOR=2
    // 的余量足够覆盖。
    const sanitized = this.sanitizeBadVersions(rawItems);
    if (sanitized.length < rawItems.length) {
      this.logger.log(
        `reco: 预筛丢弃 ${rawItems.length - sanitized.length} 条「坏版本」标题`,
      );
    }
    const deduped = this.dedupAgainstLibrary(sanitized, lib.items, exclude);
    // 多样性：同一位归一艺人最多 ARTIST_CAP 首（候选池本身已限量，这里是
    // 自由生成路径的兜底——两轮都防"一位歌手占满整批"）。
    const diversified = this.applyArtistCap(deduped, ARTIST_CAP);
    if (diversified.length < deduped.length) {
      this.logger.log(
        `reco: 多样性限制丢弃 ${deduped.length - diversified.length} 条同艺人超额`,
      );
    }
    const tFillStart = Date.now();
    const filled = await this.fillPlatforms(session, diversified, count);
    fillMs = Date.now() - tFillStart;

    // #5 记录本次真正产出的歌进历史（用平台侧规范名；normalizeKey 足够模糊，
    // 下次能和模型的命名对上），供后续 run 去重。
    if (filled.length) {
      this.saveRecoHistory(session, [
        ...history,
        ...filled.map((it) => ({ title: it.title, artist: it.artist })),
      ]);
    }

    const timings = {
      poolMs,
      llmMs,
      fillMs,
      totalMs: Date.now() - t0,
      cachedPool: built.cached,
    };
    this.logger.log(
      `reco: 完成 mode=${mode} 候选池=${pool.candidates.length}${
        built.cached ? '(缓存)' : ''
      } 产出=${filled.length}/${count} | ` +
        `池 ${timings.poolMs}ms / LLM ${timings.llmMs}ms / 填源 ${timings.fillMs}ms` +
        ` / 合计 ${timings.totalMs}ms`,
    );

    return {
      items: filled,
      model: DEEPSEEK_MODEL,
      runAt: Date.now(),
      raw: raw.slice(0, 4000), // 截断防爆
      mode,
      candidateCount: pool.candidates.length,
      candidateOrigins: pool.byOrigin,
      timings,
    };
  }

  // ── prompt 拼装 ─────────────────────────────────────────

  private buildPrompt(
    library: UnifiedSearchItem[],
    opts: {
      count: number;
      language?: string;
      mood?: string;
      exclude?: Array<{ title: string; artist: string }>;
      topArtists?: string[];
    },
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const libList = library
      .map(
        (it, i) =>
          `${i + 1}. ${it.title} - ${it.artist}` +
          (it.album ? ` (${it.album})` : ''),
      )
      .join('\n');

    // #6 更强的规则：正名/原文歌手/排除翻唱·live·remix·伴奏，降低 fill 阶段
    // 搜到错版本 / 搜不到的概率。
    //
    // 2026-08-14 加严「正经歌曲」门槛：实测模型常推 DJ/慢摇/抖音切片
    // （甚至非歌曲如 BGM/广告），原因是规则散在 system 笼统一句话，没有具体
    // 「不要什么」清单 + duration 提示。补：
    //  - 显式 do/don't 列表（不要 DJ/remix/伴奏/慢摇/抖音/翻唱/纯音乐/BGM/广告）
    //  - 时长硬要求（90-360s 主流流行区间，超出 = 必是 live 现场/长版/慢摇）
    //  - 「原文名」具体化：日文用汉字/假名原文，英文大小写按发行专辑，
    //    拉丁字符不要意译/拼音化
    //  - 加几条具体正/反例，让模型更贴指令
    const system = `你是一个资深音乐推荐助手。用户给你他喜欢的 ${library.length} 首歌（口味采样），
请据此推荐 ${opts.count} 首他**尚未听过**、**风格/氛围相近但有惊喜**的歌曲。

# 必须遵守的硬性规则
1. **严格输出 JSON**，形如 { "items": [ { "title": "歌名", "artist": "歌手", "reason": "一句为什么(简短中文)" } ] }。不要任何解释文字或 markdown 围栏。
2. 只推**真实存在、正式发行、能在 QQ音乐 / 网易云 / Spotify 搜到**的歌。不确定宁可不推（规则 7）。
3. **必须录音室原版**——不要以下任何"二次加工"版本：
   - 不可要：DJ 版 / DJ 加速 / DJ 慢摇 / 慢摇 / 夜店 / club / 抖音版 / 抖音热曲 / remix / 重混 / mashup / bootleg / 翻唱 / cover / 翻自 / 伴奏 / 纯音乐 / 纯享版 / instrumental / karaoke / ktv / 加速 / 减速 / 8-bit / 8D / 3D / slowed / nightcore / 清唱 / a cappella / demo / 钢琴版 / 八音盒版
   - 可要：录音室原版 / studio / 正式版 / album version
4. **不是歌**的不要推：BGM / 广告曲 / 背景音乐 / 纯钢琴独奏 / 影视原声大段配乐 / 节日铃声 / 玩具音乐 / 课本朗读 / 朗诵
5. **时长控制**——主流流行歌时长 90-360 秒（1.5-6 分钟）。除非用户口味档案明显偏好长版/现场，否则：
   - < 90 秒 = 抖音切片/铃声，禁
   - > 360 秒 = 现场录音/long version/Medley，禁
6. **artist 用发行时的官方原文名**（不是译名/拼音/缩写）：
   - 日文歌手用日文原文（米津玄師 不是 "Kenshi Yonezu"、也不是"米津玄师"）
   - 英文歌手按发行专辑写法（"The Weeknd" 不是 "the weeknd"）
   - 中韩歌手用各自官方汉字/原文（"周杰伦" 不是 "Jay Chou"——除非用户库里都是英文名）
7. **title 用官方原名**：不要自己加"（Live）""（Remix）"等后缀（录音室原版没有这些）；不要意译/拼音化（如 "Lemon" 不要写成"柠檬"，"夜に駆ける"不要写成"夜驾"）。
8. **不要库里已有的**（下面的口味库）；**不要和本次结果内重复**。
9. **不要编造**——拿不准的歌手/歌名宁可少推也不要硬凑。

# 风格锚点
- 风格相近 + 有惊喜：不是同质化刷同一歌手，可以跨语言/跨年代/跨子流派，但核心氛围要"在用户舒适圈内又给点新东西"。
- 不确定怎么选就推**该歌手最知名、最广为发行的录音室单曲**——比推冷门靠谱。

# 输出格式
{ "items": [ { "title": "...", "artist": "...", "reason": "..." } ] }
只输出这一个 JSON 对象。`;

    const lang = opts.language && opts.language !== 'auto'
      ? `语言偏好：${opts.language === 'zh' ? '中文' : opts.language === 'en' ? '英文' : opts.language === 'ja' ? '日文' : opts.language}`
      : '语言不限';
    const mood = opts.mood ? `当前心情：${opts.mood}` : '';
    // #6 高频歌手锚点：明确点名用户最常听的歌手，让「风格相近」更贴脸。
    const anchor =
      opts.topArtists && opts.topArtists.length
        ? `\n我最常听的歌手：${opts.topArtists.join('、')}（可推荐他们的其它歌或相近风格的其他歌手）`
        : '';
    // auto-continue / 历史：把最近已推荐过的歌喂给模型，明确要求避开，提升新
    // 批次的产出率（否则 temperature 再高也可能重复，被后置 dedup 滤成不足 count）。
    const avoid =
      opts.exclude && opts.exclude.length
        ? `\n\n以下歌曲最近已经推荐过，请**不要再推荐**：\n${opts.exclude
            .slice(-50)
            .map((e) => `- ${e.title} - ${e.artist}`)
            .join('\n')}`
        : '';
    const user = `我的口味库（采样）：\n${libList}${anchor}\n\n${lang}\n${mood}${avoid}\n\n请按 JSON 数组输出 ${opts.count} 首推荐。`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  // ── P0-a 口味档案 ───────────────────────────────────────

  /** 口味主干缓存（per session）。主干是**确定性**的：同一份库 → 同一组 anchors，
   *  只有库签名（规模 + 导入时间）变了才重算。种子每轮重采，不进缓存。 */
  private readonly tasteProfileCache = new Map<string, TasteProfileCore>();

  /**
   * 取本次 run 的口味档案：缓存的主干 + 本轮新采的种子。
   *
   * 这是 v2 修"第三次推荐就不像我"的关键——v1.1 每轮把口味锚点重新随机，这里
   * 让锚点稳定、只让种子轮换。
   */
  private getTasteProfile(
    session: Session,
    items: UnifiedSearchItem[],
    importedAt?: number,
    signals: RecoSignal[] = [],
    signalScores?: Map<string, number>,
  ): TasteProfile {
    // 签名 = 库规模/导入时间 + 信号指纹（信号变了 → 口味主干要重算；但只按
    // "条数 + 最后一条时间"取指纹，避免每播放一首就全量重算）。
    const lastSignal = signals[signals.length - 1];
    const signature = `${librarySignature(items, importedAt)}|sig:${signals.length}:${lastSignal?.at ?? 0}`;
    let core = this.tasteProfileCache.get(session.id);
    if (!core || core.signature !== signature) {
      core = buildProfileCore(items, {
        importedAt,
        anchorCount: TOP_ARTISTS_HINT,
        signalScores,
      });
      // 缓存里的 signature 换成指纹口径（buildProfileCore 只认库签名）。
      core = { ...core, signature };
      this.tasteProfileCache.set(session.id, core);
      this.logger.log(
        `reco: 口味主干重建（库 ${core.size} 首 / ${core.artists.length} 位艺人），` +
          `主干：${core.anchors.slice(0, 4).join('、') || '（空）'}` +
          `（信号 ${signals.length} 条）`,
      );
    }
    const seeds = pickTasteSeeds(items, core.artists, {
      count: TASTE_SEED_COUNT,
      exploreRatio: TASTE_EXPLORE_RATIO,
    });
    return { ...core, seeds };
  }

  // ── P0-b 行为信号 ───────────────────────────────────────

  private signalsKey(sessionId: string): string {
    return `reco:signals:${sessionId}`;
  }

  /** 读本 session 的行为信号历史（跳过/完播/红心/踩…）。 */
  private loadSignals(session: Session): RecoSignal[] {
    const raw = this.storage.get<RecoSignal[]>(this.signalsKey(session.id));
    return Array.isArray(raw) ? raw : [];
  }

  /**
   * 收录行为信号（宽松清洗 + 30s 防抖 + 上限淘汰）。数据只落本机
   * `.storage`，不上传。
   */
  recordSignals(session: Session, incoming: unknown[]): { ok: true; stored: number } {
    const now = Date.now();
    const parsed = incoming
      .map((s) => normalizeSignal(s, now))
      .filter((s): s is RecoSignal => s !== null);
    if (!parsed.length) return { ok: true, stored: 0 };
    const merged = appendSignals(this.loadSignals(session), parsed);
    this.storage.set(this.signalsKey(session.id), merged);
    return { ok: true, stored: merged.length };
  }

  // ── P0-c 候选池 ─────────────────────────────────────────

  /**
   * 构建目录锚定候选池。三条来源（主干深挖 / 相邻艺人 / 平台 FM）都是
   * **fail-soft**：单条来源挂掉只是少一批候选，池子太小则由 run() 回退自由生成。
   *
   * 池子按 `(session, 库签名, 主干艺人)` 缓存 10 分钟：构建池是整条链路最慢的
   * 一段（相邻艺人查询 + 十几个艺人搜索），而"连点推荐""续播取下一批"在几十秒
   * 内会反复走这条路。排除集变化（续播时前端会带上已推荐清单）就地过滤缓存，
   * 过滤后不够用了才真正重建。
   */
  private readonly poolCache = new Map<
    string,
    { at: number; pool: CandidatePoolResult }
  >();

  /** 用当前 exclude 过滤缓存池（池子本身不含 exclude 语义）。 */
  private filterPoolByExclude(
    pool: CandidatePoolResult,
    exclude: Array<{ title: string; artist: string }>,
  ): CandidatePoolResult {
    if (!exclude.length) return pool;
    const keys = new Set(exclude.map((e) => normalizeKey(e.title, e.artist)));
    const candidates = pool.candidates.filter(
      (c) => !keys.has(normalizeKey(c.title, c.artist)),
    );
    const byOrigin: Record<string, number> = {
      artist: 0,
      'related-artist': 0,
      radio: 0,
    };
    for (const c of candidates) byOrigin[c.origin]++;
    return { candidates, byOrigin, dropped: pool.dropped };
  }

  private async buildPool(
    session: Session,
    profile: TasteProfile,
    library: UnifiedSearchItem[],
    exclude: Array<{ title: string; artist: string }>,
    count: number,
    seed?: { title: string; artist: string },
    bannedArtists?: Set<string>,
  ): Promise<{ pool: CandidatePoolResult; cached: boolean }> {
    // 种子模式（"像这首一样"）下候选围绕种子的艺人展开：主干换成这一位、
    // 相邻艺人也围绕它扩，探索艺人不参与——用户要的是"更多这种"，不是"换口味"。
    const seedArtist = seed?.artist?.trim();
    const anchors = seedArtist ? [seedArtist] : profile.anchors;
    const exploreCandidates = seedArtist ? [] : profile.anchors;
    // 缓存 key 刻意**不含信号指纹**：口味档案的 signature 里带了信号条数，
    // 而每播一首歌就会新增一条 play 信号——若把它算进 key，用户边听边点推荐时
    // 缓存永远命中不了，L4 的收益直接归零。真正影响候选池的是"主干是谁"和
    // "库多大"，所以 key 用 (session, 库规模, 主干艺人)。
    const cacheKey = `${session.id}|${profile.size}|${anchors.join('|')}`;
    const hit = this.poolCache.get(cacheKey);
    if (hit && Date.now() - hit.at < POOL_CACHE_TTL_MS) {
      const filtered = this.filterPoolByExclude(hit.pool, exclude);
      if (filtered.candidates.length >= count) {
        this.logger.log(
          `reco: 候选池命中缓存（${filtered.candidates.length} 首可用，省掉重建）`,
        );
        return { pool: filtered, cached: true };
      }
    }

    const exploreArtists = seedArtist
      ? []
      : pickExploreArtists(
          profile.artists,
          exploreCandidates,
          EXPLORE_ARTIST_COUNT,
        );
    // 被信号拉黑的艺人 / 种子歌自身：不进候选（种子歌本身用户已经在听）。
    const poolExclude = seed
      ? [...exclude, { title: seed.title, artist: seed.artist }]
      : exclude;
    const deps = {
      searchArtist: (artist: string) =>
        this.musicService
          .searchUnified(session, artist, 1, CANDIDATE_SEARCH_PAGE_SIZE)
          .then((r) => r.items)
          .catch((err: unknown) => {
            this.logger.warn(
              `reco candidate search "${artist}" failed: ${(err as Error)?.message}`,
            );
            return [] as UnifiedSearchItem[];
          }),
      findRelatedArtists: (artist: string) =>
        this.musicService.findRelatedArtists(session, artist, RELATED_PER_ANCHOR),
      fetchRadio: () =>
        this.musicService.fetchRecoRadioCandidates(session, RADIO_PER_PROVIDER),
    };

    try {
      const pool = await buildCandidatePool(deps, {
        anchors,
        exploreArtists,
        library,
        exclude: poolExclude,
        relatedPerAnchor: RELATED_PER_ANCHOR,
        bannedArtists: bannedArtists ? [...bannedArtists] : undefined,
        // 种子模式：只围绕这一位艺人扩相邻，别把口味主干也拉进来搅局。
        neighborAnchorLimit: seedArtist ? 1 : undefined,
      });
      this.logger.log(
        `reco: 候选池 ${pool.candidates.length} 首` +
          `（深挖 ${pool.byOrigin.artist} / 相邻 ${pool.byOrigin['related-artist']} / 电台 ${pool.byOrigin.radio}）`,
      );
      // 顺手清掉过期条目，避免 map 无限增长（会话少但会长跑）。
      for (const [k, v] of this.poolCache) {
        if (Date.now() - v.at >= POOL_CACHE_TTL_MS) this.poolCache.delete(k);
      }
      this.poolCache.set(cacheKey, { at: Date.now(), pool });
      return { pool, cached: false };
    } catch (err) {
      // 理论上 buildCandidatePool 自己已经兜住了大部分失败；这里再兜一层，
      // 保证候选池的任何意外都不会让"推荐"整体失败。
      this.logger.warn(
        `reco: 候选池构建失败，回退自由生成：${(err as Error)?.message}`,
      );
      return {
        pool: {
          candidates: [],
          byOrigin: { artist: 0, 'related-artist': 0, radio: 0 },
          dropped: {
            inLibrary: 0,
            badVersion: 0,
            duration: 0,
            duplicate: 0,
            overCap: 0,
          },
        },
        cached: false,
      };
    }
  }

  /**
   * 挑选模式 prompt：模型面对的是**真实候选清单**，只负责挑与排序。比自由生成
   * 的 prompt 短很多——"别编造/别推 DJ 版/注意时长"那一整套已经由候选池与填源
   * 阶段的确定性代码做掉了，模型注意力留给口味判断。
   */
  private buildSelectPrompt(
    profile: TasteProfile,
    candidates: RecoCandidate[],
    opts: {
      count: number;
      language?: string;
      mood?: string;
      exclude?: Array<{ title: string; artist: string }>;
      seed?: { title: string; artist: string };
    },
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const system = [
      '你是资深音乐策展人。下面给你一份候选清单——全部来自真实曲库、已确认可播。',
      `请你从中挑选 ${opts.count} 首推荐给这位用户，并给每首一句简短中文理由。`,
      '',
      '# 输出格式（只输出这一个 JSON，不要任何解释或 markdown 围栏）',
      '{ "picks": [ { "id": 3, "reason": "为什么他会喜欢这首" } ] }',
      '',
      '# 规则',
      '1. id 必须是候选清单里方括号内的编号——只能从清单里挑，不要新增清单外的歌；',
      '   也不要改写歌名/歌手（系统会按 id 取原始条目）。',
      '2. 口味优先：挑"贴着档案里的偏好、但他还没听过"的；整批要跨歌手，同一歌手最多挑 1 首。',
      '3. 兼顾惊喜：可以少量跨语种/跨年代，但核心氛围要在他的舒适圈内。',
      '4. 跳过 live / 翻唱 / DJ / 伴奏 / 纯音乐等非录音室版本（清单里若混进这类，直接不挑）。',
      '5. 宁愿少挑也不要凑数；同一位歌手、同一张专辑不要重复挑。',
    ].join('\n');

    const anchorLine = profile.anchors.length
      ? `最常听的歌手：${profile.anchors.join('、')}`
      : '';
    const sample = profile.seeds
      .slice(0, SELECT_PROMPT_SAMPLE)
      .map((it) => `${it.title} - ${it.artist}`)
      .join('\n');
    // 只列前 SELECT_PROMPT_CANDIDATES 条：输入 token 直接决定首字延迟，40 条
    // 足够挑 10 首；池子里剩下的条目仍然参与后面的"补位"。
    const list = candidates
      .slice(0, SELECT_PROMPT_CANDIDATES)
      .map(
        (c, i) =>
          `[${i}] ${c.title} - ${c.artist}${c.album ? ` (${c.album})` : ''}`,
      )
      .join('\n');
    const lang =
      opts.language && opts.language !== 'auto'
        ? `语言偏好：${
            opts.language === 'zh'
              ? '中文'
              : opts.language === 'en'
                ? '英文'
                : opts.language === 'ja'
                  ? '日文'
                  : opts.language
          }`
        : '语言不限';
    const mood = opts.mood ? `当前心情：${opts.mood}` : '';
    const avoid =
      opts.exclude && opts.exclude.length
        ? `\n最近已经推荐过，请**不要再推荐**：\n${opts.exclude
            .slice(-50)
            .map((e) => `- ${e.title} - ${e.artist}`)
            .join('\n')}`
        : '';
    // 种子模式：用户是"以这首歌为中心"点的推荐——把他要的那首放在最前面说，
    // 并要求候选与它同气质（而不是泛泛地贴口味档案）。
    const seedLine = opts.seed
      ? `\n# 本次特别要求\n用户正在听《${opts.seed.title}》- ${opts.seed.artist}，想要**更多像这首一样**的歌：候选清单里凡是与它气质/编排/语种接近的，优先挑；不要求覆盖整个口味档案。`
      : '';
    const user = `# 口味档案
库里共 ${profile.size} 首。${anchorLine}
口味采样（节选，仅供判断风格）：
${sample}

${lang}
${mood}${seedLine}${avoid}

# 候选清单（只能从这里面挑）
${list}

请输出 JSON：{ "picks": [ { "id": 编号, "reason": "理由" } ] }`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  /** 自由生成 prompt 的统一入口（含 v1.1 的超额要逻辑）。 */
  private buildGeneratePrompt(
    profile: TasteProfile,
    opts: { language?: string; mood?: string },
    exclude: Array<{ title: string; artist: string }>,
    count: number,
  ): Array<{ role: 'system' | 'user'; content: string }> {
    // #4 超额要：dedup + 匹配校验会滤掉一部分，多要一些，最后 fill 到 count 为止。
    const askCount = Math.min(count * OVERASK_FACTOR, OVERASK_MAX);
    return this.buildPrompt(profile.seeds, {
      count: askCount,
      language: opts.language,
      mood: opts.mood,
      exclude,
      topArtists: profile.anchors,
    });
  }

  /**
   * 解析挑选结果：`{ "picks": [ { "id": 3, "reason": "…" } ] }`（也容忍裸数组与
   * `items` / `recommendations` 等近义字段）。
   *
   * **白名单校验**：id 必须落在候选池下标内、整数、不重复——越界/幻觉 id 一律丢。
   * 这是"消灭幻觉推荐"的最后一道闸门：模型给的是下标，取的是候选池里的真实条目。
   */
  private parseSelection(
    raw: string,
    poolSize: number,
  ): Array<{ id: number; reason: string }> {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const fence = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
      if (fence) {
        try {
          parsed = JSON.parse(fence[1]);
        } catch {
          parsed = null;
        }
      }
    }
    if (parsed == null) {
      this.logger.warn(`reco: 挑选结果解析失败，raw: ${raw.slice(0, 200)}`);
      return [];
    }
    let arr: unknown = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      arr =
        obj.picks ??
        obj.items ??
        obj.recommendations ??
        obj.songs ??
        obj.tracks ??
        obj.data;
    }
    if (!Array.isArray(arr)) {
      this.logger.warn('reco: 挑选结果不是数组');
      return [];
    }

    const seen = new Set<number>();
    const out: Array<{ id: number; reason: string }> = [];
    for (const entry of arr as unknown[]) {
      let id: number | undefined;
      let reason = '';
      if (typeof entry === 'number') {
        id = entry;
      } else if (typeof entry === 'string' && /^\d+$/.test(entry.trim())) {
        id = Number(entry.trim());
      } else if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        const rawId = o.id ?? o.index ?? o.idx ?? o.pick ?? o.number;
        if (typeof rawId === 'number') id = rawId;
        else if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) {
          id = Number(rawId.trim());
        }
        reason = typeof o.reason === 'string' ? o.reason : '';
      }
      if (id === undefined || !Number.isInteger(id) || id < 0 || id >= poolSize) {
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, reason });
    }
    return out;
  }

  /**
   * 把 picks 翻成推荐条目：先按模型排序取，**不够就按候选池既定顺序补位**
   * （主干深挖在前）——补位不再烧一次 LLM 调用，也不给模型"凑数"的机会。
   * 目标条数是超额要口径，给下游填源留容错余量。
   */
  private fillFromPool(
    picks: Array<{ id: number; reason: string }>,
    candidates: RecoCandidate[],
    count: number,
  ): RecoRawItem[] {
    const target = Math.min(
      count * OVERASK_FACTOR,
      OVERASK_MAX,
      candidates.length,
    );
    const used = new Set<number>();
    const out: RecoRawItem[] = [];
    for (const p of picks) {
      if (used.has(p.id) || out.length >= target) continue;
      const c = candidates[p.id];
      if (!c) continue;
      used.add(p.id);
      out.push({ title: c.title, artist: c.artist, reason: p.reason });
    }
    for (let i = 0; i < candidates.length && out.length < target; i++) {
      if (used.has(i)) continue;
      used.add(i);
      out.push({ title: candidates[i].title, artist: candidates[i].artist });
    }
    return out;
  }

  /** 同一位归一艺人最多 cap 首（超出的按出现顺序丢弃）。 */
  private applyArtistCap(items: RecoRawItem[], cap: number): RecoRawItem[] {
    const used = new Map<string, number>();
    const out: RecoRawItem[] = [];
    for (const it of items) {
      const key = normalizeKey(it.artist ?? '', '');
      const n = used.get(key) ?? 0;
      if (n >= cap) continue;
      used.set(key, n + 1);
      out.push(it);
    }
    return out;
  }

  // ── DeepSeek 调用 ───────────────────────────────────────

  private async callDeepSeek(
    apiKey: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    opts: { maxTokens?: number } = {},
  ): Promise<string> {
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RECOMMEND_TIMEOUT_MS);
      try {
        res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages,
            // 2026-08-14 从 0.9 降到 0.7：实测 0.9 太发散，常出 DJ/慢摇/凑数歌。
            // 0.7 保留"有惊喜"但更贴指令；后续如要更发散可再升。
            temperature: 0.7,
            response_format: { type: 'json_object' },
            // 2026-09-20 加输出上限：不封顶时模型偶尔长篇大论，25s 硬超时就是这么
            // 被摸到的。挑选/生成两条路径各自的合理上限由调用方给。
            ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          }),
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.logger.error(`deepseek fetch failed: ${(err as Error).message}`);
      throw new HttpException(
        'deepseek_unreachable',
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (res.status === 429) {
      // 之前抛的是普通 Error（非 HttpException），NestJS 默认过滤器会把它
      // 变成 500——客户端拿不到真正的 429，也丢了 Retry-After。改抛 429。
      const ra = Number(res.headers.get('retry-after'));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'deepseek_rate_limit',
          message: 'DeepSeek 频率限制，请稍后重试',
          retryAfterSec: Number.isFinite(ra) ? ra : undefined,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (res.status >= 500) {
      this.logger.error(`deepseek 5xx: ${res.status}`);
      throw new HttpException('deepseek_upstream_5xx', HttpStatus.BAD_GATEWAY);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`deepseek ${res.status}: ${text.slice(0, 200)}`);
      throw new HttpException(
        `deepseek_${res.status}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await res.json()) as DeepSeekChatResponse;
    if (data.error?.message) {
      this.logger.error(`deepseek error: ${data.error.message}`);
      throw new HttpException(
        `deepseek_error: ${data.error.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return data.choices?.[0]?.message?.content ?? '';
  }

  // ── 响应解析（带 retry: 围栏 / 整体 JSON 两种） ─────────

  private parseRecommendations(raw: string): RecoRawItem[] {
    // strategy 1: 整体就是 JSON
    try {
      const parsed = JSON.parse(raw);
      return this.extractArray(parsed);
    } catch {
      // fall through
    }
    // strategy 2: ```json ... ``` 围栏
    const fence = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
    if (fence) {
      try {
        return this.extractArray(JSON.parse(fence[1]));
      } catch {
        // fall through
      }
    }
    // 之前还有 strategy 3（找首个 [ ... ] 块）——它会被模型输出里的任何
    // 方括号噪声污染（explanations / 引用标记 / 多段输出），slice 出来
    // 不是合法 JSON 时直接抛，对 retry 没帮助。删掉。
    this.logger.warn(`recommend parse failed, raw: ${raw.slice(0, 200)}`);
    throw new BadRequestException('recommend_parse_failed: 模型响应无法解析');
  }

  /** 把可能的 { items: [...] } / 直接 [...] / 单个 object 都规整成数组。 */
  private extractArray(parsed: unknown): RecoRawItem[] {
    if (Array.isArray(parsed)) return parsed as RecoRawItem[];
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of ['items', 'recommendations', 'songs', 'tracks', 'data']) {
        if (Array.isArray(obj[key])) return obj[key] as RecoRawItem[];
      }
    }
    throw new Error('not an array');
  }

  // ── 推荐去重：和库 + 自己内部 ───────────────────────────

  /**
   * 2026-08-14 新增：模型输出侧的"坏版本"预筛。复用搜索侧同一份
   * `VERSION_BAD` 关键词表，命中即丢——不再浪费一次 search 才知道这歌是
   * DJ 伴奏。注意：与 `searchAndMatch` 里的 `waived` 不同，这里
   * **不豁免**模型自己点名要坏版本（DJ/慢摇 伴奏/翻唱本身就不该被推荐，
   * 模型点错了也按错处理）——搜索侧的 waived 仍然在，那是为了应付「用户
   * 真想听 Remix」的合法路径。
   */
  private sanitizeBadVersions(items: RecoRawItem[]): RecoRawItem[] {
    return items.filter((r) => {
      if (!r.title || !r.artist) return false;
      if (isBadVersionTitle(r.title)) return false;
      return true;
    });
  }

  private dedupAgainstLibrary(
    raw: RecoRawItem[],
    library: UnifiedSearchItem[],
    exclude?: Array<{ title: string; artist: string }>,
  ): RecoRawItem[] {
    // #7 统一复用 search.util 的 normalizeKey（含全角→半角），和搜索/匹配同口径，
    // 堵住全角/半角变体漏去重（之前 dedup 用的是另一套简化归一）。
    const seen = new Set<string>();
    for (const it of library) seen.add(normalizeKey(it.title, it.artist));
    // auto-continue / 历史：把已推荐过的也当作"库"排除，避免续播/连点复读。
    for (const it of exclude ?? []) seen.add(normalizeKey(it.title, it.artist));
    const result: RecoRawItem[] = [];
    for (const r of raw) {
      if (!r.title || !r.artist) continue;
      const k = normalizeKey(r.title, r.artist);
      if (seen.has(k)) continue;
      seen.add(k);
      result.push(r);
    }
    return result;
  }

  /** 合并前端 exclude（auto-continue 队列）与 session 历史，去重成一个列表。 */
  private mergeExclude(
    front: Array<{ title: string; artist: string }> | undefined,
    history: Array<{ title: string; artist: string }>,
  ): Array<{ title: string; artist: string }> {
    const seen = new Set<string>();
    const out: Array<{ title: string; artist: string }> = [];
    for (const e of [...history, ...(front ?? [])]) {
      if (!e?.title || !e?.artist) continue;
      const k = normalizeKey(e.title, e.artist);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ title: e.title, artist: e.artist });
    }
    return out;
  }

  // ── 最近推荐历史（每 session，手动连点也据此去重复读）─────
  private historyKey(sessionId: string): string {
    return `reco:history:${sessionId}`;
  }

  private loadRecoHistory(
    session: Session,
  ): Array<{ title: string; artist: string }> {
    const h = this.storage.get<Array<{ title: string; artist: string }>>(
      this.historyKey(session.id),
    );
    return Array.isArray(h) ? h : [];
  }

  private saveRecoHistory(
    session: Session,
    items: Array<{ title: string; artist: string }>,
  ): void {
    // 保留最近 RECO_HISTORY_MAX 首（按加入顺序，旧的先淘汰）。
    this.storage.set(
      this.historyKey(session.id),
      items.slice(-RECO_HISTORY_MAX),
    );
  }

  // ── 拿推荐 → 走 P0 统一搜索填实平台 ────────────────────

  /**
   * 把模型推荐的「歌名+歌手」逐条走统一搜索，回填成可播放的 UnifiedSearchItem。
   *
   * #2 并行 + #4 补位：一波并行搜 `need + slack` 条（need=还差几首），命中的按
   * **原始顺序**收下；不够就用下一波候选补，直到凑够 wantCount 或候选用尽。这
   * 比原来的串行 for-await 快得多（总耗时从 Σ 降到 max），且不足时会自动往后取。
   *
   * #1 匹配校验：不再无脑取 items[0]——在候选里找**真的等于推荐那首**的
   * （先精确 normalizeKey 相等，再退化到歌名+歌手双向包含），都不匹配就丢弃，
   * 避免把同名翻唱 / live / 纯音乐 / 甚至完全不相关的首条当成推荐塞进队列。
   */
  private async fillPlatforms(
    session: Session,
    items: RecoRawItem[],
    wantCount: number,
  ): Promise<UnifiedSearchItem[]> {
    const out: UnifiedSearchItem[] = [];
    let cursor = 0;
    while (out.length < wantCount && cursor < items.length) {
      const need = wantCount - out.length;
      // 多搜一点余量补掉匹配失败/搜空的坑；但压在并发上限内，别一次砸太多。
      const waveSize = Math.min(
        items.length - cursor,
        need + FILL_WAVE_SLACK,
        FILL_CONCURRENCY,
      );
      const wave = items.slice(cursor, cursor + waveSize);
      cursor += waveSize;
      // Promise.all 保序 → 命中按推荐原始顺序进 out。
      const matched = await Promise.all(
        wave.map((r) => this.searchAndMatch(session, r)),
      );
      for (const m of matched) {
        if (m && out.length < wantCount) out.push(m);
      }
    }
    return out;
  }

  /** 版本纯净度惩罚——判据在 `version-filter.ts`，与候选池共用同一份口径。
   *  只扫 title（不扫 artist），避免误伤 "DJ Okawari" 这类合法艺人名。 */
  private versionPenalty(title: string): number {
    return versionPenalty(title);
  }

  /** 时长合理性惩罚（<60s / >600s 硬丢；60-90s / 360-600s 强惩罚）——
   *  同样来自 `version-filter.ts`。 */
  private durationPenalty(duration: number, recTitle: string): number {
    return durationPenalty(duration, recTitle);
  }

  /**
   * 单条推荐：统一搜索 → 在匹配上的候选里**挑最"正常"的版本**，命中返回带
   * reason 的 UnifiedSearchItem，否则返回 null（搜不到 / 无匹配 / 只有坏版本 →
   * 交给上层补位换一首）。
   *
   * 挑选打分（升序取最小）：
   *  1. 版本惩罚（录音室 0 < live 10 << DJ/remix/伴奏 100）——修「晴天搜出 DJ 版」；
   *  2. 非精确匹配排后（歌名+歌手完全一致优先）；
   *  3. 归一标题更短优先（越接近原名，变体后缀越少）。
   * 若最优仍是"坏版本"（≥PEN_BAD）且用户没点名要 → 返回 null（"没人想听 DJ 版"，
   * 宁可让上层补位换一首正常的歌）。用户 rec 自己点名了版本（remix/live…）则豁免。
   */
  private async searchAndMatch(
    session: Session,
    r: RecoRawItem,
  ): Promise<UnifiedSearchItem | null> {
    const q = `${r.title} ${r.artist}`;
    try {
      // 多取一些候选（15），才有机会在一堆 DJ/加速版里捞到录音室原版。
      const res = await this.musicService.searchUnified(session, q, 1, 15);
      const wantKey = normalizeKey(r.title, r.artist);
      // 只保留能播（有 bestSource）且确实是这首歌的候选。
      const candidates = res.items.filter(
        (it) =>
          it.bestSource &&
          (normalizeKey(it.title, it.artist) === wantKey ||
            this.looseMatch(r, it)),
      );
      if (!candidates.length) return null;
      // 用户/模型自己就点名要某版本（rec.title 里带 remix/live…）→ 不惩罚版本。
      const waived = this.versionPenalty(r.title) > 0;
      const scored = candidates
        .map((it) => ({
          it,
          // 2026-08-14 把 duration 惩罚也合进来：实测同名不同版本常以
          // "10 分钟 live 全场"形态被搜索出来（normalizeKey 相等、title
          // 双向包含都过得了 looseMatch）——只有靠时长把它扣下。
          pen:
            (waived ? 0 : this.versionPenalty(it.title)) +
            this.durationPenalty(it.duration, r.title),
          notExact: normalizeKey(it.title, it.artist) === wantKey ? 0 : 1,
          len: normalizeKey(it.title, '').length,
        }))
        .sort(
          (a, b) => a.pen - b.pen || a.notExact - b.notExact || a.len - b.len,
        );
      const best = scored[0];
      // 最优仍是坏版本（DJ/remix/伴奏…）或时长离谱且没被豁免 → 丢弃，
      // 换一首正常歌。PEN_BAD 阈值同时覆盖 VERSION_BAD 和 DURATION_BAD。
      if (best.pen >= PEN_BAD) return null;
      // 封面兜底（AI 推荐易缺封面）：① 合并时已跨源抽取（search.util）；
      // ② 候选里其他版本有封面就用；③ 仍无 → 跨平台探测 + 缓存。
      let cover = best.it.coverUrl;
      if (!cover) {
        cover = candidates.find((c) => c.coverUrl)?.coverUrl ?? '';
      }
      if (!cover) {
        cover = await this.fetchCoverCached(session, r);
      }
      return {
        ...best.it,
        ...(cover ? { coverUrl: cover } : {}),
        // reason 塞进 album 字段是 hack，UI 在 source 描述里看。
        album: r.reason ? `${best.it.album} · ${r.reason}` : best.it.album,
      };
    } catch (err) {
      this.logger.warn(`reco fill failed for "${q}": ${(err as Error).message}`);
      return null;
    }
  }

  /** 封面探测缓存：normalizeKey → coverUrl（上限 300，防膨胀）。 */
  private coverCache = new Map<string, string>();

  /**
   * 无封面时跨平台抽取：调 MusicService.fetchCoverFallback（各平台并行探测，
   * 取首个有封面的 track），按 normalizeKey 缓存避免翻页重复请求。
   */
  private async fetchCoverCached(session: Session, r: RecoRawItem): Promise<string> {
    const key = normalizeKey(r.title, r.artist);
    const hit = this.coverCache.get(key);
    if (hit !== undefined) return hit;
    let cover = '';
    try {
      cover = await this.musicService.fetchCoverFallback(
        session,
        `${r.title} ${r.artist}`,
      );
    } catch (err) {
      this.logger.warn(`cover fallback failed for "${r.title}": ${(err as Error).message}`);
    }
    if (this.coverCache.size > 300) this.coverCache.clear();
    this.coverCache.set(key, cover);
    return cover;
  }

  /** 宽松匹配：歌名双向包含（"感電" vs "感電 (…)"）+ 歌手双向包含（放宽 feat/
   *  合唱差异；歌名已是主锚）。用于精确归一不相等时的兜底，拦掉不相关首条。 */
  private looseMatch(r: RecoRawItem, item: UnifiedSearchItem): boolean {
    const rt = normalizeKey(r.title, '');
    const it = normalizeKey(item.title, '');
    if (!rt || !it) return false;
    const titleOk = it.includes(rt) || rt.includes(it);
    if (!titleOk) return false;
    const ra = normalizeKey(r.artist, '');
    const ia = normalizeKey(item.artist, '');
    // 歌手任一为空 → 只认歌名；否则要求双向包含（拦掉别人翻唱的同名歌）。
    return !ra || !ia || ia.includes(ra) || ra.includes(ia);
  }
}
