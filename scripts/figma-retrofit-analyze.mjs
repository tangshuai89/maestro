#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 老旧设计稿 → 组件改造计划 分析器（CLI）
//
// 用法:
//   node scripts/figma-retrofit-analyze.mjs --file <figma-file.json> [--out <dir>]
//   FIGMA_TOKEN=xxx node scripts/figma-retrofit-analyze.mjs --fetch <fileKey> [--out <dir>]
//   node scripts/figma-retrofit-analyze.mjs --fixture <dir>      # 离线自测
//   node scripts/figma-retrofit-analyze.mjs --file x.json --json  # 机器可读输出
//
// 输入：
//   Figma REST `GET /v1/files/:key` 的响应（含 document 树）
//   解析在 scripts/lib/figma-retrofit.mjs（纯函数，便于离线回归）
//
// 输出：
//   <out>/retrofit-plan.json    机器可读改造计划（令牌候选 / 组件候选 / 变体轴 / 屏幕）
//   <out>/retrofit-report.md    人读报告
//
// 为什么需要它：现有的 scripts/figma-aether-v4-*.js 是**逐文件手写**的构建脚本，
// 只对已经被人读过命名的���份文件成立。换一份老稿要重写整套 spec + 脚本。
// 本脚本补的是那条缺失的通用前半段：老稿 → 组件/令牌候选。
//
// 退出码: 0 = 成功; 1 = 输入/网络错误; 2 = 用法错误
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRetrofitPlan } from './lib/figma-retrofit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const has = (name) => argv.includes(name);

const FILE = flag('--file');
const FETCH = flag('--fetch');
const FIXTURE = flag('--fixture');
const OUT = resolve(flag('--out') ?? resolve(__dirname, '../.figma-retrofit'));
const AS_JSON = has('--json');
const MIN_CLUSTER = Number(flag('--min-cluster') ?? 2);
const MIN_NODES = Number(flag('--min-nodes') ?? 3);
const MAX_COMPONENTS = Number(flag('--max-components') ?? 40);
const FILE_KEY = FETCH || process.env.FIGMA_FILE_KEY || 'FtbRZXvzlCp4Sq9e322cQQ';

if (!FILE && !FETCH && !FIXTURE) {
  console.error(
    '用法:\n' +
      '  node scripts/figma-retrofit-analyze.mjs --file <figma-file.json> [--out <dir>]\n' +
      '  FIGMA_TOKEN=xxx node scripts/figma-retrofit-analyze.mjs --fetch <fileKey> [--out <dir>]\n' +
      '  node scripts/figma-retrofit-analyze.mjs --fixture <dir>',
  );
  process.exit(2);
}

