/**
 * 统一搜索「跨脚本证据合并」回归测试（buildUnifiedItems crossScriptMerge 开关，白盒）。
 *
 * 背景（用户 2026-09-23 报障）：搜「寂寞，好了」时——
 *   - QQ/网易云返回「寂寞，好了 | 蔡旻佑 | 夏日YO狂想音乐会」（演唱会版 372s）
 *   - Spotify 返回「寂寞，好了 | Evan Yo | 寂寞，好了」（录音室版 346s）
 *   - Deezer 返回「Ji Mo, Hao Liao | Evan Yo | Loneliness」（罗马音元数据 342s）
 * 三条各成一行：用户看不到 SP 徽章（以为没搜到），Deezer 那行显示拼音很怪。
 * 根因：normalizeKey 对跨脚本元数据（Evan Yo ↔ 蔡旻佑）落到不同 key，
 * 而库导入用的 mergeCrossScript 刻意不用于搜索路径。
 *
 * 修复：buildUnifiedItems({crossScriptMerge:true}) 在分组层做 union-find
 * 证据合并——同 versionType 下「标题同义（displayKey 相等/策展别名/跨脚本
 * 音译）+ 艺人可桥（别名表/音译）+ 时长任一对 ≤30s」才并组；标题跨脚本时
 * 音译是硬门（「我可以」↔「Death of Me」同艺人同时长也不并）。
 *
 * 运行: npx ts-node src/music/search-crossscript-groups.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { buildUnifiedItems } = require('./search.util');
const { warmupJa } = require('./translit');
import type { Track } from './types';
import type { MusicProvider } from '../common/provider';

function T(
  provider: MusicProvider,
  id: string,
  title: string,
  artist: string,
  duration: number,
  album = '',
) {
  return {
    track: {
      id,
      provider,
      title,
      artist,
      album,
      coverUrl: '',
      audioUrl: '',
      duration,
      liked: false,
    } as Track,
    platform: provider,
  };
}

function merge(entries: ReturnType<typeof T>[], on = true) {
  return buildUnifiedItems(new Map(), entries, undefined, {
    crossScriptMerge: on,
  });
}

/** item 内全部版本的所有 source 平台集合。 */
function allPlatforms(item: { versions: Array<{ sources: Array<{ platform: string }> }> }) {
  const set = new Set<string>();
  for (const v of item.versions) for (const s of v.sources) set.add(s.platform);
  return set;
}

