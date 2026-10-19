// crossfade.test.mjs — 切歌决策与淡变调度（纯逻辑，无 Web Audio / 无 DOM）
//
// 运行: node src/lib/crossfade.test.mjs
//
// 守的是四条「写错了不报错、只听起来不对」的不变量（specs/audio-fx C 组）：
//   1. 默认关 → decideSwitch 恒回 hard（关掉时行为必须与改动前逐字一致）
//   2. WPS 在出声 / 首播 / 连按 ⏭ → 退化成硬切，绝不排队、绝不叠加
//   3. 淡变一律 setTargetAtTime（不用 linearRampToValueAtTime / .value =）
//   4. 淡变前必须 setValueAtTime 钉住起点（否则从"上次残留增益"起步 → 炸音）

import * as assert from 'node:assert';
import {
  decideSwitch,
  scheduleFade,
  silenceNode,
  resetSlotGains,
  FADE_TC_DIVISOR,
  SILENCE_TC,
} from './crossfade.ts';

/** 记录调用的假 GainNode */
function makeGain(value = 1) {
  const calls = [];
  return {
    calls,
    gain: {
      value,
      cancelScheduledValues: (t) => calls.push({ kind: 'cancel', t }),
      setValueAtTime: (v, t) => calls.push({ kind: 'setValueAtTime', v, t }),
      setTargetAtTime: (v, t, tc) => calls.push({ kind: 'setTargetAtTime', v, t, tc }),
    },
  };
}

function ctx(over = {}) {
  return {
    crossfadeSec: 3,
    wpsActive: false,
    hasActiveElement: true,
    fadingNow: false,
    ...over,
  };
}

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${err.message}`);
    failed++;
  }
}

check('X1. 默认关（crossfadeSec=0）→ hard/off，且排在所有其它理由之前', () => {
  const d = decideSwitch(ctx({ crossfadeSec: 0, wpsActive: true, hasActiveElement: false }));
  assert.deepStrictEqual(d, { kind: 'hard', reason: 'off' });
});

check('X2. 负数 / NaN 时长也当关闭（脏 localStorage 不能把淡变打开）', () => {
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepStrictEqual(decideSwitch(ctx({ crossfadeSec: bad })), {
      kind: 'hard',
      reason: 'off',
    });
  }
});

check('X3. 正常条件 → crossfade，时间常数 = 时长/4，停止时刻 = 时长', () => {
  const d = decideSwitch(ctx({ crossfadeSec: 4 }));
  assert.strictEqual(d.kind, 'crossfade');
  assert.strictEqual(d.fadeSec, 4);
  assert.strictEqual(d.timeConstant, 4 / FADE_TC_DIVISOR);
  assert.strictEqual(d.stopAfterMs, 4000);
});

check('X4. 首播（没有可淡出的东西）→ hard/no-element，不做"从 0 淡入"', () => {
  assert.deepStrictEqual(decideSwitch(ctx({ hasActiveElement: false })), {
    kind: 'hard',
    reason: 'no-element',
  });
});

check('X5. WPS 在出声 → hard/wps（secondary 不参与，否则同歌双路叠加）', () => {
  assert.deepStrictEqual(decideSwitch(ctx({ wpsActive: true })), {
    kind: 'hard',
    reason: 'wps',
  });
});

check('X6. 连按 ⏭（上一次还在淡）→ hard/rapid-skip：不排队、不叠加', () => {
  assert.deepStrictEqual(decideSwitch(ctx({ fadingNow: true })), {
    kind: 'hard',
    reason: 'rapid-skip',
  });
});

check('X7. scheduleFade：先 cancel + setValueAtTime 钉起点，再 setTargetAtTime', () => {
  const n = makeGain(0.37); // 上一次淡变停在半路的残留值
  scheduleFade(n, 0, 1, 10, 0.75);
  assert.deepStrictEqual(
    n.calls.map((c) => c.kind),
    ['cancel', 'setValueAtTime', 'setTargetAtTime'],
  );
  assert.deepStrictEqual(n.calls[1], { kind: 'setValueAtTime', v: 0, t: 10 });
  assert.deepStrictEqual(n.calls[2], { kind: 'setTargetAtTime', v: 1, t: 10, tc: 0.75 });
});

check('X8. scheduleFade：不碰 .value = （阶跃 = 咔哒），时间常数有下限', () => {
  const n = makeGain(1);
  scheduleFade(n, 1, 0, 0, 0);
  assert.ok(
    n.calls.every((c) => c.kind !== 'setValue'),
    '出现了阶跃赋值',
  );
  const last = n.calls.at(-1);
  assert.ok(last.tc >= 0.01, `时间常数应被兜到 ≥0.01（实际 ${last.tc}）`);
});

check('X9. silenceNode：cancel + 从当前值淡到 0，短时间常数', () => {
  const n = makeGain(0.42);
  silenceNode(n, 5);
  assert.deepStrictEqual(
    n.calls.map((c) => c.kind),
    ['cancel', 'setValueAtTime', 'setTargetAtTime'],
  );
  assert.strictEqual(n.calls[1].v, 0.42, '起点必须是增益的当前值');
  assert.strictEqual(n.calls[2].v, 0);
  assert.strictEqual(n.calls[2].tc, SILENCE_TC);
});

check('X10. resetSlotGains：新槽回 1（旧残留音量），旧槽静音', () => {
  const incoming = makeGain(0);
  const outgoing = makeGain(1);
  resetSlotGains(incoming, outgoing, 2);
  const inc = incoming.calls.at(-1);
  const out = outgoing.calls.at(-1);
  assert.deepStrictEqual(inc, { kind: 'setTargetAtTime', v: 1, t: 2, tc: SILENCE_TC });
  assert.deepStrictEqual(out, { kind: 'setTargetAtTime', v: 0, t: 2, tc: SILENCE_TC });
});

check('X11. resetSlotGains：没有旧槽（首次）也不该炸', () => {
  const incoming = makeGain(0);
  assert.doesNotThrow(() => resetSlotGains(incoming, null, 0));
  assert.strictEqual(incoming.calls.at(-1).v, 1);
});

console.log(`🎉 crossfade.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
