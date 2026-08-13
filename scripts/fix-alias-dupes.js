#!/usr/bin/env node
/**
 * Fix duplicate keys and empty aliases in artistAlias.ts after batch merge.
 * - For duplicate keys: keep the entry with more aliases
 * - For empty aliases: fill in simplified/traditional variants via OpenCC
 * - Remove entries that still end up empty after s2t fill
 */

const fs = require('fs');
const path = require('path');
const { Converter } = require('opencc-js');

const ALIAS_PATH = path.resolve(__dirname, '..', 'packages', 'common', 'src', 'artistAlias.ts');

let s2t, t2s;
try { s2t = Converter({ from: 'cn', to: 'tw' }); } catch { s2t = s => s; }
try { t2s = Converter({ from: 'tw', to: 'cn' }); } catch { t2s = s => s; }

function main() {
  let src = fs.readFileSync(ALIAS_PATH, 'utf8');

  // Extract the STAGE_NAME_ALIASES object body
  const startMarker = 'const STAGE_NAME_ALIASES';
  const startIdx = src.indexOf(startMarker);
  const objStart = src.indexOf('{', startIdx);
  const objEnd = src.lastIndexOf('};');

  const before = src.slice(0, objStart + 1);
  const after = src.slice(objEnd);
  const body = src.slice(objStart + 1, objEnd);

  // Parse entries: find all key: [...] lines (including multi-line arrays)
  const entryRegex = /^\s*'([^']+)':\s*\[([^\]]*)\],?\s*(?:\/\/.*)?$/gm;
  const entries = new Map(); // key → { aliases: string[], raw: string, comment: string }

  let match;
  while ((match = entryRegex.exec(body)) !== null) {
    const key = match[1];
    const aliasStr = match[2];
    const raw = match[0];
    const commentMatch = raw.match(/\/\/(.*)$/);
    const comment = commentMatch ? commentMatch[1].trim() : '';

    // Parse aliases array
    const aliases = aliasStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s.startsWith("'"))
      .map(s => s.slice(1, -1).replace(/\\'/g, "'"))
      .filter(s => s.length > 0);

    if (entries.has(key)) {
      // Duplicate: merge, keep more aliases
      const existing = entries.get(key);
      if (aliases.length > existing.aliases.length) {
        entries.set(key, { aliases, raw, comment });
      } // else keep existing
    } else {
      entries.set(key, { aliases, raw, comment });
    }
  }

  console.log(`After dedup: ${entries.size} unique entries (removed ${Object.keys(entries).length - entries.size} duplicates)`);

  // Fill empty entries with s2t/t2s variants
  let filledCount = 0;
  let removedCount = 0;
  const finalEntries = [];

  for (const [key, { aliases, comment }] of entries) {
    let finalAliases = [...aliases];

    if (finalAliases.length === 0) {
      // Try to generate simplified/traditional variants
      try {
        const simp = t2s(key);
        if (simp !== key) finalAliases.push(simp);
      } catch {}
      try {
        const trad = s2t(key);
        if (trad !== key && !finalAliases.includes(trad)) finalAliases.push(trad);
      } catch {}

      if (finalAliases.length > 0) {
        filledCount++;
      } else {
        // Still empty — skip this entry
        removedCount++;
        continue;
      }
    }

    // Also ensure variants are present for all entries
    try {
      const simp = t2s(key);
      if (simp !== key && !finalAliases.includes(simp)) finalAliases.push(simp);
    } catch {}
    try {
      const trad = s2t(key);
      if (trad !== key && !finalAliases.includes(trad)) finalAliases.push(trad);
    } catch {}

    // Remove aliases that equal the key
    finalAliases = finalAliases.filter(a => a !== key);
    // Remove duplicates
    finalAliases = [...new Set(finalAliases)];

    finalEntries.push({ key, aliases: finalAliases, comment });
  }

  console.log(`Filled ${filledCount} empty entries with s2t variants`);
  console.log(`Removed ${removedCount} still-empty entries`);
  console.log(`Final: ${finalEntries.length} entries`);

  // Rebuild the object body
  const newBody = finalEntries
    .map(e => {
      const aliasStr = e.aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
      const commentStr = e.comment ? ` // ${e.comment}` : '';
      return `  '${e.key}': [${aliasStr}],${commentStr}`;
    })
    .join('\n');

  const newSrc = before + '\n' + newBody + '\n' + after;
  fs.writeFileSync(ALIAS_PATH, newSrc, 'utf8');
  console.log(`✅ Written ${ALIAS_PATH}`);
}

main();
