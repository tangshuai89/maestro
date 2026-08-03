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
  out = out.replace(
    /[(（\[【〔](?:feat\.?|featuring|ft\.?)\s+[^)）\]】〕]+[)）\]】〕]/gi,
    '',
  );
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
  return s
    .replace(/[(（\[【〔〈《][^)）\]】〕〉》]*[)）\]】〕〉》]/g, '')
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
 *
 * 流水线：
 *   0) [阶段 D] 剥 feat 标签
 *   0.5) [阶段 E1] 剥纯假名括号（furigana）
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
    `${stripFuriganaParens(stripFeatTags(title))} ` +
    `${stripFuriganaParens(stripFeatTags(artist))}`;
  let raw = stripped
    // 1) 全角 ASCII → 半角
    .replace(
      /[！-～]/g,
      (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    // 2) 全角括号 / 方头括号 / 书名号 → 半角
    .replace(
      /[（）【】《》]/g,
      (ch) =>
        ch === '（' ? '(' :
        ch === '）' ? ')' :
        ch === '【' ? '[' :
        ch === '】' ? ']' :
        ch === '《' ? '<' :
        ch === '》' ? '>' :
        ch,
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
    .replace(
      /[\s\-_,.()\[\]<>'"′″·・&+\/!?！？:：;；。、〜～~]+/g,
      '',
    );
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
 * 和「海阔天空」进同一 group（用户可展开看版本差异）。
 *
 * 为什么不直接复用 `normalizeKey`：normalizeKey 是 catalog 级，保留版本差异
 * 是对的（searchEquivalent 走 fuzzy 兜底）；展示级聚类把同歌多版本并到一起
 * 是 UX 偏好——让用户能看到「这首歌我有 4 个版本」的展开视图，而不是弹窗里
 * 4 条同名条目分散。
 *
 * pipeline 在 normalizeKey 基础上额外跑 stripParensContent。
 */
export function displayKey(title: string, artist: string): string {
  return normalizeKey(
    stripParensContent(title),
    stripParensContent(artist),
  );
}