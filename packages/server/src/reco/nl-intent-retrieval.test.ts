/**
 * 意图驱动检索白盒测试（specs/nl-intent-retrieval/ Phase C）。
 *
 * 覆盖：
 *   1. buildPool（intent 模式）—— 种子艺人进池、口味艺人**不进**池、FM 不被调用
 *   2. buildPool（intent 模式 + 候选不足）—— 口味艺人兜底追加到**队尾**
 *   3. buildPool（普通模式回归）—— 口味主干照旧进池、FM 照旧被调用
 *   4. buildSelectPrompt（intent 模式）—— 「本次要求」置顶、口味档案移除
 *   5. buildSelectPrompt（普通模式回归）—— 口味档案照旧在 prompt 里
 */
export {};

const assert = require('node:assert');
const { RecoService } = require('./reco.service');

/** 造一条可进候选池的搜索结果（要带 bestSource，候选池才会收）。 */
function mkItem(title: string, artist: string): any {
  return {
    id: `${artist}-${title}`,
    title,
    artist,
    album: `${artist} Album`,
    coverUrl: '',
    duration: 200,
    sources: [{ platform: 'qq', trackId: 'x' }],
    bestSource: 'qq',
    versionType: 'studio',
    versions: [],
  };
}

/** 记录所有搜索/电台调用的 musicService stub。 */
function makeMusic(log: { searched: string[]; radio: number; related: string[] }) {
  return {
    getLibrary: () => null,
    searchUnified: async (_s: any, kw: string) => {
      log.searched.push(kw);
      return { items: [mkItem(`${kw} Song A`, kw), mkItem(`${kw} Song B`, kw)] };
    },
    findRelatedArtists: async (_s: any, artist: string) => {
      log.related.push(artist);
      return [];
    },
    fetchRecoRadioCandidates: async () => {
      log.radio++;
      return [];
    },
  };
}

function makeService(log: { searched: string[]; radio: number; related: string[] }) {
  const fakeStorage = { get: () => undefined, set: () => {} };
  const fakeSessionService = { resolve: () => ({ id: 's1' }) };
  const fakeConfig = { get: () => undefined };
  return new RecoService(fakeConfig, fakeStorage, fakeSessionService, makeMusic(log) as any);
}

const PROFILE = {
  size: 100,
  signature: 'x',
  artists: [
    { name: '陈奕迅', key: '陈奕迅', songs: 30, signal: 0, weight: 30 },
    { name: '汪苏泷', key: '汪苏泷', songs: 20, signal: 0, weight: 20 },
  ],
  anchors: ['陈奕迅', '汪苏泷'],
  seeds: [
    {
      title: '明天快乐',
      artist: '陈奕迅',
      album: '',
      coverUrl: '',
      duration: 200,
      sources: [],
      bestSource: 'qq',
      versionType: 'studio',
      versions: [],
    } as any,
  ],
};

const SESSION = { id: 's1' } as any;

