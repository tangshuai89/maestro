#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 改造计划 → use_figma 可执行脚本 生成器
//
// 输入：retrofit-plan.json（figma-retrofit-analyze.mjs 的产物）
// 输出：figma-retrofit-plugin.js（module.exports = { SEG1: `...` }，与仓库既有
//       scripts/figma-aether-v4-*.js 同款格式，可直接喂给 use_figma）
//
// ── 它做什么（写侧三件事）─────────────────────────────────
//   1. Foundations：建 3 页 + 把计划里的颜色候选物化成变量（primitive/semantic 两层）
//   2. Components：把老稿里的重复节点**就地提升**为组件（createComponentFromNode），
//      同结构的多个变体 combineAsVariants 成组件集，内容差异位暴露成 TEXT 组件属性
//   3. Screens：把剩下的重复节点替换成实例（保留位置/尺寸 + 覆盖文本属性）
//
// ── 平台硬约束（全部来自官方文档 / 实测，写进代码注释防后人踩）─────────────
//   · 页面上下文每次调用重置到第一页 → 必须 await figma.setCurrentPageAsync(page)，且一次只切一次
//   · 跨调用不保留状态 → 段与段之间的 node id 必须写成字面量
//   · console.log 不回传，return 才是唯一输出通道
//   · figma.notify 在沙箱里抛错，不要用
//   · 单次输出 ≤20KB → 按组件数分段
//   · 脚本非原子（可能部分执行）→ 每段必须幂等
//   · 改文本前必须 loadFontAsync（且不能硬编码字体族，要从节点读）
//   · FRAME 没有 description 属性 → 契约载体用隐藏 TEXT 子节点
//   · 契约元数据用 setSharedPluginData（setPluginData 的 plugin id 每次都变，读不回来）
//   · 组件要手动 publish 之后 Code Connect 映射才能补全
//
// 用法: node scripts/figma-retrofit-plan-to-plugin.mjs <plan.json> [out.js]
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const planPath = resolve(process.argv[2] ?? '/tmp/retrofit-out/retrofit-plan.json');
const outPath = resolve(process.argv[3] ?? '/tmp/retrofit-out/figma-retrofit-plugin.js');

const plan = JSON.parse(readFileSync(planPath, 'utf8'));

const PAGE_FOUNDATIONS = '01 · Foundations';
const PAGE_COMPONENTS = '02 · Components';
const PAGE_SCREENS = '03 · Screens';
const NS = 'maestro'; // setSharedPluginData 命名空间

// ---------- 公共 runtime 片段（每段都自带，不能跨调用共享状态） ----------
const RUNTIME = `
// ── 公共 runtime（每段自包含；use_figma 跨调用不保留状态）──
const PAGE_FOUNDATIONS = ${JSON.stringify(PAGE_FOUNDATIONS)};
const PAGE_COMPONENTS = ${JSON.stringify(PAGE_COMPONENTS)};
const PAGE_SCREENS = ${JSON.stringify(PAGE_SCREENS)};
const NS = ${JSON.stringify(NS)};

async function ensurePage(name) {
  const found = figma.root.children.find((c) => c.type === 'PAGE' && c.name === name);
  if (found) return found;
  const p = figma.createPage();
  p.name = name;
  return p;
}

/** 契约载体：FRAME 没有 description 属性 → 用隐藏 TEXT 子节点（见 specs/d10-motion-spec） */
async function addContract(node, text) {
  const t = figma.createText();
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  t.name = 'AI_CONTRACT';
  t.characters = text;
  t.visible = false;
  node.appendChild(t);
  return t;
}

/** 机器可读契约：必须用 shared（setPluginData 的 plugin id 每次工具执行都变，读不回来） */
function setContract(node, obj) {
  node.setSharedPluginData(NS, 'contract', JSON.stringify(obj));
}

/** 文字节点按结构路径查找（比硬编码 id 稳：createComponentFromNode 只改顶层 id） */
function findByPath(root, path) {
  return path.split('/').reduce((acc, seg) => (acc ? acc.children[Number(seg)] : undefined), root);
}

/** 改文本前先加载节点自身字体（不能硬编码字体族） */
async function loadFontsOf(node) {
  const segs = node.findAllWithCriteria({ types: ['TEXT'] });
  for (const s of segs) {
    const styled = s.getStyledTextSegments(['fontName']);
    const seen = new Set();
    for (const seg of styled) {
      const key = seg.fontName.family + '/' + seg.fontName.style;
      if (seen.has(key)) continue;
      seen.add(key);
      await figma.loadFontAsync(seg.fontName);
    }
  }
}
`;

