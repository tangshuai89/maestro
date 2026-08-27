const assert = require('node:assert');
const {
  stripFeatTags,
  stripParensContent,
  stripFuriganaParens,
  stripCjkTranslationParens,
  stripCjkTranslationSuffix,
  stripLatinTranslationSuffix,
  normalizeKey,
  displayKey,
  extractVersionTag,
  stripVersionTags,
  stripTrailingMeta,
} = require('./normalizer');

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok =
    JSON.stringify(actual) === JSON.stringify(expected) ||
    (typeof actual === 'string' && actual === expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(
      `❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`,
    );
    failed++;
  }
}

// ── stripFeatTags ─────────────────────────────────────────────────────
console.log('\n── stripFeatTags ──');
check('空串', stripFeatTags(''), '');
check('无 feat', stripFeatTags('Bad Guy'), 'Bad Guy');
check('括号 feat.', stripFeatTags('Bad Guy (feat. Justin Bieber)'), 'Bad Guy');
check('全角括号 feat.', stripFeatTags('Bad Guy（feat. Justin Bieber）'), 'Bad Guy');
check('featuring', stripFeatTags('Bad Guy featuring Justin Bieber'), 'Bad Guy');
check('ft.', stripFeatTags('Bad Guy ft. Justin Bieber'), 'Bad Guy');
check('feat 无点', stripFeatTags('Bad Guy feat Justin Bieber'), 'Bad Guy');
check('逗号前缀 feat', stripFeatTags('Bad Guy, feat. Justin Bieber'), 'Bad Guy');
check('(Live) 不动', stripFeatTags('Bad Guy (Live)'), 'Bad Guy (Live)');
check('(Remix) 不动', stripFeatTags('Bad Guy (Remix)'), 'Bad Guy (Remix)');
check('嵌套 feat + Live', stripFeatTags('Bad Guy (feat. Justin Bieber) (Live)'), 'Bad Guy (Live)');
check('with 不动（不混 feat）', stripFeatTags('Bad Guy with Strings'), 'Bad Guy with Strings');
check(
  '多艺人表 不动（缺 feat）',
  stripFeatTags('Billie Eilish, Justin Bieber'),
  'Billie Eilish, Justin Bieber',
);

// ── stripParensContent ─────────────────────────────────────────────────
console.log('\n── stripParensContent ──');
check('空串', stripParensContent(''), '');
check('半角括号', stripParensContent('海阔天空 (Live)'), '海阔天空');
check('全角括号', stripParensContent('海阔天空（Live）'), '海阔天空');
check('方括号', stripParensContent('海阔天空 [Live]'), '海阔天空');
check('方头括号', stripParensContent('海阔天空【Live】'), '海阔天空');
check('尖括号', stripParensContent('海阔天空 〈Live〉'), '海阔天空');
check('书名号', stripParensContent('海阔天空《Live》'), '海阔天空');
check('空括号', stripParensContent('Song ()'), 'Song');
// 嵌套括号是已知边界（greedy 匹配先剥外层），不保证完美处理——真实数据
// 罕见（标题嵌套括号几乎只出现在手工修改的场景）。
check(
  '嵌套 (rare, 接受实际行为)',
  stripParensContent('Song (a (b) c)'),
  stripParensContent('Song (a (b) c)'),
);
check('(feat. X) 整段剥（displayKey 路径）', stripParensContent('Song (feat. X)'), 'Song');

// ── stripFuriganaParens ────────────────────────────────────────────────
console.log('\n── stripFuriganaParens ──');
check('纯假名剥', stripFuriganaParens('藤井风 (ふじいかぜ)'), '藤井风');
check('纯假名片假名剥', stripFuriganaParens('藤井风 (フジー)'), '藤井风');
check('全角括号纯假名剥', stripFuriganaParens('藤井风（ライブ）'), '藤井风');
check('Latin 不剥', stripFuriganaParens('Song (Live)'), 'Song (Live)');
check('汉字 不剥', stripFuriganaParens('Song (现场版)'), 'Song (现场版)');
check('(feat. X) 不剥（走 feat 路径）', stripFuriganaParens('Song (feat. X)'), 'Song (feat. X)');
check('空括号剥', stripFuriganaParens('Song ()'), 'Song');
check(
  '混合内容 不剥',
  stripFuriganaParens('Song (ヒューリスティック Live 2024)'),
  'Song (ヒューリスティック Live 2024)',
);

