/**
 * EQ 链的构建与参数推送 —— 从 usePlayer 里抽出来的**纯逻辑**。
 *
 * 为什么抽出来：`usePlayer` 是个大 hook，测它要拉起 React 运行时 + 假 <audio>，
 * 而 EQ 这段恰恰是「最容易写错又最难察觉」的地方（串错顺序、静默、咔哒）。
 * 抽成纯函数后，用一个记录调用的假 ctx 就能把连接顺序和参数写法钉死。
 *
 * 关键约束（都来自 specs/audio-fx §7 风险）：
 *  1. **建链只在 graph 建立时做一次**，之后只改参数。播放中 disconnect/重连
 *     会发生在正在出声的时刻 → 咔哒。
 *  2. 增益一律走 `setTargetAtTime`，不用 `.value =` —— 后者是阶跃，同样咔哒。
 *  3. analyser 接在 EQ **之后**（声波环要反映用户听到的声音，不是 EQ 前的原始信号）。
 */
import { EQ_BANDS, clampGain } from './audioFx';

/** 只描述本模块用到的那几个方法，测试可传假对象，运行时是真正的 AudioContext。 */
export interface EqChainHost {
  createBiquadFilter(): BiquadFilterNode;
  destination: AudioNode;
}

export const EQ_SMOOTHING_SEC = 0.02;
/** Q=1 ≈ 1/3 倍频程带宽：相邻频段正好隔一个倍频程，Q=1 时彼此几乎不打架。 */
export const EQ_Q = 1;

/**
 * 建 10 段 peaking 并串成 `f0 → f1 → … → f9 → host.destination`。
 *
 * 增益**一律初始化为 0 dB**：调用方在建链后自行 `pushEqGains` 灌入用户偏好。
 * 这样"建链"与"填值"彻底分开，重建 graph 不会带着上一个用户的曲线。
 */
export function createEqChain(
  host: EqChainHost,
  bands: readonly { hz: number }[] = EQ_BANDS,
): BiquadFilterNode[] {
  const filters: BiquadFilterNode[] = [];
  for (const band of bands) {
    const f = host.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = band.hz;
    f.Q.value = EQ_Q;
    f.gain.value = 0;
    filters.push(f);
  }
  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
  if (filters.length > 0) filters[filters.length - 1].connect(host.destination);
  return filters;
}

/**
 * 把增益推到 live 滤波器。
 *
 * `enabled=false` 时推的是全 0 —— 即"关闭 = 各频段 ramp 到 0 dB"，而不是把滤波器
 * 从链上摘掉。真正的 bypass 要 disconnect，发生在出声时会咔哒（spec §7）。
 * 调用方负责保留 prefs 里的曲线，所以重新打开会恢复原样而不是被抹平。
 *
 * 越界/非数值的增益在这里被 `clampGain` 兜住 —— 它本来也该在写入 prefs 时就被夹，
 * 这里夹是第二道闸门（NaN 增益 = 静音且不报错）。
 */
export function pushEqGains(
  filters: readonly BiquadFilterNode[],
  gains: readonly number[],
  atTime: number,
  enabled: boolean,
): void {
  for (let i = 0; i < filters.length; i++) {
    const target = enabled ? clampGain(gains[i]) : 0;
    filters[i].gain.setTargetAtTime(target, atTime, EQ_SMOOTHING_SEC);
  }
}
