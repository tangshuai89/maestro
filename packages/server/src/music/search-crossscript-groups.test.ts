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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
