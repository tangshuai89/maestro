#!/usr/bin/env node
/**
 * Batch-process unmapped QQ liked artists → STAGE_NAME_ALIASES entries.
 *
 * Phase 1 (this script): algorithmic processing
 *   - Simplified → Traditional Chinese (OpenCC)
 *   - Kana → Romaji (wanakana)
 *   - Detect which artists need WebSearch for English stage names
 *   - Output a structured JSON + a TypeScript snippet ready to paste
 *
 * Phase 2 (manual/WebSearch):
 *   - For artists flagged `needsWebSearch: true`, look up English stage names
 *   - Fill them into the JSON, then run `--merge` to write artistAlias.ts
 *
 * Usage:
 *   node scripts/build-alias-entries.js              # Phase 1: compute + flag
 *   node scripts/build-alias-entries.js --merge <json> # Phase 2: merge into artistAlias.ts
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(__dirname, '..', 'packages', 'server', '.storage', 'state.json');
const ALIAS_PATH = path.resolve(__dirname, '..', 'packages', 'common', 'src', 'artistAlias.ts');
const OUT_JSON = path.resolve(__dirname, 'alias-entries.json');

// ── Load libraries ──────────────────────────────────────────────────────────
const { Converter } = require('opencc-js');
const { toRomaji } = require('wanakana');

let cn2t;
try {
  cn2t = Converter({ from: 'cn', to: 'tw' });
} catch { cn2t = (s) => s; }
let tw2cn;
try {
  tw2cn = Converter({ from: 'tw', to: 'cn' });
} catch { tw2cn = (s) => s; }

// ── Helpers ─────────────────────────────────────────────────────────────────

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;

/** Extract bracket-annotation-free CJK core. */
function cjkCore(s) {
  const stripped = s.replace(/[\(（\[【][^)）\]】]*[)）\]】]/g, '');
  let out = '';
  for (const ch of stripped) {
    if (HAN.test(ch) || KANA.test(ch) || HANGUL.test(ch)) out += ch;
  }
  if (!out) {
    for (const ch of s) {
      if (HAN.test(ch) || KANA.test(ch) || HANGUL.test(ch)) out += ch;
    }
  }
  return out || null;
}

/** Extract only kana from a string. */
function kanaOnly(s) {
  let out = '';
  for (const ch of s) out += KANA.test(ch) ? ch : '';
  return out || null;
}

/** Extract only hanzi from a string. */
function hanziOnly(s) {
  let out = '';
  for (const ch of s) out += HAN.test(ch) ? ch : '';
  return out || null;
}

/** Extract annotation from parentheses (e.g., romaji or kana reading). */
function extractAnnotation(s) {
  const m = s.match(/[\(（]([^)）]+)[\)）]/);
  return m ? m[1] : null;
}

/** Check if annotation looks like romaji. */
function isLatin(s) {
  return /^[a-zA-Z\s・.]+$/.test(s || '');
}

/** Clean artist name: strip " / ..." suffixes for solo processing */
function soloName(s) {
  return s.split(/\s*\/\s*/)[0].trim();
}

/**
 * Guess the key for STAGE_NAME_ALIASES.
 * Key is always the full CJK core (kana + kanji + hangul) — we never
 * strip kanji from Japanese names because "ずっと真夜中でいいのに" needs
 * the full string as key; kana-only "ずっとでいいのに" loses the unique
 * identifier.
 *
 * After extracting the CJK core, apply OpenCC s2t to the hanzi portions
 * while keeping kana intact.
 */
function guessKey(name) {
  const core = cjkCore(name);
  if (!core) return name.trim(); // pure Latin, use as-is

  // OpenCC s2t: only convert the hanzi characters, leave kana/hangul alone.
  let key = '';
  let hanziBuf = '';
  function flushHanzi() {
    if (hanziBuf) {
      try { key += cn2t(hanziBuf); } catch { key += hanziBuf; }
      hanziBuf = '';
    }
  }
  for (const ch of core) {
    if (HAN.test(ch)) {
      hanziBuf += ch;
    } else {
      flushHanzi();
      key += ch;
    }
  }
  flushHanzi();

  return key || core;
}

/**
 * Generate alias values for STAGE_NAME_ALIASES.
 * Returns an array of candidate alias strings.
 */
