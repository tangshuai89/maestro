/**
 * A/B 音频槽位 —— crossfade 的地基（specs/audio-fx §2.2）。
 *
 * ## 为什么需要它
 *
 * 淡入淡出的本质是「**旧歌在原元素上继续播，新歌进另一个元素**」。所以必然有
 * 两个 `<audio>`，而现有代码里所有 `audioRef.current`（usePlayer 14 处、
 * useVolume、App 3 处）默认"当前播放元素 = 那个 ref"。crossfade 一开，
 * 这个假设就断了：切歌瞬间两者角色对调。
 *
 * 两种接法：
 *  1. 把 20 处 `audioRef.current` 全改成 `slots.get()` —— 看着一样，其实**全都
 *     要改**，漏一处就是"进度条不动 / 音量推错元素 / onError 不触发"这类
 *     静默 bug，而且 review 时看不出来。
 *  2. 让 `audioRef` 变成一个**每次读都指向活跃元素**的代理 —— 调用点一个字不动。
 *
 * 选 2。它把"活跃是谁"这个状态收敛到一个地方（`slots.active()`），也让
 * "切模式不重建 `<audio>`"那条老不变量（#6.3 立的）继续成立。
 *
 * ## 不变量
 *
 *  - 两个 `<audio>` 都**常驻** App，不进条件渲染：重建元素 = Web Audio graph
 *    断链 = 有声变无声（createMediaElementSource 每元素只能调一次）。
 *  - `ref(slot)` 返回的 callback **引用必须稳定**，否则 React 每次 render 都
 *    拆挂 ref（null → el），切歌瞬间可能读到 null。
 */

export type AudioSlot = 'a' | 'b';

export interface AudioSlots {
  /** 挂到 `<audio>` 上的稳定 callback ref。同一个 slot 永远返回同一个函数。 */
  ref(slot: AudioSlot): (el: HTMLAudioElement | null) => void;
  /** 当前活跃槽位的元素（没有则 null）。**替代 `audioRef.current`。** */
  get(): HTMLAudioElement | null;
  /** 取指定槽位的元素（不改变活跃槽位）。 */
  el(slot: AudioSlot): HTMLAudioElement | null;
  /** 当前活跃槽位。 */
  active(): AudioSlot;
  other(slot: AudioSlot): AudioSlot;
  /** 把"活跃"指到某槽位（元素必须已挂载）。返回是否真的换了人。 */
  setActive(slot: AudioSlot): boolean;
  /** 两个元素都给你（音量要推给**两个**，淡变中的次元素也得出声）。 */
  all(): HTMLAudioElement[];
  /** 活跃槽位变更通知。返回退订函数。 */
  subscribe(cb: (slot: AudioSlot) => void): () => void;
}

export function createAudioSlots(): AudioSlots {
  const nodes: Record<AudioSlot, HTMLAudioElement | null> = { a: null, b: null };
  let active: AudioSlot = 'a';
  const listeners = new Set<(slot: AudioSlot) => void>();

  // 引用缓存：React 靠 callback ref 的**身份**判断要不要拆挂。
  const refs: Record<AudioSlot, (el: HTMLAudioElement | null) => void> = {
    a: (el) => {
      nodes.a = el;
    },
    b: (el) => {
      nodes.b = el;
    },
  };

  return {
    ref: (slot) => refs[slot],
    get: () => nodes[active],
    el: (slot) => nodes[slot],
    active: () => active,
    other: (slot) => (slot === 'a' ? 'b' : 'a'),
    setActive: (slot) => {
      if (active === slot) return false;
      active = slot;
      for (const cb of listeners) cb(slot);
      return true;
    },
    all: () => [nodes.a, nodes.b].filter((n): n is HTMLAudioElement => n != null),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * 让一个 RefObject 只读对象"看起来"永远是活跃元素 —— usePlayer / useVolume
 * 收到的仍是 `{ current }`，14 处调用点因此零改动。
 *
 * 用 `Object.defineProperty` 的 getter 而不是 `{ get current() {} }` 字面量，
 * 是为了让类型上仍然满足 `RefObject<T>`（读-only 就够，没有代码写它）。
 */
export function activeElementProxy(slots: AudioSlots): {
  readonly current: HTMLAudioElement | null;
} {
  return Object.defineProperty({}, 'current', {
    get: () => slots.get(),
    enumerable: true,
  }) as { readonly current: HTMLAudioElement | null };
}
