#!/usr/bin/env node
/**
 * Final pass: merge all WebSearch-verified English names into artistAlias.ts.
 * Reads the current file, updates entries with verified names, deduplicates,
 * and writes a clean output.
 */

const fs = require('fs');
const path = require('path');
const { Converter } = require('opencc-js');

const ALIAS_PATH = path.resolve(__dirname, '..', 'packages', 'common', 'src', 'artistAlias.ts');

// ── All WebSearch-verified English names (cumulative) ──────────────────
const VERIFIED = {
  // Chinese
  '林韓星': ['Lim Han-byul', 'Onestar', '林韩星'],
  '李素羅': ['Lee So-ra', 'Lee Sora', '李素罗'],
  '阿杜': ['A-Do', 'A-do', 'Andy', '阿杜'],
  '楊坤': ['Kane Yang', 'Yang Kun', '杨坤'],
  '許靖韻': ['Angela Hui', 'Angela', '许靖韵'],
  '新褲子': ['New Pants', '新裤子'],
  '許慧欣': ['Evonne Hsu', '许慧欣'],
  '謝安琪': ['Kay Tse', '谢安琪'],
  '周傳雄': ['Steve Chou', 'Xiao Gang', '小刚', '周传雄'],
  '品冠': ['Victor Wong', '品冠'],
  '逃跑計劃': ['Escape Plan', 'Perdel', '逃跑计划'],
  '易烊千璽': ['Jackson Yee', 'Yi Yangqianxi', '易烊千玺'],
  '顏人中': ['Ele Yan', 'Ele', '颜人中'],
  '張傑': ['Jason Zhang', '张杰'],
  '陳致逸': ['Yu-Peng Chen', '陈致逸'],
  '趙方婧': ['Zhao Fangjing', '赵方婧'],
  '音闕詩聽': ['Interesting', '音阙诗听'],
  '石璽彤': ['Shi Xitong', '石玺彤'],
  '白靜晨': ['Bai Jingchen', '白静晨'],
  '鍾凱琳': ['Zhong Kailin', '钟凯琳'],
  '董書含': ['Dong Shuhan', '董书含'],
  '曾溯恕': ['Zeng Sushu', '曾溯恕'],
  '許哲珮': ['Peggy Hsu', '许哲珮'],
  '施文斌': ['Shi Wenbin', '施文斌'],
  '楊楚驍': ['Yang Chuxiao', '杨楚骁'],
  '閆澤歡': ['Yan Zehuan', '闫泽欢'],
  '譚晶': ['Tan Jing', '谭晶'],
  '三Z': ['3Z-STUDIO', '三Z-STUDIO', 'San Z Studio'],
  '梁凡': ['Liang Fan', '梁凡'],
  '王心如': ['Wang Xinru', 'Cynthia Wang', '王心如'],
  '於梓貝': ['Yu Zibei', '于梓贝'],
  '李嘉格': ['Li Jiage', '李嘉格'],
  '野田洋次郎': ['Yojiro Noda', '野田洋次郎'],
  '黃霄雲': ['Huang Xiaoyun', '黄霄雲'],
  '戴荃': ['Dai Quan', '戴荃'],
  '金海心': ['Jin Haixin', 'Hannah Jin', '金海心'],
  '何維健': ['Derrick Hoh', '何维健'],

  // Japanese
  '悠木碧': ['Aoi Yūki', 'Aoi Yuki', 'Aoi Yuuki', '悠木碧'],
  '藤田恵美': ['Emi Fujita', '藤田惠美'],
  'コシュニエ': ['Cö shu Nie', 'Cö Shu Nie'],
  '三浦透子': ['Toko Miura', '三浦透子'],
  '松原正樹': ['Masaki Matsubara', '松原正樹'],
  '神山羊': ['Yoh Kamiyama', 'Yukisan', 'uki3', '神山羊'],

  // Korean
  '이무진': ['Lee Mu-jin', 'Lee Mujin', '李茂珍'],

  // Cross-language
  'シンガー': ['SING', 'SING女团'],
  '飛狗': ['Fei Gou', '飞狗MOCO'],
  '白靜晨': ['Bai Jingchen', '白静晨'],
};

