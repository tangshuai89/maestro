// ─────────────────────────────────────────────────────────────────────────
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
//   - server `music/translit.ts` 的 artistTransliterationMatch（跨平台匹配
//     的艺人音译佐证）—— 别名通道先于罗马化
//   - renderer `lib/groupLibrary.ts` 的分组（「我的喜欢」弹窗把同歌不同艺人
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
  緑黃色社會: ['Ryokuoushoku Shakai', '绿黄色社会'], // 緑黄色社会 (9首)
  上白石萌音: ['Mone Kamishiraishi'], // 上白石萌音 (かみしらいし もね) (9首)
  'キング・ヌー': ['King Gnu'], // King Gnu (キング・ヌー) (8首)
  孟慧圓: ['Meng Huiyuan', '孟慧圆'], // 孟慧圆 (8首)
  ヨアソビ: ['YOASOBI'], // YOASOBI (ヨアソビ) (8首)
  まじ娘: ['majiko'], // majiko (まじ娘) (7首)
  朴樹: ['Pu Shu', '朴树', '樸樹'], // 朴树 (6首)
  이와미즈: ['iwamizu'], // iwamizu (이와미즈) (6首)
  あいこ: ['aiko'], // aiko (あいこ) (5首)
  椎名林檎: ['Ringo Sheena', 'Sheena Ringo'], // 椎名林檎 (しいな りんご) (5首)
  袁婭維: ['Tia Ray', '袁娅维'], // 袁娅维TIA RAY (5首)
  松本梨香: ['Rica Matsumoto'], // 松本梨香 (まつもと りか) (5首)
  濱崎步: ['Ayumi Hamasaki', '浜崎あゆみ', '滨崎步'], // 滨崎步 (浜崎あゆみ) (5首)
  手嶌葵: ['teshima aoi'], // 手嶌葵 (てしま あおい) (4首)
  蔡旻佑: ['Evan Yo'], // 蔡旻佑 (4首)
  單依純: ['Shan Yichun', '单依纯'], // 单依纯 (4首)
  柴田淳: ['shibata jun'], // 柴田淳 (しばた じゅん) (4首)
  ジャバループ: ['JABBERLOOP'], // JABBERLOOP (ジャバループ) (4首)
  'ブルー・スウィング': ['BLU-SWING'], // BLU-SWING (ブルー・スウィング) (4首)
  梁博: ['Liang Bo'], // 梁博 (4首)
  毛不易: ['Mao Buyi'], // 毛不易 (4首)
  蛋堡: ['Soft Lipa'], // 蛋堡 (4首)
  丁世光: ['Dean Ting'], // 丁世光 (4首)
  李昕融: ['Li Xinrong'], // 李昕融 (4首)
  髭男: ['OFFICIAL HIGE DANDISM', 'Official'], // Official髭男dism (OFFICIAL HIGE DANDISM) (4首)
  林英雄: ['Lim Young-woong', 'Lim Young Woong', '임영웅'], // 林英雄 (임영웅) (4首)
  バックナンバー: ['back number'], // back number (バックナンバー) (4首)
  花澤香菜: ['花泽香菜', 'hanazawa kana'], // 花澤香菜 (はなざわ かな) (3首)
  蘇見信: ['Shin', '苏见信', '信'], // 苏见信 (信) (3首)
  胡彥斌: ['Tiger Hu', 'Anson Hu', '胡彦斌'], // 胡彦斌 (3首)
  ダヲコ: ['dawoko', 'Daoko'], // Daoko (ダヲコ) (3首)
  徐子未: ['Xu Ziwei'], // 徐子未 (3首)
  坂本龍一: ['坂本龙一', 'sakamoto ryuuichi'], // 坂本龙一 (さかもと りゅういち) (3首)
  りりあ: ['Riria.', 'りりあ。'], // りりあ。 (3首)
  鈴木愛理: ['铃木爱理', 'suzuki airi'], // 铃木爱理 (すずき あいり) (3首)
  黃宣: ['黄宣', 'YELLOW'], // YELLOW黄宣 (3首)
  十明: ['Toumei', 'Shi Ming'], // 十明 (3首)
  アトラスサウンドチーム: ['Atlus Sound Team'], // アトラスサウンドチーム (3首)
  久石讓: ['Joe Hisaishi', 'Hisaishi Jō', '久石让'], // 久石让 (3首)
  聲優小劇場: ['Seiyu Mini Theater', '声优小剧场'], // 声优小剧场 (3首)
  グミ: ['GUMI'], // GUMI (グミ) (3首)
  小金: ['DJ Xiaojin', 'DJ Xiao Jin', 'DJ小金'], // DJ小金 (3首)
  無限開關: ['无限开关', 'sukimasuitchi'], // 无限开关 (スキマスイッチ) (3首)
  リプラス: ['ri:purasu', 'ripurasu', 'Re'], // Re:Plus (リ:プラス) (3首)
  防彈少年團: ['BTS', 'Bangtan Boys', '防弹少年团', '방탄소년단'], // BTS (防弹少年团) (3首)
  中村由利子: ['nakamura yuriko'], // 中村由利子 (なかむら ゆりこ) (3首)
  德永英明: ['tokunaga hideaki'], // 德永英明 (とくなが ひであき) (3首)
  迷悠奈: ['miyuna'], // 迷悠奈 (みゆな) (3首)
  熱狗: ['热狗', 'MC HotDog'], // MC HotDog 热狗 (2首)
  張震嶽: ['Chang Chen-yue', 'A-Yue', 'Ayal Komod', '张震岳'], // 张震岳 (2首)
  ユイ: ['YUI'], // YUI (ユイ) (2首)
  東京事変: ['Tokyo Jihen', '东京事变', '東京事變', '东京事変'], // 東京事変 (2首)
  九連真人: ['Jiulian Zhenren', '九连真人'], // 九连真人 (2首)
  葛東琪: ['Ge Dongqi', '葛东琪'], // 葛东琪 (2首)
  五條人: ['Wu Tiao Ren', '五条人'], // 五条人 (2首)
  孫盛希: ['Shi Shi', 'Sun Sheng Xi', '孙盛希'], // 孙盛希 (2首)
  まこ: ['MACO'], // MACO (まこ) (2首)
  金海心: ['Jin Haixin', 'Hannah Jin'], // 金海心 (2首)
  知更鳥: ['Zhi Geng Niao', '知更鸟'], // 知更鸟 / HOYO-MiX / Chevy (2首)
  樂團: ['乐团', 'Fine'], // Fine乐团 (2首)
  れをる: ['Reol'], // Reol (れをる) (2首)
  林家謙: ['Terence Lam', '林家谦'], // 林家谦 (2首)
  福祿壽: ['FloruitShow', '福禄寿'], // 福禄寿FloruitShow (2首)
  依加: ['step.jad'], // step.jad依加 (2首)
  神前暁: ['kousaki satoru'], // 神前暁 (こうさき さとる) (2首)
  曾沛慈: ['Pets Tseng', 'Pets Zeng'], // 曾沛慈 (2首)
  엔하이픈: ['ENHYPEN'], // ENHYPEN (엔하이픈) (2首)
  洛天依: ['Luo Tianyi'], // 洛天依 (2首)
  岡崎體育: ['冈崎体育', 'okazaki taiiku'], // 岡崎体育 (おかざき たいいく) (2首)
  門尼: ['Menny', '门尼'], // 门尼 (2首)
  織部裡沙: ['织部里沙', 'LiSA'], // LiSA (织部里沙) (2首)
  天炫男孩: ['Tension'], // 天炫男孩 (2首)
  'ユニゾン・スクエア・ガーデン': ['UNISON SQUARE GARDEN'], // UNISON SQUARE GARDEN (ユニゾン・スクエア・ガーデン) (2首)
  'クリス・ハート': ['Chris Hart'], // クリス・ハート (Chris Hart) (2首)
  幾田りら: ['几田りら', '幾田rira', 'ikura'], // 幾田りら (ikura) (2首)
  エゴイスト: ['EGOIST'], // EGOIST (エゴイスト) (2首)
  林韓星: ['Lim Han-byul', 'Onestar', '林韩星'], // 林韩星 (임한별) (2首)
  女團: ['女团', 'SING'], // SING女团 (2首)
  太陽: ['太阳', 'TAEYANG'], // TAEYANG (太阳) (2首)
  菅田將暉: ['菅田将晖', 'suda masaki'], // 菅田将晖 (すだ まさき) (2首)
  熊木杏裡: ['熊木杏里', 'kumaki anri'], // 熊木杏里 (くまき あんり) (2首)
  リリィさよなら: ['Lily Sayonara', 'Lil'], // Lily Sayonara (リリィ、さよなら。) (2首)
  李素羅: ['Lee So-ra', 'Lee Sora', '李素罗'], // 李素罗 (이소라) (2首)
  ソフトリー: ['Softly'], // Softly (ソフトリー) (2首)
  ゲスの極み乙女: ['ゲスの极み乙女', 'gesuno極mi乙女'], // ゲスの極み乙女 (极度卑劣少女) (2首)
  花たん: ['花tan'], // 花たん (花糖) (2首)
  愛繆: ['爱缪', 'aimyon'], // 爱缪 (あいみょん) (2首)
  阿杜: ['A-Do', 'A-do', 'Andy'], // 阿杜 (2首)
  熱狗張震嶽: ['热狗', '熱狗', 'MC HotDog', '热狗张震岳'], // MC HotDog 热狗 / 张震岳 (1首)
  吉川慶: ['吉川庆', 'yoshikawa kei'], // 吉川慶 (よしかわ けい) (1首)
  鞠婧禕: ['Ju Jingyi', 'Kiku', '鞠婧祎'], // 鞠婧祎 (1首)
  楊坤: ['Kane Yang', 'Yang Kun', '杨坤'], // 杨坤 (1首)
  藤田恵美: ['Emi Fujita', '藤田惠美', 'fujita emi'], // 藤田恵美 (ふじた えみ) (1首)
  跟風超人: ['Gen Feng Chao Ren', '跟风超人'], // 跟风超人 (1首)
  悠木碧: ['Aoi Yūki', 'Aoi Yuki', 'Aoi Yuuki', 'yuuki aoi'], // 悠木碧 (ゆうき あおい) (1首)
  李嘉格周延: ['李嘉格'], // 李嘉格 / GAI周延 (1首)
  周延: ['GAI'], // GAI周延 (1首)
  許靖韻: ['Angela Hui', 'Angela', '许靖韵'], // 许靖韵 (1首)
  蜜雪薇琪: ['Michelle Vickie'], // 蜜雪薇琪 (1首)
  新褲子: ['New Pants', '新裤子'], // 新裤子 (1首)
  和平和浪: ['Heping He Lang'], // 和平和浪 (1首)
  コシュニエ: ['Cö shu Nie', 'Cö Shu Nie', 'koshunie'], // Cö shu Nie (コシュニエ) (1首)
  寶石: ['宝石'], // 宝石Gem (1首)
  音闕詩聽趙方婧: ['音阙诗听', '音闕詩聽', '音阙诗听赵方婧'], // 音阙诗听 / 赵方婧 (1首)
  音闕詩聽: ['Interesting', '音阙诗听'], // 音阙诗听 (1首)
  趙方婧: ['Zhao Fangjing', '赵方婧'], // 赵方婧 (1首)
  顏人中: ['Ele Yan', 'Ele', '颜人中'], // 颜人中 (1首)
  許慧欣: ['Evonne Hsu', '许慧欣'], // 许慧欣 (1首)
  鈴木杏奈: ['铃木杏奈'], // 鈴木杏奈 (1首)
  何維健: ['Derrick Hoh', '何维健'], // 何维健 (1首)
  劉柏辛: ['Lexie Liu', '刘柏辛Lexie', '刘柏辛'], // 刘柏辛Lexie (1首)
  三浦透子: ['Toko Miura', 'miura touko'], // 三浦透子 (みうら とうこ) (1首)
  米津玄師野田洋次郎: ['米津玄师', '米津玄師', '米津玄师野田洋次郎'], // 米津玄師 / 野田洋次郎 (1首)
  宮川大聖: ['宫川大圣', 'miyakawakun'], // 宮川大聖 (みやかわくん) (1首)
  董書含: ['Dong Shuhan', '董书含'], // 董书含 (1首)
  許哲珮: ['Peggy Hsu', '许哲珮'], // 许哲珮 (1首)
  遠藤正明: ['远藤正明', 'endou masaaki'], // 遠藤正明 (えんどう まさあき) (1首)
  易烊千璽: ['Jackson Yee', 'Yi Yangqianxi', '易烊千玺'], // 易烊千玺 (1首)
  石璽彤: ['Shi Xitong', '石玺彤'], // 石玺彤 (1首)
  平井大: ['hirai dai'], // 平井大 (ひらい だい) (1首)
  安全地帯: ['anzenchitai'], // 安全地帯 (あんぜんちたい) (1首)
  綠蘿組: ['绿萝组', 'MeLo'], // MeLo_绿萝组 (1首)
  魚椒鹽張戀歌: ['鱼椒盐', '魚椒鹽', '鱼椒盐张恋歌'], // 鱼椒盐 / 张恋歌 (1首)
  魚椒鹽: ['鱼椒盐'], // 鱼椒盐 (1首)
  張戀歌: ['张恋歌'], // 张恋歌 (1首)
  ガルニデリア: ['garunideria', 'GARNiDELiA'], // GARNiDELiA (ガルニデリア) (1首)
  優素: ['优素'], // 优素Yusuf (1首)
  網易陰陽師手遊: ['网易阴阳师手游'], // 网易阴阳师手游 (1首)
  デパペペ: ['depapepe', 'Depapepe'], // Depapepe (デパペペ) (1首)
  しゃろう: ['sharou'], // しゃろう (1首)
  エイル: ['eiru', 'eill'], // eill (エイル) (1首)
  ジュジュ: ['juju', 'JUJU'], // JUJU (ジュジュ) (1首)
  謝安琪: ['Kay Tse', '谢安琪'], // 谢安琪 (1首)
  周傳雄: ['Steve Chou', 'Xiao Gang', '小刚', '周传雄'], // 周传雄 (1首)
  新しい學校のリーダーズ: ['新しい学校のリーダーズ', '新shii学校noriidaazu'], // 新しい学校のリーダーズ (1首)
  張傑: ['Jason Zhang', '张杰'], // 张杰 / HOYO-MiX (1首)
  大原ゆい子: ['大原yui子'], // 大原ゆい子 (1首)
  草食考拉: ['Grass Koala'], // 草食考拉 (1首)
  閆澤歡: ['Yan Zehuan', '闫泽欢'], // 闫泽欢 (1首)
  澤野弘之: ['泽野弘之', 'sawano hiroyuki'], // 澤野弘之 (さわの ひろゆき) (1首)
  譚晶: ['Tan Jing', '谭晶'], // 谭晶 / HOYO-MiX (1首)
  富貴晴美: ['富贵晴美', 'fuuki harumi'], // 富贵晴美 (ふうき はるみ) (1首)
  三於梓貝: ['三于梓贝'], // 三Z-STUDIO / HOYO-MiX / 于梓贝 (1首)
  於梓貝: ['Yu Zibei', '于梓贝'], // 于梓贝 (1首)
  飛石號: ['Fei Shi Hao', '飞石号'], // 飞石号 (1首)
  白靜晨: ['Bai Jingchen', '白静晨'], // 白静晨 (1首)
  'ウォン・ウィンツァン': ['uon/uintsuan'], // ウォン・ウィンツァン (1首)
  鍾凱琳: ['Zhong Kailin', '钟凯琳'], // 钟凯琳 (1首)
  蔡徐坤: ['Kun', 'Cai Xukun'], // 蔡徐坤 (1首)
  松原正樹: ['Masaki Matsubara', '松原正树'], // 松原正樹 (1首)
  楊楚驍: ['Yang Chuxiao', '杨楚骁'], // 杨楚骁 (1首)
  曾軼可: ['Yico Tseng', 'Zeng Yike', '曾轶可'], // 曾轶可 (1首)
  陶喆盧廣仲: ['陶喆', '陶喆卢广仲'], // 陶喆 / 卢广仲 (1首)
  'ジュディ・アンド・マリー': ['judei/ando/marii', 'JUDY AND MARY'], // JUDY AND MARY (ジュディ・アンド・マリー) (1首)
  鈴木雅之鈴木愛理: ['铃木雅之', '鈴木雅之', 'suzukimasayuki', '铃木雅之铃木爱理'], // 鈴木雅之 (すずきまさゆき) / 铃木爱理 (すずき あいり) (1首)
  鈴木雅之: ['铃木雅之', 'suzukimasayuki'], // 鈴木雅之 (すずきまさゆき) (1首)
  郭靜: ['Claire Kuo', '郭静'], // 郭静 (1首)
  飛狗: ['Fei Gou', '飞狗MOCO', '飞狗'], // 飞狗MOCO (1首)
  黃宣范曉萱: ['黄宣', '黃宣', 'YELLOW', '黄宣范晓萱', '黃宣範曉萱'], // YELLOW黄宣 / 范晓萱 (1首)
  エメ: ['eme', 'Aimer'], // Aimer (エメ) (1首)
  方大同王力宏: ['方大同'], // 方大同 / 王力宏 (1首)
  竇靖童: ['Leah Dou', '窦靖童'], // 窦靖童 (1首)
  'ミス・オオジャ': ['misu/ooja', 'Ms.OOJA'], // Ms.OOJA (ミス・オオジャ) (1首)
  彭佳慧: ['Julia Peng'], // 彭佳慧 (1首)
  戴荃: ['Dai Quan'], // 戴荃 (1首)
  吳建豪方大同: ['吴建豪', '吳建豪', '吴建豪方大同'], // 吴建豪 / 方大同 (1首)
  逃跑計劃: ['Escape Plan', 'Perdel', '逃跑计划'], // 逃跑计划 (1首)
  三土念遙: ['三土念遥'], // 三土念遥 (1首)
  ノノック: ['nonokku', 'nonoc'], // nonoc (ノノック) (1首)
  劉嘉星: ['刘嘉星'], // 刘嘉星 (1首)
  朱一龍楊恩又: ['朱一龙', '朱一龍', '朱一龙杨恩又'], // 朱一龙 / 杨恩又 (1首)
  朱一龍: ['朱一龙'], // 朱一龙 (1首)
  楊恩又: ['杨恩又'], // 杨恩又 (1首)
  張智成: ['张智成'], // 张智成 (1首)
  楊沛宜: ['杨沛宜'], // 杨沛宜 (1首)
  洛天依言和: ['洛天依'], // 洛天依 / 言和 (1首)
  聲優小劇場顏笑: ['声优小剧场', '聲優小劇場', '声优小剧场颜笑'], // 声优小剧场 / 颜笑 (1首)
  顏笑: ['颜笑'], // 颜笑 (1首)
  李昕融樊桐舟李凱稠: ['李昕融', '李昕融樊桐舟李凯稠'], // 李昕融 / 樊桐舟 / 李凯稠 (1首)
  李凱稠: ['李凯稠'], // 李凯稠 (1首)
  超級小可愛: ['超级小可爱'], // 超级小可爱 (1首)
  蝶: ['一之瀬yuu'], // 蝶々P (一之瀬ユウ) / GUMI (グミ) (1首)
  優裡: ['优里', 'yuuri'], // 優里 (ゆうり) (1首)
  そらる: ['soraru'], // そらる (soraru) (1首)
  まふまふ: ['mafumafu'], // まふまふ (mafumafu) (1首)
  遊助: ['游助'], // 遊助 (上地雄辅) (1首)
  松本梨香大谷育江: ['松本梨香', 'matsumoto rika'], // 松本梨香 (まつもと りか) / 大谷育江 (おおたに いくえ) (1首)
  大谷育江: ['ootani ikue'], // 大谷育江 (おおたに いくえ) (1首)
  無缺公子: ['无缺公子'], // 无缺公子 (1首)
  コレサワ: ['koresawa'], // コレサワ (koresawa) (1首)
  法蘭黛樂團: ['法兰黛乐团', 'Frand'], // Frandé法兰黛乐团 (1首)
  李昕融葉嘉: ['李昕融', '李昕融叶嘉'], // 李昕融 / 叶嘉 (1首)
  葉嘉: ['叶嘉'], // 叶嘉 (1首)
  周杰倫言承旭吳建豪周渝民: ['周杰伦', '周杰倫', '周杰伦言承旭吴建豪周渝民'], // 周杰伦 / 言承旭 / 吴建豪 / 周渝民 (1首)
  純音樂: ['纯音乐'], // 纯音乐 (1首)
  王一博郭富城: ['王一博'], // 王一博 / 郭富城 (1首)
  騰格爾徐夢圓: ['腾格尔', '騰格爾', '腾格尔徐梦圆'], // 腾格尔 / 徐梦圆 (1首)
  騰格爾: ['腾格尔'], // 腾格尔 (1首)
  徐夢圓: ['徐梦圆'], // 徐梦圆 (1首)
  回春丹樂隊: ['Hui Chun Dan', '回春丹', '回春丹乐队'], // 回春丹乐队 (1首)
  安良城紅: ['安良城红', 'BENI'], // BENI (安良城红) (1首)
  夏日入侵企畫: ['夏日入侵企画'], // 夏日入侵企画 (1首)
  薛凱琪: ['薛凯琪'], // 薛凯琪 (1首)
  絢香: ['绚香', 'ayaka'], // 絢香 (あやか) (1首)
  'アイナ・ジ・エンド': ['aina/ji/endo', 'AiNA THE END'], // AiNA THE END (アイナ・ジ・エンド) (1首)
  르세라핌: ['LE SSERAFIM'], // LE SSERAFIM (르세라핌) / j-hope (1首)
  葫蘆童聲: ['葫芦童声'], // 葫芦童声 (1首)
  理想混蛋: ['Bestards'], // 理想混蛋 (1首)
  言承旭五月天阿信: ['言承旭'], // 言承旭 / 五月天 阿信 (1首)
  チョーキューメイ: ['chookyuumei', 'ChoQMay'], // チョーキューメイ (ChoQMay) (1首)
  잭리: ['Jack Lee'], // Jack Lee (잭리) / Bob James / Nathan East / Lewis Pragasam (1首)
  中國交響樂團: ['中国交响乐团'], // 中国交响乐团 (1首)
  星塵: ['星尘'], // 星尘 (1首)
  뉴진스: ['NewJeans'], // NewJeans (뉴진스) (1首)
  今津渉: ['Ayumu Imazu'], // Ayumu Imazu (今津渉) (1首)
  小瀨村晶: ['小濑村晶', 'Akira Kosemura'], // 小濑村晶 (Akira Kosemura) (1首)
  高橋あず美アトラスサウンドチーム: [
    '高桥あず美',
    '高橋あず美',
    '高橋azu美',
    '高桥あず美アトラスサウンドチーム',
  ], // 高橋あず美 / アトラスサウンドチーム / ATLUS GAME MUSIC (1首)
  高橋あず美: ['高桥あず美', '高橋azu美'], // 高橋あず美 (1首)
  鷺巣詩郎: ['鹭巣诗郎', 'sagisu shirou'], // 鹭巣诗郎 (さぎす しろう) / Claire (1首)
  清塚信也: ['清冢信也'], // 清塚信也 (Shin'ya Kiyozuka) (1首)
  죠지: ['George'], // George (죠지) (1首)
  陳致逸: ['Yu-Peng Chen', '陈致逸', 'Chen Zhiyi'], // 陈致逸 / HOYO-MiX (1首)
  蒂姆哈丁三重奏: ['Tim Hardin Trio'], // Tim Hardin Trio (蒂姆·哈丁三重奏) (1首)
  こっちのけんと: ['kotchinokento'], // こっちのけんと (菅生健人) (1首)
  劉洋: ['刘洋'], // 刘 洋 (1首)
  투피엠: ['2PM'], // 2PM (투피엠) (1首)
  許閣林韓星이무진이진성: ['许阁', '許閣', '许阁林韩星이무진이진성'], // 许阁 (허각) / 林韩星 (임한별) / 이무진 (李茂珍) / 이진성 (李振成) (1首)
  許閣: ['许阁'], // 许阁 (허각) (1首)
  神前暁內田ましろきしかな子: ['神前暁', 'kousaki satoru', '神前暁内田ましろきしかな子'], // 神前暁 (こうさき さとる) / 内田ましろ / きしかな子 (1首)
  內田ましろ: ['内田ましろ', '内田mashiro'], // 内田ましろ (1首)
  きしかな子: ['kishikana子'], // きしかな子 (1首)
  데이식스: ['DAY6'], // DAY6 (데이식스) (1首)
  松隆子: ['松taka子'], // 松隆子 (松たか子) (1首)
  아이유: ['IU'], // IU (아이유) (1首)
  ちゃんみな: ['chanmina', 'CHANMINA'], // CHANMINA (ちゃんみな) (1首)
  黃色魔術交響樂團: ['黄色魔术交响乐团', 'Yellow Magic Orchestra'], // Yellow Magic Orchestra (黄色魔术交响乐团) (1首)
  金永所: ['YOUNGSO'], // 金永所 (YOUNGSO) (1首)
  거미: ['GUMMY'], // GUMMY (거미) (1首)
  'ジュスカ・グランペール': ['jusuka/guranpeeru', 'Jusqu'], // Jusqu'à Grand-Père (ジュスカ・グランペール) (1首)
  コーコーヤ: ['kookooya', 'ko'], // ko-ko-ya (コーコーヤ) (1首)
  샘옥: ['Sam Ock'], // Sam Ock (샘 옥) (1首)
  二宮愛: ['ri:purasu', 'ripurasu', 'Re', '二宫爱'], // Re:Plus (リ:プラス) / 二宮愛 (にのみや あい) (1首)
  에피톤프로젝트: ['Epitone Project'], // Epitone Project (에피톤 프로젝트) (1首)
  杉惠ゆりか: ['suujii', '杉惠yurika'], // 杉惠ゆりか (スージー) (1首)
  スタァライト九九組: ['スタァライト九九组', 'sutaaraito九九組'], // スタァライト九九組 (Starlight九九组) (1首)
  ワッチ: ['watchi', 'wacci'], // wacci (ワッチ) (1首)
  ねぬゆり: ['ACA'], // ACAね / ぬゆり (Lanndo) (1首)
  ね: ['ACA'], // ACAね (1首)
  ぬゆり: ['nuyuri', 'Lanndo'], // ぬゆり (Lanndo) (1首)
  かぴ: ['kapi'], // かぴ (1首)
  워너비: ['WSG'], // WSG워너비 (가야G) (WSG WANNBE (Gaya-G)) (1首)
  우디: ['Woody'], // Woody (우디) (1首)
  賽博藍: ['赛博蓝', 'Metablue'], // Metablue赛博蓝 / Heeze (1首)
  윤하: ['Younha'], // Younha (윤하) (1首)
  테이: ['Tei'], // 테이 (Tei) (1首)
  西原健一郎: ['Kenichiro Nishihara'], // 西原健一郎 (Kenichiro Nishihara) / Pismo (1首)
  ハルレオ: ['harureo', 'haruleo'], // ハルレオ (haruleo) (1首)
  桑田佳祐: ['Keisuke Kuwata', 'kuwata keisuke'], // 桑田佳祐 (くわた けいすけ)
  케이시: ['Kassy'], // Kassy (케이시) (1首)
  崔叡娜비비: ['崔叡娜', 'YENA'], // YENA (崔叡娜) / BIBI (비비) (1首)
  崔叡娜: ['YENA'], // YENA (崔叡娜) (1首)
  비비: ['BIBI'], // BIBI (비비) (1首)
  경서예지전건호: ['경서예지'], // 경서예지 / 전건호 (全健浩) (1首)
  內田真禮: ['内田真礼', 'uchida maaya'], // 内田真礼 (うちだ まあや) (1首)
  瀧沢一留: ['泷沢一留', 'Takizawa Ichiru'], // 瀧沢一留 (Takizawa Ichiru) (1首)
  大石昌良: ['ooishimasayoshi'], // 大石昌良 (オーイシマサヨシ) (1首)
  半邊: ['半边'], // 半边 (1首)
  宇多田光: ['宇多田hikaru'], // 宇多田光 (宇多田ヒカル) (1首)
  坂本九: ['sakamoto kyuu'], // 坂本九 (さかもと きゅう) (1首)
  まきちゃんぐ: ['makichangu'], // まきちゃんぐ (makichangu) (1首)
  吉田亞紀子: ['吉田亚纪子', 'KOKIA'], // KOKIA (吉田亚纪子) (1首)
  板野友美: ['itano tomomi'], // 板野友美 (いたの ともみ) (1首)
  周興哲: ['周兴哲', 'Eric'], // Eric周兴哲 (1首)
  打首獄門同好會大澤敦史: [
    '打首狱门同好会',
    '打首獄門同好會',
    'uchikubigokumondoukoukai',
    '打首狱门同好会大泽敦史',
  ], // 打首狱门同好会 (うちくびごくもんどうこうかい) / 大澤 敦史 (1首)
  打首獄門同好會: ['打首狱门同好会', 'uchikubigokumondoukoukai'], // 打首狱门同好会 (うちくびごくもんどうこうかい) (1首)
  大澤敦史: ['大泽敦史'], // 大澤 敦史 (1首)
  'キー・サウンズ・レーベル': ['kii/saunzu/reeberu', 'Key Sounds Label'], // Key Sounds Label (キー・サウンズ・レーベル) (1首)
  迷悠奈クボタカイ: ['迷悠奈', 'miyuna'], // 迷悠奈 (みゆな) / クボタカイ (1首)
  クボタカイ: ['kubotakai'], // クボタカイ (1首)
  家入レオ: ['家入reo'], // 家入レオ (家入莉奥) (1首)
  'ナオト・インティライミ': ['naoto/inteiraimi'], // ナオト・インティライミ (中村直人) (1首)
  フーリン: ['fuurin', 'Foorin'], // Foorin (フーリン) (1首)
  王俊凱蔡依林: ['王俊凯', '王俊凱', '王俊凯蔡依林'], // 王俊凯 / 蔡依林 (1首)
  王俊凱: ['王俊凯'], // 王俊凯 (1首)
  生物股長: ['生物股长', 'ikimonogakari'], // 生物股长 (いきものがかり) (1首)
  登坂廣臣: ['登坂广臣'], // ØMI (登坂广臣) (1首)
  ヘクとパスカル: ['hekutopasukaru', 'Hekuto Pascal'], // ヘクとパスカル (Hekuto Pascal) (1首)
  藤原櫻: ['藤原樱', '藤原sakura'], // 藤原樱 (藤原さくら) (1首)
  ハグ: ['hagu'], // H△G (ハグ) (1首)
  ウルトラタワー: ['urutoratawaa', 'ULTRA TOWER'], // ULTRA TOWER (ウルトラタワー) (1首)
  ワニマ: ['wanima', 'WANIMA'], // WANIMA (ワニマ) (1首)
  當山みれい: ['当山みれい', '當山mirei'], // 當山みれい (当山真玲) (1首)
  じーざす鏡音鈴鏡音連: ['ji-zasuP', 'ji-zasu', 'じーざす镜音铃镜音连'], // じーざす (じーざすP) / 镜音铃 (鏡音リン) / 镜音连 (鏡音レン) (1首)
  じーざす: ['ji-zasuP', 'ji-zasu'], // じーざす (じーざすP) (1首)
  鏡音鈴: ['镜音铃', '鏡音rin'], // 镜音铃 (鏡音リン) (1首)
  鏡音連: ['镜音连', '鏡音ren'], // 镜音连 (鏡音レン) (1首)
  팔로알토비와이: ['팔로알토', 'Paloalto'], // Paloalto (팔로알토) / BewhY (비와이) (1首)
  팔로알토: ['Paloalto'], // Paloalto (팔로알토) (1首)
  비와이: ['BewhY'], // BewhY (비와이) (1首)
  쿠기: ['Coogie'], // 쿠기 (Coogie) / SUPERBEE (슈퍼비) (1首)
  슈퍼비: ['SUPERBEE'], // SUPERBEE (슈퍼비) (1首)
  小洋槐樂隊: ['요조', 'Yozoh', '小洋槐乐队'], // Yozoh (요조) / 小洋槐乐队 (소규모 아카시아 밴드) (1首)
  요조: ['Yozoh'], // Yozoh (요조) (1首)
  神思者: ['S.E.N.S.'], // S.E.N.S. (神思者) (1首)
  雀斑樂團: ['雀斑乐团'], // 雀斑乐团 (1首)
  龍寬九段: ['Long Kuan Jiu Duan', '龙宽九段'], // 龙宽九段 (1首)
  栗プリン: ['栗purin', 'Kuripurin'], // 栗プリン (Kuripurin) (1首)
  フラワー: ['furawaa', 'Flower'], // Flower (フラワー) (1首)
  ラムジ: ['ramuji', 'Lambsey'], // Lambsey (ラムジ) (1首)
  皇后皮箱: ['Queen Suitcase'], // 皇后皮箱 (1首)
  尤長靖: ['尤长靖'], // 尤长靖 (1首)
  鄭恩地: ['郑恩地'], // 郑恩地 (정은지) (1首)
  八王子: ['gumi', 'GUMI'], // GUMI (グミ) / 八王子P (8#Prince) (1首)
  宋旻浩: ['MINO'], // 宋旻浩 (MINO) / TAEYANG (太阳) (1首)
  양승호김하온: ['양승호', 'sokodomo'], // sokodomo (양승호) / HAON (김하온) (1首)
  양승호: ['sokodomo'], // sokodomo (양승호) (1首)
  김하온: ['HAON'], // HAON (김하온) (1首)
  창모: ['CHANGMO'], // CHANGMO (창모) (1首)
  더콰이엇: ['The Quiett'], // The Quiett (더 콰이엇) (1首)
  山本彩: ['yamamoto sayaka'], // 山本彩 (やまもと さやか) (1首)
  欅坂: ['榉坂'], // 欅坂46 (1首)
  艾熱李佳隆: ['艾热', '艾熱', '艾热李佳隆'], // 艾热AIR / JelloRio李佳隆 (1首)
  艾熱: ['艾热'], // 艾热AIR (1首)
  李佳隆: ['JelloRio'], // JelloRio李佳隆 (1首)
  吳亦凡: ['吴亦凡'], // 吴亦凡 (1首)
  橫浜銀蠅: ['横浜银蝇', 'yokohamaginbae'], // 横浜銀蠅 (よこはまぎんばえ) (1首)
  申容財尹民秀: ['申容财', '申容財', '申容财尹民秀'], // 申容财 (신용재) / 尹民秀 (윤민수) (1首)
  申容財: ['申容财'], // 申容财 (신용재) (1首)
  あるふぁきゅん: ['arufuakyun'], // あるふぁきゅん。 (1首)
  人間調教: ['人间调教', 'Mitchie M'], // Mitchie M (人间调教) (1首)
  オスタープロジェクト: ['osutaapurojekuto', 'OSTER project'], // OSTER project (オスタープロジェクト) (1首)
  黃霄雲: ['Huang Xiaoyun', '黄霄雲', '黄霄云'], // 黄霄雲 (1首)
  袁婭維小宇宋念宇: ['袁娅维', '袁婭維', '袁娅维小宇宋念宇'], // 袁娅维TIA RAY / 小宇-宋念宇 (1首)
  河合奈保子: ['kawai naoko'], // 河合奈保子 (かわい なおこ) (1首)
  モンゴル: ['mongoru800', 'mongoru', 'Mongol800'], // Mongol800 (モンゴル800) (1首)
  周筆暢: ['周笔畅'], // 周笔畅 (1首)
  阿藤芳史: ['miu'], // miu-clips (阿藤芳史) (1首)
  まるりとりゅうが: ['maruritoryuuga'], // まるりとりゅうが (真瑠梨与隆雅) (1首)
  椎名林檎浮雲: ['椎名林檎', 'shiina ringo', '椎名林檎浮云'], // 椎名林檎 (しいな りんご) / 浮雲 (1首)
  浮雲: ['浮云'], // 浮雲 (1首)
  はるまきごはん: ['harumakigohan'], // はるまきごはん (春卷饭) (1首)
  チャイ: ['chai', 'chay'], // chay (チャイ) (1首)
  のぼる初音未來: ['noboru', 'のぼる初音未来'], // のぼる↑P / 初音未来 (初音ミク) (1首)
  信澤宣明: ['信泽宣明', 'Nobuaki Nobusawa'], // 信泽宣明 (Nobuaki Nobusawa) (1首)
  高橋瞳: ['高桥瞳', 'takahashihitomi'], // 高橋瞳 (たかはしひとみ) (1首)
  日本群星: ['omunibasu'], // 日本群星 (オムニバス) (1首)
  ちびた: ['chibita'], // ちびた (1首)
  ホワイティーン: ['howaiteiin', 'whiteeeen'], // whiteeeen (ホワイティーン) (1首)
  川瀨智子: ['川濑智子', 'kawase tomoko'], // 川濑智子 (かわせ ともこ) (1首)
  新山詩織: ['新山诗织', 'niiyama shiori'], // 新山詩織 (にいやま しおり) (1首)
  金範洙: ['金范洙'], // 金范洙 (김범수) (1首)
  米希亞: ['米希亚', 'MISIA'], // MISIA (米希亚) (1首)
  香奈兒: ['香奈儿', 'Che'], // Che'Nelle (香奈儿) (1首)
  楊穎: ['杨颖'], // 杨颖 (1首)
  南拳媽媽: ['Nan Quan Mama', '南拳妈妈'], // 南拳妈妈 (1首)
  周杰倫: ['Jay Chou'], // 周杰伦
  蔡依林: ['Jolin Tsai'], // 蔡依林
  林俊傑: ['JJ Lin'], // 林俊杰
  王力宏: ['Wang Leehom', 'Leehom Wang'], // 王力宏
  鄧紫棋: ['G.E.M.', 'Gloria Tang'], // 邓紫棋
  羅志祥: ['Show Luo'], // 罗志祥
  蕭敬騰: ['Jam Hsiao'], // 萧敬腾
  楊丞琳: ['Rainie Yang'], // 杨丞琳
  張韶涵: ['Angela Chang'], // 张韶涵
  潘瑋柏: ['Wilber Pan'], // 潘玮柏
  方大同: ['Khalil Fong'], // 方大同
  陳奕迅: ['Eason Chan'], // 陈奕迅
  薛之謙: ['Joker Xue'], // 薛之谦
  吳青峰: ['Greeny Wu'], // 吴青峰
  張惠妹: ['A-Mei'], // 张惠妹
  許嵩: ['Vae'], // 许嵩
  汪蘇瀧: ['Silence Wong'], // 汪苏泷
  徐佳瑩: ['Lala Hsu'], // 徐佳莹
  吳克群: ['Kenji Wu'], // 吴克群
  陶喆: ['David Tao'], // 陶喆
  王菲: ['Faye Wong'], // 王菲
  鄭秀文: ['Sammi Cheng'], // 郑秀文
  張信哲: ['Jeff Chang'], // 张信哲
  梁靜茹: ['Fish Leong'], // 梁静茹
  范曉萱: ['Mavis Fan'], // 范晓萱
  庾澄慶: ['Harlem Yu'], // 庾澄庆
  周華健: ['Wakin Chau', 'Emil Chau'], // 周华健
  王心凌: ['Cyndi Wang'], // 王心凌
  蔡健雅: ['Tanya Chua'], // 蔡健雅
  戴佩妮: ['Penny Tai'], // 戴佩妮
  辛曉琪: ['Winnie Hsin'], // 辛晓琪
  蘇慧倫: ['Tarcy Su'], // 苏慧伦
  蕭亞軒: ['Elva Hsiao'], // 萧亚轩
  張靚穎: ['Jane Zhang'], // 张靓颖
  劉德華: ['Andy Lau'], // 刘德华
  張學友: ['Jacky Cheung'], // 张学友
  郭富城: ['Aaron Kwok'], // 郭富城
  黎明: ['Leon Lai'], // 黎明
  譚詠麟: ['Alan Tam'], // 谭咏麟
  陳慧琳: ['Kelly Chen'], // 陈慧琳
  梁詠琪: ['Gigi Leung'], // 梁咏琪
  莫文蔚: ['Karen Mok'], // 莫文蔚
  容祖兒: ['Joey Yung'], // 容祖儿
  謝霆鋒: ['Nicholas Tse'], // 谢霆锋
  古巨基: ['Leo Ku'], // 古巨基
  蔡卓妍: ['Charlene Choi'], // 蔡卓妍
  鍾欣潼: ['Gillian Chung'], // 钟欣潼
  楊千嬅: ['Miriam Yeung'], // 杨千嬅
  鄭伊健: ['Ekin Cheng'], // 郑伊健
  鄧麗君: ['Teresa Teng'], // 邓丽君
  林憶蓮: ['Sandy Lam'], // 林忆莲
  葉倩文: ['Sally Yeh'], // 叶倩文
  王傑: ['Dave Wang'], // 王杰
  張宇: ['Phil Chang'], // 张宇
  任賢齊: ['Richie Jen'], // 任贤齐
  陳小春: ['Jordan Chan'], // 陈小春
  陳冠希: ['Edison Chen'], // 陈冠希
  周渝民: ['Vic Chou'], // 周渝民
  言承旭: ['Jerry Yan'], // 言承旭
  吳建豪: ['Vanness Wu'], // 吴建豪
  朱孝天: ['Ken Chu'], // 朱孝天
  五月天: ['Mayday'], // 五月天
  蘇打綠: ['Sodagreen'], // 苏打绿
  飛兒樂團: ['F.I.R.'], // 飞儿乐团
  八三夭: ['831'], // 八三夭
  動力火車: ['Power Station'], // 动力火车
  草蜢: ['Grasshopper'], // 草蜢
  ずっと真夜中でいいのに: ['ZUTOMAYO', 'ZTMY'], // ずっと真夜中でいいのに
  サカナクション: ['Sakanaction'], // サカナクション
  スピッツ: ['Spitz'], // スピッツ
  スキマスイッチ: ['Sukima Switch'], // スキマスイッチ
  バンプオブチキン: ['BUMP OF CHICKEN'], // バンプオブチキン
  ワンオクロック: ['ONE OK ROCK'], // ワンオクロック
  オフィシャルヒゲダンディズム: ['Official HIGE DANDISM'], // オフィシャルヒゲダンディズム
  ミセスグリーンアップル: ['Mrs. GREEN APPLE'], // ミセスグリーンアップル
  米津玄師: ['Kenshi Yonezu', 'ハチ'], // 米津玄师（ハチ = 早期 Vocaloid 艺名）
  藤井風: ['Fujii Kaze'], // 藤井风
  ミレイ: ['milet'], // ミレイ
  キタニタツヤ: ['Tatsuya Kitani'], // キタニタツヤ
  // ── 2026-08-07 补全：groupLibrary.test #15-#25 策展别名（QQ 红心列表导出未覆盖）──
  馬賽克樂隊: ['马赛克', '馬賽克'], // 马赛克乐队 (同乐队带/不带后缀)
  陳綺貞: ['Cheer Chen', '陈绮贞'], // 陈绮贞
  范逸臣: ['Fan Yi Chen', '范逸臣'], // 范逸臣
  森山直太朗: ['Naotaro Moriyama', '森山直太朗'], // 森山直太朗 (罗马音姓名颠倒)
  小野麗莎: ['Lisa Ono', '小野丽莎', '小野リサ'], // 小野丽莎
  小野リサ: ['Lisa Ono', '小野丽莎', '小野麗莎'], // 小野丽莎 (日文假名写法)
  ハンバートハンバート: ['Humbert Humbert'], // Humbert Humbert (纯片假名，stageNameKey 取假名时已 strip 空格)
  桑田佳佑: ['Keisuke Kuwata', 'kuwata keisuke'], // 桑田佳佑 (简体；繁体见上 桑田佳祐，需合并 'Keisuke Kuwata' 进繁体的 value)
  のぼる: ['Noboru', 'noboru'], // のぼる↑P / のぼる↑ / Noboru
  初音未来: ['初音ミク', 'Hatsune Miku', 'hatsune miku'], // 初音未来 / 初音ミク
  // ── 2026-08-07 补全：translit.test #6 英文艺名别名（QQ 红心扫描 + J-Pop/华语/Vocaloid）──
  孫燕姿: ['Stefanie Sun', '孙燕姿'], // 孙燕姿（QQ 红心 24 首）
  林宥嘉: ['Yoga Lin'], // 林宥嘉（QQ 红心 11 首）
  盧廣仲: ['Crowd Lu'], // 卢广仲（QQ 红心 7 首）
  楊宗緯: ['Aska Yang'], // 杨宗纬（QQ 红心 1 首）
  三月のパンタシア: ['Sangatsu no Phantasia'], // 三月のパンタシア（Phantasia 造语）
  赤い公園: ['AKAIKO-EN'], // 赤い公園（长音罗马化 akaikouen ≠ akaikoen）
  星野源: ['Gen Hoshino'], // 星野源（姓名颠倒 + 源 错读）
  藍井エイル: ['Eir Aoi', '蓝井艾露', '藍井艾露'], // 蓝井艾露 / 藍井エイル（Eir 艺术化拼写）
  蓝井艾露: ['Eir Aoi', '藍井エイル', '藍井艾露'], // 蓝井艾露（简体写法）
  藍井艾露: ['Eir Aoi', '藍井エイル', '蓝井艾露'], // 蓝井艾露（繁体写法）
  ヨルシカ: ['YORUSHIKA'], // ヨルシカ（ヨルシカ 大写）
  李榮浩: ['Li Ronghao', 'Ronghao Li', '李荣浩'], // 李荣浩（拼音/名字前置）
  華晨宇: ['Hua Chenyu', '华晨宇'], // 华晨宇
  大森元貴: ['Motoki Ohmori', '大森元贵'], // 大森元贵（Mrs. GREEN APPLE 主唱个人活动）
  大原櫻子: ['Sakurako Ohara', '大原樱子'], // 大原樱子（姓名颠倒罗马音）
};

/**
 * 艺人名 → 别名表 key：剥掉括号注释（读音/译名）后只取汉字+假名，
 * 再 cn2t 统一为繁体（查表时简繁双查，见 stageNameAliasMatch——表 key
 * 简繁都兼容，2026-08-07 起新条目按国内习惯写简体）。纯拉丁名 → null，
 * 表示「这一侧不是日/中文名，走不了别名通道」。
 */
function stageNameKey(s: string): string | null {
  const stripped = s.replace(/[(（\[【][^)）\]】]*[)）\]】]/g, '');
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
 * 2026-08-07 扩展：旧实现 `[^a-z0-9]` 会把汉字全删——别名值只能放拉丁艺名。
 * 现在支持 CJK 别名（马赛克乐队 = 马赛克），汉字经 cjkUnify 繁→简统一后
 * 参与整串比较。既有拉丁值不受影响（"G.E.M."→"gem"、"JJ Lin"→"jjlin"）。 */
function normStageName(s: string): string {
  return cjkUnify(s)
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '');
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
