/**
 * NL 检索 · 不变量门禁（specs/eval-driven-nl/ L0）。
 *
 * ## 为什么要有这一层
 *
 * `eval-genre.ts`（真实链路评测）能抓 bug，但它**跑不进 CI**：要 DeepSeek key、
 * 要平台登录态。它是"事后体检"，不是"提交前的关卡"。
 *
 * L0 是提交前的关卡：把"风格纯度"翻译成一组**与基线无关**的硬性质。任一条不成立
 * → 这次改动破坏了检索层 → 拦。判据不依赖任何历史快照，所以不会有"基线腐烂"和
 * "diff 噪音"（这是 `scripts/coverage-diff-gate.js` 选"不比对 base 分支覆盖率"
 * 的同一个理由）。
 *
 * ## 每条不变量都对应一个真实 bug
 *
 * 2026-10-20 的真实链路评测抓出 4 个 bug，其中 3 个是结构性的、可以写成不变量
 * （见每条的 `catches` 字段）。第 4 个（缓存 key 不含构建参数）不是检索层的
 * 结构问题，而是"改动是否生效"的问题 —— 那类 bug **只能**靠"每次改动都自动跑
 * 一遍评测"抓，L0 结构上抓不到。
 *
 * 纯函数，无 IO。调用方负责把真实的 `buildPool` 产物 + 探针记录喂进来。
 */
import { normalizeKey } from '@maestro/common';
import { artistMatches } from './candidate-pool';

/** 探针：记录检索过程里"搜过谁"和"有没有拉私人 FM"。 */
export interface PoolProbe {
  /** 实际被搜索过的艺人（按搜索发起顺序）。 */
  searchedArtists: string[];
  /** 是否拉了平台私人 FM（intent 模式必须为 false）。 */
  radioFetched: boolean;
}

/** 检索过程的轨迹——不变量的输入。 */
export interface PoolTrace extends PoolProbe {
  /** 候选池（**最终顺序**——"种子块前置"这条要靠顺序判定）。
   *  `origin` 区分来源：`artist` = 深挖（种子/主干），`related-artist` = 相邻，
   *  `radio` = 私人 FM。 */
  candidates: Array<{ title: string; artist: string; origin?: string }>;
  /** 意图种子艺人（流派代表艺人）。 */
  seeds: string[];
  /** 被显式排除的艺人。 */
  excluded: string[];
  /** 本次请求要几首（"种子块能否填满队列"的判据）。 */
  requestedCount: number;
  /**
   * 实际被**深挖**的艺人（以种子身份被搜的）。
   *
   * 来自候选池结果的 `deepDivedArtists`。**不能**用搜索日志代替：相邻艺人里
   * 经常混着种子本人，看日志会把"被截断的种子"误判成"搜过了"。
   */
  deepDivedArtists?: string[];
}

export interface InvariantResult {
  id: string;
  pass: boolean;
  /** 人类可读的说明——失败时直接当报错文案用。 */
  detail: string;
  /** 这条不变量抓的是哪个真实 bug（写清楚才不会被当成"玄学门禁"忽略掉）。 */
  catches: string;
}

/**
 * 种子里"有贡献"的比例下限。
 *
 * 为什么不是 100%：一个冷门艺人在华语平台可能真的没有曲目（搜得到歌名、搜不到
 * 这个人），单个种子归零不该把整条链判死——但如果**多数**种子都没贡献，说明
 * 检索层整体失效（种子选得不对 / 搜索被限流 / 过滤太狠）。
 */
export const MIN_SEED_CONTRIBUTION_RATIO = 0.75;

function isSeedArtist(artist: string, seeds: string[]): boolean {
  return seeds.some((s) => artistMatches(artist, s));
}

/**
 * 跑全部不变量。**不抛异常**——调用方决定怎么用（门禁要拿到全部结果再一起报，
 * 只报第一条会让排查变成"改一个跑一次"）。
 */
