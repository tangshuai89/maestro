#!/usr/bin/env node
/**
 * NL playlist prompt 调试探针（specs/nl-playlist/ §Task C1 + C2）。
 *
 * 读 packages/server/.storage/state.json 的 secrets:deepseek，调真 DeepSeek
 * 跑 parse-intent 那一段（复用 server 的 buildParseIntentPrompt / parseIntentResponse
 * 编译产物），把 NLIntent 打出来供人工判断质量。
 *
 * 用法：
 *   node scripts/nl-playlist-probe.mjs                 # 跑默认场景组
 *   node scripts/nl-playlist-probe.mjs "放点爵士"      # 跑单句
 *   node scripts/nl-playlist-probe.mjs --lib           # 带上 ❤ 库上下文
 *
 * ⚠️ 会真实消耗 DeepSeek token（每句 1 次调用）。key 只在本地读，不打印。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const STATE = path.join(ROOT, 'packages/server/.storage/state.json');
const DIST = path.join(ROOT, 'packages/server/dist/reco/nl-intent.js');

function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  if (!existsSync(STATE)) return null;
  try {
    const s = JSON.parse(readFileSync(STATE, 'utf8'));
    const v = s['secrets:deepseek'];
    const raw = typeof v === 'string' ? v : v?.apiKey;
    return raw && String(raw).length >= 8 ? String(raw) : null;
  } catch { return null; }
}

function readLibrary() {
  const lib = path.join(ROOT, 'packages/server/.storage/state.json');
  try {
    const s = JSON.parse(readFileSync(lib, 'utf8'));
    // library:<sessionId> 结构
    for (const k of Object.keys(s)) {
      if (!k.startsWith('library:')) continue;
      const items = s[k]?.items ?? [];
      if (Array.isArray(items) && items.length) {
        return items
          .filter((x) => x?.title && x?.artist)
          .slice(0, 50)
          .map((x) => ({ title: x.title, artist: x.artist }));
      }
    }
  } catch { /* noop */ }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const withLib = args.includes('--lib');
  const queries = args.filter((a) => !a.startsWith('--'));
  const DEFAULT = [
    '放点适合夜跑的电子乐',
    '周末慵懒的中文民谣',
    '九十年代摇滚，排除周杰伦',
    '像 Deadmau5 那种 prog house，节奏快一点',
  ];
  const prompts = queries.length ? queries : DEFAULT;

  const key = readKey();
  if (!key) {
    console.error('❌ 没找到 DeepSeek key：设 DEEPSEEK_API_KEY 环境变量，或在 App Settings 里填一次。');
    process.exit(1);
  }
  console.log(`🔑 key 已就位（尾号 ${key.slice(-4)}）｜场景 ${prompts.length} 条${withLib ? '｜带库上下文' : '｜无库上下文'}\n`);

  if (!existsSync(DIST)) {
    console.error(`❌ 找不到编译产物 ${DIST}\n   先跑：npm run build --workspace @maestro/server`);
    process.exit(1);
  }
  const { buildParseIntentPrompt, parseIntentResponse, pickLibrarySample } = require(DIST);

  const library = withLib ? readLibrary() : [];
  if (withLib) console.log(`📚 库上下文 ${library.length} 首\n`);
  else console.log('📚 库上下文：无（--lib 开启）\n');

  const results = [];
  for (const text of prompts) {
    process.stdout.write(`▶ ${text}\n  `);
    const messages = buildParseIntentPrompt(text, pickLibrarySample({ items: library.map((x) => ({ ...x, sources: [] })) }, 50));
    const t0 = Date.now();
    let raw = '';
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 800,
        }),
      });
      if (!res.ok) {
        console.log(`❌ HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
        results.push({ text, error: `http_${res.status}` });
        continue;
      }
      const j = await res.json();
      raw = j?.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      console.log(`❌ 网络错误：${e.message}`);
      results.push({ text, error: e.message });
      continue;
    }
    const ms = Date.now() - t0;
    try {
      const { intent } = parseIntentResponse(raw);
      console.log(`✅ ${ms}ms`);
      console.log(`   mood       ${intent.mood || '—'}`);
      console.log(`   rationale  ${intent.rationale || '—'}`);
      console.log(`   genres     ${intent.genres.join('、') || '—'}`);
      console.log(`   tempo      ${intent.tempo}   language ${intent.language}`);
      console.log(`   era        ${intent.era ? `${intent.era.from ?? '?'}–${intent.era.to ?? '今'}` : '—'}`);
      console.log(`   similar    ${intent.similar_artists.join('、') || '—'}`);
      console.log(`   tracks     ${intent.similar_tracks.join('、') || '—'}`);
      console.log(`   exclude    ${intent.exclude_artists.join('、') || '—'} ${intent.exclude_genres.join('、') || ''}`);
      console.log(`   target     ${intent.target_count}`);
      results.push({ text, intent });
    } catch (e) {
      console.log(`❌ 解析失败：${e.message}`);
      console.log(`   raw: ${raw.slice(0, 200)}`);
      results.push({ text, error: 'parse_failed', raw });
    }
    console.log('');
  }

  const ok = results.filter((r) => r.intent).length;
  console.log(`\n── 汇总 ──`);
  console.log(`成功 ${ok}/${results.length}`);
  const fails = results.filter((r) => r.error);
  if (fails.length) console.log(`失败：${fails.map((f) => `${f.text.slice(0, 20)}(${f.error})`).join(', ')}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
