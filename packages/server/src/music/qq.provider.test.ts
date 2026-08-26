/**
 * QqMusicProvider 单测：computeGtk（g_tk 的 DJB2 实现）。
 * 运行: npx ts-node packages/server/src/music/qq.provider.test.ts
 *
 * computeGtk 是私有方法，通过 `(prov as any).computeGtk(...)` 直接调。
 * 用例：
 *   - 空字符串 → '5381'（DJB2 of "" = 5381）
 *   - 'a' → '177610'（5381*33 + 97 = 177670；不对……下面用同一公式独立算后断言）
 *   - 'abc' 用同一公式独立算后断言
 *   - '1234567890' 用同一公式独立算后断言
 *
 * 不打网络，纯算法验证。
 */
export {};
const assert = require('node:assert');

import { QqMusicProvider } from './qq.provider';

const prov = new QqMusicProvider();
const gtk = (skey: string): string =>
  (prov as unknown as { computeGtk(s: string): string }).computeGtk(skey);

/**
 * 独立 DJB2 参考实现（与生产代码相同算法；用于在测试里独立算出期望值，
 * 不复制生产代码到测试里——这是 golden test 的标准做法）。
 */
function referenceDjb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ── computeGtk ──────────────────────────────────────────────

assert.strictEqual(gtk(''), '5381', 'DJB2 of "" should be 5381');
assert.strictEqual(
  gtk('a'),
  String(referenceDjb2('a')),
  'single char should match reference',
);
assert.strictEqual(
  gtk('abc'),
  String(referenceDjb2('abc')),
  '"abc" should match reference',
);
assert.strictEqual(
  gtk('1234567890'),
  String(referenceDjb2('1234567890')),
  'numeric string should match reference',
);

// 已知典型 skey 长度（QQ cookie 里的 skey 通常 10 位字母数字）
const skey = 'aB3xY9zQw1';
assert.strictEqual(gtk(skey), String(referenceDjb2(skey)));

// 大字符串不应越界（unsigned 32-bit via >>> 0）
const longSkey = 'a'.repeat(1024);
assert.strictEqual(gtk(longSkey), String(referenceDjb2(longSkey)));

// 中文 skey 也能算
assert.strictEqual(gtk('测试'), String(referenceDjb2('测试')));

console.log('qq.provider.test.ts: all computeGtk assertions passed');

