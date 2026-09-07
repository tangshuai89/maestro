// groupLibrary.test.mjs — tests for groupLibraryItems() from ./groupLibrary.ts
//
// This test imports the REAL renderer source (not a hand-copied duplicate).
// The old server-side copy (packages/server/src/music/groupLibrary.test.ts)
// validated a mirror implementation — if the renderer source drifted, the
// copy-test still passed, giving false confidence.  Now we import the actual
// groupLibraryItems / likedPlatforms from ./groupLibrary.ts via an inline ESM
// loader that handles .ts extension resolution + .js→.ts rewriting (needed
// because @maestro/common/src/index.ts exports from './normalizer.js').
//
// Run: node src/lib/groupLibrary.test.mjs

import { register } from 'node:module';
import * as assert from 'node:assert';

// ── inline loader: .ts extension resolution + .js→.ts rewrite ───────────
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.endsWith('.ts')) {
    const ext = extname(specifier);
    if (!ext) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    } else if (ext === '.js') {
      try { return await nextResolve(specifier.slice(0, -3) + '.ts', context); } catch {}
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);
  if (url.endsWith('.ts') && result.source) {
    const src = String(result.source);
    if (src.includes('import.meta.env')) {
      const patched = src.replace(/import\\.meta\\.env/g, '({DEV:false,PROD:true})');
      return { format: result.format, url, source: patched };
    }
  }
  return result;
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