void (async () => {
  await warmupJa(); // kuromoji 就绪后日文汉字标题（花火→Hanabi）才能罗马化
  let passed = 0;
  let failed = 0;
  const check = (label: string, fn: () => void) => {
    try {
      fn();
      console.log(`✅ ${label}`);
      passed++;
    } catch (err) {
      console.log(`❌ ${label}\n   ${(err as Error).message}`);
      failed++;
    }
  };

  // ── 1. 用户报障场景：三方跨脚本 → 1 条，全平台源都在 ──
  check('1. 寂寞，好了：qq+ne(CJK) + sp(CJK标题/拉丁艺人) + dz(全罗马音) → 1 item', () => {
    const items = merge([
      T('qq', 'q1', '寂寞，好了', '蔡旻佑', 372, '夏日YO狂想音乐会'),
      T('netease', 'n1', '寂寞，好了', '蔡旻佑', 372, '夏日YO狂想音乐会'),
      T('qq', 'q2', '寂寞，好了', '蔡旻佑', 342, '寂寞，好了'),
      T('spotify', 's1', '寂寞，好了', 'Evan Yo', 346, '寂寞，好了'),
      T('deezer', 'd1', 'Ji Mo, Hao Liao', 'Evan Yo', 342, 'Loneliness'),
    ]);
    assert.strictEqual(items.length, 1, '应合并为 1 条');
    const plats = allPlatforms(items[0]);
    for (const p of ['qq', 'netease', 'spotify', 'deezer']) {
      assert.ok(plats.has(p), `versions 里应有 ${p} 源`);
    }
    // 折叠行 = 跨平台共识最多的版本（qq+ne 演唱会版）→ CJK 元数据
    assert.strictEqual(items[0].title, '寂寞，好了');
    assert.strictEqual(items[0].artist, '蔡旻佑');
    // Deezer 342s 与 QQ 342s 落进同一 cluster → 该版本应同时带 qq+deezer 源
    const dzVer = items[0].versions.find((v) =>
      v.sources.some((s) => s.platform === 'deezer'),
    );
    assert.ok(dzVer, '应有含 deezer 源的版本');
    assert.ok(
      dzVer.sources.some((s) => s.platform === 'qq'),
      'deezer 342s 应与 qq 342s 同 cluster（同录音两源）',
    );
  });

  // ── 2. 开关关闭 → 不合并（mergeLibrary/旧路径回归护栏）──
  check('2. crossScriptMerge 关闭 → 跨脚本条目保持拆分', () => {
    const items = merge(
      [
        T('qq', 'q1', '寂寞，好了', '蔡旻佑', 372),
        T('spotify', 's1', '寂寞，好了', 'Evan Yo', 346),
        T('deezer', 'd1', 'Ji Mo, Hao Liao', 'Evan Yo', 342),
      ],
      false,
    );
    // qq(CJK) 1 组 + spotify(拉丁艺人) 1 组 + deezer(全罗马音) 1 组 = 3 条
    assert.strictEqual(items.length, 3, '开关关闭时应保持 3 条');
  });

  // ── 3. 同艺人异曲不并：标题音译是硬门 ──
  check('3. 我可以 ↔ Death of Me（同艺人 alias + 时长接近）→ 不合并', () => {
    const items = merge([
      T('qq', 'q1', '我可以', '蔡旻佑', 273),
      T('spotify', 's1', 'Death of Me', 'Evan Yo', 265),
    ]);
    assert.strictEqual(items.length, 2, '不同歌曲应保持 2 条');
  });

  // ── 4. 日文罗马音标题：花火 ↔ Hanabi（kuromoji 路线）──
  check('4. 花火 ↔ Hanabi（kuromoji 标题音译）→ 合并', () => {
    const items = merge([
      T('qq', 'q1', '花火', 'aiko', 330),
      T('spotify', 's1', 'Hanabi', 'aiko', 330),
    ]);
    assert.strictEqual(items.length, 1, '花火/Hanabi 应合并为 1 条');
  });

  // ── 5. versionType 边界：live 不并 studio ──
  check('5. Song (Live) ↔ Song（跨 versionType）→ 不合并', () => {
    const items = merge([
      T('qq', 'q1', '寂寞，好了 (Live)', '蔡旻佑', 372),
      T('spotify', 's1', '寂寞，好了', 'Evan Yo', 346),
    ]);
    assert.strictEqual(items.length, 2, 'live 与 studio 应保持 2 条');
  });

  // ── 6. 时长门：>30s 且无任一近对 → 不合并 ──
  check('6. 标题同义 + 艺人可桥但时长差 >30s → 不合并', () => {
    const items = merge([
      T('qq', 'q1', '我可以', '蔡旻佑', 273),
      T('spotify', 's1', 'Wo Ke Yi', 'Evan Yo', 240), // 差 33s
    ]);
    assert.strictEqual(items.length, 2, '时长差 >30s 应保持 2 条');
    const items2 = merge([
      T('qq', 'q1', '我可以', '蔡旻佑', 273),
      T('spotify', 's1', 'Wo Ke Yi', 'Evan Yo', 250), // 差 23s
    ]);
    assert.strictEqual(items2.length, 1, '时长差 ≤30s 应合并');
  });

  // ── 7. CJK↔CJK 同音异形不并（音译只对跨脚本启用）──
  check('7. 异地 ↔ 一地（同音同艺人）→ 不合并', () => {
    const items = merge([
      T('qq', 'q1', '异地', '蔡旻佑', 200),
      T('netease', 'n1', '一地', '蔡旻佑', 200),
    ]);
    assert.strictEqual(items.length, 2, '同音异形同脚本应保持 2 条');
  });

  // ── 8. 艺人对不上不并：同名歌不同人 ──
  check('8. 寂寞，好了 蔡旻佑 ↔ 寂寞，好了 陈粤彬（翻唱）→ 不合并', () => {
    const items = merge([
      T('qq', 'q1', '寂寞，好了', '蔡旻佑', 346),
      T('netease', 'n1', '寂寞，好了', '陈粤彬', 342),
    ]);
    assert.strictEqual(items.length, 2, '不同艺人应保持 2 条');
  });
  // ── 9. 裘德 ↔ Jude Chiu（2026-09-29 用户报障：搜「浓缩蓝鲸」ALL 模式）──
  //
  // ⚠️ 诚实的范围声明（2026-09-29 审查补写）：这两条**不测策展别名**。
  // 变异验证：把 `artistAlias.ts` 里的 `裘德: ['Jude Chiu']` 整行删掉，
  // 用例 9/10 依然全绿 —— 因为 buildUnifiedItems 的合并入口是 **title + 时长**
  // （繁简经 cjkUnify 归一后「浓缩蓝鲸」==「濃縮藍鯨」），艺名只是佐证之一。
  // 真实数据（album 不同 / 时长差 8s）下实测：加不加别名，合并结果**完全相同**，
  // 甚至都会退化成「只剩 spotify 源」—— 那才是用户报障的真正形态。
  //
  // 别名本身的判等由 common/src/artistAlias.test.ts 守（那里变异会红）。
  // 这里守的是「合并产物对下游是否可用」：合并后 bestSource 必须落在**能出声**
  // 的那个源上，否则就是"合并成一行但仍点了卡死"。
  check('9. 浓缩蓝鲸 裘德 ↔ Jude Chiu → 合并，且 bestSource 落回网易云', () => {
    const items = merge([
      T('netease', 'n1', '浓缩蓝鲸', '裘德', 277),
      T('spotify', 's1', '浓缩蓝鲸', 'Jude Chiu', 277),
    ]);
    assert.strictEqual(items.length, 1, '同一首歌应合并成 1 条');
    assert.strictEqual(items[0].artist, '裘德', '展示元数据取优先级更高的中文源');
    assert.deepStrictEqual(
      items[0].sources.map((s: { platform: string }) => s.platform).sort(),
      ['netease', 'spotify'],
    );
    assert.strictEqual(items[0].bestSource, 'netease', 'bestSource 应落回能出声的网易云');
    // 合并产物必须能被下游判成"可播"——这是这条断言真正的价值所在：
    // 之前只有 sources/bestSource 的形状断言，漏了"点下去会怎样"。
    const best = items[0].sources.find((s: { platform: string }) => s.platform === items[0].bestSource);
    assert.ok(best && best.hasCopyright, 'bestSource 必须是有版权、能出声的源');
  });

  // ── 10. 同名翻唱不被这条别名带进来（合并只认表内那一对）──
  check('10. 同时长的拉丁名翻唱（Aiden）/ 形近中文名（桀德）→ 各自成条', () => {
    const items = merge([
      T('netease', 'n1', '浓缩蓝鲸', '裘德', 277),
      T('spotify', 's1', '浓缩蓝鲸', 'Jude Chiu', 277),
      T('netease', 'n2', '浓缩蓝鲸', 'Aiden', 277),
      T('netease', 'n3', '浓缩蓝鲸', '桀德', 276),
    ]);
    assert.strictEqual(items.length, 3, '裘德(合并) + Aiden + 桀德');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
