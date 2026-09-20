#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// figma-tokens-dump-seg.js 的 mock 冒烟测试
//
// 为什么需要：那个段文件是"贴给 use_figma 执行"的代码字符串，本身不会被任何构建/测试碰。
// 没有本测试的话，它只是"我抄了一遍但没验过"的代码 —— 一旦映射逻辑漂了，
// 只有到你手工跑它、发现 dump 对不上时才会暴露。
//
// 做法：用提交的 figma-tokens-dump.json 造一个最小 figma 变量 mock，
// 执行 SEG1，断言它的渲染结果与仓库 `_tokens.generated.scss` **逐字节一致**。
// 这条断言同时覆盖：映射、px 单位、ease 裸输出、分组顺序、表头。
//
// 用法: node scripts/figma-v4-smoke-tokens-seg.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..');

const { SEG1 } = require('./figma-tokens-dump-seg.js');
const dump = JSON.parse(readFileSync(resolve(repo, 'scripts/figma-tokens-dump.json'), 'utf8'));
const expected = readFileSync(resolve(repo, 'packages/renderer/src/styles/base/_tokens.generated.scss'), 'utf8');

// ── 最小 figma 变量 mock：单集合 / 单 mode（与真实文件一致：AETHER + Dark）──
const MODE = 'M1';
const COLLECTION = { id: 'C1', name: 'AETHER', modes: [{ modeId: MODE, name: 'Dark' }], variableIds: [] };
const variables = dump.variables.map((v, i) => ({
  id: `V${i}`,
  name: v.name,
  resolvedType: v.resolvedType,
  variableCollectionId: COLLECTION.id,
  valuesByMode: { [MODE]: v.value },
}));

const figma = {
  variables: {
    getLocalVariablesAsync: async () => variables,
    getLocalVariableCollectionsAsync: async () => [COLLECTION],
  },
};

let results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 用 AsyncFunction 构造 = 只解析不执行到无关代码；调用时才真正跑段逻辑
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const out = JSON.parse(await new AsyncFunction('figma', SEG1)(figma));

check('SEG1 可解析并返回 JSON', !!out, `${Object.keys(out).length} 个字段`);
check('变量数一致', out.totalVars === dump.variables.length, `${out.totalVars} vs dump ${dump.variables.length}`);
check('没有未映射变量', (out.unmappedFromExport ?? []).length === 0, (out.unmappedFromExport ?? []).join(', '));
check('没有未解析别名', (out.unresolvedAliases ?? []).length === 0, (out.unresolvedAliases ?? []).join(', '));
check('cssHash 与实际 css 自洽', out.cssHash === djb2(out.css), `段内 ${out.cssHash} / 重算 ${djb2(out.css)}`);
check('cssLen 与实际 css 自洽', out.cssLen === out.css.length, `${out.cssLen} vs ${out.css.length}`);
check(
  '渲染结果与仓库 _tokens.generated.scss 逐字节一致',
  out.css === expected,
  out.css === expected ? `${out.css.length} 字节` : firstDiff(expected, out.css),
);

function djb2(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function firstDiff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) return `第 ${i + 1} 行 仓库=${JSON.stringify(A[i])} 段=${JSON.stringify(B[i])}`;
  }
  return '长度不同';
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length ? ` · ${failed.length} FAIL` : ' ✅'}`);
process.exit(failed.length ? 1 : 0);
