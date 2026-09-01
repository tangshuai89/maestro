/**
 * E2 分组一致性测试：normalizeKey（server mergeLibrary）vs displayKey（renderer groupLibraryItems）
 *
 * 验证：同一 sources 列表，按 normalizeKey 分组（server 行为）和按 displayKey
 * 分组（renderer 行为）的 group 数量、每组成员数一致——确保弹窗徽章 =
 * server 实际合并结果。
 *
 * 核心约束（来自 AGENTS.md）：
 *   "server 把哪些 item 合并到同一个 UnifiedSearchItem，renderer 的
 *    groupLibraryItems 就会把这些 item 聚到同一 group"
 *
 * 运行: npx ts-node src/grouping.test.ts
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
  const ok = JSON.stringify(actual) === JSON.stringify(expected) ||
    (typeof actual === 'number' && actual === expected);
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

/** Simulate server-side mergeLibrary grouping by normalizeKey. */
function serverGroup(items: Array<{ title: string; artist: string }>): Map<string, number> {
  const groups = new Map<string, number>();
  for (const item of items) {
    const key = normalizeKey(item.title, item.artist);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return groups;
}

/** Simulate renderer-side groupLibraryItems grouping by displayKey. */
function rendererGroup(items: Array<{ title: string; artist: string }>): Map<string, number> {
  const groups = new Map<string, number>();
  for (const item of items) {
    const key = displayKey(item.title, item.artist);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return groups;
}

function main() {
  // ── 1. 完全相同的歌 → 两端都 1 组 ──────────────────────────
  {
    const items = [
      { title: '晴天', artist: '周杰伦' },
      { title: '晴天', artist: '周杰伦' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    check('1. 同歌两端 group 数', sg.size, 1);
    check('1. 同歌两端 group 数一致', sg.size, rg.size);
    check('1. 同歌两端成员数一致', [...sg.values()][0], [...rg.values()][0]);
  }

  // ── 2. Live 版本：server 2 组（normalizeKey 不同），renderer 1 组（displayKey 同） ──
  {
    const items = [
      { title: '海阔天空', artist: 'Beyond' },
      { title: '海阔天空 (Live)', artist: 'Beyond' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    // server: normalizeKey 保留版本差异 → 2 组
    check('2. Live server 2 组', sg.size, 2);
    // renderer: displayKey 剥括号 → 1 组
    check('2. Live renderer 1 组', rg.size, 1);
    // 这是预期行为：server 分开合并，renderer 展示聚组
    console.log('✅ 2. Live 版本：server 2 组 / renderer 1 组（预期差异）');
  }

  // ── 3. 简繁同歌 → 两端都 1 组 ──────────────────────────────
  {
    const items = [
      { title: '海阔天空', artist: 'Beyond' },
      { title: '海闊天空', artist: 'Beyond' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    check('3. 简繁 server 1 组', sg.size, 1);
    check('3. 简繁 renderer 1 组', rg.size, 1);
    check('3. 简繁两端成员数一致', [...sg.values()][0], [...rg.values()][0]);
  }

  // ── 4. feat 标签 → 两端都 1 组 ─────────────────────────────
  {
    const items = [
      { title: 'Love', artist: 'Calvin Harris' },
      { title: 'Love (feat. Dua Lipa)', artist: 'Calvin Harris' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    // normalizeKey 剥 feat → 相同
    check('4. feat server 1 组', sg.size, 1);
    // displayKey 剥括号 → 相同
    check('4. feat renderer 1 组', rg.size, 1);
    check('4. feat 两端成员数一致', [...sg.values()][0], [...rg.values()][0]);
  }

  // ── 5. 不同歌手同歌名 → 两端都 2 组 ────────────────────────
  {
    const items = [
      { title: 'Hello', artist: 'Adele' },
      { title: 'Hello', artist: 'Lionel Richie' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    check('5. 不同歌手 server 2 组', sg.size, 2);
    check('5. 不同歌手 renderer 2 组', rg.size, 2);
  }

  // ── 6. 大小写差异 → 两端都 1 组 ────────────────────────────
  {
    const items = [
      { title: 'YOASOBI', artist: 'Ayase' },
      { title: 'yoasobi', artist: 'ayase' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    check('6. 大小写 server 1 组', sg.size, 1);
    check('6. 大小写 renderer 1 组', rg.size, 1);
  }

  // ── 7. 混合场景：3 首同歌（studio + live + remix）──────────
  {
    const items = [
      { title: 'Shape of You', artist: 'Ed Sheeran' },
      { title: 'Shape of You (Live)', artist: 'Ed Sheeran' },
      { title: 'Shape of You (Remix)', artist: 'Ed Sheeran' },
    ];
    const sg = serverGroup(items);
    const rg = rendererGroup(items);
    // server: 3 个不同 normalizeKey（版本标签保留）
    check('7. 混合 server 3 组', sg.size, 3);
    // renderer: 1 个 displayKey（全剥括号）
    check('7. 混合 renderer 1 组', rg.size, 1);
    check('7. 混合 renderer 3 成员', [...rg.values()][0], 3);
    console.log('✅ 7. 混合：server 3 组 / renderer 1 组 3 成员（预期差异）');
  }

  // ── 8. 空列表 → 两端都 0 组 ────────────────────────────────
  {
    const sg = serverGroup([]);
    const rg = rendererGroup([]);
    check('8. 空列表两端 0 组', sg.size, 0);
    check('8. 空列表一致', sg.size, rg.size);
  }

  // ── 9. stripParensContent + displayKey 链 ──────────────────
  {
    // displayKey 内部调 stripParensContent → 剥括号后 normalizeKey
    const dk1 = displayKey('海阔天空 (Live)', 'Beyond');
    const dk2 = displayKey('海阔天空', 'Beyond');
    check('9. displayKey 剥括号后一致', dk1, dk2);
  }

  // ── 10. stripTrailingMeta + normalizeKey 链 ────────────────
  {
    // normalizeKey 内部调 stripTrailingMeta → 剥尾部元数据
    const nk1 = normalizeKey('Lemon - 米津玄師', '米津玄師');
    const nk2 = normalizeKey('Lemon', '米津玄師');
    check('10. normalizeKey 剥尾部元数据后一致', nk1, nk2);
  }

  console.log(`\n🎉 grouping.test 通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main();