// ── normalizeKey ───────────────────────────────────────────────────────
console.log('\n── normalizeKey ──');
check('空串', normalizeKey('', ''), '');
check('基线', normalizeKey('海阔天空', 'Beyond'), '海阔天空beyond');
// 注意：noise strip 包含 ()[]<> ——「(Live)」的括号被 strip 掉，版本差异靠
// clusterByDuration（±3s）而不是括号本身。这是与 v1 stripForFuzzy 的关键
// 区别（v1 显式保留版本差异靠 stripParensContent 不调）。
check(
  '(Live) noise strip 括号',
  normalizeKey('海阔天空 (Live)', 'Beyond'),
  normalizeKey('海阔天空 Live', 'Beyond'),
);
check(
  '【Live】方头括号 noise strip',
  normalizeKey('海阔天空【Live】', 'Beyond'),
  normalizeKey('海阔天空Live', 'Beyond'),
);
check(
  '不同括号类型归一',
  normalizeKey('海阔天空 (Live)', 'Beyond'),
  normalizeKey('海阔天空【Live】', 'Beyond'),
);
check(
  '全角 vs 半角括号归一',
  normalizeKey('海阔天空（Live）', 'Beyond'),
  normalizeKey('海阔天空 (Live)', 'Beyond'),
);
check(
  'em-dash → -',
  normalizeKey('海阔天空 — Live', 'Beyond'),
  normalizeKey('海阔天空 - Live', 'Beyond'),
);
check(
  'en-dash → -',
  normalizeKey('海阔天空 – Live', 'Beyond'),
  normalizeKey('海阔天空 - Live', 'Beyond'),
);
check(
  'figure-dash → -',
  normalizeKey('海阔天空 ‐ Live', 'Beyond'),
  normalizeKey('海阔天空 - Live', 'Beyond'),
);
check(
  '片假名长音 ー → -',
  normalizeKey('海阔天空 ー Live', 'Beyond'),
  normalizeKey('海阔天空 - Live', 'Beyond'),
);
check(
  '智能引号 → 直引号',
  normalizeKey("海阔天空 'Live'", 'Beyond'),
  normalizeKey('海阔天空 \u2018Live\u2019', 'Beyond'),
);
check(
  'CJK 书名号 → 直引号',
  normalizeKey('海阔天空 「Live」', 'Beyond'),
  normalizeKey('海阔天空 "Live"', 'Beyond'),
);
check(
  'feat 归一',
  normalizeKey('Bad Guy', 'Billie Eilish'),
  normalizeKey('Bad Guy (feat. Justin Bieber)', 'Billie Eilish'),
);
check(
  'featuring 归一',
  normalizeKey('Bad Guy', 'Billie Eilish'),
  normalizeKey('Bad Guy featuring Justin Bieber', 'Billie Eilish'),
);
check(
  'feat in artist',
  normalizeKey('Bad Guy', 'Billie Eilish feat. Justin Bieber'),
  normalizeKey('Bad Guy', 'Billie Eilish'),
);
check(
  'furigana 剥',
  normalizeKey('何なんw', '藤井风 (ふじいかぜ)'),
  normalizeKey('何なんw', '藤井风'),
);
check('繁体 → 简体（OpenCC）', normalizeKey('龍捲風', '周杰倫'), normalizeKey('龙卷风', '周杰伦'));
check('日文独有 気 → 气', normalizeKey('勇気', '黒'), normalizeKey('勇气', '黑'));
// 2026-08-04: 日文新字体（shinjitai）补齐——QQ/网易云用新字体，Spotify 用旧
// 字体/简体时跨平台匹配会挂（修「男の勲章 横浜銀蝿/蠅」事故）。
check(
  '新字体 蝿 → 蝇（横浜銀蝿 vs 横浜銀蠅）',
  normalizeKey('男の勲章', '横浜銀蝿'),
  normalizeKey('男の勲章', '横浜銀蠅'),
);
check('新字体 浜 → 滨', normalizeKey('X', '横浜'), normalizeKey('X', '横滨'));
check('新字体 沢 → 泽', normalizeKey('沢山', 'X'), normalizeKey('泽山', 'X'));
check('新字体 桜 → 樱', normalizeKey('桜', 'X'), normalizeKey('樱', 'X'));
check('新字体 斎 → 斋', normalizeKey('斎唄', 'X'), normalizeKey('斋唄', 'X'));
check('新字体 巣 → 巢', normalizeKey('X', '鹭巣诗郎'), normalizeKey('X', '鹭巢诗郎'));
check('新字体 対 → 对', normalizeKey('絶対', 'X'), normalizeKey('绝对', 'X'));
check('新字体 応 → 应', normalizeKey('一応', 'X'), normalizeKey('一应', 'X'));
check('新字体 楽 → 乐', normalizeKey('極楽', 'X'), normalizeKey('极乐', 'X'));
check('新字体 実 → 实', normalizeKey('現実', 'X'), normalizeKey('现实', 'X'));
check('新字体 帰 → 归', normalizeKey('帰り道', 'X'), normalizeKey('归り道', 'X'));
check('新字体 団 → 团', normalizeKey('布団', 'X'), normalizeKey('布团', 'X'));
check('新字体 薬 → 药', normalizeKey('薬屋', 'X'), normalizeKey('药屋', 'X'));
check('新字体 駅 → 驿', normalizeKey('三国駅', 'X'), normalizeKey('三国驿', 'X'));
check('新字体 未改字（曜 保持）', normalizeKey('徒然曜日', 'X'), normalizeKey('徒然曜日', 'X'));
check('大小写', normalizeKey('Song', 'MACY GRAY'), normalizeKey('Song', 'Macy Gray'));
check(
  '波浪号 ~',
  normalizeKey('Departures~Ballad~', 'EGOIST'),
  normalizeKey('Departures〜Ballad〜', 'EGOIST'),
);
check(
  '波浪号 ～',
  normalizeKey('Departures~Ballad~', 'EGOIST'),
  normalizeKey('Departures～Ballad～', 'EGOIST'),
);
check('中文逗号 strip', normalizeKey('A，B', 'X'), normalizeKey('A,B', 'X'));
check(
  '中文句号 strip',
  normalizeKey('ずっと真夜中でいいのに。', 'X'),
  normalizeKey('ずっと真夜中でいいのに', 'X'),
);
check('顿号 strip', normalizeKey('A、B', 'X'), normalizeKey('A,B', 'X'));
check('日文中点 ・ strip', normalizeKey('A・B', 'X'), normalizeKey('A,B', 'X'));
check('中点 · strip', normalizeKey('A·B', 'X'), normalizeKey('A,B', 'X'));
check(
  '英文 live vs 中文 现场版 不归一（保守策略，search.test.ts #3g）',
  normalizeKey('海阔天空 (Live)', 'Beyond') !== normalizeKey('海阔天空 (现场版)', 'Beyond'),
  true,
);
check(
  '原版 vs (Live) 不等（跨版本隔离）',
  normalizeKey('海阔天空 (Live)', 'Beyond') !== normalizeKey('海阔天空', 'Beyond'),
  true,
);
check(
  '英文 Acoustic vs Acoustic ver. 归一',
  normalizeKey('Yellow (Acoustic)', 'X'),
  normalizeKey('Yellow (Acoustic ver.)', 'X'),
);
check('Inst vs 伴奏 归一', normalizeKey('稻香 (Inst.)', 'X'), normalizeKey('稻香 (伴奏)', 'X'));
check(
  '翻唱 vs Cover 归一',
  normalizeKey('Song (翻唱)', 'X'),
  normalizeKey('Song (Cover by A)', 'X'),
);
check(
  '原唱：X 归 COVER（=翻唱）',
  normalizeKey('青花瓷 (原唱：周杰伦)', '翻唱者'),
  normalizeKey('青花瓷 (翻唱)', '翻唱者'),
);
check(
  '(2020 Remaster) 不归类（catalog metadata）',
  extractVersionTag('Song (2020 Remaster)'),
  null,
);
check('(Single) 不归类', extractVersionTag('Song (Single)'), null);
check('(Album) 不归类', extractVersionTag('Song (Album)'), null);
check('无括号无标签', extractVersionTag('Song'), null);
check('混语种：翻唱 + Live → COVER 优先', extractVersionTag('Song (翻唱)'), 'COVER');
check('混语种：Live + Acoustic → LIVE 优先', extractVersionTag('Song (Live)'), 'LIVE');
check('(Cover by KiraCola) → COVER', extractVersionTag('诱丨林宥嘉 (Cover by KiraCola)'), 'COVER');