async function main() {
  // ── 1. intent 模式：种子艺人进池、口味艺人不进、FM 不调用 ──────
  {
    const log = { searched: [] as string[], radio: 0, related: [] as string[] };
    const svc = makeService(log);
    const built = await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [],
      2, // count=2：intent 池够用 → 不触发口味兜底（兜底见用例 2）
      undefined,
      undefined,
      {},
      {
        intentSeeds: {
          artists: ['Miles Davis', 'John Coltrane'],
          tracks: [],
          styleDirective: true,
        },
      },
    );
    const pool = built.pool;
    assert.ok(pool.candidates.length > 0, 'intent 模式捞到候选');
    assert.ok(
      pool.candidates.every((c: any) => /Miles Davis|John Coltrane/.test(c.artist)),
      '候选全部来自 intent 种子艺人',
    );
    assert.ok(
      !log.searched.includes('陈奕迅') && !log.searched.includes('汪苏泷'),
      `口味主干不该被搜索（实际搜了：${log.searched.join(', ')}）`,
    );
    assert.strictEqual(log.radio, 0, 'intent 模式不拉私人 FM');
    console.log('  ✓ intent 模式: 种子进池 / 口味不进 / 不拉 FM');
  }

  // ── 2. intent 模式 + 候选不足 → 口味兜底追加到队尾 ──────────
  {
    const log = { searched: [] as string[], radio: 0, related: [] as string[] };
    const svc = makeService(log);
    // 种子艺人搜不到歌（搜索返回空）→ 池子空 → 触发兜底
    const music = svc['musicService'] as any;
    music.searchUnified = async (_s: any, kw: string) => {
      log.searched.push(kw);
      if (kw === 'Miles Davis') return { items: [mkItem('So What', 'Miles Davis')] };
      return { items: [mkItem(`${kw} Song A`, kw), mkItem(`${kw} Song B`, kw)] };
    };
    const built = await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [],
      12, // count=12，intent 池只有 1 条 → 不足
      undefined,
      undefined,
      {},
      { intentSeeds: { artists: ['Miles Davis'], tracks: [], styleDirective: true } },
    );
    const pool = built.pool;
    assert.ok(pool.candidates.length > 0, '兜底后有候选');
    assert.strictEqual(pool.candidates[0].artist, 'Miles Davis', '风格候选排在最前');
    assert.ok(
      pool.candidates.some((c: any) => c.artist === '陈奕迅'),
      '口味候选被追加进来（队尾兜底）',
    );
    const tasteIdx = pool.candidates.findIndex((c: any) => c.artist === '陈奕迅');
    const jazzIdx = pool.candidates.findIndex((c: any) => c.artist === 'Miles Davis');
    assert.ok(jazzIdx < tasteIdx, '风格候选在口味候选之前');
    assert.strictEqual(log.radio, 0, '兜底也不拉 FM');
    console.log('  ✓ intent 兜底: 口味候选追加到队尾 / 仍不拉 FM');
  }

  // ── 2b. 冷门流派（无种子）→ 仍是 intent 模式（不拉 FM），池退回口味艺人 ──
  {
    const log = { searched: [] as string[], radio: 0, related: [] as string[] };
    const svc = makeService(log);
    await svc['buildPool'](
      SESSION,
      PROFILE as any,
      [],
      [],
      3,
      undefined,
      undefined,
      {},
      // styleDirective=true 但 artists=[]（"afrobeat" 既没 LLM 提、映射表也没收录）
      { intentSeeds: { artists: [], tracks: [], styleDirective: true } },
    );
    assert.ok(log.searched.includes('陈奕迅'), '没种子时退回搜口味主干');
    assert.strictEqual(log.radio, 0, '冷门流派同样不拉 FM（prompt 与候选池判定必须一致）');
    console.log('  ✓ 冷门流派（无种子）: 退回口味池 / 仍不拉 FM');
  }

  // ── 2g. 池缓存命中路径（filterPoolByExclude）─────────────────
  //    连着建两次同一个池 → 第二次走缓存分支（那条路径以前从没被测到，
  //    coverage diff 门禁会判"新增行没被测到"）。
  {
    const svc = makeService({ searched: [], radio: 0, related: [] });
    const seeds = {
      artists: ['Miles Davis', 'John Coltrane', 'Chet Baker', 'Ella Fitzgerald'],
      tracks: [],
      styleDirective: true,
    };
    const first = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      {},
      { intentSeeds: seeds },
    );
    assert.ok(first.pool.candidates.length > 0, '第一次建池');
    const second = await svc['buildPool'](
      { id: 's1' } as any,
      PROFILE as any,
      [],
      [],
      12,
      undefined,
      undefined,
      {},
      { intentSeeds: seeds },
    );
    assert.strictEqual(second.cached, true, '第二次应命中池缓存');
    assert.ok(second.pool.candidates.length > 0, '缓存命中后仍有候选');
    console.log('  ✓ 池缓存命中路径: 第二次建池走缓存分支');
  }

  // ── 3. 普通模式回归：口味主干照旧、FM 照旧 ─────────────────
  {
    const log = { searched: [] as string[], radio: 0, related: [] as string[] };
    const svc = makeService(log);
    await svc['buildPool'](SESSION, PROFILE as any, [], [], 3, undefined, undefined, {});
    assert.ok(log.searched.includes('陈奕迅'), '普通模式仍搜口味主干');
    assert.strictEqual(log.radio, 1, '普通模式仍拉 FM');
    console.log('  ✓ 普通模式回归: 口味主干 + FM 行为不变');
  }

  // ── 4. select prompt（intent 模式）─────────────────────
  {
    const svc = makeService({ searched: [], radio: 0, related: [] });
    const candidates = [
      {
        title: 'So What',
        artist: 'Miles Davis',
        album: 'Kind of Blue',
        coverUrl: '',
        duration: 200,
        origin: 'artist',
      },
    ];
    const msgs = svc['buildSelectPrompt'](PROFILE as any, candidates as any, {
      count: 5,
      intentHints: ['心情/场景：放松', '风格标签：jazz'],
      intentMode: true,
    });
    const system = msgs[0].content;
    const user = msgs[1].content;
    assert.match(system, /本次要求优先/, '规则 2 改成"本次要求优先"');
    assert.match(user, /# 本次要求（最高优先级/, '本次要求段置顶');
    assert.doesNotMatch(user, /最常听的歌手/, 'intent 模式不带口味锚点');
    assert.doesNotMatch(user, /口味采样/, 'intent 模式不带口味采样');
    assert.ok(user.indexOf('本次要求') < user.indexOf('候选清单'), '本次要求段在候选清单之前');
    console.log('  ✓ select prompt (intent): 要求置顶 / 口味档案移除');
  }

  // ── 5. select prompt（普通模式回归）────────────────────
  {
    const svc = makeService({ searched: [], radio: 0, related: [] });
    const candidates = [
      {
        title: '明天快乐',
        artist: '陈奕迅',
        album: '',
        coverUrl: '',
        duration: 200,
        origin: 'artist',
      },
    ];
    const msgs = svc['buildSelectPrompt'](PROFILE as any, candidates as any, { count: 5 });
    const system = msgs[0].content;
    const user = msgs[1].content;
    assert.match(system, /口味优先/, '普通模式规则 2 不变');
    assert.match(user, /# 口味档案/, '普通模式仍带口味档案');
    assert.match(user, /最常听的歌手/, '普通模式仍带口味锚点');
    console.log('  ✓ select prompt (普通): 口味档案行为不变');
  }

  console.log('\n✅ nl-intent-retrieval: all tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