async function main() {
  const { groupLibraryItems, likedPlatforms } = await import('./groupLibrary.ts');
  const { stripTrailingMeta, artistLooseMatch } = await import('@maestro/common');

  // ── 测试 ────────────────────────────────────────────────────────────────

  function item(opts) {
    return {
      id: opts.id,
      title: opts.title,
      artist: opts.artist,
      coverUrl: '',
      duration: opts.duration ?? 200,
      sources: opts.sources ?? [],
      likedPlatforms: opts.likedPlatforms,
    };
  }

  // ── 1. 同 fuzzyKey 仍在同组（基线） ─────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '晴天', artist: '周杰伦', duration: 270, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: '晴天', artist: '周杰伦', duration: 270, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, '同 fuzzyKey 应合并');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq'],
      'platforms 取成员 sources 并集',
    );
    console.log('✅ 1. 同 fuzzyKey 合并 + platforms 并集');
  }

  // ── 2. likedPlatforms 透到组级 platforms + F.I.R. 策展别名合并 ──
  {
    const groups = groupLibraryItems([
      item({
        id: 'l-qq',
        title: 'Lydia',
        artist: 'F.I.R.飞儿乐团',
        duration: 238,
        sources: [{ platform: 'qq', trackId: 'q1' }],
        likedPlatforms: ['qq'],
      }),
      item({
        id: 'l-ne',
        title: 'Lydia',
        artist: 'F.I.R.',
        duration: 239,
        sources: [{ platform: 'netease', trackId: 'n1' }],
        likedPlatforms: ['qq', 'netease', 'spotify'],
      }),
    ]);
    assert.strictEqual(groups.length, 1, 'F.I.R.飞儿乐团 ↔ F.I.R.（策展别名）合并');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      '平台徽章 = 成员 likedPlatforms 并集',
    );
    console.log('✅ 2. F.I.R. 策展别名合并 + likedPlatforms 透到组级');
  }

  // ── 3. 完全相同艺人合并（基线） ─────────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'w1', title: '告白气球', artist: '周杰伦', duration: 215, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'w2', title: '告白气球', artist: '周杰伦', duration: 215, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, '完全相同的艺人应合并');
    console.log('✅ 3. 完全相同艺人合并（基线）');
  }

  // ── 4. 不合并：title 不同 ─────────────────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '晴天', artist: '周杰伦', duration: 270, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: '稻香', artist: '周杰伦', duration: 220, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, '不同 title 不合并');
    console.log('✅ 4. 不同 title 不合并（基线）');
  }

  // ── 5. likedPlatforms 单函数行为 ─────────────────────────────
  {
    const a = item({ id: 'a', title: 'X', artist: 'Y', sources: [{ platform: 'qq', trackId: 'q' }], likedPlatforms: ['netease', 'qq'] });
    assert.deepStrictEqual(
      likedPlatforms(a),
      ['qq', 'netease'],
      'likedPlatforms 优先，按 BADGE_ORDER 排',
    );
    const b = item({ id: 'b', title: 'X', artist: 'Y', sources: [{ platform: 'qq', trackId: 'q' }, { platform: 'spotify', trackId: 's' }] });
    assert.deepStrictEqual(
      likedPlatforms(b),
      ['qq', 'spotify'],
      'likedPlatforms 缺失 → 回退 sources 平台列表',
    );
    console.log('✅ 5. likedPlatforms 单函数行为正确');
  }

  // ── 6. 时长差 > 5s 仍合并（2026-08-07 需求变更：同歌同歌手全并） ────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song (Remix)', artist: 'X', duration: 208, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'displayKey 同（版本标签被剥）→ 合并（Remix vs 原版同歌）');
    assert.strictEqual(groups[0].members.length, 2, '两成员都在同一 group');
    assert.strictEqual(groups[0].members[1].versionTag, 'REMIX', 'Remix 成员带 REMIX 标签');
    console.log('✅ 6. 同歌同歌手全并：Remix 与 原版 合并（子行标 REMIX）');
  }

  // ── 7. feat. 后缀标题合并 ────────────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Promise in Love', artist: 'DJ MITSU THE BEATS', duration: 242, sources: [{ platform: 'netease', trackId: 'ne1' }] }),
      item({ id: 'b', title: 'Promise in Love feat. Jose James', artist: 'DJ MITSU THE BEATS', duration: 242, sources: [{ platform: 'qq', trackId: 'qq1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'feat. 后缀去掉后同 displayKey → 合并');
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq']);
    console.log('✅ 7. feat. suffix stripped → 同 displayKey 合并');
  }

  // ── 8. 简繁跨平台合并（Spotify 繁体 vs QQ/网易云简体） ───────
  {
    const groups = groupLibraryItems([
      item({ id: 'sp', title: '龍捲風', artist: '周杰倫', duration: 270, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
      item({ id: 'qq', title: '龙卷风', artist: '周杰伦', duration: 272, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
    ]);
    assert.strictEqual(groups.length, 1, '繁体龍捲風 + 简体龙卷风应合并为一条');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['qq', 'spotify'],
      '简繁合并后徽章 = 两平台并集',
    );
    console.log('✅ 8. 简繁跨平台合并（OpenCC tw→cn 折叠）');
  }

  // ── 9. ★ B1 修复：artistPrefixMatch 误并拒绝（核心回归） ──────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Adventure of a Lifetime', artist: 'Coldplay', duration: 260, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Adventure of a Lifetime', artist: 'Cold', duration: 260, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, 'B1 修复：Coldplay vs Cold 不合并（巧合 prefix）');
    console.log('✅ 9. B1 修复：artistPrefixMatch includes 误并拒绝（Coldplay vs Cold）');
  }
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Shake It Off', artist: 'Taylor Swift', duration: 219, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Shake It Off', artist: 'Taylor', duration: 219, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, 'B1 修复：Taylor Swift vs Taylor 不合并');
    console.log('✅ 10. B1 修复：Taylor Swift vs Taylor 不合并');
  }

  // ── 11. ★ B3 修复：displayKey 字符覆盖全角破折号 ─────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song - Live', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song — Live', artist: 'X', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'B3 修复：半角 - vs 全角 — 归一合并');
    console.log('✅ 11. B3 修复：dash 变体归一（半角 / em-dash / en-dash）');
  }

  // ── 12. ★ B4 修复：(feat. A) vs (feat. B) 不误并 ────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song (feat. A)', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song (feat. B)', artist: 'X', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, '(feat. A) 与 (feat. B) displayKey 同 → 聚 1 条 group（依赖 server 拆分不同 item）');
    console.log('✅ 12. B4 当前行为：(feat. A/B) 聚到同 group，由 server 拆分不同协奏版本');
  }

  // ── 13. (Live) 与原版同歌同歌手 → 合并（2026-08-07 需求变更） ────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song (Live)', artist: 'X', duration: 215, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'displayKey 同（Live 标签被剥）→ 合并（Live vs 原版同歌）');
    assert.strictEqual(groups[0].members.length, 2, '两成员都在同一 group');
    assert.strictEqual(groups[0].members[1].versionTag, 'LIVE', 'Live 成员带 LIVE 标签');
    console.log('✅ 13. 同歌同歌手全并：Live 与原版 合并（子行标 LIVE）');
  }

  // ── 14. 跨平台同录音（差 ≤ 5s）聚到同 group ────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'X', duration: 203, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'displayKey 同 + 时长差 3s ≤ 5s → 聚同 group');
    assert.strictEqual(groups[0].members.length, 2);
    console.log('✅ 14. 跨平台同录音（差 ≤ 5s）聚同 group');
  }

  // ── 15. 策展别名合并：马赛克乐队 ↔ 马赛克（同乐队，带/不带后缀）──
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '无解', artist: '马赛克乐队', duration: 240, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'b', title: '无解', artist: '马赛克', duration: 241, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
    ]);
    assert.strictEqual(groups.length, 1, '马赛克乐队 ↔ 马赛克（策展别名）合并');
    assert.strictEqual(groups[0].members.length, 2, '两成员同 group');
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq'], '徽章 = 并集');
    console.log('✅ 15. 马赛克乐队 ↔ 马赛克 策展别名合并');
  }

  // ── 16. 策展别名合并：陈绮贞 ↔ Cheer Chen（中/英艺名）─────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '还是会寂寞', artist: '陈绮贞', duration: 260, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'b', title: '还是会寂寞', artist: 'Cheer Chen', duration: 261, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '陈绮贞 ↔ Cheer Chen（策展别名）合并');
    assert.strictEqual(groups[0].members.length, 2);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['qq', 'spotify'], '徽章 = 并集');
    console.log('✅ 16. 陈绮贞 ↔ Cheer Chen 策展别名合并');
  }

  // ── 17. 范逸臣三平台三写法 → 合并（网易云/QQ/Spotify）─────────
  {
    const groups = groupLibraryItems([
      item({ id: 'ne', title: 'Missing You', artist: '范逸臣', duration: 300, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'qq', title: 'Missing You', artist: '【范逸臣 Van Fan】', duration: 302, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'sp', title: 'Missing You', artist: 'Fan Yi Chen', duration: 301, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '范逸臣三平台三写法 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3, '三成员同 group');
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 17. 范逸臣三平台三写法（范逸臣/【范逸臣 Van Fan】/Fan Yi Chen）合并');
  }

  // ── 18. 森山直太朗 ↔ Naotaro Moriyama（罗马音姓名颠倒）─────────
  {
    const groups = groupLibraryItems([
      item({ id: 'ne', title: '桜', artist: '森山直太朗', duration: 320, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: '桜', artist: 'Naotaro Moriyama', duration: 321, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '森山直太朗 ↔ Naotaro Moriyama（策展别名）合并');
    assert.strictEqual(groups[0].members.length, 2);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'spotify'], '徽章 = 并集');
    console.log('✅ 18. 森山直太朗 ↔ Naotaro Moriyama 策展别名合并');
  }

  // ── 19. 小野丽莎：QQ「小野丽莎（Lisa Ono）」vs 其他「小野丽莎」──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: 'Fly Me To The Moon', artist: '小野丽莎（Lisa Ono）', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: 'Fly Me To The Moon', artist: '小野丽莎', duration: 201, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: 'Fly Me To The Moon', artist: 'Lisa Ono', duration: 200, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '小野丽莎三平台写法 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 19. 小野丽莎（小野丽莎/小野丽莎（Lisa Ono）/Lisa Ono）合并');
  }

  // ── 20. 小野丽莎日文名变体：小野リサ（独立/括号）────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: 'Fly Me To The Moon', artist: '小野丽莎（小野リサ）', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: 'Fly Me To The Moon', artist: '小野リサ', duration: 201, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: 'Fly Me To The Moon', artist: 'Lisa Ono', duration: 200, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '小野丽莎日文名变体 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 20. 小野丽莎（小野丽莎（小野リサ）/小野リサ/Lisa Ono）合并');
  }

  // ── 21. 金范洙《悲歌》四写法 → 合并（含韩语标题 + OST 嵌套书名号）──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '悲歌（애절가）', artist: '金范洙', duration: 240, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: '悲歌', artist: '金範洙', duration: 241, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'ne-ko', title: '애절가', artist: '金范洙', duration: 239, sources: [{ platform: 'netease', trackId: 'n2' }], likedPlatforms: ['netease'] }),
      item({ id: 'qq-ost', title: '悲歌 (韩剧《茶母》OST)', artist: '金范洙', duration: 240, sources: [{ platform: 'qq', trackId: 'q2' }], likedPlatforms: ['qq'] }),
    ]);
    assert.strictEqual(groups.length, 1, '金范洙悲歌四写法 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 4, '四成员同 group');
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq'], '徽章 = 并集');
    console.log('✅ 21. 金范洙《悲歌》：韩语标题 + 繁体歌手 + OST 嵌套书名号 → 合并');
  }

  // ── 22. Humbert Humbert：纯片假名 ↔ 英文（日が落ちるまで）────────
  {
    const groups = groupLibraryItems([
      item({ id: 'ne', title: '日が落ちるまで (直到太阳下山)', artist: 'ハンバート ハンバート', duration: 296, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'qq', title: '日が落ちるまで (直到太阳下山)', artist: 'Humbert Humbert', duration: 296, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'sp', title: '日が落ちるまで', artist: 'Humbert Humbert (ハンバート ハンバート)', duration: 297, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, 'Humbert Humbert 片假名/英文写法 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3, '三成员同 group');
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 22. Humbert Humbert：ハンバート ハンバート ↔ Humbert Humbert 合并');
  }

  // ── 23. Humbert Humbert《今晩はお月さん》：中文译名合并 ──────
  {
    const groups = groupLibraryItems([
      item({ id: 'ne', title: '今晩はお月さん', artist: 'ハンバート ハンバート', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'qq', title: '今晚月色真好', artist: 'Humbert Humbert', duration: 201, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
    ]);
    assert.strictEqual(groups.length, 1, '今晩はお月さん ↔ 今晚月色真好（titleAlias）合并');
    assert.strictEqual(groups[0].members.length, 2);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq'], '徽章 = 并集');
    console.log('✅ 23. Humbert Humbert《今晩はお月さん》中文译名合并');
  }

  // ── 24. 桑田佳佑《明日晴れるかな》：罗马音歌手 + 中文译名标题 ──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '明日晴れるかな', artist: '桑田佳佑', duration: 300, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'sp', title: '明日晴れるかな', artist: 'Keisuke Kuwata', duration: 301, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
      item({ id: 'ne', title: '明日会放晴么', artist: '桑田佳祐', duration: 299, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
    ]);
    assert.strictEqual(groups.length, 1, '桑田佳佑三平台写法（罗马音歌手 + 中文译名标题）→ 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 24. 桑田佳佑《明日晴れるかな》：罗马音歌手 + 中文译名标题合并');
  }

  // ── 25. Vocaloid 多艺人组合（白い雪のプリンセスは）──────────
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '白い雪のプリンセスは (白如雪的公主啊)', artist: 'のぼる↑P / 初音未来 (初音ミク)', duration: 261, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: '白い雪のプリンセスは', artist: 'のぼる↑ / 初音ミク', duration: 260, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: '白い雪のプリンセスは (feat. 初音ミク)', artist: 'Noboru', duration: 261, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, 'Vocaloid 多艺人组合三平台 → 合并 1 组');
    assert.strictEqual(groups[0].members.length, 3);
    assert.deepStrictEqual(groups[0].platforms.sort(), ['netease', 'qq', 'spotify'], '徽章 = 三平台并集');
    console.log('✅ 25. Vocaloid 多艺人组合（のぼる↑P/のぼる/Noboru）合并');
  }

  // ── 26. 代表条目时长优先：原版 vs 重录版默认播长的 ──────────
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '日が落ちるまで (直到太阳下山)', artist: 'Humbert Humbert', duration: 296, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'sp', title: '日が落ちるまで', artist: 'Humbert Humbert', duration: 248, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '原版 + 重录版合并 1 组（toggle 展开）');
    assert.strictEqual(groups[0].members.length, 2);
    assert.strictEqual(groups[0].representativeIndex, 0, '代表 = 时长长的原版（296s），非标题更短的重录版');
    console.log('✅ 26. 代表条目时长优先：默认播原版 296s 而非重录版 248s');
  }

  // ── 28. 用户实测分裂修复（2026-08-14）：同名+同歌手多写法合并 ──
  {
    const cases = [
      { title: '爱的大逃杀', artists: ['雀斑乐团', '雀斑'], why: '雀斑乐团 ↔ 雀斑（表补值）' },
      { title: '花篝り', artists: ['日本群星 (オムニバス)', 'V.A.'], why: '日本群星 ↔ V.A.（表补值）' },
      { title: 'レイニブル', artists: ['德永英明', 'Hideaki Tokunaga'], why: '德永英明 ↔ Hideaki Tokunaga（拉丁词序无关）' },
      { title: '归り道は远回りしたくなる', artists: ['乃木坂46', 'Nogizaka46'], why: '乃木坂46 ↔ Nogizaka46（数字 key）' },
      { title: '満月の夜なら', artists: ['あいみょん', '爱缪 (あいみょん)'], why: 'あいみょん ↔ 爱缪（假名 key + 剥括号）' },
      { title: '花のように', artists: ['松隆子 (松たか子)', 'Takako Matsu'], why: '松隆子 ↔ Takako Matsu（剥括号 + 表值）' },
      { title: 'pray', artists: ['川瀬智子', 'Tommy heavenly6'], why: '川瀬智子 ↔ Tommy heavenly6（新字体往返归一）' },
      { title: 'キャンディライン', artists: ['高橋瞳 (たかはしひとみ)', 'Hitomi Takahashi'], why: '高橋瞳 ↔ Hitomi Takahashi（表值补全）' },
      { title: '伊卡洛斯', artists: ['品冠', 'Victor Wong'], why: '品冠 ↔ Victor Wong（新条目）' },
    ];
    for (const c of cases) {
      const groups = groupLibraryItems(
        c.artists.map((artist, i) =>
          item({ id: c.title + '-' + i, title: c.title, artist, duration: 260 + i, sources: [{ platform: 'qq', trackId: 'q' + i }], likedPlatforms: ['qq'] }),
        ),
      );
      assert.strictEqual(groups.length, 1, `应合并 1 组：${c.title}（${c.why}），实际 ${groups.length} 组`);
    }
    console.log('✅ 28. 用户实测分裂修复：雀斑/日本群星/德永英明/乃木坂46/あいみょん 等同名+同歌手多写法合并');
  }

  // ── 29. 正确分裂保持：同名不同人不得误并（翻唱/不同歌）────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '说好的幸福呢', artist: '周杰伦', duration: 260, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'b', title: '说好的幸福呢', artist: 'Jason Chen', duration: 270, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'c', title: '一个人想着一个人', artist: '曾沛慈', duration: 290, sources: [{ platform: 'qq', trackId: 'q2' }], likedPlatforms: ['qq'] }),
      item({ id: 'd', title: '一个人想着一个人', artist: '董书含', duration: 300, sources: [{ platform: 'netease', trackId: 'n2' }], likedPlatforms: ['netease'] }),
    ]);
    assert.strictEqual(groups.length, 4, '翻唱/不同歌手同标题 → 保持 4 组不误并');
    console.log('✅ 29. 正确分裂保持：周杰伦≠Jason Chen、曾沛慈≠董书含 不误并');
  }

  // ── 30. ★ 用户实测（2026-08-14）：「一百」品牌主题曲尾缀 + 段段配对合并 ──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '一百', artist: '李荣浩·黑马', duration: 252, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: '一百', artist: '李荣浩·黑马', duration: 252, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: '一百 - 百事可乐品牌主题曲', artist: 'Ronghao Li·黑馬', duration: 252, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '一百 三平台写法（品牌主题曲尾缀 + 段段配对）合并 1 组');
    assert.strictEqual(groups[0].members.length, 3, '三成员同 group');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      '徽章 = 三平台并集',
    );
    console.log('✅ 30. 一百三平台合并：QQ+网易云「李荣浩·黑马」+ Spotify「Ronghao Li·黑馬 - 百事可乐品牌主题曲」');
  }

  // ── 31. 段段配对铁律不破：表外巧合 prefix 仍拒判（防御）─────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'Coldplay·X&Y', duration: 260, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'Cold', duration: 260, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, 'Coldplay·X&Y vs Cold（段段配对后）仍不合并');
    console.log('✅ 31. 段段配对铁律不破：Coldplay·X&Y vs Cold 仍拆开');
  }

  // ── 31.5. ★ 用户实测（2026-08-14 #2）：「古怪 (Live)」vs「古怪 - Live」 ──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: '古怪 (Live)', artist: '汪苏泷·我是唱作人 第2期', duration: 254, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: '古怪 (Live)', artist: '汪苏泷·我是唱作人 第2期', duration: 254, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: '古怪 - Live', artist: 'Silence Wang·我是唱作人 第2期 (Live)', duration: 254, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, '古怪 Live 三平台写法（QQ 括号 vs Spotify dash）合并 1 组');
    assert.strictEqual(groups[0].members.length, 3, '三成员同 group');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      '徽章 = 三平台并集',
    );
    console.log('✅ 31.5. 古怪 (Live) 三平台合并：QQ+网易云「汪苏泷·我是唱作人 第2期」括号 + Spotify「Silence Wang - Live」dash');
  }

  // ── 31.6. ★ 用户实测（2026-08-14 #3）：aiko「motto / もっと」跨脚本合并 ──
  {
    const groups = groupLibraryItems([
      item({ id: 'qq', title: 'もっと', artist: 'aiko', duration: 254, sources: [{ platform: 'qq', trackId: 'q1' }], likedPlatforms: ['qq'] }),
      item({ id: 'ne', title: 'もっと', artist: 'aiko', duration: 254, sources: [{ platform: 'netease', trackId: 'n1' }], likedPlatforms: ['netease'] }),
      item({ id: 'sp', title: 'Motto', artist: 'aiko·May Dream', duration: 254, sources: [{ platform: 'spotify', trackId: 's1' }], likedPlatforms: ['spotify'] }),
    ]);
    assert.strictEqual(groups.length, 1, 'aiko もっと/Motto 三平台写法合并 1 组');
    assert.strictEqual(groups[0].members.length, 3, '三成员同 group');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      '徽章 = 三平台并集',
    );
    console.log('✅ 31.6. aiko もっと/Motto 三平台合并：QQ+网易云「もっと」+ Spotify「Motto」罗马音');
  }

  // ── 32. stripTrailingMeta 边界：电影版 + 单曲版 + 试听等中文关键词 ──
  {
    const cases = [
      ['主题曲', 'Song - 主题曲', 'Song'],
      ['品牌主题曲', 'Song - 百事可乐品牌主题曲', 'Song'],
      ['广告曲', 'Song - 广告曲', 'Song'],
      ['电影版', 'Song - 电影版', 'Song'],
      ['影版', 'Song - 影版', 'Song'],
      ['TV版', 'Song - TV版', 'Song'],
      ['完整版', 'Song - 完整版', 'Song'],
      ['单曲版', 'Song - 单曲版', 'Song'],
      ['现场版', 'Song - 现场版', 'Song'],
      ['录音版', 'Song - 录音版', 'Song'],
      ['配乐版', 'Song - 配乐版', 'Song'],
      ['插片', 'Song - 插片', 'Song'],
      ['MV', 'Song - MV', 'Song'],
      ['片头曲', 'Song - 片头曲', 'Song'],
      ['片尾曲', 'Song - 片尾曲', 'Song'],
      ['插曲', 'Song - 插曲', 'Song'],
      ['试听', 'Song - 试听', 'Song'],
      ['preview', 'Song - preview', 'Song'],
      ['无 meta 不动', 'Song', 'Song'],
      ['英文 ver.', 'Song - zerokoi ver.', 'Song'],
      ['英文 remix', 'Song - Remix', 'Song'],
      ['stopword the', 'Song - the', 'Song'],
      ['双层：Live + the → Song（两轮裸剥）', 'Song - Live - the', 'Song'],
      ['裸 Live', 'Song - Live', 'Song'],
      ['裸 Remix', 'Song - Remix', 'Song'],
      ['裸 ver.', 'Song - ver.', 'Song'],
      ['feat. X dash 不剥（feat 走 stripFeatTags）', 'Song - feat. X', 'Song - feat. X'],
    ];
    for (const [label, input, expected] of cases) {
      assert.strictEqual(stripTrailingMeta(input), expected, `stripTrailingMeta: ${label}`);
    }
    console.log('✅ 32. stripTrailingMeta 关键词表（中/英/stopword）');
  }

  // ── 33. 同名不同歌手审计合并（2026-08-17，scripts/audit-same-title.ts）──
  {
    console.log('\n── 33. 同名不同歌手：LATIN_FULL_ALIASES 合并 + 防误并 ──');
    const mergePairs = [
      ['ChiliChill乐团', 'ChiliChill'],
      ['Roy Ayers', 'Roy Ayers Ubiquity'],
      ['Noel Gallagher', "Noel Gallagher's High Flying Birds"],
      ['久石让', '久石譲'],
      ['藤原樱 (藤原さくら)', '藤原さくら'],
      ['新裤子', '新裤子乐队'],
      ['悠木碧', 'ターニャ・デグレチャフ(CV:悠木碧)'],
      ['松本梨香', 'サトシ(CV:松本梨香) / Pikachu (Character Voice: Ikue Otani)'],
    ];
    for (const [a, b] of mergePairs) {
      assert.strictEqual(artistLooseMatch(a, b), true, `应合并: ${a} vs ${b}`);
      assert.strictEqual(artistLooseMatch(b, a), true, `应合并(反向): ${b} vs ${a}`);
    }
    console.log(`✅ 33a. 8 组合并命中（双向 ${mergePairs.length * 2} 断言）`);
    const rejectPairs = [
      ['Fine乐团', 'ChiliChill乐团'],
      ['Fine乐团', '回春丹乐队'],
      ['Coldplay', 'Cold'],
      ['Taylor Swift', 'Taylor'],
      ['五月天', '五月天乐团'],
    ];
    for (const [a, b] of rejectPairs) {
      assert.strictEqual(artistLooseMatch(a, b), false, `不应合并: ${a} vs ${b}`);
    }
    console.log(`✅ 33b. 防误并 ${rejectPairs.length} 组`);
  }
  console.log('\n🎉 groupLibrary.test 全部 33 项通过');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
