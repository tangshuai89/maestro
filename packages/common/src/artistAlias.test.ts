// 别名表不变量测试（2026-08-14 事故回归锁死）：
//  - 空串碰撞：纯假名/纯韩文串不得与表内任何条目误并（米津玄師↔あいこ等）
//  - 短值/片段值：'Kun'/'Andy'/'Eric'/'Official' 等通用名已从表内移除
//  - 拼接 key：'方大同王力宏' 等多艺人拼接条目已移除，独唱↔合唱不再经表互并
//  - 韩文/假名值：'방탄소년단'/'임영웅'/'ハチ' 归一后保留，精确相等才命中
export {}; // 模块作用域：避免顶层 const 与其它测试文件的全局声明冲突
//  - 数据修复回归：リプラス↔Re:Plus、コーコーヤ↔ko-ko-ya、蝶↔一之瀬ユウ
//  - 段段字面归一相等（artistLooseMatch 2026-08-14 #2）：「aiko·May Dream」vs
//    「aiko」必须合并；表外「Cold」vs「Cold」必须合并；「Cold」vs「Coldplay」
//    不合并。
const assert = require('node:assert');
const { artistLooseMatch, stageNameAliasMatch } = require('./artistAlias');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, expect = true) {
  if (cond === expect) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label} → ${cond}（预期 ${expect}）`);
    failed++;
  }
}

// ── 1. 空串碰撞（P0 事故）────────────────────────────────
console.log('\n── 空串碰撞：纯假名/纯韩文不得误并 ──');
check('米津玄師 ↔ あいこ 不并', stageNameAliasMatch('米津玄師', 'あいこ'), false);
check('林英雄 ↔ 르세라핌 不并', stageNameAliasMatch('林英雄', '르세라핌'), false);
check('防彈少年團 ↔ 김하온 不并', stageNameAliasMatch('防彈少年團', '김하온'), false);
check('りりあ ↔ あいこ 不并', stageNameAliasMatch('りりあ', 'あいこ'), false);
check('小洋槐樂隊 ↔ 이와미즈 不并', stageNameAliasMatch('小洋槐樂隊', '이와미즈'), false);

// ── 2. 韩文/假名值：精确相等仍命中（修复后走正常比较，不再靠空串）──
console.log('\n── 韩文/假名值精确命中 ──');
check('米津玄師 ↔ ハチ（表内 Vocaloid 艺名）', stageNameAliasMatch('米津玄師', 'ハチ'));
check('林英雄 ↔ 임영웅（韩文值）', stageNameAliasMatch('林英雄', '임영웅'));
check('防彈少年團 ↔ 방탄소년단（韩文值）', stageNameAliasMatch('防彈少年團', '방탄소년단'));
check('小野リサ ↔ Lisa Ono', stageNameAliasMatch('小野リサ', 'Lisa Ono'));
check('初音未来 (初音ミク) ↔ 初音ミク', stageNameAliasMatch('初音未来 (初音ミク)', '初音ミク'));

// ── 3. 短值/片段值清理回归 ──
console.log('\n── 短值/片段值清理 ──');
check('蔡徐坤 ↔ Kun 不并（通用名已移除）', stageNameAliasMatch('蔡徐坤', 'Kun'), false);
check('阿杜 ↔ Andy 不并', stageNameAliasMatch('阿杜', 'Andy'), false);
check('周興哲 ↔ Eric 不并', stageNameAliasMatch('周興哲', 'Eric'), false);
check('髭男 ↔ Official 不并（片段值已移除）', stageNameAliasMatch('髭男', 'Official'), false);
check('蔡徐坤 ↔ Cai Xukun 仍并', stageNameAliasMatch('蔡徐坤', 'Cai Xukun'));
check('阿杜 ↔ A-Do 仍并', stageNameAliasMatch('阿杜', 'A-Do'));

// ── 4. 拼接 key 移除：独唱↔合唱不再经表互并 ──
console.log('\n── 拼接 key 移除 ──');
check('方大同 ↔ 方大同王力宏 不并', stageNameAliasMatch('方大同', '方大同王力宏'), false);
check('周杰伦 ↔ 周杰伦言承旭吴建豪周渝民 不并', stageNameAliasMatch('周杰伦', '周杰伦言承旭吴建豪周渝民'), false);
check('米津玄師 ↔ 米津玄師野田洋次郎 不并', stageNameAliasMatch('米津玄師', '米津玄師野田洋次郎'), false);

// ── 5. 数据修复回归（表内条目真正可桥）──────────────────
console.log('\n── 数据修复回归 ──');
check('リプラス ↔ Re:Plus', stageNameAliasMatch('リプラス', 'Re:Plus'));
check('コーコーヤ ↔ ko-ko-ya', stageNameAliasMatch('コーコーヤ', 'ko-ko-ya'));
check('蝶 ↔ 一之瀬ユウ', stageNameAliasMatch('蝶', '一之瀬ユウ'));

// ── 6. 既有正向不回归 ──
console.log('\n── 既有正向 ──');
check('周杰伦 ↔ Jay Chou', stageNameAliasMatch('周杰伦', 'Jay Chou'));
check('邓紫棋 ↔ G.E.M.', stageNameAliasMatch('邓紫棋', 'G.E.M.'));
check('马赛克乐队 ↔ 马赛克', stageNameAliasMatch('马赛克乐队', '马赛克'));
check('范逸臣 ↔ 【范逸臣 Van Fan】', stageNameAliasMatch('范逸臣', '【范逸臣 Van Fan】'));
check('桑田佳佑 ↔ Keisuke Kuwata', stageNameAliasMatch('桑田佳佑', 'Keisuke Kuwata'));

// ── 7. 段段字面归一相等（artistLooseMatch #2）──
// 2026-08-14 用户实测「aiko·May Dream」vs「aiko」必须合并（aiko 表内 key 是
// あいこ，纯拉丁「aiko」stageNameKey 返回 null，整串走表查不到）。段段配对
// 补 normalizeKey 相等后命中——同名字面等价属于「同一艺人」最强信号。
console.log('\n── 段段字面归一相等 ──');
check('aiko·May Dream ↔ aiko（用户实测）', artistLooseMatch('aiko·May Dream', 'aiko'));
check('aiko ↔ aiko（纯字面）', artistLooseMatch('aiko', 'aiko'));
check('YOASOBI ↔ Yoasobi（大小写）', artistLooseMatch('YOASOBI', 'Yoasobi'));
check('YOASOBI, Ayase ↔ YOASOBI·专辑', artistLooseMatch('YOASOBI, Ayase', 'YOASOBI·专辑'));
// 铁律不破：表外非同一艺人仍拒判
check('Cold ↔ Coldplay 不并', artistLooseMatch('Cold', 'Coldplay'), false);
check('Taylor ↔ Taylor Swift 不并', artistLooseMatch('Taylor', 'Taylor Swift'), false);
// 表内桥接（保留原 strict 口径）
check('陈绮贞 ↔ Cheer Chen（表内）', artistLooseMatch('陈绮贞', 'Cheer Chen'));
check('のぼる↑P ↔ Noboru', stageNameAliasMatch('のぼる↑P', 'Noboru'));
check('蓝井艾露 ↔ Eir Aoi', stageNameAliasMatch('蓝井艾露', 'Eir Aoi'));

console.log(`\n🎉 artistAlias.test 通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) process.exit(1);
