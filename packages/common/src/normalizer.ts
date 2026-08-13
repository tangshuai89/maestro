// ─────────────────────────────────────────────────────────────────────────
// 跨包共享的归一工具（common/normalizer）
//
// 单一真值源——server 端 catalog 匹配（normalizeKey）和 renderer 端
// 「我的喜欢」弹窗的展示聚类（displayKey）都从这里引用，确保两端 key 永远
// 对齐：server 把哪些 item 合并到同一个 UnifiedSearchItem，renderer 的
// groupLibraryItems 就会把这些 item 聚到同一 group。
//
// 之前 server 的 search.util.ts 和 renderer 的 groupLibrary.ts 各有一套
// stripForFuzzy / normalizeKey 实现，独立迭代后两边对「同人异名」「简繁」
// 「feat 写法」的处理口径分裂——server 合并过的项渲染到弹窗时被重新拆开
// 或重新合并，徽章（platforms）对不齐。把流水线集中到这里后这个根因消除。
//
// 子路径依赖：只引 opencc-js/t2cn（~103KB），不进 server translit.ts 用
// 的 opencc-js 完整版（cn2t 需要），那条路仍留在 server 端。
// ─────────────────────────────────────────────────────────────────────────

import { Converter } from 'opencc-js';

/**
 * 剥掉字符串里的「feat./featuring/ft. <name>」标签。
 *
 * 两种形式：
 *   - 括号形式：`(feat. Name)` / `（feat. Name）` / `(Featuring Name1 & Name2)` ...
 *   - 联入形式：`Song, feat. Name` / `Song feat. Name` / `Song ft. Name` ...
 *
 * **不动**：
 *   - `(Live)` / `(Remix)` / `(伴奏)` 等版本标签——catalog 级 normalizeKey 要保留
 *   - `(With Strings)` / `(With Drums)` 等——"with" 不在 regex 里，不误剥
 *   - 多艺人表 `"Billie Eilish, Justin Bieber"`——缺 "feat." 关键词，留 v3
 */
export function stripFeatTags(s: string): string {
  if (!s) return s;
  let out = s;
  // 1) 括号形式
  out = out.replace(/[(（\[【〔](?:feat\.?|featuring|ft\.?)\s+[^)）\]】〕]+[)）\]】〕]/gi, '');
  // 2) 联入形式
  out = out.replace(
    /\s*,?\s*(?:feat\.?|featuring|ft\.?)\s+[^,;&\/]+?(?=\s*(?:,|\s*&|\s*\/|$))/gi,
    '',
  );
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 阶段 F：剥掉括号内的全部内容（保留括号外的部分）。
 *
 * `displayKey` 专用——为了让 groupLibraryItems 把「海阔天空 (Live)」和
 * 「海阔天空」聚到同一 group（用户能展开看版本差异），展示级 key 要把
 * 括号内版本标签整个剥掉。
 *
 * catalog 级 `normalizeKey` **不**调它（保留版本差异）。
 *
 * 覆盖：半角/全角圆括号、方括号、方头括号、书名号、尖括号。
 */
export function stripParensContent(s: string): string {
  if (!s) return s;
  // 排除类**不含** 〉》（中文书名号闭合符）——「(韩剧《茶母》OST)」这类
  // 括号内含书名号时，若排除 〉》 会在 《 处提前截断、剥成「(韩剧《茶母」+
  // 残留 OST)。2026-08-07 修：书名号当普通内容整体剥掉。
  return s
    .replace(/[(（\[【〔〈《][^)）\]】〕]*[)）\]】〕〉》]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 阶段 E1：剥掉"纯假名括号"——读音注释（furigana），不是版本标签。
 *
 * 日文里 artist 字段经常这样：「藤井风 (ふじいかぜ)」——半角括号里全是
 * 平假名/片假名，那是 kanji 的读音。剥掉避免它污染 key。
 *
 * **判定**：括号内容 trim 后**完全由**平假名/片假名（含中点・长音ー/空白）
 * 构成 → 整段剥；其他类型（Latin / 汉字 / 标点）→ 保留。
 *
 * 边界情况：
 *   - `(ふじいかぜ)` → 剥（用户场景）
 *   - `[エイドル]` → 剥
 *   - `（ライブ）` → 剥（日文里「ライブ」一般不写进 tag）
 *   - `(feat. X)` → 不动（feat 走 stripFeatTags）
 *   - `(Live)` / `(现场版)` → 不动（Latin / 汉字）
 *   - `()` → 剥（空）
 *   - `(ヒューリスティック Live 2024)` → 不动（含 Latin）
 */
