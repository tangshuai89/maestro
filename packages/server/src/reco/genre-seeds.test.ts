/**
 * 意图检索种子白盒测试（specs/nl-intent-retrieval/ Phase A + C）。
 *
 * 覆盖：
 *   1. normalizeGenreKey —— 中英文别名归一（jazz / 爵士 / 爵士乐 → 同一 key）
 *   2. genreArtists —— 映射表命中 / 未收录流派返回空
 *   3. buildIntentSeeds —— 种子优先级、去重、条数上限、styleDirective 判定
 *   4. parseTrackRef —— "歌名 - 艺人" 拆分
 */
export {};

const assert = require('node:assert');
const {
  buildIntentSeeds,
  genreArtists,
  normalizeGenreKey,
  parseTrackRef,
  MAX_INTENT_ARTIST_SEEDS,
} = require('./genre-seeds');

// ── 1. normalizeGenreKey ────────────────────────────────
{
  assert.strictEqual(normalizeGenreKey('jazz'), 'jazz');
  assert.strictEqual(normalizeGenreKey('爵士'), 'jazz');
  assert.strictEqual(normalizeGenreKey('爵士乐'), 'jazz');
  assert.strictEqual(normalizeGenreKey(' Jazz '), 'jazz');
  assert.strictEqual(normalizeGenreKey('电子乐'), 'electronic');
  assert.strictEqual(normalizeGenreKey('city pop'), 'citypop');
  // 未收录的流派保留归一后的原串（不崩、不丢）
  assert.strictEqual(normalizeGenreKey('Afrobeat'), 'afrobeat');
  assert.strictEqual(normalizeGenreKey(''), '');
  console.log('  ✓ normalizeGenreKey: 中英文别名归一 / 未知流派保留');
}

// ── 2. genreArtists ─────────────────────────────────────
{
  const jazz = genreArtists('jazz');
  assert.ok(jazz.length > 0, 'jazz 有代表艺人');
  assert.ok(jazz.includes('Miles Davis'), 'Miles Davis 在 jazz 列表里');
  // 三种写法命中同一份列表
  assert.deepStrictEqual(genreArtists('爵士乐'), jazz);
  assert.deepStrictEqual(genreArtists('爵士'), jazz);
  // 未收录流派 → 空数组（不抛）
  assert.deepStrictEqual(genreArtists('hyperpop'), []);
  assert.deepStrictEqual(genreArtists(''), []);
  // 冷门流派（2026-10-23 补录：LLM 提过 afrobeat，但代码映射表当时没有）
  assert.ok(genreArtists('afrobeat').length > 0, 'afrobeat 有代表艺人');
  console.log('  ✓ genreArtists: jazz 命中 / 别名一致 / 未知流派空');
}

// ── 3. parseTrackRef ────────────────────────────────────
{
  assert.deepStrictEqual(parseTrackRef('Take Five - Dave Brubeck'), {
    title: 'Take Five',
    artist: 'Dave Brubeck',
  });
  assert.deepStrictEqual(parseTrackRef('光辉岁月 - Beyond'), {
    title: '光辉岁月',
    artist: 'Beyond',
  });
  // 只有歌名 → artist 空（调用方再搜一次解析）
  assert.deepStrictEqual(parseTrackRef('光辉岁月'), { title: '光辉岁月', artist: '' });
  assert.deepStrictEqual(parseTrackRef(''), { title: '', artist: '' });
  console.log('  ✓ parseTrackRef: 带艺人 / 纯歌名 / 空');
}

// ── 4. buildIntentSeeds ─────────────────────────────────
{
  const base = {
    mood: '放松',
    genres: [],
    tempo: 'any',
    language: 'any',
    similar_artists: [],
    similar_tracks: [],
    exclude_artists: [],
    exclude_genres: [],
    genre_artists: [],
    target_count: 12,
    rationale: '',
  };

  // 4a. 纯流派 → 映射表兜底出种子，styleDirective = true
  const s1 = buildIntentSeeds({ ...base, genres: ['jazz'] });
  assert.strictEqual(s1.styleDirective, true);
  assert.ok(s1.artists.length > 0, 'jazz 有种子艺人');
  assert.ok(
    s1.artists.some((a) => a.includes('Miles Davis')),
    'Miles Davis 进种子',
  );

  // 4b. LLM 提的 genre_artists 优先于映射表；该流派已被 LLM 覆盖时映射表**不重复补**
  const s2 = buildIntentSeeds({
    ...base,
    genres: ['jazz'],
    genre_artists: [{ genre: 'jazz', artists: ['自定义爵士人', '另一个爵士人'] }],
  });
  assert.strictEqual(s2.artists[0], '自定义爵士人', 'LLM 提的代表艺人排第一');
  assert.strictEqual(s2.artists.length, 2, 'LLM 覆盖该流派后不再补映射表');
  assert.ok(
    !s2.artists.some((a) => a.includes('Miles Davis')),
    'LLM 已覆盖 jazz → 不再塞映射表的 Miles Davis',
  );

  // 4c. similar_artists 优先级最高（用户点名的）
  const s3 = buildIntentSeeds({
    ...base,
    genres: ['jazz'],
    similar_artists: ['Chet Baker'],
  });
  assert.strictEqual(s3.artists[0], 'Chet Baker');

  // 4d. 去重：同名（大小写/空格差异）只留一个
  const s4 = buildIntentSeeds({
    ...base,
    similar_artists: ['Chet Baker', 'chet  baker', 'CHET BAKER'],
  });
  assert.strictEqual(s4.artists.length, 1, '同名只留一个');

  // 4e. similar_tracks 能拆出艺人 → 进种子；纯歌名 → 进 tracks 列表
  const s5 = buildIntentSeeds({
    ...base,
    similar_tracks: ['Take Five - Dave Brubeck', '光辉岁月'],
  });
  assert.ok(s5.artists.includes('Dave Brubeck'), '参考曲目的艺人进种子');
  assert.deepStrictEqual(s5.tracks, ['光辉岁月'], '只有歌名的进 tracks 待解析');
  assert.strictEqual(s5.styleDirective, true);

  // 4f. 只写 exclude_* → **不**切风格模式（排除是减法，不改检索方向）
  const s6 = buildIntentSeeds({ ...base, exclude_artists: ['周杰伦'] });
  assert.strictEqual(s6.styleDirective, false);
  assert.strictEqual(s6.artists.length, 0);

  // 4g. 种子条数有上限（别把平台搜爆）
  const many = buildIntentSeeds({
    ...base,
    similar_artists: Array.from({ length: 20 }, (_, i) => `Artist ${i}`),
  });
  assert.strictEqual(many.artists.length, MAX_INTENT_ARTIST_SEEDS);

  console.log('  ✓ buildIntentSeeds: 映射兜底 / LLM 优先 / 去重 / 排除不切模式 / 上限');
}

// ── 5. 回归：intent 缺 genre_artists 字段（旧客户端 payload）不能炸 ──
{
  const old = {
    mood: 'x',
    genres: ['rock'],
    tempo: 'any',
    language: 'any',
    similar_artists: [],
    similar_tracks: [],
    exclude_artists: [],
    exclude_genres: [],
    target_count: 12,
    rationale: '',
  };
  const s = buildIntentSeeds(old);
  assert.strictEqual(s.styleDirective, true);
  assert.ok(s.artists.length > 0, '旧 payload 也拿得到映射表种子');
  console.log('  ✓ buildIntentSeeds: 旧 payload（无 genre_artists）不炸');
}

console.log('\n✅ genre-seeds: all tests passed');
