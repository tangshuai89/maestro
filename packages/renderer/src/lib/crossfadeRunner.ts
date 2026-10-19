/**
 * 切歌的**执行器** —— 把「把 URL 装进哪个槽、怎么淡、淡完谁让位」从 usePlayer
 * 里搬出来（specs/audio-fx §2.2 / tasks C1–C4）。
 *
 * 为什么要抽：这段是整个 crossfade 里唯一会**真的出声**的地方，而它的错误
 * 表现全是"听起来不对"而不是报错——双声叠加、静音、淡到一半卡住。usePlayer
 * 是个 1900 行的 hook，要测它得拉 React 运行时 + 假 <audio> + 假 AudioContext。
 * 抽成注入依赖的纯执行器后，用假元素 + 假 gain 就能把三条路径钉死。
 *
 * 两条路径（decideSwitch 判定）：
 *  - hard：装进**当前活跃槽**，另一侧收干净。与本特性落地前逐字一致。
 *  - crossfade：新歌进闲置槽淡入，旧歌留在原槽淡出，到点 pause 旧槽 + 换活跃。
 */

import {
  decideSwitch,
  resetSlotGains,
  scheduleFade,
  silenceNode,
  type FadeNodeLike,
} from './crossfade';
import type { AudioSlot, AudioSlots } from './audioSlots';

export interface SlotLoaderDeps {
  slots: AudioSlots;
  /** 该槽位的淡变增益节点；链还没建时返回 null（调用方会先 ensureGraph）。 */
  getFade(slot: AudioSlot): FadeNodeLike | null;
  /** AudioContext.currentTime（没有 ctx 时退回 0）。 */
  now(): number;
  /** 建该槽位的 Web Audio 链（幂等）。 */
  ensureGraph(slot: AudioSlot): void;
  /** 活跃槽变化后的收尾（把 analyser 状态切过去等）。 */
  onActiveChanged(slot: AudioSlot): void;
}

/** 淡出收尾的等待时间：fade 时长 + 一点余量（指数逼近永远差最后一点）。 */
const TAIL_PAD_MS = 80;
/** 硬切时 pause 前的收声时间：立刻 pause 会把淡出的尾巴切成一记爆音。 */
const HARD_STOP_MS = 120;

export interface SlotLoader {
  /** 把 `url` 装进合适的槽并起播。返回实际走的是哪条路径（测试 / 日志用）。 */
  load(url: string, wpsActive: boolean, crossfadeSec: number): 'hard' | 'crossfade';
  /** 当前是否有一段淡变正在进行中（连按 ⏭ 的判据）。 */
  isFading(): boolean;
  /** 卸载：清掉孤儿定时器。 */
  dispose(): void;
}

export function createSlotLoader(deps: SlotLoaderDeps): SlotLoader {
  /**
   * **还有哪一侧没真正闭嘴**。
   *
   * ⚠️ 这里刻意**不用"当前有没有淡变在跑"当判据**（第一版就是这么写的，
   * 被 R5 用例打红）：连按 ⏭ 时第 2 次走硬切，顺手把淡变标记清了，第 3 次就
   * 又判定成"空闲闲" → 重新 crossfade → 把新歌装进**正在收声的旧槽**，
   * 于是有 ~120ms 的双声叠加，正是 spec 明令禁止的。
   *
   * 正确的不变量是「**除活跃槽外，还有没有元素在出声**」：硬切后的收声窗口
   * 长达 HARD_STOP_MS + 淡出尾巴，这段时间里那一侧都算"没闭嘴"。
   */
  const stillAudible = new Set<AudioSlot>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** 把一侧收干净：短时间常数淡到 0，再 pause；pause 完才算"闭嘴"。 */
  const silenceAndStop = (slot: AudioSlot, el: HTMLAudioElement | null, tailMs = 0) => {
    const f = deps.getFade(slot);
    if (f) silenceNode(f, deps.now());
    stillAudible.add(slot);
    const wait = Math.max(HARD_STOP_MS, tailMs);
    setTimeout(() => {
      try {
        el?.pause();
      } catch {
        /* 元素可能已卸载 */
      }
      stillAudible.delete(slot);
    }, wait);
  };

  return {
    isFading: () => stillAudible.size > 0,

    dispose() {
      clearTimer();
      stillAudible.clear();
    },

    load(url, wpsActive, crossfadeSec) {
      clearTimer();
      const now = deps.now();
      const { slots } = deps;

      const activeSlot = slots.active();
      const activeEl = slots.get();
      // 有东西正在出声吗？没有的话淡出淡入都没意义（首播 / 暂停中切歌）。
      const hasActiveElement = !!activeEl && !activeEl.paused && !!activeEl.currentSrc;

      const decision = decideSwitch({
        crossfadeSec,
        wpsActive,
        hasActiveElement,
        fadingNow: stillAudible.size > 0,
      });

      if (decision.kind === 'hard' || !activeEl) {
        // 把**所有**还没闭嘴的侧一次收干净（含上一轮淡出中 / 硬切收声中）。
        const idleSlot = slots.other(activeSlot);
        silenceAndStop(idleSlot, slots.el(idleSlot));
        for (const s of stillAudible) silenceAndStop(s, slots.el(s));
        const activeFade = deps.getFade(activeSlot);
        if (activeFade) resetSlotGains(activeFade, null, now);
        if (activeEl) {
          activeEl.dataset.wantPlay = '1';
          activeEl.src = url;
          activeEl.load();
        }
        return 'hard';
      }

      // ── crossfade ─────────────────────────────────────────────
      const incomingSlot = slots.other(activeSlot);
      const incomingEl = slots.el(incomingSlot);
      if (!incomingEl) {
        // 次槽没挂上（理论上不会：两个 <audio> 都常驻）——退回硬切，绝不静默。
        activeEl.dataset.wantPlay = '1';
        activeEl.src = url;
        activeEl.load();
        return 'hard';
      }
      deps.ensureGraph(incomingSlot);
      const incomingFade = deps.getFade(incomingSlot);
      const outgoingFade = deps.getFade(activeSlot);

      // 新歌先静音起播再淡入：否则 play() 到第一条样本之间会有一个满音量瞬间。
      if (incomingFade) scheduleFade(incomingFade, 0, 1, now, decision.timeConstant);
      if (outgoingFade) {
        scheduleFade(outgoingFade, outgoingFade.gain.value, 0, now, decision.timeConstant);
      }

      incomingEl.dataset.wantPlay = '1';
      incomingEl.src = url;
      incomingEl.load();
      void incomingEl.play().catch(() => {
        // 自动播放被拒：canplay 时 onCanPlay 会按 wantPlay 再试一次（既有机制）。
      });

      // 旧侧进"还没闭嘴"集合：直到定时器把它 pause 掉为止，连切都判定为硬切。
      stillAudible.add(activeSlot);
      timer = setTimeout(() => {
        try {
          activeEl.pause();
        } catch {
          /* ignore */
        }
        const f = deps.getFade(activeSlot);
        if (f) silenceNode(f, deps.now());
        stillAudible.delete(activeSlot);
        timer = null;
      }, decision.stopAfterMs + TAIL_PAD_MS);

      // 逻辑上的"当前播放元素"**立即**交给新槽：进度条 / onError / 事件监听
      // 都要跟新歌，而不是等淡完。
      slots.setActive(incomingSlot);
      deps.onActiveChanged(incomingSlot);
      return 'crossfade';
    },
  };
}