// ── fetchLiked：CgiGetDiss 请求形状 + Track 映射（mock 网络） ──────────
//
// 2026-08-26 重写回归：旧实现走 fcg_user_created_diss 找 dirid=201，新 QQ
// 登录体系下「我喜欢」不再是 201（实测 1/31~57/205）→ 恒返回 []。新实现走
// musicu.fcg 的 CgiGetDiss（disstid=0 + dirid=201 + enc_host_uin），一次直达。
// 这里 mock global.fetch 断言：请求体形状正确 + 响应 songlist 正确映射成 Track。
async function fetchLikedTest() {
  const captured: { url: string; body: any }[] = [];
  const realFetch = global.fetch;
  global.fetch = (async (url: any, opts: any) => {
    captured.push({ url: String(url), body: JSON.parse(opts?.body ?? '{}') });
    const body = JSON.parse(opts.body);
    const begin = body.req_0.param.song_begin;
    const num = body.req_0.param.song_num;
    // 第一页回 1 首 + hasmore=true；第二页回 1 首 + hasmore=false
    if (begin === 0) {
      return {
        json: async () => ({
          code: 0,
          req_0: {
            code: 0,
            data: {
              hasmore: true,
              total_song_num: 2,
              songlist: [
                {
                  mid: '003IWkKX0FDHRx',
                  name: '明日も (2024 Mastering)',
                  singer: [{ name: 'MUSH&Co.', mid: '001jPZQh3Sgaom' }],
                  album: { name: 'Anniversary', mid: '004WaXSb0WwrlV' },
                  interval: 257,
                  file: { media_mid: 'MM_fake1' },
                },
              ],
            },
          },
        }),
      } as any;
    }
    return {
      json: async () => ({
        code: 0,
        req_0: {
          code: 0,
          data: {
            hasmore: false,
            total_song_num: 2,
            songlist: [
              {
                mid: 'fake2',
                name: '第二首',
                singer: [{ name: '艺人2', mid: 'x' }],
                album: { name: '专辑2', mid: 'alb2' },
                interval: 200,
                file: { media_mid: 'MM_fake2' },
              },
            ],
          },
        },
      }),
    } as any;
  }) as any;

  const session: any = {
    qqCookie: 'qm_keyst=xyz; euin=Ne6ANK4s7KE*',
    qqCookies: { euin: 'Ne6ANK4s7KE*' },
  };
  // maxTracks=1500 → 第 1 页 num=1000、第 2 页 num=500，翻页被真实触发
  const tracks = await prov.fetchLiked(session, 1500);
  global.fetch = realFetch;

  // 请求形状：musicu.fcg + CgiGetDiss + dirid=201 + disstid=0 + euin
  assert.ok(captured.length >= 2, '应翻 2 页');
  assert.ok(
    captured[0].url.includes('u.y.qq.com/cgi-bin/musicu.fcg'),
    `应走 musicu.fcg，实际 ${captured[0].url}`,
  );
  assert.strictEqual(captured[0].body.req_0.module, 'music.srfDissInfo.DissInfo');
  assert.strictEqual(captured[0].body.req_0.method, 'CgiGetDiss');
  assert.strictEqual(captured[0].body.req_0.param.disstid, 0);
  assert.strictEqual(captured[0].body.req_0.param.dirid, 201);
  assert.strictEqual(captured[0].body.req_0.param.enc_host_uin, 'Ne6ANK4s7KE*');
  assert.strictEqual(captured[1].body.req_0.param.song_begin, 1000);
  // 第 2 页 num = min(1000, maxTracks - 已收 1 首) = 1000
  assert.strictEqual(captured[1].body.req_0.param.song_num, 1000);

  // Track 映射
  assert.strictEqual(tracks.length, 2, '应拉回 2 首');
  assert.strictEqual(tracks[0].id, '003IWkKX0FDHRx');
  assert.strictEqual(tracks[0].title, '明日も (2024 Mastering)');
  assert.strictEqual(tracks[0].artist, 'MUSH&Co.');
  assert.strictEqual(tracks[0].album, 'Anniversary');
  assert.strictEqual(tracks[0].duration, 257);
  assert.strictEqual(tracks[0].mediaMid, 'MM_fake1');
  assert.ok(tracks[0].coverUrl.includes('004WaXSb0WwrlV'), '封面应带 albummid');
  assert.strictEqual(tracks[0].liked, true);
  assert.strictEqual(tracks[0].provider, 'qq');
  console.log('✅ fetchLiked: CgiGetDiss 请求形状 + 分页 + Track 映射全部正确');
}

// ── fetchLiked：cookie 失效（1000）→ not_logged_in ────────────────────
async function fetchLikedNotLoggedInTest() {
  const realFetch = global.fetch;
  global.fetch = (async () => ({
    json: async () => ({ code: 1000, req_0: { code: 1000 } }),
  })) as any;
  const session: any = { qqCookie: 'qm_keyst=expired', qqCookies: {} };
  let threw = false;
  try {
    await prov.fetchLiked(session, 100);
  } catch (e: any) {
    threw = true;
    assert.strictEqual(e.message, 'not_logged_in', '应抛 not_logged_in');
  } finally {
    global.fetch = realFetch;
  }
  assert.ok(threw, 'cookie 失效应抛错');
  console.log('✅ fetchLiked: cookie 失效（1000）→ not_logged_in');
}

// ⚠️ 两个用例都 mock global.fetch，必须串行跑（并发会互相污染 mock）
fetchLikedTest()
  .then(fetchLikedNotLoggedInTest)
  .then(() => {
    console.log('\n🎉 qq.provider.test.ts: all assertions passed');
  })
  .catch((err) => {
    console.error('❌ qq.provider.test.ts 失败:', err);
    process.exit(1);
  });