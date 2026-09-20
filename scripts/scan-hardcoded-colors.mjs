#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 硬编码颜色扫描（专题 token-adoption / S1）
//
// 规则：颜色只能来自**令牌层** ——
//   base/_tokens.scss（手写）、base/_themes.scss（主题覆盖）、base/_tokens.generated.scss（Figma 导出）。
// 其它文件里出现 `#hex` / `rgb()` / `rgba()` / `hsl()` / `hsla()` 都算硬编码，应改成 `var(--token)`。
//
// 纯注释行跳过；行尾 `// 注释` 与同行 `/* 注释 */` 会被剥掉再匹配
// （注释里写设计稿色值不算违规，那是文档）。
//
// 用法:
//   node scripts/scan-hardcoded-colors.mjs           # 出清单
//   node scripts/scan-hardcoded-colors.mjs --gate    # 门禁：超预算即非零退出（对着 budget json）
//   node scripts/scan-hardcoded-colors.mjs --json    # 机器可读
//   node scripts/scan-hardcoded-colors.mjs --verbose # 逐条打印（默认只打 TOP 文件 + 合计）
//
// 关联：specs/token-adoption/spec.md · scripts/token-adoption-budget.json
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'packages/renderer/src');
const BUDGET_PATH = join(__dirname, 'token-adoption-budget.json');

const argv = process.argv.slice(2);
const GATE = argv.includes('--gate');
const AS_JSON = argv.includes('--json');
const VERBOSE = argv.includes('--verbose');
const WRITE_BUDGET = argv.includes('--write-budget');

/** 令牌层：这些文件**就是**颜色的定义处，不算硬编码 */
const TOKEN_LAYER = new Set([
  'packages/renderer/src/styles/base/_tokens.scss',
  'packages/renderer/src/styles/base/_themes.scss',
  'packages/renderer/src/styles/base/_tokens.generated.scss',
]);

const EXT = /\.(scss|tsx|ts)$/;
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[^)]*\)|\bhsla?\(\s*[^)]*\)/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist') walk(p, out);
    } else if (EXT.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** 把注释剥掉再匹配：先处理跨行块注释状态，再剥行尾 // 注释（不误伤 https://） */
function stripComments(lines) {
  let inBlock = false;
  return lines.map((line) => {
    let s = line;
    // 块注释
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (inBlock) {
        const end = s.indexOf('*/', i);
        if (end === -1) { i = s.length; break; }
        inBlock = false;
        i = end + 2;
      } else {
        const start = s.indexOf('/*', i);
        if (start === -1) { out += s.slice(i); break; }
        out += s.slice(i, start);
        inBlock = true;
        i = start + 2;
      }
    }
    s = out;
    // 行尾 // 注释（避开 https:// 这类）
    const idx = s.search(/(^|[^:])\/\//);
    if (idx !== -1) s = s.slice(0, idx + (s[idx] === '/' ? 0 : 1));
    return s;
  });
}

const files = walk(SRC).sort();
const findings = [];
const selfRefs = [];

for (const abs of files) {
  const rel = relative(REPO, abs);
  if (TOKEN_LAYER.has(rel)) continue;
  const raw = readFileSync(abs, 'utf8').split('\n');
  const stripped = stripComments(raw);

  stripped.forEach((line, i) => {
    const matches = line.match(COLOR_RE);
    if (matches) {
      for (const m of matches) {
        findings.push({ file: rel, line: i + 1, literal: m, code: raw[i].trim() });
      }
    }
    // 自引用陷阱：--x: ... var(--x) ...（--glass-stroke 那种）
    const decl = line.match(/^\s*(--[\w-]+)\s*:/);
    if (decl && new RegExp(`var\\(\\s*${decl[1]}\\s*[,)]`).test(line)) {
      selfRefs.push({ file: rel, line: i + 1, name: decl[1], code: raw[i].trim() });
    }
  });
}

const byFile = {};
for (const f of findings) byFile[f.file] = (byFile[f.file] || 0) + 1;
const existing = existsSync(BUDGET_PATH) ? JSON.parse(readFileSync(BUDGET_PATH, 'utf8')) : {};
const budget = existing.budget ?? {};
const exempt = existing.exempt ?? {};

// 豁免：算法/运行时生成的颜色（canvas 绘制、封面取色、console 样式…）——
// 它们不是"设计令牌的复制品"，tokenize 反而错。豁免必须写原因。
const exemptHits = {};
const scoped = findings.filter((f) => {
  if (f.file in exempt) {
    exemptHits[f.file] = (exemptHits[f.file] || 0) + 1;
    return false;
  }
  return true;
});
const scopedByFile = {};
for (const f of scoped) scopedByFile[f.file] = (scopedByFile[f.file] || 0) + 1;
const total = scoped.length;
const rawTotal = findings.length;

if (WRITE_BUDGET) {
  // 自己落预算：避免手抄数字出错；exempt 与注释原样保留
  const next = {
    _comment:
      '棘轮门禁：每个文件允许的硬编码颜色数量上限，**只许降不许升**。' +
      '数字由 `node scripts/scan-hardcoded-colors.mjs --write-budget` 生成（可复现，不要手改）。' +
      '改完一处硬编码就把对应数字减一；exempt 里的文件是算法生成颜色、不参与门禁（必须写原因）。',
    budget: Object.fromEntries(Object.entries(scopedByFile).sort((a, b) => b[1] - a[1])),
    exempt,
  };
  writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`已写入预算: ${BUDGET_PATH}（${Object.keys(scopedByFile).length} 个文件，合计 ${total} 处）`);
  process.exit(0);
}

