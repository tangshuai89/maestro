/**
 * 红心库审计 v2：找出「同一首歌被拆成多个 item」的真实问题。
 *
 * 同歌信号（比 v1 严格，避免把同艺人同长度的不同歌误报）：
 *   1. artist 判定同人（normalizeKey(artist) 相等 或 artistLooseMatch）
 *   2. duration 差 ≤ 3 秒
 *   3. 标题差异可解释为「同歌不同写法」，即满足以下任一：
 *      a. displayKey 相同（剥括号后同 key）但 normalizeKey 不同
 *         —— 括号内是译名/注释而非版本标签（「ハルジオン (春紫菀)」vs「ハルジオン」）
 *      b. 一个标题剥掉「空格 + 纯 CJK 尾段」后 normalizeKey 与另一个相等
 *         —— 拉丁原名 + 中文译名（「Liyue 璃月」vs「Liyue」）
 *      c. 一个标题剥掉括号内容后 normalizeKey 与另一个相等
 *         —— 「我只怪我自己 (Love Lost)」vs「我只怪我自己」
 *      d. titleAliasMatch 命中（策展别名表）
 *
 * 用法：cd packages/server && TS_NODE_PROJECT=tsconfig.json npx ts-node ../../scripts/audit-liked.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  artistLooseMatch,
  displayKey,
  normalizeKey,
  stripParensContent,
  titleAliasMatch,
} from '@maestro/common';

interface LibItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  sources: Array<{ platform: string; trackId: string }>;
}

const stateFile = path.join(__dirname, '..', 'packages', 'server', '.storage', 'state.json');
const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

const libs = Object.entries(data).filter(([k]) => k.startsWith('library:'));

/** 去掉「空格 + 纯 CJK 尾段」（拉丁原名 + 中文译名格式）。 */
function stripCjkTail(s: string): string {
  return s.replace(/[\s\u3000]+[\u4e00-\u9fff]+$/u, '').trim();
}

/** 标题差异是否可解释为同歌（a/b/c/d 任一）。返回原因描述或 null。 */
function explainTitleDiff(t1: string, t2: string): string | null {
  const n1 = normalizeKey(t1, '');
  const n2 = normalizeKey(t2, '');
  if (n1 === n2) return null; // 已同 key，不算问题
  // a. 剥括号后 displayKey 相同
  if (displayKey(t1, '') === displayKey(t2, '') && displayKey(t1, '') !== n1) {
    return `displayKey 相同（括号译名/注释差异）`;
  }
  // b. 剥「空格+CJK 尾段」后相等（双向）
  const s1 = stripCjkTail(t1);
  const s2 = stripCjkTail(t2);
  if (s1 && normalizeKey(s1, '') === n2) return `「${t1}」剥 CJK 尾段 == 「${t2}」`;
  if (s2 && normalizeKey(s2, '') === n1) return `「${t2}」剥 CJK 尾段 == 「${t1}」`;
  // c. 剥括号后相等
  const p1 = stripParensContent(t1);
  const p2 = stripParensContent(t2);
  if (p1 && p1 !== t1 && normalizeKey(p1, '') === n2) return `「${t1}」剥括号 == 「${t2}」`;
  if (p2 && p2 !== t2 && normalizeKey(p2, '') === n1) return `「${t2}」剥括号 == 「${t1}」`;
  // d. 策展别名表
  if (titleAliasMatch(t1, t2)) return `titleAlias 命中`;
  return null;
}

const groups = new Map<string, { lib: string; items: Map<string, LibItem>; reason: string; dur: number }>();

for (const [libKey, raw] of libs) {
  const items = (raw as { items?: LibItem[] }).items ?? [];
  if (items.length === 0) continue;
  const byKey = new Map<string, LibItem[]>();
  for (const it of items) {
    const k = normalizeKey(it.title ?? '', it.artist ?? '');
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(it);
  }
  const keys = [...byKey.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const ga = byKey.get(keys[i])!;
      const gb = byKey.get(keys[j])!;
      for (const a of ga) {
        for (const b of gb) {
          const durOk = Math.abs((a.duration ?? 0) - (b.duration ?? 0)) <= 3;
          if (!durOk) continue;
          const artistOk =
            normalizeKey(a.artist ?? '', '') === normalizeKey(b.artist ?? '', '') ||
            artistLooseMatch(a.artist ?? '', b.artist ?? '');
          if (!artistOk) continue;
          const reason = explainTitleDiff(a.title ?? '', b.title ?? '');
          if (!reason) continue;
          const ak = normalizeKey(a.artist ?? '', '');
          const gk = `${ak}::${Math.round((a.duration ?? 0) / 10)}::${reason}`;
          if (!groups.has(gk)) {
            groups.set(gk, { lib: libKey, items: new Map(), reason, dur: a.duration });
          }
          const g = groups.get(gk)!;
          g.items.set(a.id, a);
          g.items.set(b.id, b);
        }
      }
    }
  }
}

console.log(`📚 ${libs.length} libraries\n🔍 真实疑似未合并组：${groups.size}\n`);
let no = 0;
for (const [gk, g] of groups) {
  no++;
  const items = [...g.items.values()];
  const titles = [...new Set(items.map((i) => i.title))];
  const platforms = [...new Set(items.flatMap((i) => i.sources.map((s) => s.platform)))];
  console.log(`── #${no} · ${titles.join(' | ')}`);
  console.log(`   artist: ${items[0].artist}  dur: ${g.dur}s  platforms: ${platforms.join('/')}`);
  console.log(`   原因: ${g.reason}`);
  console.log(`   items: ${items.map((i) => `${i.id} (${i.sources.map((s) => s.platform).join(',')})`).join('  ')}`);
  console.log('');
}
console.log(`📊 合计疑似问题组：${groups.size}`);