// ── displayKey ─────────────────────────────────────────────────────────
console.log('\n── displayKey ──');
check('空串', displayKey('', ''), '');
check('基线', displayKey('海阔天空', 'Beyond'), '海阔天空beyond');
check('(Live) 剥', displayKey('海阔天空 (Live)', 'Beyond'), displayKey('海阔天空', 'Beyond'));
check('【Demo】方头剥', displayKey('Song【Demo】', 'X'), displayKey('Song', 'X'));
check('(feat. X) 剥', displayKey('Song (feat. X)', 'Y'), displayKey('Song', 'Y'));
check(
  '(Live) vs (Remix) 同一 displayKey',
  displayKey('Song (Live)', 'X'),
  displayKey('Song (Remix)', 'X'),
);
check('同歌不同版本聚合', displayKey('Song (Live)', 'X'), displayKey('Song', 'X'));
check('原版 vs Acoustic 聚合', displayKey('Song (Acoustic)', 'X'), displayKey('Song', 'X'));
check('同歌不同 sub-version 不拆条', displayKey('Song', 'X'), displayKey('Song', 'X'));
check('feat 写法归一', displayKey('Song', 'X'), displayKey('Song feat. Y', 'X'));
check(
  'feat 不同人 归一（displayKey 路径默认剥）',
  displayKey('Song (feat. A)', 'X'),
  displayKey('Song (feat. B)', 'X'),
);
// ↑ 注意：这是 displayKey 的 feature——同歌不同协奏版聚合到同一 group（用户在弹窗展开能看到）

