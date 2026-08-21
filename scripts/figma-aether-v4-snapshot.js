// ─────────────────────────────────────────────────────────────
// AETHER v4 — 只读现状快照（Step 0 与执行后核对用）
// 文件：FtbRZXvzlCp4Sq9e322cQQ · 任意页面可跑
// 输出：页面/顶层节点/组件集/样式/变量的紧凑 JSON（无任何写入）
// ─────────────────────────────────────────────────────────────

const SEG1 = `
// 只读快照：列出全部页面、顶层节点、组件集、样式、变量（不修改任何内容）
// 注意：interactions 在部分节点（如 FRAME）上是抛异常的 getter，必须 try/catch 包裹
const out = { pages: [], componentSets: [], textStyles: [], effectStyles: [], variables: [] };
for (const p of figma.root.children.filter(x => x.type === 'PAGE')) {
  const nodes = [];
  const walk = (ns, d) => {
    for (const n of ns || []) {
      let inter = 0;
      try { inter = (n.interactions || []).length; } catch (e) { inter = 0; }
      nodes.push({ t: n.type, n: n.name, d, c: (n.children || []).length, i: inter });
      if (d < 1 && (n.type === 'FRAME' || n.type === 'COMPONENT_SET')) walk(n.children, d + 1);
    }
  };
  walk(p.children, 0);
  out.pages.push({ name: p.name, count: nodes.length, nodes });
}
for (const pg of figma.root.children) {
  for (const s of pg.findAllWithCriteria({ types: ['COMPONENT_SET'] })) {
    out.componentSets.push({ page: pg.name, name: s.name, variants: s.children.length });
  }
}
out.textStyles = figma.getLocalTextStyles().map(s => s.name);
out.effectStyles = figma.getLocalEffectStyles().map(s => s.name);
out.variables = figma.variables.getLocalVariables().map(v => v.name);
return out;
`;

module.exports = { SEG1 };
