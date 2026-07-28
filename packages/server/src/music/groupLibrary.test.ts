/**
 * 回归测试：groupLibraryItems 在「同人异名」时合并，并把 likedPlatforms 透到
 * 组级 platforms 字段。
 *
 * 背景 bug：库里有两条 Lydia（QQ 写 F.I.R.飞儿乐团、网易云/Spotify 写 F.I.R.），
 * fuzzyKey 严格归一后两者不等，被拆成两组、badge 各自不全；用户看到的 QQ 那
 * 个只有 Q 角标。修复 = 同一 title 下 artist fuzzyKey 互为子串（prefix 启发）
 * 时合并；组级 platforms 取成员 likedPlatforms 并集。
 *
 * 注：本测试是 whitebox——把 renderer/src/lib/groupLibrary.ts 的实现复制过来
 * 跑（ESM/CJS 跨包 import 在 ts-node 里太脆，只好 inline）。如果函数改了，
 * 这边也需要同步；专门加了"实现与 renderer 实现同源"的注释。
 *
 * 运行: npx ts-node src/music/groupLibrary.test.ts
 */
export {};
const assert = require('node:assert');

// ── 复制的实现（与 packages/renderer/src/lib/groupLibrary.ts 同步） ──────
type MusicProvider = 'qq' | 'netease' | 'spotify' | 'deezer';

interface UnifiedSearchItem {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
  sources: Array<{ platform: MusicProvider; trackId: string }>;
  likedPlatforms?: MusicProvider[];
  bestSource?: MusicProvider | null;
}

interface LibraryGroup {
  key: string;
  representative: UnifiedSearchItem;
  representativeIndex: number;
  members: Array<{ item: UnifiedSearchItem; index: number }>;
  platforms: MusicProvider[];
}

const DURATION_TOL_SEC = 12;
const BADGE_ORDER: MusicProvider[] = ['qq', 'netease', 'spotify', 'deezer'];

function likedPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  const list = item.likedPlatforms ?? item.sources.map((s) => s.platform);
  const set = new Set(list);
  return BADGE_ORDER.filter((p) => set.has(p));
}

function stripForFuzzy(s: string): string {
  return s
    .replace(/[（(【[][^)）\]】]*[)）\]】]/g, '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-_,.·&+/!?！？:：;；'"’”‘“()（）[\]【】]+/g, '')
    .toLowerCase();
}

function normalizeNoStrip(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-_,.·&+/!?！？:：;；'"’”‘“()（）[\]【】]+/g, '')
    .toLowerCase();
}

function fuzzyKey(title: string, artist: string): string {
  const t = stripForFuzzy(title) || normalizeNoStrip(title);
  return `${t}|${stripForFuzzy(artist)}`;
}

function artistPrefixMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

interface MutableGroup extends LibraryGroup {
  anchorDuration: number;
}

function groupLibraryItems(items: UnifiedSearchItem[]): LibraryGroup[] {
  const byFk = new Map<string, MutableGroup[]>();
  const order: MutableGroup[] = [];

  const enriched = items.map((item, index) => {
    const fullKey = fuzzyKey(item.title, item.artist);
    const sep = fullKey.indexOf('|');
    const titleKey = sep >= 0 ? fullKey.slice(0, sep) : fullKey;
    const artistKey = sep >= 0 ? fullKey.slice(sep + 1) : '';
    return { item, index, fullKey, titleKey, artistKey };
  });

  enriched.forEach((e) => {
    let bucket = byFk.get(e.fullKey);
    if (!bucket) {
      bucket = [];
      byFk.set(e.fullKey, bucket);
    }
    const g = bucket.find(
      (grp) =>
        !(grp.anchorDuration > 0 && e.item.duration > 0) ||
        Math.abs(grp.anchorDuration - e.item.duration) <= DURATION_TOL_SEC,
    );
    if (g) {
      g.members.push({ item: e.item, index: e.index });
      if (!(g.anchorDuration > 0) && e.item.duration > 0) {
        g.anchorDuration = e.item.duration;
      }
    } else {
      const fresh: MutableGroup = {
        key: `${e.fullKey}#${bucket.length}`,
        representative: e.item,
        representativeIndex: e.index,
        members: [{ item: e.item, index: e.index }],
        platforms: [],
        anchorDuration: e.item.duration,
      };
      bucket.push(fresh);
      order.push(fresh);
    }
  });

  for (let i = 0; i < order.length; i++) {
    const anchor = order[i];
    if (!anchor) continue;
    const aFk = fuzzyKey(anchor.representative.title, anchor.representative.artist);
    const aSep = aFk.indexOf('|');
    const aTitle = aSep >= 0 ? aFk.slice(0, aSep) : aFk;
    const aArtist = aSep >= 0 ? aFk.slice(aSep + 1) : '';
    for (let j = i + 1; j < order.length; j++) {
      const cand = order[j];
      if (!cand) continue;
      const cFk = fuzzyKey(cand.representative.title, cand.representative.artist);
      const cSep = cFk.indexOf('|');
      const cTitle = cSep >= 0 ? cFk.slice(0, cSep) : cFk;
      const cArtist = cSep >= 0 ? cFk.slice(cSep + 1) : '';
      if (aTitle !== cTitle) continue;
      if (!artistPrefixMatch(aArtist, cArtist)) continue;
      const durA = anchor.anchorDuration;
      const durC = cand.anchorDuration;
      if (durA > 0 && durC > 0 && Math.abs(durA - durC) > DURATION_TOL_SEC) continue;
      anchor.members.push(...cand.members);
      if (!(anchor.anchorDuration > 0) && durC > 0) {
        anchor.anchorDuration = durC;
      }
      order[j] = null as unknown as MutableGroup;
    }
  }
  const mergedOrder = order.filter((g): g is MutableGroup => g !== null);

  for (const g of mergedOrder) {
    const rep = g.members.reduce((best, m) => {
      const bc = best.item.coverUrl ? 1 : 0;
      const mc = m.item.coverUrl ? 1 : 0;
      if (mc !== bc) return mc > bc ? m : best;
      return m.item.title.length < best.item.title.length ? m : best;
    }, g.members[0]);
    g.representative = rep.item;
    g.representativeIndex = rep.index;

    const set = new Set<MusicProvider>();
    for (const m of g.members) {
      for (const p of likedPlatforms(m.item)) set.add(p);
    }
    g.platforms = BADGE_ORDER.filter((p) => set.has(p));
  }

  return mergedOrder;
}