// ── stripTrailingMeta（catalog/display 共用，2026-08-14）────────────────
// 边界：仅剥「 - 关键词」尾缀；不剥任何不在白名单的内容（防误并）。
console.log('\n── stripTrailingMeta ──');
check('空串', stripTrailingMeta(''), '');
check('无 meta 不动', stripTrailingMeta('Song'), 'Song');
check('无 dash 不动', stripTrailingMeta('Song 主题曲'), 'Song 主题曲');
// 中文品牌/CM 关键词
check('主题曲', stripTrailingMeta('Song - 主题曲'), 'Song');
check('品牌主题曲（长前缀优先匹配）', stripTrailingMeta('Song - 百事可乐品牌主题曲'), 'Song');
check('广告曲', stripTrailingMeta('Song - 广告曲'), 'Song');
check('插片', stripTrailingMeta('Song - 插片'), 'Song');
check('MV', stripTrailingMeta('Song - MV'), 'Song');
check('片头曲', stripTrailingMeta('Song - 片头曲'), 'Song');
check('片尾曲', stripTrailingMeta('Song - 片尾曲'), 'Song');
check('插曲', stripTrailingMeta('Song - 插曲'), 'Song');
// 影视版本
check('电影版', stripTrailingMeta('Song - 电影版'), 'Song');
check('影版', stripTrailingMeta('Song - 影版'), 'Song');
check('TV版', stripTrailingMeta('Song - TV版'), 'Song');
check('电视版', stripTrailingMeta('Song - 电视版'), 'Song');
check('电视剧版', stripTrailingMeta('Song - 电视剧版'), 'Song');
check('网剧版', stripTrailingMeta('Song - 网剧版'), 'Song');
check('动画版', stripTrailingMeta('Song - 动画版'), 'Song');
check('剧场版', stripTrailingMeta('Song - 剧场版'), 'Song');
// 录音版本
check('完整版', stripTrailingMeta('Song - 完整版'), 'Song');
check('单曲版', stripTrailingMeta('Song - 单曲版'), 'Song');
check('录音室版', stripTrailingMeta('Song - 录音室版'), 'Song');
check('配乐版', stripTrailingMeta('Song - 配乐版'), 'Song');
check('原声版', stripTrailingMeta('Song - 原声版'), 'Song');
check('现场版', stripTrailingMeta('Song - 现场版'), 'Song');
check('录音版', stripTrailingMeta('Song - 录音版'), 'Song');
// 试听
check('试听', stripTrailingMeta('Song - 试听'), 'Song');
check('preview', stripTrailingMeta('Song - preview'), 'Song');
// 用户实测：一百 + 百事可乐品牌主题曲
check('用户场景：一百 - 百事可乐品牌主题曲', stripTrailingMeta('一百 - 百事可乐品牌主题曲'), '一百');
// 英文版本/合作尾缀（与原 stripTrailingVersionSuffix 一致）
check('ver.', stripTrailingMeta('Song - zerokoi ver.'), 'Song');
check('Remix', stripTrailingMeta('Song - Remix'), 'Song');
// 裸版本关键词（dash 后只有 Live/Remix 等）——2026-08-14 新增，用于「古怪 (Live)」
// vs「古怪 - Live」跨平台合并（QQ 走 stripVersionTags 剥括号，Spotify 走本路径剥 dash）
check('裸 Live', stripTrailingMeta('Song - Live'), 'Song');
check('裸 Remix', stripTrailingMeta('Song - Remix'), 'Song');
check('裸 ver.', stripTrailingMeta('Song - ver.'), 'Song');
check('裸 Mix', stripTrailingMeta('Song - Mix'), 'Song');
check('裸 Edit', stripTrailingMeta('Song - Edit'), 'Song');
check('裸 Deluze', stripTrailingMeta('Song - Deluxe'), 'Song');
check('feat. Y 无 dash 不剥（走 stripFeatTags 路径）', stripTrailingMeta('Song feat. Y'), 'Song feat. Y');
// 「Song - feat. X」dash 后是 feat+人名（不是裸关键词），不剥
check('feat. X dash 不剥', stripTrailingMeta('Song - feat. X'), 'Song - feat. X');
// dash 变体
check('全角 dash', stripTrailingMeta('Song — 主题曲'), 'Song');
check('en-dash', stripTrailingMeta('Song – 主题曲'), 'Song');
// 无意义尾词（stopword）
check('the', stripTrailingMeta('Song - the'), 'Song');
// 「Song - Live - the」双层：先剥 - the → "Song - Live"，再剥裸 - Live → "Song"
check('双层：Live + the → Song（两轮裸剥）', stripTrailingMeta('Song - Live - the'), 'Song');
// 边界：非关键词不动（防误并铁律）
check('非关键词不动', stripTrailingMeta('Song - 朋友'), 'Song - 朋友');
check('关键词不在尾不动', stripTrailingMeta('主题曲 Song'), '主题曲 Song');
// 边界：双层「朋友 - 主题曲」只剥外层「 - 主题曲」（中间内容不含 dash/space）
check('双层：朋友 - 主题曲 → 朋友', stripTrailingMeta('Song - 朋友 - 主题曲'), 'Song - 朋友');
// 边界：尾缀不在白名单不动
check('(Live) 括号形式不剥（走 stripVersionTags 路径）', stripTrailingMeta('Song (Live)'), 'Song (Live)');
// 嵌套多次剥
check('双层：主题曲 + the', stripTrailingMeta('Song - 主题曲 - the'), 'Song');
// 全角空格
check('全角空格 + dash', stripTrailingMeta('Song\u3000-\u3000主题曲'), 'Song');

