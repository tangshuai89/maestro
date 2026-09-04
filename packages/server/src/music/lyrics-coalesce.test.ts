/**
 * LyricsService.getLyrics in-flight coalescing 回归测试。
 *
 * 背景：稳定性扫描发现 getLyrics 走「读 cache miss → await 远端 → 写 cache」
 * 模式，await 间断开让同 key 并发调用都打后端。fix 仿 searchEquivalent 加
 * inflight map。getLyricsAvailability 顺序调每个源时会触发同 race。
 *
 * 验证：
 *  1. 并发 N 个：远端 fetchLyrics 只被调 1 次
 *  2. cache 仍按原 TTL 行为（命中走 cache，miss 进 inflight）
 *  3. inflight map 完成后清理
 *
 * 运行: npx ts-node src/music/lyrics-coalesce.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { LyricsService } = require('./lyrics.service');

async function main() {
  // 屏蔽测试期 unhandled rejection（同 search-equivalent-coalesce.test.ts）
  process.on('unhandledRejection', (err) => {
    if (!/远端/.test(String(err))) throw err;
  });

  // ── 1. 并发 N 个：远端 fetchLyrics 只被调 1 次 ─────────────────
  {
    let fetchCalls = 0;
    let release: (() => void) | null = null;
    const releasePromise = new Promise<void>((r) => (release = r));
    const session = { id: 's', providers: { qq: {} } };
    const svc = new LyricsService(
      { getLyrics: async () => null } as any,
      { getLyrics: async () => null } as any,
      {
        getLyrics: async () => {
          fetchCalls++;
          return new Promise((resolve) => {
            releasePromise.then(() => resolve([
              { time: 0, text: '歌词' },
            ] as any));
          });
        },
      } as any,
      { getLyrics: async () => null } as any,
    );
    const N = 8;
    const promises = Array.from({ length: N }, () =>
      svc.getLyrics(session, 'qq', 'track-1'),
    );
    release!();
    const results = await Promise.all(promises);
    assert.strictEqual(
      fetchCalls, 1,
      `并发 ${N} 个应只触发 1 次远端 fetchLyrics，实际 ${fetchCalls}`,
    );
    assert.strictEqual(results.length, N);
    assert.ok(results.every((r) => Array.isArray(r)), '所有 awaiter 拿到结果');
    console.log(`✅ 1. 并发 ${N} 个：共享同一 Promise（fetchCalls=1）`);
  }

  // ── 2. cache 命中走 cache（不走 inflight） ─────────────────────
  {
    let fetchCalls = 0;
    const session = { id: 's2', providers: { qq: {} } };
    const svc = new LyricsService(
      { getLyrics: async () => null } as any,
      { getLyrics: async () => null } as any,
      {
        getLyrics: async () => {
          fetchCalls++;
          return [{ time: 0, text: 'cached' }] as any;
        },
      } as any,
      { getLyrics: async () => null } as any,
    );
    // 第一次：cache miss → fetch
    const r1 = await svc.getLyrics(session, 'qq', 'track-2');
    // 第二次：cache hit
    const r2 = await svc.getLyrics(session, 'qq', 'track-2');
    assert.strictEqual(fetchCalls, 1, 'cache hit 不应再 fetch');
    assert.deepStrictEqual(r1, r2, '两次返同结果');
    console.log('✅ 2. cache hit 不再走 inflight（fetchCalls=1）');
  }

  // ── 3. inflight map 完成后清理（无 key 残留） ─────────────────
  {
    const svc = new LyricsService(
      { getLyrics: async () => null } as any,
      { getLyrics: async () => null } as any,
      { getLyrics: async () => [{ time: 0, text: 'a' }] as any } as any,
      { getLyrics: async () => null } as any,
    );
    const session = { id: 's3', providers: { qq: {} } };
    for (let i = 0; i < 5; i++) {
      await svc.getLyrics(session, 'qq', `t-${i}`);
    }
    const inflightSize = ((svc as any).inflightLyrics as Map<any, any>).size;
    assert.strictEqual(
      inflightSize, 0,
      `inflight 应在 promise 完成后清理，size=${inflightSize}`,
    );
    console.log('✅ 3. inflight map 完成后清理（无 key 残留）');
  }

  console.log('\n🎉 全部 3 个 lyrics coalescing 测试通过');
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
