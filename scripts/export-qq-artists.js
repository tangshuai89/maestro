#!/usr/bin/env node
/**
 * Export all unique artists from QQ Music liked songs as a Markdown table.
 *
 * Usage: node scripts/export-qq-artists.js [--out <path>]
 *   Default output: scripts/qq-liked-artists.md
 *
 * Data source: the already-imported library in
 * `packages/server/.storage/state.json`. The library is built from the QQ
 * "我喜欢" playlist via `qq.provider.fetchLiked()` and merged across
 * platforms, so every library item with a QQ `source` corresponds to a QQ
 * liked song.
 *
 * The output is designed for the `common` package's artistAlias.ts — each
 * CJK artist row includes the name and a blank "English stage name" column
 * ready to fill in.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(
  __dirname, '..', 'packages', 'server', '.storage', 'state.json',
);
const OUT_DEFAULT = path.resolve(__dirname, 'qq-liked-artists.md');

// ── helpers ─────────────────────────────────────────────────────────────────

/** Extract CJK (Han / Kana) portion of a name, strip bracket annotations. */
function cjkCore(s) {
  const stripped = s.replace(/[\(（\[【][^)）\]】]*[)）\]】]/g, '');
  let out = '';
  for (const ch of stripped) {
    if (/[㐀-䶿一-鿿豈-﫿぀-ヿ]/.test(ch)) out += ch;
  }
  if (!out) {
    for (const ch of s) {
      if (/[㐀-䶿一-鿿豈-﫿぀-ヿ]/.test(ch)) out += ch;
    }
  }
  return out || null;
}

/**
 * Simplified ↔ Traditional map for common characters that differ across
 * the two sets. Only covers characters that actually appear in artist names.
 * Generated ad-hoc; not a full Unihan table.
 */
