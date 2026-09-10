// ─────────────────────────────────────────────────────────────
// AETHER v4 — 04 · Motion · MOTION SPEC frame 描述写入（D10 Figma 端段）
// 用途：把 specs/motion-spec.json 的内容写进 04 · Motion · MOTION SPEC frame 的 description
//       让 audit-d10 跑真 Figma 时能 parse
// 配套：scripts/figma-d10-fixture.js（fixture 模式）
//        scripts/figma-aether-v4-audit-d10.mjs（audit 脚本，支持 Figma↔repo 对比）
//        specs/d10-motion-spec/fixture-description.md（操作手册）
// 每个 SEGMENT 是 use_figma 的 code 参数字符串
// ─────────────────────────────────────────────────────────────

// ============ SEG1: 写入 MOTION SPEC frame description ============
const SEG1 = `
const fs = require('fs');
const path = require('path');
const spec = JSON.parse(fs.readFileSync(path.resolve('./specs/motion-spec.json'), 'utf8'));
const innerJson = JSON.stringify({ MOTION_SPEC: spec.version, spec: spec.spec });
const page = figma.root.children.find(p => p.type === 'PAGE' && p.name === '04 · Motion') || figma.currentPage;
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
let specFrame = page.children.find(n => n.name === 'MOTION SPEC');
if (!specFrame) {
  specFrame = figma.createFrame();
  specFrame.name = 'MOTION SPEC';
  specFrame.resize(1200, 1600);
  specFrame.x = 0; specFrame.y = 0;
  page.appendChild(specFrame);
}
// 幂等：每次都覆盖
specFrame.description = \`---
\${innerJson}
---\`;
return { updatedNodeId: specFrame.id, specCount: spec.spec.length, descLength: specFrame.description.length };
`;

// ============ SEG2: fixture 模式（mock 写入 04 · Motion · MOTION SPEC frame） ============
// 在 mock 运行时（figma-v4-smoke-d10）使用；不需要 Figma
// 但 audit-d10 直接读 fixture 文件，不需要这个段

module.exports = { SEG1 };
