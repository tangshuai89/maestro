// crossfadeRunner.test.mjs — 切歌执行器的三条路径（假元素 + 假 gain，不碰 Web Audio）
//
// 运行: node src/lib/crossfadeRunner.test.mjs
//
// 直接对应 specs/audio-fx 的验收标准：
//   1. crossfade 开 → 两首重叠渐变；关 → 与本特性落地前**逐字一致**（都是 hard）
//   2. 连按 ⏭ 三次 → 不叠音、不静音（每次切完只有一个元素在响）
//   3. `<audio>` 恒为 2，切 theater/lite/mini 不重建（槽位对象不换身份）
//   4. WPS 生效 → secondary 不参与

import * as assert from 'node:assert';
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

/** 假 <audio>：记 src / play / pause / load，paused 与 currentSrc 可控。 */
function makeEl(name) {
  const el = {
    name,
    _src: '',
    // 真机上 currentSrc 是 src 的镜像（load 之后）。测试替身必须照做，
    // 否则 hasActiveElement 判据（!!currentSrc）在用例里失真。
    get src() {
      return this._src;
    },
    set src(v) {
      this._src = v;
      this.currentSrc = v;
    },
    paused: true,
    currentSrc: '',
    dataset: {},
    loaded: 0,
    played: 0,
    load() {
      this.loaded++;
      this.currentSrc = this.src;
    },
    play() {
      this.played++;
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
  return el;
}

/** 记录调用的假 gain */
function makeGain(v = 1) {
  const calls = [];
  const gainObj = {
    value: v,
    cancelScheduledValues: (t) => calls.push({ kind: 'cancel', t }),
    setValueAtTime: (val, t) => {
      calls.push({ kind: 'setValueAtTime', v: val, t });
      gainObj.value = val; // 真机上 AudioParam.value 会真的变成新值
    },
    setTargetAtTime: (val, t, tc) => calls.push({ kind: 'setTargetAtTime', v: val, t, tc }),
  };
  return {
    calls,
    gain: gainObj,
    get last() {
      return calls.at(-1);
    },
    get value() {
      return gainObj.value;
    },
    set value(nv) {
      gainObj.value = nv;
    },
  };
}

/** 一套完整的假世界：两个槽位 + 两条增益链。 */
function makeWorld() {
  const slots = createAudioSlots();
  const els = { a: makeEl('a'), b: makeEl('b') };
  slots.ref('a')(els.a);
  slots.ref('b')(els.b);
  const gains = { a: makeGain(1), b: makeGain(1) };
  const events = [];
  const loader = createSlotLoader({
    slots,
    getFade: (s) => gains[s],
    now: () => 0,
    ensureGraph: (s) => events.push({ type: 'ensureGraph', slot: s }),
    onActiveChanged: (s) => events.push({ type: 'activeChanged', slot: s }),
  });
  /** 当前"在响"的元素：没暂停的那个。 */
  const sounding = () => [els.a, els.b].filter((e) => !e.paused);
  return { slots, els, gains, loader, events, sounding };
}

// 模块必须在 loader 注册**之后**再 import：静态 import 会被提升到注册之前，
// 那时无扩展名解析还没生效（eqChain.test.mjs 同款写法）。
const { createSlotLoader } = await import('./crossfadeRunner.ts');
const { createAudioSlots } = await import('./audioSlots.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${err.message}`);
    failed++;
  }
}

await check('R1. crossfade 关（sec=0）→ 走 hard：装进活跃槽，另一侧不动', async () => {
  const w = makeWorld();
  w.els.a.paused = false;
  w.els.a.src = 'old.mp3';
  const kind = w.loader.load('new.mp3', false, 0);
  assert.strictEqual(kind, 'hard');
  assert.strictEqual(w.els.a.src, 'new.mp3', '应装进当前活跃槽');
  assert.strictEqual(w.els.a.loaded, 1);
  assert.strictEqual(w.els.b.src, '', '次槽不该被碰');
  assert.strictEqual(w.events.filter((e) => e.type === 'ensureGraph').length, 0, '不该建链');
  w.loader.dispose();
});

await check('R2. crossfade 关 → 活跃槽增益归 1（不被上一次淡变留下的低音量锁死）', async () => {
  const w = makeWorld();
  w.gains.a.gain.value = 0.2; // 模拟上次淡出停在半路
  w.els.a.paused = false;
  w.els.a.src = 'old.mp3';
  w.loader.load('new.mp3', false, 0);
  assert.strictEqual(w.gains.a.last.v, 1, '活跃槽必须回到满音量');
  assert.strictEqual(w.gains.a.last.kind, 'setTargetAtTime');
  w.loader.dispose();
});

await check(
  'R3. crossfade 开 → 走 crossfade：新歌进次槽、淡入，旧槽淡出，活跃立即易主',
  async () => {
    const w = makeWorld();
    w.els.a.paused = false;
    w.els.a.src = 'song1.mp3';
    const kind = w.loader.load('song2.mp3', false, 2);
    assert.strictEqual(kind, 'crossfade');
    assert.strictEqual(w.els.b.src, 'song2.mp3', '新歌进次槽');
    assert.strictEqual(w.els.a.src, 'song1.mp3', '旧歌留在原槽继续播');
    assert.strictEqual(w.sounding().length, 2, '此刻两首都在响（这就是重叠渐变）');
    assert.strictEqual(w.slots.active(), 'b', '逻辑上的当前播放立即交给新槽');
    const inc = w.gains.b.calls;
    assert.deepStrictEqual(inc[1], { kind: 'setValueAtTime', v: 0, t: 0 }, '新槽从 0 起');
    assert.strictEqual(inc.at(-1).v, 1, '新槽淡入到 1');
    const out = w.gains.a.calls;
    assert.strictEqual(out.at(-1).v, 0, '旧槽淡出到 0');
    w.loader.dispose();
  },
);

await check('R4. 淡出结束：旧槽被 pause，isFading 归 false（不残留"正在淡"状态）', async () => {
  const w = makeWorld();
  w.els.a.paused = false;
  w.els.a.src = 'song1.mp3';
  w.loader.load('song2.mp3', false, 0.2);
  assert.strictEqual(w.loader.isFading(), true);
  await sleep(400);
  assert.strictEqual(w.els.a.paused, true, '旧槽应已暂停');
  assert.strictEqual(w.loader.isFading(), false);
  assert.strictEqual(w.sounding().length, 1, '只剩新歌在响');
  w.loader.dispose();
});

await check('R5. 连按 ⏭ 三次：不叠音、不静音（第一次重叠，后两次硬切）', async () => {
  const w = makeWorld();
  w.els.a.paused = false;
  w.els.a.src = 's1.mp3';
  w.els.a.src = 's1.mp3';
  w.els.a.paused = false;
  assert.strictEqual(w.loader.load('s2.mp3', false, 3), 'crossfade');
  assert.strictEqual(w.sounding().length, 2, '第一次是重叠渐变（预期行为）');
  // 连按两次：fadingNow=true → 两次都退化成 hard
  const r3 = w.loader.load('s3.mp3', false, 3);
  const r4 = w.loader.load('s4.mp3', false, 3);
  assert.strictEqual(r3, 'hard', '连切必须退化成硬切');
  assert.strictEqual(r4, 'hard');
  assert.strictEqual(w.slots.get().src, 's4.mp3', '当前元素装的是最后一首');
  // 旧槽是"淡出中 + 120ms 后 pause"，所以要在收声窗口**之后**断言"只有 1 个在响"
  await sleep(250);
  const sounding = w.sounding();
  assert.strictEqual(sounding.length, 1, `连切后应只剩 1 个在响，实际 ${sounding.length}`);
  assert.strictEqual(sounding[0].src, 's4.mp3', '留下的是最后一首（不是静音）');
  assert.strictEqual(w.slots.get().paused, false, '当前歌不该被误 pause');
  w.loader.dispose();
});

await check('R6. WPS 生效 → 走 hard，次槽完全不参与（不与 SDK 输出叠加）', async () => {
  const w = makeWorld();
  w.els.a.paused = false;
  w.els.a.src = 'old.mp3';
  const kind = w.loader.load('new.mp3', true, 5);
  assert.strictEqual(kind, 'hard');
  assert.strictEqual(w.els.b.src, '');
  assert.strictEqual(w.sounding().length, 1);
  w.loader.dispose();
});

await check('R7. 首播（活跃槽没在响）→ hard，不做"从 0 淡入"', async () => {
  const w = makeWorld();
  const kind = w.loader.load('first.mp3', false, 4);
  assert.strictEqual(kind, 'hard');
  assert.strictEqual(w.els.a.src, 'first.mp3');
  w.loader.dispose();
});

await check('R8. 槽位对象不换身份 → `<audio>` 恒为 2，切视图模式不重建', async () => {
  const w = makeWorld();
  const refA = w.slots.ref('a');
  const refB = w.slots.ref('b');
  assert.strictEqual(
    w.slots.ref('a'),
    refA,
    '同槽位的 callback ref 必须同一引用（否则 React 每次 render 拆挂）',
  );
  assert.strictEqual(w.slots.ref('b'), refB);
  // 反复切歌 + 切"模式"（这里体现为随机 get/setActive）后，元素仍是原来两个
  w.els.a.paused = false;
  w.els.a.src = 'x.mp3';
  for (let i = 0; i < 6; i++) {
    w.loader.load(`t${i}.mp3`, false, i % 2 ? 0 : 2);
    await sleep(5);
  }
  assert.strictEqual(w.slots.el('a'), w.els.a, 'a 槽元素被换过（= 重建 <audio>）');
  assert.strictEqual(w.slots.el('b'), w.els.b, 'b 槽元素被换过');
  w.loader.dispose();
});

await check('R9. 次槽没挂上（异常兜底）→ 退回 hard 并照常装载，不静默失败', async () => {
  const w = makeWorld();
  w.slots.ref('b')(null);
  w.els.a.paused = false;
  w.els.a.src = 'old.mp3';
  const kind = w.loader.load('new.mp3', false, 3);
  assert.strictEqual(kind, 'hard');
  assert.strictEqual(w.els.a.src, 'new.mp3');
  w.loader.dispose();
});

await check('R10. dispose 后定时器不再动元素（卸载不留孤儿 pause）', async () => {
  const w = makeWorld();
  w.els.a.paused = false;
  w.els.a.src = 'old.mp3';
  w.loader.load('new.mp3', false, 1);
  w.loader.dispose();
  w.els.a.paused = false; // 假装用户又按了播放
  await sleep(300);
  assert.strictEqual(w.els.a.paused, false, 'dispose 后旧定时器不该再 pause 元素');
});

console.log(`\n🎉 crossfadeRunner.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
