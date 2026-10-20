// ─────────────────────────────────────────────────────────────
// 老旧设计稿 → 组件候选 分析器（纯函数，无 IO）
//
// 为什么需要它：仓库里已有的 scripts/figma-aether-v4-*.js 是**逐文件手写**的构建脚本
// —— 每个组件、每个变量、每个变体都由人先在 spec 里定稿，再翻译成 Plugin API 代码。
// 这条路精确，但只对「已经被人读过、被人命名过」的那一份文件成立。
//
// 换一份老设计稿（客户稿 / 旧版本稿 / 别的项目稿），整套 spec + 脚本要从零重写。
// 本模块补的就是这条缺失的**前半段**：把任意一份扁平老稿，自动分析成
// 「令牌候选 + 组件候选 + 变体轴候选 + 屏幕清单」的机器可读计划。
//
// ── 聚类模型（两段签名，关键）──────────────────────────────
//   结构签名 structSig  = 层级 + 布局 + 圆角 + 效果 + 文字样式（**不含颜色**）
//                         → 同一个组件的所有变体共享它 → 用来判定「这是一类组件」
//   样式签名 styleSig   = 结构签名 + 颜色（fill / stroke / text）
//                         → 同一组件下的不同变体 → 用来判定「变体轴是什么」
//
// 为什么不能只用一份签名：
//   · 只用完整样式签名 → 同一个按钮的 4 个平台色会被拆成 4 个互不相干的组件
//   · 只用结构签名   → 丢失变体信息，无法建议 variant axis
//   · 把相对坐标算进签名 → 同一排并列的 4 个按钮因为 x 不同被拆成 4 类（错）
// 所以：坐标**不进**签名；位置差异由「实例摆放」表达，不是组件身份的一部分。
//
// 输入：Figma REST `GET /v1/files/:key` 的响应（document 树）
// 输出：retrofit plan（见 buildRetrofitPlan）
//
// 纯函数、无网络、无依赖 —— 便于用 fixture 做离线回归。
// ─────────────────────────────────────────────────────────────

/** Figma 颜色 {r,g,b,a}（0..1）→ #rrggbb / rgba */
export function colorToHex(c) {
  if (!c) return null;
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255);
  const hex = [to255(c.r), to255(c.g), to255(c.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  const a = c.a ?? 1;
  return a >= 1 ? `#${hex}` : `#${hex}${to255(a).toString(16).padStart(2, '0')}`;
}

/** 节点是否有已绑定的变量（绑定变量优先于裸色值，是「已经组件化」的信号） */
function boundVarOf(paint) {
  const bv = paint?.boundVariables;
  if (!bv) return null;
  return bv.color?.id || null;
}

/** 只取 SOLID 画刷，线性/渐变/图片单独计（渐变不是令牌，是设计决策） */
function solidPaints(paints) {
  if (!Array.isArray(paints)) return [];
  return paints.filter((p) => p?.visible !== false && p?.type === 'SOLID');
}

/**
 * 画刷的规范化签名：颜色 hex + 透明度。
 * 已绑变量的画刷用变量 id 代替颜色 —— 这样「同一个变量绑在不同节点」仍然聚成一类。
 */
function paintSignature(paint) {
  const bound = boundVarOf(paint);
  if (bound) return `var:${bound}`;
  return `c:${colorToHex(paint.color)}@${paint.opacity ?? 1}`;
}

function strokesSignature(node, withColor) {
  const sw = solidPaints(node.strokes);
  if (!sw.length) return '';
  const colors = withColor ? sw.map(paintSignature).sort().join(',') : '*';
  return `s:${colors}/${node.strokeWeight ?? 1}${node.dashPattern?.length ? '/dash' : ''}`;
}

function fillsSignature(node, withColor) {
  const fw = solidPaints(node.fills);
  if (!fw.length) return '';
  const colors = withColor ? fw.map(paintSignature).sort().join(',') : '*';
  return `f:${colors}/${node.opacity ?? 1}`;
}

function effectsSignature(node) {
  if (!Array.isArray(node.effects) || !node.effects.length) return '';
  return (
    'e:' +
    node.effects
      .map((e) => {
        if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
          return `${e.type}@${colorToHex(e.color)}/${Math.round(e.offset?.x ?? 0)},${Math.round(
            e.offset?.y ?? 0,
          )}/${Math.round(e.radius ?? 0)}/${Math.round(e.spread ?? 0)}`;
        }
        if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
          return `${e.type}/${Math.round(e.radius ?? 0)}`;
        }
        return e.type ?? 'UNKNOWN';
      })
      .sort()
      .join(',')
  );
}