const S2T_MAP = {
  伦: '倫', 杰: '傑', 孙: '孫', 燕: '燕', 姿: '姿',
  陈: '陳', 绮: '綺', 贞: '貞', 卢: '盧', 广: '廣',
  仲: '仲', 徐: '徐', 莹: '瑩', 张: '張', 惠: '惠',
  妹: '妹', 苏: '蘇', 绿: '綠', 薛: '薛', 谦: '謙',
  汪: '汪', 泷: '瀧', 华: '華', 荣: '榮', 刘: '劉',
  马: '馬', 赛: '賽', 克: '克', 赵: '趙', 雷: '雷',
  邓: '鄧', 丽: '麗', 君: '君', 杨: '楊', 千: '千',
  嬅: '嬅', 郑: '鄭', 秀: '秀', 文: '文', 谭: '譚',
  咏: '詠', 麟: '麟', 许: '許', 嵩: '嵩', 萧: '蕭',
  敬: '敬', 腾: '騰', 吴: '吳', 陶: '陶', 喆: '喆',
  潘: '潘', 玮: '瑋', 柏: '柏', 梁: '梁', 静: '靜',
  茹: '茹', 蔡: '蔡', 健: '健', 雅: '雅', 戴: '戴',
  佩: '佩', 妮: '妮', 辛: '辛', 晓: '曉', 琪: '琪',
  謝: '谢', 霆: '霆', 鋒: '锋', 鐘: '钟', 欣: '欣',
  潼: '潼', 張: '张', 學: '学', 友: '友', 黎: '黎',
  明: '明', 陳: '陈', 慧: '慧', 琳: '琳', 莫: '莫',
  容: '容', 祖: '祖', 兒: '儿', 郭: '郭', 富: '富',
  城: '城', 古: '古', 巨: '巨', 基: '基', 葉: '叶',
  倩: '倩', 王: '王', 傑: '杰', 張: '张', 宇: '宇',
  任: '任', 賢: '贤', 齊: '齐', 周: '周', 渝: '渝',
  民: '民', 朱: '朱', 孝: '孝', 天: '天', 羅: '罗',
  志: '志', 祥: '祥', 飛: '飞', 蘇: '苏', 打: '打',
  動: '动', 力: '力', 車: '车', 藍: '蓝', 井: '井',
  愛: '爱', 爾: '尔', 廣: '广', 萬: '万', 與: '与',
  樂: '乐', 隊: '队', 為: '为', 雲: '云', 門: '门',
  長: '长', 風: '风', 岡: '冈', 澤: '泽', 亞: '亚',
  衛: '卫', 倉: '仓', 澤: '泽', 豐: '丰', 壽: '寿',
  龍: '龙', 龜: '龟', 來: '来', 島: '岛', 嶋: '嶋',
  實: '实', 寫: '写', 寶: '宝', 將: '将', 專: '专',
  對: '对', 導: '导', 屆: '届', 巖: '岩', 師: '师',
  帶: '带', 張: '张', 彥: '彦', 後: '后', 從: '从',
  復: '复', 徵: '征', 懷: '怀', 戰: '战', 戲: '戏',
  戶: '户', 拋: '抛', 擊: '击', 攝: '摄', 收: '收',
  效: '效', 數: '数', 斷: '断', 於: '于', 時: '时',
  晉: '晋', 書: '书', 會: '会', 東: '东', 業: '业',
  極: '极', 構: '构', 榮: '荣', 樣: '样', 歐: '欧',
  歲: '岁', 歸: '归', 殺: '杀', 氣: '气', 決: '决',
  況: '况', 減: '减', 測: '测', 滿: '满', 漢: '汉',
  潔: '洁', 燈: '灯', 爭: '争', 爾: '尔', 牆: '墙',
  獨: '独', 環: '环', 產: '产', 畫: '画', 當: '当',
  發: '发', 眾: '众', 盡: '尽', 禮: '礼', 禪: '禅',
  積: '积', 穩: '稳', 競: '竞', 約: '约', 紅: '红',
  純: '纯', 級: '级', 紋: '纹', 納: '纳', 紙: '纸',
  組: '组', 結: '结', 絕: '绝', 統: '统', 絲: '丝',
  綠: '绿', 維: '维', 網: '网', 線: '线', 編: '编',
  緣: '缘', 縣: '县', 總: '总', 織: '织', 繪: '绘',
  繼: '继', 續: '续', 習: '习', 聖: '圣', 聞: '闻',
  聲: '声', 聯: '联', 職: '职', 聽: '听', 術: '术',
  衛: '卫', 裝: '装', 裡: '里', 製: '制', 見: '见',
  觀: '观', 親: '亲', 覺: '觉', 覽: '览', 言: '言',
  訂: '订', 計: '计', 記: '记', 討: '讨', 訓: '训',
  設: '设', 許: '许', 訴: '诉', 診: '诊', 詞: '词',
  詩: '诗', 試: '试', 話: '话', 該: '该', 誇: '夸',
  誠: '诚', 語: '语', 誤: '误', 說: '说', 誰: '谁',
  請: '请', 論: '论', 諸: '诸', 調: '调', 談: '谈',
  謀: '谋', 謂: '谓', 謝: '谢', 證: '证', 識: '识',
  議: '议', 護: '护', 變: '变', 讚: '赞', 讀: '读',
  豈: '岂', 貝: '贝', 負: '负', 責: '责', 貨: '货',
  資: '资', 費: '费', 買: '买', 賣: '卖', 賴: '赖',
  購: '购', 走: '走', 起: '起', 越: '越', 超: '超',
  趙: '赵', 足: '足', 跟: '跟', 路: '路', 踐: '践',
  轉: '转', 輪: '轮', 辦: '办', 農: '农', 連: '连',
  進: '进', 遊: '游', 運: '运', 過: '过', 達: '达',
  違: '违', 遠: '远', 適: '适', 選: '选', 遲: '迟',
  還: '还', 邊: '边', 邏: '逻', 那: '那', 都: '都',
  郵: '邮', 鄰: '邻', 鄧: '邓', 鄭: '郑', 重: '重',
  金: '金', 銀: '银', 銅: '铜', 鋼: '钢', 錢: '钱',
  錄: '录', 鐵: '铁', 鏡: '镜', 長: '长', 門: '门',
  開: '开', 間: '间', 關: '关', 閣: '阁', 閱: '阅',
  隊: '队', 際: '际', 隨: '随', 雙: '双', 雖: '虽',
  離: '离', 難: '难', 雨: '雨', 雲: '云', 電: '电',
  靈: '灵', 靜: '静', 非: '非', 面: '面', 順: '顺',
  須: '须', 項: '项', 頭: '头', 題: '题', 顏: '颜',
  願: '愿', 顧: '顾', 風: '风', 飛: '飞', 養: '养',
  馬: '马', 魚: '鱼', 鳥: '鸟', 黃: '黄', 點: '点',
  黨: '党', 鼓: '鼓', 齊: '齐', 齒: '齿', 龍: '龙',
  国: '國', 时: '時', 书: '書', 会: '会', 东: '东',
  乐: '樂', 业: '业', 为: '为', 丽: '麗', 义: '義',
  乌: '烏', 乔: '喬', 乡: '鄉', 买: '買', 争: '爭',
  仑: '侖', 仓: '倉', 仪: '儀', 优: '優', 传: '傳',
  伦: '倫', 伪: '偽', 体: '體', 余: '餘', 侠: '俠',
  侣: '侶', 侥: '僥', 侦: '偵', 侧: '側', 侨: '僑',
  侪: '儕', 侬: '儂', 俣: '俁', 俨: '儼', 俩: '倆',
};

