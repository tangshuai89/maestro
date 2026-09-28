/**
 * NL Intent 解析（specs/nl-playlist/）。
 *
 * 第一阶段 LLM 调用：用户自由文本 → 强约束 JSON NLIntent。
 * 第二阶段（reco.run 扩展，spec commit 2）才把 Intent 喂给统一搜索回填。
 *
 * 设计要点（spec §数据模型 + §技术约束）：
 *   - 强约束 JSON：prompt 要求 LLM 只输出 <json>...</json> 包裹；解析失败保留 raw
 *   - 库上下文：取最近 50 首 ❤ 库作为"口味锚点"，控制 token 上限
 *   - 一次 LLM 即可，不串联（避免 token 翻倍 + 延迟翻倍）
 *   - 服务端兜底：target_count clamp 8-20，genre/tempo/language enum 校验
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { normalizeKey } from '../music/search.util';

const log = new Logger('NLIntent');

/** 强约束 JSON schema（spec §数据模型）。 */
export interface NLIntent {
  mood: string;
  genres: string[];
  tempo: 'slow' | 'medium' | 'fast' | 'any';
  language: 'zh' | 'en' | 'ja' | 'ko' | 'any';
  era?: { from?: number; to?: number };
  similar_artists: string[];
  similar_tracks: string[];
  exclude_artists: string[];
  exclude_genres: string[];
  target_count: number;
  rationale: string;
}

const TEMPO_VALUES = new Set(['slow', 'medium', 'fast', 'any']);
const LANGUAGE_VALUES = new Set(['zh', 'en', 'ja', 'ko', 'any']);

/** 客户端输入边界（与 spec §接口规格 400 一致）。 */
const MAX_TEXT_LEN = 500;

/**
 * 把 NLIntent（+ 可选 extra excludes）翻译成 buildPrompt 附加的 hint 行。
 * 空数组 = 不附加（向后兼容——run() 不传 intent 时与改造前完全一致）。
 *
 * 设计：这些是**软 prompt hints**，不是硬过滤器。硬过滤仍走原有
 * `exclude: {title, artist}[]`（dedupAgainstLibrary + filterByExclude）。
 * spec §验收"排除…能体现在结果里"——软约束在 LLM prompt 里已足够，
 * 硬过滤要求 {title,artist} 双键匹配，标题/艺人单独传过来的会失配。
 */
export function intentToPromptHints(
  intent: NLIntent,
  extra?: { exclude_titles?: string[]; exclude_artists?: string[] },
): string[] {
  const out: string[] = [];
  const mood = intent.mood?.trim();
  if (mood) out.push(`心情/场景：${mood}`);
  if (intent.genres.length) {
    out.push(`风格标签：${intent.genres.join('、')}`);
  }
  if (intent.tempo !== 'any') out.push(`节奏偏好：${intent.tempo}`);
  if (intent.era && (intent.era.from || intent.era.to)) {
    const from = intent.era.from ?? '?';
    const to = intent.era.to ?? '今';
    out.push(`年代：${from}–${to}`);
  }
  if (intent.similar_tracks.length) {
    out.push(`参考曲目（像这些歌的感觉）：${intent.similar_tracks.join('、')}`);
  }
  if (intent.exclude_artists.length) {
    out.push(`不要这些艺人的歌：${intent.exclude_artists.join('、')}`);
  }
  if (intent.exclude_genres.length) {
    out.push(`不要这些风格：${intent.exclude_genres.join('、')}`);
  }
  // 客户端额外 excludes（NL 路径或手动都走这条）
  if (extra?.exclude_titles?.length) {
    out.push(`不要这些标题的歌：${extra.exclude_titles.join('、')}`);
  }
  if (extra?.exclude_artists?.length) {
    out.push(`不要这些艺人的歌：${extra.exclude_artists.join('、')}`);
  }
  return out;
}

const SYSTEM_PROMPT = `你是 Maestro 播放器的"音乐口味翻译官"。把用户自由文本需求解析成严格结构的 JSON。
规则：
1. 只输出 <json>...</json>，中间是合法 JSON，不要有别的字
2. 字段缺失或用户没提到 → 合理默认：tempo="any", language="any", era 省略, target_count=12
3. genre/similar_artists/similar_tracks/exclude_artists/exclude_genres 数组里只放"明确提到或强烈暗示"的；猜不到就空数组
4. mood ≤ 50 字，rationale ≤ 80 字
5. 排除某艺人/某流派直接放进对应数组；"更多像 X" → similar_artists 放 X
6. era 给出 {from,to}，支持单边（如 2000 至今 → to 留空）
7. target_count 默认 12，按用户语气的"多一点/少一点"微调到 8-20 之间
schema：
{mood:string,genres:string[0-6],tempo:'slow'|'medium'|'fast'|'any',language:'zh'|'en'|'ja'|'ko'|'any',era?:{from?:number,to?:number},similar_artists:string[0-4],similar_tracks:string[0-4],exclude_artists:string[0-8],exclude_genres:string[0-4],target_count:number,rationale:string}`;