function radiusSignature(node) {
  if (Array.isArray(node.rectangleCornerRadii)) {
    return 'r:' + node.rectangleCornerRadii.join('/');
  }
  if (typeof node.cornerRadius === 'number') return 'r:' + node.cornerRadius;
  return '';
}

function textSignature(node) {
  if (node.type !== 'TEXT') return '';
  const style = node.style ?? {};
  return (
    `t:${style.fontFamily ?? '-'}/${style.fontWeight ?? '-'}/${style.fontSize ?? '-'}` +
    `/${style.lineHeightPx ?? '-'}/${style.letterSpacing ?? 0}/${style.textAlignHorizontal ?? '-'}`
  );
}

function layoutSignature(node) {
  if (!node.layoutMode || node.layoutMode === 'NONE') return '';
  return (
    `l:${node.layoutMode}/${node.itemSpacing ?? '-'}/${node.primaryAxisSizingMode ?? '-'}` +
    `/${node.counterAxisSizingMode ?? '-'}/${node.paddingLeft ?? 0},${node.paddingRight ?? 0},` +
    `${node.paddingTop ?? 0},${node.paddingBottom ?? 0}`
  );
}

/** 容器型节点（有子节点、值得当组件候选的类型） */
export function isContainer(node) {
  return (
    node &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'].includes(node.type)
  );
}

/**
 * 节点签名。
 * @param node 目标节点
 * @param withColor false = 结构签名（忽略颜色，用于聚「同一类组件」）
 * @returns {string}
 *
 * 刻意**不含**：节点 id、图层名、文本内容、相对坐标。
 * 刻意**含**：层级、布局、圆角、效果、文字样式（颜色受 withColor 控制）。
 */
export function nodeSignature(node, withColor = true) {
  const own = [
    node.type,
    fillsSignature(node, withColor),
    strokesSignature(node, withColor),
    radiusSignature(node),
    effectsSignature(node),
    textSignature(node),
    layoutSignature(node),
  ].join('|');

  if (!isContainer(node)) return own;

  const kids = node.children.map((c) => nodeSignature(c, withColor)).sort();
  return `${own}{${kids.join(',')}}`;
}

// ── 命名 ──────────────────────────────────────────────────

/** 机器生成的通用名 —— 老稿最典型的特征，命中就说明「这份稿子的命名不可信」 */
const GENERIC_NAMES = new Set([
  'group',
  'frame',
  'rectangle',
  'rect',
  'ellipse',
  'oval',
  'shape',
  'layer',
  'component',
  'instance',
  'vector',
  'line',
  'group1',
  'frame1',
  'auto-generated',
  'unnamed',
]);

export function isGenericName(name) {
  if (!name) return true;
  const n = String(name).trim().toLowerCase();
  if (GENERIC_NAMES.has(n)) return true;
  // group5 / frame12 / 123 —— 编号后缀
  return /^(group|frame|rectangle|rect|ellipse|shape|layer|component)\s*\d+$/.test(n);
}