// ── Main ────────────────────────────────────────────────────────────────────

let s2t, t2s;
try { s2t = Converter({ from: 'cn', to: 'tw' }); } catch { s2t = s => s; }
try { t2s = Converter({ from: 'tw', to: 'cn' }); } catch { t2s = s => s; }

function main() {
  const src = fs.readFileSync(ALIAS_PATH, 'utf8');

  // Extract all entries
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

  console.log(`Read ${entries.length} existing entries`);

  // Update with verified names
  let updated = 0;
  for (const e of entries) {
    if (VERIFIED[e.key]) {
      const newAliases = [...new Set([...VERIFIED[e.key], ...e.aliases])];
      if (JSON.stringify(newAliases) !== JSON.stringify(e.aliases)) {
        e.aliases = newAliases;
        updated++;
      }
    }
  }
  console.log(`Updated ${updated} entries with verified English names`);

  // Fill any entry that only has CJK aliases with at least s2t/t2s
  let filled = 0;
  for (const e of entries) {
    const hasEnglish = e.aliases.some(a => /[A-Za-z]{3,}/.test(a));
    if (!hasEnglish) {
      // Try s2t/t2s
      try {
        const simp = t2s(e.key);
        if (simp !== e.key && !e.aliases.includes(simp)) e.aliases.push(simp);
      } catch {}
      try {
        const trad = s2t(e.key);
        if (trad !== e.key && !e.aliases.includes(trad)) e.aliases.push(trad);
      } catch {}
      filled++;
    }
    // Remove self-referential aliases
    e.aliases = e.aliases.filter(a => a !== e.key);
    // Deduplicate
    e.aliases = [...new Set(e.aliases)];
  }
  console.log(`Filled ${filled} s2t-only entries`);

  // Remove entries with zero aliases
  const final = entries.filter(e => e.aliases.length > 0);
  console.log(`Removed ${entries.length - final.length} empty entries`);
  console.log(`Final: ${final.length} entries`);

  // Check for duplicates
  const seen = new Map();
  const deduped = [];
  for (const e of final) {
    if (seen.has(e.key)) {
      const existing = seen.get(e.key);
      if (e.aliases.length > existing.aliases.length) {
        const idx = deduped.findIndex(x => x.key === e.key);
        deduped[idx] = e;
        seen.set(e.key, e);
      }
    } else {
      deduped.push(e);
      seen.set(e.key, e);
    }
  }

  // Rebuild file
  const objStart = src.indexOf('const STAGE_NAME_ALIASES');
  const braceStart = src.indexOf('{', objStart);
  const before = src.slice(0, braceStart + 1);
  const objEndMarker = '};\n\n/**\n * 艺人名 → 别名表 key';
  const afterIdx = src.indexOf(objEndMarker);
  const after = afterIdx !== -1
    ? src.slice(afterIdx)
    : '\n};\n\n' + src.slice(src.lastIndexOf('export function stageNameAliasMatch'));

  // Ensure after starts clean
  const cleanAfter = after.replace(/^\};?\s*\n*/, '');

  const entriesBlock = deduped
    .map(e => {
      const aliasArr = e.aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
      const commentStr = e.comment ? ` // ${e.comment}` : '';
      return `  '${e.key}': [${aliasArr}],${commentStr}`;
    })
    .join('\n');

  const newSrc = before + '\n' + entriesBlock + '\n};\n\n' + cleanAfter;

  fs.writeFileSync(ALIAS_PATH, newSrc, 'utf8');
  console.log(`✅ Written ${ALIAS_PATH} (${deduped.length} entries)`);

  // Stats
  let withEng = 0;
  const stillNoEng = [];
  for (const e of deduped) {
    if (e.aliases.some(a => /[A-Za-z]{3,}/.test(a))) {
      withEng++;
    } else {
      stillNoEng.push(e);
    }
  }
  console.log(`With English: ${withEng}`);
  console.log(`Without English: ${stillNoEng.length}`);
  stillNoEng.slice(0, 10).forEach(e => console.log(`  - ${e.key}: [${e.aliases.join(', ')}]`));
}

main();
