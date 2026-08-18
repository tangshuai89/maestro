/**
 * 红心库审计：找出「同名（title 归一相等）但歌手不同」的条目，供人工排查。
 *
 * 口径与 renderer `groupLibraryItems` 一致：
 *   - title 桶 = titleAliasKey(displayKey(stripTrailingMeta(title), ''))
 *     （剥括号/feat/译名/简繁 + 策展别名表）
 *   - 桶内 artist 判等同 = `artistsEquivalent`（归一相等 / 策展别名表 /
 *     artist·album 段段配对 / 多艺人拆分配对）——**与 renderer 同口径**，
 *     弹窗里会被拆成不同 group 的，这里就是「同名不同歌手」。
 *
 * 输出每个 title 桶的：原始 title 写法、每个 artist 组的成员
 * （平台 / 时长 / item id / 原始 artist），并给出启发式疑似标记：
 *   ⚠️跨平台 = 不同平台写了不同歌手（高疑似：同歌没合并）
 *   ⚠️时长近 = 组间时长差 ≤3s（配合跨平台 → 极可能同歌）
 *   ⚠️artist 交集 = 组间 artist 串有共同 token（「陈致逸 / HOYO-MiX」vs「HOYO-MiX」）
 *
 * 用法：cd packages/server && TS_NODE_PROJECT=tsconfig.json npx ts-node ../../scripts/audit-same-title.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  artistLooseMatch,
  displayKey,
  normalizeKey,
  splitArtists,
  stageNameAliasMatch,
  stripParensContent,
  stripTrailingMeta,
  titleAliasKey,
} from '@maestro/common';

interface LibItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  sources: Array<{ platform: string; trackId: string }>;
  likedPlatforms?: string[];
}

const stateFile = path.join(__dirname, '..', 'packages', 'server', '.storage', 'state.json');
const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

const libs = Object.entries(data).filter(([k]) => k.startsWith('library:'));

// ── artistsEquivalent：与 renderer/src/lib/groupLibrary.ts 同口径 ──────
// （保持单一真值源哲学：弹窗拆组判定 = 这里的判定。改这里必须同步 renderer。）
function artistsEquivalent(a: string, b: string): boolean {
  const na = normalizeKey(stripParensContent(a), '');
  const nb = normalizeKey(stripParensContent(b), '');
  if (na && nb && na === nb) return true;
  if (stageNameAliasMatch(a, b)) return true;
  if (artistLooseMatch(a, b)) return true;
  const pa = splitArtists(a);
  const pb = splitArtists(b);
  if (pa.length < 2 && pb.length < 2) return false;
  let matched = 0;
  for (const x of pa) {
    for (const y of pb) {
      const nx = normalizeKey(stripParensContent(x), '');
      const ny = normalizeKey(stripParensContent(y), '');
      if ((nx && ny && nx === ny) || stageNameAliasMatch(x, y)) {
        matched++;
        break;
      }
    }
  }
  const need = Math.ceil(Math.max(pa.length, pb.length) / 2);
  return matched > 0 && matched >= need;
}

/** 组间 artist 是否有共同 token（「陈致逸 / HOYO-MiX」vs「HOYO-MiX」→ 有）。 */
function artistTokenIntersection(a: string, b: string): boolean {
  const ta = new Set(splitArtists(a).map((x) => normalizeKey(x, '')));
  const tb = new Set(splitArtists(b).map((x) => normalizeKey(x, '')));
  for (const t of ta) if (t && tb.has(t)) return true;
  return false;
}

/** 组内覆盖的平台集合（likedPlatforms 优先，fallback sources）。 */
function groupPlatforms(items: LibItem[]): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    const list = it.likedPlatforms ?? it.sources.map((s) => s.platform);
    for (const p of list) set.add(p);
  }
  return set;
}

// ── 汇总所有库的 items（去重 by id）──────────────────────────────────
const seen = new Set<string>();
const all: LibItem[] = [];
for (const [, raw] of libs) {
  const items = (raw as { items?: LibItem[] }).items ?? [];
  for (const it of items) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    all.push(it);
  }
}
console.log(`📚 ${libs.length} libraries, ${all.length} 去重 items\n`);

