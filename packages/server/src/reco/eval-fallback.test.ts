/**
 * 「LLM 没给锚点」时的**确定性兜底**路径（specs/nl-intent-retrieval/）。
 *
 * ## 为什么单独一个文件
 *
 * 离线回放评测（L1，`eval-offline.ts`）的 12 个场景，种子**全是 fixture 里
 * 录下来的 LLM 代表艺人** ⇒ `GENRE_ARTIST_MAP` 这条「零 token、LLM 偷懒 /
 * 超时 / 没给流派艺人时**唯一能用的**确定性兜底」在端到端评测里**一次都没走到**。
 *
 * 实测过这个盲区有多大：把整张 jazz 映射表换成不存在的艺人，
 * 离线评测照样 100% 通过、exit 0 —— 门禁对这条路径**完全没有判据**。
 *
 * ## 为什么不用 fixture 回放这条路径
 *
 * fixture 的 `search` 是**按艺人名做 key** 的，只录了当时 LLM 给的那批艺人。
 * 兜底路径用的是**另一批**艺人 → 录制数据里没有它们的搜索结果 → 回放出来的
 * 池子必然残缺 → 会报出一堆**假红**（实测 8/12 个变体红）。
 * ⇒ 门禁噪音比漏判更糟（spec §风险与局限：经常假红，人就会开始忽略它）。
 *
 * ⇒ 这条路径改用**合成数据 + 真代码**测：假 provider 的搜索结果按
 * `genreArtists(genre)` 现造（跟着映射表走），**判据**用**独立的**黄金集
 * （`genre-golden.json`，人工标注、冻结进仓库，与映射表无关）。
 *
 * ## 关键设计：测真身，不测副本
 *
 * 种子由**真的** `buildIntentSeeds` 算（不是自己抄一份"流派 → 艺人"），
 * 候选池由**真的** `RecoService.buildPool` 建。抄一份的话，改坏了真身它照样绿。
 *
 * ## 两条不变量
 *
 * - **INV-1（行为）**：空锚点意图 → 种子 = 映射表该流派的艺人 → 候选池被这些
 *   种子主导 → 7 条池不变量全过。
 * - **INV-2（数据一致性）**：映射表里**被黄金集标注过**的艺人，其标签必须与
 *   该流派相容（`resolveGenreTag` 归一后相等）。
 *   ⚠️ 黄金集**没覆盖**的艺人放行 —— 「没标注」不等于「标错」。
 *   这条是 INV-1 的**反向验证载体**：把 jazz 的映射改成一位黄金集里标成别的
 *   流派的艺人 → INV-2 必须变红（否则这条测试就是摆设）。
 */
export {};

const assert = require('node:assert');
const { RecoService } = require('./reco.service');
const { buildIntentSeeds, genreArtists, resolveGenreTag } = require('./genre-seeds');
const { buildFallbackIntent } = require('./eval-offline');
const { checkPoolInvariants, createPoolProbe, invariantsPass } = require('./eval-invariants');
const { DEFAULT_GENRE_SCENARIOS } = require('./eval-genre');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const golden = require('./__fixtures__/genre-golden.json');

/** 造一条可进候选池的搜索结果（要带 bestSource，候选池才会收）。 */
function mkItem(title: string, artist: string, duration = 200): any {
  return {
    id: `${artist}-${title}`,
    title,
    artist,
    album: '',
    coverUrl: '',
    duration,
    sources: [{ platform: 'qq', trackId: 'x' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
  };
}

/** 黄金集：'标题|艺人' → 流派标签[]。整理成「艺人 → 归一后的流派集合」。 */
function goldenByArtist(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, tags] of Object.entries(golden as Record<string, string[]>)) {
    const parts = key.split('|');
    const artist = parts[1] ?? '';
    if (!artist) continue;
    if (!out.has(artist)) out.set(artist, new Set<string>());
    for (const t of tags) {
      const norm = resolveGenreTag(t);
      if (norm) out.get(artist)!.add(norm);
    }
  }
  return out;
}

/**
 * 黄金集里每位艺人**真实存在**的曲目（标题）。
 *
 * ⚠️ 这是本测试的**外部真源**：假 provider 只认识黄金集里出现过的人。
 *   ⇒ 映射表指向一位黄金集里没有的艺人（= 编出来的 / 平台搜不到的人）时，
 *   池子必然捞不满 → 种子块不变量变红。
 *   ⚠️ 如果假 provider 按**映射表**现造数据，这条判据就是循环的
 *   （实测：把 jazz 映射改成不存在的艺人，测试照样全绿）。
 */
function goldenTitlesByArtist(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of Object.keys(golden as Record<string, string[]>)) {
    const parts = key.split('|');
    const title = parts[0] ?? '';
    const artist = parts[1] ?? '';
    if (!title || !artist) continue;
    if (!out.has(artist)) out.set(artist, []);
    out.get(artist)!.push(title);
  }
  return out;
}

/** 评测关心的流派集合（从场景定义里取 —— 那是判据，不是数据）。 */
function evaluatedGenres(): string[] {
  const set = new Set<string>();
  for (const s of DEFAULT_GENRE_SCENARIOS) {
    for (const g of s.expect ?? []) set.add(g);
  }
  return [...set];
}

