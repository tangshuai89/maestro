/**
 * NL playlist 解析逻辑白盒测试（Node built-in assert）。
 *
 * 覆盖（specs/nl-playlist/ Phase A + 风险）：
 *   1. buildParseIntentPrompt —— 库上下文 / 空库 / 边界
 *   2. extractJsonBlock —— <json>...</json> 包裹 / 裸 JSON / 失败
 *   3. parseIntentResponse —— 完整 / 缺字段 / enum 降级 / target_count clamp
 *   4. pickLibrarySample —— 去重 + 上限 50
 *   5. validateParseIntentInput —— 空 / 超 500
 */
export {};

const assert = require('node:assert');
const {
  buildParseIntentPrompt,
  extractJsonBlock,
  intentToPromptHints,
  normalizeIntentInput,
  parseIntentResponse,
  pickLibrarySample,
  validateParseIntentInput,
} = require('./nl-intent');

// ── 1. buildParseIntentPrompt ────────────────────────────
{
  // 空库 → 只 user 内容，没有"口味锚点"段
  const msgs = buildParseIntentPrompt('夜跑电子乐', []);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'system');
  assert.strictEqual(msgs[1].role, 'user');
  assert.match(msgs[1].content, /夜跑电子乐/);
  assert.doesNotMatch(msgs[1].content, /口味锚点/);

  // 有库 → 加锚点段，且最多 50 行
  const lib = Array.from({ length: 80 }, (_, i) => ({
    title: `歌${i}`,
    artist: `艺人${i % 5}`,
  }));
  const msgs2 = buildParseIntentPrompt('轻快中文民谣', lib);
  const anchorMatch = msgs2[1].content.match(/\d+\. /g) ?? [];
  assert.strictEqual(anchorMatch.length, 50);
  assert.match(msgs2[1].content, /歌0/);
  assert.match(msgs2[1].content, /歌49/);
  assert.doesNotMatch(msgs2[1].content, /歌50/);
  // 2026-09-28 E7 压测修：锚点段必须写明「用户本次说的话优先于锚点」，
  // 否则模型会把锚点当默认解（实测「不要人声」→ exclude_artists=[五月天]）。
  assert.match(msgs2[1].content, /优先级\*\*高于\*\*这份锚点/);
  assert.match(msgs2[1].content, /锚点不得主导/);
  // 否定语义 + 数量词规则必须在 system prompt 里
  assert.match(msgs[0].content, /否定词要落对地方/);
  assert.match(msgs[0].content, /用户本次说的话 > 口味锚点/);
  assert.match(msgs[0].content, /多来点/);
  console.log('  ✓ buildParseIntentPrompt: empty lib / 80 lib clamp to 50');
}

// ── 2. extractJsonBlock ──────────────────────────────────
{
  assert.strictEqual(
    extractJsonBlock('<json>{"a":1}</json>'),
    '{"a":1}',
  );
  assert.strictEqual(
    extractJsonBlock('前文<json>{"a":1}</json>后文'),
    '{"a":1}',
  );
  assert.strictEqual(
    extractJsonBlock('```json\n{"a":1}\n```'.replace(/```json|```/g, m =>
      m.includes('json') ? '<json>' : '</json>')),
    '{"a":1}',
  );
  assert.strictEqual(extractJsonBlock('{"a":1}'), '{"a":1}');
  assert.throws(() => extractJsonBlock('hello world'), /response_missing_json_block/);

  // 2026-09-28 C1 实测回归：response_format=json_object 让 DeepSeek 忽略
  // <json> 包裹，直接吐裸 JSON，且可能带前导空白 / 说明文字。
  assert.strictEqual(
    extractJsonBlock('\n   {"mood":"夜跑"}  '),
    '{"mood":"夜跑"}',
  );
  assert.strictEqual(
    extractJsonBlock('```json\n{"mood":"夜跑"}\n```'),
    '{"mood":"夜跑"}',
  );
  assert.strictEqual(
    extractJsonBlock('好的，这是解析结果：\n{"mood":"夜跑","era":{"from":1990}}'),
    '{"mood":"夜跑","era":{"from":1990}}',
  );
  // 字符串字面量里的花括号 / 转义引号不能打乱配平扫描
  assert.strictEqual(
    extractJsonBlock('x {"rationale":"他说 \"{好}\" 很好","mood":"a"} y'),
    '{"rationale":"他说 \"{好}\" 很好","mood":"a"}',
  );
  console.log('  ✓ extractJsonBlock: <json> / bare JSON / fail');
}

