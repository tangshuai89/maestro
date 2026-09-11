#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// figma-code-connect.json TBD-FIGMA → 真实 nodeId 注入器
// 用途：D5_NEW 10 个占位映射在用户跑完 use_figma 拿到真实 nodeId 后，
//       用此脚本一键替换并清理 _status / _note 字段。
// 用法:
//   node scripts/figma-code-connect-inject.mjs \
//     --ids=I100:1,I100:2,...,I100:10 \
//     --names=Modal/Shell,Modal/ErrorPanel,...,Modal/NeteaseCookie
//   cat /tmp/use_figma_outputs.json | node scripts/figma-code-connect-inject.mjs --from-stdin
//   node scripts/figma-code-connect-inject.mjs --from-output=/tmp/use_figma_outputs.json
//   node scripts/figma-code-connect-inject.mjs --dry-run  # 只打印不写
// 退出码: 0 = 全部替换成功, 1 = 缺参数 / 找不到映射 / 写入失败
// 关联: scripts/figma-v4-d5-new-command.md（Step 4）
//        scripts/figma-code-connect-validate.mjs --strict（替换后应 110/110 PASS）
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');
const JSON_PATH = join(repo, 'figma-code-connect.json');

// ---------- 默认顺序（D5_NEW 10 个，SEG1 + SEG2 各 5） ----------
const DEFAULT_ORDER = [
  { name: 'Modal/Shell', seg: 'SEG1' },
  { name: 'Modal/ErrorPanel', seg: 'SEG1' },
  { name: 'Modal/RecoLoading', seg: 'SEG1' },
  { name: 'SourceChip', seg: 'SEG1' },
  { name: 'Layout/QualityMenu', seg: 'SEG1' },
  { name: 'Layout/SourceMenu', seg: 'SEG2' },
  { name: 'Layout/DeezerPresetSelect', seg: 'SEG2' },
  { name: 'Screen/SourceSelect', seg: 'SEG2' },
  { name: 'Titlebar', seg: 'SEG2' },
  { name: 'Modal/NeteaseCookie', seg: 'SEG2' },
];

// ---------- 解析参数 ----------
// 优先用 `=` 形式的位置参数（避免 node 22 默认吞 dash 形参的问题）
const kvArgs = {};
const flagArgs = new Set();
const positional = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--') && a.includes('=')) {
    const [k, ...rest] = a.slice(2).split('=');
    kvArgs[k] = rest.join('=');
  } else if (a.startsWith('--')) {
    flagArgs.add(a.slice(2));
  } else {
    positional.push(a);
  }
}
function getArg(name) { return kvArgs[name] || null; }
function hasFlag(name) { return flagArgs.has(name); }
const DRY_RUN = hasFlag('dry-run');

