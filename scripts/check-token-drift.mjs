#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER token drift — 双向漂移检测
//
// 用法:
//   node scripts/check-token-drift.mjs                     # 用提交的 dump 快照
//   node scripts/check-token-drift.mjs --dump /tmp/live.json
//   node scripts/check-token-drift.mjs --json               # 机器可读
//   node scripts/check-token-drift.mjs --verbose            # 连"代码独有"的令牌一起列
//
// 两个方向:
//   Figma → SCSS  : dump 渲染出来的 SCSS 必须与提交的 _tokens.generated.scss 一致
//                   （设计改了、代码没跟 → FAIL）
//   SCSS → Figma  : 扫描 _tokens.scss 的手写声明，找出
//                   (a) 与生成层同名的"遮蔽"（生成层后加载 → 手写覆盖静默失效）
//                   (b) 代码独有、Figma 里没有的令牌
//
// 退出码: 0 = 无 FAIL（WARN 不影响）; 1 = 有 drift; 2 = 用法/文件错误
// 关联: specs/d4-token-drift/spec.md · docs/figma-driven-frontend.md §2.4
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScss, parseGeneratedTokens, parseDeclaredNames } from './lib/aether-tokens.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const VERBOSE = argv.includes('--verbose');
const flagAt = argv.indexOf('--dump');
const dumpFlagValue = flagAt !== -1 ? argv[flagAt + 1] : null;
// 兼容旧的调用方式 `node scripts/check-token-drift.mjs <dump.json>`；
// 用显式比较而不是 `!flagAt`——flagAt 为 -1 时 `!(-1)` 是 false，会把第 1 个位置参数当成 flag 值排除掉。
const positional = argv.find((a) => !a.startsWith('--') && (!dumpFlagValue || a !== dumpFlagValue));
const dumpPath = dumpFlagValue || positional || resolve(__dirname, 'figma-tokens-dump.json');

if (!dumpPath || !existsSync(dumpPath)) {
  console.error(`用法: node scripts/check-token-drift.mjs [dump.json] [--dump <path>] [--json] [--verbose]\n找不到 dump: ${dumpPath ?? '(未指定)'}`);
  process.exit(2);
}

const GENERATED = resolve(__dirname, '../packages/renderer/src/styles/base/_tokens.generated.scss');
const HANDWRITTEN = resolve(__dirname, '../packages/renderer/src/styles/base/_tokens.scss');
const ALLOWLIST = resolve(__dirname, 'token-drift-allowlist.json');

// ── 1. Figma 侧：dump → 期望的生成物 ────────────────────────────
const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const vars = Array.isArray(dump) ? dump : dump.variables;
if (!Array.isArray(vars)) {
  console.error(`❌ dump 结构不对（缺 variables 数组）: ${dumpPath}`);
  process.exit(2);
}
const { css: expectedCss, unmapped } = renderScss(vars);
const figmaTokens = parseGeneratedTokens(expectedCss);

// ── 2. 仓库侧：提交的生成物 ─────────────────────────────────────
if (!existsSync(GENERATED)) {
  console.error(`❌ 缺生成物 ${GENERATED}\n   先跑: node scripts/figma-export-tokens.mjs ${dumpPath}`);
  process.exit(2);
}
const committedCss = readFileSync(GENERATED, 'utf8');
const scssTokens = parseGeneratedTokens(committedCss);

// ── 3. 逐 token 比对 ────────────────────────────────────────────
const allKeys = new Set([...scssTokens.keys(), ...figmaTokens.keys()]);
const missingInScss = [];
const missingInFigma = [];
const valueMismatch = [];
for (const key of allKeys) {
  if (!scssTokens.has(key)) missingInScss.push({ name: key, figma: figmaTokens.get(key) });
  else if (!figmaTokens.has(key)) missingInFigma.push({ name: key, scss: scssTokens.get(key) });
  else if (scssTokens.get(key) !== figmaTokens.get(key))
    valueMismatch.push({ name: key, scss: scssTokens.get(key), figma: figmaTokens.get(key) });
}

// 3b. 整文件字节比对（抓"手改生成物"的痕迹，含注释/顺序/表头）
const SNAPSHOT = resolve(__dirname, 'figma-tokens-dump.json');
const isSnapshot = resolve(dumpPath) === SNAPSHOT;
let byteDiff = null;
let orderOnlyDiff = false;
if (committedCss !== expectedCss) {
  const a = committedCss.split('\n');
  const b = expectedCss.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      byteDiff = { line: i + 1, committed: a[i] ?? '(缺行)', expected: b[i] ?? '(缺行)' };
      break;
    }
  }
  // 快照里的 token 顺序是人工规范的（如 Radius 按数值升序），Figma 原生是创建序。
  // 只有"用提交的快照渲染"时顺序不一致才算 drift；外部 dump 只报信息。
  if (!isSnapshot) {
    orderOnlyDiff = true;
    byteDiff = null;
  }
}

// ── 4. SCSS → Figma 方向：手写层遮蔽 / 代码独有 ──────────────────
const handwrittenNames = existsSync(HANDWRITTEN) ? parseDeclaredNames(readFileSync(HANDWRITTEN, 'utf8')) : new Set();
const generatedNames = new Set(scssTokens.keys());
const allowlist = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')).allow ?? [] : [];
const allowByName = new Map(allowlist.map((e) => [e.name, e]));
const malformedAllow = allowlist.filter((e) => !e.reason || !e.name).map((e) => e.name ?? '(缺 name)');