// ---------- SEG1：Foundations（页 + 变量） ----------
function buildFoundations() {
  const colors = plan.tokens.colors ?? [];
  // 角色 → 语义层；同 hex 同时命中多角色时归到最"重"的那个角色，避免重复建变量
  const roleOf = (c) => {
    if (c.roles.includes('border') && !c.roles.includes('surface')) return 'border';
    if (c.roles.includes('surface')) return 'surface';
    return 'text';
  };
  const primitives = [];
  const semantics = [];
  for (const c of colors) {
    const hex = c.hex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    primitives.push({
      name: 'Color/primitive/' + hex,
      value: {
        r: Number(r.toFixed(4)),
        g: Number(g.toFixed(4)),
        b: Number(b.toFixed(4)),
        a: Number(a.toFixed(4)),
      },
    });
    semantics.push({
      name: 'Color/semantic/' + roleOf(c) + '/' + hex,
      alias: 'Color/primitive/' + hex,
    });
  }

  const primLines = primitives
    .map(
      (p) => `  {
    const v = figma.variables.createVariable(${JSON.stringify(p.name)}, col, 'COLOR');
    v.setValueForMode(modeId, ${JSON.stringify(p.value)});
    v.scopes = ['ALL_FILLS', 'STROKE_COLOR', 'TEXT_FILL'];
    byName.set(v.name, v);
  }`,
    )
    .join('\n');

  const semLines = semantics
    .map(
      (s) => `  {
    const target = byName.get(${JSON.stringify(s.alias)});
    if (target) {
      const v = figma.variables.createVariable(${JSON.stringify(s.name)}, col, 'COLOR');
      v.setValueForMode(modeId, figma.variables.createVariableAlias(target));
      v.scopes = ['ALL_FILLS', 'STROKE_COLOR', 'TEXT_FILL'];
      byName.set(v.name, v);
    }
  }`,
    )
    .join('\n');

  return `// SEG1 — Foundations：建页 + 颜色变量（primitive → semantic 别名链）
${RUNTIME}
const pages = [];
pages.push(await ensurePage(PAGE_FOUNDATIONS));
pages.push(await ensurePage(PAGE_COMPONENTS));
pages.push(await ensurePage(PAGE_SCREENS));
// use_figma 每次调用页面上下文重置 → 显式切到目标页，一次只切一次
await figma.setCurrentPageAsync(pages[0]);

// 变量集合（幂等：已存在就复用）
const cols = await figma.variables.getLocalVariableCollectionsAsync();
let col = cols.find((c) => c.name === 'Retrofit');
if (!col) {
  col = figma.variables.createVariableCollection('Retrofit');
  col.addMode('Default');
}
const modeId = col.modes[0].modeId;

// 已有变量索引（同名复用，避免重复建）
const existing = await figma.variables.getLocalVariablesAsync();
const byName = new Map(existing.map((v) => [v.name, v]));

// primitive 层（原始色）
${primLines}

// semantic 层（别名指向 primitive）
${semLines}

const all = await figma.variables.getLocalVariablesAsync();
return {
  segment: 'SEG1',
  pages: pages.map((p) => p.name),
  variableCount: all.filter((v) => v.variableCollectionId === col.id).length,
};
`;
}

// ---------- SEG2..N：Components ----------
/** 变体轴值 → 变体名后缀（tone=accent 之类；没有语义名时退回 hex 短码） */
function axisValueToToken(axisName, value) {
  const raw = String(value).replace(/^c:/, '');
  if (raw.startsWith('#')) return raw.replace('#', '');
  return raw.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
}

function buildComponents(groups) {
  return `// SEG_COMPONENTS — 老稿重复节点 → 组件 / 组件集
${RUNTIME}
const page = await ensurePage(PAGE_COMPONENTS);
await figma.setCurrentPageAsync(page);

${groups.map(buildGroup).join('\n\n')}

return { segment: 'COMPONENTS', groups: ${groups.length} };
`;
}