// ── 按 title 桶分组 ────────────────────────────────────────────────────
const buckets = new Map<string, LibItem[]>();
for (const it of all) {
  const key = titleAliasKey(displayKey(stripTrailingMeta(it.title ?? ''), ''));
  if (!key) continue;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key)!.push(it);
}

// ── 桶内按 artist 拆组，输出同名不同歌手 ──────────────────────────────
interface ArtistGroup {
  artist: string;
  items: LibItem[];
}

const results: Array<{ titleKey: string; groups: ArtistGroup[]; titles: string[] }> = [];
for (const [titleKey, items] of buckets) {
  const groups: ArtistGroup[] = [];
  for (const it of items) {
    const g = groups.find((x) => artistsEquivalent(x.artist, it.artist));
    if (g) g.items.push(it);
    else groups.push({ artist: it.artist, items: [it] });
  }
  if (groups.length >= 2) {
    results.push({
      titleKey,
      groups,
      titles: [...new Set(items.map((i) => i.title))],
    });
  }
}

// 排序：疑似度高在前（跨平台 + 时长近 + artist 交集）
results.sort((a, b) => score(b) - score(a));
function score(r: { groups: ArtistGroup[] }): number {
  let s = 0;
  const plats = r.groups.map((g) => groupPlatforms(g.items));
  // 跨平台（不同平台写了不同歌手）= 最高疑似
  for (let i = 0; i < plats.length; i++) {
    for (let j = i + 1; j < plats.length; j++) {
      const inter = [...plats[i]].filter((p) => plats[j].has(p));
      if (inter.length === 0 && plats[i].size > 0 && plats[j].size > 0) s += 3;
    }
  }
  // 时长相近
  for (let i = 0; i < r.groups.length; i++) {
    for (let j = i + 1; j < r.groups.length; j++) {
      const d1 = r.groups[i].items[0].duration ?? 0;
      const d2 = r.groups[j].items[0].duration ?? 0;
      if (d1 > 0 && d2 > 0 && Math.abs(d1 - d2) <= 3) s += 2;
      if (artistTokenIntersection(r.groups[i].artist, r.groups[j].artist)) s += 1;
    }
  }
  return s;
}

console.log(`🔍 同名（title 归一相等）但歌手不同：${results.length} 组\n`);

let no = 0;
for (const r of results) {
  no++;
  const plats = r.groups.map((g) => [...groupPlatforms(g.items)].join('/'));
  const durs = r.groups.map((g) => g.items[0].duration ?? 0);
  // 疑似标记
  const flags: string[] = [];
  for (let i = 0; i < r.groups.length; i++) {
    for (let j = i + 1; j < r.groups.length; j++) {
      const inter = plats[i].split('/').filter((p) => plats[j].split('/').includes(p));
      if (inter.length === 0 && plats[i] && plats[j]) flags.push('⚠️跨平台不同歌手');
      if (durs[i] > 0 && durs[j] > 0 && Math.abs(durs[i] - durs[j]) <= 3) flags.push('⚠️时长近');
      if (artistTokenIntersection(r.groups[i].artist, r.groups[j].artist)) flags.push('⚠️artist有交集');
    }
  }
  console.log(`── #${no} · ${r.titles.join(' | ')}`);
  console.log(`   ${[...new Set(flags)].join('  ')}`);
  for (let gi = 0; gi < r.groups.length; gi++) {
    const g = r.groups[gi];
    const sub = g.items
      .map((it) => `${it.sources.map((s) => s.platform).join(',')}:${it.duration}s:${it.id}`)
      .join('  ');
    console.log(`   [${gi + 1}] artist: ${g.artist}  (${sub})`);
  }
  console.log('');
}

console.log(`📊 合计：${results.length} 组同名不同歌手`);
console.log(`（⚠️跨平台 = 高疑似同歌没合并；时长近 + artist 有交集 = 极可能同歌）`);
