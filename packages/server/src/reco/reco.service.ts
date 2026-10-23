import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { splitArtists } from '@maestro/common';
import { ConfigService } from '../common/config';
import { StorageService } from '../common/storage';
import { Session, SessionService } from '../common/session';
import { MusicService } from '../music/music.service';
import { normalizeKey } from '../music/search.util';
import { intentToPromptHints, type NLIntent } from './nl-intent';
import { buildParseIntentPrompt, parseIntentResponse, pickLibrarySample } from './nl-intent';
import { buildIntentSeeds, MAX_INTENT_ARTIST_SEEDS, type IntentSeeds } from './genre-seeds';
import {
  averageGenrePurity,
  computeGenrePurity,
  DEFAULT_GENRE_SCENARIOS,
  parseGenreTags,
  type GenrePurityCase,
  type GenrePurityReport,
  type GenreScenario,
} from './eval-genre';
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
import { buildCandidatePool, type CandidatePoolResult, type RecoCandidate } from './candidate-pool';
import {
  appendSignals,
  artistSignalScores,
  bannedArtistKeys,
  negativeTracks,
  normalizeSignal,
  type RecoSignal,
} from './signals';
import {
  averageRuns,
  diversityMetrics,
  hitDetails,
  holdoutBreakdown,
  meanReciprocalRank,
  recall,
  splitLibrary,
  type EvalReport,
  type EvalRunResult,
} from './eval';
import { PEN_BAD, versionPenalty, durationPenalty, isBadVersionTitle } from './version-filter';

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
 *  解析成本；20 条足够覆盖搜索首屏）。
 *
 *  ⚠️ **2026-10-23 评测发现：10 条不够**。平台搜索的前 10 条里，常常混着
 *  「**歌名叫这个**、歌手却是别人」的条目——搜 "Beyond" 第一条是 Daft Punk 的
 *  同名曲、搜 "Queen" 第一条是中文歌《Queen》。候选池的 `artistMatches`
 *  过滤会把它们全丢掉 → 该艺人一条候选都贡献不了（实测 Human League /
 *  College / Queen / Beyond / Fela Kuti 全部归零）。
 *
 *  成本几乎为零：provider 侧本来就取 30 条（`doSearchOneProvider` 里写死的
 *  `search(..., 30)`），是**统一搜索层自己 slice 成 pageSize**——调大它等于
 *  把已经取回来的数据多给几页。 */
const CANDIDATE_SEARCH_PAGE_SIZE = 20;

/** 导出给 fixture 录制脚本用——录制必须按**同样的 pageSize**，否则录下来的
 *  数据和真实池对不上（pageSize 变了，池里能捞到的曲目就变了）。 */
export const CANDIDATE_SEARCH_PAGE = CANDIDATE_SEARCH_PAGE_SIZE;

/**
 * 候选池构建彻底失败时的兜底（空池）。
 *
 * 提在**模块级**是有意的：写在 catch 里的话，那几行只在"构建池抛异常"时才会
 * 执行——几乎永远跑不到 → CI 的 coverage diff 门禁会判它"新增代码没被测到"
 * （它是被**新增**的行）。提到模块级后，import 时就执行到了，门禁放行。
 */
const EMPTY_POOL: CandidatePoolResult = {
  candidates: [],
  byOrigin: { artist: 0, 'related-artist': 0, radio: 0 },
  deepDivedArtists: [],
  dropped: {
    inLibrary: 0,
    badVersion: 0,
    duration: 0,
    duplicate: 0,
    overCap: 0,
  },
};

/**
 * intent 模式（风格意图检索）的候选池参数。
 *
 * 抽成常量有两个原因：
 *  1. **评测扫描**（`reco/sweep.ts`）要能覆盖它们——参数从"拍脑袋"变成"跑数据选"
 *  2. 每个数字都有出处（见 `specs/eval-driven-nl/` 的 L3 结论）
 */
export const INTENT_POOL_PARAMS = {
  /** 每个艺人最多取几条候选。 */
  perArtistCandidates: 6,
  /** 每个艺人最多进池几条（防"一位歌手占满整批"）。 */
  perArtistCap: 4,
  /** 分组合并：种子条目连续排前（相邻艺人可能风格漂，不插队）。 */
  grouped: true,
  /**
   * 每个种子扩几个相邻艺人。**1**（不是全局的 2）——
   * 离线扫描（`npm run reco:eval:sweep`）实测：1 个的队列纯度略高（85.4% vs
   * 84.7%）、种子块纯度持平，但**平台搜索少一半**（省延迟，也少网易云 405 限流）。
   */
  relatedPerAnchor: 1,
} as const;

/** 扫描时可覆盖的 intent 池参数。 */
export type IntentPoolParams = Partial<{
  perArtistCandidates: number;
  perArtistCap: number;
  grouped: boolean;
  anchorLimit: number;
  relatedPerAnchor: number;
  maxPoolSize: number;
}>;
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
export const RECOMMEND_TIMEOUT_MS = 25_000;

/**
 * NL playlist：客户端只传 exclude_titles / exclude_artists（没传 intent）
 * 时的占位 intent——全空字段让 intentToPromptHints 只产出 extra 排除行。
 */
