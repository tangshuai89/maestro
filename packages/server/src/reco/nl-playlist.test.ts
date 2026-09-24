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


const assert = require('node:assert');
const {
  buildParseIntentPrompt,
  extractJsonBlock,
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

console.log('\n✅ nl-playlist logic: all tests passed');
