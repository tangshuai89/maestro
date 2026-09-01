/**
 * E1 契约测试：normalizeKey / displayKey 跨包一致性
 *
 * 验证 server `mergeLibrary` 和 renderer `groupLibraryItems` 共用的
 * `@maestro/common` 归一函数在 10 组真实歌曲上行为一致。
 *
 * 这两组函数是「弹窗徽章 = server 实际合并结果」的唯一保障——
 * 如果 common 包导出的 normalizeKey/displayKey 行为漂移，前端分组
 * 就会和后端合并不对齐。
 *
 * 运行: npx ts-node src/contract.test.ts
 */
export {};
const assert = require('node:assert');
const {
  normalizeKey,
  displayKey,
  stripParensContent,
  stripTrailingMeta,
} = require('./normalizer');

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
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

// ── 10 组真实歌曲（覆盖简繁、feat、括号版本、英文艺名）────────────
const CASES: Array<{
  label: string;
  titleA: string; artistA: string;
  titleB: string; artistB: string;
  normalizeEqual: boolean;  // server mergeLibrary 用 normalizeKey 合并
  displayEqual: boolean;    // renderer groupLibraryItems 用 displayKey 聚组
}> = [
  {
    label: '简繁同一首（海阔天空）',
    titleA: '海阔天空', artistA: 'Beyond',
    titleB: '海闊天空', artistB: 'Beyond',
    normalizeEqual: true, displayEqual: true,
  },
  {
    label: 'feat 标签不影响归一',
    titleA: 'Love (feat. Dua Lipa)', artistA: 'Calvin Harris',
    titleB: 'Love', artistB: 'Calvin Harris',
    normalizeEqual: true, displayEqual: true,
  },
  {
    label: 'Live 版本 displayKey 同组、normalizeKey 不同',
    titleA: '海阔天空', artistA: 'Beyond',
    titleB: '海阔天空 (Live)', artistB: 'Beyond',
    normalizeEqual: false, displayEqual: true,
  },
  {
    label: 'Remix 版本 displayKey 同组、normalizeKey 不同',
    titleA: 'Shape of You', artistA: 'Ed Sheeran',
    titleB: 'Shape of You (Remix)', artistB: 'Ed Sheeran',
    normalizeEqual: false, displayEqual: true,
  },
  {
    label: '英文艺名 vs 中文（周杰伦 vs Jay Chou）',
    titleA: '晴天', artistA: '周杰伦',
    titleB: '晴天', artistB: 'Jay Chou',
    normalizeEqual: false, displayEqual: false,
  },
  {
    label: '同歌不同歌手不并',
    titleA: 'Hello', artistA: 'Adele',
    titleB: 'Hello', artistB: 'Lionel Richie',
    normalizeEqual: false, displayEqual: false,
  },
  {
    label: '大小写不敏感',
    titleA: 'YOASOBI', artistA: 'Ayase',
    titleB: 'yoasobi', artistB: 'ayase',
    normalizeEqual: true, displayEqual: true,
  },
  {
    label: '日文假名与汉字（幾田りら）',
    titleA: 'アイデンティティ', artistA: '幾田りら',
    titleB: 'アイデンティティ', artistB: 'Lilas Ikuta',
    normalizeEqual: false, displayEqual: false,
  },
  {
    label: '括号内翻译后缀',
    titleA: 'Lemon', artistA: '米津玄師',
    titleB: 'Lemon (米津玄師)', artistB: '米津玄師',
    // normalizeKey 也剥括号内容 → 相等
    normalizeEqual: true, displayEqual: true,
  },
  {
    label: '完全相同的歌',
    titleA: 'Bohemian Rhapsody', artistA: 'Queen',
    titleB: 'Bohemian Rhapsody', artistB: 'Queen',
    normalizeEqual: true, displayEqual: true,
  },
];

function main() {
  for (const c of CASES) {
    const nkA = normalizeKey(c.titleA, c.artistA);
    const nkB = normalizeKey(c.titleB, c.artistB);
    const dkA = displayKey(c.titleA, c.artistA);
    const dkB = displayKey(c.titleB, c.artistB);

    check(
      `${c.label} — normalizeKey ${c.normalizeEqual ? '相等' : '不等'}`,
      nkA === nkB,
      c.normalizeEqual,
    );
    check(
      `${c.label} — displayKey ${c.displayEqual ? '相等' : '不等'}`,
      dkA === dkB,
      c.displayEqual,
    );
  }

  // ── 额外：stripParensContent / stripTrailingMeta 稳定性 ──────
  check('stripParensContent 剥 Live', stripParensContent('海阔天空 (Live)'), '海阔天空');
  check('stripParensContent 剥 Remix', stripParensContent('Shape of You (Remix)'), 'Shape of You');
  check('stripTrailingMeta 不动纯标题', stripTrailingMeta('Bohemian Rhapsody'), 'Bohemian Rhapsody');

  console.log(`\n🎉 contract.test 通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main();