// 超预算 / 有余量
const over = [];
const slack = [];
for (const [file, allowed] of Object.entries(budget)) {
  const actual = scopedByFile[file] ?? 0;
  if (actual > allowed) over.push({ file, allowed, actual });
  else if (actual < allowed) slack.push({ file, allowed, actual });
}
const unbudgeted = Object.keys(scopedByFile).filter((f) => !(f in budget));

if (AS_JSON) {
  console.log(JSON.stringify({ total, rawTotal, byFile: scopedByFile, exemptHits, unbudgeted, over, slack, selfRefs, findings: scoped }, null, 2));
  process.exit(GATE && (over.length || unbudgeted.length) ? 1 : 0);
}

console.log(`硬编码颜色扫描 — ${files.length} 个文件`);
console.log(`  令牌层（不计入）: ${[...TOKEN_LAYER].map((f) => f.split('/').pop()).join(', ')}`);
console.log(`  命中总数: ${total} 处 / ${Object.keys(scopedByFile).length} 个文件` +
  (Object.keys(exemptHits).length ? `（另有 ${rawTotal - total} 处在 ${Object.keys(exemptHits).length} 个豁免文件里，见下）` : '') + '\n');

const top = Object.entries(scopedByFile).sort((a, b) => b[1] - a[1]);
for (const [file, n] of top) {
  const b = budget[file];
  const tag = b === undefined ? '（无预算）' : b === n ? '' : b > n ? `（预算 ${b}，可下调到 ${n}）` : `（预算 ${b}，**超出 ${n - b}**）`;
  console.log(`  ${String(n).padStart(3)}  ${file}${tag}`);
}

if (VERBOSE) {
  console.log('\n逐条:');
  for (const f of scoped) console.log(`  ${f.file}:${f.line}  ${f.literal}   ${f.code}`);
}

if (Object.keys(exemptHits).length) {
  console.log(`\nℹ️  豁免文件（算法生成颜色，不参与门禁）${Object.keys(exemptHits).length} 个:`);
  for (const [file, n] of Object.entries(exemptHits)) console.log(`  ${String(n).padStart(3)}  ${file}  — ${exempt[file]}`);
}

if (selfRefs.length) {
  console.log(`\n⚠️  var() 自引用（会算出无效值）${selfRefs.length} 处:`);
  for (const s of selfRefs) console.log(`  ${s.file}:${s.line}  ${s.name}  ${s.code}`);
}

if (!GATE) {
  console.log('\n（未开 --gate；加 --gate 会在超预算/无预算时非零退出）');
  process.exit(0);
}

const bad = over.length + unbudgeted.length;
if (bad) {
  console.log('\n❌ 门禁失败:');
  for (const o of over) console.log(`   ${o.file}: ${o.actual} > 预算 ${o.allowed}（超出 ${o.actual - o.allowed}）`);
  for (const f of unbudgeted) console.log(`   ${f}: ${scopedByFile[f]} 处，但没有预算条目`);
  console.log('\n   改法二选一: 把硬编码换成 var(--token)；或（仅当你确实要新增设计自由）把预算调高并说明原因。');
  process.exit(1);
}
console.log('\n✅ 门禁通过: 没有文件超预算');
if (slack.length) {
  console.log(`   可以下调预算的文件 ${slack.length} 个（改完就减，防回退）:`);
  for (const s of slack) console.log(`     ${s.file}: ${s.allowed} → ${s.actual}`);
}
