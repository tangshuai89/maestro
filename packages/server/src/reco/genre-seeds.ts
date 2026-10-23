/**
 * 流派 → 代表艺人映射 + 意图检索种子（specs/nl-intent-retrieval/）。
 *
 * 为什么需要这个文件：NL 歌单的"风格指令"以前只进 prompt（软提示），检索层
 * 完全由用户库的口味档案决定——「来点儿爵士乐」捞回来的全是陈奕迅/汪苏泷。
 * 修法是让**流派变成检索种子**：先按流派找到"这个风格长什么样"的代表艺人，
 * 再用这些艺人的名字去平台搜真实可播的曲目。
 *
 * 艺人是"流派 → 真实曲目"的桥：
 *  - 平台搜索"爵士乐"这种关键词，命中的是歌名/专辑里带这两个字的歌，噪声大；
 *  - 平台搜索"Miles Davis"，命中的是**真爵士曲库**，且每个 provider 都有
 *    对应条目（可播、可填源）。
 *
 * 两条来源，互补：
 *  1. LLM 的 `intent.genre_artists`（模型知道当下语境下最典型的该流派艺人）
 *  2. 本文件的映射表（LLM 偷懒不填时的兜底，纯确定性、无 token 成本）
 */

import { normalizeKey } from '@maestro/common';
import type { NLIntent } from './nl-intent';

/**
 * 流派 → 代表艺人。取"该流派公认的、几乎在所有平台都有曲目的"艺人——
 * 冷门/在世的新锐不进表（可能搜不到，反而浪费一次搜索）。
 */
const GENRE_ARTIST_MAP: Record<string, string[]> = {
  jazz: [
    'Miles Davis',
    'John Coltrane',
    'Chet Baker',
    'Dave Brubeck',
    'Ella Fitzgerald',
    'Thelonious Monk',
    'Duke Ellington',
    'Charles Mingus',
  ],
  rock: [
    'The Beatles',
    'The Rolling Stones',
    'Radiohead',
    'David Bowie',
    'Queen',
    '崔健',
    '朴树',
    '窦唯',
  ],
  electronic: [
    'Daft Punk',
    'Deadmau5',
    'Justice',
    'The Chemical Brothers',
    'Tiësto',
    'Avicii',
    'Zedd',
    'Fatboy Slim',
  ],
  classical: [
    'Ludwig van Beethoven',
    'Wolfgang Amadeus Mozart',
    'Johann Sebastian Bach',
    'Frederic Chopin',
    'Claude Debussy',
    'Johannes Brahms',
  ],
  folk: ['Bob Dylan', 'Simon & Garfunkel', '赵雷', '陈粒', '朴树', '马頔', '五月天'],
  rnb: ['陶喆', '方大同', 'Alicia Keys', 'Marvin Gaye', 'SZA', 'The Weeknd', '戴佩妮'],
  soul: ['Aretha Franklin', 'Otis Redding', 'Sam Cooke', 'Bill Withers', 'Amy Winehouse'],
  hiphop: ['Jay-Z', 'Kendrick Lamar', 'Eminem', 'Dr. Dre', 'MC HotDog', 'Higher Brothers'],
  blues: ['B.B. King', 'Muddy Waters', 'Robert Johnson', 'Etta James', 'Howlin’ Wolf'],
  funk: ['James Brown', 'Parliament', 'Earth, Wind & Fire', 'Sly and the Family Stone'],
  metal: ['Metallica', 'Black Sabbath', 'Iron Maiden', 'Slayer', '窦唯', '痛仰乐队'],
  postrock: ['Explosions in the Sky', 'Mogwai', 'Mono', 'Godspeed You! Black Emperor', '惘闻'],
  citypop: ['竹内まりや', '山下達郎', '角松敏生', '泰葉TOMIKO', 'Fine Young Cannibals'],
  bossa: ['João Gilberto', 'Antônio Carlos Jobim', 'Gilberto Gil', 'Astrud Gilberto'],
  anime: ['泽野弘之', '菅野よう子', 'RADWIMPS', '久石让', 'Yuki Kajiura', 'Vaundy'],
  chill: ['坂本龙一', 'Ludovico Einaudi', 'Brian Eno', 'Marconi Union', 'Hiroshi Yoshimura'],
  country: ['Johnny Cash', 'Willie Nelson', 'Taylor Swift', 'Dolly Parton', 'Chet Atkins'],
  reggae: ['Bob Marley', 'Peter Tosh', 'Damian Marley', 'Jimmy Cliff'],
  disco: ['Bee Gees', 'Donna Summer', 'Chic', 'Earth, Wind & Fire'],
  latin: ['Buena Vista Social Club', 'Juanes', 'Shakira', 'Celia Cruz'],
  ambient: ['Brian Eno', 'Stars of the Lid', 'Hiroshi Yoshimura', 'Harold Budd'],
  newage: ['Enya', 'Kitaro', 'Yanni', 'Secret Garden'],
  world: ['Cesária Évora', 'Ali Farka Touré', 'Of Monsters and Men'],
  indie: ['Arcade Fire', 'Tame Impala', 'Bon Iver', 'Fleet Foxes', '陈鸿宇'],
  afrobeat: ['Fela Kuti', 'Burna Boy', 'Wizkid', 'Davido', 'Tony Allen', 'Ebo Taylor'],
};

