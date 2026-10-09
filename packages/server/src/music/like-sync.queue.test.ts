/**
 * LikeSyncQueue 的指数退避 + 狂点方向翻转行为单测。
 *
 * 关注 4 个性质：
 *  1. **致命错误短路**：processor 抛 NestJS HttpException（cookie 过期 / 未登录
 *     这类不可恢复状态）→ 立即放弃，不再 sleep，不再 retry。
 *  2. **指数退避序列**：普通错误按 base * 2^n 增长，总等待时间随 attempt 翻倍。
 *  3. **jitter 抖动**：每次 sleep 含 [0, base) 的随机量，多次调用不全相等（避免
 *     多个失败 target 在同一瞬间扎堆重试）。
 *  4. **方向翻转让位（狂点场景）**：unlike 进 drain 重试中 → 用户再点 like
 *     → pending 同 key 任务 liked 翻转 → 当前 unlike 立即放弃，不浪费 64s
 *     执着一个已经过时的意图。
 *
 * 不依赖真实 provider；用 stub processor 模拟行为。
 *
 * ## 为什么 sleep 被换成「假的」
 *
 * 旧实现让退避**真实发生**：7 次尝试之间要真等 ~64s（1+2+4+8+16+32 + jitter），
 * 再用一个 90s 墙钟预算去轮询「drain 完了没」。两个问题：
 *
 *  1. **flaky**：全量测试并行 + 机器负载高时，setTimeout 回调被推迟，drain 在
 *     90s 内跑不完 → `应有 7 次尝试` 失败（2026-10-08 连续三轮复现，单跑三轮全过）
 *  2. **慢**：单跑这个文件要 ~3 分钟，而它断言的**只是 sleep 的毫秒数**
 *     —— 那些值在 `sleepCalls` 里已经捕获了，真等 64s 毫无信息量
 *
 * 现在把 `sleep` 换成即时 resolve 的 stub：断言全保留（数值照旧从 sleepCalls 读），
 * 耗时降到毫秒级，也不再有 flaky。生产代码零改动 —— 测试本来就在
 * `(q as any).sleep = ...` 上打桩。
 *
 * 第 4 条（方向翻转）原先靠「200ms 后再 enqueue」与「≥1000ms 的首次退避」赛跑，
 * 注释里自己写了「时序竞态…测试变 flaky」。现在改成**在 sleep 钩子里触发翻转** ——
 * 确定性的，不再依赖任何墙钟。
 *
 * 运行: npx ts-node src/music/like-sync.queue.test.ts
 */
export {};
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */
const { LikeSyncQueue } = require('./like-sync.queue');
const { BadRequestException } = require('@nestjs/common');

/** 假 sleep：立刻 resolve，但把请求的毫秒数记下来。
 *
 *  退避的**数值**由 sleepCalls 断言，**真实等待**没有任何断言价值，却要付 64s
 *  的墙钟代价和一份 flaky（本文件头注释有详细说明）。
 *
 *  `onSleep` 让调用方在 sleep 发生的那个点插入动作 —— 第 4 条用它做确定性的
 *  方向翻转，不再和墙钟赛跑。 */
function fakeSleep(
  sleepCalls: number[],
  onSleep?: (ms: number, index: number) => void | Promise<void>,
): (ms: number) => Promise<void> {
  return async (ms: number) => {
    sleepCalls.push(ms);
    if (onSleep) await onSleep(ms, sleepCalls.length - 1);
  };
}

/** 轮询到 drain 彻底结束。sleep 已是假的了，这里只需给事件循环几次机会。 */
async function waitDrained(q: any, budgetMs = 5000): Promise<void> {
  const start = Date.now();
  while ((q as any).draining && Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 1));
  }
  // 让最后一次 processor / sleep 回调彻底落地
  await new Promise((r) => setImmediate(r));
}

/** 跑一次 enqueue，返回 attempt 次数与请求过的 sleep 毫秒序列。 */
async function runWith(processor: () => Promise<void>) {
  const q = new LikeSyncQueue();
  let attempts = 0;
  const wrappedProcessor = async (_s: any, _p: any, _t: any, _l: any) => {
    attempts++;
    await processor();
  };
  q.registerProcessor(wrappedProcessor);
  const sleepCalls: number[] = [];
  (q as any).sleep = fakeSleep(sleepCalls);
  await q.enqueue({
    session: { id: 's', providers: {} },
    mergedId: 'm',
    liked: true,
    targets: [{ platform: 'netease', trackId: 't' }],
  });
  await waitDrained(q);
  return { attempts, sleeps: sleepCalls };
}

