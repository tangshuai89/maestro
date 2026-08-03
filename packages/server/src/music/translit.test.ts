/**
 * 单测：translit.ts 的跨脚本艺人音译佐证（拼音 + kuromoji 日文汉字读音）。
 *
 * 锁死两件事：
 *  1) **拒绝**同名不同艺人的翻唱链（事故根因）：铃木爱理 ≠ Lefty Hand Cream / wacci。
 *  2) **接受** kuromoji 能可靠桥接的规则读音同顺序名：鈴木愛理↔Suzuki Airi、
 *     宇多田ヒカル↔Utada Hikaru、初音ミク↔Hatsune Miku、椎名林檎↔Shiina Ringo。
 *  并显式标注 kuromoji 桥不了的已知局限（顺序颠倒 / 艺名不规则读音），防回归时误判。
 *
 * 运行: npx ts-node src/music/translit.test.ts
 */
export {};
const assert = require('node:assert');
/* eslint-disable @typescript-eslint/no-var-requires */
const { artistTransliterationMatch, warmupJa, romanize } = require('./translit');

async function main() {
  // 先预热 kuromoji（异步加载词典）；不预热则日文汉字读音走空、退回拼音路线。
  await warmupJa();

  // 归一化模拟：测试直接喂「已 normalizeKey 的」形态（小写、无空格标点）。
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\s\-_.,'"()（）]/g, '');

  const accept: Array<[string, string, string]> = [
    ['铃木爱理', 'suzukiairi', '简体日文名 → cn2t+kuromoji → suzukiairi'],
    ['宇多田ヒカル', 'utadahikaru', '汉字+片假名混合名'],
    ['初音ミク', 'hatsunemiku', '汉字+片假名'],
    ['椎名林檎', 'shiinaringo', '纯汉字日文名（规则读音）'],
    ['すずきあいり', 'suzukiairi', '纯假名 → wanakana'],
    ['周杰伦', 'zhoujielun', '中文名拼音自匹配（同串）'],
  ];
  for (const [cjk, latin, why] of accept) {
    assert.ok(
      artistTransliterationMatch(norm(cjk), norm(latin)),
      `应接受: ${cjk} ↔ ${latin}（${why}）| romaji=${romanize(norm(cjk))}`,
    );
  }
  console.log('✅ 1. kuromoji 桥接规则读音同顺序名（Suzuki Airi / Utada Hikaru / Hatsune Miku / Shiina Ringo）');

  // 事故核心：同名不同艺人的翻唱链，音译两两对不上 → 必须全拒。
  const reject: Array<[string, string]> = [
    ['铃木爱理', 'leftyhandcream'],
    ['铃木爱理', 'wacci'],
    ['leftyhandcream', 'wacci'],
    ['wacci', 'suzukiairi'], // wacci 原唱 ≠ 铃木爱理翻唱
    ['铃木奈奈', 'suzukiairi'], // 同姓不同人（防公共前缀误并）
  ];
  for (const [a, b] of reject) {
    assert.strictEqual(
      artistTransliterationMatch(norm(a), norm(b)),
      false,
      `应拒绝: ${a} ↔ ${b}（同姓/同名不同艺人不得音译误并）`,
    );
  }
  console.log('✅ 2. 翻唱链 + 同姓不同人 → 音译对不上一律拒绝（事故根因锁死）');

  // 已知局限（诚实标注，非 bug）：顺序颠倒 / 艺名不规则读音，kuromoji 桥不了。
  // 这里断言「确实桥不了」——若哪天上了 JMnedict 能桥了，这些断言会红，提醒更新文档。
  // 2026-08-03 更新：米津玄師（げんし≠けんし）、藤井風（ふう≠かぜ）已由别名表
  // 策展桥接，移入 ✅6 接受组；这里换成仍桥不了的例子（外来语音译与艺名拼写无关）。
  const knownLimitation: Array<[string, string]> = [
    ['アンジェラ・アキ', 'angelaaki'], // 外来语名：kuromoji/wanakana 读音 anjeraki ≠ 艺名拼写 angelaaki
  ];
  for (const [a, b] of knownLimitation) {
    assert.strictEqual(
      artistTransliterationMatch(norm(a), norm(b)),
      false,
      `已知局限（应仍为 false，改善后请更新文档）: ${a} ↔ ${b}`,
    );
  }
  console.log('✅ 3. 已知局限标注：外来语音译仍桥不了（アンジェラ・アキ ↔ angelaaki）');

  // 2026-08-03 新增：姓名顺序颠倒 + 中文平台带假名读音括号 → 音译桥接。
  // 用户场景：Spotify 用 "Hideaki Tokunaga"（名在前），QQ/网易云用
  // 「德永英明 (とくなが ひであき)」（姓在前 + 读音括号）。kuromoji 拆不对
  // 「德永英明」（IPADIC 无此人名），但括号里的假名直读给出「tokunaga hideaki」。
  // 这是**发音真相**——修「駅 (车站)」的 Spotify 匹配漏掉。
  {
    // 注意：括号里是纯假名读音，feed 原始串（非 norm 后——norm 会剥括号）。
    assert.ok(
      artistTransliterationMatch('德永英明 (とくなが ひであき)', 'Hideaki Tokunaga'),
      '应接受: 德永英明 (とくなが ひであき) ↔ Hideaki Tokunaga（姓名顺序颠倒 + 读音括号直读）',
    );
    assert.ok(
      artistTransliterationMatch('浜崎あゆみ (はまさきあゆみ)', 'Ayumi Hamasaki'),
      '应接受: 浜崎あゆみ (读音括号) ↔ Ayumi Hamasaki',
    );
    console.log('✅ 4. 姓名顺序颠倒 + 假名读音括号 → 音译桥接（修「駅」Spotify 匹配漏）');
  }

  // 2026-08-03 回归：有读音括号时仍不能放翻唱链进来（括号读音是「铃木爱理」的，
  // 拉丁侧是「Lefty」→ 对不上）。
  {
    assert.strictEqual(
      artistTransliterationMatch('铃木爱理 (すずき あいり)', 'leftyhandcream'),
      false,
      '应拒绝: 铃木爱理(读音) ↔ Lefty Hand Cream（翻唱链锁死）',
    );
    assert.strictEqual(
      artistTransliterationMatch('铃木爱理 (すずき あいり)', 'wacci'),
      false,
      '应拒绝: 铃木爱理(读音) ↔ wacci（翻唱链锁死）',
    );
    console.log('✅ 5. 读音括号不放开翻唱链（铃木爱理 ≠ Lefty / wacci）');
  }

  // 2026-08-03 新增：英文艺名别名表（周杰伦 ↔ Jay Chou 这类**非音译**艺名）。
  // 拼音/kuromoji 桥不了（zhoujielun ≠ jaychou），靠策展表精确整串匹配。
  {
    const acceptAlias: Array<[string, string, string]> = [
      ['周杰伦', 'Jay Chou', '非音译英文艺名（本次事故：印地安老斑鳩）'],
      ['Jay Chou', '周杰伦', '双向：拉丁侧在前'],
      ['邓紫棋', 'G.E.M.', '3 字符艺名，不经长度门限'],
      ['林俊杰', 'JJ Lin', '缩写型艺名'],
      ['萧敬腾', 'Jam Hsiao', '非拼音音译'],
      ['五月天', 'Mayday', '乐团名'],
      ['王力宏', 'Wang Leehom', '名前颠倒的拉丁写法'],
      ['張惠妹', 'A-Mei', '繁体输入 → cn2t 统一 key'],
      ['ずっと真夜中でいいのに。', 'ZUTOMAYO', '日语造词型拉丁艺名（kuromoji 桥不了）'],
      ['ずっと真夜中でいいのに。 (永远是深夜有多好｡)', 'ZUTOMAYO', '艺人名带中文译名括号注释（本次事故：ヒューマノイド）'],
      ['サカナクション', 'Sakanaction', '外来语非读音化写法'],
      ['米津玄师', 'Kenshi Yonezu', '艺名不规则读音（げんし≠けんし），别名表策展'],
      ['藤井风', 'Fujii Kaze', '風=かぜ(艺名) vs ふう(通用读)，别名表策展'],
      ['ミレイ', 'milet', '假名 key + 全小写拉丁艺名'],
    ];
    for (const [a, b, why] of acceptAlias) {
      assert.ok(
        artistTransliterationMatch(a, b),
        `应接受: ${a} ↔ ${b}（${why}）`,
      );
    }
    console.log('✅ 6. 英文艺名别名表：周杰伦↔Jay Chou 等非音译艺名（精确整串）');
  }

  {
    const rejectAlias: Array<[string, string, string]> = [
      ['小周杰伦', 'Jay Chou', '表 key 整串相等才认，绝不子串匹配'],
      ['杰伦周', 'Jay Chou', '姓名颠倒 ≠ 同人（表 key 不匹配）'],
      ['周杰伦', 'Michael Jackson', '拉丁侧不在表的别名值里'],
      ['邓紫棋', 'leftyhandcream', '表外拉丁名不得搭表内 key 误并'],
      ['ずっと真夜中でいいのに。', 'Mrs. GREEN APPLE', '表外拉丁名不得搭表内 key 误并'],
      ['真夜中', 'ZUTOMAYO', '表 key 取全名：只留「真夜中」不算同人'],
    ];
    for (const [a, b, why] of rejectAlias) {
      assert.strictEqual(
        artistTransliterationMatch(a, b),
        false,
        `应拒绝: ${a} ↔ ${b}（${why}）`,
      );
    }
    console.log('✅ 7. 别名表防误并：整串匹配 + 表外名不搭表内 key');
  }

  console.log('\n🎉 translit.test 全部 7 项通过');
}

main().catch((err) => {
  console.error('❌ translit.test 失败:', err);
  process.exit(1);
});
