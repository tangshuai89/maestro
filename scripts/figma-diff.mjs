#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER — Figma → 前端 差异清单（统一入口）
//
// 回答一个问题：**设计稿变了，前端代码该改什么？**
//
// 为什么需要这个入口（2026-10-29 盘点）：
//   · 仓库侧有四条「审计腿」（check-token-drift / audit / audit-d6 / audit-d10），
//     但每条各自要 FIGMA_TOKEN（REST variables/local 要 Enterprise
//     `file_variables:read`），没有一条能汇总成一张「该改哪些文件」的清单。
//   · 离线腿只证明「代码 == 提交的 dump 快照」，**证明不了「快照 == Figma 现状」**
//     —— 快照停在 2026-10-13，之后 renderer/src/styles 改了 26 次。
//   · 所以「设计稿变更 → 前端感知」这条链路的真实能力 ≈ 0。
//
// 用法：
//   node scripts/figma-diff.mjs                  # markdown 清单（可直接喂 coding agent）
//   node scripts/figma-diff.mjs --json           # 机器可读
//   node scripts/figma-diff.mjs --gate           # 有未豁免的 must/should 差异 → exit 1
//   node scripts/figma-diff.mjs --snapshot <p>   # 指定别的 snapshot 文件
//   node scripts/figma-diff.mjs --allowlist <p>  # 指定别的豁免表（默认 scripts/figma-diff-allowlist.json）
//   node scripts/figma-diff.mjs --only tokens    # 只看某条腿（tokens|components|descriptions|motion）
//
// 退出码：0 = 无未豁免的 must/should 差异；1 = 有差异（--gate）；2 = 用法/文件错误/快照退化
//
// 两条「防假绿」的硬规则（都是 2026-10-29 实现期实测加的）：
//   ① **空快照必须报错**：components/screens 同时为空 ⇒ 几乎一定是采集失败或抄断，
//      比对会得到"0 差异"、门禁会绿 —— 而真相是"根本没采到"。⇒ exit 2。
//   ② **must 永远不可豁免**：豁免表只对 should 生效。豁免项仍会打印在清单里
//      （「已豁免」段），只是不红。豁免条目必须带 reason，否则视为未登记。
//
// 关联：specs/figma-diff/ · docs/figma-driven-frontend.md §9
//       · specs/token-adoption/tasks.md（S3-10 起这批腿的 token 侧基线）
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderScss, parseGeneratedTokens } from './lib/aether-tokens.mjs';
import {
  diffTokens,
  diffComponents,
  diffDescriptions,
  diffMotion,
  summarize,
  renderMarkdown,
  parseContract,
  reactPathOf,
} from './lib/figma-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const GATE = argv.includes('--gate');
const VERBOSE = argv.includes('--verbose');

const flagAt = argv.indexOf('--snapshot');
const snapshotPath = flagAt !== -1 ? argv[flagAt + 1] : resolve(__dirname, 'figma-snapshot.json');
const allowAt = argv.indexOf('--allowlist');
const allowlistPath =
  allowAt !== -1 ? argv[allowAt + 1] : resolve(__dirname, 'figma-diff-allowlist.json');
const onlyAt = argv.indexOf('--only');
const only = onlyAt !== -1 ? argv[onlyAt + 1] : null;

const PATHS = {
  snapshot: snapshotPath,
  tokenDump: resolve(__dirname, 'figma-tokens-dump.json'),
  generated: resolve(ROOT, 'packages/renderer/src/styles/base/_tokens.generated.scss'),
  codeConnect: resolve(ROOT, 'figma-code-connect.json'),
  motionSpec: resolve(ROOT, 'specs/motion-spec.json'),
  allowlist: allowlistPath,
  rendererSrc: resolve(ROOT, 'packages/renderer/src'),
};

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(2);
}

