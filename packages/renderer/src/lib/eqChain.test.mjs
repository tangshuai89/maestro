// eqChain.test.mjs — EQ 链的连接顺序与参数写法（假 AudioContext，无需 Web Audio）
//
// 运行: node src/lib/eqChain.test.mjs
//
// 这组测试守的是三条「写错了也不会报错、只会听起来不对」的不变量：
//   1. 串接顺序 f0→f1→…→f9（串反了 = 每个频段的邻接关系错位，听感是"整体发糊"）
//   2. 增益用 setTargetAtTime 而不是 `.value =`（后者是阶跃 → 每拖一次滑块咔哒一声）
//   3. 建链时增益恒为 0（重建 graph 不能带着上一个用户的曲线）

import * as assert from 'node:assert';

// eqChain.ts 有值导入 './audioFx'（无扩展名），node ESM 解析不了 —— 注册 inline loader
// 补 .ts（与 groupLibrary / lyricsShare / storage 测试同款）。
import { register } from 'node:module';
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
    const parent = context.parentURL;
    if (parent && parent.endsWith('.ts')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    }
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

/** 记录 connect / setTargetAtTime 调用的假节点 */
function makeFilter(tag) {
  const calls = [];
  return {
    tag,
    calls,
    type: '',
    Q: { value: 0 },
    frequency: { value: 0 },
    gain: {
      value: 0,
      setTargetAtTime: (v, t, tc) => calls.push({ kind: 'setTargetAtTime', v, t, tc }),
      // `.value =` 赋值也要能被观测到——否则「有人改成阶跃」测不出来
      set value(v) {
        this._v = v;
        calls.push({ kind: 'value=', v });
      },
      get value() {
        return this._v ?? 0;
      },
    },
    connect: (node) => calls.push({ kind: 'connect', to: node && node.tag }),
  };
}

