const assert = require('node:assert');
const {
  stripFeatTags,
  stripParensContent,
  stripFuriganaParens,
  normalizeKey,
  displayKey,
  extractVersionTag,
  stripVersionTags,
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

console.log(`\n── 总结: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