function s2t(text) {
  let out = '';
  for (const ch of text) {
    out += S2T_MAP[ch] || ch;
  }
  return out;
}

/**
 * Fuzzy CJK match: two strings share the same CJK core.
 * Tries exact match on original, simplified→traditional, and
 * traditional→simplified forms.
 */
function cjkOverlap(a, b) {
  const ca = cjkCore(a);
  const cb = cjkCore(b);
  if (!ca || !cb) return false;
  // Exact match
  if (ca === cb) return true;
  // Simplified→traditional match
  if (s2t(ca) === cb || ca === s2t(cb)) return true;
  if (s2t(ca) === s2t(cb)) return true;
  // One contains the other (e.g. "马赛克乐队" contains "马赛克")
  // BUT only if both are >= 3 chars (avoid false positives like "五月天" ⊆ "五月天阿信")
  if (ca.length >= 3 && cb.length >= 3) {
    if (ca.includes(cb) || cb.includes(ca)) return true;
    if (s2t(ca).includes(cb) || cb.includes(s2t(ca))) return true;
    if (ca.includes(s2t(cb)) || s2t(cb).includes(ca)) return true;
  }
  return false;
}

// ── known alias keys (from artistAlias.ts) ──────────────────────────────────

const KNOWN_KEYS = [
  '周杰倫', '蔡依林', '林俊傑', '王力宏', '鄧紫棋', '羅志祥', '蕭敬騰',
  '楊丞琳', '張韶涵', '潘瑋柏', '方大同', '陳奕迅', '薛之謙', '吳青峰',
  '張惠妹', '許嵩', '汪蘇瀧', '徐佳瑩', '吳克群', '陶喆', '孫燕姿',
  '林宥嘉', '陳綺貞', '范逸臣', '森山直太朗', '小野丽莎', '星野源',
  'ハンバートハンバート', '桑田佳佑', '大原樱子', 'のぼる', '初音未来',
  'aiko', 'ヨルシカ', '米津玄師', 'YOASOBI', '大森元貴', '李荣浩',
  '华晨宇', '五月天阿信', '藍井エイル', '蓝井艾露', '小野リサ', '盧廣仲',
  '楊宗緯', '王菲', '鄭秀文', '張信哲', '梁靜茹', '范曉萱', '庾澄慶',
  '周華健', '王心凌', '蔡健雅', '戴佩妮', '辛曉琪', '蘇慧倫', '蕭亞軒',
  '張靚穎', '劉德華', '張學友', '郭富城', '黎明', '譚詠麟', '陳慧琳',
  '梁詠琪', '莫文蔚', '容祖兒', '謝霆鋒', '古巨基', '蔡卓妍', '鍾欣潼',
  '楊千嬅', '鄭伊健', '鄧麗君', '林憶蓮', '葉倩文', '王傑', '張宇',
  '任賢齊', '陳小春', '陳冠希', '周渝民', '言承旭', '吳建豪', '朱孝天',
  '五月天', '蘇打綠', '飛兒樂團', '八三夭', '動力火車', '草蜢',
  'ずっと真夜中でいいのに', 'サカナクション', 'スピッツ', 'スキマスイッチ',
  'バンプオブチキン', 'ワンオクロック', 'オフィシャルヒゲダンディズム',
  'ミセスグリーンアップル', '藤井風', 'ミレイ', 'キタニタツヤ',
  '三月のパンタシア', '赤い公園', '馬賽克樂隊',
];

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

  // Extract QQ uin for the report header
  let qqUin = '(unknown)';
  const sessions = state.sessions?.byId || {};
  for (const [, s] of Object.entries(sessions)) {
    if (s.providers?.qq?.qqUin) { qqUin = s.providers.qq.qqUin; break; }
  }

  // ── Walk all library entries, collect QQ-sourced artists ──
  const artistTracks = new Map(); // artist → { count, displayName }
  const allTrackTitles = [];

  for (const [key, val] of Object.entries(state)) {
    if (!key.startsWith('library:')) continue;
    const items = val?.items || [];
    for (const item of items) {
      // Use likedPlatforms (what the user actually ❤ on QQ), not sources
      // (which only means the track is available/playable on QQ).
      const likedOnQq = (item.likedPlatforms || []).includes('qq');
      if (!likedOnQq) continue;
      const artist = item.artist || '未知艺人';
      allTrackTitles.push(item.title || '未知歌曲');

      const existing = artistTracks.get(artist);
      if (existing) {
        existing.count++;
      } else {
        artistTracks.set(artist, { count: 1, displayName: artist });
      }

      // Also extract individual artists from "A / B" formatted strings
      const parts = artist.split(/\s*\/\s*/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || trimmed === artist) continue; // skip if same as combined
        const e = artistTracks.get(trimmed);
        if (e) {
          e.count++;
        } else {
          artistTracks.set(trimmed, { count: 1, displayName: trimmed });
        }
      }
    }
  }

  const totalTracks = allTrackTitles.length;
  console.log(`Library QQ-sourced tracks: ${totalTracks}`);
  console.log(`Unique artist entries: ${artistTracks.size}`);

  // ── Sort, classify CJK vs Latin ──
  const sorted = [...artistTracks.keys()].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  );

  const cjk = [];
  const latin = [];
  for (const name of sorted) {
    if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(name)) {
      cjk.push(name);
    } else {
      latin.push(name);
    }
  }

  // ── Match against known aliases ──
  const mapped = new Set();
  const unmapped = [];
  for (const name of cjk) {
    let matched = false;
    for (const key of KNOWN_KEYS) {
      if (cjkOverlap(name, key)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      mapped.add(name);
    } else {
      unmapped.push(name);
    }
  }

  // ── Write Markdown ──
  const outPath = process.argv.includes('--out')
    ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
    : OUT_DEFAULT;

  let md = '';
  md += '# QQ 音乐红心歌曲 · 歌手列表\n\n';
  md += `> 导出时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}\n`;
  md += `> 数据来源：Maestro 本地曲库（已导入的 QQ 红心）\n`;
  md += `> 红心歌曲总数：${totalTracks} 首\n`;
  md += `> 独立歌手/组合数：${artistTracks.size}（CJK: ${cjk.length} / Latin: ${latin.length}）\n`;
  md += `> QQ 账号：${qqUin}\n`;
  md += '\n';
  md += '用于 `packages/common/src/artistAlias.ts` 的 `STAGE_NAME_ALIASES` 映射维护。\n';
  md += '第二列留空，待人工填写对应英文/拉丁艺名（Spotify / Apple Music 等平台的写法）。\n';
  md += '\n';

  // ── Summary ──
  md += '## 概览\n\n';
  md += `| 分类 | 数量 |\n`;
  md += `|------|------|\n`;
  md += `| CJK 艺人总数 | ${cjk.length} |\n`;
  md += `| 已映射 | ${mapped.size} |\n`;
  md += `| 待映射 | ${unmapped.length} |\n`;
  md += `| 拉丁文艺人 | ${latin.length} |\n`;
  md += '\n';

  // ── Already mapped ──
  md += '## 已在 `artistAlias.ts` 中映射的艺人\n\n';
  md += '以下 CJK 艺人名在现有 `STAGE_NAME_ALIASES` 中有对应条目：\n\n';
  md += '| # | 歌手名 | 曲目数 | 已有别名条目 |\n';
  md += '|---|--------|--------|-------------|\n';
  let mappedIdx = 0;
  const mappedSorted = [...mapped].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  for (const name of mappedSorted) {
    mappedIdx++;
    const info = artistTracks.get(name);
    // Find which known key matched
    const matchedKey = KNOWN_KEYS.find((k) => cjkOverlap(name, k)) || '';
    md += `| ${mappedIdx} | ${name} | ${info?.count ?? 0} | ${matchedKey} |\n`;
  }
  md += '\n';

  // ── Unmapped CJK (priority) ──
  md += '## 待映射的艺人（优先处理）\n\n';
  md += '以下 CJK 艺人在 QQ 红心列表中出现但尚未在 `STAGE_NAME_ALIASES` 中映射，\n';
  md += '按曲目数量降序排列，高频艺人优先补：\n\n';
  md += '| # | 歌手名 | 曲目数 | 英文/拉丁艺名 |\n';
  md += '|---|--------|--------|--------------|\n';

  // Sort unmapped by track count desc
  const unmappedSorted = unmapped.sort((a, b) => {
    const ca = artistTracks.get(a)?.count ?? 0;
    const cb = artistTracks.get(b)?.count ?? 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b, 'zh-Hans-CN');
  });

  unmappedSorted.forEach((name, i) => {
    const info = artistTracks.get(name);
    md += `| ${i + 1} | ${name} | ${info?.count ?? 0} | |\n`;
  });
  md += '\n';

  // ── Latin section ──
  if (latin.length > 0) {
    md += '## 英文 / 拉丁文艺人\n\n';
    md += '（这些艺人名本身就是拉丁写法，通常无需额外映射；如 Spotify 写法不同可在此记录）\n\n';
    md += '| # | 歌手名 | 曲目数 | 备注 |\n';
    md += '|---|--------|--------|------|\n';
    latin.forEach((name, i) => {
      const info = artistTracks.get(name);
      md += `| ${i + 1} | ${name} | ${info?.count ?? 0} | |\n`;
    });
    md += '\n';
  }

  // ── Multi-artist combinations (collab tracks) ──
  md += '## 多人合作 / Feat. 组合\n\n';
  md += '以下为 "A / B" 格式的合作艺人串，可能需要额外处理映射：\n\n';
  const collabs = sorted.filter((n) => n.includes(' / '));
  if (collabs.length > 0) {
    md += '| # | 合作串 | 曲目数 |\n';
    md += '|---|--------|--------|\n';
    collabs.forEach((name, i) => {
      const info = artistTracks.get(name);
      md += `| ${i + 1} | ${name} | ${info?.count ?? 0} |\n`;
    });
    md += '\n';
  }

  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n✅ Written ${outPath}`);
  console.log(`   CJK: ${cjk.length} (${mapped.size} mapped, ${unmapped.length} unmapped)`);
  console.log(`   Latin: ${latin.length}`);
  console.log(`   Collabs: ${collabs.length}`);
}

main();