export function stripFuriganaParens(s: string): string {
  if (!s) return s;
  const stripped = s.replace(
    /[(（\[【〔]([\u3040-\u309F\u30A0-\u30FF\s]*)[)）\]】〕]/g,
    (m, k: string) => {
      const trimmed = k.trim();
      if (!trimmed) return '';
      if (/^[\u3040-\u309F\u30A0-\u30FF\s]+$/.test(trimmed)) return '';
      return m;
    },
  );
  return stripped.replace(/\s+/g, ' ').trim();
}

// ── 版本 / 翻唱 标签识别 ──────────────────────────────────────────────
/**
 * 版本标签枚举。稳定字符串用于：(a) 在 normalizeKey 末段插入作隔板让跨版本
 * key 自然分裂；(b) renderer 染色 + 子行版本标识。`null` = 未识别（studio
 * / 原版）。
 *
 * 不识别：纯作品版本号 `(2020 Remaster)` / `(Single)` / `(Album)` / `(Deluxe)`
 * —— 这些是 catalog metadata，由 catalog 阈值（±3s 时长 / 来源平台）隔离，
 * 不该与录音版混为一谈。
 */
export type VersionTag =
  'LIVE' | 'ACOUSTIC' | 'REMIX' | 'INSTRUMENTAL' | 'COVER' | 'KARAOKE' | 'DEMO' | 'EDIT' | null;

/** 「这是翻唱」的强标记集合——统一拒判，不再 fan-out、不会再进 library 候选池。 */
export const COVER_TAGS: ReadonlySet<NonNullable<VersionTag>> = new Set(['COVER']);

/** 识别括号内的版本 / 翻唱标签。
 *
 *  - 输入形如 `(Live at X)` / `(Live)` / `[现场版]` / `（COVER）` / `(Cover by KiraCola)`
 *  - 中/日/英跨语种归一为统一枚举：`(现场版)` 和 `(Live)` 都归 `LIVE`；`(翻唱)` /
 *    `COVER` / `Cover by X` 都归 `COVER`。
 *  - 命中即把整段括号连同内容替换成「 ` <TAG>` 」插入到 title 末尾；不命中 →
 *    原样返回。
 *  - 词表严格白名单；任何不在词表里的括号（哪怕看起来像版本）保留原样，
 *    走 catalog metadata 兜底（clusterByDuration ±3s）。
 *
 *  与 stripFeatTags / stripParensContent 的边界：stripVersionTags 先识别**语义**
 *  （LIVE/COVER），把括号整段替换；其它两个按字符剥；最后 normalizeKey 的
 *  noise strip 阶段把残留的半边括号吞掉、` ` 空格被 strip → 标签字母贴回
 *  title 末尾： `海阔天空 (Live)` → `海阔天空 LIVE`，与原版 `海阔天空` 显著不同。
 */
export function stripVersionTags(s: string): string {
  if (!s) return s;
  return s.replace(/[(（\[【〔〈《]([^()）\]】〕〉《》]+)[)）\]】〕〉》]/g, (_m, inner: string) => {
    const tag = classifyVersionTag(inner.trim());
    if (!tag) return _m;
    return ` ${tag}`;
  });
}