const shadowed = [...handwrittenNames]
  .filter((n) => generatedNames.has(n))
  .map((n) => ({
    name: n,
    handwritten: '<见 _tokens.scss>',
    generated: scssTokens.get(n),
    allowReason: allowByName.get(n)?.reason ?? null,
  }));
const codeOnly = [...handwrittenNames].filter((n) => !generatedNames.has(n));

// ── 5. 报告 ─────────────────────────────────────────────────────
const hasDrift = missingInScss.length > 0 || missingInFigma.length > 0 || valueMismatch.length > 0 || byteDiff !== null;
const unexplainedShadow = shadowed.filter((s) => !s.allowReason);
const ok = !hasDrift;

if (AS_JSON) {
  console.log(JSON.stringify({
    ok,
    dumpPath,
    counts: { dumpVars: vars.length, figmaTokens: figmaTokens.size, scssTokens: scssTokens.size },
    missingInScss, missingInFigma, valueMismatch, byteDiff,
    unmappedVariables: unmapped,
    shadowed, unexplainedShadow,
    codeOnly, malformedAllow,
  }, null, 2));
} else {
  // NB: 报告统一走 stdout。stderr 不带缓冲，与 stdout 混排时会出现
  // "⚠️ 一行插在中间、续行跑到末尾"的错乱输出。退出码才是给 CI 的信号。
  if (byteDiff) {
    console.log('❌ 生成物与 dump 渲染结果不一致（_tokens.generated.scss 被手改过，或 dump 过期）:');
    console.log(`   第 ${byteDiff.line} 行`);
    console.log(`   仓库: ${byteDiff.committed.trim()}`);
    console.log(`   期望: ${byteDiff.expected.trim()}`);
  }
  if (missingInScss.length) {
    console.log('❌ Figma 有、SCSS 缺失的 token:');
    for (const t of missingInScss) console.log(`   ${t.name}: ${t.figma}`);
  }
  if (missingInFigma.length) {
    console.log('❌ SCSS 有、Figma 缺失的 token（生成物里手加了 token？）:');
    for (const t of missingInFigma) console.log(`   ${t.name}: ${t.scss}`);
  }
  if (valueMismatch.length) {
    console.log('❌ 值不一致:');
    for (const t of valueMismatch) console.log(`   ${t.name}: SCSS=${t.scss} vs Figma=${t.figma}`);
  }
  if (unmapped.length) {
    console.log(`⚠️  ${unmapped.length} 个 Figma 变量不在 AETHER 映射内（既没进 SCSS 也没报错）:`);
    for (const n of unmapped.slice(0, 10)) console.log(`   ${n}`);
  }
  if (orderOnlyDiff) {
    console.log('ℹ️  该 dump 的渲染结果与仓库生成物不完全一致；若 token 级比对无 ❌，则差异来自顺序（快照是人工规范序，Figma 原生是创建序）——允许');
  }
  for (const s of shadowed) {
    if (s.allowReason) {
      console.log(`ℹ️  遮蔽（已登记）   ${s.name} → 生成层 ${s.generated}（手写层被覆盖；原因: ${s.allowReason}）`);
    } else {
      console.log(`⚠️  遮蔽（未登记）   ${s.name} → 生成层生效 ${s.generated}；_tokens.scss 里的同名声明被静默覆盖`);
      console.log('   （main.scss 先 @use base/tokens 再 @use base/tokens.generated，生成层后加载所以胜出）');
      console.log('   三条路选一：改 Figma 变量值 / 删掉手写那行 / 在 scripts/token-drift-allowlist.json 登记并写 reason');
    }
  }
  if (malformedAllow.length) {
    console.log(`⚠️  allowlist 里有 ${malformedAllow.length} 条缺 name/reason: ${malformedAllow.join(', ')}`);
  }
  if (VERBOSE && codeOnly.length) {
    console.log(`ℹ️  代码独有（Figma 没有，通常是有意为之的 -ui / legacy 令牌）: ${codeOnly.length} 个`);
    console.log(`   ${codeOnly.join(', ')}`);
  } else if (codeOnly.length) {
    console.log(`ℹ️  代码独有令牌 ${codeOnly.length} 个（--verbose 看清单）`);
  }
}

if (ok) {
  if (!AS_JSON) {
    console.log(`✅ Token 一致（${scssTokens.size} 个 token · dump ${vars.length} 个变量）`);
    if (unexplainedShadow.length) console.log(`   ⚠️ 另有 ${unexplainedShadow.length} 处未登记的遮蔽（见上，不阻断 CI）`);
  }
  process.exit(0);
} else {
  if (!AS_JSON) {
    console.log(`\n共 ${missingInScss.length + missingInFigma.length + valueMismatch.length + (byteDiff ? 1 : 0)} 处 drift`);
    console.log('修复（二选一）:');
    console.log(`  · dump 是新的、代码该跟 → node scripts/figma-export-tokens.mjs ${dumpPath}`);
    console.log('  · 代码是对的、dump 过期 → node scripts/figma-tokens-pull.mjs --write');
  }
  process.exit(1);
}