// ── 0. 读 snapshot ───────────────────────────────────────────────
// 快照缺失 **不是错误状态**（还没采集过）→ 明确提示并 exit 0，让 CI 跳过这条腿。
// 但显式 `--snapshot <path>` 指定了却不存在 → exit 2（那是调用方的错）。
const SNAPSHOT_EXPLICIT = flagAt !== -1;
if (!existsSync(PATHS.snapshot)) {
  if (SNAPSHOT_EXPLICIT) {
    fail(`找不到 Figma 快照: ${PATHS.snapshot}`);
  }
  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { ok: true, skipped: true, reason: 'no_snapshot', snapshot: PATHS.snapshot, diffs: [] },
        null,
        2,
      ),
    );
  } else {
    console.log('ℹ️  尚未采集 Figma 快照 —— 本腿跳过（不是错误）。');
    console.log('');
    console.log('   采集步骤：把 scripts/figma-snapshot-seg.js 的 SEG1 贴给 use_figma 跑一次，');
    console.log('   把返回值落盘成 scripts/figma-snapshot.json（采集脚本里有完整用法）。');
  }
  process.exit(0);
}
let snapshot;
try {
  snapshot = JSON.parse(readFileSync(PATHS.snapshot, 'utf8'));
} catch (e) {
  fail(`快照不是合法 JSON: ${PATHS.snapshot}\n   ${e.message}`);
}
if (!snapshot || typeof snapshot !== 'object') fail('快照结构不对（应为对象）');

// ── 0b. 退化快照守卫 ─────────────────────────────────────────────
// 为什么要这条：**一个空的/被截断的快照会伪装成"一切正常"**。
// 采集段失败、JSON 抄断、Claude Code 写了个 `{}` —— 这些情况下
// components/screens 都是空数组 → 比对结果 0 差异 → 门禁绿 →
// 而真相是"根本没采到"。⇒ 这必须报错，不能当成"无差异"。
//
// 判据：components 与 screens 同时为空 ⇒ 退化（真实文件里这两个都有内容：
// 34 个组件集 + 6+ 屏）。motion 可以为空（MOTION SPEC frame 可能不存在）。
const rawComponents = Array.isArray(snapshot.components) ? snapshot.components : null;
const rawScreens = Array.isArray(snapshot.screens) ? snapshot.screens : null;
if (rawComponents === null || rawScreens === null) {
  fail(
    `快照结构不对：components / screens 必须是数组（当前：${rawComponents === null ? 'components 非数组' : 'components ok'} / ${rawScreens === null ? 'screens 非数组' : 'screens ok'}）\n   ${PATHS.snapshot}`,
  );
}
if (rawComponents.length === 0 && rawScreens.length === 0) {
  fail(
    `快照是空的（components 0 个 / screens 0 个）—— 这几乎一定是采集失败或抄断，不是"设计稿没有差异"。\n   请重跑采集段并核对 scripts/figma-snapshot.json 的内容。`,
  );
}

// ── 1. 解析 AI_CONTRACT（浅解析逻辑在 lib/figma-snapshot.mjs，可离线单测）──
const components = (snapshot.components ?? []).map((c) => ({
  ...c,
  aiContract: parseContract(c.contract),
}));
for (const c of components) {
  const rp = reactPathOf(c.aiContract);
  if (rp) c.aiContract.react = rp;
}
const screens = (snapshot.screens ?? []).map((s) => ({
  ...s,
  aiContract: parseContract(s.contract),
}));
for (const s of screens) {
  const rp = reactPathOf(s.aiContract);
  if (rp) s.aiContract.react = rp;
}

// ── 2. 仓库侧状态 ───────────────────────────────────────────────
// 2a. code-connect 映射
let mappings = [];
if (existsSync(PATHS.codeConnect)) {
  try {
    mappings = JSON.parse(readFileSync(PATHS.codeConnect, 'utf8')).mappings ?? [];
  } catch (e) {
    fail(`figma-code-connect.json 不是合法 JSON: ${e.message}`);
  }
}

// 2b. 生成的 token 层
let repoTokens = new Map();
if (existsSync(PATHS.generated)) {
  repoTokens = parseGeneratedTokens(readFileSync(PATHS.generated, 'utf8'));
} else {
  fail(`缺生成物 ${PATHS.generated}`);
}