/**
 * 别名 → 规范 key。中文写法与英文写法指向同一条记录（"爵士"/"爵士乐"/"jazz"）。
 * key 用**归一后**的字符串（小写 + 去分隔符）。
 */
const GENRE_ALIASES: Record<string, string> = {
  // jazz
  jazz: 'jazz',
  爵士: 'jazz',
  爵士乐: 'jazz',
  爵士融合: 'jazz',
  jazzfusion: 'jazz',
  爵士摇滚: 'jazz',
  jazzrock: 'jazz',
  bebop: 'jazz',
  swing: 'jazz',
  摇摆: 'jazz',
  bossanova: 'bossa',
  bossa: 'bossa',
  // rock
  rock: 'rock',
  摇滚: 'rock',
  摇滚乐: 'rock',
  经典摇滚: 'rock',
  classicrock: 'rock',
  alternative: 'rock',
  另类: 'rock',
  indie: 'indie',
  独立: 'indie',
  独立摇滚: 'indie',
  postpunk: 'rock',
  后朋克: 'rock',
  grunge: 'rock',
  垃圾摇滚: 'rock',
  // electronic
  electronic: 'electronic',
  electronica: 'electronic',
  电子: 'electronic',
  电子乐: 'electronic',
  电音: 'electronic',
  edm: 'electronic',
  house: 'electronic',
  techno: 'electronic',
  浩室: 'electronic',
  trance: 'electronic',
  progressivehouse: 'electronic',
  proghouse: 'electronic',
  electrohouse: 'electronic',
  techhouse: 'electronic',
  迷幻电子: 'electronic',
  synthwave: 'electronic',
  合成器: 'electronic',
  dnb: 'electronic',
  drumandbass: 'electronic',
  futuregarage: 'electronic',
  // classical
  classical: 'classical',
  古典: 'classical',
  古典乐: 'classical',
  交响乐: 'classical',
  钢琴曲: 'classical',
  协奏曲: 'classical',
  opera: 'classical',
  歌剧: 'classical',
  // folk
  folk: 'folk',
  民谣: 'folk',
  民谣音乐: 'folk',
  countryfolk: 'folk',
  chinesefolk: 'folk',
  mandarinfolk: 'folk',
  // rnb / soul
  rnb: 'rnb',
  节奏布鲁斯: 'rnb',
  节奏蓝调: 'rnb',
  soul: 'soul',
  灵魂乐: 'soul',
  灵魂: 'soul',
  'neo soul': 'soul',
  neosoul: 'soul',
  motown: 'soul',
  // hiphop
  hiphop: 'hiphop',
  说唱: 'hiphop',
  说唱乐: 'hiphop',
  rap: 'hiphop',
  说唱歌: 'hiphop',
  hiphoprap: 'hiphop',
  // blues / funk
  blues: 'blues',
  蓝调: 'blues',
  布鲁斯: 'blues',
  funk: 'funk',
  放克: 'funk',
  // metal / punk
  metal: 'metal',
  金属: 'metal',
  金属乐: 'metal',
  heavymetal: 'metal',
  punk: 'rock',
  朋克: 'rock',
  // others
  afrobeat: 'afrobeat',
  afrobeats: 'afrobeat',
  afrofusion: 'afrobeat',
  非洲节奏: 'afrobeat',
  postrock: 'postrock',
  后摇: 'postrock',
  shoegaze: 'postrock',
  citypop: 'citypop',
  'city pop': 'citypop',
  都市流行: 'citypop',
  城市流行: 'citypop',
  anime: 'anime',
  二次元: 'anime',
  动漫: 'anime',
  动画: 'anime',
  acg: 'anime',
  chill: 'chill',
  轻音乐: 'chill',
  纯音乐: 'chill',
  纯音: 'chill',
  ambient: 'ambient',
  氛围音乐: 'ambient',
  环境音乐: 'ambient',
  newage: 'newage',
  新世纪: 'newage',
  country: 'country',
  乡村: 'country',
  乡村音乐: 'country',
  reggae: 'reggae',
  雷鬼: 'reggae',
  牙买加: 'reggae',
  disco: 'disco',
  迪斯科: 'disco',
  latin: 'latin',
  拉丁: 'latin',
  world: 'world',
  世界音乐: 'world',
  worldmusic: 'world',
};

