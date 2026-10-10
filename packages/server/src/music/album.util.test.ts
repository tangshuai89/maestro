/**
 * buildUnifiedAlbums / sortAlbumsByRelevance 单测。
 * 覆盖 spec: specs/album-search/tasks.md 2.2 + 2.7。
 *
 * 运行: npx ts-node packages/server/src/music/album.util.test.ts
 */
export {};
const assert = require('node:assert');

const { buildUnifiedAlbums, sortAlbumsByRelevance, albumsProbablySame } = require('./album.util');

const src = (
  platform: string,
  albumId: string,
  title: string,
  artist: string,
  trackCount: number,
  extra: Partial<Record<string, unknown>> = {},
): any => ({
  platform,
  albumId,
  title,
  artist,
  coverUrl: '',
  trackCount,
  year: 0,
  rank: 0,
  ...extra,
});

async function main() {
  let pass = 0;
  const ok = (n: string) => {
    pass++;
    console.log(`✅ ${n}`);
  };

  // ── 1. 空输入 ──────────────────────────────────────────────
  {
    assert.deepStrictEqual(buildUnifiedAlbums([]), []);
    assert.deepStrictEqual(buildUnifiedAlbums(null as any), []);
    ok('1. 空输入返回空数组');
  }

  // ── 2. 同专辑跨平台合并 ────────────────────────────────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '周杰伦', 11, { coverUrl: 'q.jpg', rank: 0 }),
      src('deezer', 'd1', '叶惠美', '周杰伦', 11, { coverUrl: 'd.jpg', rank: 1 }),
    ]);
    assert.strictEqual(r.length, 1, '同名同艺人同曲目数应合并成 1 张');
    assert.strictEqual(r[0].sources.length, 2);
    assert.strictEqual(r[0].trackCount, 11);
    assert.strictEqual(r[0].variantMismatch, undefined, '无分歧不该打标');
    // 代表项按 PLAY_PRIORITY = qq 优先
    assert.strictEqual(r[0].coverUrl, 'q.jpg', '代表项应取 qq');
    ok('2. 同专辑跨平台合并，代表项按 PLAY_PRIORITY');
  }

  // ── 3. 同名但艺术家不同 → 不合并 ──────────────────────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '周杰伦', 11),
      src('netease', 'n1', '叶惠美', '王珏子乔', 11),
    ]);
    assert.strictEqual(r.length, 2, '同名不同艺人必须拆成两张卡片');
    ok('3. 同名不同艺术家不合并');
  }

  // ── 4. trackCount 分歧 >50% → 不跨平台合并 + 打标 ──────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '周杰伦', 11),
      src('netease', 'n1', '叶惠美', '周杰伦', 18),
    ]);
    assert.strictEqual(r.length, 2, '11 vs 18（>50%）必须拆开');
    assert.ok(
      r.every((x: any) => x.variantMismatch === true),
      '两张都应打 variantMismatch',
    );
    ok('4. trackCount 分歧 >50% → 拆开 + variantMismatch');
  }
  {
    // 分歧刚好在阈值内(1.5) → 仍合并（radio edit 类小幅差异不是不同专辑）
    const r = buildUnifiedAlbums([
      src('qq', 'm1', 'X', 'Y', 10),
      src('deezer', 'd1', 'X', 'Y', 15),
    ]);
    assert.strictEqual(r.length, 1, '10 vs 15（=1.5，未超阈值）应合并');
    assert.strictEqual(r[0].trackCount, 10, '偶数个取下中位');
    ok('4b. 分歧恰好 1.5（未超）仍合并，中位数取下中位');
  }
  {
    // ⚠️ 核心防回归：某平台没给 trackCount(0) 不能被当成分歧
    const r = buildUnifiedAlbums([
      src('qq', 'm1', 'X', 'Y', 11),
      src('deezer', 'd1', 'X', 'Y', 0), // 平台没给
    ]);
    assert.strictEqual(r.length, 1, 'trackCount=0（未知）不应触发分歧');
    assert.strictEqual(r[0].trackCount, 11, '中位数应忽略 0');
    ok('4c. trackCount=0（平台没给）不触发分歧，中位数忽略 0');
  }

  // ── 5. 真实响应回归护栏：搜「叶惠美」必须产出 3 张不同卡片 ──
  //   2026-09-30 Spike 实测：QQ=周杰伦11 / 网易云=王珏子乔18(翻唱) / Deezer=Jue Wang19
  {
    const r = buildUnifiedAlbums([
      src('qq', '000MkMni19ClKG', '叶惠美', '周杰伦', 11, { rank: 0 }),
      src('netease', '372081313', '叶惠美', '王珏子乔', 18, { rank: 0 }),
      src('deezer', '966922721', '叶惠美', 'Jue Wang', 19, { rank: 0 }),
    ]);
    assert.strictEqual(r.length, 3, '叶惠美应产出 3 张卡片（翻唱不能被并进原版）');
    const artists = r.map((x: any) => x.artist).sort();
    assert.deepStrictEqual(artists, ['Jue Wang', '周杰伦', '王珏子乔']);
    ok('5. 回归护栏：真实「叶惠美」三平台响应产出 3 张独立卡片');
  }

  // ── 6. coverUrl 取首个非空 ────────────────────────────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', 'X', 'Y', 5, { coverUrl: '' }), // qq 没封面
      src('deezer', 'd1', 'X', 'Y', 5, { coverUrl: 'd.jpg' }),
    ]);
    assert.strictEqual(r[0].coverUrl, 'd.jpg', '应跳过空封面取首个非空');
    ok('6. coverUrl 取组内首个非空');
  }

  // ── 7. year 取最早非零 ────────────────────────────────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', 'X', 'Y', 5, { year: 0 }), // 平台没给
      src('deezer', 'd1', 'X', 'Y', 5, { year: 2003 }),
      src('netease', 'n1', 'X', 'Y', 5, { year: 2013 }), // 再版
    ]);
    assert.strictEqual(r[0].year, 2003, '应取最早非零年');
    ok('7. year 取最早非零（忽略 0）');
  }

  // ── 8. 相关性排序 ────────────────────────────────────────
  {
    const albums = buildUnifiedAlbums(
      [
        // displayKey 会剥掉括号内容 → 「叶惠美 (Live)」与「叶惠美」同分，
        // 二者靠 rank 决胜。这是与单曲 sortByRelevance 一致的行为（见 spec
        // 「相关性与 (Live) 括号」），不是 bug。
        src('qq', 'm1', '叶惠美 (Live)', '周杰伦', 12, { rank: 0 }),
        src('qq', 'm2', '叶惠美', '周杰伦', 11, { rank: 5 }),
        src('qq', 'm3', '叶惠美完全同名', '别人', 3, { rank: 1 }),
        src('qq', 'm4', '叶惠美精选集', '周杰伦', 20, { rank: 2 }),
      ],
      { query: '叶惠美' },
    );
    // 全等 & (Live) 都 +120（括号被剥），按 rank 升序
    assert.strictEqual(albums[0].title, '叶惠美 (Live)', '同分内 rank 小的在前');
    assert.strictEqual(albums[1].title, '叶惠美', '同分内 rank 大的在后');
    // 「精选集」/「完全同名」是包含 → +50，排在 +120 之后
    // 两者都是纯包含(+50)且艺人都不匹配 → 同分，按 rank 升序（1 在 2 前）
    assert.strictEqual(albums[2].title, '叶惠美完全同名', '同分内 rank=1 在前');
    assert.strictEqual(albums[3].title, '叶惠美精选集', '同分内 rank=2 在后');
    ok('8. 相关性排序：全等(+120) > 包含(+50)；同分按 rank 升序');
  }
  {
    // 前缀(+70) vs 中间包含(+50)：query 必须落在标题开头 vs 中间才有区别。
    // 用英文是因为 CJK 下 displayKey 全等判定会把差异吃掉（见 spec 备注）。
    const albums = buildUnifiedAlbums(
      [
        src('qq', 'm1', 'The Abbey Sessions', 'Beatles', 3, { rank: 0 }),
        src('qq', 'm2', 'Abbey Road', 'Beatles', 17, { rank: 9 }),
      ],
      { query: 'Abbey' },
    );
    assert.strictEqual(
      albums[0].title,
      'Abbey Road',
      '前缀(+70) 应强于中间包含(+50)，即使 rank 差 9 位',
    );
    ok('8d. 前缀(+70) 强于中间包含(+50)');
  }
  {
    // 同分 → 按平台内 rank 升序（各平台 top 结果交错冒头）
    const albums = buildUnifiedAlbums(
      [
        src('qq', 'a', '同名', 'A', 1, { rank: 9 }),
        src('netease', 'b', '同名', 'B', 1, { rank: 0 }),
        src('deezer', 'c', '同名', 'C', 1, { rank: 4 }),
      ],
      { query: '同名' },
    );
    const ranks = albums.map((a: any) => a.sources[0].rank);
    assert.deepStrictEqual(ranks, [0, 4, 9], '同分应按 rank 升序');
    ok('8b. 同分 tie-break 按平台内 rank 升序');
  }
  {
    assert.deepStrictEqual(sortAlbumsByRelevance([], 'x'), [], '空数组不炸');
    const a: any = { sources: [] };
    assert.deepStrictEqual(sortAlbumsByRelevance([a], ''), [a], '空 query 原样返回（不排序）');
    ok('8c. 空 query / 空数组兜底');
  }

  // ── 9. 标题或艺人全空 → 跳过 ─────────────────────────────
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '', '', 5), // 无法归一
      src('qq', 'm2', '正常专辑', '某歌手', 5),
    ]);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].title, '正常专辑');
    ok('9. 标题+艺人全空的条目被跳过');
  }

  // ── 10. 跨脚本桥接判定 ───────────────────────────────────
  {
    assert.ok(
      albumsProbablySame(
        src('deezer', 'd', '叶惠美', '周杰伦', 11),
        src('qq', 'q', '叶惠美', '周杰伦', 11),
      ),
      '完全同名同艺人应桥接',
    );
    assert.ok(
      !albumsProbablySame(
        src('deezer', 'd', '叶惠美', 'Jue Wang', 19),
        src('qq', 'q', '叶惠美', '王珏子乔', 18),
      ),
      '翻唱 vs 原版，artist 桥接不上且专辑名同脚本 → 不并',
    );
    ok('10. albumsProbablySame 桥接判定');
  }

  // ── 11. 多平台来源的 bestRank 取最小 ─────────────────────
  {
    const albums = buildUnifiedAlbums(
      [
        src('qq', 'm1', '同名专辑', '某歌手', 10, { rank: 20 }),
        src('deezer', 'd1', '同名专辑', '某歌手', 10, { rank: 3 }),
      ],
      { query: '同名专辑' },
    );
    assert.strictEqual(albums.length, 1);
    const sorted = sortAlbumsByRelevance(albums, '同名专辑');
    assert.strictEqual(sorted.length, 1);
    ok('11. 多平台合并后排序不报错（bestRank 取组内最小）');
  }

  // ── 12. id 稳定性 ────────────────────────────────────────
  {
    const a = buildUnifiedAlbums([src('qq', 'm1', '叶惠美', '周杰伦', 11)]);
    const b = buildUnifiedAlbums([src('deezer', 'd1', '叶惠美', '周杰伦', 11)]);
    assert.strictEqual(a[0].id, b[0].id, '同专辑不同平台应产出同一 id（可做 React key）');
    assert.ok(a[0].id.startsWith('merged-'));
    assert.ok(a[0].id.length <= 120, 'id 要截断');
    ok('12. 合并 id 跨平台稳定且已截断');
  }

  // 13. 跨脚本桥接必须真的接进 buildUnifiedAlbums（2026-09-29 review 补）
  //
  // 背景：albumsProbablySame 与它的单测都一直存在，但生产代码零调用 ——
  // 桥接逻辑是死代码，Deezer 罗马音专辑与 QQ/网易云汉字专辑各显示一张卡片。
  // 用例 10 测的是函数本身，抓不到「函数没被调用」这类接线缺失，所以这里
  // 一律走 buildUnifiedAlbums 端到端断言。变异验证：摘掉接线 → 13/13b/13c 红。
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '叶惠美', 11),
      src('deezer', 'd1', 'Ye Hui Mei', '叶惠美', 11),
    ]);
    assert.strictEqual(r.length, 1, '专辑名跨脚本 + 艺人相同 → 应合并成 1 张');
    assert.deepStrictEqual(r[0].sources.map((x: any) => x.platform).sort(), ['deezer', 'qq'], '两个平台源都应在');
    ok('13. 跨脚本专辑合并：桥接真的接进了 buildUnifiedAlbums');
  }
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '叶惠美', 11),
      src('deezer', 'd1', '叶惠美', '周杰伦', 11),
    ]);
    assert.strictEqual(r.length, 2, '专辑名相同但艺人不同 → 仍是 2 张（桥接不能放宽门槛）');
    ok('13b. 桥接不破坏「同名不同艺人」边界');
  }
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '周杰伦', 11),
      src('netease', 'n1', '叶惠美', '周杰伦', 18),
    ]);
    assert.strictEqual(r.length, 2, 'trackCount 11 vs 18 分歧 → 仍拆开');
    assert.ok(r.every((x: any) => x.variantMismatch === true), '两张都应打 variantMismatch（桥接不能把分歧拆开的又并回去）');
    ok('13c. 桥接不破坏 trackCount 分歧保护');
  }
  {
    const r = buildUnifiedAlbums([
      src('qq', 'm1', '叶惠美', '周杰伦', 11),
      src('deezer', 'd1', '叶惠美 (Live)', '周杰伦', 11),
    ]);
    assert.strictEqual(r.length, 2, 'studio 与 (Live) 是不同版本，不能被桥到一起');
    ok('13d. 桥接不跨版本（(Live) 不与正式版合并）');
  }
  console.log(`\n${pass} 个用例全部通过 ✅`);
}

main().catch((e) => {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
});