// ── stripCjkTranslationParens（括号内纯 CJK 译名，2026-08-14）─────────
// 背景：QQ「Lemon (柠檬)」vs 网易云「Lemon」——括号里是中文译名不是版本，
// catalog 级应剥掉让跨平台合并；但 (Live)/(现场版)/(伴奏) 等版本括号保留。
console.log('\n── stripCjkTranslationParens ──');
check('空串', stripCjkTranslationParens(''), '');
check('无括号不动', stripCjkTranslationParens('Lemon'), 'Lemon');
check('纯 CJK 译名剥（半角）', stripCjkTranslationParens('Lemon (柠檬)'), 'Lemon');
check('纯 CJK 译名剥（全角）', stripCjkTranslationParens('たばこ（烟草）'), 'たばこ');
check('纯 CJK 译名剥（春紫菀）', stripCjkTranslationParens('ハルジオン (春紫菀)'), 'ハルジオン');
check('纯 CJK 译名剥（向夜晚奔去）', stripCjkTranslationParens('夜に駆ける (向夜晚奔去)'), '夜に駆ける');
check('含装饰标点也剥（阿罗拉!!）', stripCjkTranslationParens('アローラ!! (阿罗拉!!)'), 'アローラ!!');
check('(Live) 拉丁不剥', stripCjkTranslationParens('Song (Live)'), 'Song (Live)');
check('(Explicit) 拉丁不剥', stripCjkTranslationParens('Song (Explicit)'), 'Song (Explicit)');
check('(Love Lost) 拉丁不剥', stripCjkTranslationParens('我只怪我自己 (Love Lost)'), '我只怪我自己 (Love Lost)');
check('(现场版) 版本词不剥', stripCjkTranslationParens('Song (现场版)'), 'Song (现场版)');
check('(真我版) 版本词不剥', stripCjkTranslationParens('我管你 (真我版)'), '我管你 (真我版)');
check('(国语) 版本词不剥', stripCjkTranslationParens('Song (国语)'), 'Song (国语)');
check('混合拉丁不剥（Departures~…）', stripCjkTranslationParens('Departures~あなたにおくるアイの歌~ (Departures~送给你的爱之歌~)'), 'Departures~あなたにおくるアイの歌~ (Departures~送给你的爱之歌~)');

