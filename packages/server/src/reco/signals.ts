/**
 * 行为信号（P0-b）——把"只有红心"补成"红心 + 播放 + 完播 + 跳过 + 踩"。
 *
 * 为什么这是推荐质量的关键：红心是**多年累积的二值正样本**，它描述的是"曾经
 * 喜欢"，不是"现在想听"。主流播放器真正吃的是**跳过**（最强的负信号）与完播
 * （最强的正信号）——有了它们，口味档案才能从"平均脸"变成"最近在听什么"。
 *
 * 全部数据只落在本机 `.storage`（不上传，符合 AGENTS.md 的隐私约定），纯函数
 * 便于单测。
 */
import { normalizeKey } from '@maestro/common';

export type RecoSignalType =
  | 'play'
  | 'complete'
  | 'skip'
  | 'like'
  | 'dislike'
  | 'seed';

export const RECO_SIGNAL_TYPES: readonly RecoSignalType[] = [
  'play',
  'complete',
  'skip',
  'like',
  'dislike',
  'seed',
];

export interface RecoSignal {
  title: string;
  artist: string;
  type: RecoSignalType;
  at: number;
  /** 播放进度百分比（0-100）。用来把"听了大半才切"和"秒切"区分开。 */
  progress?: number;
}

export function isRecoSignalType(value: unknown): value is RecoSignalType {
  return (
    typeof value === 'string' &&
    (RECO_SIGNAL_TYPES as readonly string[]).includes(value)
  );
}

/** 各信号的权重。跳过/踩是负的，完播/红心/主动点"像这首"是正的。 */
export const SIGNAL_WEIGHT: Record<RecoSignalType, number> = {
  play: 1,
  complete: 2.5,
  skip: -2,
  like: 3,
  dislike: -4,
  seed: 3,
};

/** 信号半衰期（天）：三周前的行为只算一半权重，让档案跟着"最近在听"走。 */
export const SIGNAL_HALF_LIFE_DAYS = 21;
/** 单次 run 里最多取多少条历史信号算权重（防长跑会话拖慢）。 */
export const SIGNAL_SCORE_LIMIT = 300;
/** 把某位艺人整体拉黑的门槛：累计信号分 ≤ 这个值 → 不再进候选池。 */
export const ARTIST_BAN_THRESHOLD = -6;

/** 宽松解析一条外来信号（前端上报可能是脏数据）→ 合法则返回，否则 null。 */
export function normalizeSignal(raw: unknown, now = Date.now()): RecoSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isRecoSignalType(r.type)) return null;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const artist = typeof r.artist === 'string' ? r.artist.trim() : '';
  if (!title || !artist) return null;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : now;
  const progress =
    typeof r.progress === 'number' && Number.isFinite(r.progress)
      ? Math.max(0, Math.min(100, r.progress))
      : undefined;
  return { title, artist, type: r.type, at, ...(progress === undefined ? {} : { progress }) };
}

/** 时间衰减系数（0-1）。 */
export function signalDecay(at: number, now = Date.now()): number {
  const ageDays = Math.max(0, (now - at) / 86_400_000);
  return Math.pow(0.5, ageDays / SIGNAL_HALF_LIFE_DAYS);
}

/**
 * 艺人维度的信号分（带时间衰减）。key 用 `normalizeKey(artist,'')` 与库内
 * 归一一致。
 */
export function artistSignalScores(
  signals: RecoSignal[],
  now = Date.now(),
): Map<string, number> {
  const out = new Map<string, number>();
  // 只看最近的 N 条：老信号已经通过半衰期自然变轻，没必要为它们多算。
  const recent = signals.slice(-SIGNAL_SCORE_LIMIT);
  for (const s of recent) {
    const key = normalizeKey(s.artist, '');
    if (!key) continue;
    const delta = SIGNAL_WEIGHT[s.type] * signalDecay(s.at, now);
    out.set(key, (out.get(key) ?? 0) + delta);
  }
  return out;
}

/** 被"拉黑"的艺人 key（信号分低于门槛）——不进候选池。 */
export function bannedArtistKeys(
  scores: Map<string, number>,
  threshold = ARTIST_BAN_THRESHOLD,
): Set<string> {
  const out = new Set<string>();
  for (const [key, score] of scores) {
    if (score <= threshold) out.add(key);
  }
  return out;
}

/**
 * 负面曲目（跳过 / 踩）——当作"库内已有"一样排除：候选池不再收、prompt 里
 * 也明确点名避开。只取最近 `limit` 条，且同一首歌只保留最新一次。
 */
export function negativeTracks(
  signals: RecoSignal[],
  limit = 100,
): Array<{ title: string; artist: string }> {
  const seen = new Map<string, { title: string; artist: string }>();
  for (const s of signals) {
    if (s.type !== 'skip' && s.type !== 'dislike') continue;
    const key = normalizeKey(s.title, s.artist);
    if (!key) continue;
    seen.set(key, { title: s.title, artist: s.artist });
  }
  return [...seen.values()].slice(-limit);
}

/**
 * 把新信号并进历史：同一首歌同一类型 30s 内只记一次（防抖），超出上限按时间
 * 淘汰最旧的。
 */
export function appendSignals(
  history: RecoSignal[],
  incoming: RecoSignal[],
  opts: { max?: number; dedupeWindowMs?: number } = {},
): RecoSignal[] {
  const max = opts.max ?? 500;
  const window = opts.dedupeWindowMs ?? 30_000;
  const out = history.slice();
  // 只往回看尾部若干条即可——同一首歌的重复上报总是紧挨着的。
  const lastByKey = new Map<string, number>();
  for (let i = Math.max(0, out.length - 200); i < out.length; i++) {
    const h = out[i];
    lastByKey.set(`${normalizeKey(h.title, h.artist)}|${h.type}`, h.at);
  }
  for (const s of incoming) {
    const key = `${normalizeKey(s.title, s.artist)}|${s.type}`;
    const lastAt = lastByKey.get(key);
    if (lastAt !== undefined && Math.abs(s.at - lastAt) < window) continue;
    out.push(s);
    lastByKey.set(key, s.at);
  }
  return out.slice(-max);
}
