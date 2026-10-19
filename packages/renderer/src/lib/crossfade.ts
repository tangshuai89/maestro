/**
 * crossfade 的**决策与调度** —— 从 usePlayer 里抽出来的纯逻辑
 * （specs/audio-fx §2.2 / §7，与 eqChain.ts 同一个套路）。
 *
 * 为什么单独一个文件：这段恰恰是「写错了不报错、只听起来不对」的地方
 * ——上标粘末尾那种 bug 的同类。setTargetAtTime 的时间常数算错 = 淡入淡出
 * 一头猛一头哑；连按 ⏭ 时抢跑 = 双声叠加或干脆静音。而 usePlayer 是个 1700 行的
 * hook，测它要拉起 React 运行时 + 假 <audio> + 假 AudioContext。抽出来后
 * 用**记录调用的假节点**就能把「什么时候淡、淡多久、中断时怎么收」钉死。
 *
 * 三条硬约束（都来自 spec）：
 *  1. **默认关**（crossfadeSec = 0）。关掉时 decideSwitch 必回 'hard'，
 *     调用方走的是改动前逐字相同的那条路——这是验收标准之一。
 *  2. **一律 setTargetAtTime，不碰 linearRampToValueAtTime**：后者被中断
 *     （暂停 / 连切）时会把增益**停在半路**，留下一条永远走不完的 ramp。
 *     setTargetAtTime 是指数逼近，中断时只要再发一条新的就能接管。
 *  3. **WPS 生效时 secondary 不参与**：WPS 自己解码出声，`<audio>` 再插一脚
 *     就是同一首歌两路叠加。
 */

/** setTargetAtTime 的时间常数 = 淡变时长 / 这个数。
 *  指数逼近在 n 个时间常数后已到目标的 99.3%（n=4），够接近"淡完了"。 */
export const FADE_TC_DIVISOR = 4;

export type SwitchDecision =
  | { kind: 'hard'; reason: 'off' | 'first-play' | 'wps' | 'rapid-skip' | 'no-element' }
  | { kind: 'crossfade'; fadeSec: number; timeConstant: number; stopAfterMs: number };

export interface SwitchContext {
  /** 用户偏好（秒）。0 = 关闭。 */
  crossfadeSec: number;
  /** WPS（Spotify Premium 全曲）是否正在出声。 */
  wpsActive: boolean;
  /** 当前槽位上有没有正在播的东西——没有就淡不出个所以然，只能硬切。 */
  hasActiveElement: boolean;
  /** 上一次 crossfade 还没走完（用户连按 ⏭）。 */
  fadingNow: boolean;
}

/**
 * 这次切歌走哪条路。
 *
 * `rapid-skip`（连按 ⏭）刻意**退化成硬切**而不是排队或叠加：spec §2.2 的原话
 * 是"直接把当前正在淡入的那首当作淡出对象（最坏是硬切，不能是静音或双声叠加）"。
 * 排队会让用户按了 5 次 ⏭ 之后还在听第 1 首的淡入；叠加直接双声。
 */
export function decideSwitch(ctx: SwitchContext): SwitchDecision {
  // `!(x > 0)` 会把 NaN 放行成 false… 不，`NaN > 0` 是 false 所以 `!(...)` 是 true，
  // NaN 已经挡住了；**挡不住的是 Infinity**（`Infinity > 0` 为真），脏值会让
  // 时间常数 / 停止时刻全变 Infinity = 淡变永远走不完、静音永远收不住。
  // 显式 Number.isFinite 收口。
  if (!Number.isFinite(ctx.crossfadeSec) || ctx.crossfadeSec <= 0) {
    return { kind: 'hard', reason: 'off' };
  }
  if (ctx.wpsActive) return { kind: 'hard', reason: 'wps' };
  if (!ctx.hasActiveElement) return { kind: 'hard', reason: 'no-element' };
  if (ctx.fadingNow) return { kind: 'hard', reason: 'rapid-skip' };
  return {
    kind: 'crossfade',
    fadeSec: ctx.crossfadeSec,
    timeConstant: ctx.crossfadeSec / FADE_TC_DIVISOR,
    stopAfterMs: ctx.crossfadeSec * 1000,
  };
}

/** AudioParam 的最小子集 —— 真机上是 AudioParam，测试里传记录调用的假对象。 */
export interface FadeParamLike {
  value: number;
  cancelScheduledValues(t: number): void;
  setValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, timeConstant: number): void;
}

export interface FadeNodeLike {
  gain: FadeParamLike;
}

/**
 * 排一条淡变。先 `setValueAtTime(from)` 钉住起点再 setTargetAtTime——
 * 不钉的话，增益的**当前值**（可能是上一次淡变停在半路的残留）会当起点，
 * 表现为"淡入一开始就有音量炸出来"。
 */
export function scheduleFade(
  node: FadeNodeLike,
  from: number,
  to: number,
  atTime: number,
  timeConstant: number,
): void {
  const g = node.gain;
  g.cancelScheduledValues(atTime);
  g.setValueAtTime(from, atTime);
  g.setTargetAtTime(to, atTime, Math.max(0.01, timeConstant));
}

/**
 * 立刻把这侧压到静音（连切 / 暂停 / WPS 接管时用）。
 *
 * 不写 `g.value = 0`——那是对正在出声的增益做阶跃，必然咔哒（spec §7）。
 * 同样用 setTargetAtTime，只是给一个很短的时间常数（听感上是一次 20ms 的
 * 淡出，等于"干净地收住"而不是"咔一声断掉"）。
 */
export const SILENCE_TC = 0.02;

export function silenceNode(node: FadeNodeLike, atTime: number): void {
  scheduleFade(node, node.gain.value, 0, atTime, SILENCE_TC);
}

/** 硬切时把两个槽位归位：新槽增益 1（正常音量），旧槽静音。 */
export function resetSlotGains(
  incoming: FadeNodeLike,
  outgoing: FadeNodeLike | null,
  atTime: number,
): void {
  scheduleFade(incoming, incoming.gain.value, 1, atTime, SILENCE_TC);
  if (outgoing) silenceNode(outgoing, atTime);
}
