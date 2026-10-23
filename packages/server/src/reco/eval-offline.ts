/**
 * NL 检索 · 离线回放评测（specs/eval-driven-nl/ L1）。
 *
 * ## 它解决什么
 *
 * 真实链路评测（`eval-genre.ts`）能抓 bug，但它**跑不进 CI**：要 DeepSeek key、
 * 要平台登录态。它是"事后体检"。L1 是"提交前的关卡"——靠**录制回放**把两处
 * 不确定性消掉：
 *
 *  1. **平台搜索结果**每次都不一样 → 录成 fixture（`__fixtures__/nl-search.json`）
 *  2. **LLM 流派判定**要花钱 → 换成**黄金集**（`__fixtures__/genre-golden.json`，
 *     人工标注，冻结进仓库）
 *
 * 于是：同样的 fixture + 同样的黄金集 → **同样的数字**。0 元、0 网络、确定性。
 *
 * ## 关键设计：走真实代码路径
 *
 * 本模块**不另写一份池构建**——它构造一个 fixture 支撑的 fake provider，交给
 * **真正的** `RecoService.buildPool` 跑（参数、配额、分组、缓存 key 全部是真的）。
 * 理由与 `scripts/coverage-diff-gate.js` 相同：自测/副本里另写一份的话，判据改坏了
 * 它照样绿——测的就不是真身了。
 *
 * ## 覆盖与不覆盖（诚实说明）
 *
 * - ✅ **检索层**：种子怎么选、搜谁、每人取几条、顺序怎么排、排除生效吗
 * - ✅ **策展层的结果**：录制的 LLM picks 是否还在池里（`pickRetention`）、
 *   重放队列的纯度
 * - ❌ **策展过程本身**（LLM 在选的时候怎么想的）→ 只能靠 L2 真实链路
 * - ❌ **平台现状**（fixture 是某一天的结果）→ L1 是"逻辑回归网"，L2 才是真实校准
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeKey } from '@maestro/common';
import { RecoService, type IntentPoolParams } from './reco.service';
import { checkPoolInvariants, createPoolProbe, type InvariantResult } from './eval-invariants';
import { artistMatches } from './candidate-pool';
import { resolveGenreTag } from './genre-seeds';
import { DEFAULT_GENRE_SCENARIOS } from './eval-genre';

/** fixture 里的一条曲目（裁剪过的最小形状）。 */
export interface FixtureItem {
  title: string;
  artist: string;
  album: string;
  duration: number;
  bestSource: string | null;
  versionType: string;
  /**
   * 这首在**用户库里**吗？
   *
   * 必录：库内去重会把用户已有的曲目从候选池里剔掉 → 直接改变池的构成。
   * 不带这个标记，离线评测复现不出"库里的好歌被滤光 → 种子块凑不满 → 模型
   * 从漂移的相邻艺人凑数"这条失败路径（2026-10-23 真实链路评测才暴露）。
   */
  inLibrary?: boolean;
}

export interface FixtureScenario {
  id: string;
  text: string;
  expect: string[];
  adjacent: string[];
  intent: unknown;
  seeds: string[];
  related: Record<string, string[]>;
  search: Record<string, FixtureItem[]>;
  /** 策展层实际选中的曲目（LLM picks → 标题+艺人，**不是下标**：下标会随池变化失效）。 */
  picks: Array<{ title: string; artist: string }>;
  queue: FixtureItem[];
}

export interface NlFixture {
  recordedAt: string;
  sessionId: string;
  librarySize: number;
  /** 库主干艺人（冷门流派兜底路径要重放）。 */
  anchors: string[];
  anchorSearch: Record<string, FixtureItem[]>;
  scenarios: Record<string, FixtureScenario>;
}

/** 黄金集：`"歌名|艺人"` → 流派标签。 */
export type GoldenTags = Record<string, string[]>;

export const DEFAULT_FIXTURE_DIR = path.resolve(__dirname, '__fixtures__');
export const DEFAULT_BASELINE_PATH = path.resolve(
  __dirname,
  '../../../../specs/eval-driven-nl/baseline.json',
);