function makeHost(n = 10) {
  const filters = [];
  let i = 0;
  return {
    filters,
    host: {
      destination: { tag: 'destination' },
      createBiquadFilter: () => {
        const f = makeFilter(`f${i++}`);
        filters.push(f);
        return f;
      },
    },
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

async function main() {
  const { createEqChain, pushEqGains, EQ_Q, EQ_SMOOTHING_SEC } = await import('./eqChain.ts');
  const { EQ_BANDS, sliderMin, sliderMax } = await import('./audioFx.ts');

  // ── 1. 建链 ────────────────────────────────────────────────
  check('1. 建 10 个 peaking 滤波器，频率对应频段表，Q=1，增益初始 0', () => {
    const { host, filters } = makeHost();
    const built = createEqChain(host, EQ_BANDS);
    assert.strictEqual(built.length, 10);
    assert.strictEqual(filters.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(filters[i].type, 'peaking', `第 ${i} 段不是 peaking`);
      assert.strictEqual(filters[i].frequency.value, EQ_BANDS[i].hz);
      assert.strictEqual(filters[i].Q.value, EQ_Q);
      assert.strictEqual(filters[i].gain.value, 0, '建链时增益必须是 0');
    }
  });

  check('2. 串接顺序 f0→f1→…→f9→destination', () => {
    const { host, filters } = makeHost();
    createEqChain(host, EQ_BANDS);
    const conns = filters.map((f) => f.calls.find((c) => c.kind === 'connect'));
    for (let i = 0; i < 9; i++) {
      assert.ok(conns[i], `第 ${i} 段没有 connect`);
      assert.strictEqual(conns[i].to, `f${i + 1}`, `第 ${i} 段接错了`);
    }
    assert.strictEqual(conns[9].to, 'destination', '最后一段没接 destination');
  });

  check('3. source 不直接接 destination（否则 EQ 被短路）', () => {
    // createEqChain 不碰 source；这里断言它**只**创建滤波器并串联，
    // 没有把最后一节接到别处（destination 之外的多余连接 = 信号被复制）
    const { host, filters } = makeHost();
    createEqChain(host, EQ_BANDS);
    const allConnects = filters.flatMap((f) => f.calls.filter((c) => c.kind === 'connect'));
    assert.strictEqual(allConnects.length, 10, '连接数应该是 10（9 内部 + 1 到 destination）');
  });

  // ── 4. 推参数 ──────────────────────────────────────────────
  check('4. pushEqGains 开启时按段推，且走 setTargetAtTime（不是 .value =）', () => {
    const { host, filters } = makeHost();
    const built = createEqChain(host, EQ_BANDS);
    const gains = [1, -2, 3, 4, 5, 6, 7, 8, 9, 10];
    // 建链时会写一次 gain.value=0（初始化，合理）；这里量的是「push 之后有没有新增阶跃赋值」
    const assignBefore = filters.map(
      (f) => f.calls.filter((c) => c.kind === 'value=').length,
    );
    pushEqGains(built, gains, 12.5, true);
    for (let i = 0; i < 10; i++) {
      const ramp = filters[i].calls.filter((c) => c.kind === 'setTargetAtTime');
      assert.strictEqual(ramp.length, 1, `第 ${i} 段没走 setTargetAtTime`);
      assert.strictEqual(ramp[0].v, gains[i]);
      assert.strictEqual(ramp[0].t, 12.5);
      assert.strictEqual(ramp[0].tc, EQ_SMOOTHING_SEC);
      assert.strictEqual(
        filters[i].calls.filter((c) => c.kind === 'value=').length,
        assignBefore[i],
        `第 ${i} 段用了 .value = 赋值（阶跃会咔哒）`,
      );
    }
  });

  check('5. 关闭时全段推 0（而不是设成各自的曲线值）', () => {
    const { host, filters } = makeHost();
    const built = createEqChain(host, EQ_BANDS);
    pushEqGains(built, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], 0, false);
    for (let i = 0; i < 10; i++) {
      const ramp = filters[i].calls.filter((c) => c.kind === 'setTargetAtTime');
      assert.strictEqual(ramp[0].v, 0, `第 ${i} 段关闭时没归零`);
    }
  });

  check('6. 越界 / 非数值增益被夹（NaN 增益 = 静音且不报错）', () => {
    const { host, filters } = makeHost();
    const built = createEqChain(host, EQ_BANDS);
    pushEqGains(built, [999, -999, NaN, 'x', null, undefined, 3, 3, 3, 3], 0, true);
    const got = filters.map((f) => f.calls.find((c) => c.kind === 'setTargetAtTime').v);
    assert.strictEqual(got[0], sliderMax);
    assert.strictEqual(got[1], sliderMin);
    assert.ok(Number.isFinite(got[2]), 'NaN 漏过去了');
    assert.strictEqual(got[2], 0);
    assert.ok(got.every((v) => Number.isFinite(v) && v >= sliderMin && v <= sliderMax));
  });

  check('7. 增益数组比滤波器少几段也不越界访问', () => {
    const { host, filters } = makeHost();
    const built = createEqChain(host, EQ_BANDS);
    pushEqGains(built, [1, 2], 0, true); // 只有 2 个值
    for (let i = 0; i < 10; i++) {
      const ramp = filters[i].calls.filter((c) => c.kind === 'setTargetAtTime');
      assert.strictEqual(ramp.length, 1, `第 ${i} 段漏推或越界`);
    }
    assert.strictEqual(
      filters[0].calls.find((c) => c.kind === 'setTargetAtTime').v,
      1,
    );
    assert.strictEqual(
      filters[2].calls.find((c) => c.kind === 'setTargetAtTime').v,
      0,
      '缺失的段应补 0',
    );
  });

  check('8. 空链（graph 未建）→ 不抛', () => {
    pushEqGains([], [1, 2, 3], 0, true);
  });

  console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} eqChain.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
