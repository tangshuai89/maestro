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
  const knownLimitation: Array<[string, string]> = [
    ['浜崎あゆみ', 'ayumihamasaki'], // 姓名顺序颠倒
    ['米津玄师', 'kenshiyonezu'], // 艺名不规则读音 + 顺序
    ['藤井风', 'fujiikaze'], // 風=かぜ(艺名) vs ふう(通用读) —— 靠 Tier 3b 兜底
  ];
  for (const [a, b] of knownLimitation) {
    assert.strictEqual(
      artistTransliterationMatch(norm(a), norm(b)),
      false,
      `已知局限（应仍为 false，改善后请更新文档）: ${a} ↔ ${b}`,
    );
  }
  console.log('✅ 3. 已知局限标注：顺序颠倒 / 艺名不规则读音仍桥不了（藤井风↔Fujii Kaze 靠 Tier 3b）');

  console.log('\n🎉 translit.test 全部 3 项通过');
}

main().catch((err) => {
  console.error('❌ translit.test 失败:', err);
  process.exit(1);
});
