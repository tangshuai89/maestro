#!/usr/bin/env node
/**
 * Phase 2: Merge algorithmically-computed + WebSearch-verified English names
 * into artistAlias.ts.
 *
 * Usage: node scripts/merge-alias-entries.js
 *
 * Reads alias-entries.json, applies known English names (from WebSearch),
 * then writes new entries into packages/common/src/artistAlias.ts.
 */

const fs = require('fs');
const path = require('path');

const ENTRIES_PATH = path.resolve(__dirname, 'alias-entries.json');
const ALIAS_PATH = path.resolve(__dirname, '..', 'packages', 'common', 'src', 'artistAlias.ts');

// ── WebSearch-verified English stage names ──────────────────────────────────
// keyed by the entry's `key` field (traditional Chinese / kana / hangul).
// Where an artist has multiple aliases, the English stage name is included.
const VERIFIED_NAMES = {
  // ── Chinese artists (汉→英) ──
  '緑黃色社會': ['Ryokuoushoku Shakai', '绿黄色社会'],
  '孟慧圓': ['Meng Huiyuan', '孟慧圆'],
  '朴樹': ['Pu Shu', '朴树'],
  '袁婭維': ['Tia Ray', '袁娅维'],
  '濱崎步': ['Ayumi Hamasaki', '浜崎あゆみ', '滨崎步'],
  '蔡旻佑': ['Evan Yo', '蔡旻佑'],
  '單依純': ['Shan Yichun', '单依纯'],
  '蛋堡': ['Soft Lipa', '蛋堡'],
  '丁世光': ['Dean Ting', '丁世光'],
  '梁博': ['Liang Bo', '梁博'],
  '毛不易': ['Mao Buyi', '毛不易'],
  '李昕融': ['Li Xinrong', '李昕融'],
  '林英雄': ['Lim Young-woong', 'Lim Young Woong', '임영웅'],
  '蘇見信': ['Shin', '苏见信', '信'],
  '胡彥斌': ['Tiger Hu', 'Anson Hu', '胡彦斌'],
  '久石讓': ['Joe Hisaishi', 'Hisaishi Jō', '久石让'],
  '張震嶽': ['Chang Chen-yue', 'A-Yue', 'Ayal Komod', '张震岳'],
  '五條人': ['Wu Tiao Ren', '五条人'],
  '九連真人': ['Jiulian Zhenren', '九连真人'],
  '葛東琪': ['Ge Dongqi', '葛东琪'],
  '孫盛希': ['Shi Shi', 'Sun Sheng Xi', '孙盛希'],
  // WebSearch remainder (high-confidence)
  '徐子未': ['Xu Ziwei', '徐子未'],
  '十明': ['Toumei', 'Shi Ming', '十明'],
  '聲優小劇場': ['Seiyu Mini Theater', '声优小剧场'],
  '小金': ['DJ Xiaojin', 'DJ Xiao Jin', 'DJ小金'],
  '防彈少年團': ['BTS', 'Bangtan Boys', '防弹少年团', '방탄소년단'],
  '阿杜': ['A-Do', '阿杜'],
  '曾沛慈': ['Pets Tseng', 'Pets Zeng', '曾沛慈'],
  '東京事変': ['Tokyo Jihen', '东京事变', '東京事變'],
  '福祿壽': ['FloruitShow', '福禄寿'],
  '金海心': ['Jin Haixin', '金海心'],
  '林家謙': ['Terence Lam', '林家谦'],
  '洛天依': ['Luo Tianyi', '洛天依'],
  '門尼': ['Menny', '门尼'],
  '乃木坂46': ['Nogizaka46', '乃木坂46'],
  '蔡徐坤': ['Kun', 'Cai Xukun', '蔡徐坤'],
  '曾軼可': ['Yico Tseng', 'Zeng Yike', '曾轶可'],
  '竇靖童': ['Leah Dou', '窦靖童'],
  '寶石Gem': ['Gem', '宝石Gem', '宝石 gem'],
  '郭靜': ['Claire Kuo', '郭静'],
  '黃霄雲': ['Huang Xiaoyun', '黄霄雲'],
  '戴荃': ['Dai Quan', '戴荃'],
  '鞠婧禕': ['Ju Jingyi', 'Kiku', '鞠婧祎'],
  '陳致逸': ['Chen Zhiyi', '陈致逸'],
  '彭佳慧': ['Julia Peng', '彭佳慧'],
  '南拳媽媽': ['Nan Quan Mama', '南拳妈妈'],
  '蜜雪薇琪': ['Michelle Vickie', '蜜雪薇琪'],
  '何維健': ['Derrick Hoh', '何维健'],
  '劉柏辛': ['Lexie Liu', '刘柏辛Lexie', '刘柏辛'],
  '理想混蛋': ['Bestards', '理想混蛋'],
  '皇后皮箱': ['Queen Suitcase', '皇后皮箱'],
  '回春丹樂隊': ['Hui Chun Dan', '回春丹', '回春丹乐队'],
  '跟風超人': ['Gen Feng Chao Ren', '跟风超人'],
  '飛石號': ['Fei Shi Hao', '飞石号'],
  '馬賽克樂隊': ['马赛克', '马赛克乐队'],
  '和平和浪': ['Heping He Lang', '和平和浪'],
  '龍寬九段': ['Long Kuan Jiu Duan', '龙宽九段'],
  '天炫男孩': ['Tension', '天炫男孩'],
  '知更鳥': ['Zhi Geng Niao', '知更鸟'],
  '草食考拉': ['Grass Koala', '草食考拉'],

  // ── Japanese artists ──
  '上白石萌音': ['Mone Kamishiraishi', '上白石萌音'],
  'キング・ヌー': ['King Gnu'],
  'ヨアソビ': ['YOASOBI'],
  'まじ娘': ['majiko'],
  'イワミズ': ['iwamizu'],
  '浜崎あゆみ': ['Ayumi Hamasaki', '浜崎あゆみ'],
  '椎名林檎': ['Ringo Sheena', 'Sheena Ringo', '椎名林檎'],
  'あいこ': ['aiko'],
  '松本梨香': ['Rica Matsumoto', '松本梨香'],
  'しばたじゅん': ['Jun Shibata', '柴田淳'],
  'てしまあおい': ['Aoi Teshima', '手嶌葵'],
  'バックナンバー': ['back number'],
  'ブルー・スウィング': ['BLU-SWING'],
  'ジャバループ': ['JABBERLOOP'],
  'オフィシャルひげだん': ['Official HIGE DANDISM', 'Official髭男dism'],
  'さかもとりゅういち': ['Ryuichi Sakamoto', '坂本龍一', '坂本龙一'],
  'とくながひであき': ['Hideaki Tokunaga', '德永英明'],
  'はなざわかな': ['Kana Hanazawa', '花澤香菜'],
  'すずきあいり': ['Airi Suzuki', '铃木爱理'],
  'みゆな': ['Miyuna', '迷悠奈'],
  'なかむらゆりこ': ['Yuriko Nakamura', '中村由利子'],
  'グミ': ['GUMI'],
  'りプラス': ['Re:Plus'],
  'アトラスサウンドチーム': ['Atlus Sound Team'],
  'りりあ': ['Riria.', 'りりあ。'],
  'あいみょん': ['Aimyon', '爱缪'],
  'おかざきたいいく': ['Taiku Okazaki', '岡崎体育'],
  'はな': ['Hana', '花たん'],
  'いくら': ['Ikura', '幾田りら', 'ikura'],
  'すだまさき': ['Masaki Suda', '菅田将晖'],
  'こうさきさとる': ['Satoru Kōsaki', '神前暁'],
  'くまきあんり': ['Anri Kumaki', '熊木杏里'],
  'エゴイスト': ['EGOIST'],
  'リリィさよなら': ['Lily Sayonara', 'Lily, Sayonara'],
  'おりべさとし': ['LiSA', '织部里沙'],
  'まこ': ['MACO'],
  'れをる': ['Reol'],
  'ソフトリー': ['Softly'],
  'ユニゾン・スクエア・ガーデン': ['UNISON SQUARE GARDEN'],
  'ユイ': ['YUI'],
  'クリス・ハート': ['Chris Hart'],
  'ゲスのきわみおとめ': ['Gesu no Kiwami Otome', '极度卑劣少女'],
  'ずっとまよなかでいいのに': ['ZUTOMAYO', 'ZTMY', 'ずっと真夜中でいいのに'],
  'ふじいかぜ': ['Fujii Kaze', '藤井風'],
  'あんぜんちたい': ['Anzen Chitai', '安全地帯'],
  'やおいち': ['8#Prince', '八王子P', 'Hachioji P'],
  'さかもときゅう': ['Kyu Sakamoto', '坂本九'],
  'いたのともみ': ['Tomomi Itano', '板野友美'],
  'かわせともこ': ['Tomoko Kawase', 'Tommy heavenly6', '川濑智子'],
  'うちくびごくもんどうこうかい': ['Uchikubi Gokumon Doukoukai', '打首狱门同好会'],
  'おおたにいくえ': ['Ikue Otani', '大谷育江'],
  'おおいしまさよし': ['Masayoshi Oishi', '大石昌良', 'オーイシマサヨシ'],
  'おおはらゆいこ': ['Yuiko Ohara', '大原ゆい子'],
  'おおさわあつし': ['Atsushi Osawa', '大澤敦史'],
  'とうやまみれい': ['Mirei Touyama', '当山真玲', '當山みれい'],
  'ちょうちょ': ['Chouchou P', '蝶々P'],
  'にのみやあい': ['Ai Ninomiya', '二宮愛'],
  'ふうきはるみ': ['Harumi Fuuki', '富贵晴美'],
  'たかはしひとみ': ['Hitomi Takahashi', '高橋瞳'],
  'たかはしあずみ': ['Azumi Takahashi', '高橋あず美'],
  'ふわくも': ['Ukigumo', '浮雲'],
  'みやかわくん': ['Miyakawa-kun', '宮川大聖'],
  'よこはまぎんばえ': ['Yokohama Ginbae', '横浜銀蠅'],
  'はなばな': ['Hana Hana', '花*花'],
  'かわいなおこ': ['Naoko Kawai', '河合奈保子'],
  'よしかわけい': ['Kei Yoshikawa', '吉川慶'],
  'いえいりれお': ['Leo Ieiri', '家入レオ', '家入莉奥'],
  'いのうえそのこ': ['Sonoko Inoue', '井上苑子'],
  'かがみねれん': ['Kagamine Len', '镜音连', '鏡音レン'],
  'かがみねりん': ['Kagamine Rin', '镜音铃', '鏡音リン'],
  'くりぷりん': ['Kuripurin', '栗プリン'],
  'たきざわいちる': ['Takizawa Ichiru', '瀧沢一留'],
  'さぎすしろう': ['Shiro Sagisu', '鹭巣诗郎'],
  'うちだまあや': ['Maaya Uchida', '内田真礼'],
  'うちだましろ': ['Mashiro Uchida', '内田ましろ'],
  'すずきあんな': ['Anna Suzuki', '鈴木杏奈'],
  'すずきまさゆき': ['Masayuki Suzuki', '鈴木雅之'],
  'けやきざか': ['Keyakizaka46', '欅坂46'],
  'よあそび': ['YOASOBI', 'ヨアソビ'],
  'まつもと': ['Rica Matsumoto', 'Rika Matsumoto', '松本梨香'],

  // ── Korean artists ──
  '임영웅': ['Lim Young-woong', 'Lim Young Woong'],
  '이소라': ['Lee Sora', 'Lee So-ra', '李素罗'],
  '임한별': ['Lim Han Byul', '林韩星'],
  '강지영': ['Kang Ji-young', '姜智英', 'Jiyoung'],
  '김범수': ['Kim Bum-soo', '金范洙'],
  '이영지': ['Lee Young-ji', '李泳知'],
  '투피엠': ['2PM'],
  '엔하이픈': ['ENHYPEN'],
  '태양': ['TAEYANG', '太阳'],
  '김영소': ['Kim Young-so', '金永所', 'YOUNGSO'],

  // ── Cross-language entries (name contains both CJK and Latin) ──
  'YELLOW黃宣': ['YELLOW', 'Yellow Huang', '黄宣'],
  'SING女團': ['SING', 'SING女团'],
};

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const entries = JSON.parse(fs.readFileSync(ENTRIES_PATH, 'utf8'));

  // Build final alias map
  const newEntries = [];

  for (const entry of entries) {
    let key = entry.key;
    let aliases = [];

    // 1. Check VERIFIED_NAMES lookup
    if (VERIFIED_NAMES[key]) {
      aliases = VERIFIED_NAMES[key];
    } else {
      // 2. Use algorithmic aliases
      aliases = entry.aliases || [];
    }

    // 3. Deduplicate: remove aliases that are the same as the key
    aliases = aliases.filter(a => a !== key);

    // 4. Ensure simplified variant is always present for Hanzi keys
    const { Converter } = require('opencc-js');
    let s2t, t2s;
    try { s2t = Converter({ from: 'cn', to: 'tw' }); } catch { s2t = s => s; }
    try { t2s = Converter({ from: 'tw', to: 'cn' }); } catch { t2s = s => s; }

    // Add simplified variant
    try {
      const simplified = t2s(key);
      if (simplified !== key && !aliases.includes(simplified)) {
        aliases.push(simplified);
      }
    } catch {}

    // Add traditional variant
    try {
      const traditional = s2t(key);
      if (traditional !== key && !aliases.includes(traditional)) {
        aliases.push(traditional);
      }
    } catch {}

    // Deduplicate again
    aliases = [...new Set(aliases)].filter(a => a && a.length >= 1);

    newEntries.push({ key, aliases, count: entry.count, name: entry.name });
  }

  // Sort: high count first
  newEntries.sort((a, b) => b.count - a.count);

  // ── Read artistAlias.ts and insert entries ──
  let src = fs.readFileSync(ALIAS_PATH, 'utf8');

  // Find the insertion point: just before the closing `};` of STAGE_NAME_ALIASES
  const insertMarker = 'const STAGE_NAME_ALIASES';
  const closingMarker = '\n};';
  const startIdx = src.indexOf(insertMarker);
  if (startIdx === -1) {
    console.error('Could not find STAGE_NAME_ALIASES in artistAlias.ts');
    process.exit(1);
  }

  // Find the closing }; of the object — it's the first one after STAGE_NAME_ALIASES
  const afterStart = src.indexOf(closingMarker, startIdx);
  if (afterStart === -1) {
    console.error('Could not find closing }; of STAGE_NAME_ALIASES');
    process.exit(1);
  }

  // Generate new entries block
  let insertBlock = '';
  insertBlock += '\n';
  insertBlock += '  // ── 2026-08-07 batch import from QQ liked artists ──\n';
  insertBlock += '  // Auto-generated by scripts/build-alias-entries.js +\n';
  insertBlock += '  // WebSearch-verified English stage names. Sorted by song count desc.\n';

  for (const e of newEntries) {
    const aliasArr = e.aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
    const comment = e.name ? ` // ${e.name} (${e.count}首)` : ` // ${e.count}首`;
    insertBlock += `  '${e.key}': [${aliasArr}],${comment}\n`;
  }

  // Insert before closing };
  const newSrc = src.slice(0, afterStart) + insertBlock + '\n};' + src.slice(afterStart + closingMarker.length);

  // ── Write ──
  fs.writeFileSync(ALIAS_PATH, newSrc, 'utf8');
  console.log(`✅ Merged ${newEntries.length} entries into artistAlias.ts`);

  // Stats
  const withEnglish = newEntries.filter(e => e.aliases.length > 1);
  const minimal = newEntries.filter(e => e.aliases.length <= 1);
  console.log(`   With English names: ${withEnglish.length}`);
  console.log(`   Minimal (s2t only): ${minimal.length}`);

  // Write a report of minimal entries that still need work
  const reportPath = path.resolve(__dirname, 'alias-entries-need-work.md');
  let report = '# Artists still needing English name verification\n\n';
  report += `Generated ${new Date().toISOString().slice(0, 19)}\n\n`;
  report += '| # | Key | QQ Name | Count |\n';
  report += '|---|-----|---------|-------|\n';
  minimal.forEach((e, i) => {
    report += `| ${i + 1} | ${e.key} | ${e.name} | ${e.count} |\n`;
  });
  fs.writeFileSync(reportPath, report, 'utf8');
  console.log(`   Need-work report: ${reportPath} (${minimal.length} entries)`);
}

main();