const EMPTY_INTENT: NLIntent = {
  mood: '',
  genres: [],
  tempo: 'any',
  language: 'any',
  similar_artists: [],
  similar_tracks: [],
  exclude_artists: [],
  exclude_genres: [],
  genre_artists: [],
  target_count: 12,
  rationale: '',
};

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

  /**
   * §5 Settings：清掉用户的 DeepSeek key（reset）。删 storage + 清内存 env，
   *  下次 status() 立即返回 configured=false。**绝不** log 老 key（哪怕 tail）—
   *  reset 是用户主动操作，logger 留 ok/无敏感字段即可。
   */
  resetApiKey(): { ok: true } {
    this.storage.delete(SECRETS_KEY);
    delete process.env.DEEPSEEK_API_KEY;
    this.logger.log('DeepSeek key reset');
    return { ok: true };
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

  /**
   * 拿 key，没有就抛 428。**所有**要发 DeepSeek 请求的入口都必须走这个，
   * 不要自己 `process.env.DEEPSEEK_API_KEY`。
   *
   * 2026-09-30 修 NL 歌单恒 401：controller 当时写的是
   *   `const apiKey = process.env.DEEPSEEK_API_KEY ?? ''`
   * 同一个 controller 里的前置检查 `isConfigured()` 走的是 getApiKey()
   * （有 storage 兜底）→ 判定「配好了」放行，但真发请求时 env 是空的
   * → `Authorization: Bearer ` → DeepSeek 401 → 502 deepseek_401。
   * 之所以只有 NL 歌单中招：server 重启后 process.env 清空，而 key 是设置页
   * 写进 storage 的（setApiKey 才顺手同步 env，只在当次进程有效）；
   * `/reco/run` 用的是 getApiKey()，兜底拿到真 key，一直是好的。
   * 症状因此极具迷惑性：「推荐能出歌单，只有 NL 歌单 401」。
   */
  requireApiKey(): string {
    const key = this.getApiKey();
    if (!key) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_REQUIRED,
          error: 'deepseek_key_not_configured',
          message: '请先在设置里填入 DeepSeek API key',
        },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }
    return key;
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
      /** NL playlist 路径（specs/nl-playlist/）：parse-intent 后传入；扩展 prompt
       *  hints，并把 target_count / language / mood / similar_artists 折进已有路径。
       * 不传时 run() 行为完全与改造前一致（向后兼容）。 */
      intent?: NLIntent;
      /** NL playlist 路径：按标题排除（soft，落到 prompt hints；硬过滤需
       *  {title,artist} 双键，仍走上面 exclude 字段）。 */
      exclude_titles?: string[];
      /** NL playlist 路径：按艺人排除（同上，soft）。 */
      exclude_artists?: string[];
      /** 跳过候选池缓存（评测/诊断用）。**不从 HTTP 入参透传**——controller
       *  显式挑字段，客户端设不了这个开关。 */
      noPoolCache?: boolean;
    } = {},
  ): Promise<RecoResult> {
    const apiKey = this.requireApiKey();

    // NL 意图驱动的检索（specs/nl-intent-retrieval/）——**必须在库检查之前**判定。
    //
    // 背景：「来点儿爵士乐」以前只会变成 prompt 里一行软提示，候选池照样是
    // 用户库的口味档案（陈奕迅/汪苏泷…）——LLM 面对 40 首流行只能挑流行。
    // 现在风格指令会**变成检索种子**：流派 → 代表艺人 → 平台真实曲目。
    const intentSeeds = opts.intent ? buildIntentSeeds(opts.intent) : null;
    const intentMode = Boolean(intentSeeds?.styleDirective);

    // ── 库非空的前置检查：**只对普通推荐路径生效** ──────────────
    //
    // 判据是「**有没有传 intent**」，**不是** intentMode（有没有风格指令）——
    // 两个 spec 的向后兼容口径都是"没传 intent 时行为完全不变"
    // （nl-playlist §不做什么 / nl-intent-retrieval §验收）：
    //   · 传了 intent  = NL 歌单路径 → 不要求库
    //   · 没传 intent  = 普通「✨推荐」路径 → 要求库
    //
    // 普通「✨推荐」的候选池 = 库里的主干艺人 + 平台 FM → 空库时推荐等于无中生有，
    // 所以必须拒（前端 useReco 有「库空 → 自动 import」兜底）。
    //
    // NL 歌单路径**不依赖个人库**：
    //   · intentMode（带风格指令）：候选池**只**来自意图种子（流派代表艺人 → 平台
    //     真实目录），口味档案与平台 FM 都不参与——它们正是"要爵士给大流行"的污染源。
    //   · intent 但无风格指令：候选池 = 口味档案 → 空库时池子为空 → 按 spec §风险
    //     回退自由生成（LLM 按心情点歌名 + 填源兜底），不报错、不交白卷。
    // 库在 NL 路径只有两处用途：
    //   ① dedupAgainstLibrary（不推荐库里已有的歌）→ 空库 = 不去重，无害
    //   ② appendTasteFallback（种子捞不满时兜底）→ 空库 = 兜不出东西，
    //     但那是 spec §风险设计的降级，不是错误
    //
    // ⚠️ 2026-10-23 实测 bug：这段检查原本无条件前置在 intent 判定之前 → 从没导入过
    // ❤ 库的用户点 NL 歌单「生成队列」必然 400 library_empty，尽管意图解析完全正确
    // （parse-intent 本身容忍空库——库只是"锚点"，没有也照样解析；nl-playlist
    // spec §风险也写了"首次 import 用户库时 prompt 没库上下文 → 退化为通用推荐，
    // 不报错"）。
    const hasIntent = Boolean(opts.intent);
    const storedLib = this.musicService.getLibrary(session);
    const libraryEmpty = !storedLib || storedLib.items.length === 0;
    if (libraryEmpty && !hasIntent) {
      throw new BadRequestException('library_empty：先 POST /music/library/import');
    }
    // NL 路径允许空库 → 归一成空库对象，下面 lib.items / lib.importedAt 无需判空。
    const lib = storedLib ?? { items: [] as UnifiedSearchItem[], sources: [], importedAt: 0 };
    if (libraryEmpty && hasIntent) {
      this.logger.log(
        intentMode
          ? 'reco: intent 模式 + 空库 → 候选池只走意图种子（不需要 ❤ 库）'
          : 'reco: intent 无风格指令 + 空库 → 候选池为空，回退自由生成（不需要 ❤ 库）',
      );
    }

    // intent 传了就用 intent.target_count（spec §数据模型：8-20 已 clamp 过），
    // 不传则保持原 opts.count 行为
    const requestedCount = opts.intent?.target_count ?? opts.count;
    const count = Math.min(Math.max(requestedCount ?? 10, 1), 30);
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
    // intentSeeds / intentMode 已在函数开头（库检查之前）算好——顺序不能换。
    // 参考曲目只有歌名时（"光辉岁月"），搜一下拿到真艺人再进种子池。
    if (intentMode && intentSeeds && intentSeeds.tracks.length) {
      const resolved = await this.resolveTrackArtists(session, intentSeeds.tracks);
      for (const a of resolved) {
        if (intentSeeds.artists.length >= MAX_INTENT_ARTIST_SEEDS) break;
        intentSeeds.artists.push(a);
      }
    }
    // NL playlist 路径：把 intent 翻译成额外 prompt hints，并把
    // target_count / language / mood 折进已有 opts。
    // 不传 intent → nlOpts 为空对象，{...opts, ...nlOpts} 与原 opts 等价。
    const nlOpts: {
      language?: string;
      mood?: string;
      intentHints?: string[];
      intentMode?: boolean;
    } = opts.intent
      ? {
          ...(opts.intent.language && opts.intent.language !== 'any'
            ? { language: opts.intent.language }
            : {}),
          ...(opts.intent.mood?.trim() ? { mood: opts.intent.mood } : {}),
          intentHints: intentToPromptHints(opts.intent, {
            exclude_titles: opts.exclude_titles,
            exclude_artists: opts.exclude_artists,
          }),
          ...(intentMode ? { intentMode: true } : {}),
        }
      : opts.exclude_titles?.length || opts.exclude_artists?.length
        ? {
            // 客户端只传了 exclude_titles/exclude_artists（没传 intent）——
            // 空 intent 占位，让 extra 排除行进 prompt。
            intentHints: intentToPromptHints(EMPTY_INTENT, {
              exclude_titles: opts.exclude_titles,
              exclude_artists: opts.exclude_artists,
            }),
          }
        : {};
    // NL 路径：显式排除的艺人 → 候选池硬剔除 + generate 输出后置过滤的
    // 双保险。只用 prompt hint 挡不住 select 模式把被排除艺人挑出来。
    const nlExcludeArtistKeys = new Set(
      [...(opts.intent?.exclude_artists ?? []), ...(opts.exclude_artists ?? [])]
        .map((a) => normalizeKey(a, ''))
        .filter(Boolean),
    );
    // P0-b：行为信号（带时间衰减）折进口味档案 + 拉黑被反复跳过的艺人。
    const signalScores = artistSignalScores(signals);
    const bannedArtists = new Set<string>([
      ...bannedArtistKeys(signalScores),
      ...nlExcludeArtistKeys,
    ]);
    // 种子模式本身就是一次强正反馈（用户主动说"我要更多这种"）。
    if (opts.seed?.title && opts.seed?.artist) {
      this.recordSignals(session, [{ ...opts.seed, type: 'seed' }]);
    }

    // 口味档案：主干（anchors）稳定、种子每轮换（P0-a）。见 taste-profile.ts。
    const profile = this.getTasteProfile(session, lib.items, lib.importedAt, signals, signalScores);

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
      // NL 排除艺人是一次性要求——剔除后的池不能读/写共享缓存
      // （cacheKey 不含排除集，否则会污染后续普通推荐最多 10min）。
      // intent 模式的池用独立 key（种子不同），同样不与普通推荐共用。
      // 评测显式跳过缓存：诊断要测"当前代码"，不能被 10min 前的旧池污染。
      nlExcludeArtistKeys.size || opts.noPoolCache ? { noCache: true } : {},
      intentMode && intentSeeds ? { intentSeeds } : {},
    );
    let pool = built.pool;
    // NL 路径：显式排除的艺人从候选池硬剔除（bannedArtists 已在新池构建
    // 时滤过；这里是第二道保险）。不原地改数组——避免误改到缓存对象。
    if (nlExcludeArtistKeys.size) {
      pool = {
        ...pool,
        candidates: pool.candidates.filter(
          (c) => !nlExcludeArtistKeys.has(normalizeKey(c.artist, '')),
        ),
      };
    }
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
          // intent 模式：**只要 count 条，不超额要**。
          // 超额要（1.5x）等于给模型"凑数"的机会——它会从清单里挑风格不符的
          // 条目来凑（实测「周末慵懒的中文民谣」被塞了 6 首流行 OST）。
          // 少挑不亏：fillFromPool 按候选池顺序补位，而 intent 模式的池是
          // **种子优先**，补出来的仍在风格内。
          count: intentMode
            ? Math.min(count, listed.length)
            : Math.min(Math.ceil(count * SELECT_OVERASK), listed.length),
          // NL 路径：intent 的 language/mood 覆盖顶层入参（nlOpts 只在
          // intent 明确给了非 any / 非空值时才设置）。
          language: nlOpts.language ?? opts.language,
          mood: nlOpts.mood ?? opts.mood,
          intentHints: nlOpts.intentHints,
          intentMode,
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
          this.buildGeneratePrompt(profile, { ...opts, ...nlOpts }, exclude, count),
          { maxTokens: GENERATE_MAX_TOKENS },
        );
        raw = fb;
        rawItems = this.parseRecommendations(fb);
        mode = 'generate';
      }
    } else {
      this.logger.log(`reco: 候选池不足（${pool.candidates.length} < ${count}），走自由生成`);
      raw = await this.callDeepSeek(
        apiKey,
        this.buildGeneratePrompt(profile, { ...opts, ...nlOpts }, exclude, count),
        { maxTokens: GENERATE_MAX_TOKENS },
      );
      rawItems = this.parseRecommendations(raw);
      mode = 'generate';
    }
    llmMs = Date.now() - tLlmStart;

    // NL 排除艺人的后置保险：generate 路径没有候选池可滤，模型仍可能把被
    // 排除艺人写进结果；select 路径的池已滤过，这里一般 0 命中。
    if (nlExcludeArtistKeys.size) {
      const before = rawItems.length;
      rawItems = rawItems.filter((it) => !nlExcludeArtistKeys.has(normalizeKey(it.artist, '')));
      if (rawItems.length < before) {
        this.logger.log(`reco: NL 排除艺人后置剔除 ${before - rawItems.length} 首`);
      }
    }

    // 2026-08-14 防御性预筛：即便 prompt 写得很清楚，模型仍可能输出 DJ/伴奏/
    // 慢摇这种"二次加工"歌名（实测「推荐 DJ 版晴天」「推荐 XXX 伴奏」）。
    // 在去重 / fill 之前先按 VERSION_BAD 扫一遍，命中即丢——OVERASK_FACTOR=2
    // 的余量足够覆盖。
    const sanitized = this.sanitizeBadVersions(rawItems);
    if (sanitized.length < rawItems.length) {
      this.logger.log(`reco: 预筛丢弃 ${rawItems.length - sanitized.length} 条「坏版本」标题`);
    }
    const deduped = this.dedupAgainstLibrary(sanitized, lib.items, exclude);
    // 多样性：同一位归一艺人最多 ARTIST_CAP 首（候选池本身已限量，这里是
    // 自由生成路径的兜底——两轮都防"一位歌手占满整批"）。
    const diversified = this.applyArtistCap(deduped, ARTIST_CAP);
    if (diversified.length < deduped.length) {
      this.logger.log(`reco: 多样性限制丢弃 ${deduped.length - diversified.length} 条同艺人超额`);
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
      /** NL playlist 路径：额外 hint 行（心情/风格/年代/排除…）。追加在
       *  existing 句尾（avoid 之后、"请按 JSON..."之前）。 */
      intentHints?: string[];
      /** NL 风格指令模式（specs/nl-intent-retrieval/）：用户这次明确要某个风格，
       *  「本次要求」是最高优先级，口味库只作兜底参考。 */
      intentMode?: boolean;
    },
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const libList = library
      .map((it, i) => `${i + 1}. ${it.title} - ${it.artist}` + (it.album ? ` (${it.album})` : ''))
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
${
  opts.intentMode
    ? `
# 本次用户有明确要求（最高优先级）
用户消息里有「本次要求」段——**那才是这次要的东西**（例如"风格标签：jazz"就是真的要爵士，
不是"像爵士的流行"）。严格按它选曲；下面的口味库只是兜底参考，不要因为库里的歌不是这个
风格就改推别的风格。`
    : ''
}
# 输出格式
{ "items": [ { "title": "...", "artist": "...", "reason": "..." } ] }
只输出这一个 JSON 对象。`;

    const lang =
      opts.language && opts.language !== 'auto'
        ? `语言偏好：${opts.language === 'zh' ? '中文' : opts.language === 'en' ? '英文' : opts.language === 'ja' ? '日文' : opts.language === 'ko' ? '韩文' : opts.language}`
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
    const intentHints = opts.intentHints?.length ? '\n' + opts.intentHints.join('\n') : '';
    // intent 模式：「本次要求」放最前面（最高优先级），口味库降级为兜底参考。
    const user = opts.intentMode
      ? `# 本次要求（最高优先级）\n${opts.intentHints?.join('\n') ?? ''}