/** 单个组件组的段代码 */
function buildGroup(g) {
  const setName = g.suggestedName ?? `Component/${g._index}`;
  const axes = (g.axes ?? []).slice(0, 2); // 变体轴 ≤2（正交轴会爆组合数）
  const variants = g.variants ?? [];

  // 变体规格：每个变体的代表节点 + 变体名
  const variantSpecs = variants.map((v, vi) => {
    const axisSuffix = axes
      .map((ax) => `${ax.name}=${axisValueToToken(ax.name, v.primaryFill ?? 'default')}`)
      .join(', ');
    return {
      vi,
      nodeIds: v.nodeIds,
      primaryFill: v.primaryFill,
      name: axisSuffix ? `${setName}, ${axisSuffix}` : setName,
      contract: contractText(g, setName, axisSuffix ? `${setName}, ${axisSuffix}` : setName),
      meta: {
        kind: 'component-variant',
        set: setName,
        variant: axisSuffix ? `${setName}, ${axisSuffix}` : setName,
        sourceNodeId: v.nodeIds[0],
        textProperties: (g.textProperties ?? []).map((t) => t.propName),
      },
    };
  });

  // 实例清单：每个出现位置 → 变体序号 + 父节点 + 下标 + 几何 + 文本取值
  const textProps = (g.textProperties ?? []).map((tp) => ({
    propName: tp.propName,
    path: tp.path,
  }));
  const valueByNode = new Map((g.occurrenceTextValues ?? []).map((o) => [o.nodeId, o.values]));
  const variantIndexOfNode = new Map();
  variantSpecs.forEach((spec) => spec.nodeIds.forEach((id) => variantIndexOfNode.set(id, spec.vi)));

  const occurrences = (g.occurrenceMeta ?? [])
    .map((m) => ({
      nodeId: m.nodeId,
      vi: variantIndexOfNode.get(m.nodeId) ?? 0,
      parentId: m.parentId,
      index: m.index,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      values: valueByNode.get(m.nodeId) ?? {},
    }))
    // 同一父节点内按下标倒序处理 → 插入/删除不会打乱还没处理的下标
    .sort((a, b) => (a.parentId === b.parentId ? b.index - a.index : 0));

  return `// ── 组件组 ${g._index}: ${setName}（出现 ${g.occurrences} 次 / ${g.variantCount} 变体）──
{
  const SET_NAME = ${JSON.stringify(setName)};
  const VARIANTS = ${JSON.stringify(variantSpecs)};
  const TEXTS = ${JSON.stringify(textProps)};
  const OCCURRENCES = ${JSON.stringify(occurrences)};

  // 1) 取组件集（幂等：已存在直接复用，避免重跑产生重复组件）
  let set = figma.root.findOne(
    (n) => n.type === 'COMPONENT_SET' && n.name === SET_NAME,
  );
  let variants = [];
  if (set) {
    variants =
      set.type === 'COMPONENT_SET' ? set.children.filter((c) => c.type === 'COMPONENT') : [set];
  } else {
    const comps = [];
    for (const spec of VARIANTS) {
      const src = await figma.getNodeByIdAsync(spec.nodeIds[0]);
      if (!src || !('x' in src)) continue;
      if (src.type === 'COMPONENT') {
        comps.push(src); // 已提升过（重跑）
        continue;
      }
      await loadFontsOf(src);
      const comp = figma.createComponentFromNode(src);
      comp.name = spec.name;
      await addContract(comp, spec.contract);
      setContract(comp, spec.meta);
      comps.push(comp);
    }
    if (comps.length > 1) {
      // combineAsVariants 要求同父节点 → 先搬到 02 页
      for (const c of comps) page.appendChild(c);
      set = figma.combineAsVariants(comps, page);
      set.name = SET_NAME;
      variants = set.children.filter((c) => c.type === 'COMPONENT');
    } else if (comps.length === 1) {
      page.appendChild(comps[0]);
      comps[0].name = SET_NAME;
      set = comps[0];
      variants = [comps[0]];
    }
  }

  // 2) 内容差异位 → TEXT 组件属性（否则实例化后所有实例显示同一段字）
  if (variants.length && TEXTS.length) {
    const owner = variants[0];
    for (const tp of TEXTS) {
      const textNode = findByPath(owner, tp.path);
      if (!textNode || textNode.type !== 'TEXT') continue;
      if (!owner.componentPropertyDefinitions[tp.propName]) {
        owner.addComponentProperty(tp.propName, 'TEXT', textNode.characters);
      }
      owner.componentPropertyReferences = {
        ...owner.componentPropertyReferences,
        [tp.propName]: textNode.id,
      };
    }
  }

  // 3) 其余出现位置 → 替换为实例（保留位置/尺寸 + 覆盖文本属性）
  for (const spec of OCCURRENCES) {
    const comp = variants[spec.vi] || variants[0];
    if (!comp) continue;
    const old = await figma.getNodeByIdAsync(spec.nodeId);
    if (!old || !('x' in old)) continue;
    if (old.type === 'INSTANCE') continue; // 幂等：已是实例
    const parent = spec.parentId ? await figma.getNodeByIdAsync(spec.parentId) : null;
    if (!parent || !('insertChild' in parent) || !('children' in parent)) continue;
    const inst = comp.createInstance();
    inst.x = spec.x ?? 0;
    inst.y = spec.y ?? 0;
    if (spec.width > 0 && spec.height > 0) inst.resize(spec.width, spec.height);
    parent.insertChild(spec.index >= 0 ? spec.index : parent.children.length, inst);
    // 代表节点已被搬到 02 页（它就是组件本体，不能删）；其余原始节点删掉
    if (old.type !== 'COMPONENT') old.remove();
    const overrides = {};
    for (const tp of TEXTS) {
      const v = spec.values[tp.path];
      if (v !== undefined) overrides[tp.propName] = v;
    }
    if (Object.keys(overrides).length) inst.setProperties(overrides);
  }

  if (set) {
    setContract(set, ${JSON.stringify({
      kind: 'component-set',
      name: setName,
      variants: variantSpecs.length,
      occurrences: g.occurrences,
      textProperties: textProps.map((t) => t.propName),
    })});
  }
}`;
}

