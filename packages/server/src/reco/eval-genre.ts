/**
 * NL 歌单 · 风格纯度评测（pure 层）。
 *
 * **为什么需要它**：留一法评测（`eval.ts`）测的是"能不能推回藏起来的歌"——
 * 那是**口味**问题。NL 歌单要回答的是另一个问题：**用户说"来点爵士"，队列里
 * 到底有多少是真的爵士**。2026-10-20 的线上问题正是这一维度的塌方（要爵士，
 * 给出 12 首大流行），而当时**没有任何数字能暴露它**——只能靠人眼看。
 *
 * 三类指标，分工不同：
 *  - **检索层纯度** `seedCoverage`：队列里有多少首来自**意图种子艺人**
 *    （流派代表艺人）。免费、确定——种子是风格锚，命中越多说明检索层越"听话"。
 *  - **策展层纯度** `tagPurity`：LLM 逐首判定的流派里，有多少首命中期望流派。
 *    这才对应用户的真实体感（"这首到底算不算爵士"）。要花一次 LLM 调用。
 *  - **口味污染** `libraryLeak` / `anchorLeak`：队列里有多少首的**艺人**出现在
 *    用户库里（尤其主干艺人）。这是"要爵士给大流行"的**直接指纹**——
 *    改造前这两项接近 100%，改造后应该趋近 0。免费、确定。
 *
 * 三个指标缺一不可：seedCoverage 高但 tagPurity 低 = 种子对、策展跑偏；
 * tagPurity 高但 libraryLeak 高 = 风格对了但掺了回音壁；两者都高才是健康。
 *
 * 纯函数，无 IO，单测覆盖全部口径。
 */
import { normalizeKey } from '@maestro/common';
import { artistMatches } from './candidate-pool';
import { resolveGenreTag } from './genre-seeds';

/** 一个评测场景：一句话需求 + 期望命中的流派。 */
export interface GenreScenario {
  id: string;
  /** 喂给 parse-intent 的自然语言。 */
  text: string;
  /** 期望命中的规范流派 key（比较前会过 resolveGenreTag 归一）。 */
  expect: string[];
  /** 宽松命中：相邻流派也算过（不计入严格纯度，只进 tagPurityLoose）。 */
  adjacent?: string[];
}

/**
 * 默认场景组。覆盖三种典型诉求：
 *  - 纯流派（"来点儿爵士乐"）→ 曾经完全塌方的那一类
 *  - 场景 + 流派（"夜跑的电子乐"）→ 流派 + 情绪叠加
 *  - 流派 + 排除（"九十年代摇滚，排除周杰伦"）→ 流派 + 负向约束
 *  - 参照型（"像 Deadmau5 那种 prog house"）→ similar_artists 参与检索的那一类
 */
export const DEFAULT_GENRE_SCENARIOS: GenreScenario[] = [
  { id: 'jazz', text: '来点儿爵士乐', expect: ['jazz'] },
  { id: 'electronic', text: '放点适合夜跑的电子乐', expect: ['electronic'] },
  { id: 'rock90s', text: '九十年代摇滚，排除周杰伦', expect: ['rock'] },
  { id: 'folk', text: '周末慵懒的中文民谣', expect: ['folk'] },
  {
    id: 'prog-house',
    text: '像 Deadmau5 那种 prog house，节奏快一点',
    expect: ['electronic'],
  },
];

/** 通过阈值（可按体感调整）。 */
export const GENRE_PURITY_THRESHOLDS = {
  /** 严格流派纯度下限（LLM 判定时用）。 */
  tagPurity: 0.7,
  /** 无 LLM 判定时，用检索层纯度代替。 */
  seedCoverage: 0.6,
  /** 口味污染上限：队列里来自用户库的艺人占比。 */
  libraryLeak: 0.2,
} as const;

/** 队列里的一首歌（+ 判定出的流派标签）。 */
export interface GenrePurityItem {
  title: string;
  artist: string;
  /** 判定出的流派（归一后）；未判定 = 空数组。 */
  tags: string[];
}

