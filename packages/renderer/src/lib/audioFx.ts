/**
 * EQ 频段表 / 预置 / 纯计算 —— 为什么单独一个文件？
 *
 * 这三样东西有三个共同点：纯数据、没有副作用、而且**会被 UI 和音频链同时读**。
 * 塞进 usePlayer 就变成 hook 的内部实现，渲染 10 个滑块时只能"再抄一份"，
 * 两份一漂移就是"预置面板显示 10 段、实际生效 9 段"这种静默错位 bug。
 * 集中在一处 = 一份数据两处用；纯函数能被 node 直接白盒测（不碰 AudioContext、
 * 不碰 DOM、不用等 CI 的 vite 起来），几毫秒跑完。
 *
 * 边界：本文件**只管数据与算法**，一律不碰 Web Audio。增益怎么落到
 * BiquadFilter 上是 usePlayer 的职责（见 specs/audio-fx §6/§7 的 graph 约束），
 * 两者分开的理由是"改 UI 不该有能力重排音频链"。
 *
 * 数值约定：
 *  - 频率取 ISO 266 的 1/1 倍频程常用值（31 → 16k，共 10 段 octave）；
 *  - 所有增益单位 dB，范围 ±12，步进 0.5；
 *  - 预置里的数字**手调过**，不是随机数——EQ 一旦填假值，用户听到的
 *    "流行/摇滚"根本不是那个曲线，比没有预置更糟。
 */

/** 频段数量。UI 的滑块数量、normalise 的长度都以它为准，不在别处写死 10。 */
export const EQ_BAND_COUNT = 10;

/** 滑块属性常量：Settings 的 <input type=range> 直接吃这三个值。 */
export const sliderMin = -12;
export const sliderMax = 12;
export const sliderStep = 0.5;

/** crossfade 时长范围（秒）。默认 0 = 关闭，见 spec §2.2 的取舍说明。 */
export const CROSSFADE_MIN = 0;
export const CROSSFADE_MAX = 8;

export interface EqBand {
  /** 中心频率（Hz），直接给 BiquadFilterNode.frequency 用 */
  hz: number;
  /** UI 上的短标签。1000 以上用 k 缩写（1k 而不是 1000），10 个标签并排才不挤 */
  label: string;
}

/**
 * 10 段倍频程频段。低频四段（31–500）管鼓/贝斯，中频三段（1k–4k）管
 * 人声与临场感，高频三段（8k–16k）管镲片与空气感——预置曲线的设计
 * 基本都落在这三段的取舍上。
 */
export const EQ_BANDS: readonly EqBand[] = [
  { hz: 31, label: '31' },
  { hz: 62, label: '62' },
  { hz: 125, label: '125' },
  { hz: 250, label: '250' },
  { hz: 500, label: '500' },
  { hz: 1000, label: '1k' },
  { hz: 2000, label: '2k' },
  { hz: 4000, label: '4k' },
  { hz: 8000, label: '8k' },
  { hz: 16000, label: '16k' },
];

export interface EqPreset {
  /** 稳定标识，落盘用；**不要**改已有 id，否则老用户存的 presetId 失效 */
  id: string;
  /** 设置面板上的中文名 */
  name: string;
  /** 一句话说明它干了什么。10 个滑块本身讲不清"这曲线适合什么" */
  hint: string;
  /** 10 段增益（dB），下标与 EQ_BANDS 一一对应 */
  gains: number[];
}

/** 平直预置的 id。它同时是所有"回落目标"，所以单独导出而不是到处写字符串。 */
export const FLAT_PRESET_ID = 'flat';