// 2c. token dump（Figma 侧的 token 快照）
let figmaTokens = new Map();
let tokenDumpMeta = { present: false };
if (existsSync(PATHS.tokenDump)) {
  try {
    const dump = JSON.parse(readFileSync(PATHS.tokenDump, 'utf8'));
    const vars = Array.isArray(dump) ? dump : dump.variables;
    if (Array.isArray(vars)) {
      const { css } = renderScss(vars);
      figmaTokens = parseGeneratedTokens(css);
      tokenDumpMeta = { present: true, variables: vars.length };
    }
  } catch (e) {
    fail(`token dump 解析失败: ${e.message}`);
  }
}

// 2d. 仓库侧动效 spec
let repoMotionSpec = [];
if (existsSync(PATHS.motionSpec)) {
  try {
    const raw = JSON.parse(readFileSync(PATHS.motionSpec, 'utf8'));
    repoMotionSpec = Array.isArray(raw) ? raw : (raw.spec ?? []);
  } catch (e) {
    fail(`specs/motion-spec.json 不是合法 JSON: ${e.message}`);
  }
}

// 2e. 代码里实际的 @keyframes
function collectKeyframes(dir, acc = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) collectKeyframes(p, acc);
    else if (/\.(scss|tsx|ts|css)$/.test(entry.name)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)) acc.add(m[1]);
    }
  }
  return acc;
}
let codeKeyframes = new Set();
if (existsSync(PATHS.rendererSrc)) {
  codeKeyframes = collectKeyframes(PATHS.rendererSrc);
}

// 2f. 仓库侧 React 文件是否存在（components 腿要用）
const repoFileExists = (rel) => {
  if (!rel) return false;
  const p = resolve(ROOT, rel);
  return existsSync(p);
};

// ── 3. 比对 ─────────────────────────────────────────────────────
const wants = (lane) => !only || only === lane;
let diffs = [];

if (wants('tokens') && figmaTokens.size) {
  diffs = diffs.concat(diffTokens(repoTokens, figmaTokens));
}
if (wants('components')) {
  diffs = diffs.concat(diffComponents(components, mappings, repoFileExists, screens));
}
if (wants('descriptions')) {
  // 屏幕也是「AI 要读语义」的对象，一并纳入
  diffs = diffs.concat(diffDescriptions([...components, ...screens]));
}
if (wants('motion')) {
  diffs = diffs.concat(diffMotion(snapshot.motion?.spec ?? [], repoMotionSpec, codeKeyframes));
}

// ── 3.5 豁免（allowlist）─────────────────────────────────────────
// 为什么需要：快照一提交进仓库，`--gate` 就从"永远跳过"变成**真门禁**。
// 而真门禁上线当天必然红 —— 当前仓库里已知的 should 级差异有两类
// （code-connect 覆盖率没跟上 / motion spec 没登记全部 keyframes），
// 它们短期修不完（后者要同步 Figma，是死锁）。
//
// ⇒ 照 `scripts/token-drift-allowlist.json` 的既有范式：**类级豁免 + 必填 reason**。
//   豁免只对 `should` 生效；**`must` 永远不可豁免**（那是"前端不做就错"的真问题）。
//   类级而非逐条：这两类的根因各只有一个，逐条登记会变成没人维护的噪音；
//   修好一类就删一条豁免。豁免项仍会**打印出来**（只是不红）。
//
// 格式：
//   { "allow": [ { "kind": "unmapped", "target": "figma-code-connect.json", "reason": "…" } ] }
//   kind   —— 必填，差异的小类名（见 lib 的 kind 字段）
//   lane   —— 可选，进一步限定
//   target —— 可选，进一步限定（相对仓库根的路径）
//   reason —— **必填**，没有 reason 视为未登记 → 不豁免（防止"为了过门禁随手加一条"）
function loadAllowlist() {
  if (!existsSync(PATHS.allowlist)) return [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(PATHS.allowlist, 'utf8'));
  } catch (e) {
    fail(`figma-diff-allowlist.json 不是合法 JSON: ${e.message}`);
  }
  const list = Array.isArray(raw) ? raw : (raw.allow ?? []);
  return Array.isArray(list) ? list : [];
}