async function main() {
  // ── 1. 致命错误 → 立即放弃（不再 sleep、不再重试） ───────────────
  {
    const { attempts, sleeps } = await runWith(async () => {
      throw new BadRequestException('not_logged_in');
    });
    assert.strictEqual(attempts, 1, '致命错误应只尝试 1 次');
    assert.strictEqual(sleeps.length, 0, '致命错误不应 sleep');
    console.log('✅ 1. 致命错误 (BadRequestException) → 立即放弃');
  }

  // ── 2. 普通错误 → 指数退避，序列近似 base * 2^n ─────────────────
  {
    const { attempts, sleeps } = await runWith(async () => {
      throw new Error('transient');
    });
    assert.strictEqual(attempts, 7, '应有 7 次尝试');
    assert.strictEqual(sleeps.length, 6, '应 sleep 6 次（最后一次不 sleep）');
    // 期望值：~1000, ~2000, ~4000, ~8000, ~16000, ~32000；jitter 加 [0, 1000)。
    // 检查每段都在 [base*2^n, base*2^n + base) 区间内：
    for (let i = 0; i < sleeps.length; i++) {
      const lo = 1000 * 2 ** i;
      const hi = lo + 1000;
      assert.ok(
        sleeps[i] >= lo && sleeps[i] < hi,
        `sleep[${i}] = ${sleeps[i]} 不在 [${lo}, ${hi}) 区间内`,
      );
    }
    console.log('✅ 2. 指数退避序列正确（jitter 在 [0, base) 内）');
  }

  // ── 3. jitter 不是常数 → 多次调用不全相等 ───────────────────────
  {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const ms = (LikeSyncQueue as any).backoffMs(2); // 第 3 次退避
      samples.push(ms);
    }
    const distinct = new Set(samples).size;
    assert.ok(
      distinct >= 5,
      `20 次 backoffMs(2) 至少应有 5 个不同值（实际 ${distinct}），jitter 必须存在`,
    );
    console.log(`✅ 3. jitter 存在（20 次 sample → ${distinct} 个不同值，落在 [4000, 5000) ms）`);
  }

  // ── 4. 方向翻转让位（狂点场景） ────────────────────────────────
  // unlike 进 drain、processor 一直失败 → 中途用户再点 like → 当前 unlike
  // 任务应被弃，不应再消耗剩余退避 sleep。表现：attempt 远小于 7。
  //
  // 旧实现靠「enqueue 后等 200ms」与「首次退避 ≥1000ms」赛跑，注释里自己写了
  // 「时序竞态…测试变 flaky」。现在改成**在 sleep 钩子里触发翻转**：sleep 被调用
  // 那一刻就是「unlike 已经失败、正要进入下一次 attempt」的精确时刻，此时把 like
  // 塞进 pending，下一轮循环开头的 hasDirectionReversed 必命中。零墙钟依赖。
  {
    const q = new LikeSyncQueue();
    const attemptsByDir = new Map<boolean, number>(); // liked → attempts
    q.registerProcessor(async (_s: any, _p: any, _t: any, liked: boolean) => {
      attemptsByDir.set(liked, (attemptsByDir.get(liked) ?? 0) + 1);
      throw new Error('transient');
    });
    const sleepCalls: number[] = [];
    const enqueueLike = async () => {
      await q.enqueue({
        session: { id: 's', providers: {} },
        mergedId: 'm',
        liked: true,
        targets: [{ platform: 'netease', trackId: '385781' }],
      });
    };
    (q as any).sleep = fakeSleep(sleepCalls, async (_ms, i) => {
      // 只在 unlike 的第一次退避时翻转方向（同 key、liked 相反）
      if (i === 0) await enqueueLike();
    });
    await q.enqueue({
      session: { id: 's', providers: {} },
      mergedId: 'm',
      liked: false,
      targets: [{ platform: 'netease', trackId: '385781' }],
    });
    await waitDrained(q);
    const unlikeAttempts = attemptsByDir.get(false) ?? 0;
    const likeAttempts = attemptsByDir.get(true) ?? 0;
    // unlike 必须在翻转后的下一轮就放弃 —— 不死磕已过时的意图。
    // 这里可以严格断言 === 1：翻转时机由 sleep 钩子保证，不再有时序抖动。
    assert.strictEqual(
      unlikeAttempts,
      1,
      `unlike 应在方向翻转后立即让位（实际 ${unlikeAttempts} 次）`,
    );
    // 翻转信号确实送达：若 hasDirectionReversed 不工作，unlike 会跑满 7 次、
    // like 永远轮不到。
    assert.ok(likeAttempts >= 1, `翻转后 like 应被处理（实际 ${likeAttempts} 次）`);
    console.log(
      `✅ 4. 方向翻转让位（unlike=${unlikeAttempts} 次即让位，like=${likeAttempts} 次承接；零墙钟依赖）`,
    );
  }

  // ── 5. backoffMs 注入 rng → 精确值（ISSUES.md §2.11）─────────────
  // 旧实现内联 Math.random，只能断言 jitter 落在区间内；现接受可选 rng
  // 让单测断言「种子 X → 固定序列」。rng=() => 0.5 → jitter = floor(0.5*1000) = 500
  {
    const fixedRng = () => 0.5;
    // attempt=2 → base = 1000*2^2 = 4000, jitter = 500 → 4500
    const ms = (LikeSyncQueue as any).backoffMs(2, fixedRng);
    assert.strictEqual(ms, 4500, 'rng=()=>0.5 时 backoffMs(2) 应严格 = 4500');
    // attempt=0 → base = 1000, jitter = 500 → 1500
    assert.strictEqual((LikeSyncQueue as any).backoffMs(0, fixedRng), 1500);
    // attempt=5 → base = 32000, jitter = 500 → 32500
    assert.strictEqual((LikeSyncQueue as any).backoffMs(5, fixedRng), 32500);
    console.log('✅ 5. backoffMs 注入 rng → 精确值（4500 / 1500 / 32500）');
  }

  console.log('\n🎉 like-sync.queue 全部 5 项通过');
}

main().catch((err) => {
  console.error('❌ like-sync.queue 失败:', err);
  process.exit(1);
});
