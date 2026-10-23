/**
 * L0 不变量门禁（specs/eval-driven-nl/ Phase A）。
 *
 * 关键设计：**测真实的 `buildPool`**，不另写一份实现。
 * 理由与 `scripts/coverage-diff-gate.js` 相同——自测里再写一份池构建的话，
 * 判据改坏了自测照样绿（测的是副本不是真身）。
 *
 * 覆盖：
 *   1. 健康场景 → 7 条不变量全过
 *   2. **反向验证**（A3）：故意把参数改坏 → 对应不变量必须变红
 *      —— 门禁是摆设的最常见失败模式是"它永远绿"
 *   3. 普通（非 intent）模式 → 不变量不适用（它测的是 intent 检索层）
 */
export {};

const assert = require('node:assert');
const { RecoService } = require('./reco.service');
const { buildCandidatePool } = require('./candidate-pool');
const {
  checkPoolInvariants,
  createPoolProbe,
  formatInvariantReport,
  invariantsPass,
} = require('./eval-invariants');

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

/** 每个艺人返回 n 首的 fake provider + 探针。 */
function makeFake(opts: { perArtist?: number; related?: string[] } = {}) {
  const probe = createPoolProbe();
  const perArtist = opts.perArtist ?? 10;
  const related = opts.related ?? [];
  const music = {
    getLibrary: () => null,
    searchUnified: async (_s: any, kw: string) => {
      probe.recordSearch(kw);
      return {
        items: Array.from({ length: perArtist }, (_, i) => mkItem(`${kw} S${i}`, kw)),
      };
    },
    findRelatedArtists: async (_s: any, artist: string) => {
      probe.recordSearch(`related:${artist}`);
      return related;
    },
    fetchRecoRadioCandidates: async () => {
      probe.recordRadio();
      return [];
    },
  };
  const svc = new RecoService(
    { get: () => undefined } as any,
    { get: () => undefined, set: () => {} } as any,
    { resolve: () => ({ id: 's1' }) } as any,
    music as any,
  );
  return { svc, probe, music };
}

const PROFILE = {
  size: 100,
  signature: 'x',
  artists: [],
  anchors: ['陈奕迅'],
  seeds: [],
};

const SEEDS = ['Miles Davis', 'John Coltrane', 'Chet Baker', 'Ella Fitzgerald'];