function waiverReasonFor(diff, allowlist) {
  if (diff.severity === 'must') return null; // must 不可豁免
  for (const entry of allowlist) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.reason || !String(entry.reason).trim()) continue; // 无 reason = 未登记
    if (entry.kind && entry.kind !== diff.kind) continue;
    if (entry.lane && entry.lane !== diff.lane) continue;
    if (entry.target && entry.target !== diff.target) continue;
    if (!entry.kind && !entry.lane && !entry.target) continue; // 空条件不许豁免一切
    return String(entry.reason);
  }
  return null;
}

const allowlist = loadAllowlist();

// ── 4. 输出 ─────────────────────────────────────────────────────
// 4a. 拆分「生效差异」与「已豁免差异」
const active = [];
const waived = [];
for (const d of diffs) {
  const reason = waiverReasonFor(d, allowlist);
  if (reason) waived.push({ ...d, waivedReason: reason });
  else active.push(d);
}

let repoHead = null;
try {
  repoHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
} catch {
  repoHead = null;
}

const stats = summarize(active);
const statsAll = summarize(diffs);
const meta = {
  capturedAt: snapshot.capturedAt ?? '(未记录)',
  fileKey: snapshot.fileKey ?? '?',
  repoHead,
};

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        ok: stats.bySeverity.must === 0 && stats.bySeverity.should === 0,
        snapshot: PATHS.snapshot,
        meta,
        stats,
        statsAll,
        diffs: active,
        waived,
      },
      null,
      2,
    ),
  );
} else {
  console.log(renderMarkdown(active, meta));
  if (waived.length) {
    console.log('');
    console.log(`---`);
    console.log('');
    console.log(`## 已豁免（${waived.length} 项，不阻断门禁）`);
    console.log('');
    console.log('> 登记在 `scripts/figma-diff-allowlist.json`，每条必须带 reason。');
    console.log('');
    for (const d of waived) {
      console.log(`- [${d.lane}] ${d.title} — 豁免理由：${d.waivedReason}`);
    }
    console.log('');
  }
  console.log('');
  console.log(
    `统计：${stats.total} 项生效（must ${stats.bySeverity.must} / should ${stats.bySeverity.should} / note ${stats.bySeverity.note}）` +
      (waived.length ? ` · 另有 ${waived.length} 项已豁免` : ''),
  );
  console.log(
    `按腿：${
      Object.entries(stats.byLane)
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ') || '—'
    }`,
  );
  if (meta.capturedAt && meta.capturedAt !== '(未记录)') {
    console.log('');
    console.log(
      `ℹ️  快照采集于 ${meta.capturedAt}；token 腿用的是 ${PATHS.tokenDump.includes('figma-tokens-dump') ? 'scripts/figma-tokens-dump.json' : PATHS.tokenDump}` +
        `${tokenDumpMeta.present ? `（${tokenDumpMeta.variables} 个变量）` : '（缺失）'}。`,
    );
    console.log('   快照越旧，Figma 侧改动越可能没被捕获 —— 建议每次设计稿大改后重跑采集段。');
  }
  if (VERBOSE) {
    console.log('');
    console.log(
      `ℹ️  代码里 @keyframes 共 ${codeKeyframes.size} 个；仓库 motion spec ${repoMotionSpec.length} 条。`,
    );
  }
}

// ── 5. 退出码 ─────────────────────────────────────────────────────
// 只看**生效**差异：已豁免的不红（但打印出来了）。
if (GATE && (stats.bySeverity.must > 0 || stats.bySeverity.should > 0)) {
  process.exit(1);
}
if (!GATE && stats.bySeverity.must > 0) {
  // 即便不开 --gate，must 级差异也要用退出码表达（CI 友好）
  process.exit(1);
}
process.exit(0);