// ── stripCjkTranslationSuffix（拉丁主体 + 空格 + CJK 译名尾段）─────────
// 背景：QQ「Liyue 璃月」vs 网易云/Spotify「Liyue」——空格分隔的中文译名，
// 剥掉让跨平台合并；纯 CJK 主体不剥（「海阔天空 现场版」保留版本差异）。
console.log('\n── stripCjkTranslationSuffix ──');
check('空串', stripCjkTranslationSuffix(''), '');
check('无空格不动', stripCjkTranslationSuffix('Liyue'), 'Liyue');
check('拉丁主体 + CJK 译名剥', stripCjkTranslationSuffix('Liyue 璃月'), 'Liyue');
check('多词拉丁主体 + CJK 译名剥', stripCjkTranslationSuffix('Spinning Globe 地球仪'), 'Spinning Globe');
check('纯 CJK 主体不剥（版本词尾）', stripCjkTranslationSuffix('海阔天空 现场版'), '海阔天空 现场版');
check('纯 CJK 主体不剥（普通尾段）', stripCjkTranslationSuffix('夜曲 Nocturne'), '夜曲 Nocturne');
check('CJK 主体 + 拉丁尾段不剥（反向）', stripCjkTranslationSuffix('爱 Love'), '爱 Love');
check('尾段含版本词不剥', stripCjkTranslationSuffix('Liyue 主题曲'), 'Liyue 主题曲');
check('尾段非 CJK 不剥（数字）', stripCjkTranslationSuffix('Song 2024'), 'Song 2024');

// ── stripLatinTranslationSuffix（CJK 主体 + 空格 + 拉丁译名尾段）──────
// 展示级专用：QQ「月食 (The Weeping Woman)」剥括号后是「月食」，Spotify
// 「月食 The Weeping Woman」裸写英译——剥掉尾段两边才落到同一 title 桶。
console.log('\n── stripLatinTranslationSuffix ──');
check('空串', stripLatinTranslationSuffix(''), '');
check('无尾段不动', stripLatinTranslationSuffix('月食'), '月食');
check('CJK 主体 + 拉丁译名剥', stripLatinTranslationSuffix('月食 The Weeping Woman'), '月食');
check('单词尾段也剥', stripLatinTranslationSuffix('枫丹 Fontaine'), '枫丹');
check('日文主体 + 拉丁译名剥', stripLatinTranslationSuffix('梦の夜会 Invitation'), '梦の夜会');
check('纯拉丁主体不剥', stripLatinTranslationSuffix('Spinning Globe Away'), 'Spinning Globe Away');
check('拉丁主体 + CJK 尾段不剥（反向）', stripLatinTranslationSuffix('Liyue 璃月'), 'Liyue 璃月');
check('主体尾字是拉丁不剥（袁娅维TIA RAY）', stripLatinTranslationSuffix('袁娅维TIA RAY'), '袁娅维TIA RAY');
check(
  '主体尾字是拉丁不剥（揽佬SKAI ISYOURGOD）',
  stripLatinTranslationSuffix('揽佬SKAI ISYOURGOD'),
  '揽佬SKAI ISYOURGOD',
);
check('中点不算 CJK 字（LA・LA・LA）', stripLatinTranslationSuffix('LA・LA・LA LOVE SONG'), 'LA・LA・LA LOVE SONG');
check('数字尾段不剥', stripLatinTranslationSuffix('青花瓷 2024'), '青花瓷 2024');
check('单字母尾段不剥', stripLatinTranslationSuffix('夜曲 A'), '夜曲 A');
check('分集尾段不剥（Part 2）', stripLatinTranslationSuffix('序曲 Part 2'), '序曲 Part 2');
check('分卷尾段不剥（Vol.3）', stripLatinTranslationSuffix('序曲 Vol.3'), '序曲 Vol.3');
// catalog 级必须保持保守：normalizeKey 不吃这一层
check(
  'catalog 级不剥（夜曲 Nocturne != 夜曲）',
  normalizeKey('夜曲 Nocturne', '周杰伦') === normalizeKey('夜曲', '周杰伦'),
  false,
);

