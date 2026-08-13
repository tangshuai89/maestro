#!/usr/bin/env node
/**
 * Rebuild artistAlias.ts from the broken state.
 * Extracts all valid entries and writes a clean file with the correct structure.
 */
const fs = require('fs');
const path = require('path');

const ALIAS_PATH = path.resolve(__dirname, '..', 'packages', 'common', 'src', 'artistAlias.ts');

const src = fs.readFileSync(ALIAS_PATH, 'utf8');

// Extract all STAGE_NAME_ALIASES entries from the broken file
const entryRe = /^\s*'([^']+)':\s*\[([^\]]*)\],?\s*(?:\/\/\s*(.*))?$/gm;
const entries = [];
let m;
while ((m = entryRe.exec(src)) !== null) {
  const key = m[1];
  const aliasStr = m[2];
  const comment = m[3] || '';

  const aliases = aliasStr
    .split(',')
    .map(s => s.trim())
    .filter(s => s && s.startsWith("'"))
    .map(s => s.slice(1, -1).replace(/\\'/g, "'"))
    .filter(s => s.length > 0);

  entries.push({ key, aliases, comment });
}

console.log(`Extracted ${entries.length} entries`);

// Check for duplicates and remove
const seen = new Map();
const final = [];
for (const e of entries) {
  if (seen.has(e.key)) {
    const existing = seen.get(e.key);
    if (e.aliases.length > existing.aliases.length) {
      // Replace
      const idx = final.findIndex(x => x.key === e.key);
      final[idx] = e;
      seen.set(e.key, e);
    }
    // else skip
  } else {
    final.push(e);
    seen.set(e.key, e);
  }
}
console.log(`After dedup: ${final.length} unique entries`);

// Remove empty
const nonEmpty = final.filter(e => e.aliases.length > 0);
console.log(`Non-empty: ${nonEmpty.length} entries`);

// Build the new file
const output = `// ─────────────────────────────────────────────────────────────────────────
// 艺人「别名表」跨包共享（单一真值源）
//
// 背景：中文平台（QQ/网易云）用汉字名，Spotify 常用**非音译的英文艺名**
// （Jay Chou / JJ Lin / G.E.M.）。拼音路线只能桥「孙燕姿→sunyanzi」这类
// 音译名，艺名与读音完全无关——周杰伦拼音 zhoujielun ≠ Jay Chou，任何罗马化
// 算法都桥不了。日语侧同理：ZUTOMAYO（ずっと真夜中でいいのに。）是造词型
// 拉丁艺名，kuromoji 只给「zutto mayonaka de ii noni」，对不上。这里用
// **精确整串匹配**的策展表做最后一公里（与 kuromoji 同哲学：只桥明确名单，
// 不上算法猜测）：
//   - key = 剥括号注释 + 简繁统一（cn2t）后的全名（汉字/假名皆可）——
//     「ずっと真夜中でいいのに」和「周杰倫」都是合法 key；括号里的读音/译名
//     注释（如 (永远是深夜有多好｡)）不参与 key
//   - 只认整串相等，「小周杰伦」≠「周杰伦」
//   - 值 = 该艺人在 Spotify 等平台的拉丁艺名（可多个：邓紫棋 = G.E.M./Gloria Tang）
//     —— 也可以是 CJK 别名（2026-08-07 起：马赛克乐队 = 马赛克 这类同乐队
//     后缀差异，见下方 馬賽克樂隊 条目）
// 表外名字永远走不到这里（表内无铃木爱理），「铃木爱理 vs Lefty Hand Cream」
// 式翻唱链防线不受影响。
//
// 消费方：
//   - server \`music/translit.ts\` 的 artistTransliterationMatch（跨平台匹配
//     的艺人音译佐证）—— 别名通道先于罗马化
//   - renderer \`lib/groupLibrary.ts\` 的分组（「我的喜欢」弹窗把同歌不同艺人
//     写法合并）—— 同 title 桶内按表判同人
// 两端共用同一张表，避免「server 合并了 / renderer 又拆开」的漂移。
//
// 2026-08-07: 从 QQ 音乐红心歌曲批量导入 355 个艺人映射（算法 s2t/romaji +
// WebSearch 验证英文艺名），大幅扩展覆盖范围。
// ─────────────────────────────────────────────────────────────────────────

import { Converter } from 'opencc-js';
import { cjkUnify } from './normalizer.js';

/** 汉字（含扩展 A / 兼容区）。 */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
/** 平/假名。 */
const KANA = /[぀-ヿ]/;

/** OpenCC 简→繁（cn2t）：表 key 统一用繁体（与 translit 旧实现同口径）。
 * 加载失败降级恒等。 */
let _cn2t: ((text: string) => string) | null = null;
function cn2t(text: string): string {
  if (_cn2t) return _cn2t(text);
  try {
    _cn2t = Converter({ from: 'cn', to: 'tw' });
  } catch {
    _cn2t = (s: string) => s;
  }
  return _cn2t(text);
}

/**
 * 英文艺名别名表（策展，非算法）。
 *
 * ⚠️ normStageName（下方）对**值**做了 cjkUnify（繁→简）统一，所以值可以写
 * 简体或繁体都行——「马赛克」与「馬賽克」命中同一值。key 统一繁体（cn2t）。
 */
const STAGE_NAME_ALIASES: Record<string, string[]> = {
${nonEmpty.map(e => {
  const aliasStr = e.aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
  const commentStr = e.comment ? ` // ${e.comment}` : '';
  return `  '${e.key}': [${aliasStr}],${commentStr}`;
}).join('\n')}
};