/** 流派种子总数上限——每个种子 = 一次 4 平台搜索，不能太多（延迟）。 */
export const MAX_INTENT_ARTIST_SEEDS = 8;
/** 单个流派最多取几个代表艺人。
 *  6（不是 4）：每位种子在平台上能捞到的曲目有限（中文民谣实测人均 2 首），
 *  种子给少了候选池凑不满 12 首 → 系统只能拿风格外的歌凑数。 */
export const MAX_ARTISTS_PER_GENRE = 6;

/**
 * 归一流派字符串：去空白/分隔符 → 小写 → 查别名表。
 * 查不到时返回归一后的原串（未收录的流派仍可走 LLM 的 genre_artists）。
 */
export function normalizeGenreKey(genre: string): string {
  const cleaned = (genre ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s·・\-_/&|,，、]+/g, '');
  if (!cleaned) return '';
  return GENRE_ALIASES[cleaned] ?? cleaned;
}

/** 流派的代表艺人（映射表）。未收录的流派返回空数组。 */
export function genreArtists(genre: string): string[] {
  const key = normalizeGenreKey(genre);
  if (!key) return [];
  return GENRE_ARTIST_MAP[key] ?? [];
}

/** 我们认识的规范流派 key（= 映射表的键）。 */
export const KNOWN_GENRE_KEYS: ReadonlySet<string> = new Set(Object.keys(GENRE_ARTIST_MAP));

/**
 * 别名 → 规范 key，按**别名长度倒序**排好（长的先试）。
 * 用途：把 "chinese folk" / "electro house" 这类复合写法落到规范流派上——
 * 先试长的（"electro house" 命中 electronic 家族），再试短的（"house"）。
 */
