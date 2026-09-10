// Figma Plugin API mock + D2 段执行器（运行时冒烟）
// 跑 D2 SEG1，断言 99 · Archive 顶部加 Archive README frame + description 完整
// 用法: node scripts/figma-v4-smoke-d2.mjs（退出码 0 = 全部通过）
//       FIGMA_FIXTURE_DUMP=/tmp/d2 node scripts/figma-v4-smoke-d2.mjs  # 导出 fixture
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname;

// ---------- Mock 状态（与 v4-smoke 一致） ----------
let uid = 0;
const nid = (p) => `${p}:${++uid}`;
const store = { variables: [], collections: [] };

class MockNode {
  constructor(type, name) {
    this.id = nid(type); this.type = type; this.name = name; this.parent = null;
    this.children = []; this.x = 0; this.y = 0; this.width = 100; this.height = 100;
    this.fills = []; this.strokes = []; this.strokeWeight = 1;
    this.cornerRadius = 0; this._effects = []; this.opacity = 1;
    this.layoutMode = 'NONE'; this.itemSpacing = 0;
    this.paddingLeft = 0; this.paddingRight = 0; this.paddingTop = 0; this.paddingBottom = 0;
    this.primaryAxisSizingMode = 'FIXED'; this.counterAxisSizingMode = 'FIXED';
    this.primaryAxisAlignItems = 'MIN'; this.counterAxisAlignItems = 'MIN';
    this.visible = true; this.clipsContent = false;
    this.description = '';
  }
  set layoutSizingHorizontal(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingHorizontal='${v}' 需要先挂到 auto-layout 父节点 (${this.name})`);
    }
    this._lsh = v;
  }
  get layoutSizingHorizontal() { return this._lsh; }
  set layoutSizingVertical(v) {
    if ((v === 'FILL' || v === 'HUG') && (!this.parent || this.parent.layoutMode === 'NONE')) {
      throw new Error(`layoutSizingVertical='${v}' 需要先挂到 auto-layout 父节点 (${this.name})`);
    }
    this._lsv = v;
  }
  get layoutSizingVertical() { return this._lsv; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  resize(w, h) { this.width = w; this.height = h; }
  findAllWithCriteria({ types }) {
    const out = [];
    const walk = (n) => { for (const c of n.children || []) { if (types.includes(c.type)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

const figma = {
  root: { children: [], insertChild(index, node) { if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node); node.parent = this; this.children.splice(index, 0, node); return node; } },
  currentPage: null,
  variables: {
    getLocalVariables: () => store.variables,
    getLocalVariableCollections: () => store.collections,
    createVariableCollection(name) {
      const col = { id: nid('col'), name, modes: [{ modeId: nid('mode'), name: 'Default' }] };
      store.collections.push(col);
      return col;
    },
    createVariable(name, col, type) {
      const v = { id: nid('var'), name, variableCollectionId: col.id, resolvedType: type, valuesByMode: {}, scopes: [] };
      v.setValueForMode = (modeId, value) => { v.valuesByMode[modeId] = value; };
      store.variables.push(v);
      return v;
    },
  },
  createPage() { const p = new MockNode('PAGE', 'Page'); p.parent = figma.root; figma.root.children.push(p); return p; },
  createFrame() { return new MockNode('FRAME', 'Frame'); },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  createText() { const t = new MockNode('TEXT', 'Text'); t.characters = ''; t.fontSize = 12; t.fontName = { family: 'Inter', style: 'Regular' }; t.letterSpacing = null; return t; },
  async loadFontAsync() {},
};

// ---------- Bootstrap：必备 5 页 + AETHER 变量 ----------
for (const n of ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive']) {
  if (!figma.root.children.find(p => p.name === n)) {
    const p = figma.createPage();
    p.name = n;
    figma.root.insertChild(0, p);
  }
}
const aether = figma.variables.createVariableCollection('AETHER');
for (const name of ['Color/semantic/text-main', 'Color/semantic/text-dim', 'Color/semantic/text-muted', 'Color/semantic/accent', 'Color/semantic/status-error']) {
  const v = figma.variables.createVariable(name, aether, 'COLOR');
  v.setValueForMode(aether.modes[0].modeId, { r: 0.5, g: 0.5, b: 0.5, a: 1 });
}

// ---------- 执行器 ----------
function runSegment(seg) {
  figma.currentPage = figma.root.children[0] || null;
  const fn = new Function('figma', `return (async () => {\n${seg}\n})();`);
  return fn(figma);
}

const results = [];
try {
  const mod = require(`${repo}/scripts/figma-aether-v4-archive-readme.js`);
  const ret = await runSegment(mod.SEG1);
  results.push({ seg: 'SEG1', ok: true, ret });
} catch (e) {
  results.push({ seg: 'SEG1', ok: false, error: e.message, stack: e.stack });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.seg}${r.error ? ' — ' + r.error : ''}` + (r.stack ? '\n' + r.stack.split('\n').slice(0, 4).join('\n') : ''));

// ---------- 断言 ----------
const assert = (name, ok, detail) => results.push({ file: 'ASSERT', seg: name, ok: !!ok, ret: detail });
const archivePage = figma.root.children.find(p => p.name === '99 · Archive');
const readme = archivePage.children.find(n => n.name === 'Archive README');
assert('Archive README frame 存在（99 · Archive）', !!readme, readme ? '' : '99 · Archive 无 Archive README frame');
if (readme) {
  assert('Archive README y 坐标 < 0（在最顶部）', readme.y < 0, `y=${readme.y}`);
  assert('Archive README 有 ARCHIVE_README description', readme.description && readme.description.includes('ARCHIVE_README:'), readme.description?.slice(0, 60) || '无');
  assert('description 含 v3 Monster Beats 视觉说明', readme.description && readme.description.includes('Monster Beats'), '');
  assert('description 含 replacement 链接', readme.description && readme.description.includes('replacement:'), '');
  assert('frame 有 4 children（titleRow + body + linkRow + 1 hidden）', readme.children.length >= 3, `实际 ${readme.children.length}`);
  // stroke = red dashed outline
  assert('Archive README 有 strokeWeight=4', readme.strokeWeight === 4, `实际 ${readme.strokeWeight}`);
  assert('Archive README 有 dashPattern（虚线）', Array.isArray(readme.dashPattern) && readme.dashPattern.length > 0, JSON.stringify(readme.dashPattern));
}

// ---------- fixture 导出 ----------
const dumpPrefix = process.env.FIGMA_FIXTURE_DUMP;
if (dumpPrefix) {
  const serNode = (n) => {
    const out = { type: n.type, name: n.name, id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
    if (n.description) out.description = n.description;
    if (n.children && n.children.length) out.children = n.children.map(serNode);
    return out;
  };
  const fixture = {
    document: { children: figma.root.children.map(p => ({ type: 'CANVAS', name: p.name, id: p.id, children: p.children.map(serNode) })) },
  };
  writeFileSync(`${dumpPrefix}.json`, JSON.stringify(fixture, null, 2));
  console.log(`\n[fixture] exported to ${dumpPrefix}.json`);
}

const fails = results.filter(r => !r.ok);
for (const r of results) if (r.file === 'ASSERT' && !r.ok) console.log(`FAIL  ${r.seg} — ${r.ret}`);
console.log(`\n${results.length - fails.length}/${results.length} 通过` + (fails.length ? `，${fails.length} 项 FAIL` : ' ✅ 全部达标'));
process.exit(fails.length ? 1 : 0);