// ── 测试 ──────────────────────────────────────────────────────────────

function item(opts: {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  sources?: Array<{ platform: MusicProvider; trackId: string }>;
  likedPlatforms?: MusicProvider[];
}): UnifiedSearchItem {
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

function main() {
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

  // ── 2. prefix 启发合并：Lydia F.I.R. vs F.I.R.飞儿乐团 ─────────
  {
    const groups = groupLibraryItems([
      item({ id: 'l-qq', title: 'Lydia', artist: 'F.I.R.飞儿乐团', duration: 238, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'l-ne', title: 'Lydia', artist: 'F.I.R.', duration: 239, sources: [{ platform: 'netease', trackId: 'n1' }, { platform: 'spotify', trackId: 's1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'F.I.R./F.I.R.飞儿乐团 同人异名应合并');
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      '合并后 platforms = 3 平台并集',
    );
    console.log('✅ 2. prefix 启发合并（F.I.R. / F.I.R.飞儿乐团）');
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

  // ── 4. likedPlatforms 透到组级 platforms（核心修复） ─────────
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
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(
      groups[0].platforms.sort(),
      ['netease', 'qq', 'spotify'],
      'groups[0].platforms = likedPlatforms 并集（替代 sources，反映运行 ❤）',
    );
    console.log('✅ 4. likedPlatforms 透到组级 platforms（核心修复）');
  }

  // ── 5. 不合并：title 不同 ─────────────────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: '晴天', artist: '周杰伦', duration: 270, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: '稻香', artist: '周杰伦', duration: 220, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, '不同 title 不合并');
    console.log('✅ 5. 不同 title 不合并（基线）');
  }

  // ── 6. 前缀包含 jay/jaye 合并 ─────────────────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'jay', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'jaye', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, '"jay" ⊂ "jaye" prefix 应合并');
    console.log('✅ 6. 前缀包含 jay/jaye 合并');
  }

  // ── 7. 短名（A vs ABC）拒绝合并（防误并） ──────────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'A', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'ABC', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, '短名 "A" (1 字符) 不应合并到 "ABC"');
    console.log('✅ 7. 短名拒绝合并（防误并）');
  }

  // ── 8. 跨 fuzzyKey 但字符颠倒不合并（jay vs tom） ─────────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'jay', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'tom', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, '无关前缀不合并');
    console.log('✅ 8. 无关前缀不合并');
  }

  // ── 9. likedPlatforms 单函数行为 ─────────────────────────────
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
    console.log('✅ 9. likedPlatforms 单函数行为正确');
  }

  // ── 10. 时长差超容差 → 不合并（即使 prefix 命中） ────────
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'F.I.R.', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      // 同 prefix 但时长差 30s，远超 12s 容差
      item({ id: 'b', title: 'Song', artist: 'F.I.R.飞儿乐团', duration: 230, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, 'prefix 命中但时长差超容差 → 不合并');
    console.log('✅ 10. 时长差超容差不合并（防版本误并）');
  }

  console.log('\n🎉 groupLibrary.test 全部 10 项通过');
}

main();
