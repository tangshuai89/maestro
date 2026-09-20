/**
 * SourceHealthService 白盒测试（Node built-in assert）。
 * 覆盖：
 *  - record 成功 / 失败 → snapshot 正确反映 total + successRate
 *  - 24h 窗口外的旧时间戳被裁剪
 *  - 没记录过的 provider → total=0，successRate=1（兜底）
 *  - lastFailureAt = 最近一次失败时间戳；无失败 → null
 *
 * 运行: npx ts-node packages/server/src/music/source-health.service.test.ts
 */
export {};
const assert = require('node:assert');
const { SourceHealthService } = require('./source-health.service');

let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

const svc = new SourceHealthService();

check('1. record ok × 2 + fail × 1 → successRate 2/3', () => {
  svc.resetForTests();
  svc.record('qq', true);
  svc.record('qq', true);
  svc.record('qq', false);
  const s = svc.snapshot();
  const qq = s.find((x: { provider: string }) => x.provider === 'qq');
  assert.strictEqual(qq.total, 3);
  assert.ok(Math.abs(qq.successRate - 2 / 3) < 1e-9);
  assert.ok(qq.lastFailureAt !== null);
});

check('2. 没记录的 provider → total=0, successRate=1', () => {
  svc.resetForTests();
  const s = svc.snapshot();
  for (const x of s) {
    assert.strictEqual(x.total, 0);
    assert.strictEqual(x.successRate, 1);
    assert.strictEqual(x.lastFailureAt, null);
  }
});

check('3. 全 success → lastFailureAt = null', () => {
  svc.resetForTests();
  svc.record('netease', true);
  svc.record('netease', true);
  const s = svc.snapshot();
  const ne = s.find((x: { provider: string }) => x.provider === 'netease');
  assert.strictEqual(ne.total, 2);
  assert.strictEqual(ne.successRate, 1);
  assert.strictEqual(ne.lastFailureAt, null);
});

check('4. 24h 外的旧时间戳在 snapshot 时被裁剪', () => {
  svc.resetForTests();
  // 用 reflection 直接写入一个 25h 前的时间戳
  const internal = svc as unknown as {
    counts: Map<string, { ok: number[]; fail: number[] }>;
  };
  internal.counts.set('qq', {
    ok: [Date.now() - 25 * 3600 * 1000], // 25h 前 → 应被裁剪
    fail: [Date.now() - 26 * 3600 * 1000],
  });
  // 加一条当下 ok
  svc.record('qq', true);
  const s = svc.snapshot();
  const qq = s.find((x: { provider: string }) => x.provider === 'qq');
  assert.strictEqual(qq.total, 1, '只剩当下那条 ok，旧的 2 条全裁掉');
  assert.strictEqual(qq.successRate, 1);
});

check('5. snapshot 顺序 = MUSIC_PROVIDERS 顺序', () => {
  svc.resetForTests();
  const s = svc.snapshot();
  const order = s.map((x: { provider: string }) => x.provider);
  assert.deepStrictEqual(order, ['qq', 'netease', 'deezer', 'spotify']);
});

check('6. 未知 provider 静默忽略', () => {
  svc.resetForTests();
  // 故意测异常输入 — service 内按运行时类型守护
  (svc as unknown as { record: (p: string, ok: boolean) => void }).record('not-a-provider', true);
  // 不抛错、snapshot 无新增
  assert.strictEqual(svc.snapshot().every((x: { total: number }) => x.total === 0), true);
});

console.log(`\n🎉 source-health.service.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);