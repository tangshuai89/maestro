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
  let out = '';
  for (const ch of s) {
    if (HAN.test(ch)) {
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
function cn2t(s: string): string {
  if (!s) return s;
  if (!_cn2t) {
    try {
      _cn2t = Converter({ from: 'cn', to: 'tw' });
    } catch {
      _cn2t = (t: string) => t;
    }
  }
  const conv = _cn2t;
  return conv(s);
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
 *  tokenizer 未就绪 → 返回空串（触发后台预热，本次走拼音路线）。 */
function romanizeJa(s: string): string {
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

/** 一个字符串的所有候选罗马化（拼音路线 + kuromoji(简→繁)读）。去重、去空。
 *
 * ⚠️ **只用 cn2t 预处理后的 kuromoji 读音，不用直读**：简体写法的日文名直读时
 * kuromoji 认不出简体字会**丢字**——「藤井风」直读丢掉「风」只剩「fujii」（姓），
 * 而「fujii」是「fujiikaze」的子串 → 会把任意「Fujii XX」的同名翻唱误并（正是
 * 本次事故的同姓误并类型）。cn2t 先把「风→風」还原，kuromoji 读出完整「fujiifuu」，
 * 不再产生裸姓子串。代价：藤井风↔Fujii Kaze 因「風=ふう(通用)≠かぜ(艺名)」在此
 * 对不上，退回 matchEquivalentTrack 的 Tier 3b（同录音 ±3s）兜底——安全侧取舍。 */
function romanizeVariants(s: string): string[] {
  const set = new Set<string>();
  const py = romanize(s);
  if (py) set.add(py);
  const jaTw = romanizeJa(cn2t(s));
  if (jaTw) set.add(jaTw);
  return [...set];
}

/** 音译重叠判定的最短长度——太短（≤3）的罗马化串靠 includes 容易撞巧合。 */
const MIN_ROMAJI_OVERLAP_LEN = 4;

/**
 * 两个（已 normalizeKey 的）艺人 key 是否「音译对得上」。
 *
 * 只在**跨脚本**（一侧 CJK、另一侧纯拉丁）时有意义——同脚本的判等交给上层的
 * includes/前后缀逻辑。把两侧各自算出多条候选罗马化（拼音 + kuromoji），
 * 跨候选比对：相等或一方完整包含另一方（带最短长度门）才算命中。
 *
 * 正确拒绝：铃木爱理("suzukiairi"/"lingmuaili") vs Lefty("leftyhandcream") / wacci
 * 正确接受：鈴木愛理↔Suzuki Airi、宇多田ヒカル↔Utada Hikaru、初音ミク↔Hatsune Miku
 */
export function artistTransliterationMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const va = romanizeVariants(a);
  const vb = romanizeVariants(b);
  for (const ra of va) {
    for (const rb of vb) {
      if (!ra || !rb) continue;
      if (Math.min(ra.length, rb.length) < MIN_ROMAJI_OVERLAP_LEN) continue;
      if (ra === rb || ra.includes(rb) || rb.includes(ra)) return true;
    }
  }
  return false;
}
