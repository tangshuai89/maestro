/**
 * groupLibraryItems（renderer/src/lib/groupLibrary.ts）回归测试——白盒
 * 副本，inline 一份实现 + 测试用例。Renderer 与 server 共用 common 的
 * displayKey（@maestro/common），所以这里只测纯展示级聚类逻辑（不动 fuzzy
 * key 流水线本身，流水线测试在 common/src/normalizer.test.ts）。
 *
 * 跑：npx ts-node src/music/groupLibrary.test.ts
 */
export {};
const assert = require('node:assert');
const {
  artistLooseMatch,
  displayKey,
  extractVersionTag,
  normalizeKey,
  splitArtists,
  stageNameAliasMatch,
  stripParensContent,
  stripTrailingMeta,
  titleAliasKey,
} = require('@maestro/common');

// ── 复制的实现（与 packages/renderer/src/lib/groupLibrary.ts 同步） ──────
type MusicProvider = 'qq' | 'netease' | 'spotify' | 'deezer';
type VersionTag = 'LIVE' | 'ACOUSTIC' | 'REMIX' | 'INSTRUMENTAL' | 'COVER' | 'KARAOKE' | 'DEMO' | 'EDIT' | null;

interface UnifiedSearchItem {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
  sources: Array<{ platform: MusicProvider; trackId: string; url?: string }>;
  likedPlatforms?: MusicProvider[];
}

interface LibraryGroup {
  key: string;
  representative: UnifiedSearchItem;
  representativeIndex: number;
  members: Array<{ item: UnifiedSearchItem; index: number; versionTag: VersionTag }>;
  platforms: MusicProvider[];
  hasCover: boolean;
}

const BADGE_ORDER: MusicProvider[] = ['qq', 'netease', 'spotify', 'deezer'];

function likedPlatforms(item: UnifiedSearchItem): MusicProvider[] {
  const list = item.likedPlatforms ?? item.sources.map((s) => s.platform);
  const set = new Set(list);
  return BADGE_ORDER.filter((p) => set.has(p));
}

interface MutableGroup extends LibraryGroup {
  anchorDuration: number;
  artist: string;
  artistKey: string;
}

// splitArtists 来自 @maestro/common（与 renderer 同口径，含 × 分隔符）。

/** 弹窗分组的「艺人同人」判定：归一相等 / 策展别名整串 / 「artist·album」
 *  段段配对 / 多艺人拆分配对。 */
function artistsEquivalent(a: string, b: string): boolean {
  const na = normalizeKey(stripParensContent(a), '');
  const nb = normalizeKey(stripParensContent(b), '');
  if (na && nb && na === nb) return true;
  if (stageNameAliasMatch(a, b)) return true;
  // 「artist·album」/「artist, album」复合串段段配对（@maestro/common
  // `artistLooseMatch` 内部做：先整串 stageNameAliasMatch 再段段配对）。
  if (artistLooseMatch(a, b)) return true;
  const pa = splitArtists(a);
  const pb = splitArtists(b);
  if (pa.length < 2 && pb.length < 2) return false;
  let matched = 0;
  for (const x of pa) {
    for (const y of pb) {
      const nx = normalizeKey(stripParensContent(x), '');
      const ny = normalizeKey(stripParensContent(y), '');
      if ((nx && ny && nx === ny) || stageNameAliasMatch(x, y)) {
        matched++;
        break;
      }
    }
  }
  const need = Math.ceil(Math.max(pa.length, pb.length) / 2);
  return matched > 0 && matched >= need;
}