export const EQ_PRESETS: readonly EqPreset[] = [
  {
    id: FLAT_PRESET_ID,
    name: '平直',
    hint: '不做任何修正，10 段全 0 dB',
    // 必须全 0：它是"什么都没开"的基准，也是关 EQ 时用户一键回到的位置
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'pop',
    name: '流行',
    hint: '抬低频与 1k–2k 人声段，鼓点厚、唱腔靠前',
    gains: [2, 1.5, 0, -0.5, 1, 1.5, 2, 1, 0.5, 0],
  },
  {
    id: 'rock',
    name: '摇滚',
    hint: '推中低频、抬 4k–8k 镲片，吉他层次更明显',
    gains: [3, 2.5, 1, -1, -1.5, 1, 2.5, 3.5, 3, 1.5],
  },
  {
    id: 'classical',
    name: '古典',
    hint: '轻收低频、把中高频让给弦乐与厅堂感',
    gains: [-2, -1.5, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3],
  },
  {
    id: 'vocal',
    name: '人声',
    hint: '挖掉极低与极高、抬中频，伴奏退后突出唱腔',
    gains: [-4, -3, -1, 1, 3, 3.5, 2, -0.5, -1.5, -2],
  },
  {
    id: 'bass',
    name: '低音增强',
    hint: '大幅抬 31–250 Hz，重低音曲目用；耳机音量要收一点',
    gains: [7, 6, 4, 1.5, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'treble',
    name: '高音增强',
    hint: '抬 2k 以上，镲片与齿音更亮，录音偏暗的音源受益',
    gains: [0, 0, 0, 0, 0, 0.5, 1.5, 3, 4.5, 5],
  },
  {
    id: 'night',
    name: '夜间',
    hint: '整体收敛并压低中高频，夜里听不吵、不穿透隔壁',
    gains: [-3, -2.5, -1.5, 0, -1, -2, -2.5, -3, -3, -2.5],
  },
];

const EQ_PRESET_IDS: ReadonlySet<string> = new Set(EQ_PRESETS.map((p) => p.id));

/** 设置页持久化的全部音频偏好。跨功能放一个 key，方便整体备份/恢复。 */
export interface AudioFxPrefs {
  /** EQ 总开关。关闭时音频链要**真旁路**（reconnect 绕开 filter），不是设 0 dB */
  eqEnabled: boolean;
  /** 10 段增益（dB），下标对应 EQ_BANDS；读出来永远是长度 10 的合法数组 */
  eqGains: number[];
  /**
   * 用户最后点选的预置 id；一旦手动拖过滑块就置 null（= 已修改）。
   * 存 id 而不是存"当前是第几个"，是为了以后加预置不打乱老用户的记录。
   */
  presetId: string | null;
  /** crossfade 时长（秒），0 = 关闭。本轮只做读写，行为在 C 组 */
  crossfadeSec: number;
}

/** 把任意输入夹到合法 dB 区间。非数字（NaN / 字符串 / null / 对象）一律当 0 —— 脏数据要能打不挂。 */
export function clampGain(dB: unknown): number {
  if (typeof dB !== 'number' || !Number.isFinite(dB)) return 0;
  if (dB < sliderMin) return sliderMin;
  if (dB > sliderMax) return sliderMax;
  return dB;
}

/**
 * 把任意形状的增益数组整成"长度恰好 10、每项合法"的新数组。
 *
 * 这是所有脏数据的唯一收口点：localStorage 用户能手改、备份文件能塞进
 * 任意 JSON、旧版本升级后字段可能缺失。任何一条路径进 EQ 之前都过这里，
 * 下游（AudioContext 参数、UI 滑块）就再也不用做防御。
 * 注意是**截断 + 补零**而不是报错：多出来的段位丢掉、少掉的段位补 0，
 * 对听感的影响远小于让设置页因为一串脏 JSON 白屏。
 */
export function normaliseGains(gains: unknown): number[] {
  const src: unknown[] = Array.isArray(gains) ? gains : [];
  const out: number[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) out.push(clampGain(src[i]));
  return out;
}

/** 预置 id 合法性判断。给 storage 用：非法 id 不能写进落盘数据。 */
export function isPresetId(id: unknown): id is string {
  return typeof id === 'string' && EQ_PRESET_IDS.has(id);
}

/**
 * 取某个预置的 10 段增益**副本**。
 * 必须返回副本：EQ_PRESETS 是模块级常量，一旦调用方原地 push，
 * 后面所有用户的预置都被改掉了，而且这种污染只在内存里、极难查。
 * 未知 id 返回平直。
 */
export function gainForPreset(id: unknown): number[] {
  const preset = EQ_PRESETS.find((p) => p.id === id);
  return preset ? [...preset.gains] : [...gainForPreset(FLAT_PRESET_ID)];
}

/**
 * 应用预置，返回**新对象**（不原地改入参）。
 * 未知 id 视作平直：调用方只可能来自"预置按钮"或脏数据，两种情况都应该
 * 落到一个确定结果，而不是抛异常把设置页带崩。
 */
export function applyPreset(prefs: AudioFxPrefs, presetId: string): AudioFxPrefs {
  if (!isPresetId(presetId)) {
    return { ...prefs, eqGains: gainForPreset(FLAT_PRESET_ID), presetId: FLAT_PRESET_ID };
  }
  return { ...prefs, eqGains: gainForPreset(presetId), presetId };
}

/** 反查：给定一组增益，是否正好等于某个预置。UI 用来决定高亮哪个预置按钮。 */
export function matchPreset(gains: unknown): string | null {
  const g = normaliseGains(gains);
  const hit = EQ_PRESETS.find((p) => p.gains.every((v, i) => v === g[i]));
  return hit ? hit.id : null;
}

/** 是否全 0 dB。UI 用来显示"已修改"，EQ 关闭时也拿它提示"当前是平直"。 */
export function isFlat(gains: unknown): boolean {
  return normaliseGains(gains).every((g) => g === 0);
}

/** crossfade 时长收口：非数字→0，夹到 [0,8]，保留一位小数（去掉浮点噪音）。 */
export function clampCrossfade(sec: unknown): number {
  const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : CROSSFADE_MIN;
  return Math.min(CROSSFADE_MAX, Math.max(CROSSFADE_MIN, Math.round(v * 10) / 10));
}

/**
 * 默认偏好。**读取方一律用 `defaultAudioFx()` 拿新对象**，不要直接用这个常量：
 * 它是模块级单例，调用方一个 `prefs.eqGains[0] = 6` 就把全局默认改了。
 */
export const DEFAULT_AUDIO_FX: AudioFxPrefs = {
  eqEnabled: false,
  eqGains: new Array<number>(EQ_BAND_COUNT).fill(0),
  presetId: null,
  crossfadeSec: 0,
};

/** 一份全新的默认偏好（深拷贝 eqGains）。storage 的所有回落路径都用它。 */
export function defaultAudioFx(): AudioFxPrefs {
  return { ...DEFAULT_AUDIO_FX, eqGains: [...DEFAULT_AUDIO_FX.eqGains] };
}
