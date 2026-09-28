/**
 * NL playlist 端到端回归（specs/nl-playlist/ §验收 + §风险）。
 *
 * 覆盖：
 *   1. parse-intent 400（text 空 / 非字符串 / >500 字）
 *   2. parse-intent 428（没设 DeepSeek key）
 *   3. parse-intent 502（上游返回非 JSON —— raw 必须带回去给 debug）
 *   4. parse-intent 502（上游 5xx）/ 429（rate limit，透传 retryAfter）
 *   5. parse-intent happy path（stub 上游返回合法 <json> → NLIntent 校验通过，
 *      且库上下文进了 prompt）
 *   6. 歌单 CRUD 走 controller 全链路（create → list → get → patch → delete）
 *   7. 命名冲突 -2 后缀
 *
 * 上游 DeepSeek 全部 stub（不发出网、不消耗 token）。真实 prompt 质量调优
 * 属于 spec §Task C1（需要真 key + 出网，人工过），不在此文件。
 *
 * 运行: npx ts-node src/reco/nl-playlist.e2e.test.ts
 */
export {};
const assert = require('node:assert');

const { NLPlaylistController } = require('./nl-playlist.controller');
const { PlaylistService } = require('../library/playlist.service');

// ── fake storage ────────────────────────────────────────────
const fakeStorage = (() => {
  const m = new Map<string, unknown>();
  return {
    get: <T,>(k: string) => m.get(k) as T | undefined,
    set: <T,>(k: string, v: T) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
  };
})();

// ── fake deps ───────────────────────────────────────────────
const SESSION = { id: 'e2e-session' };
const fakeSessionService = { resolve: () => SESSION };
const fakeMusic = { getLibrary: () => ({ items: [] }) };

type Upstream = { status: number; body?: string; headers?: Record<string, string> };
let upstream: Upstream = { status: 200, body: '' };
let configured = true;
let lastMessages: Array<{ role: string; content: string }> = [];