async function main() {
  // ── 1. 健康场景：7 条不变量全过 ──────────────────────
  {
    const { svc, probe } = makeFake({ perArtist: 10 });
    const built = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: { artists: SEEDS, tracks: [], styleDirective: true } },
    );
    const results = checkPoolInvariants({
      ...probe,
      candidates: built.pool.candidates,
      seeds: SEEDS,
      excluded: [],
      requestedCount: 12,
    });
    assert.ok(invariantsPass(results), `健康场景应全过：\n${formatInvariantReport(results)}`);
    // 顺带确认种子块真的填得满（否则第 6 条是"跳过"而不是"真过"）
    const fill = results.find((r: any) => r.id === 'seed-block-fills-request');
    assert.ok(!fill.detail.includes('跳过'), '种子块应真的填满请求，而不是走降级跳过');
    console.log('  ✓ 健康场景: 7 条不变量全过');
  }

  // ── 2. 反向验证：故意改坏，对应不变量必须变红 ──────────
  {
    // 2a. 种子被 anchorLimit 截断 → all-seeds-searched 红
    const pool = await buildCandidatePool(
      {
        searchArtist: async (a: string) => [mkItem(`${a} S`, a)] as any,
        findRelatedArtists: async () => [],
      },
      {
        anchors: SEEDS,
        library: [],
        // 只深挖 2 个 → 另 2 个种子没被搜
        anchorLimit: 2,
      },
    );
    const r = checkPoolInvariants({
      searchedArtists: ['Miles Davis', 'John Coltrane'],
      radioFetched: false,
      candidates: pool.candidates,
      seeds: SEEDS,
      excluded: [],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'all-seeds-searched');
    assert.strictEqual(hit.pass, false, '种子被截断 → all-seeds-searched 必须红');
    assert.match(hit.detail, /Chet Baker|Ella Fitzgerald/);
    console.log('  ✓ 反向验证 1: 种子被截断 → all-seeds-searched 红');
  }

  // 2b. 交错合并 → seed-block-first 红
  //     注意：只有 1 个种子时交错也看不出问题（种子仍在第 1 位）——
  //     必须 ≥2 个种子，交错才会把邻居插到种子**之间**。
  {
    const pool = await buildCandidatePool(
      {
        searchArtist: async (a: string) => [mkItem(`${a} S`, a)] as any,
        findRelatedArtists: async () => ['NeighborX'],
      },
      {
        anchors: ['Miles Davis', 'Chet Baker'],
        library: [],
        relatedPerAnchor: 1,
        // 交错合并（默认）→ 相邻艺人插到两个种子中间
      },
    );
    const r = checkPoolInvariants({
      searchedArtists: ['Miles Davis', 'Chet Baker', 'NeighborX'],
      radioFetched: false,
      candidates: pool.candidates,
      seeds: ['Miles Davis', 'Chet Baker'],
      excluded: [],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'seed-block-first');
    assert.strictEqual(hit.pass, false, '交错合并 → seed-block-first 必须红');
    console.log('  ✓ 反向验证 2: 交错合并 → seed-block-first 红');
  }

  // 2c. 拉了 FM → no-radio-in-intent-mode 红
  {
    const { svc, probe } = makeFake({ perArtist: 5 });
    const built = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: { artists: SEEDS, tracks: [], styleDirective: true } },
    );
    // 模拟"有人把 FM 拉回来了"：探针置位
    probe.recordRadio();
    const r = checkPoolInvariants({
      ...probe,
      candidates: built.pool.candidates,
      seeds: SEEDS,
      excluded: [],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'no-radio-in-intent-mode');
    assert.strictEqual(hit.pass, false, '拉了 FM → no-radio-in-intent-mode 必须红');
    console.log('  ✓ 反向验证 3: 拉了 FM → no-radio-in-intent-mode 红');
  }

  // 2d. 种子块填不满 → seed-block-fills-request 红
  {
    const { svc, probe } = makeFake({ perArtist: 2 });
    const built = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: { artists: SEEDS, tracks: [], styleDirective: true } },
    );
    const r = checkPoolInvariants({
      ...probe,
      candidates: built.pool.candidates,
      seeds: SEEDS,
      excluded: [],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'seed-block-fills-request');
    assert.strictEqual(hit.pass, false, '种子块填不满 → seed-block-fills-request 必须红');
    assert.match(hit.detail, /风格外补数/);
    console.log('  ✓ 反向验证 4: 种子块填不满 → seed-block-fills-request 红');
  }

  // 2e. 排除项漏进候选 → excluded-absent 红
  {
    const { svc, probe } = makeFake({ perArtist: 5 });
    const built = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: { artists: SEEDS, tracks: [], styleDirective: true } },
    );
    const r = checkPoolInvariants({
      ...probe,
      candidates: built.pool.candidates,
      seeds: SEEDS,
      excluded: ['Chet Baker'],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'excluded-absent');
    assert.strictEqual(hit.pass, false, '排除项漏进候选 → excluded-absent 必须红');
    console.log('  ✓ 反向验证 5: 排除项漏进候选 → excluded-absent 红');
  }

  // 2f. 种子一个候选都没有 → seed-block-fills-request **跳过**（不误报）
  {
    const { svc, probe } = makeFake({ perArtist: 0 });
    const built = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      { noCache: true },
      { intentSeeds: { artists: SEEDS, tracks: [], styleDirective: true } },
    );
    const r = checkPoolInvariants({
      ...probe,
      candidates: built.pool.candidates,
      seeds: SEEDS,
      excluded: [],
      requestedCount: 12,
    });
    const hit = r.find((x: any) => x.id === 'seed-block-fills-request');
    assert.strictEqual(hit.pass, true, '种子无候选属合法降级，不该判红');
    assert.match(hit.detail, /跳过/);
    console.log('  ✓ 反向验证 6: 种子无候选 → 合法降级，不误报');
  }

  // ── 3. 报告格式 ──────────────────────────────────────
  {
    const r = checkPoolInvariants({
      searchedArtists: [],
      radioFetched: true,
      candidates: [],
      seeds: ['X'],
      excluded: [],
      requestedCount: 12,
    });
    const text = formatInvariantReport(r);
    assert.match(text, /不变量门禁未通过/);
    assert.match(text, /✗/);
    console.log('  ✓ formatInvariantReport: 失败清单 + 抓的哪个 bug');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