// ── 3. parseIntentResponse ─────────────────────────────────
{
  // 完整
  const r1 = parseIntentResponse(
    '<json>{"mood":"夜跑","genres":["electronic"],"tempo":"fast","language":"zh","similar_artists":["deadmau5"],"target_count":15,"rationale":"适合夜跑的电子乐"}</json>',
  );
  assert.strictEqual(r1.intent.mood, '夜跑');
  assert.deepStrictEqual(r1.intent.genres, ['electronic']);
  assert.strictEqual(r1.intent.tempo, 'fast');
  assert.strictEqual(r1.intent.target_count, 15);

  // 缺字段 → 默认
  const r2 = parseIntentResponse('<json>{"mood":""}</json>');
  assert.strictEqual(r2.intent.tempo, 'any');
  assert.strictEqual(r2.intent.language, 'any');
  assert.deepStrictEqual(r2.intent.genres, []);
  assert.strictEqual(r2.intent.target_count, 12);

  // 非法 enum → 降级 any
  const r3 = parseIntentResponse(
    '<json>{"mood":"x","tempo":"WARP","language":"klingon"}</json>',
  );
  assert.strictEqual(r3.intent.tempo, 'any');
  assert.strictEqual(r3.intent.language, 'any');

  // target_count clamp
  const r4 = parseIntentResponse('<json>{"mood":"x","target_count":100}</json>');
  assert.strictEqual(r4.intent.target_count, 20);
  const r5 = parseIntentResponse('<json>{"mood":"x","target_count":1}</json>');
  assert.strictEqual(r5.intent.target_count, 8);
  const r6 = parseIntentResponse('<json>{"mood":"x","target_count":"abc"}</json>');
  assert.strictEqual(r6.intent.target_count, 12);

  // era 边界
  const r7 = parseIntentResponse(
    '<json>{"mood":"x","era":{"from":2000}}</json>',
  );
  assert.deepStrictEqual(r7.intent.era, { from: 2000 });
  const r8 = parseIntentResponse('<json>{"mood":"x","era":{}}</json>');
  assert.strictEqual(r8.intent.era, undefined);

  // 数组长度裁剪
  const r9 = parseIntentResponse(
    '<json>{"mood":"x","genres":["a","b","c","d","e","f","g","h"],"similar_artists":["a","b","c","d","e","f"],"exclude_artists":["a","b","c","d","e","f","g","h","i","j"]}</json>',
  );
  assert.strictEqual(r9.intent.genres.length, 6);
  assert.strictEqual(r9.intent.similar_artists.length, 4);
  assert.strictEqual(r9.intent.exclude_artists.length, 8);

  // 非 JSON → 502 (HttpException)
  assert.throws(
    () => parseIntentResponse('纯文本无 json 块'),
    (e: any) =>
      e?.response?.statusCode === 502 && e?.response?.error === 'parse_intent_json_failed',
  );
  console.log('  ✓ parseIntentResponse: complete / missing / invalid enum / clamp / era / arrays / non-JSON');
}

