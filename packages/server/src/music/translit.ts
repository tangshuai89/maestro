/**
 * 跨脚本艺人判等的「音译佐证」。
 *
 * 背景：跨平台匹配里，Spotify 常用罗马字/拉丁写法（"Fujii Kaze"），QQ/网易云
 * 用汉字/假名（"藤井风" / "浜崎あゆみ"）。老代码用 `isCrossScript`——只看
 * 「一边 CJK、一边拉丁」就判「同一艺人」——这是个**极弱**的信号：它会把
 * 「铃木爱理」(CJK) 和「Lefty Hand Cream」(拉丁) 也判成同一人，只要歌名撞上。
 * 于是同名不同艺人的翻唱链（wacci 原唱 / 铃木爱理 翻唱 / Lefty Hand Cream 翻唱）
 * 被 CJK 名当「桥」传递性地并到一起，红心被错误地跨平台同步。
 *
 * 这里用**音译**给跨脚本判等一个真实依据：把 CJK 侧罗马化，再和拉丁侧比对。
 * 罗马化取两条路：
 *   1) 拼音（汉字）+ 黑本式罗马字（假名）——覆盖中文名 + 假名日文名。
 *   2) kuromoji（日文形态素分析，IPADIC 重字典）——覆盖**汉字日文名**：
 *      「鈴木愛理」→ すずきあいり → suzukiairi、「宇多田ヒカル」→ utadahikaru。
 *      QQ/网易云常把日文名写成**简体**（藤井风 / 铃木爱理），IPADIC 是日文汉字，
 *      所以喂 kuromoji 前先 OpenCC 简→繁（cn2t）把「铃木爱理→鈴木愛理」还原。
 *
 * 判等口径**保守**——只认「相等 / 一方完整包含另一方」（带最短长度门）。
 * **不**做「公共前缀重叠」之类的模糊，因为那会把同姓不同人（鈴木愛理 vs 鈴木
 * 奈々）在同名翻唱时又误并回去——正是本次要修的事故类型。
 *
 * kuromoji 能力边界（诚实标注，避免下次误以为它全能）：
 *   - ✅ 规则读音 + 同姓名顺序：鈴木愛理↔Suzuki Airi、初音ミク↔Hatsune Miku。
 *   - ❌ **姓名顺序颠倒**：浜崎あゆみ→hamazakiayumi vs Spotify「Ayumi Hamasaki」
 *        ——归一后的拉丁侧没有词边界可重排，桥不了。
 *   - ❌ **艺名不规则读音**：藤井風→ふう(音读) 而艺人是かぜ；米津玄師→げんし 而
 *        是 Kenshi。IPADIC 是通用词典、不含艺名专属读音。这类只能靠
 *        matchEquivalentTrack 的 Tier 3b「标题完全相等 + 时长 ±3s 严格」兜底。
 *   - 真要覆盖以上，得上 JMnedict 人名读音库 + 词边界感知的集合匹配，成本远超收益。
 */
import { pinyin } from 'pinyin-pro';
import { toRomaji } from 'wanakana';
import { Converter } from 'opencc-js';
import * as kuromoji from 'kuromoji';
import * as path from 'path';
import { stageNameAliasMatch } from '@maestro/common';

/** 汉字（含扩展 A / 兼容区）。 */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
/** 平/片假名。 */
const KANA = /[぀-ヿ]/;

/** romanize 结果缓存——艺人名重复率高，罗马化（尤其逐字拼音 / kuromoji）不必反复算。 */
const romanizeCache = new Map<string, string>();
const ROMANIZE_CACHE_MAX = 4_000;

/**
 * 把一个含 CJK 的字符串罗马化成「纯小写字母数字」key（拼音路线）：
 *   - 汉字 → 无声调拼音
 *   - 假名 → 黑本式罗马字
 *   - 拉丁字母/数字 → 原样（小写）
 *   - 其他（空白、标点）→ 丢弃
 */
