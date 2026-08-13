// ─────────────────────────────────────────────────────────────────────────
// 歌名「翻译/别名」跨包共享（单一真值源）
//
// 背景：同一首歌在不同平台标题可以是不同语言/写法——「悲歌」= 韩语「애절가」、
// 「恋」= 罗马音「Koi」。语言转换（韩→中、汉字→罗马音）没有通用算法
// （韩语歌名不是规则映射；汉字读音要 kuromoji 且 renderer 带不动）。这类
// 用**策展别名表**做最后一公里：跟 artistAlias 同哲学——只桥明确名单，
// 不上算法猜测。
//
// 消费方：renderer `groupLibraryItems`（弹窗分组时 title 桶判等加入别名命中）。
// 跨平台匹配（server）已用 title-romaji 搜索变体 + isCrossScript 处理罗马音
// 标题，韩语标题暂不参与匹配（召回不到就 no match，安全侧）。
//
// 匹配口径：**归一后整串相等**（normalizeKey 后比较）——「悲歌」的别名
// 「애절가」存归一形态；不做子串/模糊。
// ─────────────────────────────────────────────────────────────────────────

import { normalizeKey } from './normalizer.js';

/**
 * 歌名别名表：key = 归一后的标题，value = 等价的别名标题（归一后比较）。
 * 双向等价——匹配时查「a 的别名是否 == b」或「b 的别名是否 == a」。
 * 只放**手工确认的同歌**（用户报障 + 人工核对），防不同歌误并。
 */
const TITLE_ALIASES: Record<string, string[]> = {
  // 2026-08-07: 金范洙《悲歌》（韩剧《茶母》OST）。QQ「悲歌（애절가）」、
  // 网易云「悲歌」/「애절가」。韩语歌名无算法可转中文。
  悲歌: ['애절가'],
  애절가: ['悲歌'],
  // 2026-08-07: Humbert Humbert《今晩はお月さん》，平台之一显示纯中文
  // 译名「今晚月色真好」。日→中歌名翻译无算法，策展。
  今晩はお月さん: ['今晚月色真好'],
  今晚月色真好: ['今晩はお月さん'],
  // 2026-08-07: 桑田佳佑《明日晴れるかな》（《求婚大作战》主题曲），
  // 平台之一显示纯中文译名「明日会放晴么」。
  明日晴れるかな: ['明日会放晴么'],
  明日会放晴么: ['明日晴れるかな'],
  // 2026-08-07: 扫荡式歌名翻译别名（Vocaloid/ACG 常见）
  夜に駆ける: ['向夜晚奔去', '奔向夜晚', '夜驱', 'Into The Night'],
  向夜晚奔去: ['夜に駆ける'],
  // 注：群青同名多见（YOASOBI / 其他乐队同名曲），不维护避免误并。
  残酷な天使のテーゼ: ['残酷天使的行动纲领', '残酷天使纲领'],
  残酷天使的行动纲领: ['残酷な天使のテーゼ'],
  アイドル: ['偶像'],
  偶像: ['アイドル'],
};

/** 归一后比较（同 artistAlias 的 normStageName 哲学：精确整串）。 */
function normTitle(s: string): string {
  return normalizeKey(s, '');
}

/**
 * 归一后 title 的**等价类代表**：别名对归到同一代表 key（用于分桶 O(1)）。
 * 「悲歌」与「애절가」都归到「悲歌」。表外 title 原样返回。
 */
export function titleAliasKey(title: string): string {
  const n = normTitle(title);
  if (!n) return n;
  for (const [main, aliases] of Object.entries(TITLE_ALIASES)) {
    if (n === main) return main;
    if (aliases.some((al) => normTitle(al) === n)) return main;
  }
  return n;
}

/**
 * 两个标题是否命中**策展歌名别名表**（双向）。只认整串相等，
 * 不做子串——「悲歌」≠「悲歌 (Live)」的别名（版本靠 displayKey 剥括号）。
 */
export function titleAliasMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  return titleAliasKey(na) === titleAliasKey(nb);
}
