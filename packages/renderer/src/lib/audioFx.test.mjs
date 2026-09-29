// audioFx.test.mjs — EQ 频段表 / 预置 / 偏好归一（纯逻辑，无 DOM）
//
// 运行: node src/lib/audioFx.test.mjs
//
// 为什么这些纯函数值得单测：它们是 localStorage 与 Web Audio 之间的唯一闸门，
// 脏数据（手工改 localStorage / 导入旧备份）必须在这里被打成合法值，而不是
// 一路漏到 BiquadFilterNode.gain 上变成 NaN（NaN 增益 = 静音且不报错）。

import * as assert from 'node:assert';

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
  const A = await import('./audioFx.ts');
  const {
    EQ_BANDS,
    EQ_BAND_COUNT,
    EQ_PRESETS,
    FLAT_PRESET_ID,
    sliderMin,
    sliderMax,
    sliderStep,
    DEFAULT_AUDIO_FX,
    defaultAudioFx,
    clampGain,
    clampCrossfade,
    normaliseGains,
    gainForPreset,
    applyPreset,
    matchPreset,
    isFlat,
    isPresetId,
  } = A;

  // ── 1. 频段表 ──────────────────────────────────────────────
  check('1. EQ_BANDS 10 段、频率严格升序', () => {
    assert.strictEqual(EQ_BANDS.length, 10);
    assert.strictEqual(EQ_BANDS.length, EQ_BAND_COUNT);
    for (let i = 1; i < EQ_BANDS.length; i++) {
      assert.ok(EQ_BANDS[i].hz > EQ_BANDS[i - 1].hz, `第 ${i} 段频率未升序`);
    }
  });

  check('2. label 用 k 缩写（1k/2k 而不是 1000/2000）', () => {
    const labels = EQ_BANDS.map((b) => b.label);
    assert.deepStrictEqual(labels, ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']);
  });

  // ── 3. 预置 ───────────────────────────────────────────────
  check('3. 8 个预置；平直全 0；每段都在 ±12 内', () => {
    assert.strictEqual(EQ_PRESETS.length, 8);
    const flat = EQ_PRESETS.find((p) => p.id === FLAT_PRESET_ID);
    assert.ok(flat, '缺少平直预置');
    assert.deepStrictEqual(flat.gains, new Array(10).fill(0));
    for (const p of EQ_PRESETS) {
      assert.strictEqual(p.gains.length, 10, `${p.id} 不是 10 段`);
      for (const g of p.gains) {
        assert.ok(g >= sliderMin && g <= sliderMax, `${p.id} 的 ${g} 越界`);
      }
    }
  });

  check('4. 预置 id 唯一（重复会让 isPresetId / matchPreset 行为不确定）', () => {
    const ids = new Set(EQ_PRESETS.map((p) => p.id));
    assert.strictEqual(ids.size, EQ_PRESETS.length);
  });

  check('5. gainForPreset 返回副本（防污染模块级常量）', () => {
    const first = gainForPreset(EQ_PRESETS[1].id);
    first[0] = 999;
    const second = gainForPreset(EQ_PRESETS[1].id);
    assert.notStrictEqual(second[0], 999, '常量被调用方改脏了');
  });

  check('6. gainForPreset 未知 id → 全 0（不抛）', () => {
    assert.deepStrictEqual(gainForPreset('不存在的预置'), new Array(10).fill(0));
  });

  // ── 7. 归一 ───────────────────────────────────────────────
  check('7. normaliseGains：空 → 全 0；短 → 补齐；长 → 截断', () => {
    assert.deepStrictEqual(normaliseGains([]), new Array(10).fill(0));
    assert.deepStrictEqual(normaliseGains([1, 2, 3]), [1, 2, 3, 0, 0, 0, 0, 0, 0, 0]);
    const long = new Array(15).fill(3);
    assert.strictEqual(normaliseGains(long).length, 10);
  });

  check('8. normaliseGains：非数字 → 0；越界 → clamp（NaN 增益=静音且不报错）', () => {
    const out = normaliseGains([NaN, 'x', null, undefined, 999, -999, Infinity]);
    assert.strictEqual(out[0], 0);
    assert.strictEqual(out[1], 0);
    assert.strictEqual(out[2], 0);
    assert.strictEqual(out[3], 0);
    assert.strictEqual(out[4], sliderMax);
    assert.strictEqual(out[5], sliderMin);
    assert.strictEqual(out[6], 0, 'Infinity 不是有限数 → 0');
  });

  check('9. normaliseGains：非数组输入不抛', () => {
    assert.deepStrictEqual(normaliseGains(null), new Array(10).fill(0));
    assert.deepStrictEqual(normaliseGains(42), new Array(10).fill(0));
  });

  check('10. clampGain 边界', () => {
    assert.strictEqual(clampGain(0), 0);
    assert.strictEqual(clampGain(-20), sliderMin);
    assert.strictEqual(clampGain(20), sliderMax);
    assert.strictEqual(clampGain('6'), 0);
  });

  check('11. clampCrossfade：负数 → 0；>8 → 8；非数字 → 0', () => {
    assert.strictEqual(clampCrossfade(-1), 0);
    assert.strictEqual(clampCrossfade(3), 3);
    assert.strictEqual(clampCrossfade(99), 8);
    assert.strictEqual(clampCrossfade('4'), 0);
  });

  // ── 12. 预置切换 ───────────────────────────────────────────
  check('12. applyPreset 返回新对象且设置 presetId（不原地改）', () => {
    const before = defaultAudioFx();
    const after = applyPreset(before, EQ_PRESETS[2].id);
    assert.notStrictEqual(after, before);
    assert.strictEqual(before.presetId, before.presetId, '原对象被改了');
    assert.strictEqual(after.presetId, EQ_PRESETS[2].id);
    assert.deepStrictEqual(after.eqGains, EQ_PRESETS[2].gains);
  });

  check('13. matchPreset：全 0 → 平直；改动一段 → null（=已修改）', () => {
    assert.strictEqual(matchPreset(new Array(10).fill(0)), FLAT_PRESET_ID);
    const touched = [...EQ_PRESETS[2].gains];
    touched[0] += 0.5;
    assert.strictEqual(matchPreset(touched), null);
  });

  check('14. isFlat', () => {
    assert.strictEqual(isFlat(new Array(10).fill(0)), true);
    assert.strictEqual(isFlat([0, 0, 0.5]), false);
  });

  check('15. isPresetId：认得的不认得的分清', () => {
    assert.strictEqual(isPresetId(FLAT_PRESET_ID), true);
    assert.strictEqual(isPresetId('瞎写的'), false);
    assert.strictEqual(isPresetId(undefined), false);
  });

  // ── 16. 默认值 ─────────────────────────────────────────────
  check('16. defaultAudioFx() 每次都是独立对象（改了不污染 DEFAULT）', () => {
    const a = defaultAudioFx();
    a.eqGains[0] = 9;
    const b = defaultAudioFx();
    assert.strictEqual(b.eqGains[0], 0);
    assert.strictEqual(DEFAULT_AUDIO_FX.eqGains[0], 0);
  });

  check('17. 滑块步进与区间自洽（step 能整除区间）', () => {
    assert.strictEqual((sliderMax - sliderMin) % sliderStep, 0);
    assert.ok(sliderMin < 0 && sliderMax > 0);
  });

  console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} audioFx.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