/** 黄金集覆盖率低于这个值 → **拒绝给结论**（不按"通过"算）。 */
export const MIN_GOLDEN_COVERAGE = 0.5;

export function loadFixture(dir: string = DEFAULT_FIXTURE_DIR): NlFixture {
  const p = path.join(dir, 'nl-search.json');
  if (!fs.existsSync(p)) {
    throw new Error(
      `fixture 不存在：${p}\n` +
        `  用 node scripts/record-nl-fixtures.mjs 录一份（需要 DeepSeek key + 平台登录态）`,
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as NlFixture;
}

export function loadGolden(dir: string = DEFAULT_FIXTURE_DIR): GoldenTags {
  const p = path.join(dir, 'genre-golden.json');
  if (!fs.existsSync(p)) {
    throw new Error(
      `黄金集不存在：${p}\n` +
        `  用 node scripts/record-nl-fixtures.mjs 录一份（需要 DeepSeek key + 平台登录态）`,
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as GoldenTags;
}

/** fixture 条目 → 候选池认识的形状。 */
function toPoolItem(it: FixtureItem): Record<string, unknown> {
  return {
    id: `${it.artist}-${it.title}`,
    title: it.title,
    artist: it.artist,
    album: it.album ?? '',
    coverUrl: '',
    duration: it.duration ?? 0,
    sources: it.bestSource ? [{ platform: it.bestSource, trackId: 'fixture' }] : [],
    bestSource: it.bestSource,
    versionType: (it.versionType ?? 'studio') as 'studio',
    versions: [],
  };
}

function goldenKey(title: string, artist: string): string {
  return `${title}|${artist}`;
}

/** 黄金集里这首歌的标签（归一后）。 */
function tagsOf(item: { title: string; artist: string }, golden: GoldenTags): string[] {
  const direct = golden[goldenKey(item.title, item.artist)];
  if (direct) return direct.map(resolveGenreTag).filter(Boolean);
  // 归一键兜底（fixture 与黄金集里的大小写/空格不一致时也能命中）
  const want = normalizeKey(item.title, item.artist);
  for (const [k, v] of Object.entries(golden)) {
    const [t, a] = k.split('|');
    if (normalizeKey(t ?? '', a ?? '') === want) return v.map(resolveGenreTag).filter(Boolean);
  }
  return [];
}

export interface OfflineScenarioResult {
  id: string;
  text: string;
  expect: string[];
  seeds: string[];
  /** 候选池大小。 */
  poolSize: number;
  /** 种子块大小（模型实际会先看到的那些）。 */
  seedBlockSize: number;
  /** 种子块的黄金标签命中率（宽松：相邻子风格也算）——**检索层风格纯度**。 */
  seedBlockPurity: number;
  /** 严格版（只认期望流派）——作对照，不参与判定。 */
  seedBlockPurityStrict: number;
  /** 整个池的命中率（含相邻艺人，可能漂）。 */
  poolPurity: number;
  /** 录制的 LLM picks 里还在池中的比例（策展层是否还成立）。 */
  pickRetention: number;
  /** 重放队列（picks ∩ 池 + 池序补位）的纯度。 */
  queuePurity: number;
  /** 黄金集覆盖率——池里被标注的比例。低于阈值 → 不给结论。 */
  goldenCoverage: number;
  invariants: InvariantResult[];
  /** 通过 = 不变量全过 + 种子块纯度达标 + 黄金集覆盖够。 */
  pass: boolean;
  /** 拒绝给结论的原因（黄金集覆盖不足时）。 */
  inconclusive?: string;
}

export interface OfflineReport {
  at: number;
  fixtureRecordedAt: string;
  count: number;
  scenarios: OfflineScenarioResult[];
  average: {
    seedBlockPurity: number;
    poolPurity: number;
    queuePurity: number;
    pickRetention: number;
    goldenCoverage: number;
    passRate: number;
  };
}

/**
 * 跑一个场景的离线评测。
 *
 * @param scenario fixture 里的场景
 * @param fixture  整个 fixture（兜底路径要用主干艺人）
 * @param golden   黄金集
 * @param count    请求条数（默认 12）
 */
export async function evaluateOfflineScenario(
  scenario: FixtureScenario,
  fixture: NlFixture,
  golden: GoldenTags,
  count = 12,
  /** 覆盖 intent 池参数（评测扫描用；生产路径传 undefined = 默认值）。 */
  poolParams?: IntentPoolParams,
  /**
   * 期望流派（严格）与相邻子风格（宽松）。
   *
   * ⚠️ 必须取**当前**的评测定义，不能取 fixture 里录的：期望值是**判据**，
   * 属于评测；fixture 只提供**数据**（intent / 种子 / 搜索结果 / picks）。
   * 判据改了要能立刻生效——不该为了改判据去重录 fixture。
   */
  expect?: string[],
  adjacent?: string[],
): Promise<OfflineScenarioResult> {
  const probe = createPoolProbe();
  const search = scenario.search ?? {};
  const related = scenario.related ?? {};

  // fixture 支撑的 fake provider（不出网）
  const music = {
    getLibrary: () => null,
    searchUnified: async (_s: unknown, kw: string) => {
      probe.recordSearch(kw);
      const items = (search[kw] ?? []).map(toPoolItem);
      return { items };
    },
    findRelatedArtists: async (_s: unknown, artist: string) => {
      probe.recordSearch(`related:${artist}`);
      return related[artist] ?? [];
    },
    fetchRecoRadioCandidates: async () => {
      probe.recordRadio();
      return [];
    },
  };
  const svc = new RecoService(
    { get: () => undefined } as never,
    { get: () => undefined, set: () => {} } as never,
    { resolve: () => ({ id: 'offline' }) } as never,
    music as never,
  );

  const seeds = scenario.seeds ?? [];
  // 库内去重：用户已有的曲目不进候选（与真实链路同口径）。
  // 记在 fixture 的每条结果上（inLibrary），离线评测据此复现同样的"池被滤掉"。
  const inLibrary = Object.values(search)
    .flat()
    .filter((it) => it.inLibrary)
    .map((it) => ({ title: it.title, artist: it.artist }));

  const built = await svc['buildPool'](
    { id: 'offline' } as never,
    {
      size: 0,
      signature: 'offline',
      artists: [],
      anchors: fixture.anchors ?? [],
      seeds: [],
    } as never,
    // 库内曲目走**library 参数**（真实路径就是库内去重），不是 exclude 列表
    inLibrary as never,
    [],
    count,
    undefined,
    undefined,
    { noCache: true },
    {
      intentSeeds: { artists: seeds, tracks: [], styleDirective: true },
      ...(poolParams ? { poolParams } : {}),
    },
  );
  const pool = built.pool.candidates;

  // 种子块 = 候选里属于种子的那部分（它们连续排在前面）
  const isSeed = (artist: string): boolean => seeds.some((s) => artistMatches(artist, s));
  const seedBlock = pool.filter((c) => isSeed(c.artist));

  // 纯度：黄金标签命中期望流派的比例（**只在有标注的条目上算分母**）
  // strict = 只认期望流派；loose = 期望 + 相邻子风格（"八十年代合成器"里的
  // new wave / synth-pop 属于该流派，不该被判成跑偏）。
  const purity = (
    items: Array<{ title: string; artist: string }>,
    expect: string[],
    adjacent: string[],
  ): { purity: number; loose: number; coverage: number } => {
    const expectKeys = new Set(expect.map(resolveGenreTag).filter(Boolean));
    const adjacentKeys = new Set(adjacent.map(resolveGenreTag).filter(Boolean));
    let tagged = 0;
    let hit = 0;
    let looseHit = 0;
    for (const it of items) {
      const tags = tagsOf(it, golden);
      if (!tags.length) continue;
      tagged++;
      const strictHit = tags.some((t) => expectKeys.has(t));
      if (strictHit) hit++;
      if (strictHit || tags.some((t) => adjacentKeys.has(t))) looseHit++;
    }
    return {
      purity: tagged ? hit / tagged : 0,
      loose: tagged ? looseHit / tagged : 0,
      coverage: items.length ? tagged / items.length : 0,
    };
  };

  const expectSet = expect ?? scenario.expect ?? [];
  const adjacentSet = adjacent ?? scenario.adjacent ?? [];
  const seedBlockPurity = purity(seedBlock, expectSet, adjacentSet);
  const poolPurity = purity(pool, expectSet, adjacentSet);

  // 策展层重放：录制的 picks 里还在池中的算保留；队列 = 保留的 picks + 池序补位
  const poolKeys = new Set(pool.map((c) => normalizeKey(c.title, c.artist)));
  const picks = scenario.picks ?? [];
  const retained = picks.filter((p) => poolKeys.has(normalizeKey(p.title, p.artist)));
  const pickRetention = picks.length ? retained.length / picks.length : 0;
  const queue: Array<{ title: string; artist: string }> = [
    ...retained,
    ...pool
      .filter(
        (c) =>
          !retained.some(
            (p) => normalizeKey(p.title, p.artist) === normalizeKey(c.title, c.artist),
          ),
      )
      .map((c) => ({ title: c.title, artist: c.artist })),
  ].slice(0, count);
  const queuePurity = purity(queue, expectSet, adjacentSet);

  const invariants = checkPoolInvariants({
    ...probe,
    candidates: pool.map((c) => ({ title: c.title, artist: c.artist, origin: c.origin })),
    deepDivedArtists: built.pool.deepDivedArtists ?? [],
    seeds,
    excluded: [],
    requestedCount: count,
  });

  // 黄金集覆盖不足 → **拒绝给结论**（不按"通过"算，也不按"不通过"算）
  const goldenCoverage = poolPurity.coverage;
  const inconclusive =
    goldenCoverage < MIN_GOLDEN_COVERAGE
      ? `黄金集覆盖率 ${(goldenCoverage * 100).toFixed(1)}% < ${(MIN_GOLDEN_COVERAGE * 100).toFixed(0)}% —— 判定不可信，拒绝给结论`
      : undefined;

  const pass =
    !inconclusive &&
    invariants.every((r) => r.pass) &&
    // 用**宽松**纯度（相邻子风格也算）——严格值作为对照一起报出来
    seedBlockPurity.loose >= 0.7 &&
    poolPurity.coverage >= MIN_GOLDEN_COVERAGE;

  return {
    id: scenario.id,
    text: scenario.text,
    expect: expectSet,
    seeds,
    poolSize: pool.length,
    seedBlockSize: seedBlock.length,
    seedBlockPurity: seedBlockPurity.loose,
    seedBlockPurityStrict: seedBlockPurity.purity,
    poolPurity: poolPurity.loose,
    pickRetention,
    queuePurity: queuePurity.purity,
    goldenCoverage,
    invariants,
    pass,
    ...(inconclusive ? { inconclusive } : {}),
  };
}

export interface OfflineEvalOptions {
  fixtureDir?: string;
  count?: number;
  /** 只跑这些场景 id。 */
  only?: string[];
}

/** 跑全部场景。 */
export async function runOfflineEval(opts: OfflineEvalOptions = {}): Promise<OfflineReport> {
  const dir = opts.fixtureDir ?? DEFAULT_FIXTURE_DIR;
  const fixture = loadFixture(dir);
  const golden = loadGolden(dir);
  const count = opts.count ?? 12;
  const list = Object.values(fixture.scenarios).filter(
    (s) => !opts.only?.length || opts.only.includes(s.id),
  );
  // 判据取**当前**的场景定义（expect / adjacent）；fixture 只提供数据。
  // fixture 里有评测不认识的场景 → fail loud（fixture 过期了）。
  const defs = new Map(DEFAULT_GENRE_SCENARIOS.map((s) => [s.id, s]));
  const scenarios: OfflineScenarioResult[] = [];
  for (const sc of list) {
    const def = defs.get(sc.id);
    if (!def) {
      throw new Error(
        `fixture 里的场景 [${sc.id}] 在当前评测定义里不存在——` +
          `要么改回场景名，要么重新录制 fixture（node scripts/record-nl-fixtures.mjs）`,
      );
    }
    scenarios.push(
      await evaluateOfflineScenario(
        sc,
        fixture,
        golden,
        count,
        undefined,
        def.expect,
        def.adjacent ?? [],
      ),
    );
  }
  const mean = (pick: (r: OfflineScenarioResult) => number): number =>
    scenarios.length ? scenarios.reduce((s, r) => s + pick(r), 0) / scenarios.length : 0;
  return {
    at: Date.now(),
    fixtureRecordedAt: fixture.recordedAt,
    count,
    scenarios,
    average: {
      seedBlockPurity: mean((r) => r.seedBlockPurity),
      poolPurity: mean((r) => r.poolPurity),
      queuePurity: mean((r) => r.queuePurity),
      pickRetention: mean((r) => r.pickRetention),
      goldenCoverage: mean((r) => r.goldenCoverage),
      passRate: mean((r) => (r.pass ? 1 : 0)),
    },
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 人读报告。 */
export function formatOfflineReport(report: OfflineReport): string {
  const a = report.average;
  const lines = [
    `NL 检索 · 离线回放评测｜fixture 录于 ${report.fixtureRecordedAt}｜每例 ${report.count} 首｜${report.scenarios.length} 个场景`,
    '',
    `检索层  种子块纯度 ${pct(a.seedBlockPurity)}｜全池纯度 ${pct(a.poolPurity)}`,
    `策展层  队列纯度   ${pct(a.queuePurity)}｜picks 保留率 ${pct(a.pickRetention)}`,
    `黄金集  覆盖率     ${pct(a.goldenCoverage)}（低于 ${pct(MIN_GOLDEN_COVERAGE)} 不给结论）`,
    `通过率  ${pct(a.passRate)}`,
  ];
  for (const s of report.scenarios) {
    lines.push(
      '',
      `${s.pass ? '✅' : '❌'} [${s.id}] ${s.text}`,
      `   种子=${s.seeds.slice(0, 4).join('、') || '—'}｜池 ${s.poolSize}（种子块 ${s.seedBlockSize}）`,
      `   种子块纯度 ${pct(s.seedBlockPurity)}（严格 ${pct(s.seedBlockPurityStrict)}）｜全池 ${pct(s.poolPurity)}｜队列 ${pct(s.queuePurity)}` +
        `｜picks 保留 ${pct(s.pickRetention)}｜黄金覆盖 ${pct(s.goldenCoverage)}`,
    );
    if (s.inconclusive) lines.push(`   ⚠️ ${s.inconclusive}`);
    for (const inv of s.invariants.filter((i) => !i.pass)) {
      lines.push(`   ✗ ${inv.id}：${inv.detail}`);
    }
  }
  return lines.join('\n');
}

/** 与入库基线对比。`tolerancePt` 是允许的下降百分点。 */
export function compareOfflineToBaseline(
  baseline: { scenarios: Array<{ id: string; seedBlockPurity: number; queuePurity: number }> },
  report: OfflineReport,
  tolerancePt = 5,
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const cur of report.scenarios) {
    const base = baseline.scenarios.find((s) => s.id === cur.id);
    if (!base) {
      lines.push(`  ⚠️ [${cur.id}] 基线里没有这个场景（新增的？请更新基线）`);
      ok = false;
      continue;
    }
    const seedDelta = (cur.seedBlockPurity - base.seedBlockPurity) * 100;
    const queueDelta = (cur.queuePurity - base.queuePurity) * 100;
    const bad = seedDelta < -tolerancePt || queueDelta < -tolerancePt;
    if (bad) ok = false;
    lines.push(
      `  ${bad ? '❌' : '✅'} ${cur.id.padEnd(14)} 种子块 ${pct(base.seedBlockPurity).padStart(7)} → ${pct(cur.seedBlockPurity).padStart(7)}` +
        ` (${seedDelta >= 0 ? '+' : ''}${seedDelta.toFixed(1)}pt)｜队列 ${pct(base.queuePurity).padStart(7)} → ${pct(cur.queuePurity).padStart(7)}` +
        ` (${queueDelta >= 0 ? '+' : ''}${queueDelta.toFixed(1)}pt)`,
    );
  }
  return { ok, lines };
}
