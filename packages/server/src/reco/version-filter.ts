/**
 * 「版本纯净度」与「时长合理性」的共享判据。
 *
 * 为什么独立成文件：reco 有两个地方要在**拿到搜索结果之前/之后**用同一套口径
 * 过滤——① 候选池构建（别把 DJ 版塞进候选池，白占坑位）；② 填源挑版本
 * （同一首歌的多个录音版本里挑录音室原版）。两边口径必须一致，否则会出现
 * "候选池收进来、填源又丢掉"的隐性损耗。
 *
 * 全部是纯函数 + 常量，方便单测直接断言。
 */

/**
 * "坏版本"标记：DJ/remix/伴奏/加速/抖音/翻唱/纯音乐… 这类**没人想循环听**的
 * 二次加工版本。命中 → 强惩罚（PEN_BAD），除非用户/模型本就点名要这个版本。
 * ⚠️ 只扫 title，不扫 artist——避免误伤 "DJ Okawari" 这类合法艺人名。
 *
 * 2026-08-14 扩：补「串烧/夜店/夜场/车载/劲爆/慢嗨/连音/吐司/慢四/快三」
 * 等中文二次加工标签——这些通常是 8-15 分钟的"非录音室"长版或拼盘，
 * 用户不会想循环。补「铃声 / 来电铃声 / 闹钟」等"非歌"形态。
 */
export const VERSION_BAD: readonly RegExp[] = [
  /\bdj\b/i, /re-?mix/i, /mash-?up/i, /bootleg/i, /nightcore/i,
  /sped ?-?up/i, /slowed/i, /8-?bit/i, /\b[38]d\b/i,
  /伴奏/, /纯音乐|純音樂/, /off ?vocal/i, /instrumental/i, /karaoke/i, /\bktv\b/i,
  /加速/, /减速|減速/, /慢摇|慢搖/, /抖音/, /tik ?tok/i, /钢琴(版|曲)|鋼琴(版|曲)/,
  /八音盒/, /翻唱|翻自|\bcover\b/i, /清唱|a-?ca?pella/i, /\bdemo\b/i, /重混/,
  // 中文二次加工标签（用户实测常见）
  /串烧|串燒/, /夜店|夜場|club ?mix/i, /车载|車載/, /劲爆|勁爆|劲嗨|慢嗨/,
  /连音|連音/, /慢四|快三|快四/, /铃声|鈴聲|来电铃声|鬧鐘|闹钟/,
  // 网易云/QQ 特殊标签
  /纯享版|純享版/, /无损|無損|flac/i,
];

/** "可接受但非首选"：live/现场/acoustic。用户认可，但有录音室原版时让原版优先。 */
export const VERSION_SOFT: readonly RegExp[] = [
  /\blive\b/i, /现场|現場/, /\bacoustic\b/i, /演唱会|演唱會/, /concert/i, /unplugged/i,
];

export const PEN_BAD = 100;
export const PEN_SOFT = 10;

/** 时长硬约束（秒）——实测同名不同版本常以"10 分钟 live 全场"形态出现在
 *  QQ 搜索结果第一页，且 normalizeKey/title 双向包含都过得了 `looseMatch`
 *  ——只有靠时长把它拦下。
 *
 *  - 主流流行歌 90-360s 是「录音室单曲」的典型区间
 *  - <60s = 抖音切片 / 铃声 / 副歌 hook → 必丢
 *  - >600s = 现场录音 / long version / DJ medley → 必丢
 *  之外（60-90s / 360-600s）只在「模型点名要长版/短版」时豁免。 */
export const DURATION_MIN = 60;
export const DURATION_MAX = 600;
export const DURATION_NORMAL_MIN = 90;
export const DURATION_NORMAL_MAX = 360;

/** 模型侧标题里明确点名要长/短版本的关键词（豁免上面的硬约束）。 */
export const LONG_HINT =
  /\b(long ?ver(?:sion)?|extended|全长|加长|完整版?|演唱会|concert|live ?album|现场专辑|medley)/i;
export const SHORT_HINT =
  /\b(edit|radio ?edit|single ?edit|剪辑|副歌|hook|抖音|60s|30s)/i;

/** 版本纯净度惩罚：录音室原版 0 < live/现场 10 << DJ/remix/伴奏… 100。 */
export function versionPenalty(title: string): number {
  const t = (title ?? '').toLowerCase();
  if (VERSION_BAD.some((re) => re.test(t))) return PEN_BAD;
  if (VERSION_SOFT.some((re) => re.test(t))) return PEN_SOFT;
  return 0;
}

/** 标题是否已经是"坏版本"（候选池预筛用，等价于 versionPenalty ≥ PEN_BAD）。 */
export function isBadVersionTitle(title: string): boolean {
  return versionPenalty(title) >= PEN_BAD;
}

/**
 * 时长合理性判断。返回 0 = 正常区间（不加惩罚），>0 = 偏离越大惩罚越重。
 * 模型自己点名要 long/short 版本时硬约束豁免；normal 区间（90-360）始终
 * 加 0 惩罚，<60 或 >600 硬丢（> PEN_BAD 即被填源当作坏版本丢弃）。
 */
export function durationPenalty(duration: number, recTitle: string): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const allowLong = LONG_HINT.test(recTitle);
  const allowShort = SHORT_HINT.test(recTitle);
  if (duration < DURATION_MIN && !allowShort) return PEN_BAD;
  if (duration > DURATION_MAX && !allowLong) return PEN_BAD;
  if (duration < DURATION_NORMAL_MIN) return allowShort ? 0 : 50;
  if (duration > DURATION_NORMAL_MAX) return allowLong ? 0 : 50;
  return 0;
}

/** 时长是否在"可接受的单曲区间"（候选池预筛用；未知时长一律放行）。 */
export function isAcceptableDuration(duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return true;
  return duration >= DURATION_MIN && duration <= DURATION_MAX;
}