function groupLibraryItems(items: UnifiedSearchItem[]): LibraryGroup[] {
  // 2026-08-07 分两级 + 2026-08-14 stripTrailingMeta 品牌/CM/影视/录音版本
  //  尾缀宽容：
  //  1) title 桶：displayKey(stripTrailingMeta(title), '') 归一（剥括号/feat/
  //     简繁/大小写 + 品牌/CM/影视/录音版本元数据尾缀）+ titleAliasKey 等价类
  //  2) artist 判等：桶内 artistsEquivalent（归一相等 / 策展别名 / 段段配对 /
  //     多艺人拆分配对）；表外不同人拆开。
  const byTitle = new Map<string, MutableGroup[]>();
  const order: MutableGroup[] = [];

  const enriched = items.map((item, index) => ({
    item,
    index,
    titleKey: titleAliasKey(displayKey(stripTrailingMeta(item.title), '')),
    artistKey: normalizeKey(item.artist, ''),
    versionTag: extractVersionTag(item.title),
  }));

  // 同歌 + 同歌手全部合并到同一 group——无论版本（studio/live/remix/acoustic）
  // 与时长差（用户需求：同歌同歌手就是一首歌）。版本差异靠展开子行染色。
  for (const e of enriched) {
    const bucket = byTitle.get(e.titleKey);
    if (!bucket) byTitle.set(e.titleKey, []);
    const g = byTitle.get(e.titleKey)!.find((grp) =>
      artistsEquivalent(grp.artist, e.item.artist),
    );
    if (g) {
      g.members.push({ item: e.item, index: e.index, versionTag: e.versionTag });
      if (!(g.anchorDuration > 0) && e.item.duration > 0) {
        g.anchorDuration = e.item.duration;
      }
    } else {
      const fresh: MutableGroup = {
        key: `${e.titleKey}#${order.length}`,
        representative: e.item,
        representativeIndex: e.index,
        members: [{ item: e.item, index: e.index, versionTag: e.versionTag }],
        platforms: [],
        hasCover: e.versionTag === 'COVER',
        anchorDuration: e.item.duration,
        artist: e.item.artist,
        artistKey: e.artistKey,
      };
      byTitle.get(e.titleKey)!.push(fresh);
      order.push(fresh);
    }
  }

  for (const g of order) {
    if (!g) continue;
    // 代表：studio（versionTag=null）优先 → 有封面优先 → 标题最短 → COVER 排末。
    const rep = g.members.reduce((best, m) => {
      const bv = best.versionTag;
      const mv = m.versionTag;
      const bvIsStudio = bv === null;
      const mvIsStudio = mv === null;
      if (bvIsStudio !== mvIsStudio) return mvIsStudio ? m : best;
      const bc = best.item.coverUrl ? 1 : 0;
      const mc = m.item.coverUrl ? 1 : 0;
      if (mc !== bc) return mc > bc ? m : best;
      const bvIsCover = bv === 'COVER';
      const mvIsCover = mv === 'COVER';
      if (bvIsCover !== mvIsCover) return mvIsCover ? best : m;
      // 时长长优先（2026-08-07）：默认播原版/完整版——重录版通常更短，
      // 标题最短反而会选到重录版。
      const bd = best.item.duration > 0 ? best.item.duration : 0;
      const md = m.item.duration > 0 ? m.item.duration : 0;
      if (bd !== md) return md > bd ? m : best;
      return m.item.title.length < best.item.title.length ? m : best;
    }, g.members[0]);
    g.representative = rep.item;
    g.representativeIndex = rep.index;

    const set = new Set<MusicProvider>();
    let hasCover = false;
    for (const m of g.members) {
      if (m.versionTag === 'COVER') hasCover = true;
      for (const p of likedPlatforms(m.item)) set.add(p);
    }
    g.platforms = BADGE_ORDER.filter((p) => set.has(p));
    g.hasCover = hasCover;
  }

  return order;
}

