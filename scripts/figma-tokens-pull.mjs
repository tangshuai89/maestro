#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER token 实时拉取 — REST /v1/files/:key/variables/local
//
// 为什么需要它：`check-token-drift.mjs` 的离线腿只能证明"代码与快照一致"，
// 证明不了"快照与 Figma 一致"。本脚本补上后者，让漂移在 Figma 侧发生的当天就被发现。
//
// 用法:
//   FIGMA_TOKEN=xxx node scripts/figma-tokens-pull.mjs           # 只对比，不写文件
//   FIGMA_TOKEN=xxx node scripts/figma-tokens-pull.mjs --write   # 刷新 scripts/figma-tokens-dump.json
//   FIGMA_TOKEN=xxx node scripts/figma-tokens-pull.mjs --out /tmp/live.json
//
// 退出码:
//   0 = 拿到数据且与已提交快照一致
//   1 = 拿到数据但与快照有漂移
//   3 = 拿不到数据（无 token / 403 缺 file_variables scope / 404）—— CI 视为"跳过"而非失败
//
// 注：REST 需要带 `file_variables` scope 的 PAT，Figma 侧属 Enterprise 能力。
// 无该 scope 时等价路径是 Figma MCP 的 use_figma 只读段（OAuth，不需要 PAT scope），
// 见 specs/d4-token-drift/tasks.md 的 Phase B 执行记录。
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTokens } from './lib/aether-tokens.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE_KEY = process.env.FIGMA_FILE_KEY || 'FtbRZXvzlCp4Sq9e322cQQ';
const TOKEN = process.env.FIGMA_TOKEN;
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const outFlag = argv.indexOf('--out');
const OUT = outFlag !== -1 ? argv[outFlag + 1] : resolve(__dirname, 'figma-tokens-dump.json');

const SKIP = (msg) => {
  console.error(`⏭  ${msg}`);
  process.exit(3);
};

if (!TOKEN) {
  SKIP('缺少 FIGMA_TOKEN。CI 里属正常跳过；本地想跑请先 `export FIGMA_TOKEN=<带 file_variables scope 的 PAT>`');
}

let res;
try {
  // figd_ 新式 PAT 只能走 X-Figma-Token；带 Authorization 头会被 401 拒（见 figma-aether-v4-audit.mjs 注释）
  res = await fetch(`https://api.figma.com/v1/files/${FILE_KEY}/variables/local`, {
    headers: { 'X-Figma-Token': TOKEN },
  });
} catch (e) {
  // DNS / 连接失败：与"没配 token"同类，算跳过而不是把每日 job 打红
  SKIP(`连不上 api.figma.com（${e.cause?.code ?? e.message}）。离线环境或网络受限时属正常跳过。`);
}

if (res.status === 403) {
  SKIP(
    'PAT 缺 `file_variables` scope（Figma REST 变量接口要 Enterprise 权限）。\n' +
    '    补救: Figma → Settings → Security → Personal access tokens → 重建 token 并勾选 file_variables\n' +
    '    替代: 用 Figma MCP 的 use_figma 只读段导出（OAuth，无需 PAT scope）'
  );
}
if (res.status === 404) SKIP(`文件不可访问（file key 写错，或 token 无该文件权限）: ${FILE_KEY}`);
if (!res.ok) SKIP(`REST 返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);

const body = await res.json();
const meta = body.meta ?? {};
const rawVars = Object.values(meta.variables ?? {});
const rawCols = meta.variableCollections ?? {};
if (!rawVars.length) SKIP('REST 返回 0 个变量（文件里没有本地变量，或 token 看不到）');

const byId = new Map(rawVars.map((v) => [v.id, v]));
const defaultModeOf = (v) => rawCols[v.variableCollectionId]?.defaultModeId ?? Object.keys(v.valuesByMode ?? {})[0];

const resolveValue = (v) => {
  let cur = v, raw = null, depth = 0;
  while (cur && depth < 8) {
    const modeId = defaultModeOf(cur);
    raw = cur.valuesByMode?.[modeId];
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      cur = byId.get(raw.id);
      depth++;
    } else break;
  }
  const round = (n) => Math.round(n * 10000) / 10000;
  if (cur?.resolvedType === 'COLOR' && raw && typeof raw === 'object' && 'r' in raw) {
    return { r: round(raw.r), g: round(raw.g), b: round(raw.b), a: raw.a === undefined ? 1 : round(raw.a) };
  }
  return raw;
};

// 顺序策略：已提交快照里有的沿用原顺序，新变量追加到尾部。
// 这样 --write 的 diff 只反映真变化，不会因为 API 返回顺序抖动而整文件重排。
const snapshotPath = resolve(__dirname, 'figma-tokens-dump.json');
const prevOrder = existsSync(snapshotPath)
  ? (JSON.parse(readFileSync(snapshotPath, 'utf8')).variables ?? []).map((v) => v.name)
  : [];
const live = rawVars.map((v) => ({ name: v.name, resolvedType: v.resolvedType, value: resolveValue(v) }));
const liveByName = new Map(live.map((v) => [v.name, v]));
const ordered = [
  ...prevOrder.map((n) => liveByName.get(n)).filter(Boolean),
  ...live.filter((v) => !prevOrder.includes(v.name)),
];

// ── 与快照对比（按名字，不看顺序） ──────────────────────────────
const prevByName = new Map(
  (existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')).variables ?? [] : [])
    .map((v) => [v.name, JSON.stringify(v.value)])
);
const added = live.filter((v) => !prevByName.has(v.name)).map((v) => v.name);
const removed = [...prevByName.keys()].filter((n) => !liveByName.has(n));
const changed = live
  .filter((v) => prevByName.has(v.name) && prevByName.get(v.name) !== JSON.stringify(v.value))
  .map((v) => ({ name: v.name, snapshot: prevByName.get(v.name), live: JSON.stringify(v.value) }));

const hasDrift = added.length + removed.length + changed.length > 0;
console.log(`Figma 实时变量: ${live.length} 个（快照 ${prevByName.size} 个）`);
if (added.length) console.log(`  ＋ 新增 ${added.length}: ${added.join(', ')}`);
if (removed.length) console.log(`  － 删除 ${removed.length}: ${removed.join(', ')}`);
if (changed.length) {
  console.log(`  ✎ 改值 ${changed.length}:`);
  for (const c of changed) console.log(`     ${c.name}: 快照=${c.snapshot} → 实时=${c.live}`);
}
if (!hasDrift) console.log('  ✅ 与快照一致');

// 顺带体检：映射覆盖率（有变量既没进 SCSS 也没被报出来的情况）
const mapped = collectTokens(ordered);
if (mapped.length !== live.length) {
  const unmapped = live.filter((v) => !mapped.some((m) => m.figmaName === v.name)).map((v) => v.name);
  console.log(`  ⚠️  ${unmapped.length} 个变量不在 AETHER 映射内: ${unmapped.join(', ')}`);
}

if (WRITE) {
  writeFileSync(snapshotPath, JSON.stringify({ variables: ordered.map(({ name, resolvedType, value }) => ({ name, resolvedType, value })) }, null, 1) + '\n');
  console.log(`✅ 已写入快照 ${snapshotPath}`);
} else if (OUT !== snapshotPath) {
  writeFileSync(OUT, JSON.stringify({ variables: ordered.map(({ name, resolvedType, value }) => ({ name, resolvedType, value })) }, null, 1) + '\n');
  console.log(`✅ 已写入 ${OUT}`);
} else if (hasDrift) {
  console.log('（默认不写文件；确认无误后加 --write 刷新快照）');
}

process.exit(hasDrift ? 1 : 0);