function guessAliases(name) {
  const aliases = new Set();
  const pure = soloName(name);
  const core = cjkCore(pure);
  const annotation = extractAnnotation(pure);

  // 1. Simplified variant (if key is traditional)
  if (core && HAN.test(core)) {
    try {
      aliases.add(tw2cn(core));
    } catch {}
  }

  // 2. Traditional variant
  if (core && HAN.test(core)) {
    try {
      aliases.add(cn2t(core));
    } catch {}
  }

  // 3. Kana reading → romaji
  if (annotation && KANA.test(annotation)) {
    try {
      const romaji = toRomaji(annotation);
      if (romaji && romaji.length > 2) aliases.add(romaji);
    } catch {}
  }

  // 4. If core contains kana → romaji
  if (core && KANA.test(core)) {
    try {
      const romaji = toRomaji(core);
      if (romaji && romaji.length > 2) aliases.add(romaji);
    } catch {}
  }

  // 5. Annotation is Latin (already a stage name) → add
  if (annotation && isLatin(annotation) && annotation.length > 2) {
    aliases.add(annotation);
  }

  // 6. If name already contains a Latin part (e.g. "YELLOW黄宣") → extract
  const latinPart = pure.replace(/[\(（].*$/, '').match(/^([A-Za-z0-9\s.&]+)/);
  if (latinPart && latinPart[1].trim().length > 1) {
    aliases.add(latinPart[1].trim());
  }

  // Remove duplicates, empty, and short strings
  return [...aliases].filter(a => a && a.length >= 2);
}

/**
 * Determine if WebSearch is needed for this artist.
 * true = algorithmic methods can't determine the English stage name.
 */
function needsWebSearch(name, aliases) {
  const core = cjkCore(soloName(name));

  // Pure Latin → no
  if (!core) return false;

  // Latin annotation already captured → maybe no
  if (aliases.some(a => isLatin(a) && a.length > 4)) return false;

  // Hanzi-only Chinese artist → YES (can't guess Jay Chou from 周杰伦)
  if (core && HAN.test(core) && !KANA.test(core) && !HANGUL.test(core)) {
    return true;
  }

  // Japanese with kanji-only name → YES (can't romaji kanji without dictionary)
  if (core && KANA.test(core) && HAN.test(core) && !extractAnnotation(name)) {
    return true; // kanji name without kana reading annotation
  }

  return false;
}

// ── Existing keys (so we don't duplicate) ───────────────────────────────────

function loadExistingKeys() {
  const src = fs.readFileSync(ALIAS_PATH, 'utf8');
  const keys = new Set();
  const regex = /^\s*([^\s:]+):\s*\[/gm;
  let m;
  while ((m = regex.exec(src)) !== null) {
    // Unquote key if quoted
    let k = m[1];
    if (k.startsWith("'") || k.startsWith('"')) k = k.slice(1, -1);
    keys.add(k);
  }
  return keys;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  // Load existing keys
  const existingKeys = loadExistingKeys();
  console.log(`Loaded ${existingKeys.size} existing keys from artistAlias.ts`);

  // Load state.json and extract QQ liked artists
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

  const artistTrackCounts = new Map(); // name → count
  for (const [key, val] of Object.entries(state)) {
    if (!key.startsWith('library:')) continue;
    const items = val?.items || [];
    for (const item of items) {
      const likedOnQq = (item.likedPlatforms || []).includes('qq');
      if (!likedOnQq) continue;
      const artist = item.artist || '未知艺人';
      artistTrackCounts.set(artist, (artistTrackCounts.get(artist) || 0) + 1);

      // Individual artists
      for (const part of artist.split(/\s*\/\s*/)) {
        const t = part.trim();
        if (t && t !== artist) {
          artistTrackCounts.set(t, (artistTrackCounts.get(t) || 0) + 1);
        }
      }
    }
  }

  // Filter to unmapped CJK artists only
  const entries = [];
  for (const [name, count] of artistTrackCounts) {
    // Skip non-CJK (pure Latin)
    if (!cjkCore(soloName(name))) continue;

    // Check if already mapped by doing a quick s2t check against existing keys
    const key = guessKey(name);
    if (existingKeys.has(key)) continue;
    // Also check simplified variant
    try {
      if (HAN.test(key) && existingKeys.has(tw2cn(key))) continue;
    } catch {}
    try {
      if (HAN.test(key) && existingKeys.has(cn2t(key))) continue;
    } catch {}

    const aliases = guessAliases(name);
    const webSearch = needsWebSearch(name, aliases);

    entries.push({
      name,
      count,
      key,
      aliases,
      needsWebSearch: webSearch,
      core: cjkCore(soloName(name)),
      annotation: extractAnnotation(soloName(name)),
      isJapanese: KANA.test(cjkCore(soloName(name)) || ''),
      isKorean: HANGUL.test(cjkCore(soloName(name)) || ''),
    });
  }

  // Sort by song count desc
  entries.sort((a, b) => b.count - a.count);

  // Stats
  const needWS = entries.filter(e => e.needsWebSearch);
  const noWS = entries.filter(e => !e.needsWebSearch);
  console.log(`\nTotal unmapped CJK entries: ${entries.length}`);
  console.log(`  Need WebSearch: ${needWS.length}`);
  console.log(`  Algorithmic only: ${noWS.length}`);

  // Write JSON
  fs.writeFileSync(OUT_JSON, JSON.stringify(entries, null, 2), 'utf8');
  console.log(`\nWrote ${OUT_JSON}`);

  // ── Generate TypeScript snippet for the top entries ──
  const aliasSnippet = [];
  aliasSnippet.push('  // ── Auto-generated entries (2026-08-07) ──');

  for (const entry of entries) {
    const allAliases = [...new Set([...entry.aliases])];
    const aliasStr = allAliases.length > 0
      ? allAliases.map(a => `'${a}'`).join(', ')
      : '/* TODO */';
    const comment = entry.needsWebSearch ? ' // TODO: verify English name' : '';
    aliasSnippet.push(`  '${entry.key}': [${aliasStr}],${comment}`);
  }

  const snippetPath = path.resolve(__dirname, 'alias-entries.ts-snippet');
  fs.writeFileSync(snippetPath, aliasSnippet.join('\n'), 'utf8');
  console.log(`Wrote TypeScript snippet: ${snippetPath}`);
  console.log(`  (${aliasSnippet.length - 1} entries)`);

  // ── Print top entries that need WebSearch ──
  console.log('\n━━━ Top entries needing WebSearch ━━━');
  for (const e of needWS.slice(0, 30)) {
    console.log(`  ${e.count}首 | ${e.name} → key="${e.key}"`);
  }
}

main();
