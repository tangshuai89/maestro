/**
 * 搜索历史（specs/search-history/）。
 *
 * ## 为什么要有
 *
 * 用户搜过的词**找不回来** —— 搜索框每次都是空的，重度用户只能凭记忆再敲一遍。
 * 功能盘点 P2（成本 0.5 天）：`搜索历史 · searchHistory → 0 处`。
 *
 * ## 存在哪
 *
 * **localStorage**（不是服务端）：搜索词是「本机使用痕迹」，不是用户资产
 * —— 不需要跟 ❤ 库/歌单一样按 session 分片落到 state.json，也不该进
 * 跨设备同步的语义里。走 `STORAGE_KEYS.searchHistory` ⇒ 顺带被**加密备份**
 * 自动带走（`collectLocalStorage()` 遍历 STORAGE_KEYS）。
 *
 * ## 规则
 *
 * - **去重**：同一个词再搜 → 移到最前（不是追加第二条）
 * - **上限**：`MAX_SEARCH_HISTORY` 条，超了丢最旧的
 * - **不记空串**、**去空白**后记
 * - **读的时候过滤脏数据**：localStorage 用户能手改，备份导入也能塞
 *   → 非字符串 / 空串 / 超长的都丢掉
 */

/** 最多记多少条。 */
export const MAX_SEARCH_HISTORY = 12;

/** 单条词的最大长度（超长的是误输入/粘贴噪声）。 */
const MAX_ENTRY_LEN = 120;

/** 把一条搜索词规整成「可以存、可以显示」的形式；不合格返回 null。 */
export function normaliseHistoryEntry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > MAX_ENTRY_LEN) return null;
  return t;
}

/**
 * 把一个新词并进历史：去重 + 移到最前 + 截断。
 *
 * 纯函数（不碰 localStorage）—— 好测。
 */
export function pushSearchHistory(
  history: readonly string[],
  raw: string,
  limit: number = MAX_SEARCH_HISTORY,
): string[] {
  const entry = normaliseHistoryEntry(raw);
  if (!entry) return [...history];
  const rest = history.filter((h) => h !== entry);
  return [entry, ...rest].slice(0, Math.max(0, limit));
}

/** 解析 localStorage 里的历史数组（脏数据一律丢掉）。 */
export function parseSearchHistory(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    const e = normaliseHistoryEntry(item);
    if (!e) continue;
    if (out.includes(e)) continue;
    out.push(e);
  }
  return out;
}