function contractText(g, setName, variantName) {
  return [
    '---AI_CONTRACT---',
    `component: ${setName}`,
    `variant: ${variantName}`,
    `occurrences: ${g.occurrences}`,
    `axes: ${(g.axes ?? []).map((a) => a.name + '(' + a.values.length + ')').join(', ') || '—'}`,
    `textProperties: ${(g.textProperties ?? []).map((t) => t.suggestedName ?? t.path).join(', ') || '—'}`,
    'react: TODO — 由 AI 按代码端组件盘点补 React 路径',
    'props: TODO',
    'a11y: TODO',
    'states: TODO',
  ].join('\n');
}

// ---------- 组装 ----------
const groups = (plan.components ?? []).map((c, i) => ({ ...c, _index: i + 1 }));

// 分段：use_figma 单次输出 ≤20KB → 按体积装箱（不是按个数，装满了就开新段）
const MAX_SEG_BYTES = 16 * 1024; // 留 4KB 余量给 runtime 片段
const RUNTIME_BYTES = RUNTIME.length;
const batches = [];
let cur = [];
let curBytes = RUNTIME_BYTES;
for (const g of groups) {
  const code = buildGroup(g);
  const bytes = code.length;
  if (cur.length && curBytes + bytes > MAX_SEG_BYTES) {
    batches.push(cur);
    cur = [];
    curBytes = RUNTIME_BYTES;
  }
  cur.push(g);
  curBytes += bytes;
}
if (cur.length) batches.push(cur);

const segments = {};
segments.SEG1_FOUNDATIONS = buildFoundations();
batches.forEach((b, i) => {
  segments[`SEG${i + 2}_COMPONENTS`] = buildComponents(b);
});

const header = `#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 老稿 → 组件改造脚本（由 scripts/figma-retrofit-plan-to-plugin.mjs 生成，勿手改）
// 计划来源：${plan.meta.source ?? '(unknown)'} · 生成于 ${plan.meta.analyzedAt ?? ''}
//
// 用法：每段单独喂给 use_figma（一次一段，串行，绝不并行 —— Figma 状态变更必须顺序）
//   use_figma(code = require('./figma-retrofit-plugin.js').SEG1_FOUNDATIONS)
// ─────────────────────────────────────────────────────────────
`;

/**
 * 把一段代码安全地嵌进模板字面量。
 * 顺序要紧：先转义反斜杠（否则 JSON.stringify 出来的 \n 会在模板求值时变成真换行，
 * 把段里的字符串字面量打断），再转义反引号，最后转义 ${ 插值。
 */
const toTemplate = (code) =>
  code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const footer = `module.exports = {
${Object.keys(segments)
  .map((k) => `  ${k}: \`${toTemplate(segments[k])}\`,`)
  .join('\n')}
};
`;

writeFileSync(outPath, header + footer);
console.log(`已生成 ${outPath}`);
console.log(`  段数：${Object.keys(segments).length}`);
console.log(
  `  组件组：${groups.length}（按 ${(MAX_SEG_BYTES / 1024).toFixed(0)}KB 装箱成 ${batches.length} 段）`,
);
console.log(`  变量候选：${plan.tokens?.colors?.length ?? 0} 色`);
for (const k of Object.keys(segments)) {
  console.log(`  · ${k}  ${(segments[k].length / 1024).toFixed(1)} KB`);
}
const oversized = Object.entries(segments).filter(([, v]) => v.length > 18000);
if (oversized.length) {
  console.log(`\n⚠️ 超过 20KB 输出上限的段：${oversized.map(([k]) => k).join(', ')} → 需要再拆`);
}