export function romanize(s: string): string {
  if (!s) return '';
  const cached = romanizeCache.get(s);
  if (cached !== undefined) return cached;
  // 2026-08-14 修复（拼音串扰）：串内含假名 → 判定为**日文名**，汉字部分
  // 不喂拼音（拼音读日文汉字是中文读音，纯噪声——「藤井風」会被读成
  // tengjingfeng，与任何 "Feng" 艺人单向包含误并）。日文读音交给
  // romanizeJa（kuromoji）路线；这里只转假名 + 保留拉丁。
  const hasKana = KANA.test(s);
  let out = '';
  for (const ch of s) {
    if (HAN.test(ch)) {
      if (hasKana) continue; // 日文名：汉字不拼音化
      const py = pinyin(ch, { toneType: 'none', type: 'array' });
      out += py && py.length ? py.join('') : '';
    } else if (KANA.test(ch)) {
      out += toRomaji(ch);
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch;
    }
  }
  out = out.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (romanizeCache.size >= ROMANIZE_CACHE_MAX) romanizeCache.clear();
  romanizeCache.set(s, out);
  return out;
}
// ── kuromoji（日文汉字读音）─────────────────────────────────────────────

/** OpenCC 简→繁（cn2t）：把简体写法的日文名还原成 IPADIC 认得的日文汉字。
 *  用 full 包的 Converter（server 端已依赖，无打包体积顾虑；子路径类型在
 *  classic node resolution 下不稳，故走 bare import）。 */
let _cn2t: ((t: string) => string) | null = null;
/** cn2t 结果的进程级 cache（2026-08-26）：OpenCC 简→繁转换单次 ~0.05ms，
 *  mergeCrossScript 的 O(n²) 循环里每对要跑 4-6 次（stageNameKey /
 *  romanizeVariants / tryTokenMatch 各一次）。艺人名总量有限，按输入串
 *  缓存后 987 条库从 ~45s 降到 ~1s（与 cjkUnify 的缓存同一思路）。 */
const _cn2tCache = new Map<string, string>();
function cn2t(s: string): string {
  if (!s) return s;
  const cached = _cn2tCache.get(s);
  if (cached !== undefined) return cached;
  if (!_cn2t) {
    try {
      _cn2t = Converter({ from: 'cn', to: 'tw' });
    } catch {
      _cn2t = (t: string) => t;
    }
  }
  const out = _cn2t(s);
  _cn2tCache.set(s, out);
  return out;
}

/** kuromoji 词典路径：node_modules/kuromoji/dict（.dat.gz）。
 *  ⚠️ Electron 打包（asar）需把 kuromoji/dict 加进 asarUnpack，否则运行时读不到。 */
function dictPath(): string {
  return path.join(path.dirname(require.resolve('kuromoji')), '..', 'dict');
}

let _jaTokenizer: kuromoji.Tokenizer | null = null;
let _jaWarmup: Promise<void> | null = null;

/**
 * 异步预热 kuromoji tokenizer（加载 ~15 个词典分片，首次 ~几百 ms～1s）。
 * 幂等：多次调用复用同一个 promise。构建失败 → 静默降级（tokenizer 保持 null，
 * artistTransliterationMatch 退回纯拼音/假名路线，不抛）。
 */
export function warmupJa(): Promise<void> {
  if (_jaTokenizer) return Promise.resolve();
  if (_jaWarmup) return _jaWarmup;
  _jaWarmup = new Promise<void>((resolve) => {
    try {
      kuromoji.builder({ dicPath: dictPath() }).build((err, tokenizer) => {
        if (!err && tokenizer) _jaTokenizer = tokenizer;
        resolve();
      });
    } catch {
      resolve(); // 词典缺失等 → 降级
    }
  });
  return _jaWarmup;
}

/** 用 kuromoji 把日文文本罗马化（取每 token 的片假名 reading → 黑本式）。
 *  tokenizer 未就绪 → 返回空串（触发后台预热，本次走拼音路线）。
 *  导出供 music.service 搜索变体用（Spotify 按罗马音索引日文歌名——「恋」
 *  → koi，搜汉字召回不到）。 */