async function main(): Promise<void> {
  // ── INV-1（行为）：空锚点 → 种子来自映射表 → 池被种子主导 ──────
  {
    const genre = 'jazz';
    const intent = buildFallbackIntent(genre, 12);
    assert.strictEqual(intent.genre_artists.length, 0, '兜底场景的前提：LLM **没给**流派代表艺人');

    const seeds = buildIntentSeeds(intent);
    assert.ok(seeds.artists.length > 0, '空锚点时必须有兜底种子（映射表兜底）');
    assert.ok(seeds.styleDirective, '有流派 → 必须仍算风格指令（intent 模式）');

    const mapArtists = genreArtists(genre);
    assert.ok(
      seeds.artists.every((a: string) => mapArtists.includes(a)),
      `兜底种子必须来自映射表：${seeds.artists.join('、')}`,
    );
    console.log('  ✓ 空锚点 → 种子来自映射表（buildIntentSeeds 真身）');

    // ── INV-2a（严格）：**每一位**兜底种子都必须在黄金集里被独立标成 jazz ──
    //
    // 为什么严格到 100%：池子不变量 `seed-artists-contribute` 是**容忍**少数
    // 种子没产出的（"单个别冷门艺人没有曲目属正常"）→ 只把一位种子换成
    // **平台搜不到的人**，池子照样能凑满 → 那条不变量不会红。
    // 实测：jazz 映射里把 Miles Davis 换成不存在的艺人 → 池子 17 首、5 位艺人
    // → 不变量全绿 → 门禁对这条路径**完全没有判据**。
    //
    // 黄金集是**独立的人工标注**（与映射表无关）→ 用它当"这位艺人真的存在、
    // 而且确实是 jazz"的外部真源。
    const byArtist = goldenByArtist();
    const unverified = seeds.artists.filter((a: string) => {
      const tags = byArtist.get(a);
      return !tags || !tags.has(genre);
    });
    assert.deepStrictEqual(
      unverified,
      [],
      `这些兜底种子在黄金集里没有被独立标成 ${genre}：${unverified.join('、')}` +
        `\n   → 映射表指向了平台搜不到 / 流派不对的人。新增映射表艺人时，` +
        `要在 genre-golden.json 里登记它的曲目与流派标签。`,
    );
    console.log(`  ✓ ${seeds.artists.length} 位兜底种子全部在黄金集里被独立标成 ${genre}`);

    // 假 provider：**只认识黄金集里出现过的人**（外部真源）——
    // 映射表指向一位黄金集里没有的艺人时，这里返回空 → 池子捞不满 → 变红。
    const titlesByArtist = goldenTitlesByArtist();
    const probe = createPoolProbe();
    const music = {
      getLibrary: () => null,
      searchUnified: async (_s: unknown, kw: string) => ({
        items: (titlesByArtist.get(kw) ?? []).map((t) => mkItem(t, kw)),
      }),
      findRelatedArtists: async (_s: unknown, _a: string) => [],
      fetchRecoRadioCandidates: async () => [],
    };
    const svc = new RecoService(
      { get: () => undefined } as never,
      { get: () => undefined, set: () => {} } as never,
      { resolve: () => ({ id: 'fallback' }) } as never,
      music as never,
    );
    const built = await svc['buildPool'](
      { id: 'fallback' } as never,
      { size: 0, signature: 'fallback', artists: [], anchors: [], seeds: [] } as never,
      [] as never,
      [] as never,
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: seeds },
    );
    const pool = built.pool.candidates;
    assert.ok(pool.length > 0, '兜底路径也必须能建出候选池');
    const poolArtists = [...new Set(pool.map((c: any) => c.artist))];
    assert.ok(
      poolArtists.every((a: string) => seeds.artists.includes(a)),
      `候选池必须由种子主导（不该混进口味档案 / 平台 FM）：${poolArtists.join('、')}`,
    );
    console.log(`  ✓ 候选池由兜底种子主导（${pool.length} 首 / ${poolArtists.length} 位艺人）`);

    const inv = checkPoolInvariants({
      ...probe,
      candidates: pool.map((c: any) => ({ title: c.title, artist: c.artist, origin: c.origin })),
      deepDivedArtists: built.pool.deepDivedArtists ?? [],
      seeds: seeds.artists,
      excluded: [],
      requestedCount: 12,
    });
    assert.ok(
      invariantsPass(inv),
      `兜底路径的池不变量应全过：\n${inv
        .filter((r: any) => !r.pass)
        .map((r: any) => `  ✗ ${r.id}：${r.detail}`)
        .join('\n')}`,
    );
    console.log('  ✓ 兜底路径的 7 条池不变量全过');
  }

  // ── INV-2（数据一致性）：映射表与黄金集不能互相打脸 ─────────────
  //
  // 这是 INV-1 的**反向验证载体**：把某流派的映射改成一位黄金集里标成别的
  // 流派的艺人 → 这里必须变红。
  {
    const byArtist = goldenByArtist();
    const problems: string[] = [];
    for (const genre of evaluatedGenres()) {
      for (const artist of genreArtists(genre)) {
        const tags = byArtist.get(artist);
        // 黄金集没覆盖这位艺人 → 放行（「没标注」不等于「标错」）
        if (!tags || !tags.size) continue;
        if (!tags.has(genre)) {
          problems.push(
            `「${genre}」的映射表里有 ${artist}，但黄金集把它标成 ${[...tags].join('/')}`,
          );
        }
      }
    }
    assert.strictEqual(
      problems.length,
      0,
      `映射表与黄金集不一致：\n  - ${problems.join('\n  - ')}`,
    );
    console.log('  ✓ 映射表里的艺人与黄金集的流派标注一致');
  }

  console.log('\n✅ eval-fallback: 兜底路径（LLM 没给锚点）全部通过');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