/**
 * 构造 LLM 输入消息。库上下文 ≤ 50 首（normalizeKey 去重），
 * 避免 token 爆炸。空库时跳过锚点段。
 */
export function buildParseIntentPrompt(
  text: string,
  librarySample: Array<{ title: string; artist: string }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const userParts: string[] = [`用户需求：${text}`];
  if (librarySample.length > 0) {
    userParts.push('用户最近 ❤ 的歌（口味锚点，仅参考，不要直接重复）：');
    userParts.push(
      librarySample
        .slice(0, 50)
        .map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`)
        .join('\n'),
    );
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

/** 从 LLM 响应中抠出 <json>...</json>，容错：整段就是 JSON 也接受。 */
export function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/<json>([\s\S]*?)<\/json>/i);
  if (match) return match[1].trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  throw new Error('response_missing_json_block');
}

/** 解析 + 校验 + 兜底，失败抛 HttpException 让 NestJS 转 502。 */
export function parseIntentResponse(raw: string): { intent: NLIntent; raw: string } {
  let body: unknown;
  try {
    body = JSON.parse(extractJsonBlock(raw));
  } catch (e) {
    log.error(`parseIntent: JSON 解析失败: ${(e as Error).message}`);
    throw new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'parse_intent_json_failed',
        message: 'DeepSeek 返回非 JSON',
        raw,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
  if (!body || typeof body !== 'object') {
    throw new HttpException(
      { statusCode: HttpStatus.BAD_GATEWAY, error: 'parse_intent_not_object', raw },
      HttpStatus.BAD_GATEWAY,
    );
  }
  const b = body as Record<string, unknown>;

  // tempo / language enum 校验（不合法 → 降级 'any'，不阻塞）
  const tempo = TEMPO_VALUES.has(b.tempo as string)
    ? (b.tempo as NLIntent['tempo'])
    : 'any';
  const language = LANGUAGE_VALUES.has(b.language as string)
    ? (b.language as NLIntent['language'])
    : 'any';

  // target_count clamp 8-20
  const tc = Number(b.target_count);
  const target_count = Number.isFinite(tc) ? Math.min(20, Math.max(8, Math.round(tc))) : 12;

  // era 可选 + 数值钳位
  let era: NLIntent['era'] | undefined;
  if (b.era && typeof b.era === 'object') {
    const e = b.era as { from?: unknown; to?: unknown };
    const from = Number(e.from);
    const to = Number(e.to);
    era = {
      ...(Number.isFinite(from) ? { from } : {}),
      ...(Number.isFinite(to) ? { to } : {}),
    };
    if (!era.from && !era.to) era = undefined;
  }

  return {
    intent: {
      mood: String(b.mood ?? '').slice(0, 50),
      genres: toStrArr(b.genres).slice(0, 6),
      tempo,
      language,
      ...(era ? { era } : {}),
      similar_artists: toStrArr(b.similar_artists).slice(0, 4),
      similar_tracks: toStrArr(b.similar_tracks).slice(0, 4),
      exclude_artists: toStrArr(b.exclude_artists).slice(0, 8),
      exclude_genres: toStrArr(b.exclude_genres).slice(0, 4),
      target_count,
      rationale: String(b.rationale ?? '').slice(0, 80),
    },
    raw,
  };
}

function toStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}

/** 取最近 50 首 ❤ 作为库上下文（去重 + normalizeKey）。 */
export function pickLibrarySample(
  library: { items?: Array<{ sources?: Array<{ platform: string; trackId: string }>; title: string; artist: string }> } | null,
  limit = 50,
): Array<{ title: string; artist: string }> {
  if (!library?.items?.length) return [];
  const seen = new Set<string>();
  const out: Array<{ title: string; artist: string }> = [];
  for (const item of library.items) {
    const key = normalizeKey(item.title, item.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: item.title, artist: item.artist });
    if (out.length >= limit) break;
  }
  return out;
}

/** 客户端 400 校验。 */
export function validateParseIntentInput(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new HttpException(
      { statusCode: HttpStatus.BAD_REQUEST, error: 'parse_intent_text_required', message: 'text 必填' },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (text.length > MAX_TEXT_LEN) {
    throw new HttpException(
      { statusCode: HttpStatus.BAD_REQUEST, error: 'parse_intent_text_too_long', max: MAX_TEXT_LEN, len: text.length },
      HttpStatus.BAD_REQUEST,
    );
  }
  return text.trim();
}