/** 模拟 RecoService.callDeepSeekForParse —— 只保留 controller 依赖的两个面。 */
const fakeReco = {
  isConfigured: () => configured,
  callDeepSeekForParse: async (_key: string, messages: any[]) => {
    lastMessages = messages;
    if (upstream.status === 429) {
      const { HttpException, HttpStatus } = require('@nestjs/common');
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'deepseek_rate_limit',
          message: 'DeepSeek 频率限制，请稍后重试',
          retryAfterSec: Number(upstream.headers?.['retry-after'] ?? 0) || undefined,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (upstream.status >= 500) {
      const { HttpException, HttpStatus } = require('@nestjs/common');
      throw new HttpException('deepseek_upstream_5xx', HttpStatus.BAD_GATEWAY);
    }
    return upstream.body;
  },
};

const playlists = new PlaylistService(fakeStorage as any);
const ctl = new NLPlaylistController(
  fakeReco as any,
  fakeMusic as any,
  fakeSessionService as any,
  playlists,
);

const req = {} as any;
const res = {} as any;
const statusOf = (e: any) => e?.status ?? e?.response?.statusCode;
const errorOf = (e: any) =>
  typeof e?.response === 'string' ? e.response : e?.response?.error;


async function main() {
// ── 1. parse-intent 400：输入非法 ───────────────────────────
{
  for (const bad of [undefined, null, '', '   ', 123, 'a'.repeat(501)]) {
    await assert.rejects(
      () => ctl.parseIntent({ text: bad } as any, req, res),
      (e: any) => statusOf(e) === 400,
      `text=${JSON.stringify(bad)?.slice(0, 20)} 应 400`,
    );
  }
  // 500 字边界合法
  await assert.rejects(
    () => ctl.parseIntent({ text: 'a'.repeat(500) } as any, req, res),
    (e: any) => statusOf(e) !== 400,
    '500 字边界不应 400',
  );
  console.log('  ✓ 400: empty / whitespace / non-string / 501 chars / 500 boundary');
}

// ── 2. parse-intent 428：没设 key ───────────────────────────
{
  const saved = configured;
  configured = false;
  await assert.rejects(
    () => ctl.parseIntent({ text: '夜跑电子乐' } as any, req, res),
    (e: any) => statusOf(e) === 428 && errorOf(e) === 'deepseek_key_not_configured',
  );
  configured = saved;
  console.log('  ✓ 428: deepseek_key_not_configured');
}

// ── 3. parse-intent 502：上游非 JSON（raw 必须带回）──────────
{
  configured = true;
  upstream = { status: 200, body: '抱歉，我无法完成这个请求。' };
  await assert.rejects(
    () => ctl.parseIntent({ text: '夜跑电子乐' } as any, req, res),
    (e: any) =>
      statusOf(e) === 502 &&
      errorOf(e) === 'parse_intent_json_failed' &&
      e.response.raw === '抱歉，我无法完成这个请求。',
  );
  console.log('  ✓ 502: non-JSON → raw 保留给 debug');
}

// ── 4. parse-intent 429 / 5xx ───────────────────────────────
{
  upstream = { status: 429, headers: { 'retry-after': '12' } };
  await assert.rejects(
    () => ctl.parseIntent({ text: '夜跑' } as any, req, res),
    (e: any) =>
      statusOf(e) === 429 &&
      e.response.error === 'deepseek_rate_limit' &&
      e.response.retryAfterSec === 12,
  );
  upstream = { status: 503, body: '' };
  await assert.rejects(
    () => ctl.parseIntent({ text: '夜跑' } as any, req, res),
    (e: any) => statusOf(e) === 502 && errorOf(e) === 'deepseek_upstream_5xx',
  );
  console.log('  ✓ 429: rate limit + Retry-After 透传 / 5xx → 502');
}

// ── 5. parse-intent happy path ──────────────────────────────
{
  upstream = {
    status: 200,
    body:
      '<json>{"mood":"夜跑","genres":["electronic","house"],"tempo":"fast",' +
      '"language":"zh","era":{"from":2015,"to":2025},' +
      '"similar_artists":["deadmau5"],"similar_tracks":[],"exclude_artists":[],' +
      '"exclude_genres":[],"target_count":14,"rationale":"夜跑要节奏快"}</json>',
  };
  const r = await ctl.parseIntent({ text: '放点适合夜跑的电子乐' } as any, req, res);
  assert.strictEqual(r.intent.mood, '夜跑');
  assert.deepStrictEqual(r.intent.genres, ['electronic', 'house']);
  assert.strictEqual(r.intent.tempo, 'fast');
  assert.strictEqual(r.intent.language, 'zh');
  assert.deepStrictEqual(r.intent.era, { from: 2015, to: 2025 });
  assert.deepStrictEqual(r.intent.similar_artists, ['deadmau5']);
  assert.strictEqual(r.intent.target_count, 14);
  assert.strictEqual(r.intent.rationale, '夜跑要节奏快');
  // 用户原文必须进 prompt
  assert.ok(lastMessages[1].content.includes('放点适合夜跑的电子乐'));
  console.log('  ✓ happy path: NLIntent 全字段 + 用户原文进 prompt');
}

// ── 5b. 库上下文进 prompt（有库时）────────────────────────
{
  (fakeMusic as any).getLibrary = () => ({
    items: [
      { title: '晴天', artist: '周杰伦', sources: [{ platform: 'qq', trackId: '1' }] },
      { title: '七里香', artist: '周杰伦', sources: [{ platform: 'qq', trackId: '2' }] },
    ],
  });
  upstream = { status: 200, body: '<json>{"mood":"x"}</json>' };
  await ctl.parseIntent({ text: '轻快' } as any, req, res);
  assert.ok(lastMessages[1].content.includes('口味锚点'), '库上下文段应存在');
  assert.ok(lastMessages[1].content.includes('晴天'), '库样本应进 prompt');
  (fakeMusic as any).getLibrary = () => ({ items: [] });
  console.log('  ✓ 库上下文（≤50 ❤）进 prompt');
}

// ── 6. 歌单 CRUD 走 controller 全链路 ────────────────────────
{
  const tracks = [
    { id: 'merged-qq-1', title: '夜跑的 electronic', artist: 'A', sources: [{ platform: 'qq', trackId: '1', hasCopyright: true, url: '' }] },
    { id: 'merged-qq-2', title: '第二首', artist: 'B', sources: [{ platform: 'qq', trackId: '2', hasCopyright: true, url: '' }] },
  ];
  const created = ctl.createPlaylist(
    { name: '夜跑歌单', tracks, prompt: '放点适合夜跑的电子乐', source: 'nl' } as any,
    req, res,
  );
  assert.ok(created.id, '应有 id');
  assert.strictEqual(created.name, '夜跑歌单');
  assert.strictEqual(created.tracks.length, 2);
  assert.strictEqual(created.source, 'nl');
  assert.strictEqual(created.prompt, '放点适合夜跑的电子乐');
  assert.ok(created.createdAt > 0 && created.updatedAt > 0);

  // 命名冲突 → -2
  const dup = ctl.createPlaylist({ name: '夜跑歌单', tracks: [tracks[0]] } as any, req, res);
  assert.strictEqual(dup.name, '夜跑歌单-2');

  // list：两条都在，且数组按 updatedAt 降序（契约本身；同毫秒创建时次序不定，
  // 所以只校验降序性质而非具体 index）
  const list = ctl.listPlaylists(req, res);
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(
    new Set(list.map((x) => x.id)),
    new Set([created.id, dup.id]),
  );
  for (let i = 1; i < list.length; i++) {
    assert.ok(
      list[i - 1].updatedAt >= list[i].updatedAt,
      'list 必须按 updatedAt 降序',
    );
  }

  // get
  assert.strictEqual(ctl.getPlaylist(created.id, req, res).name, '夜跑歌单');

  // patch：append 去重（tracks[0] 已存在，只加 tracks[1] 之外没有新歌 → 长度不变）
  const patched = ctl.patchPlaylist(
    created.id,
    { append: [tracks[0], { ...tracks[0], id: 'merged-qq-3', sources: [{ platform: 'qq', trackId: '3', hasCopyright: true, url: '' }] }] },
    req, res,
  );
  assert.strictEqual(patched.tracks.length, 3, 'append 一首新的、去重一首已存在的');

  // patch：remove
  const removed = ctl.patchPlaylist(created.id, { remove: ['merged-qq-3'] }, req, res);
  assert.strictEqual(removed.tracks.length, 2);

  // patch：rename
  const renamed = ctl.patchPlaylist(created.id, { name: '夜跑歌单 v2' }, req, res);
  assert.strictEqual(renamed.name, '夜跑歌单 v2');

  // delete
  assert.deepStrictEqual(ctl.deletePlaylist(created.id, req, res), { ok: true });
  assert.strictEqual(ctl.listPlaylists(req, res).length, 1);
  // 删完再取 → 404
  await assert.rejects(
    async () => ctl.getPlaylist(created.id, req, res),
    (e: any) => statusOf(e) === 404,
  );
  console.log('  ✓ CRUD: create(+同名 -2) / list / get / patch(append 去重+remove+rename) / delete / 404');
}

// ── 7. 400 边界：name 空 / tracks 空 ─────────────────────────
{
  for (const bad of [
    { name: '', tracks: [{ id: 'x', sources: [] }] },
    { name: '  ', tracks: [{ id: 'x', sources: [] }] },
    { name: 'ok', tracks: [] },
    { name: 'a'.repeat(61), tracks: [{ id: 'x', sources: [] }] },
  ]) {
    await assert.rejects(
      async () => ctl.createPlaylist(bad as any, req, res),
      (e: any) => statusOf(e) === 400,
      `body=${JSON.stringify(bad).slice(0, 40)} 应 400`,
    );
  }
  console.log('  ✓ 400: name empty / whitespace / 61 chars / tracks empty');
}



  console.log('\n✅ nl-playlist e2e: all tests passed');
}

main().catch((e) => {
  console.error('❌ nl-playlist e2e failed:', e);
  process.exit(1);
});