/** 读入文件响应：本地文件 / fixture / 线上 REST */
async function loadFile() {
  if (FILE) {
    if (!existsSync(FILE)) {
      console.error(`找不到文件: ${FILE}`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    data.__source = `file:${FILE}`;
    return data;
  }
  if (FIXTURE) {
    const path = resolve(FIXTURE);
    if (!existsSync(path)) {
      console.error(`找不到 fixture: ${path}`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.__source = `fixture:${path}`;
    return data;
  }
  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    console.error('缺少 FIGMA_TOKEN。REST 读文件需要 PAT（X-Figma-Token 头）。');
    process.exit(1);
  }
  const url = `https://api.figma.com/v1/files/${FILE_KEY}?geometry=paths`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    console.error(`REST ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const data = await res.json();
  data.__source = `rest:${FILE_KEY}`;
  return data;
}

const file = await loadFile();

let plan;
try {
  plan = buildRetrofitPlan(file, {
    minCluster: MIN_CLUSTER,
    minNodes: MIN_NODES,
    maxComponents: MAX_COMPONENTS,
  });
} catch (e) {
  console.error(`分析失败: ${e.message}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'retrofit-plan.json'), JSON.stringify(plan, null, 2) + '\n');

// ---------- 人读报告 ----------
const L = [];
L.push('# 老稿 → 组件改造计划');
L.push('');
L.push(`- 来源：\`${plan.meta.source}\``);
L.push(`- 页面：${plan.meta.pageCount}（${plan.meta.pageNames.join(' / ') || '—'}）`);
L.push(`- 节点总数：${plan.meta.nodeCount}`);
L.push(
  `- 颜色已绑定变量 / 未绑定：${plan.stats.boundColorNodes} / ${plan.stats.unboundColorNodes}`,
);
L.push(
  `- 重复子树组（≥${MIN_CLUSTER} 次）：${plan.stats.repeatedGroupCount} / 共 ${plan.stats.groupCount} 组`,
);
L.push(`- 可组件化覆盖率：${(plan.stats.componentizableCoverage * 100).toFixed(1)}%`);
L.push(`- 其中机器名（需人工/AI 命名）：${plan.stats.unnamedGroupCount} 组`);
L.push('');

L.push('## 1. 颜色候选（按使用次数）');
L.push('');
L.push('| hex | 次数 | 角色 | 已绑定 |');
L.push('| --- | --- | --- | --- |');
for (const c of plan.tokens.colors.slice(0, 25)) {
  L.push(`| \`${c.hex}\` | ${c.count} | ${c.roles.join('/')} | ${c.boundUses} |`);
}
L.push('');
L.push(
  `角色分组：text ${plan.tokens.roleGroups.text.length} 色 · surface ${plan.tokens.roleGroups.surface.length} 色 · border ${plan.tokens.roleGroups.border.length} 色`,
);
L.push('');

L.push('## 2. 文字样式候选');
L.push('');
L.push('| 字体 | 字重 | 字号 | 行高 | 字距 | 次数 | 已有 style |');
L.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const t of plan.tokens.typography.slice(0, 20)) {
  L.push(
    `| ${t.fontFamily ?? '—'} | ${t.fontWeight ?? '—'} | ${t.fontSize ?? '—'} | ${t.lineHeightPx ?? '—'} | ${t.letterSpacing ?? 0} | ${t.count} | ${t.styleId ?? '—'} |`,
  );
}
L.push('');

L.push('## 3. 组件候选（重复子树）');
L.push('');
if (!plan.components.length) {
  L.push(
    '_没有重复子树 —— 这份稿子可能已经是组件化的，或重复单元的尺寸/位置差异过大导致签名不匹配。_',
  );
} else {
  L.push('| 建议名 | 命名可信度 | 出现次数 | 变体数 | 节点数 | 变体轴 | 名称样本 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of plan.components) {
    const axes = c.axes.length ? c.axes.map((a) => `${a.name}(${a.values.length})`).join(' ') : '—';
    L.push(
      `| \`${c.suggestedName ?? '(需命名)'}\` | ${c.nameConfidence === 'generic' ? '⚠️ 机器名' : '语义名'} | ${c.occurrences} | ${c.variantCount} | ${c.nodeCount} | ${axes} | ${c.nameSamples.join(' / ')} |`,
    );
  }
  L.push('');
  const generic = plan.components.filter((c) => c.nameConfidence === 'generic');
  if (generic.length) {
    L.push(
      `> ⚠️ ${generic.length} 个簇的图层名是机器名（group/frame1…），**无法从老稿自动得到语义名** —— 这部分必须靠 AI 命名或人工补名（老稿的命名是给 AI 看的文档，机器名等于没有文档）。`,
    );
    L.push('');
  }
}
L.push('');

L.push('## 4. 屏幕 / 顶层 frame');
L.push('');
L.push('| 页 | 名称 | 尺寸 | 子节点 | auto-layout |');
L.push('| --- | --- | --- | --- | --- |');
for (const s of plan.screens.slice(0, 40)) {
  L.push(
    `| ${s.page} | ${s.name} | ${s.width ?? '—'}×${s.height ?? '—'} | ${s.childCount} | ${s.autoLayout ?? '—'} |`,
  );
}
L.push('');

L.push('---');
L.push('');
L.push('下一步：把 `retrofit-plan.json` 交给 plan→plugin 生成器，产出 `use_figma` 可执行脚本。');
L.push('');

writeFileSync(resolve(OUT, 'retrofit-report.md'), L.join('\n'));

if (AS_JSON) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(L.join('\n'));
  console.log(`→ 计划已写入 ${resolve(OUT, 'retrofit-plan.json')}`);
  console.log(`→ 报告已写入 ${resolve(OUT, 'retrofit-report.md')}`);
}
