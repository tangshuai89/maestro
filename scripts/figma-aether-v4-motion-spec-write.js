#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER D10 — MOTION SPEC 写入段（生成器，不是「手工粘的代码」）
//
// 用法：
//   node scripts/figma-aether-v4-motion-spec-write.js           # 打印可直接粘贴的 use_figma code
//   node scripts/figma-aether-v4-motion-spec-write.js --check    # 只打印预期长度/djb2
//
// 为什么做成生成器而不是写死一段代码：
//   1. use_figma 沙箱**没有 fs**，段脚本读不到仓库文件，spec 只能内联进 code 参数；
//   2. 老版本正是用 `require('fs')` 读 `specs/motion-spec.json` —— 那段代码在真实 Figma 里
//      必然抛错，只有 mock 跑得动（"mock 比真实宽松"的又一次翻版，见 D1/D2 教训）；
//   3. 手工内联 6.3KB JSON 每次都要重抄一遍，会随 spec 演进而漂移。
//   → 交给 `JSON.stringify()` 生成字符串字面量，永远是仓库文件的忠实副本。
//
// 载体：**FRAME 没有 `description` 属性**（实测 `'description' in frame === false`），
// 所以内容写进 frame 下的隐藏 TEXT 子节点 `MOTION_SPEC`（同 D1 的 `AI_CONTRACT`）。
// 参见 @/Users/tangshuai/knowledge/frontend/figma-plugin-api-write-gotchas.md §1
//
// 跑完怎么验：段脚本 return 的 `charsLen` / `djb2` 与 `--check` 打印的预期值比对；
// 一致 = 写进 Figma 的内容与仓库文件逐字节相同（比肉眼看硬）。
// ─────────────────────────────────────────────────────────────
const { readFileSync } = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const DEFAULT_FRAME_ID = '314:2040'; // 04 · Motion · MOTION SPEC

const djb2 = (text) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
};

function buildSegment(frameId = DEFAULT_FRAME_ID) {
  const spec = JSON.parse(readFileSync(path.join(REPO, 'specs/motion-spec.json'), 'utf8'));
  const inner = JSON.stringify({ MOTION_SPEC: spec.version, spec: spec.spec });
  const chars = '---\n' + inner + '\n---';
  // 再套一层 JSON.stringify → 合法的 JS 字符串字面量，转义全自动
  const innerLiteral = JSON.stringify(inner);

  const code = `const SPEC_JSON = ${innerLiteral};

const frame = await figma.getNodeByIdAsync('${frameId}');
if (!frame) throw new Error('找不到 MOTION SPEC frame: ${frameId}');

// 幂等：先清掉旧的同名子节点
const old = (frame.children || []).filter((c) => c.name === 'MOTION_SPEC');
for (const o of old) o.remove();

// FRAME 没有 description 属性 → 机器可读载体走隐藏 TEXT 子节点
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const t = figma.createText();
t.name = 'MOTION_SPEC';
t.fontName = { family: 'Inter', style: 'Regular' };
t.characters = '---\\n' + SPEC_JSON + '\\n---';
t.fills = [];              // 不进「自有填充变量绑定率」统计的分母
t.resize(1400, 100);       // resize 必须在 sizing 之前
t.textAutoResize = 'HEIGHT';
t.x = 1240;
t.y = 8;
t.visible = false;
frame.appendChild(t);

const chars = t.characters;
let h = 5381;
for (let i = 0; i < chars.length; i++) h = ((h * 33) ^ chars.charCodeAt(i)) >>> 0;

return JSON.stringify({
  createdNodeId: t.id,
  parentId: frame.id,
  removedOld: old.length,
  charsLen: chars.length,
  djb2: h.toString(16),
  frameHasDescriptionProp: 'description' in frame,
});
`;

  return {
    code,
    expected: { charsLen: chars.length, djb2: djb2(chars), specCount: spec.spec.length, version: spec.version },
  };
}

module.exports = { buildSegment, DEFAULT_FRAME_ID };

if (require.main === module) {
  const frameId = process.argv.includes('--frame-id')
    ? process.argv[process.argv.indexOf('--frame-id') + 1]
    : DEFAULT_FRAME_ID;
  const { code, expected } = buildSegment(frameId);
  const summary = `预期回读值：charsLen=${expected.charsLen} djb2=${expected.djb2}（spec v${expected.version}，${expected.specCount} 条）`;
  if (process.argv.includes('--check')) {
    console.log(summary);
  } else {
    process.stderr.write(`# ${summary}\n# 把下面整段作为 use_figma 的 code 参数（fileKey=FtbRZXvzlCp4Sq9e322cQQ）\n`);
    process.stdout.write(code);
  }
}
