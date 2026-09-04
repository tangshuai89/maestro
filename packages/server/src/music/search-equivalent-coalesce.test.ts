/**
 * searchEquivalent in-flight coalescing 回归测试。
 *
 * 背景：稳定性扫描发现 `searchEquivalent` 走「读 cache miss → await 远端 →
 * 写 cache」模式，await 间断开时同 key 并发调用各自打后端，造成 N 倍
 * quota。修复：在 cache miss 后检查 inflight map，命中则共享同一 Promise。
 *
 * 验证：
 *  1. 串行调用 N 次：只触发 1 次 searchEquivalentUncached。
 *  2. 并发 N 个 await：只触发 1 次，远端 Promise 被共享。
 *  3. 第一次失败：cache 不写（保持原「失败 ≠ 缺席」语义），后续调用
 *     可以重新发起（不被永久 cache 卡死）。
 *  4. 不同 key 不互相 coalesce。
 *
 * 运行: npx ts-node src/music/search-equivalent-coalesce.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { MusicService } = require('./music.service');
const { LyricsService } = require('./lyrics.service');

// 计数：searchEquivalentUncached 实际被触发的次数（用 stub 监视）
let uncachedCalls = 0;
let slowResolve: (() => void) | null = null;

const session = { id: 'sess-coalesce', providers: {} };

function makeMeta(title: string, artist: string, duration: number): any {
  return { title, artist, duration };
}

async function makeSvc(): Promise<any> {
  const fakeStorage = {
    get: () => undefined,
    set: () => undefined,
    flushSync: () => undefined,
  };
  const qs = {
    qq: { fetchLiked: async () => [] },
    netease: { fetchLiked: async () => [] },
    deezer: { fetchLiked: async () => [] },
    spotify: { bindSessionId: () => {}, fetchLiked: async () => [] },
    lyricsOvh: { getLyrics: async () => null },
  };
  // stub searchEquivalentUncached 实际行为：递增计数 + 等一个手动信号
  const lyricsService = new LyricsService(
    qs.netease, qs.deezer, qs.qq, qs.lyricsOvh,
  );
  const match = {};
  const ms = new MusicService(
    fakeStorage,
    qs.qq, qs.netease, qs.deezer, qs.spotify,
    qs.lyricsOvh,
    lyricsService, match,
    { registerProcessor: () => {}, registerDiscoverResolver: () => {}, enqueue: () => {}, pendingTargets: () => [] },
  );
  // monkey-patch 内部 searchEquivalentUncached 用一个慢 Promise，
  // 让我们能可靠地测「并发共享 promise」行为。
  (ms as any).searchEquivalentUncached = async () => {
    uncachedCalls++;
    return new Promise((resolve) => {
      slowResolve = () => resolve({ track: null, clean: true });
    });
  };
  return ms;
}

async function main() {
  // 测试 3 故意让 searchEquivalentUncached 返回 rejected promise 验证
  // 「失败透传 + cache 不写 + inflight 清理」语义。失败的 promise 必然
  // reject，会被 await catch 接住，但若在 finally / 微任务里晚一拍才被
  // 感知，可能触发 unhandledRejection 把 exit code 顶成 1。这里兜底
  // 避免污染整套测试的退出码。
  process.on('unhandledRejection', (err) => {
    if (!/远端 500/.test(String(err))) {
      // 不是预期的 500 拒绝：抛回去让 CI 看到真问题
      throw err;
    }
  });

  // ── 1. 串行 N 次：uncached 应只触发 1 次（第 2 次走 cache hit） ───
  {
    uncachedCalls = 0;
    slowResolve = null;
    const ms = await makeSvc();
    const meta = makeMeta('晴天', '周杰伦', 269);
    const p1 = (ms as any).searchEquivalent(session, 'qq', meta);
    slowResolve!();
    await p1;
    // 第二次：cache hit，应该 0 uncached
    await (ms as any).searchEquivalent(session, 'qq', meta);
    assert.strictEqual(
      uncachedCalls, 1,
      `串行 2 次应只触发 1 次远端，实际 ${uncachedCalls}`,
    );
    console.log('✅ 1. 串行 N 次：第 1 次触发远端，第 2 次走 cache hit（uncached=1）');
  }

  // ── 2. 并发 N 个：应只触发 1 次远端，N-1 个 awaiter 共享同一 Promise ──
  {
    uncachedCalls = 0;
    let release: (() => void) | null = null;
    let releasePromise = new Promise<void>((r) => (release = r));
    const ms = await makeSvc();
    (ms as any).searchEquivalentUncached = async () => {
      uncachedCalls++;
      return new Promise((resolve) => {
        releasePromise.then(() => resolve({ track: null, clean: true }));
      });
    };
    const meta = makeMeta('青花瓷', '周杰伦', 237);
    const N = 10;
    const promises = Array.from({ length: N }, () =>
      (ms as any).searchEquivalent(session, 'qq', meta),
    );
    // 释放远端 Promise，让所有 awaiter 一起 resolve
    release!();
    const results = await Promise.all(promises);
    assert.strictEqual(
      uncachedCalls, 1,
      `并发 ${N} 个应只触发 1 次远端，实际 ${uncachedCalls}`,
    );
    assert.strictEqual(results.length, N, '应返回 N 个结果（null 也算）');
    console.log(`✅ 2. 并发 ${N} 个：共享同一 Promise（uncached=1，所有 awaiter 一齐 resolve）`);
  }

  // ── 3. 失败：cache 不写，但 inflight 清理，后续可重试 ───────────
  {
    uncachedCalls = 0;
    let failNow = true;
    const ms = await makeSvc();
    (ms as any).searchEquivalentUncached = async () => {
      uncachedCalls++;
      if (failNow) return Promise.reject(new Error('远端 500'));
      return { track: null, clean: true };
    };
    const meta = makeMeta('稻香', '周杰伦', 223);
    // 第 1 次：失败抛错
    let threw = false;
    try {
      await (ms as any).searchEquivalent(session, 'qq', meta);
    } catch (e: any) {
      threw = true;
      assert.ok(/远端 500/.test(e.message), `错误应透传：${e.message}`);
    }
    assert.ok(threw, '失败应透传');
    assert.strictEqual(uncachedCalls, 1, '失败也消耗 1 次 inflight');
    // inflight 应已清理（p.finally 已跑）
    // 第 2 次：cache 没写、inflight 已清，远端应再次被触发
    failNow = false;
    const result = await (ms as any).searchEquivalent(session, 'qq', meta);
    assert.strictEqual(uncachedCalls, 2, '失败后第二次应再次触发（不卡死）');
    assert.strictEqual(result, null, '第二次（无 track）应返回 null');
    console.log('✅ 3. 失败透传 + cache 不写 + inflight 清理 + 后续可重试');
  }

  // ── 4. 不同 key 互不 coalesce ─────────────────────────────────────
  {
    uncachedCalls = 0;
    const ms = await makeSvc();
    (ms as any).searchEquivalentUncached = async (sess: any, p: string) => {
      uncachedCalls++;
      return { track: null, clean: true };
    };
    const metaA = makeMeta('A', 'Artist', 100);
    const metaB = makeMeta('B', 'Artist', 100);
    // 同一个 await 点两个不同 key（不同 title → cacheKey 不同）
    const [rA, rB] = await Promise.all([
      (ms as any).searchEquivalent(session, 'qq', metaA),
      (ms as any).searchEquivalent(session, 'qq', metaB),
    ]);
    assert.strictEqual(uncachedCalls, 2, '不同 key 应各触发 1 次');
    assert.strictEqual(rA, null);
    assert.strictEqual(rB, null);
    console.log('✅ 4. 不同 key 互不 coalesce（uncached=2）');
  }

  // ── 5. inflight map 在 promise 完成后真正清理（不泄漏） ───────────
  {
    uncachedCalls = 0;
    const ms = await makeSvc();
    (ms as any).searchEquivalentUncached = async () => {
      uncachedCalls++;
      return { track: null, clean: true };
    };
    const meta = makeMeta('东风破', '周杰伦', 305);
    // 跑 3 轮：每轮一个新 key
    for (let i = 0; i < 3; i++) {
      await (ms as any).searchEquivalent(
        session, 'qq', makeMeta(`title-${i}`, 'A', 100 + i),
      );
    }
    const inflightSize = ((ms as any).inflightSearchEquivalent as Map<any, any>).size;
    assert.strictEqual(
      inflightSize, 0,
      `inflight 应在 promise 完成后清理，实际 size=${inflightSize}`,
    );
    console.log('✅ 5. inflight map 完成后清理（无 key 残留）');
  }

  console.log('\n🎉 全部 5 个 coalescing 测试通过');
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
