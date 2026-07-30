#!/usr/bin/env node
/**
 * Clean up NetEase cross-platform false-positive ❤ matches.
 * For each NetEase-only liked song whose title matches a QQ song but with a
 * clearly different artist, call the server's unlike endpoint.
 *
 * Usage: node scripts/cleanup-ne-fanout-mismatches.js [--fix]
 *   Without --fix: dry-run, list what would be unliked
 *   With --fix   : actually call POST /music/unlike/:trackId?provider=netease
 */
var fs = require('fs');
var path = require('path');

var statePath = path.resolve(__dirname, '..', '..', '.storage', 'state.json');
var state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
var fixMode = process.argv.includes('--fix');
var SERVER = 'http://127.0.0.1:3200';

// Build library index
var libById = {};
for (var k of Object.keys(state)) {
  if (!k.startsWith('library:')) continue;
  var lib = state[k];
  if (!lib || !lib.items) continue;
  for (var item of lib.items) {
    if (!libById[item.id]) libById[item.id] = item;
    else if ((item.sources || []).length > (libById[item.id].sources || []).length)
      libById[item.id] = item;
  }
}

// Normalize artist for comparison (strip whitespace, lower, remove separators)
// Normalize for comparison: strip whitespace, normalize parentheses, lowercase
function norm(s) {
  return (s||'').replace(/[\s]+/g, '').replace(/[（）【】《》]/g, function(ch) {
    return ch==='（'?'(' : ch==='）'?')' : ch==='【'?'[' : ch==='】'?']' : ch==='《'?'<' : '>';
  }).toLowerCase().replace(/[\/&,、・]/g, '');
}

// Known artist aliases (NET EASE name → QQ name mapping). Some artists
// have different spellings/transliterations across platforms.
var KNOWN_ALIASES = {
  '黄丽玲': ['alin', 'a-lin'],
  'alin': ['黄丽玲'],
  'tension': ['天炫男孩'],
  '天炫男孩': ['tension'],
};

/**
 * Strip cover/original-singer/feat annotations from titles before normalizing,
 * so a song labeled "Attention（Cover：NewJeans）" can match QQ's plain
 * "Attention". Annotations to strip:
 *  - (Cover: X) / (cover by X)  / （翻唱：X）
 *  - (原唱：X) / (Originally: X)
 *  - (feat. X) / (ft. X) / (featuring X)  ← WITHOUT parens, just inline feat.
 *  - [cover] / 【cover】
 */
function stripTitleAnnotations(t) {
  return t
    // (Cover: X) / (cover by X) / （翻唱：X）
    .replace(/\s*[\(（][^()）]*?(?:cover[:：]|翻唱|cover\s*by)[^()）]*?[\)）]/gi, '')
    // (原唱：X) / (Originally: X)
    .replace(/\s*[\(（][^()）]*?(?:原唱[:：]|originally|原曲)[\s\S]*?[\)）]/gi, '')
    // Bare "feat. X" / "ft. X" / "featuring X" until end of string (no parens)
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+[^\(\[\{]+$/i, '')
    // [cover] / 【cover】 brackets
    .replace(/\s*[\[【]\s*cover\s*[\]】]/gi, '');
}

// Normalize artist for comparison (strip whitespace, lower, remove separators)
function norm(s) {
  return (s || '').replace(/\s+/g, '').replace(/[（）【】《》]/g, function(ch) {
    return ch==='（'?'(' : ch==='）'?')' : ch==='【'?'[' : ch==='】'?']' : ch==='《'?'<' : '>';
  }).toLowerCase().replace(/[\/&,、・]/g, '');
}

// Title norm that also strips feat./cover annotations first.
function normTitle(t) {
  return norm(stripTitleAnnotations(t));
}

function artistsOverlap(neNorm, qqNorm) {
  if (!neNorm || !qqNorm) return false;
  // Direct match
  if (neNorm === qqNorm) return true;
  // Substring
  if (neNorm.indexOf(qqNorm) >= 0 || qqNorm.indexOf(neNorm) >= 0) return true;
  // Known alias
  var aliases = KNOWN_ALIASES[neNorm] || KNOWN_ALIASES[qqNorm] || [];
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] === qqNorm || aliases[i] === neNorm) return true;
  }
  return false;
}

// Build title→QQ-artists index from QQ sources. Use `normTitle` (strips
// Cover:/原唱：/feat./ft. annotations before normalizing) so a NE entry
// like "Attention（Cover：NewJeans）" maps to QQ's plain "Attention".
var qqByTitle = {}; // title norm → [{artist norm, original artist}]
for (var id in libById) {
  var item = libById[id];
  var qqSrc = (item.sources || []).find(function(s) { return s.platform === 'qq'; });
  if (!qqSrc) continue;
  var tn = normTitle(item.title);
  if (!tn) continue;
  if (!qqByTitle[tn]) qqByTitle[tn] = [];
  qqByTitle[tn].push({ n: norm(item.artist), orig: item.artist });
}