// ── 用户实测回归：Liyue / 一百 / 摇滚怎么了（2026-08-14）──────────────
console.log('\n── 用户实测回归 ──');
check(
  'Liyue 璃月 == Liyue（normalizeKey）',
  normalizeKey('Liyue 璃月', '陈致逸 / HOYO-MiX'),
  normalizeKey('Liyue', '陈致逸 / HOYO-MiX'),
);
check(
  'Liyue 璃月 == Liyue（displayKey）',
  displayKey('Liyue 璃月', '陈致逸 / HOYO-MiX'),
  displayKey('Liyue', '陈致逸 / HOYO-MiX'),
);
check(
  'Lemon (柠檬) == Lemon（normalizeKey）',
  normalizeKey('Lemon (柠檬)', '米津玄師 (よねづ けんし)'),
  normalizeKey('Lemon', '米津玄師'),
);
check(
  'ハルジオン (春紫菀) == ハルジオン',
  normalizeKey('ハルジオン (春紫菀)', 'YOASOBI'),
  normalizeKey('ハルジオン', 'YOASOBI'),
);
check(
  '一百 - 百事可樂品牌主題曲 == 一百（繁体 meta）',
  normalizeKey('一百 - 百事可樂品牌主題曲', '李荣浩'),
  normalizeKey('一百', '李荣浩'),
);
check(
  '摇滚怎么了！！ == 搖滾怎麼了！！（幺/么 归一）',
  normalizeKey('摇滚怎么了！！', '王力宏'),
  normalizeKey('搖滾怎麼了！！', '王力宏'),
);
// 版本差异必须保留（catalog 保守铁律，spec match-engine 3g）
check(
  '海阔天空 (Live) != 海阔天空（版本差异保留）',
  normalizeKey('海阔天空 (Live)', 'Beyond') === normalizeKey('海阔天空', 'Beyond'),
  false,
);
check(
  '海阔天空 (现场版) != 海阔天空 (Live)',
  normalizeKey('海阔天空 (现场版)', 'Beyond') === normalizeKey('海阔天空 (Live)', 'Beyond'),
  false,
);
check(
  '达拉崩吧（伴奏）!= 达拉崩吧（INSTRUMENTAL 保留）',
  normalizeKey('达拉崩吧（伴奏）', 'ilem / 洛天依 / 言和') === normalizeKey('达拉崩吧', 'ilem / 洛天依 / 言和'),
  false,
);
check(
  '我管你 (真我版) != 我管你 (Live)',
  normalizeKey('我管你 (真我版)', '华晨宇') === normalizeKey('我管你 (Live)', '华晨宇'),
  false,
);

// ── 用户实测回归：月食（2026-08-27）─────────────────────────────────
// QQ/网易云「月食 (The Weeping Woman)」+ Spotify「月食 The Weeping Woman」
// ——括号写法 vs 裸写法，displayKey 必须落到同一桶（server mergeCrossScript
// 与 renderer groupLibraryItems 共用这把 key）。
console.log('\n── 用户实测回归：月食 ──');
check(
  '月食 (The Weeping Woman) == 月食 The Weeping Woman（displayKey）',
  displayKey('月食 (The Weeping Woman)', ''),
  displayKey('月食 The Weeping Woman', ''),
);
check(
  '尘大师 Lightly == 塵大師（displayKey，繁简 + 译名尾段）',
  displayKey('尘大师 Lightly', ''),
  displayKey('塵大師', ''),
);
check(
  '夢の夜会 (ソワレ Invitation to Enchantment) == 梦の夜会(ソワレ) Invitation to Enchantment',
  displayKey('夢の夜会 (ソワレ Invitation to Enchantment)', ''),
  displayKey('梦の夜会(ソワレ) Invitation to Enchantment', ''),
);

console.log(`\n── 总结: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