const ALIAS_BY_LENGTH: Array<[string, string]> = Object.entries(GENRE_ALIASES).sort(
  (a, b) => b[0].length - a[0].length,
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 解析一个（可能是复合的）流派标签 → 规范流派 key。
 *
 * 三步：
 *  1. 精确命中别名表 → 直接返回（"jazz" / "爵士乐" / "city pop"）
 *  2. 否则按**词边界**在标签里找已知流派（"chinese folk" → folk、
 *     "electro house" → electronic、"rock and roll" → rock）
 *  3. 都不中 → 返回归一后的原串（未知流派，判定时不命中任何期望）
 *
 * 词边界很关键：没有它，"children's music" 会因为含 "chill" 被误判成 chill。
 */
export function resolveGenreTag(tag: string): string {
  const raw = (tag ?? '').trim();
  if (!raw) return '';
  const exact = normalizeGenreKey(raw);
  if (exact && KNOWN_GENRE_KEYS.has(exact)) return exact;

  const lower = raw.toLowerCase();
  for (const [alias, canonical] of ALIAS_BY_LENGTH) {
    // 纯 ASCII 别名按词边界匹配；含中文的别名不参与（中文没有词边界概念，
    // 且 "民谣" 这类词嵌在长句里的概率极低，精确匹配已经够用）。
    if (!/^[\x20-\x7e]+$/.test(alias)) continue;
    const re = new RegExp(`(^|[^a-z])${escapeRe(alias)}([^a-z]|$)`, 'i');
    if (re.test(lower)) return canonical;
  }
  return exact;
}

/** "歌名 - 艺人" → 拆成两段；只有歌名时艺人留空。 */
export function parseTrackRef(ref: string): { title: string; artist: string } {
  const raw = (ref ?? '').trim();
  if (!raw) return { title: '', artist: '' };
  // 支持 " - " / " — " / " – " / " | " 四种分隔（LLM 输出不统一）。
  const m = raw.match(/^(.+?)\s+[-—–|]\s+(.+)$/);
  if (m) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: raw, artist: '' };
}

export interface IntentSeeds {
  /** 艺人种子——逐个深挖该艺人的库外曲目（顺序 = 优先级）。 */
  artists: string[];
  /** 参考曲目（"歌名 - 艺人" 或纯歌名）——艺人待解析。 */
  tracks: string[];
  /** 意图是否含"风格指令"（决定是否切到 intent 模式检索）。 */
  styleDirective: boolean;
}

/**
 * 意图 → 检索种子。顺序即优先级：
 *   1. `similar_artists`——用户点名的，最优先
 *   2. `genre_artists`——LLM 为该流派提的代表艺人
 *   3. 映射表兜底——LLM 没提该流派时补上
 *   4. `similar_tracks` 里的艺人（"歌名 - 艺人" 能直接拆出艺人）
 *
 * 只写 `exclude_*` 的意图**不**产生风格指令（排除是减法，不该改检索方向）。
 */
export function buildIntentSeeds(intent: NLIntent): IntentSeeds {
  const artists: string[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    const v = (name ?? '').trim();
    if (!v) return;
    const key = normalizeKey(v, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    artists.push(v);
  };

  // 1. 用户点名的 similar_artists
  for (const a of intent.similar_artists ?? []) push(a);

  // 2 + 3. 流派：LLM 提的代表艺人优先，映射表补位
  const genres = intent.genres ?? [];
  const llmGenres = new Set<string>();
  for (const g of intent.genre_artists ?? []) {
    const genreName = (g?.genre ?? '').trim();
    if (!genreName) continue;
    llmGenres.add(normalizeGenreKey(genreName));
    for (const a of (g?.artists ?? []).slice(0, MAX_ARTISTS_PER_GENRE)) push(a);
  }
  for (const g of genres) {
    if (llmGenres.has(normalizeGenreKey(g))) continue;
    for (const a of genreArtists(g).slice(0, MAX_ARTISTS_PER_GENRE)) push(a);
  }

  // 4. 参考曲目：能拆出艺人的直接进种子；只有歌名的留给调用方解析
  const tracks: string[] = [];
  for (const t of intent.similar_tracks ?? []) {
    const raw = (t ?? '').trim();
    if (!raw) continue;
    const { title, artist } = parseTrackRef(raw);
    if (!title) continue;
    if (artist) push(artist);
    else tracks.push(title);
  }

  const styleDirective =
    genres.length > 0 ||
    (intent.similar_artists?.length ?? 0) > 0 ||
    (intent.similar_tracks?.length ?? 0) > 0;

  return {
    artists: artists.slice(0, MAX_INTENT_ARTIST_SEEDS),
    tracks: tracks.slice(0, 4),
    styleDirective,
  };
}