/** 独立提取版本标签（供 music.service Tier 守卫、renderer 染色共用）。 */
export function extractVersionTag(raw: string): VersionTag {
  if (!raw) return null;
  const m = raw.match(/[(（\[【〔〈《]([^()）\]】〕〉《》]+)[)）\]】〕〉》]/g);
  if (!m) return null;
  // 多个 tag 同时出现时优先级：COVER > LIVE > ACOUSTIC > REMIX > INSTRUMENTAL > KARAOKE > DEMO > EDIT
  const priority: NonNullable<VersionTag>[] = [
    'COVER',
    'LIVE',
    'ACOUSTIC',
    'REMIX',
    'INSTRUMENTAL',
    'KARAOKE',
    'DEMO',
    'EDIT',
  ];
  for (const p of priority) {
    for (const hit of m) {
      const inner = hit.slice(1, -1).trim();
      if (classifyVersionTag(inner) === p) return p;
    }
  }
  return null;
}

/** 括号内部文本 → 标签。返回 null = 不归类为版本/翻唱（保留原样）。 */
function classifyVersionTag(inner: string): VersionTag {
  // 去掉前导修饰词（动词/介词）后看核心词。
  // "Live at X" → "live"；"Cover by KiraCola" → "cover"；
  // "翻唱：周杰伦" → "翻唱"；"原唱：周杰伦" → "原唱"（=COVER）；"伴奏版" → "伴奏"。
  const norm = inner
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[：:，,。.\s·・/_-]/g, '');

  // COVER（翻唱相关，包括「翻唱」「翻自」「COVER」「Cover by X」「原唱：X」
  // ——「原唱」出现在副标题里就是「这是翻唱」的标记）。
  if (/^(cover|翻唱|翻自|翻|原唱)/.test(norm) || /^coverby.+/.test(norm)) return 'COVER';

  // LIVE（live / live at x）。中英保守不互并：search.test.ts #3g 期望「(Live)」
  // 与「(现场版)」视为不同版本——中文 LIVE 标签不在归一范围内（让 catalog
  // 跨版本守卫按 ±3s 严格处理，避免把 QQ studio ❤ 与 Spotify live 误并）。
  if (/^(live|liveat.+)/.test(norm)) return 'LIVE';

  // ACOUSTIC（不插电 / 原声）
  if (/^(acoustic|acousticver\.?|unplugged|不插电|原声)/.test(norm)) return 'ACOUSTIC';

  // REMIX
  if (/^(remix|remixed|混音|混音版|重混)/.test(norm)) return 'REMIX';

  // INSTRUMENTAL（伴奏 / 纯伴奏 / Inst. / Instrumental）
  if (/^(inst\.?|instrumental|伴奏|纯伴奏|纯音乐)/.test(norm)) return 'INSTRUMENTAL';

  // KARAOKE
  if (/^(karaoke|卡拉ok|ktv|伴唱)/.test(norm)) return 'KARAOKE';

  // DEMO
  if (/^(demo|样带|试听样带)/.test(norm)) return 'DEMO';

  // EDIT（radio edit / single edit 等剪辑版）
  if (/^(edit|radioedit|singleedit|剪辑版|电台版)/.test(norm)) return 'EDIT';

  return null;
}

/**
 * OpenCC tw→cn 转换器（模块级单例，懒初始化）。
 * 加载失败时降级为恒等函数（不抛错）。
 */
let _tw2cn: ((text: string) => string) | null = null;
function tw2cn(): (text: string) => string {
  if (_tw2cn) return _tw2cn;
  try {
    _tw2cn = Converter({ from: 'tw', to: 'cn' });
  } catch {
    _tw2cn = (s: string) => s;
  }
  return _tw2cn;
}

/**
 * 日文特有形近汉字 → 中简（OpenCC tw→cn 不覆盖的日文独有形体）。
 * 例如：日文用「気」(U+6C17)，繁体中文用「氣」，简体中文用「气」——
 * tw→cn 处理「氣→气」，但「気」是日文独有形体，不走繁体中文路径。
 */
