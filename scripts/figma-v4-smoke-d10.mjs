// Figma Plugin API mock + D10 段执行器（运行时冒烟）
// 跑 D10 SEG1（写入 MOTION SPEC frame description）+ fixture 导出
// 用法: node scripts/figma-v4-smoke-d10.mjs
//       FIGMA_FIXTURE_DUMP=/tmp/d10 node scripts/figma-v4-smoke-d10.mjs  # 导出 fixture 供 audit-d10 端到端测试
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = new URL('..', import.meta.url).pathname;

// ---------- Mock 状态 ----------
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
  root: { children: [], insertChild(i, n) { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n); n.parent = this; this.children.splice(i, 0, n); return n; } },
  currentPage: null,
  variables: {
    getLocalVariables: () => store.variables,
    getLocalVariableCollections: () => store.collections,
    createVariableCollection(n) { const c = { id: nid('col'), name: n, modes: [{ modeId: nid('mode'), name: 'Default' }] }; store.collections.push(c); return c; },
    createVariable(n, col, t) { const v = { id: nid('var'), name: n, variableCollectionId: col.id, resolvedType: t, valuesByMode: {}, scopes: [] }; v.setValueForMode = (m, val) => { v.valuesByMode[m] = val; }; store.variables.push(v); return v; },
  },
  createPage() { const p = new MockNode('PAGE', 'Page'); p.parent = figma.root; figma.root.children.push(p); return p; },
  createFrame() { return new MockNode('FRAME', 'Frame'); },
  async setCurrentPageAsync(p) { figma.currentPage = p; },
  async loadFontAsync() {},
};

// ---------- Bootstrap ----------
for (const n of ['01 · Foundations', '02 · Components', '03 · Screens', '04 · Motion', '99 · Archive']) {
  if (!figma.root.children.find(p => p.name === n)) {
    const p = figma.createPage(); p.name = n; figma.root.insertChild(0, p);
  }
}

// ---------- 执行器 ----------
function runSegment(seg) {
  figma.currentPage = figma.root.children[0] || null;
  const fn = new Function('figma', 'require', `return (async () => {\n${seg}\n})();`);
  return fn(figma, require);
}

const results = [];
try {
  const mod = require(`${repo}/scripts/figma-aether-v4-motion-spec-write.js`);
  const ret = await runSegment(mod.SEG1);
  results.push({ seg: 'SEG1', ok: true, ret });
} catch (e) {
  results.push({ seg: 'SEG1', ok: false, error: e.message, stack: e.stack });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.seg}${r.error ? ' — ' + r.error : ''}` + (r.stack ? '\n' + r.stack.split('\n').slice(0, 4).join('\n') : ''));

// ---------- 断言 ----------
const assert = (name, ok, detail) => results.push({ file: 'ASSERT', seg: name, ok: !!ok, ret: detail });
const motionPage = figma.root.children.find(p => p.name === '04 · Motion');
const specFrame = motionPage.children.find(n => n.name === 'MOTION SPEC');
assert('MOTION SPEC frame 存在（04 · Motion）', !!specFrame, specFrame ? '' : '无');
if (specFrame) {
  assert('description 含 ---...--- 段', /---[\s\S]+?---/.test(specFrame.description), `长度 ${specFrame.description.length}`);
  // 抓中间 JSON
  const m = specFrame.description.match(/---([\s\S]+?)---/);
  if (m) {
    let parsed;
    try { parsed = JSON.parse(m[1].trim()); } catch (e) { assert('JSON.parse', false, e.message); }
    if (parsed) {
      assert('JSON 含 MOTION_SPEC version', parsed.MOTION_SPEC === '1.0', `version=${parsed.MOTION_SPEC}`);
      assert('JSON 含 spec 数组', Array.isArray(parsed.spec), `length=${parsed.spec?.length}`);
      assert('spec 数量 ≥ 20（仓库 20 条）', parsed.spec.length >= 20, `实际 ${parsed.spec.length}`);
    }
  }
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