let pairs = null;
if (hasFlag('--from-stdin')) {
  // 从 stdin 读 JSON 数组 [{name, id, seg?}, ...]
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  const trimmed = buf.trim();
  if (!trimmed) { console.error('stdin 是空'); process.exit(1); }
  try {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error('stdin 需为 JSON 数组');
    pairs = arr.map(x => ({ name: x.name, id: x.id || x.nodeId, seg: x.seg || '' }));
  } catch (e) { console.error('stdin JSON 解析失败:', e.message); process.exit(1); }
} else if (hasFlag('--from-output')) {
  const p = getArg('from-output');
  if (!p) { console.error('--from-output 需要文件路径'); process.exit(1); }
  const arr = JSON.parse(readFileSync(resolve(p), 'utf8'));
  // 兼容两种格式：[{name, id}] 或 {sets: [{name, ...}], createdNodeIds: [...]}
  if (Array.isArray(arr)) {
    pairs = arr.map(x => ({ name: x.name, id: x.id || x.nodeId, seg: x.seg || '' }));
  } else if (arr.sets && Array.isArray(arr.sets)) {
    // 来自 SEG1/SEG2 输出：{"sets": ["Modal/Shell", ...], "createdNodeIds": ["I100:1", ...]}
    pairs = arr.sets.map((name, i) => ({ name, id: arr.createdNodeIds[i], seg: '' }));
  } else {
    console.error('--from-output JSON 格式未知'); process.exit(1);
  }
} else {
  // 从 --ids + --names 解析
  const ids = (getArg('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
  let names = (getArg('names') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0 || names.length === 0) {
    console.error('用法:');
    console.error('  --ids=ID1,ID2,...,ID10 --names=Name1,...,Name10');
    console.error('  --from-stdin        从 stdin 读 [{name,id,seg?}, ...]');
    console.error('  --from-output=path  从文件读 use_figma 输出');
    console.error('  --dry-run           只打印不写');
    console.error('');
    console.error('默认顺序（也可只传 --ids 按默认顺序配对 --names=DEFAULT）:');
    for (const p of DEFAULT_ORDER) console.error(`  ${p.seg.padEnd(5)} ${p.name.padEnd(28)} <-- id[${DEFAULT_ORDER.indexOf(p)}]`);
    process.exit(1);
  }
  // --names=DEFAULT 展开成 10 个默认名字
  if (names.length === 1 && names[0] === 'DEFAULT') names = DEFAULT_ORDER.map(p => p.name);
  if (ids.length !== names.length) {
    console.error(`--ids (${ids.length}) 与 --names (${names.length}) 数量不匹配`);
    process.exit(1);
  }
  pairs = ids.map((id, i) => ({ name: names[i], id }));
}

// ---------- 校验 pairs ----------
if (pairs.length !== 10) {
  console.warn(`⚠️  期望 10 个映射，实际 ${pairs.length}；常见于 D5_NEW 阶段补集`);
}
const seen = new Set();
for (const p of pairs) {
  if (!p.name) { console.error('缺 name:', p); process.exit(1); }
  if (!p.id) { console.error(`缺 id: ${p.name}`); process.exit(1); }
  if (!/^[\d:I;\-]+$/.test(p.id)) { console.error(`非标准 nodeId 格式: ${p.name} = ${p.id}`); process.exit(1); }
  if (seen.has(p.name)) { console.error(`name 重复: ${p.name}`); process.exit(1); }
  seen.add(p.name);
}

// ---------- 加载 + 修改 ----------
const map = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const mappings = map.mappings || [];
const before = mappings.map(m => ({ figmaComponent: m.figmaComponent, figmaNodeId: m.figmaNodeId, _status: m._status }));

const replaced = [];
const missed = [];
for (const p of pairs) {
  const m = mappings.find(x => x.figmaComponent === p.name);
  if (!m) { missed.push({ reason: 'mapping 未找到', ...p }); continue; }
  if (m.figmaNodeId !== 'TBD-FIGMA') {
    // 已被替换过：仍覆盖（用户显式传入）
    replaced.push({ name: p.name, from: m.figmaNodeId, to: p.id, mode: 'OVERWRITE' });
  } else {
    replaced.push({ name: p.name, from: 'TBD-FIGMA', to: p.id, mode: 'NEW' });
  }
  m.figmaNodeId = p.id;
  m._status = 'D1_DONE'; // 与 D1 屏统一
  delete m._note; // _note 多解释"为什么还没"，已无意义
}

// ---------- 写 $history ----------
if (!map.$history) map.$history = {};
map.$history['D5_NEW 阶段（2026-09-10）'] =
  '在 02 · Components 增 10 个新 component set（28 变体），10 个 TBD-FIGMA 占位由用户跑完 D5_NEW 后用 ' +
  'scripts/figma-code-connect-inject.mjs 替换为真实 node_id。_status 从 D5_NEW 统一为 D1_DONE。';

// ---------- Diff 输出 ----------
console.log(`\n── figma-code-connect.json 注入 diff (${replaced.length}/${pairs.length} 替换)${DRY_RUN ? ' [DRY-RUN]' : ''} ──\n`);
for (const r of replaced) {
  console.log(`  ${r.mode === 'NEW' ? '✓ NEW    ' : '↻ REWRITE'}  ${r.name.padEnd(28)} ${r.from} → ${r.to}`);
}
if (missed.length) {
  console.log(`\n  ⚠️  ${missed.length} 项未找到:`);
  for (const m of missed) console.log(`     - ${m.name}: ${m.reason}`);
}

if (DRY_RUN) {
  console.log(`\n  --dry-run 模式：未写入文件`);
  process.exit(0);
}

// ---------- 写入 + 备份 ----------
// 备份到 /tmp 而非仓库根（避免污染 git status）
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `/tmp/figma-code-connect-${ts}.bak`;
writeFileSync(backupPath, readFileSync(JSON_PATH));
writeFileSync(JSON_PATH, JSON.stringify(map, null, 2) + '\n');
console.log(`\n  备份: ${backupPath}`);
console.log(`  写入: ${JSON_PATH}`);
console.log(`\n下一步：node scripts/figma-code-connect-validate.mjs --strict  # 应 110/110 PASS`);