export function romanizeJa(s: string): string {
  if (!s) return '';
  if (!_jaTokenizer) {
    void warmupJa();
    return '';
  }
  let out = '';
  for (const t of _jaTokenizer.tokenize(s)) {
    const reading =
      t.reading && t.reading !== '*' ? t.reading : t.surface_form;
    out += toRomaji(reading);
  }
  return out.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 用 kuromoji 把日文文本罗马化成 **token 数组**（每 token 一个读音）。
 *
 * 与 `romanizeJa`（连续串）的区别：保留词边界。供 `artistTransliterationMatch`
 * 的顺序无关集合匹配用——「浜崎あゆみ」→ [hamasaki, ayumi]、「德永英明」→
 * [tokunaga, hideaki]，跟 Spotify 的 "Ayumi Hamasaki" / "Hideaki Tokunaga"
 * （名前颠倒的拉丁写法）做「每个 token 都在对方串里子串命中」的匹配。
 */
/**
 * 罗马化函数的进程级 memoization cache（2026-08-26 加）。
 *
 * 背景：`mergeCrossScript` 是 O(n²) 的——n 首库任意两首都两两比对，每对调
 * `artistTransliterationMatch`，每次调都跑一遍 `romanizeJaTokens`（kuromoji
 * `tokenize()`，单次 ~1ms）和 `romanizeVariants`（含 cn2t + jaTw + 假名括号，
 * ~0.5ms）。n=987 时约 476k 对调用 × ~2ms = **~95s**，用户实测整次 import
 * 卡 100s——根因不在 fetchLiked（fetch 早就返回了），而在 merge 阶段。
 *
 * 修法：艺术家字符串数量级远小于 n²（一个用户的库顶多几千个独立艺人），
 * 把 romanize 结果按输入字符串缓存，下次同一艺人的比较直接拿缓存。
 * 进程级（不是 per-call），多次 import 同一艺人也直接命中。
 *
 * 容量：实测单用户库上限几千独立艺人；20k 字符串 × ~50B ≈ 1MB，对 sidecar
 * 无压力。超过容量时**不淘汰**——艺术家的 romanize 是 deterministic，缓
 * 存增长到稳定值后就不再涨（同一用户反复 import 同一批艺人命中现有 cache）。
 */
const _romanizeJaTokensCache = new Map<string, string[]>();
/** romanizeJaTokens。缓存命中 /kuromoji.tokenize 单次 ~1ms。*/
function romanizeJaTokens(s: string): string[] {
  if (!s) return [];
  if (!_jaTokenizer) {
    void warmupJa();
    return [];
  }
  const cached = _romanizeJaTokensCache.get(s);
  if (cached !== undefined) return cached;
  const tokens: string[] = [];
  for (const t of _jaTokenizer.tokenize(s)) {
    const reading =
      t.reading && t.reading !== '*' ? t.reading : t.surface_form;
    const rom = toRomaji(reading)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (rom) tokens.push(rom);
  }
  _romanizeJaTokensCache.set(s, tokens);
  return tokens;
}

/** 一个字符串的所有候选罗马化（拼音路线 + kuromoji(简→繁)读 + 假名括号直读）。
 * 去重、去空。
 *
 * ⚠️ **只用 cn2t 预处理后的 kuromoji 读音，不用直读**：简体写法的日文名直读时
 * kuromoji 认不出简体字会**丢字**——「藤井风」直读丢掉「风」只剩「fujii」（姓），
 * 而「fujii」是「fujiikaze」的子串 → 会把任意「Fujii XX」的同名翻唱误并（正是
 * 本次事故的同姓误并类型）。cn2t 先把「风→風」还原，kuromoji 读出完整「fujiifuu」，
 * 不再产生裸姓子串。代价：藤井风↔Fujii Kaze 因「風=ふう(通用)≠かぜ(艺名)」在此
 * 对不上，退回 matchEquivalentTrack 的 Tier 3b（同录音 ±3s）兜底——安全侧取舍。
 *
 * **假名括号直读（2026-08-03 新增）**：QQ/网易云常在艺人名后附读音注释，如
 * 「德永英明 (とくなが ひであき)」。这正是**发音真相**——kuromoji 拆不对
 * 「德永英明」（IPADIC 无此人名，拆成 德/永/英明），但括号里的假名直接给对
 * 「tokunaga hideaki」。提取纯假名括号内容 → wanakana 罗马化 → 加入候选。
 * 修「德永英明 ↔ Hideaki Tokunaga」这类「Spotify 拉丁名 vs 中文平台汉字名」。
 *
 * ⚠️ 提取的假名必须**纯假名**（平/片假名 + 空白），避免把 `(Live)` / `(feat. X)`
 * 等版本标签误当读音。 */
const _romanizeVariantsCache = new Map<string, string[]>();
/** romanizeVariants。缓存命中 /拼音 + cn2t + kuromoji + wanakana 4 个步骤。*/
function romanizeVariants(s: string): string[] {
  const cached = _romanizeVariantsCache.get(s);
  if (cached !== undefined) return cached;
  const set = new Set<string>();
  const py = romanize(s);
  if (py) set.add(py);
  const jaTw = romanizeJa(cn2t(s));
  if (jaTw) set.add(jaTw);
  // 假名括号直读：`(とくなが ひであき)` → 罗马化后保留 token 边界（空格）
  // → 顺序无关匹配可用。
  const furigana = s.match(/[（(]([\u3040-\u309F\u30A0-\u30FF\s]+)[)）]/);
  if (furigana) {
    const kana = furigana[1].trim();
    if (kana) {
      const rom = kana
        .split(/\s+/)
        .map((w) => toRomaji(w))
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (rom) set.add(rom);
    }
  }
  const result = [...set];
  _romanizeVariantsCache.set(s, result);
  return result;
}

// ── 英文艺名别名表（2026-08-03 起）────────────────────────────────────
// 策展表已抽到 @maestro/common（packages/common/src/artistAlias.ts）——
// server 的跨平台匹配与 renderer 的弹窗分组共用同一张表，避免两端各写一份
// 漂移。这里只 import `stageNameAliasMatch`（精确整串匹配，双向）。
/** 音译重叠判定的最短长度——太短（≤4）的罗马化串靠 includes 容易撞巧合
 *  （'feng' 是 'tengjingfeng' 的子串 → 藤井風 与任何 "Feng" 艺人误并；
 *  'zhou' 是 'zhoujielun' 的子串 → 周姓艺人互相污染）。5 字符起才允许
 *  includes 方向。相等匹配（==）不受此门限制。 */
const MIN_ROMAJI_OVERLAP_LEN = 5;

/**
 * 两个（已 normalizeKey 的）艺人 key 是否「音译对得上」。
 *
 * 只在**跨脚本**（一侧 CJK、另一侧纯拉丁）时有意义——同脚本的判等交给上层的
 * includes/前后缀逻辑。把两侧各自算出多条候选罗马化（拼音 + kuromoji），
 * 跨候选比对：相等或一方完整包含另一方（带最短长度门）才算命中。
 *
 * 顺序无关兜底（2026-08-03 新增）：西方艺人名常「名前颠倒」——Spotify 写
 * "Hideaki Tokunaga"，日文是「德永英明」（读作 Tokunaga Hideaki）。完整包含
 * 判定对不上。用 kuromoji 的 token 级读音做**集合匹配**：CJK 侧拆成 token
 * 数组（[tokunaga, hideaki]），拉丁侧只要**每个 token 都是其子串**（不要求
 * 顺序）即命中。修「浜崎あゆみ ↔ Ayumi Hamasaki」「德永英明 ↔ Hideaki
 * Tokunaga」这类 case。
 *
 * 正确拒绝：铃木爱理("suzukiairi"/"lingmuaili") vs Lefty("leftyhandcream") / wacci
 * 正确接受：鈴木愛理↔Suzuki Airi、宇多田ヒカル↔Utada Hikaru、初音ミク↔Hatsune Miku、
 *           浜崎あゆみ↔Ayumi Hamasaki（顺序无关）
 *
 * 英文艺名别名（2026-08-03）：周杰伦 ↔ Jay Chou 这类**非音译**艺名，罗马化
 * 路线（拼音/kuromoji/假名括号）永远桥不了，走 @maestro/common 的策展表
 * `stageNameAliasMatch`——精确整串匹配（汉字侧 key 全名相等、拉丁侧归一后
 * 与表值相等），不做子串。表内是手工确认的同人，故不经
 * MIN_ROMAJI_OVERLAP_LEN 长度门限（G.E.M. 等 3 字符艺名也能过）。
 */
export function artistTransliterationMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  // 英文艺名别名通道（先于罗马化：表内名不需要经过长度门限）。
  if (stageNameAliasMatch(a, b)) return true;
  const va = romanizeVariants(a);
  const vb = romanizeVariants(b);
  for (const ra of va) {
    for (const rb of vb) {
      if (!ra || !rb) continue;
      // 相等（==）不经长度门（'aiko'↔'aiko' 自循环）；includes 方向才受门限
      // （'feng' ∈ 'tengjingfeng' 这类拼音碎片碰撞）。
      if (
        ra === rb ||
        (Math.min(ra.length, rb.length) >= MIN_ROMAJI_OVERLAP_LEN &&
          (ra.includes(rb) || rb.includes(ra)))
      ) {
        return true;
      }
    }
  }
  // 顺序无关集合匹配：CJK 侧拆成 token（kuromoji token / 假名括号 token），
  // 拉丁侧只需每个 token 子串命中即可（不要求顺序）。双向都试。
  // token 太短（< MIN_ROMAJI_OVERLAP_LEN）不参与，防止「すず」撞「すずき」。
  const splitTokens = (s: string): string[] =>
    s.split(' ').filter(Boolean);
  const tryTokenMatch = (cjk: string, latinVariants: string[]): boolean => {
    // 1) kuromoji token 级读音（识别规则日文名）——算法猜测，受长度门防误并
    //    （「すず」撞「すずき」）。⚠️ kuromoji 对艺名可能**错读**（「星野源」
    //    的「源」被拆成 はじめ=hajime，实际是 げん=gen）——错读 token 会
    //    拖垮整体判定，所以 kuromoji 判定与括号直读判定**互不拖累**。
    const kuromojiTokens = romanizeJaTokens(cn2t(cjk));
    // 2) 假名括号直读（带空格 → 拆词）。「德永英明 (とくなが ひであき)」的
    //    kuromoji 拆不对，但括号读音直接给对——这是**发音真相**，不受
    //    MIN_ROMAJI_OVERLAP_LEN 长度门限制（「ほしの げん」的 gen 仅 3 字符
    //    也必须参与），否则 3 字名（gen/rei/ai…）全被跳过、姓名颠倒桥不上。
    const furiganaTokens: string[] = [];
    for (const v of romanizeVariants(cjk)) {
      if (v.includes(' ')) furiganaTokens.push(...splitTokens(v));
    }
    for (const latin of latinVariants) {
      if (!latin || latin.length < MIN_ROMAJI_OVERLAP_LEN) continue;
      // 括号直读（≥2 字 token，发音真相）全部命中 → 通过（星野源 case）。
      if (
        furiganaTokens.length >= 2 &&
        furiganaTokens.every((tok) => tok.length >= 2 && latin.includes(tok))
      ) {
        return true;
      }
      // kuromoji token 全部命中（带长度门）→ 通过（无括号规则日文名）。
      if (
        kuromojiTokens.length >= 2 &&
        kuromojiTokens.every(
          (tok) => tok.length >= MIN_ROMAJI_OVERLAP_LEN && latin.includes(tok),
        )
      ) {
        return true;
      }
    }
    return false;
  };
  if (tryTokenMatch(a, vb)) return true;
  if (tryTokenMatch(b, va)) return true;
  return false;
}