// ── 4. pickLibrarySample ──────────────────────────────────
{
  // 去重（normalizeKey）
  const lib = {
    items: [
      { title: '晴天', artist: '周杰伦', sources: [] },
      { title: '晴 天', artist: '周杰伦', sources: [] }, // 重复
      { title: '晴天', artist: '周 杰伦', sources: [] }, // 重复（normalizeKey 去空格）
      { title: '七里香', artist: '周杰伦', sources: [] },
    ],
  };
  assert.deepStrictEqual(pickLibrarySample(lib, 50), [
    { title: '晴天', artist: '周杰伦' },
    { title: '七里香', artist: '周杰伦' },
  ]);

  // 空库
  assert.deepStrictEqual(pickLibrarySample(null, 50), []);
  assert.deepStrictEqual(pickLibrarySample({ items: [] }, 50), []);

  // 上限
  const big = {
    items: Array.from({ length: 100 }, (_, i) => ({
      title: `歌${i}`,
      artist: '唯一艺人',
      sources: [],
    })),
  };
  assert.strictEqual(pickLibrarySample(big, 50).length, 50);
  console.log('  ✓ pickLibrarySample: dedup / empty / limit');
}

// ── 5. validateParseIntentInput ───────────────────────────
{
  assert.strictEqual(validateParseIntentInput('  hello  '), 'hello');
  assert.throws(
    () => validateParseIntentInput(''),
    (e: any) => e?.response?.statusCode === 400,
  );
  assert.throws(
    () => validateParseIntentInput('   '),
    (e: any) => e?.response?.statusCode === 400,
  );
  assert.throws(
    () => validateParseIntentInput(123),
    (e: any) => e?.response?.statusCode === 400,
  );
  assert.throws(
    () => validateParseIntentInput('a'.repeat(501)),
    (e: any) =>
        e?.response?.statusCode === 400 &&
        e?.response?.error === 'parse_intent_text_too_long',
  );
  assert.strictEqual(validateParseIntentInput('a'.repeat(500)), 'a'.repeat(500));
  console.log('  ✓ validateParseIntentInput: trim / empty / non-string / 501 / 500');
}