const JP_KANJI: Record<string, string> = {
  気: '气', // U+6C17 → U+6C14
  黒: '黑', // U+9ED2 → U+9ED1
  // 2026-08-04: 扫 QQ 红心列表补齐——OpenCC tw→cn 不认的日文新字体（shinjitai）。
  // 背景：QQ/网易云常用日文新字体（横浜銀蝿/沢/桜/実/薬...），Spotify 有时
  // 用旧字体或简体（横浜銀蠅）。tw→cn 只认旧字体（蠅→蝇），新字体不认
  // （蝿 原样），导致 normalizeKey 两边对不上，跨平台匹配全挂。
  // 每条都是「日文新字体 → 中文简体」的一对一映射（无多义、无上下文依赖）。
  蝿: '蝇', // U+876F 新字体（旧字体 蠅=U+8825，tw→cn 已覆盖）
  沢: '泽', // U+6CA2 新字体（舊 澤→泽，OpenCC 已覆盖旧字）
  桜: '樱', // U+685C 新字体（舊 櫻→樱）
  斎: '斋', // U+658E 新字体（舊 齋→斋）
  巣: '巢', // U+5DE3 新字体（同 巢）
  対: '对', // U+5BFE 新字体（舊 對→对）
  応: '应', // U+5FDC 新字体（舊 應→应）
  浜: '滨', // U+6D5C 新字体（舊 濱→滨）
  楽: '乐', // U+697D 新字体（舊 樂→乐）
  実: '实', // U+5B9F 新字体（舊 實→实）
  帰: '归', // U+5E30 新字体（舊 歸→归）
  団: '团', // U+56E3 新字体（舊 團→团）
  薬: '药', // U+85AC 新字体（舊 藥→药）
  駅: '驿', // U+99C5 新字体（舊 驛→驿；「駅」是日文独有的「站」写法）
  // 2026-08-07: 桑田佳祐 vs 桑田佳佑——OpenCC tw→cn 不处理「祐」（U+7950，日
  // 文人名用字），导致 normalizeKey 两边对不上、跨平台匹配全挂。兜底归一。
  祐: '佑', // U+7950 → U+4F51（人名专用，简体「佑」是常用写法）
};

const JP_KANJI_REGEX: RegExp = (() => {
  const keys = Object.keys(JP_KANJI).join('');
  return new RegExp(`[${keys}]`, 'g');
})();

/**
 * CJK 统一化：OpenCC 繁→简 + 日文独有形体兜底。
 * 不在任何转换表里的字符原样返回。
 */
export function cjkUnify(s: string): string {
  if (!s) return s;
  let out = tw2cn()(s);
  out = out.replace(JP_KANJI_REGEX, (ch) => JP_KANJI[ch] || ch);
  return out;
}

// ── catalog 级：normalizeKey（严格，保留版本差异）─────────────────────
/**
 * 歌名+歌手归一化：catalog 级跨平台匹配键。
 *
 * 关键约束：**保守保留"版本差异"**（specs/match-engine/spec.md v2 决策）。
 *   - 不剥掉括号 / 引号里的内容——(Live) / (现场版) 这类版本标签必须保留，
 *     不能把「海阔天空 (Live)」与「海阔天空」视为同一首。
 *   - 只做「同一首歌的不同写法」归一：半/全角括号、em-dash / en-dash、
 *     智能引号、中文书名号这些。
 *   - 阶段 D：先跑 `stripFeatTags` 把 feat/featuring/ft. + 名字 标签整个
 *     剥掉，这样跨平台 feat 写法差异（"Bad Guy (feat. X)" vs "Bad Guy"）
 *     能匹配。
 *   - 阶段 E1：再跑 `stripFuriganaParens` 把纯假名括号注释剥掉。
 *   - 阶段 V0：再跑 `stripVersionTags` 把 (Live) / (现场版) / (Cover by X) /
 *     (翻唱) 等版本/翻唱标签归一为 ` LIVE` / ` COVER` 尾巴插入 title 末尾
 *     ——让跨版本 normalizeKey 不再相等，跨平台匹配不再串味。
 *
 * 流水线：
 *   0) [阶段 D] 剥 feat 标签
 *   0.5) [阶段 E1] 剥纯假名括号（furigana）
 *   0.7) [阶段 V0] 归一版本/翻唱标签
 *   1) 全角 ASCII (U+FF01..U+FF5E) → 半角
 *   2) 全角括号 / 方头括号 / 书名号 → 半角
 *   3) 各种 dash 类 → '-'
 *   4) 智能引号 / 中文书名号 → 直引号
 *   5) 噪声字符（空白+标点+括号+引号+dash+CJK 标点+tilde 变体）整段压缩
 *   5.5) [阶段 E2] CJK 跨语言形态合并（OpenCC tw→cn + JP 独有形兜底）
 *   6) 全小写
 */