// Scan NE-only liked items
var toUnlike = [];
for (var id in libById) {
  var item = libById[id];
  var likedPlats = item.likedPlatforms || [];
  if (!likedPlats.includes('netease')) continue;
  var qqSrc = (item.sources || []).find(function(s) { return s.platform === 'qq'; });
  if (qqSrc) continue; // Has QQ source → verified cross-platform match, skip

  var neSrc = (item.sources || []).find(function(s) { return s.platform === 'netease'; });
  if (!neSrc || !neSrc.trackId) continue;

  var tn = normTitle(item.title);
  var qqCandidates = qqByTitle[tn] || [];

  // Heuristic: if there's a QQ song with the SAME title norm (after stripping
  // Cover/原唱/feat. annotations) and the NE artist has NO overlap with any
  // QQ artist for that title → fake match (cover version).
  var neArtistNorm = norm(item.artist);
  var hasOverlap = qqCandidates.some(function(q) {
    return artistsOverlap(neArtistNorm, q.n);
  });

  if (qqCandidates.length > 0 && !hasOverlap) {
    var hasCoverMarker = /Cover[:：]|原唱[:：]|翻唱|cover\s*by/i.test(item.title);
    toUnlike.push({
      neTitle: item.title,
      neArtist: item.artist,
      qqArtists: qqCandidates.map(function(q) { return q.orig; }),
      neTrackId: neSrc.trackId,
      coverMarker: hasCoverMarker,
    });
  }
}

console.log('Found ' + toUnlike.length + ' fake cross-platform matches to unlike:\n');
toUnlike.forEach(function(m, i) {
  var tag = m.coverMarker ? ' [Cover/原唱 marker]' : '';
  console.log('  ' + (i + 1) + '. "' + m.neTitle + '"  NE:' + m.neArtist + '  →  QQ:' + m.qqArtists.join(', ') + '  [trackId=' + m.neTrackId + ']' + tag);
});

if (!fixMode) {
  console.log('\nRun with --fix to actually unlike these ' + toUnlike.length + ' tracks on NetEase.');
  console.log('(this will use the running server at ' + SERVER + ')');
  process.exit(0);
}

// ---- FIX MODE: call unlike via the server ----
console.log('\n⚠️  --fix mode: calling NetEase unlike for ' + toUnlike.length + ' tracks...\n');

var crypto = require('crypto');

// Compute signed cookie for session auth. cookie-parser expects
// 's:<value>.<signature>' where signature = HMAC-SHA256(value, secret).
function signCookie(val, secret) {
  var hmac = crypto.createHmac('sha256', secret).update(val).digest('base64')
    .replace(/=+$/, ''); // cookie-signature strips trailing =
  return 's:' + val + '.' + hmac;
}

// Read session ID + secret
var sessionId = null;
var sessionsBlob = state.sessions && state.sessions.byId || {};
for (var id in sessionsBlob) {
  var s = sessionsBlob[id];
  if (s.providers.netease && s.providers.netease.musicU && (s.providers.netease.musicU||'').length > 30) {
    sessionId = id; break;
  }
}
if (!sessionId) { console.error('No NetEase session found'); process.exit(1); }
var secret = process.env.SESSION_SECRET || 'change-me-in-production';
var cookieVal = signCookie(sessionId, secret);

var http = require('http');

function unlike(trackId) {
  return new Promise(function(resolve, reject) {
    var url = '/music/like/' + encodeURIComponent(trackId) + '?provider=netease';
    var req = http.request({
      hostname: '127.0.0.1',
      port: 3200,
      path: url,
      method: 'POST',
      headers: { 'Cookie': 'mb_session=' + encodeURIComponent(cookieVal) },
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + data));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  var fixed = 0, failed = 0;
  for (var i = 0; i < toUnlike.length; i++) {
    var m = toUnlike[i];
    try {
      await unlike(m.neTrackId);
      console.log('  ✅ ' + (i + 1) + '/' + toUnlike.length + ' unliked: ' + m.neTrackId + ' ("' + m.neTitle + '" — ' + m.neArtist + ')');
      fixed++;
    } catch (e) {
      console.log('  ❌ ' + (i + 1) + '/' + toUnlike.length + ' failed: ' + m.neTrackId + ' — ' + e.message);
      failed++;
    }
    // Rate limit
    await new Promise(function(r) { setTimeout(r, 500); });
  }
  console.log('\nDone: ' + fixed + ' fixed, ' + failed + ' failed');
}

main().catch(function(e) { console.error('Fatal:', e); process.exit(1); });