export function checkPoolInvariants(trace: PoolTrace): InvariantResult[] {
  const out: InvariantResult[] = [];
  const cands = trace.candidates;
  const seeds = trace.seeds;
  const seedCands = cands.filter((c) => isSeedArtist(c.artist, seeds));

  // 1. intent 模式不拉私人 FM
  out.push({
    id: 'no-radio-in-intent-mode',
    pass: !trace.radioFetched,
    detail: trace.radioFetched
      ? 'intent 模式拉了平台私人 FM —— FM 是账号画像，最容易把风格带偏'
      : '未拉 FM',
    catches: '2026-10-20：FM 排在候选池里，"要爵士"被大流行淹没',
  });

  // 2. 每个种子都被**深挖**（origin='artist'），不是只作为相邻艺人被搜到
  //
  // ⚠️ 判据用 origin 而不是"搜过没有"：Deezer 的相关图经常把种子艺人自己也
  // 列进相邻艺人（Miles Davis 的相关艺人里就有 Chet Baker）——那么"截断掉的
  // 种子"照样会被搜到，只是身份是相邻艺人。深挖身份才代表"它作为种子被认真搜了"。
  const deepDivedSet = (trace.deepDivedArtists ?? []).map((a) => normalizeKey(a, ''));
  const isDeepDived = (s: string): boolean =>
    deepDivedSet.some((k) => k && artistMatches(k, s)) ||
    cands.some((c) => c.origin === 'artist' && artistMatches(c.artist, s));
  const notDeepDived = seeds.filter((s) => !isDeepDived(s));
  const deepDived = seeds.filter((s) => isDeepDived(s));
  out.push({
    id: 'all-seeds-searched',
    pass: notDeepDived.length === 0,
    detail:
      notDeepDived.length === 0
        ? `${seeds.length} 个种子全部被深挖（${deepDived.length}/${seeds.length}）`
        : `这些种子没被深挖（只当相邻艺人搜到不算）：${notDeepDived.join('、')}`,
    catches: '2026-10-20：anchorLimit 默认只深挖 3 个种子，第 4 位代表艺人被丢弃',
  });

  // 3. 种子大多要有贡献（单个别冷门艺人没有曲目属正常，见常量注释）
  const silent = seeds.filter((s) => !seedCands.some((c) => artistMatches(c.artist, s)));
  const contributionRatio = seeds.length ? (seeds.length - silent.length) / seeds.length : 1;
  out.push({
    id: 'seed-artists-contribute',
    pass: contributionRatio >= MIN_SEED_CONTRIBUTION_RATIO,
    detail:
      silent.length === 0
        ? '每个种子都有候选'
        : `${(contributionRatio * 100).toFixed(0)}% 的种子有候选（${seeds.length - silent.length}/${seeds.length}）` +
          `；没贡献：${silent.join('、')}`,
    catches: '种子失效（搜不到或全被时长/坏版本过滤）→ 风格无处可依',
  });

  // 4. 种子块前置（连续排在前，且在其它候选之前）
  const firstNonSeedIdx = cands.findIndex((c) => !isSeedArtist(c.artist, seeds));
  const lastSeedIdx = cands.map((c) => isSeedArtist(c.artist, seeds)).lastIndexOf(true);
  const blockFirst = firstNonSeedIdx === -1 || lastSeedIdx < firstNonSeedIdx;
  out.push({
    id: 'seed-block-first',
    pass: blockFirst,
    detail: blockFirst
      ? `种子块在前（${seedCands.length} 条）`
      : `种子块被打散（第 ${firstNonSeedIdx + 1} 条是种子，第 ${lastSeedIdx + 1} 条之后又出现种子）`,
    catches: '2026-10-20：交错合并让"相邻艺人"插到种子中间，模型和补位都先撞上它们',
  });

  // 5. 排除的艺人不进候选
  const leaked = cands.filter((c) => trace.excluded.some((e) => artistMatches(c.artist, e)));
  out.push({
    id: 'excluded-absent',
    pass: leaked.length === 0,
    detail:
      leaked.length === 0
        ? '排除项没漏'
        : `排除项漏进候选：${leaked.map((c) => `${c.title} — ${c.artist}`).join('、')}`,
    catches: '排除艺人是用户明说的负向约束，漏了就等于没排除',
  });

  // 6. 种子块能否填满队列（填不满 → 模型只能拿风格外的条目凑数）
  //    种子一个候选都没有 = 合法降级（冷门流派搜不到）→ 跳过本条，不误报。
  const seedFills = seedCands.length === 0 ? true : seedCands.length >= trace.requestedCount;
  out.push({
    id: 'seed-block-fills-request',
    pass: seedFills,
    detail:
      seedCands.length === 0
        ? '种子无候选 → 走兜底路径（跳过本条）'
        : seedFills
          ? `种子块 ${seedCands.length} 条 ≥ 请求 ${trace.requestedCount} 首`
          : `种子块只有 ${seedCands.length} 条 < 请求 ${trace.requestedCount} 首 → 模型会从风格外补数`,
    catches: '2026-10-20：中文民谣只有 6 首种子 < 12 → 模型被迫挑 6 首流行 OST 凑数',
  });

  // 7. 候选非空
  out.push({
    id: 'pool-not-empty',
    pass: cands.length > 0,
    detail: cands.length > 0 ? `${cands.length} 条候选` : '候选池是空的',
    catches: '检索崩了（种子全失败且兜底也没兜住）',
  });

  return out;
}

/** 不变量是否全过。 */
export function invariantsPass(results: InvariantResult[]): boolean {
  return results.every((r) => r.pass);
}

/** 人读的不变量报告（门禁失败时直接当报错文案）。 */
export function formatInvariantReport(results: InvariantResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.pass ? '  ✓' : '  ✗'} ${r.id}：${r.detail}`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    lines.push('');
    lines.push(`不变量门禁未通过（${failed.length}/${results.length} 条）：`);
    for (const r of failed) lines.push(`  ✗ ${r.id} —— ${r.catches}`);
  }
  return lines.join('\n');
}

/**
 * 造一个探针：给 fake provider 用。
 *
 * 用法：
 * ```ts
 * const probe = createPoolProbe();
 * const deps = {
 *   searchArtist: (a) => { probe.recordSearch(a); return items; },
 *   fetchRadio: () => { probe.recordRadio(); return []; },
 * };
 * ```
 */
export function createPoolProbe(): PoolProbe & {
  recordSearch(artist: string): void;
  recordRadio(): void;
} {
  return {
    searchedArtists: [],
    radioFetched: false,
    recordSearch(artist: string) {
      this.searchedArtists.push(artist);
    },
    recordRadio() {
      this.radioFetched = true;
    },
  };
}