export function normalizeKey(title: string, artist: string): string {
  const stripped =
    `${stripFuriganaParens(stripFeatTags(stripVersionTags(title)))} ` +
    `${stripFuriganaParens(stripFeatTags(stripVersionTags(artist)))}`;
  let raw = stripped
    // 1) 全角 ASCII → 半角
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // 2) 全角括号 / 方头括号 / 书名号 → 半角
    .replace(/[（）【】《》]/g, (ch) =>
      ch === '（'
        ? '('
        : ch === '）'
          ? ')'
          : ch === '【'
            ? '['
            : ch === '】'
              ? ']'
              : ch === '《'
                ? '<'
                : ch === '》'
                  ? '>'
                  : ch,
    )
    // 3) 各种 dash → '-'
    .replace(/[\u2010-\u2015\u2212\uFF0D\u30FC]/g, '-')
    // 4) 智能引号 / 中文书名号 → 直引号
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[「」『』]/g, '"')
    // 5) 噪声字符合并：空白+标点+括号+引号+dash+CJK 标点+tilde
    //    CJK 标点「。」（U+3002）「、」（U+3001）「・」（U+30FB）必须 strip—
    //    否则「ずっと真夜中でいいのに。」与「ずっと真夜中でいいのに」key
    //    差一个「。」，跨平台匹配 Tier 2 includes 仍能命中，但后续 strict
    //    永远不撞。保险起见全部 strip。
    //    Tilde 变体（`~` U+007E / `〜` U+301C wave dash / `～` U+FF5E 全角）
    //    在日文歌名里常被当分隔符（「Departures~歌名~」），必须 strip。
    .replace(/[\s\-_,.()\[\]<>'"′″·・&+\/!?！？:：;；。、〜～~]+/g, '');
  // 5.5) CJK 跨语言形态合并
  raw = cjkUnify(raw);
  // 6) 全小写
  return raw.toLowerCase();
}

// ── 展示级：displayKey（宽松，剥括号让同歌不同版本聚合）────────────────
//
/**
 * 「我的喜欢」弹窗的展示级聚类 key。
 *
 * 与 `normalizeKey` 的关键区别：**把括号内容整个剥掉**，让「海阔天空 (Live)」
 * 和「海阔天空」进同一 group（用户可展开看版本差异）。版本 / 翻唱标签由
 * `groupLibraryItems` 在 group 层级用 `extractVersionTag(item.title)` 二次
 * 染色（标签本身已被 stripParensContent 剥掉，title 里没括号就 fallback
 * 到 `null`）——同一 group 内 studio/live 子行差异化展示由渲染层完成。
 *
 * 为什么不直接复用 `normalizeKey`：normalizeKey 现在因 stripVersionTags 已
 * 把 (Live) 与 (现场版) 落到不同 key（`海阔天空LIVE` vs `海阔天空`），catalog
 * 跨版本自动隔离（用户要的：QQ studio ❤ 不要把 Spotify live 也 star 上）；
 * 展示级聚类反过来再 stripParensContent 让它们同组（用户要的：弹窗里能看到
 * studio / live 两个版本在同一 group 里展开）。
 *
 * pipeline：stripParensContent → normalizeKey（已含 stripVersionTags 但
 * 此时已无括号）。
 */
export function displayKey(title: string, artist: string): string {
  return normalizeKey(stripParensContent(title), stripParensContent(artist));
}
