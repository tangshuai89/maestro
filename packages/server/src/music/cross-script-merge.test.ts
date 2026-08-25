/**
 * 库导入「跨脚本合并」回归测试（mergeCrossScript + isCrossScript，白盒）。
 *
 * 背景（用户 2026-08-17 实测）：喜欢列表里有些歌没合并——
 *   - 花火 / Hanabi（aiko）：QQ/网易云写汉字「花火」或假名「はなび」，Spotify
 *     写罗马音「Hanabi」。旧 `search.util.isCrossScript` 只认汉字（不含假名），
 *     「はなび ↔ Hanabi」不会被判为跨脚本 → 不合并。而 music.service 的私有
 *     isCrossScript 早已补了假名（搜索路径修了，库导入路径漏了）。
 *   - 百花缭乱：Title 可能跨脚本（百花缭乱 ↔ Hyakka Ryouran），艺人也可能跨
 *     脚本（汉字/假名 ↔ 罗马音）。`mergeCrossScript` 原来只用 `artistLooseMatch`
 *     （字面/别名表），桥不上跨脚本艺人 → 不合并。补用 `artistTransliterationMatch`
 *     （音译佐证，与搜索路径同一套）后能并。
 *
 * 运行: npx ts-node src/music/cross-script-merge.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { buildUnifiedItems, mergeCrossScript, isCrossScript } = require('./search.util');
const { warmupJa } = require('./translit');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function T(p: string, id: string, title: string, artist: string, duration: number): any {
  return {
    track: {
      id, provider: p, title, artist, album: '', coverUrl: '', audioUrl: '',
      duration, liked: false,
    },
    platform: p,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeCount(entries: any[]): number {
  const items = buildUnifiedItems(new Map(), entries);
  return mergeCrossScript(items).length;
}

void (async () => {
  // 需要 kuromoji 已预热，artistTransliterationMatch 才能读日文汉字艺名读音。
  await warmupJa();

  // ── 1. isCrossScript：假名也算日文侧 ──────────────────────
  {
    assert.strictEqual(isCrossScript('花火', 'hanabi'), true, '汉字 vs 罗马音');
    assert.strictEqual(isCrossScript('はなび', 'hanabi'), true, '假名 vs 罗马音（修复前 false）');
    assert.strictEqual(isCrossScript('もっと', 'motto'), true, '假名 vs 罗马音');
    assert.strictEqual(isCrossScript('hanabi', 'はなび'), true, '反向');
    assert.strictEqual(isCrossScript('花火', 'はなび'), false, '汉字 vs 假名同属日文侧，不算跨脚本');
    assert.strictEqual(isCrossScript('hanabi', 'sakura'), false, '两边都是拉丁，不跨脚本');
    console.log('✅ 1. isCrossScript 把假名（぀-ヿ）视作日文侧');
  }

  // ── 2. 用户场景：aiko 花火（汉字）vs Hanabi（罗马音）→ 合并 ──
  {
    assert.strictEqual(
      mergeCount([T('qq', 'q1', '花火', 'aiko', 330), T('spotify', 's1', 'Hanabi', 'aiko', 330)]),
      1,
      '花火(汉字) ↔ Hanabi 应合并为 1 条',
    );
    console.log('✅ 2. aiko「花火」 ↔ Spotify「Hanabi」合并（字数 vs 罗马音）');
  }

  // ── 3. 用户场景：aiko 花火（假名 はなび）vs Hanabi → 合并（修复点）──
  {
    assert.strictEqual(
      mergeCount([T('netease', 'n1', 'はなび', 'aiko', 330), T('spotify', 's1', 'Hanabi', 'aiko', 330)]),
      1,
      'はなび(假名) ↔ Hanabi 应合并为 1 条（修复点）',
    );
    console.log('✅ 3. aiko「はなび」(假名) ↔ Spotify「Hanabi」合并（修复假名侧）');
  }

  // ── 4. 跨脚本 title 且跨脚本艺人：夜に駆ける/藤井風 ↔ Yoru ni Kakeru/Fujii Kaze ──
  {
    assert.strictEqual(
      mergeCount([
        T('qq', 'q1', '夜に駆ける', '藤井風', 400),
        T('spotify', 's1', 'Yoru ni Kakeru', 'Fujii Kaze', 400),
      ]),
      1,
      'title+艺人双跨脚本应合并（修复点）',
    );
    console.log('✅ 4. title+艺人双跨脚本（藤井風 ↔ Fujii Kaze）合并（修复艺人侧）');
  }

  // ── 5. 同 title、艺人跨脚本：夜に駆ける/藤井風 vs 夜に駆ける/Fujii Kaze ──
  {
    assert.strictEqual(
      mergeCount([
        T('qq', 'q1', '夜に駆ける', '藤井風', 400),
        T('spotify', 's1', '夜に駆ける', 'Fujii Kaze', 400),
      ]),
      1,
      '同 title 艺人跨脚本应合并（修复点）',
    );
    console.log('✅ 5. 同 title 艺人跨脚本（藤井風 ↔ Fujii Kaze）合并（修复艺人侧）');
  }

  // ── 6. 反例：不同艺人、跨脚本 title 不误并 ───────────────────
  {
    assert.strictEqual(
      mergeCount([
        T('qq', 'q1', '花火', 'aiko', 330),
        T('spotify', 's1', 'Hanabi', 'Radwimps', 330),
      ]),
      2,
      '花火/aiko ↔ Hanabi/Radwimps 是不同歌，必须保持 2 条',
    );
    console.log('✅ 6. 不同艺人跨脚本 title 不误并（aiko 花火 ≠ Radwimps Hanabi）');
  }

  // ── 7. 反例：跨脚本艺人但音译对不上不应并（翻唱链事故规避）───
  {
    // 铃木爱理（翻唱）vs Lefty Hand Cream，title 跨脚本但艺人音译对不上 → 不并
    assert.strictEqual(
      mergeCount([
        T('qq', 'q1', '好きな人がいること', '铃木爱理', 280),
        T('spotify', 's1', 'Suki na Hito ga Iru Koto', 'Lefty Hand Cream', 280),
      ]),
      2,
      '铃木爱理 ↔ Lefty Hand Cream 艺人音译对不上，必须 2 条',
    );
    console.log('✅ 7. 跨脚本艺人音译对不上不并（铃木爱理 ≠ Lefty Hand Cream，翻唱链事故规避）');
  }

  console.log('\n🎉 cross-script-merge.test 全部 7 项通过');
})();
