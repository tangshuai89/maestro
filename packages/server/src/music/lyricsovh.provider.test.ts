/**
 * LyricsOvhProvider 单测：歌词拉取 + 解析 + 边界。
 * 运行: npx ts-node packages/server/src/music/lyricsovh.provider.test.ts
 *
 * 用例：
 *   1. 空 artist → null，不打网络
 *   2. 空 title → null，不打网络
 *   3. 纯空白 artist → null
 *   4. 命中：单行歌词 → LyricLine[]，time=0
 *   5. 命中：多行歌词 → 按 \n 拆分、trim、过滤空行
 *   6. 404 → null
 *   7. HTTP 500（res.ok=false）→ null
 *   8. lyrics 字段缺失 → null
 *   9. lyrics = "" → null（过滤后无行）
 *  10. URL 编码：artist/title 含特殊字符 → encodeURIComponent 生效
 *  11. 超时：fetch 永不 resolve → withTimeout 5s 后返回 null（用短超时验证）
 */
export {};
const assert = require('node:assert');

const { LyricsOvhProvider } = require('./lyricsovh.provider');

const prov = new LyricsOvhProvider();

async function main() {
  let fetchCalls: string[] = [];
  let originalFetch: typeof globalThis.fetch | undefined;

  function installFetch(mock: (url: string) => any) {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = (async (url: any) => {
      fetchCalls.push(String(url));
      return mock(String(url));
    }) as any;
  }
  function restoreFetch() {
    if (originalFetch !== undefined) globalThis.fetch = originalFetch;
    else delete (globalThis as any).fetch;
  }

  // ── 1. 空 artist → null，不打网络 ───────────────────────────
  {
    installFetch(() => ({ ok: true, json: async () => ({ lyrics: 'x' }) }));
    const r = await prov.getLyrics('', 'title');
    assert.strictEqual(r, null, '空 artist 应返回 null');
    assert.strictEqual(fetchCalls.length, 0, '空 artist 不应发 fetch');
    restoreFetch();
    console.log('✅ 1. 空 artist → null，不打网络');
  }

  // ── 2. 空 title → null，不打网络 ─────────────────────────────
  {
    installFetch(() => ({ ok: true, json: async () => ({ lyrics: 'x' }) }));
    const r = await prov.getLyrics('artist', '');
    assert.strictEqual(r, null, '空 title 应返回 null');
    assert.strictEqual(fetchCalls.length, 0, '空 title 不应发 fetch');
    restoreFetch();
    console.log('✅ 2. 空 title → null，不打网络');
  }

  // ── 3. 纯空白 artist → null ──────────────────────────────────
  {
    installFetch(() => ({ ok: true, json: async () => ({ lyrics: 'x' }) }));
    const r = await prov.getLyrics('   ', 'title');
    assert.strictEqual(r, null, '纯空白 artist 应返回 null');
    assert.strictEqual(fetchCalls.length, 0, '纯空白 artist 不应发 fetch');
    restoreFetch();
    console.log('✅ 3. 纯空白 artist → null');
  }

  // ── 4. 命中：单行歌词 → LyricLine[]，time=0 ─────────────────
  {
    installFetch(
      () => ({ ok: true, json: async () => ({ lyrics: 'We will rock you' }) }),
    );
    const r = await prov.getLyrics('Queen', 'We Will Rock You');
    assert.ok(r, '应返回非 null');
    assert.strictEqual(r!.length, 1);
    assert.strictEqual(r![0].time, 0);
    assert.strictEqual(r![0].text, 'We will rock you');
    restoreFetch();
    console.log('✅ 4. 命中：单行歌词 → LyricLine[]，time=0');
  }

  // ── 5. 命中：多行歌词 → 拆分、trim、过滤空行 ─────────────────
  {
    const body = '  line one  \n\n  line two  \n   \nline three';
    installFetch(() => ({ ok: true, json: async () => ({ lyrics: body }) }));
    const r = await prov.getLyrics('Artist', 'Song');
    assert.ok(r);
    assert.strictEqual(r!.length, 3, '应过滤掉空行，剩 3 行');
    assert.strictEqual(r![0].text, 'line one');
    assert.strictEqual(r![1].text, 'line two');
    assert.strictEqual(r![2].text, 'line three');
    assert.ok(r!.every((l: any) => l.time === 0), '所有行 time=0');
    restoreFetch();
    console.log('✅ 5. 命中：多行歌词 → 拆分、trim、过滤空行');
  }

  // ── 6. 404 → null ────────────────────────────────────────────
  {
    installFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
    const r = await prov.getLyrics('Nobody', 'Nothing');
    assert.strictEqual(r, null, '404 应返回 null');
    restoreFetch();
    console.log('✅ 6. 404 → null');
  }

  // ── 7. HTTP 500（res.ok=false）→ null ────────────────────────
  {
    installFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await prov.getLyrics('Artist', 'Song');
    assert.strictEqual(r, null, '500 应返回 null');
    restoreFetch();
    console.log('✅ 7. HTTP 500（res.ok=false）→ null');
  }

  // ── 8. lyrics 字段缺失 → null ────────────────────────────────
  {
    installFetch(() => ({ ok: true, json: async () => ({}) }));
    const r = await prov.getLyrics('Artist', 'Song');
    assert.strictEqual(r, null, 'lyrics 字段缺失应返回 null');
    restoreFetch();
    console.log('✅ 8. lyrics 字段缺失 → null');
  }

  // ── 9. lyrics = "" → null（过滤后无行）──────────────────────
  {
    installFetch(
      () => ({ ok: true, json: async () => ({ lyrics: '' }) }),
    );
    const r = await prov.getLyrics('Artist', 'Song');
    assert.strictEqual(r, null, '空字符串 lyrics 应返回 null');
    restoreFetch();
    console.log('✅ 9. lyrics = "" → null（过滤后无行）');
  }

  // ── 10. URL 编码：特殊字符 → encodeURIComponent 生效 ────────
  {
    installFetch(
      () => ({ ok: true, json: async () => ({ lyrics: 'x' }) }),
    );
    await prov.getLyrics('AC/DC', 'We Will Rock You');
    assert.strictEqual(fetchCalls.length, 1);
    const url = fetchCalls[0];
    // encodeURIComponent('AC/DC') = 'AC%2FDC'
    assert.ok(
      url.includes('AC%2FDC'),
      `URL 应含编码后的 artist，实际 ${url}`,
    );
    // encodeURIComponent('We Will Rock You') = 'We%20Will%20Rock%20You'
    assert.ok(
      url.includes('We%20Will%20Rock%20You'),
      `URL 应含编码后的 title，实际 ${url}`,
    );
    restoreFetch();
    console.log('✅ 10. URL 编码：特殊字符 → encodeURIComponent 生效');
  }

  // ── 11. 超时：fetch 永不 resolve → withTimeout 5s 后返回 null ──
  // provider 内部 withTimeout=5000ms；用一个永不 resolve 的 fetch 模拟挂起，
  // 验证 5 秒后 withTimeout 兜底返回 null（而非永远挂起）。这条会真实等 5s。
  {
    installFetch(() => new Promise(() => {})); // 永不 resolve
    const start = Date.now();
    const r = await prov.getLyrics('Artist', 'Song');
    const elapsed = Date.now() - start;
    assert.strictEqual(r, null, '挂起的 fetch 应在超时后返回 null');
    assert.ok(
      elapsed >= 4500 && elapsed < 7000,
      `应等待约 5s，实际 ${elapsed}ms`,
    );
    restoreFetch();
    console.log(`✅ 11. 超时：fetch 永不 resolve → null（${elapsed}ms）`);
  }

  console.log('\n🎉 lyricsovh.provider.test 全部 11 项通过');
}

main().catch((err) => {
  console.error('❌ lyricsovh.provider.test 失败:', err);
  process.exit(1);
});