// ── 6. intentToPromptHints —— run() 把 NLIntent 翻进 prompt 的桥 ────
{
  // 完整 intent → 6 行 hint
  const out1 = intentToPromptHints({
    mood: '夜跑', genres: ['electronic', 'house'], tempo: 'fast',
    language: 'zh', era: { from: 2015, to: 2025 },
    similar_artists: ['deadmau5'], similar_tracks: [],
    exclude_artists: ['徐梦圆'], exclude_genres: ['ballad'],
    target_count: 15, rationale: '',
  });
  assert.ok(out1.includes('心情/场景：夜跑'), 'mood line');
  assert.ok(out1.includes('风格标签：electronic、house'), 'genres line');
  assert.ok(out1.includes('节奏偏好：fast'), 'tempo line');
  assert.ok(out1.includes('年代：2015–2025'), 'era line');
  assert.ok(out1.includes('想要类似这些艺人的歌：deadmau5'), 'similar_artists line');
  assert.ok(out1.includes('不要这些艺人的歌：徐梦圆'), 'exclude_artists from intent');
  assert.ok(out1.includes('不要这些风格：ballad'), 'exclude_genres from intent');
  assert.ok(!out1.includes('参考曲目'), 'no similar_tracks → no line');
  assert.strictEqual(out1.length, 7);

  // tempo 'any' → 不出节奏行
  const out2 = intentToPromptHints({
    mood: '轻', genres: [], tempo: 'any', language: 'any',
    similar_artists: [], similar_tracks: [],
    exclude_artists: [], exclude_genres: [],
    target_count: 12, rationale: '',
  });
  assert.deepStrictEqual(out2, ['心情/场景：轻']);

  // era 单边（只 to）→ 仍输出
  const out3 = intentToPromptHints({
    mood: '', genres: [], tempo: 'any', language: 'any',
    era: { to: 1999 },
    similar_artists: [], similar_tracks: [],
    exclude_artists: [], exclude_genres: [],
    target_count: 12, rationale: '',
  });
  assert.ok(out3.includes('年代：?–1999'));

  // extra.exclude_titles / exclude_artists（顶层 NL 路径，叠加）
  const out4 = intentToPromptHints(
    { mood: '', genres: [], tempo: 'any', language: 'any',
      similar_artists: [], similar_tracks: [],
      exclude_artists: [], exclude_genres: [],
      target_count: 12, rationale: '' },
    { exclude_titles: ['七里香'], exclude_artists: ['周杰伦'] },
  );
  assert.ok(out4.includes('不要这些标题的歌：七里香'), 'extra exclude_titles');
  assert.ok(out4.includes('不要这些艺人的歌：周杰伦'), 'extra exclude_artists');

  // intent.exclude_artists 与 extra.exclude_artists 合并成一行（去重），
  // 不再出现两条「不要这些艺人的歌」。
  const out4b = intentToPromptHints(
    { mood: '', genres: [], tempo: 'any', language: 'any',
      similar_artists: [], similar_tracks: [],
      exclude_artists: ['周杰伦'], exclude_genres: [],
      target_count: 12, rationale: '' },
    { exclude_artists: ['周杰伦', '薛之谦'] },
  );
  const artistLines = out4b.filter((h: string) => h.startsWith('不要这些艺人的歌'));
  assert.strictEqual(artistLines.length, 1, 'merged into single line');
  assert.ok(artistLines[0].includes('周杰伦') && artistLines[0].includes('薛之谦'), 'merged content');

  // 完整 intent + extra 同时 → 都出现且不重复
  const out5 = intentToPromptHints(
    { mood: '跑步', genres: ['rock'], tempo: 'fast', language: 'zh',
      similar_artists: [], similar_tracks: ['光辉岁月'],
      exclude_artists: ['薛之谦'], exclude_genres: [],
      target_count: 12, rationale: '' },
    { exclude_titles: ['浮夸'] },
  );
  assert.ok(out5.includes('心情/场景：跑步'));
  assert.ok(out5.includes('不要这些艺人的歌：薛之谦'), 'from intent');
  assert.ok(out5.includes('不要这些标题的歌：浮夸'), 'from extra');
  assert.ok(!out5.some(h => h.includes('不要这些艺人的歌：') && h === '不要这些艺人的歌：'), 'no dup exclude_artists');
  console.log('  ✓ intentToPromptHints: full / tempo any / era single / extra / merged / combined');
}

// ── 7. normalizeIntentInput —— POST /reco/run 的 intent 校验（400）────
{
  // 合法 intent → 归一后返回
  const ok = normalizeIntentInput({
    mood: 'x', genres: ['rock'], tempo: 'fast', language: 'zh',
    similar_artists: [], similar_tracks: [], exclude_artists: [],
    exclude_genres: [], target_count: 15, rationale: '',
  });
  assert.strictEqual(ok.tempo, 'fast');
  assert.strictEqual(ok.target_count, 15);

  // 缺字段 → 默认（不 400）
  const sparse = normalizeIntentInput({});
  assert.strictEqual(sparse.tempo, 'any');
  assert.strictEqual(sparse.target_count, 12);

  // 非对象 → 400
  for (const bad of ['x', 42, null, ['a']]) {
    assert.throws(
      () => normalizeIntentInput(bad),
      (e: any) => e?.response?.statusCode === 400,
    );
  }
  // 数组字段非数组 → 400
  assert.throws(
    () => normalizeIntentInput({ genres: 'rock' }),
    (e: any) => e?.response?.statusCode === 400 && e?.response?.error === 'intent_field_invalid',
  );
  // era 非对象 → 400
  assert.throws(
    () => normalizeIntentInput({ era: 2000 }),
    (e: any) => e?.response?.statusCode === 400,
  );
  console.log('  ✓ normalizeIntentInput: ok / defaults / 400 non-object / 400 bad fields');
}


console.log('\n✅ nl-playlist logic: all tests passed');
