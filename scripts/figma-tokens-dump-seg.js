// ─────────────────────────────────────────────────────────────
// AETHER token — 只读 use_figma 段：导出变量 dump + 渲染后的 SCSS
//
// 为什么需要它：REST 的 /v1/files/:key/variables/local 要 `file_variables:read` scope，
// 属 Figma Enterprise 能力。2026-09-20 实测本机两条 PAT：一条 401（已失效），
// 一条 /v1/me 200 但 variables/local 回
//   "Invalid scope(s): ... This endpoint requires the file_variables:read scope"
// → 配了 GitHub secret 也跑不起实时腿。
//
// 替代路径就是本段：通过 Figma MCP 的 `use_figma`（OAuth，不需要 PAT scope）跑同一件事。
// 无需 fs 访问，纯只读，不改画布。
//
// 用法（在支持 Figma MCP 的 agent 里直接把下面 SEG1 的代码作为 use_figma 的 code 参数）：
//   fileKey:   FtbRZXvzlCp4Sq9e322cQQ
//   skillNames: resource:figma-use
//   返回: { collections, totalVars, cssLen, cssHash, css, dump }
//
// 拿到返回值后（这一步必须人工落盘，use_figma 没有 fs 权限）：
//   1. 把 dump 的 variables 数组按**快照原有顺序 + 新变量追加尾部**写进
//      scripts/figma-tokens-dump.json（保持人工规范序，如 Radius 按数值升序）
//   2. npm run tokens:export      # 重新生成 _tokens.generated.scss
//   3. npm run tokens:check       # 必须 0 exit
//   4. git diff --stat            # 期望只有"新增/改动的那几行"；多出别的行 = 手抄打错了
//
// 第 4 步是本路径的**转录校验**：任何数字抄错都会在生成物里多出一行 diff。
// 2026-09-20 首次使用：+1 行（--status-error），cssHash a7081058 / 1847 字节。
// 注意 cssHash 与仓库生成物不会恒等 —— 快照是人工规范序（Radius 8,10,12,14,16,20,24），
// Figma 原生是创建序（8,12,16,20,24,10,14），`check-token-drift.mjs` 已显式区分二者。
// ─────────────────────────────────────────────────────────────

const SEG1 = `
const getVars = figma.variables.getLocalVariablesAsync
  ? () => figma.variables.getLocalVariablesAsync()
  : async () => figma.variables.getLocalVariables();
const getCols = figma.variables.getLocalVariableCollectionsAsync
  ? () => figma.variables.getLocalVariableCollectionsAsync()
  : async () => figma.variables.getLocalVariableCollections();

const cols = await getCols();
const vars = await getVars();
const colById = new Map(cols.map((c) => [c.id, c]));
const varById = new Map(vars.map((v) => [v.id, v]));

// 别名链解析：semantic → primitive，最多 8 层，避免环形 alias 死循环
const resolve = (v) => {
  let cur = v, raw = null, depth = 0;
  while (cur && depth < 8) {
    const col = colById.get(cur.variableCollectionId);
    const modeId = col ? col.modes[0].modeId : null;
    raw = cur.valuesByMode[modeId];
    if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
      cur = varById.get(raw.id);
      depth++;
    } else break;
  }
  return { raw, depth, unresolved: !!(raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') };
};
const round = (n) => Math.round(n * 10000) / 10000;

const entries = vars.map((v) => {
  const { raw, depth, unresolved } = resolve(v);
  const col = colById.get(v.variableCollectionId);
  let value = raw;
  if (v.resolvedType === 'COLOR' && raw && typeof raw === 'object' && 'r' in raw) {
    value = { r: round(raw.r), g: round(raw.g), b: round(raw.b), a: raw.a === undefined ? 1 : round(raw.a) };
  }
  return { name: v.name, resolvedType: v.resolvedType, value, collection: col ? col.name : null, aliasDepth: depth, unresolved };
});

// 复刻 scripts/lib/aether-tokens.mjs 的 renderScss —— 同样的映射才能苹果对苹果。
// 改映射时这里要同步（测试靠 git diff 行数 + 与仓库生成物对比兜底）。
const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
const toCss = (e) => {
  const v = e.value;
  if (e.resolvedType === 'COLOR') {
    const r = hex(v.r), g = hex(v.g), b = hex(v.b);
    const a = v.a ?? 1;
    return a >= 1 ? '#' + r + g + b
      : 'rgba(' + Math.round(v.r * 255) + ', ' + Math.round(v.g * 255) + ', ' + Math.round(v.b * 255) + ', ' + Number(a.toFixed(3)) + ')';
  }
  if (e.resolvedType === 'FLOAT') return '' + v;
  if (e.name.includes('/ease-') || e.name.startsWith('ease-')) return '' + v;
  return '"' + v + '"';
};
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[./]/g, '-').toLowerCase();
const GROUPS = ['Color/primitive', 'Color/semantic', 'Spacing', 'Radius', 'Motion'];
const lines = [
  '// ============================================================',
  '// AETHER tokens — 由 Figma 变量自动导出（figma-export-tokens.mjs）',
  '// 请勿手改此文件；设计变更后重新导出',
  '// ============================================================',
  ':root {',
];
const buckets = Object.fromEntries(GROUPS.map((g) => [g, []]));
const unmapped = [];
for (const e of entries) {
  const grp = GROUPS.find((g) => e.name.startsWith(g + '/'));
  if (!grp) { unmapped.push(e.name); continue; }
  const key = e.name.slice(grp.length + 1);
  let cssVar;
  if (grp === 'Color/semantic') cssVar = '--' + kebab(key);
  else if (grp === 'Color/primitive') cssVar = '--primitive-' + kebab(key);
  else if (grp === 'Spacing') cssVar = '--space-' + key;
  else if (grp === 'Radius') cssVar = '--radius-' + key;
  else if (key.startsWith('duration-')) cssVar = '--motion-' + kebab(key);
  else cssVar = '--' + kebab(key);
  const val = toCss(e);
  const withUnit = (cssVar.startsWith('--space-') || cssVar.startsWith('--radius-')) && e.resolvedType === 'FLOAT' ? val + 'px' : val;
  buckets[grp].push('  ' + cssVar + ': ' + withUnit + ';');
}
for (const g of GROUPS) { lines.push('  // ---- ' + g + ' ----'); lines.push(...buckets[g]); }
lines.push('}', '');
const css = lines.join('\\n');

let h = 5381;
for (let i = 0; i < css.length; i++) h = ((h * 33) ^ css.charCodeAt(i)) >>> 0;

return JSON.stringify({
  collections: cols.map((c) => ({ name: c.name, modes: c.modes.map((m) => m.name), varCount: c.variableIds.length })),
  totalVars: entries.length,
  unmappedFromExport: unmapped,
  unresolvedAliases: entries.filter((e) => e.unresolved).map((e) => e.name),
  cssLen: css.length,
  cssHash: h.toString(16),
  css,
  dump: JSON.stringify({ variables: entries.map(({ name, resolvedType, value }) => ({ name, resolvedType, value })) }),
});
`;

module.exports = { SEG1 };