/** 图层名 → 组件名建议（仓库约定：Group/Name，PascalCase） */
export function suggestComponentName(names) {
  const counts = new Map();
  for (const raw of names) {
    if (!raw) continue;
    const cleaned = String(raw)
      .replace(/[【】[\]()（）]/g, ' ')
      .replace(/\.(png|svg|jpeg|jpg)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  if (!counts.size) return { name: null, confidence: 'generic' };
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  if (isGenericName(top)) return { name: null, confidence: 'generic' };
  const words = top
    .split(/[\s/_\-·]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (!words.length) return { name: null, confidence: 'generic' };
  if (words.length === 1) return { name: `${words[0]}/Default`, confidence: 'semantic' };
  if (words.length === 2) return { name: `${words[0]}/${words[1]}`, confidence: 'semantic' };
  return { name: `${words[0]}/${words.slice(1).join('')}`, confidence: 'semantic' };
}

// ── 变体轴 ────────────────────────────────────────────────

/** 取节点的主填充色（变体轴的典型来源） */
function primaryFill(node) {
  const fw = solidPaints(node.fills);
  if (fw.length) return paintSignature(fw[0]);
  for (const c of node.children ?? []) {
    const nested = primaryFill(c);
    if (nested) return nested;
  }
  return null;
}

/** 取节点内第一个 TEXT 的颜色 */
function firstTextColor(node) {
  for (const c of node.children ?? []) {
    if (c.type === 'TEXT') {
      const fw = solidPaints(c.fills);
      if (fw.length) return paintSignature(fw[0]);
    }
    const nested = firstTextColor(c);
    if (nested) return nested;
  }
  return null;
}

/**
 * 从一组**变体**（同一结构、不同样式）里推导变体轴。
 * 只保留离散、基数 ≤6 的维度。
 */
function deriveAxes(variants) {
  const axes = [];
  const first = variants[0].node;

  const fill = primaryFill(first);
  if (fill) {
    const values = new Set(variants.map((v) => primaryFill(v.node)));
    if (values.size >= 2 && values.size <= 6) {
      axes.push({
        name: 'tone',
        values: [...values].map((v) => v?.replace(/^c:/, '') ?? 'null'),
      });
    }
  }

  const textColor = firstTextColor(first);
  if (textColor) {
    const values = new Set(variants.map((v) => firstTextColor(v.node)));
    if (values.size >= 2 && values.size <= 6) {
      axes.push({
        name: 'textTone',
        values: [...values].map((v) => v?.replace(/^c:/, '') ?? 'null'),
      });
    }
  }

  const sizeBucket = (n) => {
    const b = n.absoluteBoundingBox;
    if (!b) return 'na';
    return `${Math.round(b.width / 8) * 8}x${Math.round(b.height / 8) * 8}`;
  };
  const sizes = new Set(variants.map((v) => sizeBucket(v.node)));
  if (sizes.size >= 2 && sizes.size <= 6) {
    axes.push({ name: 'size', values: [...sizes] });
  }

  const kidCount = (n) => n.children?.length ?? 0;
  const counts = new Set(variants.map((v) => kidCount(v.node)));
  if (counts.size >= 2 && counts.size <= 4) {
    axes.push({ name: 'content', values: [...counts].map(String) });
  }

  return axes;
}

/** 统计一棵树里的全部节点 */
function walk(node, parent, visit) {
  visit(node, parent);
  for (const c of node.children ?? []) walk(c, node, visit);
}

/**
 * 收集子树里所有 TEXT 节点，key 是「结构路径」（相对根的 child 索引链）。
 * 路径是稳定的：同结构的两棵树，路径一一对应 —— 所以可以用它来对齐
 * 「同一个视觉单元里，哪几个位置的文字内容在不同实例间不一样」。
 */
export function collectTextPaths(node, prefix = '', out = new Map()) {
  (node.children ?? []).forEach((c, i) => {
    const p = prefix ? `${prefix}/${i}` : `${i}`;
    if (c.type === 'TEXT') {
      out.set(p, { value: c.characters ?? '', name: c.name ?? '', id: c.id });
    }
    if (c.children?.length) collectTextPaths(c, p, out);
  });
  return out;
}

/**
 * 判断哪些文本位置在「同一组重复单元」之间内容不同。
 * 内容不同的位置 → 组件属性（TEXT property），否则实例化后所有实例会显示同一段字。
 */
export function varyingTextProperties(nodes) {
  if (!nodes.length) return [];
  const maps = nodes.map((n) => collectTextPaths(n));
  const allPaths = new Set();
  for (const m of maps) for (const p of m.keys()) allPaths.add(p);

  const result = [];
  let i = 0;
  for (const p of allPaths) {
    const values = [];
    for (const m of maps) {
      const v = m.get(p)?.value ?? null;
      if (!values.includes(v)) values.push(v);
    }
    if (values.length >= 2) {
      const first = maps[0].get(p);
      const suggested = first && !isGenericName(first.name) ? first.name : null;
      i += 1;
      result.push({
        path: p,
        propName: suggested ? String(suggested).replace(/[^a-zA-Z0-9_]/g, '_') : `text_${i}`,
        distinctValues: values.length,
        sampleValues: values.slice(0, 3),
        suggestedName: suggested,
      });
    }
  }
  return result;
}

/** 每个实例在各个文本位上的实际取值（生成实例覆盖时要用） */
export function occurrenceTextValues(nodes) {
  return nodes.map((n) => {
    const m = collectTextPaths(n);
    const values = {};
    for (const [p, info] of m) values[p] = info.value;
    return { nodeId: n.id, values };
  });
}

function countNodes(node) {
  let n = 1;
  for (const c of node.children ?? []) n += countNodes(c);
  return n;
}

/**
 * 主入口：老稿 → 改造计划。
 *
 * @param {object} file Figma REST 文件响应（至少含 document）
 * @param {object} opts
 * @param {number} opts.minCluster 至少出现几次才算重复单元（默认 2）
 * @param {number} opts.minNodes  簇内最小节点数，太小的碎片没价值（默认 3）
 * @param {number} opts.maxComponents 最多输出多少组件候选（默认 40，按出现次数降序）
 */
export function buildRetrofitPlan(file, opts = {}) {
  const minCluster = opts.minCluster ?? 2;
  const minNodes = opts.minNodes ?? 3;
  const maxComponents = opts.maxComponents ?? 40;

  const doc = file?.document;
  if (!doc) throw new Error('输入不是有效的 Figma 文件响应（缺少 document）');

  const pages = (doc.children ?? []).filter((c) => c.type === 'CANVAS' || c.type === 'PAGE');

  // ---------- 1. 令牌候选 ----------
  const colorUse = new Map(); // hex → { count, roles:Set, bound }
  const typography = new Map();
  const spacing = new Map();
  const radius = new Map();
  const effectUse = new Map();
  const existingTextStyles = new Map();
  let nodeCount = 0;
  let boundColorNodes = 0;
  let unboundColorNodes = 0;

  const bumpColor = (hex, role, bound) => {
    if (!hex) return;
    if (!colorUse.has(hex)) colorUse.set(hex, { count: 0, roles: new Set(), bound: 0 });
    const e = colorUse.get(hex);
    e.count += 1;
    e.roles.add(role);
    if (bound) e.bound += 1;
  };

  const allNodes = [];
  for (const page of pages) {
    walk(page, null, (node, parent) => {
      nodeCount += 1;
      allNodes.push({ node, parent, page: page.name });
      for (const p of solidPaints(node.fills)) {
        const bound = Boolean(boundVarOf(p));
        if (bound) boundColorNodes += 1;
        else unboundColorNodes += 1;
        bumpColor(colorToHex(p.color), node.type === 'TEXT' ? 'text' : 'surface', bound);
      }
      for (const p of solidPaints(node.strokes)) {
        const bound = Boolean(boundVarOf(p));
        if (bound) boundColorNodes += 1;
        else unboundColorNodes += 1;
        bumpColor(colorToHex(p.color), 'border', bound);
      }

      if (node.type === 'TEXT') {
        const st = node.style ?? {};
        const key = [
          st.fontFamily ?? '-',
          st.fontWeight ?? '-',
          st.fontSize ?? '-',
          st.lineHeightPx ?? '-',
          st.letterSpacing ?? 0,
        ].join('|');
        if (!typography.has(key)) {
          typography.set(key, {
            fontFamily: st.fontFamily ?? null,
            fontWeight: st.fontWeight ?? null,
            fontSize: st.fontSize ?? null,
            lineHeightPx: st.lineHeightPx ?? null,
            letterSpacing: st.letterSpacing ?? 0,
            count: 0,
            samples: [],
            styleId: node.styleId ?? null,
          });
        }
        const t = typography.get(key);
        t.count += 1;
        if (node.styleId) {
          t.styleId = node.styleId;
          existingTextStyles.set(node.styleId, (existingTextStyles.get(node.styleId) ?? 0) + 1);
        }
        if (t.samples.length < 3 && node.characters) t.samples.push(node.characters.slice(0, 24));
      }

      if (node.layoutMode && node.layoutMode !== 'NONE') {
        for (const v of [
          node.itemSpacing,
          node.paddingLeft,
          node.paddingRight,
          node.paddingTop,
          node.paddingBottom,
        ]) {
          if (typeof v === 'number' && v > 0) spacing.set(v, (spacing.get(v) ?? 0) + 1);
        }
      }

      const radii = Array.isArray(node.rectangleCornerRadii)
        ? node.rectangleCornerRadii
        : typeof node.cornerRadius === 'number'
          ? [node.cornerRadius]
          : [];
      for (const r of radii) {
        if (typeof r === 'number' && r > 0) radius.set(r, (radius.get(r) ?? 0) + 1);
      }

      for (const e of node.effects ?? []) {
        if (!e || e.visible === false) continue;
        const key =
          e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'
            ? `${e.type}@${colorToHex(e.color)}/${Math.round(e.offset?.x ?? 0)},${Math.round(
                e.offset?.y ?? 0,
              )}/${Math.round(e.radius ?? 0)}`
            : `${e.type}/${Math.round(e.radius ?? 0)}`;
        effectUse.set(key, (effectUse.get(key) ?? 0) + 1);
      }
    });
  }

  // ---------- 2. 组件候选：结构签名聚「类」，样式签名聚「变体」 ----------
  /** @type {Map<string, {structSig:string, nodes:Array, meta:Array, pages:Set}>} */
  const groups = new Map();
  for (const { node, parent, page } of allNodes) {
    if (!isContainer(node)) continue;
    // 页面下的顶层 frame 是「屏幕」，不是组件 —— 它们是待重建的对象，
    // 已经在 screens 清单里单独列出；混进组件候选会误导（整屏被当成一个巨型组件）。
    if (parent && (parent.type === 'CANVAS' || parent.type === 'PAGE')) continue;
    const structSig = nodeSignature(node, false);
    if (!groups.has(structSig)) {
      groups.set(structSig, { structSig, nodes: [], meta: [], pages: new Set() });
    }
    const g = groups.get(structSig);
    g.nodes.push(node);
    const b = node.absoluteBoundingBox;
    g.meta.push({
      nodeId: node.id,
      parentId: parent?.id ?? null,
      index: parent && Array.isArray(parent.children) ? parent.children.indexOf(node) : -1,
      x: b?.x ?? null,
      y: b?.y ?? null,
      width: b?.width ?? null,
      height: b?.height ?? null,
    });
    g.pages.add(page);
    void parent;
  }

  const componentCandidates = [];
  for (const g of groups.values()) {
    if (g.nodes.length < minCluster) continue;
    const size = g.nodes.reduce((acc, n) => acc + countNodes(n), 0);
    if (size < minNodes) continue;

    // 组内按完整样式签名切变体
    const variantMap = new Map();
    for (const n of g.nodes) {
      const styleSig = nodeSignature(n, true);
      if (!variantMap.has(styleSig)) variantMap.set(styleSig, []);
      variantMap.get(styleSig).push(n);
    }
    const variants = [...variantMap.entries()].map(([styleSig, nodes]) => ({
      styleSig,
      node: nodes[0],
      nodes,
      count: nodes.length,
    }));

    const { name, confidence } = suggestComponentName(g.nodes.map((n) => n.name));
    const textProperties = varyingTextProperties(g.nodes);
    const occurrences = occurrenceTextValues(g.nodes);

    componentCandidates.push({
      suggestedName: name,
      nameConfidence: confidence,
      nameSamples: [...new Set(g.nodes.map((n) => n.name))].slice(0, 5),
      occurrences: g.nodes.length,
      nodeCount: size,
      variantCount: variants.length,
      axes: deriveAxes(variants),
      textProperties,
      occurrenceTextValues: occurrences,
      occurrenceMeta: g.meta,
      variants: variants.map((v) => ({
        styleSig: v.styleSig.length > 200 ? v.styleSig.slice(0, 200) + '…' : v.styleSig,
        count: v.count,
        nodeIds: v.nodes.map((n) => n.id),
        primaryFill: primaryFill(v.node),
        nodeName: v.node.name,
      })),
      nodeIds: g.nodes.map((n) => n.id),
      pages: [...g.pages],
      signature: g.structSig.length > 400 ? g.structSig.slice(0, 400) + '…' : g.structSig,
    });
  }
  componentCandidates.sort((a, b) => b.occurrences - a.occurrences || b.nodeCount - a.nodeCount);

  // ---------- 3. 屏幕清单 ----------
  const screens = [];
  for (const page of pages) {
    for (const child of page.children ?? []) {
      if (!['FRAME', 'SECTION', 'GROUP', 'COMPONENT', 'COMPONENT_SET'].includes(child.type))
        continue;
      const b = child.absoluteBoundingBox;
      screens.push({
        page: page.name,
        name: child.name,
        nodeId: child.id,
        width: b?.width ?? null,
        height: b?.height ?? null,
        childCount: child.children?.length ?? 0,
        autoLayout: child.layoutMode && child.layoutMode !== 'NONE' ? child.layoutMode : null,
        isComponent: child.type === 'COMPONENT' || child.type === 'COMPONENT_SET',
      });
    }
  }

  // ---------- 4. 覆盖率 ----------
  const clustered = new Set();
  for (const g of groups.values()) {
    if (g.nodes.length < minCluster) continue;
    for (const n of g.nodes) {
      const stack = [n];
      while (stack.length) {
        const cur = stack.pop();
        clustered.add(cur.id);
        for (const c of cur.children ?? []) stack.push(c);
      }
    }
  }
  const coverage = nodeCount ? clustered.size / nodeCount : 0;

  // ---------- 5. 组装输出 ----------
  const countList = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

  const colors = [...colorUse.entries()]
    .map(([hex, e]) => ({
      hex,
      count: e.count,
      roles: [...e.roles],
      boundUses: e.bound,
    }))
    .sort((a, b) => b.count - a.count);

  // 角色 → 建议的语义令牌组
  const roleGroups = {
    text: colors.filter((c) => c.roles.includes('text')).map((c) => c.hex),
    surface: colors.filter((c) => c.roles.includes('surface')).map((c) => c.hex),
    border: colors.filter((c) => c.roles.includes('border')).map((c) => c.hex),
  };

  return {
    meta: {
      source: file.__source ?? null,
      pageCount: pages.length,
      pageNames: pages.map((p) => p.name),
      nodeCount,
      analyzedAt: new Date().toISOString(),
    },
    stats: {
      boundColorNodes,
      unboundColorNodes,
      boundRatio:
        boundColorNodes + unboundColorNodes
          ? boundColorNodes / (boundColorNodes + unboundColorNodes)
          : 0,
      groupCount: groups.size,
      repeatedGroupCount: componentCandidates.length,
      componentizableCoverage: Number(coverage.toFixed(4)),
      unnamedGroupCount: componentCandidates.filter((c) => c.nameConfidence === 'generic').length,
    },
    tokens: {
      colors,
      roleGroups,
      typography: [...typography.values()].sort((a, b) => b.count - a.count),
      textStylesExisting: [...existingTextStyles.entries()].map(([styleId, count]) => ({
        styleId,
        count,
      })),
      spacing: countList(spacing),
      radius: countList(radius),
      effects: countList(effectUse),
    },
    components: componentCandidates.slice(0, maxComponents),
    screens,
  };
}
