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
      // 2026-08-04: QQ 红心扫描补入——拼音/kuromoji 都桥不了的英文艺名。
      // 「孫燕姿」pinyin=sunyanzi ≠ stefaniesun；「林宥嘉」pinyin=linyoujia
      // ≠ yogalin；余同。共同点：Spotify 上是英文名而非拼音/汉字读音。
      ['孫燕姿', 'Stefanie Sun', 'QQ 红心 24 首——拼音桥不了'],
      ['孙燕姿', 'Stefanie Sun', '简体侧同样命中（cn2t 统一 key）'],
      ['林宥嘉', 'Yoga Lin', 'QQ 红心 11 首——拼音桥不了'],
      ['陳綺貞', 'Cheer Chen', 'QQ 红心 10 首——拼音桥不了'],
      ['陈绮贞', 'Cheer Chen', '简体侧同样命中'],
      ['盧廣仲', 'Crowd Lu', 'QQ 红心 7 首——拼音桥不了'],
      ['楊宗緯', 'Aska Yang', 'QQ 红心 1 首——拼音桥不了'],
      // 2026-08-04: 当前 bug 修复。三月のパンタシア の「パンタシア」=
      // 英語 Phantasia 由来造語。kuromoji カタカナ逐字読み「pan/ta/shi/a」
      // ≠ Spotify "Phantasia"（ph 入り）；拼音「三月=sanyue」≠「sangatsu」。
      // romanize 路线全挂。
      ['三月のパンタシア', 'Sangatsu no Phantasia', 'バンド名由来造語（バンド名由来——英字表記が音読みと非対応）'],
      ['三月のパンタシア (三月的幻想)', 'Sangatsu no Phantasia', '别名注释括号注释不影响 key'],
      // 2026-08-07: 「絶対的な関係」跨平台匹配漏。Spotify 长音塌缩 + 连字符
      // 风格化「AKAIKO-EN」=akaikoen，kuromoji「赤い公園」=akaikouen 差一个
      // 长音 u，includes 桥不上；拼音又给中文读音。归到别名表。
      ['赤い公園', 'AKAIKO-EN', 'バンド名長音ロマ字化非対応（kuromoji=akaikouen ≠ akaikoen）'],
      ['赤い公園 (赤色公园)', 'AKAIKO-EN', '艺人名带中文译名括号注释（本次事故：絶対的な関係）'],
      // 2026-08-07: 纯汉字别名（值侧不再限于拉丁艺名）。「马赛克乐队」与
      // 「马赛克」是同一个乐队（QQ 带「乐队」后缀 / 网易云不带）。**不能**靠
      // 拼音 includes（masaikeyuedui ⊃ masaike 会把 Coldplay vs Cold 这种
      // 巧合前缀也并了）——必须走策展表精确整串。
      ['马赛克乐队', '马赛克', '同乐队带/不带「乐队」后缀（CJK↔CJK 别名）'],
      ['馬賽克樂隊', '马赛克', '繁体 key 侧同样命中（cn2t 统一）'],
      ['马赛克', '马赛克乐队', '双向：不带后缀侧在前'],
      // 2026-08-07: 范逸臣三平台三写法。网易云「范逸臣」、QQ「【范逸臣 Van Fan】」
      // （整体被【】包裹的格式标记，不是注释）、Spotify「Fan Yi Chen」。表 key
      // 按国内习惯写简体，繁体进 values。
      ['范逸臣', 'Fan Yi Chen', '三平台：网易云 ↔ Spotify（简体 key）'],
      ['范逸臣', '【范逸臣 Van Fan】', '三平台：网易云 ↔ QQ（【】整体包裹，汉字名同人分支）'],
      ['【范逸臣 Van Fan】', 'Fan Yi Chen', '三平台：QQ ↔ Spotify（混合串 vs 英文名）'],
      ['範逸臣', 'Fan Yi Chen', '繁体输入侧同样命中（values 内繁体）'],
      // 2026-08-07: 森山直太朗 ↔ Naotaro Moriyama（姓名颠倒罗马音）。kuromoji
      // 读「もりやま なおたろう」= moriyama naotaro，Spotify 写「Naotaro
      // Moriyama」姓名颠倒——token 顺序无关匹配在 warmup 未就绪 / IPADIC 拆
      // 错人名时会失败（实测两路线都 false），归到策展表兜底。
      ['森山直太朗', 'Naotaro Moriyama', 'Spotify 罗马音姓名颠倒（kuromoji 拆不对）'],
      ['森山直太朗 (なおたろう もりやま)', 'Naotaro Moriyama', '带假名读音括号注释同样命中'],
      // 2026-08-07: 小野丽莎（Fly Me To The Moon）。QQ 写「小野丽莎（Lisa Ono）」
      // 混合串（含英文剥不掉）、Spotify 写「Lisa Ono」。表兜底 + 汉字名同人
      // 分支桥混合串。
      ['小野丽莎', 'Lisa Ono', 'Spotify 英文名（表兜底）'],
      ['小野丽莎（Lisa Ono）', '小野丽莎', 'QQ 混合串（汉字名同人分支）'],
      ['小野丽莎 (おの りさ)', 'Lisa Ono', '纯假名括号（归一剥掉）同样命中'],
      ['小野丽莎（小野リサ）', '小野丽莎', '汉字名 + 日文名括号（汉字名同人分支）'],
      ['小野リサ', '小野丽莎', '日文名独立出现（values 内 小野リサ 命中）'],
      ['小野リサ', 'Lisa Ono', '日文名独立出现 ↔ 英文名（values 传递）'],
      // 2026-08-07: 星野源 恋。kuromoji 把「源」错读成 はじめ（hajime）且
      // 正确读音 gen 仅 3 字符低于长度门 → 括号直读 token 不再受长度门
      // （发音真相），并与 kuromoji 判定互不拖累。表也加 Gen Hoshino 兜底。
      ['星野源 (ほしの げん)', 'Gen Hoshino', '假名括号读音 + 姓名颠倒（真实：恋 ↔ Koi）'],
      ['星野源', 'Gen Hoshino', '无括号（表兜底）'],
      // 2026-08-07: 藍井エイル（ラピスラズリ）。Spotify「Eir Aoi」把
      // エイル的罗马音 eiru 塌缩成 Eir（艺术化拼写，算法不可还原，同
      // 赤い公園↔AKAIKO-EN），且姓名颠倒（藍井=Aoi 在尾）。表兜底。
      ['藍井エイル (蓝井艾露)', 'Eir Aoi', 'QQ 日文名 + 汉字注释 ↔ Spotify 英文名'],
      ['藍井エイル', 'Eir Aoi', '无注释'],
      ['蓝井艾露', 'Eir Aoi', '网易云简体写法'],
      ['藍井艾露', 'Eir Aoi', '繁体中文写法'],
      ['藍井エイル', '蓝井艾露', '日文名 ↔ 简体中文（values 互桥）'],
      ['藍井エイル', '藍井艾露', '日文名 ↔ 繁体中文（values 互桥）'],
      // 2026-08-07: Humbert Humbert（日が落ちるまで）。网易云写纯片假名
      // 「ハンバート ハンバート」，QQ/Spotify 写英文「Humbert Humbert」——
      // toRomaji 给规则读法 hanbato ≠ Humbert（法语人名艺术化拼写），
      // 音译桥不上，策展表兜底。
      ['ハンバート ハンバート', 'Humbert Humbert', '纯片假名 ↔ 英文（艺术化拼写）'],
      ['Humbert Humbert (ハンバート ハンバート)', 'Humbert Humbert', '带片假名括号注释 ↔ 纯英文'],
      // 2026-08-07: 桑田佳佑（明日晴れるかな）。Spotify 用罗马音
      // Keisuke Kuwata。音译其实能桥（kuwata keisuke token 全命中），但
      // 弹窗分组只信策展表（renderer 不带音译）→ 表兜底。
      ['桑田佳佑', 'Keisuke Kuwata', '简体 ↔ 罗马音（弹窗分组表兜底）'],
      ['桑田佳祐', 'Keisuke Kuwata', '繁体 ↔ 罗马音（cjkUnify 双查命中）'],
      // 2026-08-07: Vocaloid 组合（白い雪のプリンセスは）。stageNameKey 取
      // 汉字+假名时 ↑ 和 P 被跳过 → のぼる↑P / のぼる 都归「のぼる」；
      // 初音未来 / 初音ミク 互桥。
      ['のぼる↑P', 'Noboru', 'P 后缀 + 箭头符号 → 归「のぼる」↔ 罗马音'],
      ['のぼる↑', 'Noboru', '无 P 后缀同样命中'],
      ['初音未来 (初音ミク)', '初音ミク', '中文名 + 假名注释 ↔ 假名（values 互桥）'],
      ['初音未来', 'Hatsune Miku', '中文名 ↔ 英文名'],
      ['米津玄師', 'Kenshi Yonezu', '日文 ↔ 罗马音（已存在表的回归）'],
      ['米津玄師', 'ハチ', '现艺名 ↔ 早期 Vocaloid 艺名'],
      // 2026-08-07: 扫荡式维护。常见 J-Pop / 华语圈 / Vocaloid 艺人 Spotify
      // 写法无算法可桥（拼音不参与音译判定，必须表兜底）。
      ['aiko', 'aiko', 'aiko 自循环（values 含自身）'],
      ['ヨルシカ', 'YORUSHIKA', '日文乐队名 ↔ Spotify 大写'],
      ['YOASOBI', ['ヨアソビ', 'YOASOBI'].includes('YOASOBI') ? 'YOASOBI' : 'x', '网易云带假名 ↔ Spotify 纯拉丁'],
      ['李荣浩', 'Li Ronghao', '中文 ↔ 拼音（pinyin 不参与音译判定）'],
      ['李荣浩', 'Ronghao Li', '中文 ↔ 名字前置拼音'],
      ['华晨宇', 'Hua Chenyu', '中文 ↔ 拼音'],
      ['米津玄师', 'Kenshi Yonezu', '简体 key 命中繁体表 key（cn2t）'],
      ['大森元貴', 'Motoki Ohmori', 'Mrs. GREEN APPLE 主唱个人活动英文名'],
      ['大原樱子', 'Sakurako Ohara', '姓名颠倒罗马音（さよなら，简体侧）'],
      ['大原櫻子', 'Sakurako Ohara', '繁体侧同样命中'],
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

  // 2026-08-14：拼音串扰负向（跨语言误读）。
  //  - 藤井風：拼音路线读日文汉字 → tengjingfeng，'feng'（4 字）是其子串——
  //    任何叫 "Feng" 的艺人都会被误并。修：重叠门 4→5（'feng'/'zhou' 等
  //    4 字拼音碎片被挡）；含假名的日文名拼音路线整体关闭。
  //  - 周杰伦 ↔ Zhou：'zhoujielun' ⊃ 'zhou'（4 字）同样被长度门挡。
  //  - 高橋あず美 ↔ gaoqiao：含假名 → 汉字不喂拼音，拼音串不再产生。
  {
    const rejectCrossTalk: Array<[string, string, string]> = [
      ['藤井風', 'Feng', '拼音 tengjingfeng ⊃ feng（4 字碎片，长度门 5 挡掉）'],
      ['周杰伦', 'Zhou', '拼音 zhoujielun ⊃ zhou（4 字碎片）'],
      ['高橋あず美', 'gaoqiao', '含假名 → 拼音路线关闭（高橋 不再被读成 gaoqiao）'],
    ];
    for (const [a, b, why] of rejectCrossTalk) {
      assert.strictEqual(
        artistTransliterationMatch(a, b),
        false,
        `应拒绝（拼音串扰）: ${a} ↔ ${b}（${why}）`,
      );
    }
    // 正向回归：含假名日文名的 kuromoji 音译桥不受影响（铃木爱理 ↔ suzukiairi）。
    assert.ok(
      artistTransliterationMatch('铃木爱理', 'suzukiairi'),
      '应接受: 铃木爱理 ↔ suzukiairi（kuromoji，拼音关闭后仍桥）',
    );
    // romanize 层面：含假名的串汉字不再被拼音化（'高橋あず美' 只剩假名部分）。
    assert.strictEqual(
      romanize('高橋あず美'),
      'azu',
      'romanize: 含假名 → 汉字跳过、假名 wanakana（不再产出 gaoqiao…）',
    );
    assert.strictEqual(
      romanize('高橋あず美').includes('gaoqiao'),
      false,
      'romanize: 不得含中文拼音串',
    );
    console.log('✅ 8. 拼音串扰负向：日文名不与拉丁碎片误并（藤井風≠Feng / 周杰伦≠Zhou）');
  }

  console.log('\n🎉 translit.test 全部 8 项通过');
}

main().catch((err) => {
  console.error('❌ translit.test 失败:', err);
  process.exit(1);
});