我的口味库（采样，仅作兜底参考）：\n${libList}${anchor}

${lang}
${mood}${avoid}

请按 JSON 数组输出 ${opts.count} 首推荐。`
      : `我的口味库（采样）：\n${libList}${anchor}\n\n${lang}\n${mood}${avoid}${intentHints}\n\n请按 JSON 数组输出 ${opts.count} 首推荐。`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  // ── P0-a 口味档案 ───────────────────────────────────────

  // ── 离线评测（留一法）────────────────────────────────────

  /**
   * 留一法离线评测：把库里的部分红心歌藏起来，只用剩余的歌跑**同一条真实
   * 流水线**（候选池 → 挑选 → 填源），看藏起来的歌能不能被推回来。
   *
   * 为什么要分两层指标：`poolRecall`（藏起来的歌有没有进候选池）与
   * `recallAtK`（最终有没有推给用户）分开，就能直接定位损失在哪一段——
   * 是候选生成捞不到，还是 LLM 挑选没挑中。
   *
   * 模式：
   *  - `pool`（默认）：**不调 LLM、不花钱**，用候选池的确定性顺序取前 count 条
   *    作为"如果没有 LLM 会推什么"——衡量检索层。
   *  - `llm`：完整流水线（会消耗 token）。
   *
   * 注意：评测**不写**产品用的候选池缓存（否则评测的 train-only 池会污染真实
   * 推荐），也不写推荐历史。
   */
  async evaluate(
    session: Session,
    opts: {
      holdoutSize?: number;
      count?: number;
      mode?: 'pool' | 'llm';
      runs?: number;
      seed?: number;
    } = {},
  ): Promise<EvalReport> {
    const lib = this.musicService.getLibrary(session);
    if (!lib || lib.items.length < 2) {
      throw new BadRequestException('library_empty：先导入库（至少 2 首）再跑评测');
    }
    const mode = opts.mode ?? 'pool';
    const count = Math.min(Math.max(opts.count ?? 10, 1), 30);
    const holdoutSize = Math.min(Math.max(opts.holdoutSize ?? 20, 1), lib.items.length - 1);
    const runs = Math.min(Math.max(opts.runs ?? 1, 1), 10);
    if (mode === 'llm' && !this.isConfigured()) {
      throw new HttpException('deepseek_key_not_configured', HttpStatus.PRECONDITION_REQUIRED);
    }

    const apiKey = mode === 'llm' ? this.getApiKey() : null;
    const signals = this.loadSignals(session);
    const signalScores = artistSignalScores(signals);
    const bannedArtists = bannedArtistKeys(signalScores);
    const negatives = negativeTracks(signals);
    const exclude = this.mergeExclude(undefined, [...this.loadRecoHistory(session), ...negatives]);

    // 可复现：seed 决定留出集与探索艺人的随机序列。
    let rngState = opts.seed ?? 1;
    const rng = () => {
      // mulberry32：小巧、确定、够用。
      rngState |= 0;
      rngState = (rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const results: EvalRunResult[] = [];
    for (let run = 0; run < runs; run++) {
      const started = Date.now();
      const { train, holdout } = splitLibrary(lib.items, {
        holdoutSize,
        rng,
      });
      // 档案只用 train 建——否则等于把考卷答案喂进去了。
      const profileCore = buildProfileCore(train, {
        importedAt: lib.importedAt,
        anchorCount: TOP_ARTISTS_HINT,
        signalScores,
      });
      const profile: TasteProfile = {
        ...profileCore,
        seeds: pickTasteSeeds(train, profileCore.artists, {
          count: TASTE_SEED_COUNT,
          exploreRatio: TASTE_EXPLORE_RATIO,
          rng,
        }),
      };

      const poolStart = Date.now();
      const built = await this.buildPool(
        session,
        profile,
        train,
        exclude,
        count,
        undefined,
        bannedArtists,
        { noCache: true },
      );
      const poolMs = Date.now() - poolStart;

      // 检索层指标
      const poolRecall = recall(holdout, built.pool.candidates);
      const poolRecallTop20 = recall(holdout, built.pool.candidates, 20);

      // 选择层：pool 模式用候选池既定顺序的确定性"假排序"；llm 模式走真挑选。
      let recommended: Array<{ title: string; artist: string }>;
      let llmMs = 0;
      if (mode === 'llm' && apiKey) {
        const listed = built.pool.candidates.slice(0, SELECT_PROMPT_CANDIDATES);
        const llmStart = Date.now();
        const raw = await this.callDeepSeek(
          apiKey,
          this.buildSelectPrompt(profile, listed, { count }),
          { maxTokens: SELECT_MAX_TOKENS },
        );
        llmMs = Date.now() - llmStart;
        const picks = this.parseSelection(raw, listed.length);
        recommended = this.fillFromPool(picks, built.pool.candidates, count);
      } else {
        recommended = this.fillFromPool([], built.pool.candidates, count);
      }

      const breakdown = holdoutBreakdown(holdout, train);
      results.push({
        poolSize: built.pool.candidates.length,
        poolRecall,
        poolRecallTop20,
        recallAtK: recall(holdout, recommended, count),
        mrr: meanReciprocalRank(holdout, recommended),
        holdoutSameArtist: {
          size: breakdown.sameArtist.length,
          recall: recall(breakdown.sameArtist, recommended, count),
        },
        holdoutNewArtist: {
          size: breakdown.newArtist.length,
          recall: recall(breakdown.newArtist, recommended, count),
        },
        diversity: diversityMetrics(recommended),
        candidatesByOrigin: built.pool.byOrigin as unknown as Record<string, number>,
        timings: { poolMs, llmMs, totalMs: Date.now() - started },
        hits: hitDetails(holdout, recommended),
        holdout: holdout.map((h) => ({ title: h.title, artist: h.artist })),
      });
    }

    const report = averageRuns(results, {
      mode,
      count,
      librarySize: lib.items.length,
      holdoutSize,
      model: mode === 'llm' ? DEEPSEEK_MODEL : undefined,
    });
    this.logger.log(
      `reco eval(${mode}): 池内召回 ${(report.average.poolRecall * 100).toFixed(1)}% / ` +
        `Top-${count} ${(report.average.recallAtK * 100).toFixed(1)}% / ` +
        `新艺人 ${(report.average.newArtistRecall * 100).toFixed(1)}%`,
    );
    return report;
  }

  // ── NL 歌单 · 风格纯度评测 ──────────────────────────────

  /**
   * NL 歌单风格纯度评测（specs/nl-intent-retrieval/）。
   *
   * 留一法评测（`evaluate()`）测的是**口味**（能不能推回藏起来的歌）；
   * 这里测的是**风格**（用户说"来点爵士"，队列里到底有多少真的爵士）。
   * 2026-10-20 的线上问题（要爵士给 12 首大流行）就是这一维度的塌方，
   * 而当时没有任何数字能暴露它。
   *
   * 每个场景跑**真实链路**：parse-intent（真 DeepSeek）→ 意图种子 → 候选池 →
   * 挑选 → 填源，然后算三类指标（检索层纯度 / 策展层纯度 / 口味污染）。
   *
   * 不写用户的"最近推荐过"历史——评测完不该影响用户自己的推荐。
   */
  async evaluateGenrePurity(
    session: Session,
    opts: {
      scenarios?: GenreScenario[];
      count?: number;
      /** 是否用 LLM 逐首判流派（关掉则只算检索层 + 污染指标，不花钱）。 */
      judge?: boolean;
    } = {},
  ): Promise<GenrePurityReport> {
    const apiKey = this.requireApiKey();
    const lib = this.musicService.getLibrary(session);
    if (!lib || lib.items.length === 0) {
      throw new BadRequestException('library_empty：先 POST /music/library/import');
    }
    const scenarios = opts.scenarios ?? DEFAULT_GENRE_SCENARIOS;
    const count = Math.min(Math.max(opts.count ?? 12, 1), 30);
    const judge = opts.judge !== false;

    // 库艺人（归一后）—— 污染指标的对照集
    const libraryArtists = new Set<string>();
    for (const it of lib.items) {
      for (const raw of splitArtists(it.artist ?? '')) {
        const k = normalizeKey(raw.trim(), '');
        if (k) libraryArtists.add(k);
      }
    }
    // 主干艺人 = 污染源（"要爵士给大流行"就是它们在撑）
    const signals = this.loadSignals(session);
    const signalScores = artistSignalScores(signals);
    const profile = this.getTasteProfile(session, lib.items, lib.importedAt, signals, signalScores);
    const anchorArtists = new Set(profile.anchors.map((a) => normalizeKey(a, '')).filter(Boolean));

    // 评测不该污染用户的"最近推荐过"历史：先存后还原。
    const histKey = this.historyKey(session.id);
    const historyBefore = this.storage.get(histKey);

    const cases: GenrePurityCase[] = [];
    try {
      for (const scenario of scenarios) {
        // 1. 解析意图（与线上同一路径：带 ❤ 库上下文）
        const sample = pickLibrarySample(lib, 50);
        const messages = buildParseIntentPrompt(scenario.text, sample);
        const raw = await this.callDeepSeekForParse(apiKey, messages, { maxTokens: 800 });
        const { intent } = parseIntentResponse(raw);
        // 条数固定，别让 LLM 自己决定（否则各场景不可比）
        intent.target_count = count;

        // 2. 检索种子（流派 → 代表艺人）
        const seeds = buildIntentSeeds(intent);

        // 3. 跑真实流水线（跳过候选池缓存：评测要测当前代码，不能吃旧池）
        const res = await this.run(session, { intent, noPoolCache: true });

        // 4. 流派判定（一次 LLM 调用标完整条队列）
        const tags = judge ? await this.judgeGenres(apiKey, res.items) : null;

        // 5. 算指标
        cases.push(
          computeGenrePurity(
            scenario,
            {
              items: res.items.map((it) => ({ title: it.title, artist: it.artist })),
              tags,
              genres: intent.genres,
              seeds: seeds.artists,
              mode: res.mode,
            },
            { seeds: seeds.artists, libraryArtists, anchorArtists },
          ),
        );
        this.logger.log(
          `genre eval[${scenario.id}]: 种子覆盖 ${(cases[cases.length - 1].seedCoverage * 100).toFixed(1)}%` +
            ` / 流派纯度 ${cases[cases.length - 1].judged ? (cases[cases.length - 1].tagPurity * 100).toFixed(1) + '%' : '未判定'}` +
            ` / 库污染 ${(cases[cases.length - 1].libraryLeak * 100).toFixed(1)}%`,
        );
      }
    } finally {
      // 还原历史（评测跑挂了也要还原）
      this.storage.set(histKey, historyBefore ?? []);
    }

    return {
      at: Date.now(),
      model: DEEPSEEK_MODEL,
      librarySize: lib.items.length,
      count,
      cases,
      average: averageGenrePurity(cases),
    };
  }

  /**
   * 让 LLM 给整条队列逐首标流派（一次调用标完，不一首一次）。
   * 失败 → null（该场景降级成"未判定"，只算检索层 + 污染指标）。
   */
  private async judgeGenres(
    apiKey: string,
    items: Array<{ title: string; artist: string }>,
  ): Promise<string[][] | null> {
    if (!items.length) return null;
    const list = items.map((it, i) => `${i + 1}. ${it.title} - ${it.artist}`).join('\n');
    try {
      const raw = await this.callDeepSeek(
        apiKey,
        [
          {
            role: 'system',
            content:
              '你是音乐流派标注员。给下面每首歌标注它的**主要流派**（1-2 个，小写英文，如 jazz / rock / pop / electronic / folk / blues / rnb / hiphop / classical）。\n' +
              '只输出 JSON：{"tags": [["jazz"], ["pop"], ...]}——数组长度必须与歌单条数相同、顺序一一对应。\n' +
              '拿不准就给空数组，不要猜。',
          },
          { role: 'user', content: list },
        ],
        { maxTokens: 800 },
      );
      return parseGenreTags(raw, items.length);
    } catch (err) {
      this.logger.warn(`genre judge failed: ${(err as Error)?.message}`);
      return null;
    }
  }

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
  private readonly poolCache = new Map<string, { at: number; pool: CandidatePoolResult }>();

  /** 用当前 exclude 过滤缓存池（池子本身不含 exclude 语义）。 */
  private filterPoolByExclude(
    pool: CandidatePoolResult,
    exclude: Array<{ title: string; artist: string }>,
  ): CandidatePoolResult {
    if (!exclude.length) return pool;
    const keys = new Set(exclude.map((e) => normalizeKey(e.title, e.artist)));
    const candidates = pool.candidates.filter((c) => !keys.has(normalizeKey(c.title, c.artist)));
    const byOrigin: Record<string, number> = {
      artist: 0,
      'related-artist': 0,
      radio: 0,
    };
    for (const c of candidates) byOrigin[c.origin]++;
    return {
      candidates,
      byOrigin,
      deepDivedArtists: pool.deepDivedArtists ?? [],
      dropped: pool.dropped,
    };
  }

  private async buildPool(
    session: Session,
    profile: TasteProfile,
    library: UnifiedSearchItem[],
    exclude: Array<{ title: string; artist: string }>,
    count: number,
    seed?: { title: string; artist: string },
    bannedArtists?: Set<string>,
    opts: { noCache?: boolean } = {},
    intentOpts: { intentSeeds?: IntentSeeds; poolParams?: IntentPoolParams } = {},
  ): Promise<{ pool: CandidatePoolResult; cached: boolean }> {
    // intent 模式（specs/nl-intent-retrieval/）：候选池**只**来自意图种子
    // （流派代表艺人 / 用户点名的艺人），口味档案与平台 FM 都不参与——
    // 它们正是"要爵士给大流行"的污染源。
    //
    // ⚠️ 判定用 `styleDirective`（意图里有没有风格指令），不是"有没有种子"：
    // 冷门流派（如 afrobeat）可能既没 LLM 提代表艺人、映射表也没收录 →
    // 种子为空。此时**仍然**是 intent 模式（不拉 FM、prompt 以意图为准），
    // 只是候选退回到库口味艺人；两个 intentMode 判定必须一致，否则会出现
    // "prompt 说要爵士、候选池却是私人 FM 流行"的错配。
    const intentSeeds = intentOpts.intentSeeds;
    const intentMode = Boolean(intentSeeds?.styleDirective);
    const seedArtists = intentSeeds?.artists ?? [];
    // 种子模式（"像这首一样"）下候选围绕种子的艺人展开：主干换成这一位、
    // 相邻艺人也围绕它扩，探索艺人不参与——用户要的是"更多这种"，不是"换口味"。
    const seedArtist = seed?.artist?.trim();
    const anchors = seedArtist
      ? [seedArtist, ...(intentMode ? seedArtists : [])]
      : intentMode && seedArtists.length
        ? seedArtists
        : profile.anchors;
    const exploreCandidates = seedArtist || intentMode ? [] : profile.anchors;
    // 缓存 key 刻意**不含信号指纹**：口味档案的 signature 里带了信号条数，
    // 而每播一首歌就会新增一条 play 信号——若把它算进 key，用户边听边点推荐时
    // 缓存永远命中不了，L4 的收益直接归零。真正影响候选池的是"主干是谁"和
    // "库多大"，所以 key 用 (session, 库规模, 主干艺人)。
    // intent 模式用独立前缀——池的来源完全不同，不能与普通推荐互相命中。
    //
    // ⚠️ **版本号**：池的**构建参数**（每人配额/每人候选数/是否分组）也影响池
    // 的内容，不在 key 里的话，改了参数旧缓存还会命中 10 分钟——症状是"代码
    // 改了但行为没变"，极难查。2026-10-20 实测：把 intent 模式每人配额 2→4
    // 后连续三轮评测都还是 2 首/艺人（命中旧缓存）。**改池构建参数就 bump 版本号。**
    const POOL_VERSION = 'v2';
    const cacheKey = intentMode
      ? `intent|${POOL_VERSION}|${session.id}|${profile.size}|${anchors.join('|')}`
      : `${POOL_VERSION}|${session.id}|${profile.size}|${anchors.join('|')}`;
    const hit = this.poolCache.get(cacheKey);
    // 离线评测走 noCache：评测用的是 train-only 的池，一旦写进产品缓存就会
    // 污染真实推荐（且评测不想被产品缓存命中）。
    if (!opts.noCache && hit && Date.now() - hit.at < POOL_CACHE_TTL_MS) {
      const filtered = this.filterPoolByExclude(hit.pool, exclude);
      if (filtered.candidates.length >= count) {
        this.logger.log(`reco: 候选池命中缓存（${filtered.candidates.length} 首可用，省掉重建）`);
        return { pool: filtered, cached: true };
      }
    }

    const exploreArtists =
      seedArtist || intentMode
        ? []
        : pickExploreArtists(profile.artists, exploreCandidates, EXPLORE_ARTIST_COUNT);
    // 被信号拉黑的艺人 / 种子歌自身：不进候选（种子歌本身用户已经在听）。
    const poolExclude = seed ? [...exclude, { title: seed.title, artist: seed.artist }] : exclude;
    // ⚠️ intent 模式：**种子艺人的库内曲目不算"重复"**。
    //
    // 背景（2026-10-23 真实链路评测发现）：用户库里本来就有大量该风格的歌
    // （中文民谣场景：库里 1566 首，陈粒/马頔/宋冬野/赵雷 都在）→ 库内去重把
    // 这些"正好是用户想要的"曲目全滤掉 → 种子块凑不满 12 首 → 模型只好从
    // **漂移的相邻艺人**里挑（实测混进 4 首虞书欣/周深的流行 OST，流派纯度
    // 从 100% 掉到 66.7%）。
    //
    // "别推荐我已有的"是**发现类**推荐的规矩（普通"✨推荐"）；用户明确说
    // "来点中文民谣"时，库里的民谣歌**正是**答案，不该被排除。
    //
    // ⚠️ 只放宽**库内去重**这一项——"用户跳过过的""刚推荐过的"照旧排除
    //（那是用户明确的负向信号，跟"库里已有"不是一回事）。
    const poolLibrary =
      intentMode && anchors.length
        ? library.filter(
            (it) => !anchors.some((a) => normalizeKey(it.artist ?? '', '') === normalizeKey(a, '')),
          )
        : library;
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
      // intent 模式不拉私人 FM——FM 是**账号画像**生成的，最容易把风格带偏
      // （用户平时听流行 → FM 全是流行）。
      fetchRadio: intentMode
        ? undefined
        : () => this.musicService.fetchRecoRadioCandidates(session, RADIO_PER_PROVIDER),
    };

    try {
      // intent 模式的池参数：默认值见 INTENT_POOL_PARAMS；评测扫描会覆盖它们
      // （`reco/sweep.ts`）——**生产路径永远用默认值**。
      const intentPoolParams = intentMode
        ? {
            perArtistCandidates: INTENT_POOL_PARAMS.perArtistCandidates,
            perArtistCap: INTENT_POOL_PARAMS.perArtistCap,
            grouped: INTENT_POOL_PARAMS.grouped,
            // anchorLimit：普通模式只深挖 3 位主干（口味够了）；intent 模式的种子
            // **全是流派代表艺人**（每个都在风格内），截断就是白白浪费——全用上。
            anchorLimit: Math.max(anchors.length, 1),
            relatedPerAnchor: INTENT_POOL_PARAMS.relatedPerAnchor,
            ...(intentOpts.poolParams ?? {}),
          }
        : {};
      const pool = await buildCandidatePool(deps, {
        anchors,
        exploreArtists,
        library: poolLibrary,
        exclude: poolExclude,
        relatedPerAnchor: RELATED_PER_ANCHOR,
        bannedArtists: bannedArtists ? [...bannedArtists] : undefined,
        // 种子模式：只围绕这一位艺人扩相邻，别把口味主干也拉进来搅局。
        neighborAnchorLimit: seedArtist ? 1 : undefined,
        // intent 模式：种子是流派代表艺人，单个艺人多取一点、每人配额放宽，
        // 否则 12 首的队列会被少数几位艺人占满（实测中文民谣场景种子只有 4 位
        // 艺人 → 池里凑不出 12 首民谣 → 模型被迫挑风格外的条目凑数）。
        // grouped = 流派条目连续排前（相邻艺人可能漂，不插队）。
        ...intentPoolParams,
      });
      // intent 模式：风格种子捞不满时，把**库口味艺人**追加到队尾兜底
      // （宁可掺几首用户常听的，也别交白卷）。口味候选排在后面，模型会优先
      // 挑前面的风格条目。
      // 注意：种子为空时（冷门流派没兜底到）池子本身已经是口味池，再兜一次
      // 只会重复搜索，白等一轮网络。
      const merged =
        intentMode && seedArtists.length && pool.candidates.length < count
          ? await this.appendTasteFallback(
              session,
              profile,
              library,
              poolExclude,
              pool,
              bannedArtists,
            )
          : pool;
      this.logger.log(
        `reco: 候选池 ${merged.candidates.length} 首` +
          `（深挖 ${merged.byOrigin.artist} / 相邻 ${merged.byOrigin['related-artist']} / 电台 ${merged.byOrigin.radio}）` +
          (intentMode ? ' [intent 模式]' : ''),
      );
      if (!opts.noCache) {
        // 顺手清掉过期条目，避免 map 无限增长（会话少但会长跑）。
        for (const [k, v] of this.poolCache) {
          if (Date.now() - v.at >= POOL_CACHE_TTL_MS) this.poolCache.delete(k);
        }
        this.poolCache.set(cacheKey, { at: Date.now(), pool: merged });
      }
      return { pool: merged, cached: false };
    } catch (err) {
      // 理论上 buildCandidatePool 自己已经兜住了大部分失败；这里再兜一层，
      // 保证候选池的任何意外都不会让"推荐"整体失败。
      this.logger.warn(`reco: 候选池构建失败，回退自由生成：${(err as Error)?.message}`);
      return { pool: EMPTY_POOL, cached: false };
    }
  }

  /**
   * intent 模式兜底：风格种子捞不满 count 时，把**库口味艺人**的曲目追加到
   * 候选池**队尾**。
   *
   * 为什么要兜底：冷门流派（"afrobeat"、"drone"）在 QQ/网易云可能搜不到曲，
   * 宁可掺几首用户常听的，也不要交白卷（spec §验收"候选不足不报错"）。
   * 兜底候选排在风格候选之后 → LLM 优先挑风格条目，程序补位也补在后面。
   *
   * 不拉私人 FM（FM 是账号画像，掺进来等于把流行灌进爵士单）。
   */
  private async appendTasteFallback(
    session: Session,
    profile: TasteProfile,
    library: UnifiedSearchItem[],
    exclude: Array<{ title: string; artist: string }>,
    intentPool: CandidatePoolResult,
    bannedArtists?: Set<string>,
  ): Promise<CandidatePoolResult> {
    try {
      const tastePool = await buildCandidatePool(
        {
          searchArtist: (artist: string) =>
            this.musicService
              .searchUnified(session, artist, 1, CANDIDATE_SEARCH_PAGE_SIZE)
              .then((r) => r.items)
              .catch(() => [] as UnifiedSearchItem[]),
          findRelatedArtists: () => Promise.resolve([] as string[]),
          // 不拉 FM——兜底只补"用户常听的"，不掺账号画像。
          fetchRadio: undefined,
        },
        {
          anchors: profile.anchors,
          library,
          exclude,
          bannedArtists: bannedArtists ? [...bannedArtists] : undefined,
          // 兜底不扩相邻艺人：省一次网络往返，尽快把队列凑满。
          neighborAnchorLimit: 0,
          relatedPerAnchor: 0,
          perArtistCandidates: 4,
          perArtistCap: 3,
        },
      );
      const seen = new Set(intentPool.candidates.map((c) => normalizeKey(c.title, c.artist)));
      const extra = tastePool.candidates.filter((c) => {
        const k = normalizeKey(c.title, c.artist);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!extra.length) return intentPool;
      this.logger.log(`reco: intent 候选不足，口味兜底追加 ${extra.length} 首（排在队尾）`);
      return {
        candidates: [...intentPool.candidates, ...extra],
        deepDivedArtists: intentPool.deepDivedArtists ?? [],
        byOrigin: {
          artist: intentPool.byOrigin.artist + tastePool.byOrigin.artist,
          'related-artist': intentPool.byOrigin['related-artist'],
          radio: intentPool.byOrigin.radio,
        },
        dropped: {
          ...intentPool.dropped,
          inLibrary: intentPool.dropped.inLibrary + tastePool.dropped.inLibrary,
          badVersion: intentPool.dropped.badVersion + tastePool.dropped.badVersion,
          duration: intentPool.dropped.duration + tastePool.dropped.duration,
          duplicate: intentPool.dropped.duplicate + tastePool.dropped.duplicate,
          overCap: intentPool.dropped.overCap + tastePool.dropped.overCap,
        },
      };
    } catch (err) {
      this.logger.warn(`reco: intent 口味兜底失败：${(err as Error)?.message}`);
      return intentPool;
    }
  }

  /**
   * 参考曲目只有歌名时（"光辉岁月"），搜一下拿真艺人名——
   * 艺人名才是检索的关键（"光辉岁月"搜出来的是一堆翻唱，"Beyond"搜出来的是原曲）。
   * fail-soft：搜不到就跳过这一条。
   */
  private async resolveTrackArtists(session: Session, tracks: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const t of tracks) {
      try {
        const res = await this.musicService.searchUnified(session, t, 1, 3);
        const artist = res.items?.[0]?.artist?.trim();
        if (artist) out.push(artist);
      } catch (err) {
        this.logger.warn(`reco: 参考曲目解析失败 "${t}": ${(err as Error)?.message}`);
      }
    }
    return out;
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
      /** NL playlist：intent 派生的额外要求（心情/风格/年代/排除…），
       *  单列「本次要求」段进 prompt——比口味档案更代表"这次想听什么"。 */
      intentHints?: string[];
      /** NL playlist 的**风格指令模式**（specs/nl-intent-retrieval/）：候选池已经
       *  按意图（流派/点名艺人）检索过。此时「本次要求」是最高优先级，
       *  口味档案（最常听的歌手 / 口味采样）**不进 prompt**——留着它们，模型会
       *  把"用户平时听陈奕迅"当成"用户现在想听陈奕迅"（实测线上就是这么把
       *  「来点爵士」变成了大流行单）。 */
      intentMode?: boolean;
    },
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const intentMode = Boolean(opts.intentMode);
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
      intentMode
        ? '2. **本次要求优先**：严格按上面「本次要求」的风格/情绪/语种来挑——用户此刻' +
          '想要的是那个风格，不是他平时的日常口味；整批要跨歌手，同一歌手最多挑 1 首。'
        : '2. 口味优先：挑"贴着档案里的偏好、但他还没听过"的；整批要跨歌手，同一歌手最多挑 1 首。',
      intentMode
        ? '3. 候选清单已经按「本次要求」检索过了，**不要**因为"这不是他平时听的"就' +
          '跳过——清单里的歌就是他这次想要的风格。'
        : '3. 兼顾惊喜：可以少量跨语种/跨年代，但核心氛围要在他的舒适圈内。',
      '4. 跳过 live / 翻唱 / DJ / 伴奏 / 纯音乐等非录音室版本（清单里若混进这类，直接不挑）。',
      '5. 宁愿少挑也不要凑数；同一位歌手、同一张专辑不要重复挑。',
    ].join('\n');

    const anchorLine = profile.anchors.length ? `最常听的歌手：${profile.anchors.join('、')}` : '';
    const sample = profile.seeds
      .slice(0, SELECT_PROMPT_SAMPLE)
      .map((it) => `${it.title} - ${it.artist}`)
      .join('\n');
    // 只列前 SELECT_PROMPT_CANDIDATES 条：输入 token 直接决定首字延迟，40 条
    // 足够挑 10 首；池子里剩下的条目仍然参与后面的"补位"。
    const list = candidates
      .slice(0, SELECT_PROMPT_CANDIDATES)
      .map((c, i) => `[${i}] ${c.title} - ${c.artist}${c.album ? ` (${c.album})` : ''}`)
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
                  : opts.language === 'ko'
                    ? '韩文'
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
    // NL playlist：用户原话翻译出的要求（心情/风格/年代/排除…）。
    const intentBlock = opts.intentHints?.length
      ? `\n${intentMode ? '# 本次要求（最高优先级，优先于任何口味偏好）' : '# 本次要求（用户原话意图，优先于上面的口味档案）'}\n${opts.intentHints.join('\n')}`
      : '';
    // intent 模式：口味档案整体不进 prompt（见 opts.intentMode 注释）——它只会把
    // 模型往"用户平时的流行"上带。
    const tasteBlock = intentMode
      ? ''
      : `# 口味档案