// ── 测试 ────────────────────────────────────────────────────────────────

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

  // ── 2. likedPlatforms 透到组级 platforms + F.I.R. 策展别名合并 ──
  // 2026-08-07：分组升级为「同 title 桶 + 艺人归一相等或**策展别名表**命中
  // 合并」——F.I.R.飞儿乐团 与 F.I.R. 在 @maestro/common 别名表内（飛兒樂團:
  // ['F.I.R.']），是同一个人，合并到同 group。表外（Coldplay vs Cold）仍拆。
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
    // 同 title（Lydia）+ 别名表命中 → 合并 1 组；徽章取成员并集。
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
  // 旧版 5s 容差把 Remix/Acoustic 拆开；现在用户要求「同歌曲+同歌手全部
  // 合并」，版本差异靠展开子行 + versionTag 染色体现 → 不再按时长拆组。
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
  // displayKey 内 stripFeatTags 把 feat./ft./featuring 全部剥，所以
  // 「Song (feat. X)」与「Song」聚到同 group。
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
  // displayKey 内 cjkUnify 走 OpenCC tw→cn 折叠「龍捲風→龙卷风」
  // 「周杰倫→周杰伦」。
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
  // 之前用 `includes` 启发，「Coldplay vs Cold」「Taylor vs Taylor Swift」
  // 「Apple vs Apple Music」会被错并，徽章（likedPlatforms 并集）虚高。
  // 现在删除二级扫描，只走 displayKey + 时长聚类——这些 case 各自独立。
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
  // 之前 stripForFuzzy 漏 U+2014 em-dash，半角 `-` vs 全角 `—` 拆开。
  // displayKey step 3 把各种 dash 归一到 `-`，再过 noise strip → 同 key。
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song - Live', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song — Live', artist: 'X', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, 'B3 修复：半角 - vs 全角 — 归一合并');
    console.log('✅ 11. B3 修复：dash 变体归一（半角 / em-dash / en-dash）');
  }

  // ── 12. ★ B4 修复：(feat. A) vs (feat. B) 不误并 ────────────
  // 之前 stripForFuzzy 剥 feat 后两边都是「Song」 → 合并 → 错！
  // displayKey 同样剥 feat，但本 case 同 group 后还要求同平台记录一致——
  // 这里直接验「Song (feat. A)」与「Song (feat. B)」displayKey 不同
  // （stripFeatTags 把 feat 段剥掉，但括号形式吃掉了 A/B 信息 → 都剥为空
  // 字符串）。等等——实际上两边都剥成「Song」，displayKey 相同，应该合并。
  //
  // 真实线上：(feat. A) vs (feat. B) 是不同协奏版本，应该让用户在弹窗展开
  // 看到。但 displayKey 当前不区分 feat 后的人名。要解决此问题需要扩展
  // stripFeatTags 保留 feat 名作为二级 key——见 groupLibraryItems 的限制
  // 注释。短期内依赖 server mergeLibrary 把不同协奏版分到不同 item。
  //
  // 这条测试先记录**当前行为**：displayKey 同 → 聚 1 条 group（弹窗展开后
  // 用户能看到两条）。期望的「分 2 条」是 P2 目标，不在本测试覆盖。
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song (feat. A)', artist: 'X', duration: 200, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song (feat. B)', artist: 'X', duration: 200, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 1, '(feat. A) 与 (feat. B) displayKey 同 → 聚 1 条 group（依赖 server 拆分不同 item）');
    console.log('✅ 12. B4 当前行为：(feat. A/B) 聚到同 group，由 server 拆分不同协奏版本');
  }

  // ── 13. (Live) 与原版同歌同歌手 → 合并（2026-08-07 需求变更） ────
  // displayKey 剥括号让「Song」与「Song (Live)」落到同一 key；新需求要求
  // 同歌同歌手全部合并 → Live 与原版进同 group，展开子行标 LIVE 染色。
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
  // 2026-08-07 需求：弹窗里这两类要合并。走 @maestro/common 策展别名表
  // （stageNameAliasMatch），不做拼音/前缀模糊——Coldplay vs Cold 在 #9 已
  // 锁死为拆开。
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
  // 网易云「范逸臣」、QQ「【范逸臣 Van Fan】」（整体被【】包裹的格式标记）、
  // Spotify「Fan Yi Chen」。别名表 key 简体、值含繁体 + 英文；「汉字名同人」
  // 分支桥「范逸臣 Van Fan」混合串。用户实际场景：Missing You 三平台三首歌。
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
  // QQ 写混合串（含英文括号剥不掉），「汉字名同人」分支桥；Spotify 的
  // Lisa Ono 走表 values。
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
  // QQ「悲歌（애절가）」+ 网易云「悲歌」（繁体歌手）+ 网易云韩语版「애절가」
  // + OST 版「悲歌 (韩剧《茶母》OST)」（括号内含书名号，stripParensContent
  // 修复前会带出 ost 尾巴拆开）。titleAliasKey 把「애절가」归到「悲歌」桶；
  // artist 繁简 cjkUnify 统一；OST 括号整体剥掉。
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
  // 网易云纯片假名「ハンバート ハンバート」、QQ/Spotify 英文「Humbert Humbert」。
  // toRomaji 给 hanbato（规则读法）≠ Humbert（法语艺术化拼写），音译桥不上，
  // 策展表兜底。带片假名括号的写法 stripFuriganaParens 已归一相等。
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
  // 平台之一显示纯中文译名「今晚月色真好」。titleAlias 策展（日→中歌名
  // 翻译无算法），displayKey(title,'') 剥括号后归到「今晩はお月さん」桶。
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
  // Spotify 歌手 Keisuke Kuwata（罗马音，弹窗分组只信策展表）+ 网易云
  // 繁体歌手桑田佳祐 + 中文译名标题「明日会放晴么」（titleAlias）。
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
  // QQ「のぼる↑P / 初音未来 (初音ミク)」+ 网易云「のぼる↑ / 初音ミク」
  // + Spotify「Noboru」（单艺人）。多艺人拆分配对 + 表别名（のぼる↔Noboru、
  // 初音未来↔初音ミク）桥接。
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
  // Humbert Humbert 日が落ちるまで：QQ 原版 296s（标题带注释更长）vs
  // Spotify 2021 重录版 248s（标题更短）。折叠行默认应播 296s 原版。
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

  // ── 27. title 尾缀宽容：Spotify「- zerokoi ver.」/「- Remix」合并 ──
  // Spotify 偶尔给歌名加版本标签但不加括号（あの頃～ジンジンバオヂュオニー～ - zerokoi ver.）。
  // 剥常见版本尾缀再做分桶 → 同歌同艺人合并。
  // ── 28. 用户实测分裂修复（2026-08-14）：同名+同歌手多写法合并 ──
  // 爱的大逃杀：QQ「雀斑乐团」vs 网易云「雀斑」（表：雀斑樂團 含 '雀斑' 值）。
  // 花篝り：QQ「日本群星 (オムニバス)」vs 网易云「V.A.」（表：日本群星 含 V.A. 值）。
  // レイニブル：QQ「德永英明」vs Spotify「Hideaki Tokunaga」（表值拉丁词序无关）。
  // 归り道：QQ「乃木坂46」vs Spotify「Nogizaka46」（stageNameKey 保留数字）。
  // 満月の夜なら：QQ「あいみょん」vs 网易云「爱缪 (あいみょん)」（假名 key + 剥括号）。
  // 花のように：QQ「松隆子 (松たか子)」vs Spotify「Takako Matsu」（剥括号 + 表值）。
  // 川瀬智子 vs Tommy heavenly6（stageNameKey 日文新字体往返归一：瀬→濑→瀨）。
  {
    const cases: Array<{ title: string; artists: string[]; why: string }> = [
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
  // 弹窗原始场景：QQ+网易云「一百」by 李荣浩·黑马（QQ 字段带专辑）+ Spotify
  // 「一百 - 百事可乐品牌主题曲」by Ronghao Li·黑馬 拆成 2 组。两层修：
  //  (a) stripTrailingMeta 剥掉「 - 百事可乐品牌主题曲」（品牌/CM 元数据不在
  //      原 stripTrailingVersionSuffix 英文关键词表内）→ 两边 titleKey 同。
  //  (b) artistLooseMatch 按 `·` 切「李荣浩·黑马」→「李荣浩」+「黑马」，
  //      与「Ronghao Li·黑馬」→「Ronghao Li」+「黑馬」段对段再查别名表，
  //      「李榮浩」表项含 'Ronghao Li' → 命中。
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
  // 复合串段段配对后，「Coldplay·专辑」vs「Cold」也得拒判。pa=['Coldplay','专辑']
  // pb=['Cold'] → 段段配 stageNameAliasMatch → 表内无 → 不命中。
  {
    const groups = groupLibraryItems([
      item({ id: 'a', title: 'Song', artist: 'Coldplay·X&Y', duration: 260, sources: [{ platform: 'qq', trackId: 'q1' }] }),
      item({ id: 'b', title: 'Song', artist: 'Cold', duration: 260, sources: [{ platform: 'netease', trackId: 'n1' }] }),
    ]);
    assert.strictEqual(groups.length, 2, 'Coldplay·X&Y vs Cold（段段配对后）仍不合并');
    console.log('✅ 31. 段段配对铁律不破：Coldplay·X&Y vs Cold 仍拆开');
  }

  // ── 31.5. ★ 用户实测（2026-08-14 #2）：「古怪 (Live)」vs「古怪 - Live」 ──
  // 弹窗场景：QQ+网易云「古怪 (Live)」by 汪苏泷（QQ 字段带专辑「我是唱作人
  // 第2期」）+ Spotify「古怪 - Live」by Silence Wang（Spotify 把 Live 写进 title
  // dash 形式而不是括号；artist 同样把 album 拼成「·我是唱作人 第2期 (Live)」）。
  // 两层修：
  //  (a) `stripTrailingMeta` 新增 SUFFIX_BARE 路径剥「 - Live」（dash 裸版
  //      本关键词）→ Spotify 标题剥成「古怪」；QQ 走 `displayKey` 内的
  //      `stripParensContent` 剥「(Live)」括号也成「古怪」→ 两边 titleKey 同。
  //  (b) 「汪苏泷」表内繁体 key「汪蘇瀧」含 'Silence Wang' → 整串别名命中。
  //      + `·我是唱作人 第2期` 段段配对。
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
  // Spotify 罗马音「Motto」by aiko·May Dream（QQ 字段把 album 拼成
  // 「artist·album」复合串）vs QQ/网易云 平假名「もっと」by aiko。
  // 两层修：
  //  (a) `artistLooseMatch` 段段配对补 normalizeKey 相等：「aiko·May Dream」
  //      切「aiko」段对「aiko」段归一字面相等 → 命中（之前漏判：表 key 是
  //      あいこ，纯拉丁「aiko」stageNameKey 返回 null）。
  //  (b) 跨脚本：Motto（Latin）vs もっと（CJK）→ isCrossScript 命中。
  //  + titleAlias 表新增 motto ↔ もっと（防御性兜底，防跨脚本匹配漏判）。
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
    const cases: Array<[string, string, string]> = [
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
    // 用户核对后列入合并的 8 组（artistLooseMatch 必须命中）
    const mergePairs: Array<[string, string]> = [
      ['ChiliChill乐团', 'ChiliChill'], // 屑屑
      ['Roy Ayers', 'Roy Ayers Ubiquity'], // Everybody Loves The Sunshine
      ['Noel Gallagher', "Noel Gallagher's High Flying Birds"], // The Death Of You And Me
      ['久石让', '久石譲'], // Birthday (生辰) —— JP_KANJI 譲→让
      ['藤原樱 (藤原さくら)', '藤原さくら'], // Soup (汤)
      ['新裤子', '新裤子乐队'], // 别再问我什么是迪斯科
      ['悠木碧', 'ターニャ・デグレチャフ(CV:悠木碧)'], // Los! Los! Los!
      ['松本梨香', 'サトシ(CV:松本梨香) / Pikachu (Character Voice: Ikue Otani)'], // アローラ!!
    ];
    for (const [a, b] of mergePairs) {
      assert.strictEqual(artistLooseMatch(a, b), true, `应合并: ${a} vs ${b}`);
      assert.strictEqual(artistLooseMatch(b, a), true, `应合并(反向): ${b} vs ${a}`);
    }
    console.log(`✅ 33a. 8 组合并命中（双向 ${mergePairs.length * 2} 断言）`);
    // 防误并（「樂團」过宽 key 删除后的回归：Fine乐团 不再与任何 X乐团 误并）
    const rejectPairs: Array<[string, string]> = [
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
main();