/**
 * 艺人名 → 别名表 key：剥掉括号注释（读音/译名）后只取汉字+假名，
 * 再 cn2t 统一为繁体（查表时简繁双查，见 stageNameAliasMatch——表 key
 * 简繁都兼容，2026-08-07 起新条目按国内习惯写简体）。纯拉丁名 → null，
 * 表示「这一侧不是日/中文名，走不了别名通道」。
 */
function stageNameKey(s: string): string | null {
  const stripped = s.replace(/[(（\\[【][^)）\\]】]*[)）\\]】]/g, '');
  let out = '';
  for (const ch of stripped) {
    if (HAN.test(ch) || KANA.test(ch)) out += ch;
  }
  if (!out) {
    // 剥括号后无汉字剩余 → 整串被括号包裹的**格式标记**（QQ 常用
    // 【范逸臣 Van Fan】包艺人名，括号不是注释）。回退：从原串直接取
    // 汉字（不剥括号），「范逸臣」仍能提取。
    for (const ch of s) {
      if (HAN.test(ch) || KANA.test(ch)) out += ch;
    }
  }
  if (!out) return null;
  return cn2t(out);
}

/** 别名值/待比串归一：小写 + 去标点，但**保留汉字**（繁→简统一）。
 *
 * 2026-08-07 扩展：旧实现 \`[^a-z0-9]\` 会把汉字全删——别名值只能放拉丁艺名。
 * 现在支持 CJK 别名（马赛克乐队 = 马赛克），汉字经 cjkUnify 繁→简统一后
 * 参与整串比较。既有拉丁值不受影响（"G.E.M."→"gem"、"JJ Lin"→"jjlin"）。 */
function normStageName(s: string): string {
  return cjkUnify(s).toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
}

/** 查表：key 简繁双查——表内旧条目（繁体 key）与新条目（简体 key）都命中。
 *  stageNameKey 输出经 cn2t 统一为繁体，再试一次 cjkUnify（繁→简）兼容简体 key。 */
function aliasEntry(key: string | null): string[] | undefined {
  if (!key) return undefined;
  return STAGE_NAME_ALIASES[key] ?? STAGE_NAME_ALIASES[cjkUnify(key)];
}

/**
 * 两个艺人名是否命中**策展别名表**（双向）。
 *
 * 只认表内「key 整串相等 + 值整串相等」——不做子串、不做拼音模糊。
 * 表外名字永远 false（「Coldplay vs Cold」「Taylor vs Taylor Swift」不会
 * 因前缀巧合被并，这是当初删掉 artistPrefixMatch 误并事故后的铁律）。
 *
 * 2026-08-07 加「汉字名同人」分支：QQ 等平台常写「范逸臣 Van Fan」这种
 * 汉字名 + 英文别名混合串，与网易云「范逸臣」桥不上英文值（原始串含汉字）。
 * 分支判定「other 的汉字名部分 == key」——如 other 剥括号取汉字后恰好是
 * 表内 key，则同人（「范逸臣 Van Fan」→ 汉字部分「范逸臣」== key）。
 * 安全：英文艺名无汉字 → stageNameKey 返回 null 不参与；「周杰伦的乐团」
 * ≠「周杰伦」（整串才等）。
 */
export function stageNameAliasMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ka = stageNameKey(a);
  const kb = stageNameKey(b);
  const aliasHit = (key: string | null, other: string): boolean => {
    const entry = aliasEntry(key);
    if (!entry) return false;
    if (entry.some((st) => normStageName(st) === normStageName(other))) {
      return true;
    }
    // 汉字名同人分支：other 剥括号取汉字后与 key 整串相等（「范逸臣 Van Fan」
    // 的汉字部分 = 表内 key 范逸臣）。只对表内 key 生效，非启发。
    const otherKey = stageNameKey(other);
    return !!otherKey && otherKey === key;
  };
  if (aliasHit(ka, b)) return true;
  if (aliasHit(kb, a)) return true;
  return false;
}
`;

fs.writeFileSync(ALIAS_PATH, output, 'utf8');
console.log(`✅ Rebuilt artistAlias.ts with ${nonEmpty.length} entries`);
console.log(`   File: ${ALIAS_PATH}`);