export interface GenrePurityCase {
  id: string;
  text: string;
  expect: string[];
  /** parse-intent 解析出的流派。 */
  genres: string[];
  /** 检索种子（代表艺人）。 */
  seeds: string[];
  /** 走的哪条路径：`select` = 候选池里挑（风格可控）；`generate` = 自由生成（易稀释）。 */
  mode?: 'select' | 'generate';
  items: GenrePurityItem[];
  /** 检索层纯度：命中种子艺人的占比。 */
  seedCoverage: number;
  /** 策展层纯度：LLM 判定命中期望流派的占比（未判定 = 0）。 */
  tagPurity: number;
  /** 宽松策展纯度（相邻流派也算）。 */
  tagPurityLoose: number;
  /** 口味污染：艺人出现在用户库里的占比。 */
  libraryLeak: number;
  /** 污染源：艺人出现在库主干（top anchors）里的占比。 */
  anchorLeak: number;
  /** 是否做了 LLM 流派判定。 */
  judged: boolean;
  /**
   * **风格维度**是否达标——这是"通过"的主判据。
   * 口味污染（回音壁）不参与判定：用户要"九十年代摇滚"而他库里本来就有
   * U2/Cranberries，队列里出现它们**不是风格错误**（那是另一个维度的取舍）。
   * 把它混进 pass 会让告警变噪声，掩盖真正要抓的回归（风格被稀释）。
   */
  pass: boolean;
  /** 回音壁告警：队列里来自用户库的艺人占比超阈值（不参与 pass，只提示）。 */
  echoChamber: boolean;
}

export interface GenrePurityReport {
  at: number;
  model?: string;
  librarySize: number;
  count: number;
  cases: GenrePurityCase[];
  average: {
    seedCoverage: number;
    tagPurity: number;
    tagPurityLoose: number;
    libraryLeak: number;
    anchorLeak: number;
    passRate: number;
  };
}

/** 艺人归一键（与检索/去重同口径）。 */
function artistKey(artist: string): string {
  return normalizeKey(artist ?? '', '');
}

/**
 * 解析 LLM 的流派判定响应 → 每首一个标签数组（长度对齐 count）。
 *
 * 容忍三种形状：`{"tags": [["jazz"], ["pop"]]}` / 裸数组 / `{"items": [...]}`；
 * 元素可以是数组也可以是单个字符串。数量不足的补空数组（那首判为"未知"，
 * 不算命中），多出来的丢弃。解析失败 → null（调用方降级成"未判定"）。
 */
export function parseGenreTags(raw: string, count: number): string[][] | null {
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
  if (parsed == null) return null;
  let arr: unknown = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    arr = obj.tags ?? obj.items ?? obj.genres ?? obj.data;
  }
  if (!Array.isArray(arr)) return null;

  const out: string[][] = [];
  for (let i = 0; i < count; i++) {
    const v = arr[i];
    if (Array.isArray(v)) {
      out.push(
        v
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .map((x) => x.trim())
          .slice(0, 3),
      );
    } else if (typeof v === 'string' && v.trim()) {
      out.push([v.trim()]);
    } else {
      out.push([]);
    }
  }
  return out;
}

/** 集合：种子艺人 / 库艺人 / 主干艺人。 */
export interface GenrePurityContext {
  /** 意图种子艺人（流派代表艺人）。 */
  seeds: string[];
  /** 用户库里的全部艺人（归一后）。 */
  libraryArtists: Set<string>;
  /** 用户库的主干艺人（归一后）——污染源。 */
  anchorArtists: Set<string>;
}

/**
 * 算一个场景的三类指标。
 *
 * `tags` 与 `items` 一一对应（每首的流派标签）；传 null 表示没做 LLM 判定
 * （此时 tagPurity = 0，通过判定改用 seedCoverage）。
 */
export function computeGenrePurity(
  scenario: GenreScenario,
  input: {
    items: Array<{ title: string; artist: string }>;
    tags?: string[][] | null;
    genres?: string[];
    seeds?: string[];
    mode?: 'select' | 'generate';
  },
  ctx: GenrePurityContext,
): GenrePurityCase {
  const items: GenrePurityItem[] = input.items.map((it, i) => ({
    title: it.title,
    artist: it.artist,
    tags: (input.tags?.[i] ?? []).map(resolveGenreTag).filter(Boolean),
  }));
  const total = items.length;

  const seedHits = items.filter((i) => ctx.seeds.some((s) => artistMatches(i.artist, s))).length;

  const expectKeys = new Set(scenario.expect.map(resolveGenreTag).filter(Boolean));
  const adjacentKeys = new Set((scenario.adjacent ?? []).map(resolveGenreTag).filter(Boolean));
  let strict = 0;
  let loose = 0;
  for (const it of items) {
    const hit = it.tags.some((t) => expectKeys.has(t));
    if (hit) strict++;
    if (hit || it.tags.some((t) => adjacentKeys.has(t))) loose++;
  }

  const libraryHits = items.filter((i) => ctx.libraryArtists.has(artistKey(i.artist))).length;
  const anchorHits = items.filter((i) => ctx.anchorArtists.has(artistKey(i.artist))).length;

  const judged = Boolean(input.tags);
  const seedCoverage = total ? seedHits / total : 0;
  const tagPurity = total && judged ? strict / total : 0;
  const tagPurityLoose = total && judged ? loose / total : 0;
  const libraryLeak = total ? libraryHits / total : 0;
  const anchorLeak = total ? anchorHits / total : 0;

  const pass = judged
    ? tagPurity >= GENRE_PURITY_THRESHOLDS.tagPurity
    : seedCoverage >= GENRE_PURITY_THRESHOLDS.seedCoverage;
  const echoChamber = libraryLeak > GENRE_PURITY_THRESHOLDS.libraryLeak;

  return {
    id: scenario.id,
    text: scenario.text,
    expect: scenario.expect,
    genres: input.genres ?? [],
    seeds: input.seeds ?? [],
    mode: input.mode,
    items,
    seedCoverage,
    tagPurity,
    tagPurityLoose,
    libraryLeak,
    anchorLeak,
    judged,
    pass,
    echoChamber,
  };
}