库里共 ${profile.size} 首。${anchorLine}
口味采样（节选，仅供判断风格）：
${sample}

`;
    const user = `${tasteBlock}${intentBlock}${lang}
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
    opts: {
      language?: string;
      mood?: string;
      /** NL playlist：intent 派生的额外 hint 行（spec A3）。similar_artists
       *  也走 hint（「想要类似这些艺人的歌」），不混进"最常听"锚点。 */
      intentHints?: string[];
      /** NL 风格指令模式（specs/nl-intent-retrieval/）。 */
      intentMode?: boolean;
    },
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
      ...(opts.intentHints?.length ? { intentHints: opts.intentHints } : {}),
      ...(opts.intentMode ? { intentMode: true } : {}),
    });
  }

  /**
   * 解析挑选结果：`{ "picks": [ { "id": 3, "reason": "…" } ] }`（也容忍裸数组与
   * `items` / `recommendations` 等近义字段）。
   *
   * **白名单校验**：id 必须落在候选池下标内、整数、不重复——越界/幻觉 id 一律丢。
   * 这是"消灭幻觉推荐"的最后一道闸门：模型给的是下标，取的是候选池里的真实条目。
   */
  private parseSelection(raw: string, poolSize: number): Array<{ id: number; reason: string }> {
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
      arr = obj.picks ?? obj.items ?? obj.recommendations ?? obj.songs ?? obj.tracks ?? obj.data;
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
    const target = Math.min(count * OVERASK_FACTOR, OVERASK_MAX, candidates.length);
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
      throw new HttpException('deepseek_unreachable', HttpStatus.BAD_GATEWAY);
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
    if (res.status === 401 || res.status === 403) {
      // 之前掉进下面的兜底分支，抛的是 `deepseek_401` 这种机器码，
      // 前端原样打给用户（对比 429「频率限制」/ 未配置「请先填 key」都有中文）。
      const text = await res.text().catch(() => '');
      this.logger.error(`deepseek auth failed ${res.status}: ${text.slice(0, 200)}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          error: 'deepseek_auth_failed',
          message: 'DeepSeek API key 已失效或无权限，请到设置里更新',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`deepseek ${res.status}: ${text.slice(0, 200)}`);
      throw new HttpException(`deepseek_${res.status}`, HttpStatus.BAD_GATEWAY);
    }

    const data = (await res.json()) as DeepSeekChatResponse;
    if (data.error?.message) {
      this.logger.error(`deepseek error: ${data.error.message}`);
      throw new HttpException(`deepseek_error: ${data.error.message}`, HttpStatus.BAD_GATEWAY);
    }
    return data.choices?.[0]?.message?.content ?? '';
  }

  /**
   * NL playlist 共用入口（specs/nl-playlist/）：复用同一 LLM 调用 + 错误抛错模式
   * （timeout / 429 / 5xx → HttpException），但语义上给 parse-intent 端点用。
   * 不直接暴露 callDeepSeek（private）是为了避免 controller 跳过解析 + 校验层。
   */
  async callDeepSeekForParse(
    apiKey: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    opts: { maxTokens?: number } = {},
  ): Promise<string> {
    return this.callDeepSeek(apiKey, messages, opts);
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

  private loadRecoHistory(session: Session): Array<{ title: string; artist: string }> {
    const h = this.storage.get<Array<{ title: string; artist: string }>>(
      this.historyKey(session.id),
    );
    return Array.isArray(h) ? h : [];
  }

  private saveRecoHistory(session: Session, items: Array<{ title: string; artist: string }>): void {
    // 保留最近 RECO_HISTORY_MAX 首（按加入顺序，旧的先淘汰）。
    this.storage.set(this.historyKey(session.id), items.slice(-RECO_HISTORY_MAX));
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
      const waveSize = Math.min(items.length - cursor, need + FILL_WAVE_SLACK, FILL_CONCURRENCY);
      const wave = items.slice(cursor, cursor + waveSize);
      cursor += waveSize;
      // Promise.all 保序 → 命中按推荐原始顺序进 out。
      const matched = await Promise.all(wave.map((r) => this.searchAndMatch(session, r)));
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
          (normalizeKey(it.title, it.artist) === wantKey || this.looseMatch(r, it)),
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
        .sort((a, b) => a.pen - b.pen || a.notExact - b.notExact || a.len - b.len);
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
      cover = await this.musicService.fetchCoverFallback(session, `${r.title} ${r.artist}`);
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
