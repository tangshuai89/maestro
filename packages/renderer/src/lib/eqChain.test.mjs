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

/** 记录 connect 调用的假 source（MediaElementAudioSourceNode 的替身）。 */
function makeSource(tag) {
  const calls = [];
  return {
    tag,
    calls,
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

  check('2. 段间串接顺序 f0→f1→…→f9（末端由调用方接）', () => {
    const { host, filters } = makeHost();
    createEqChain(host, EQ_BANDS);
    const conns = filters.map((f) => f.calls.find((c) => c.kind === 'connect'));
    for (let i = 0; i < 9; i++) {
      assert.ok(conns[i], `第 ${i} 段没有 connect`);
      assert.strictEqual(conns[i].to, `f${i + 1}`, `第 ${i} 段接错了`);
    }
    assert.strictEqual(
      filters[9].calls.filter((c) => c.kind === 'connect').length,
      0,
      'f9 不该由本函数接 destination —— 调用方要串 analyser（见用例 4）',
    );
  });

  // 🔴 这条是 2026-09-29 那个"能搜索能取流就是不响"的回归测试。
  // createMediaElementSource 之后 <audio> 输出永久改路由到 Web Audio 图上，
  // 漏掉 source→f0 这一行 = 全静音且**没有任何报错**（当时 8 个测试全绿，
  // 因为没有一个断言 source 有没有被接上）。这条断言专门守它。
  check('3. source 必须接到 f0（漏了就是全静音，且不报错）', () => {
    const { host, filters } = makeHost();
    const source = makeSource('src');
    createEqChain(host, EQ_BANDS, source);
    const conn = source.calls.find((c) => c.kind === 'connect');
    assert.ok(conn, 'source 没有被 connect —— 音频会永久静音');
    assert.strictEqual(conn.to, 'f0', 'source 必须接链首 f0，不是 f9 或 destination');
    assert.strictEqual(
      source.calls.filter((c) => c.kind === 'connect').length,
      1,
      'source 只接一次（接两次 = 信号叠加）',
    );
  });

  check('4. 不传 source 时不连任何东西（容忍 graph 未建）', () => {
    const { host, filters } = makeHost();
    createEqChain(host, EQ_BANDS);
    const allConnects = filters.flatMap((f) => f.calls.filter((c) => c.kind === 'connect'));
    assert.strictEqual(allConnects.length, 9, '只有 9 条段间连接，没有任何对外连接');
    assert.strictEqual(
      filters[9].calls.filter((c) => c.kind === 'connect').length,
      0,
      '末端不接 destination（destination 只应收到 analyser 这一条路的信号）',
    );
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