/** 多场景汇总。 */
export function averageGenrePurity(cases: GenrePurityCase[]): GenrePurityReport['average'] {
  const mean = (pick: (c: GenrePurityCase) => number): number =>
    cases.length ? cases.reduce((s, c) => s + pick(c), 0) / cases.length : 0;
  return {
    seedCoverage: mean((c) => c.seedCoverage),
    tagPurity: mean((c) => c.tagPurity),
    tagPurityLoose: mean((c) => c.tagPurityLoose),
    libraryLeak: mean((c) => c.libraryLeak),
    anchorLeak: mean((c) => c.anchorLeak),
    passRate: mean((c) => (c.pass ? 1 : 0)),
  };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 人读报告（CLI 直接打印）。 */
export function formatGenrePurityReport(report: GenrePurityReport): string {
  const a = report.average;
  const lines = [
    `NL 歌单 · 风格纯度评测｜库 ${report.librarySize} 首｜每例 ${report.count} 首｜${report.cases.length} 个场景`,
    '',
    `检索层  种子覆盖率   ${pct(a.seedCoverage)}（阈值 ${pct(GENRE_PURITY_THRESHOLDS.seedCoverage)}）`,
    `策展层  流派纯度     ${pct(a.tagPurity)}（阈值 ${pct(GENRE_PURITY_THRESHOLDS.tagPurity)}）`,
    `污染    库艺人占比   ${pct(a.libraryLeak)}（上限 ${pct(GENRE_PURITY_THRESHOLDS.libraryLeak)}）`,
    `污染    主干艺人占比 ${pct(a.anchorLeak)}`,
    `通过率  ${pct(a.passRate)}`,
  ];
  for (const c of report.cases) {
    lines.push(
      '',
      `${c.pass ? '✅' : '❌'}${c.echoChamber ? ' ⚠️回音壁' : ''} [${c.id}] ${c.text}`,
      `   流派=${c.genres.join('、') || '—'}｜种子=${c.seeds.slice(0, 4).join('、') || '—'}` +
        (c.mode ? `｜路径=${c.mode}` : ''),
      `   种子覆盖 ${pct(c.seedCoverage)}｜流派纯度 ${c.judged ? pct(c.tagPurity) : '未判定'}` +
        `｜库污染 ${pct(c.libraryLeak)}｜主干污染 ${pct(c.anchorLeak)}`,
    );
    for (const it of c.items) {
      lines.push(
        `     - ${it.title} - ${it.artist}${it.tags.length ? `  [${it.tags.join('/')}]` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

/** 与基线对比（同一批场景才有意义）。 */
export function compareGenrePurityReports(
  baseline: GenrePurityReport,
  current: GenrePurityReport,
): string {
  const rows: Array<{ name: string; base: number; cur: number; higherBetter: boolean }> = [
    {
      name: '种子覆盖',
      base: baseline.average.seedCoverage,
      cur: current.average.seedCoverage,
      higherBetter: true,
    },
    {
      name: '流派纯度',
      base: baseline.average.tagPurity,
      cur: current.average.tagPurity,
      higherBetter: true,
    },
    {
      name: '库污染',
      base: baseline.average.libraryLeak,
      cur: current.average.libraryLeak,
      higherBetter: false,
    },
    {
      name: '主干污染',
      base: baseline.average.anchorLeak,
      cur: current.average.anchorLeak,
      higherBetter: false,
    },
    {
      name: '通过率',
      base: baseline.average.passRate,
      cur: current.average.passRate,
      higherBetter: true,
    },
  ];
  const lines = [`与基线对比（基线 ${new Date(baseline.at).toLocaleString()}）：`];
  for (const { name, base, cur, higherBetter } of rows) {
    const delta = cur - base;
    const better = higherBetter ? delta > 0 : delta < 0;
    const flag = Math.abs(delta) < 0.005 ? '  ' : better ? '✅' : '⚠️';
    const sign = delta > 0 ? '+' : '';
    lines.push(
      `  ${flag} ${name.padEnd(8)} ${pct(base).padStart(7)} → ${pct(cur).padStart(7)}  (${sign}${(delta * 100).toFixed(1)}pt)`,
    );
  }
  return lines.join('\n');
}
