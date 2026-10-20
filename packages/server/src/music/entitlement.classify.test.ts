/**
 * `entitlement.ts` 的播放失败分类单测（ADR-110 的「凭据有效 ≠ 权益有效」）。
 *
 * 为什么单独测这两个纯函数：
 *  - 它们是 ADR-110 决策的**可执行表述**（"重登有用 / 会员失效 / 换歌"是三种
 *    完全不同的用户动作），一旦被接线到生产链路就会决定用户看到什么文案；
 *  - 它们是**纯函数**（无 IO），白盒成本极低；
 *  - ⚠️ 现状提醒：截至 2026-10-20，这两个函数在**生产链路里还没有调用点**
 *    （renderer 侧另有一套 PlayFailure.reason 分级，见 usePlayer.ts）。
 *    本测试先钉住语义，接线时才有安全网。
 *
 * 运行: npx ts-node src/music/entitlement.classify.test.ts
 */
export {};
const assert = require('node:assert');

const {
  classifyPlaybackFailure,
  playbackFailureMessage,
  ENTITLEMENT_TTL_MS,
} = require('./entitlement');

function main() {
  // ── 1. 凭据失效 → relogin（唯一"重登有用"的情况，优先级最高）──
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'expired', entitlement: 'valid' }),
    'relogin',
    '凭据失效优先于其它一切（哪怕权益是有效的）',
  );
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'expired' }),
    'relogin',
    '只给凭据状态也要判 relogin',
  );

  // ── 2. 凭据有效 + 权益失效 → entitlement（重登没用）──
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'valid', entitlement: 'expired' }),
    'entitlement',
    '凭据有效但会员没了 → 是会员问题，不是登录问题',
  );

  // ── 3. 权益有效 → no-license（是"这首歌"的问题）──
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'valid', entitlement: 'valid' }),
    'no-license',
    '权益有效还失败 → 换歌，不是重登',
  );

  // ── 4. 没有权益信号（QQ）→ no-license ──
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'valid', hasEntitlementSignal: false }),
    'no-license',
    '平台没有可靠权益判据时，只能说到"这首歌取不到流"这一层',
  );

  // ── 5. 什么都不给 → unknown（不要断言原因）──
  assert.strictEqual(
    classifyPlaybackFailure({}),
    'unknown',
    '无任何信号 → unknown（泛化提示，不编原因）',
  );
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'unknown', entitlement: 'unknown' }),
    'unknown',
    'unknown + unknown → unknown',
  );

  // ── 6. entitlement='unknown' 不该被当成 expired ──
  assert.strictEqual(
    classifyPlaybackFailure({ credential: 'valid', entitlement: 'unknown' }),
    'unknown',
    '"查不到权益"不等于"权益失效" —— 不能误报成会员问题',
  );

  // ── 7. 文案与处置对得上 ──
  const relogin = playbackFailureMessage('relogin', '网易云音乐');
  const ent = playbackFailureMessage('entitlement', '网易云音乐');
  const noLic = playbackFailureMessage('no-license', '网易云音乐');
  const unknown = playbackFailureMessage('unknown', '网易云音乐');
  assert.ok(relogin.includes('重新登录'), 'relogin 文案要指向"重新登录"');
  assert.ok(ent.includes('会员'), 'entitlement 文案要指向"会员"');
  assert.ok(ent.includes('重新登录没用'), 'entitlement 文案要明说"重登没用"');
  assert.ok(noLic.includes('换'), 'no-license 文案要指向"换歌/换平台"');
  assert.ok(unknown.includes('换'), 'unknown 文案也要给出可执行动作');
  // unknown 不能断言原因
  assert.ok(!unknown.includes('会员'), 'unknown 文案不该断言是会员问题');

  // ── 8. TTL 是 5 分钟（不该每次搜索都打一次账号接口）──
  assert.strictEqual(ENTITLEMENT_TTL_MS, 5 * 60 * 1000, '权益快照 TTL 应为 5 分钟');

  console.log('✅ 1-8. entitlement 分类与文案：全部通过');
}

try {
  main();
} catch (e) {
  console.error('❌', e);
  process.exit(1);
}
