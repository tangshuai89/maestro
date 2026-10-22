#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// 浏览器端覆盖率：V8 原始覆盖数据 → lcov
//
// 输入：Playwright `page.coverage.stopJSCoverage()` 的 JSON 数组
//      [{ url, source, functions: [...] }, ...]
// 输出：lcov 文本（SF / DA / FN / FNDA / BRDA）
//
// ── 为什么需要它 ───────────────────────────────────────────────
// renderer 的**单元测试**覆盖率由 @vitest/coverage-v8 产出（行号准确）。
// 但有一类文件单元测试**根本碰不到**：
//   - `App.tsx`（741 行）—— 它是**接线层**：只 import hook，不导出任何逻辑，
//     单测里从没被 render 过 → 行覆盖恒为 0%。
//   - `main.tsx`（入口）—— 同理。
// 而这些文件恰恰是**改坏了最容易出事**的地方（应用起不来 / 接线接错）。
// 浏览器里跑一次真实链路（E2E）就能把它们的覆盖**真实地**记下来。
//
// ── 为什么用 vite dev server（而不是构建产物）──────────────────
// dev server 提供的每个模块是**独立 URL**（`/src/App.tsx`）且带 **inline
// source map** → V8 的字节偏移能直接回映射到源文件的行/列。
// 构建产物是一个大 bundle → 偏移要先过 chunk 的 sourcemap，多一层且更脆。
// ⚠️ 代价：dev server 跑的不是「出厂产物」。但**代码是同一份源码**，
//   出厂产物的验证由 `tests/e2e/fullchain.spec.mjs`（跑 vite preview）负责。
//
// ── 映射用谁 ───────────────────────────────────────────────────
// `v8-to-istanbul`（c8 的同一个库，成熟且带 source map 回映射）→ 产出
// istanbul 格式 → 再用 `scripts/istanbul-to-lcov.js` 转成 lcov。
// ⚠️ **不要自己重写字节偏移 → 行列的映射**：那是 c8 踩过坑的地方。
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);
const V8ToIstanbul = require_('v8-to-istanbul');

/**
 * 浏览器 URL → 仓库相对路径。
 *
 * vite dev 的模块 URL：`http://127.0.0.1:5174/src/App.tsx`（可能带 `?t=123`
 * 的 HMR 时间戳）→ `packages/renderer/src/App.tsx`。
 * 认不出来的一律返回 null（跳过）—— 宁可少收数据，也不要把**路径搞错**：
 * 路径错了会污染 lcov（覆盖记到别的文件上），比缺数据糟得多。
 */
function urlToRepoPath(url) {
  if (!url) return null;
  // 去掉 query / hash
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/^(?:https?:\/\/[^/]+)?\/(.*)$/);
  if (!m) return null;
  const p = m[1];
  // 只收 renderer 的 src（其他包不进浏览器）
  if (!p.startsWith('src/')) return null;
  if (!/\.(ts|tsx)$/.test(p)) return null;
  if (/\.d\.ts$/.test(p)) return null;
  return `packages/renderer/${p}`;
}

/**
 * V8 覆盖 → istanbul 覆盖（按仓库相对路径聚合）。
 *
 * @param {Array} entries Playwright stopJSCoverage() 的数组
 * @returns {Object} istanbul 格式：{ [相对路径]: {path, statementMap, fnMap, branchMap, s, f, b} }
 */
export function v8ToIstanbul(entries) {
  /** @type {Object} */
  const out = {};
  for (const entry of entries) {
    const rel = urlToRepoPath(entry.url);
    if (!rel) continue;
    if (!entry.source) continue;
    let converter;
    try {
      converter = new V8ToIstanbul(entry.url, 0, { source: entry.source });
    } catch {
      continue;
    }
    // load() 是异步的：它要解析 inline source map 并可能去磁盘读源文件。
    // 这里同步用一个 IIFE 收集 Promise，由调用方 await。
    converter.__load = converter.load().then(() => {
      converter.applyCoverage(entry.functions);
      return converter.toIstanbul();
    });
    out[rel] = converter;
  }
  return out;
}

/** 异步版：等所有 converter load 完，合并出 istanbul 覆盖。 */
export async function convert(entries) {
  const pending = v8ToIstanbul(entries);
  /** @type {Object} */
  const merged = {};
  for (const [rel, converter] of Object.entries(pending)) {
    let istanbul;
    try {
      istanbul = await converter.__load;
    } catch {
      continue;
    }
    for (const [p, cov] of Object.entries(istanbul)) {
      const key = p.startsWith('packages/') ? p : rel;
      if (!merged[key]) {
        merged[key] = {
          path: key,
          statementMap: {},
          fnMap: {},
          branchMap: {},
          s: {},
          f: {},
          b: {},
        };
      }
      const dst = merged[key];
      let si = 0;
      let fi = 0;
      let bi = 0;
      for (const [id, loc] of Object.entries(cov.statementMap)) {
        const nid = String(si++);
        dst.statementMap[nid] = loc;
        dst.s[nid] = cov.s[id];
      }
      for (const [id, loc] of Object.entries(cov.fnMap)) {
        const nid = String(fi++);
        dst.fnMap[nid] = loc;
        dst.f[nid] = cov.f[id];
      }
      for (const [id, loc] of Object.entries(cov.branchMap)) {
        const nid = String(bi++);
        dst.branchMap[nid] = loc;
        dst.b[nid] = cov.b[id];
      }
    }
  }
  return merged;
}

// ── CLI：node scripts/browser-coverage-to-lcov.mjs <v8cov.json> <out.lcov> ──
if (process.argv[1] && process.argv[1].endsWith('browser-coverage-to-lcov.mjs')) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error('用法: node scripts/browser-coverage-to-lcov.mjs <v8cov.json> <out.lcov>');
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(inPath, 'utf8'));
  const istanbul = await convert(entries);
  // 复用现成的 istanbul → lcov 转换（同一个坐标系、同一套格式）
  //
  // ⚠️ istanbul JSON 的落点叫 `coverage-final.json`（和 coverage-v8 的同名）——
  // `collect-line-coverage-trust.js` 扫目录里的 `coverage-final.json` 来判定
  // 「哪些文件的行覆盖可信」→ 浏览器侧经 source map 回映射后行号是准的 →
  // 也必须进那份可信清单，否则门禁会跳过它的行级判据。
  const { execFileSync } = require_('node:child_process');
  const tmpJson = resolve(dirname(outPath), 'coverage-final.json');
  writeFileSync(tmpJson, JSON.stringify(istanbul));
  execFileSync(process.execPath, [resolve(REPO, 'scripts/istanbul-to-lcov.js'), tmpJson, outPath], {
    // ⚠️ **必须给 timeout**：没有它，子进程一旦不退出，这里永远等下去
    //   （2026-10-22 在 CI 上实测：浏览器覆盖采集卡满 6 小时被强杀）。
    stdio: 'inherit',
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
  console.log(`浏览器覆盖 → ${outPath}（${Object.keys(istanbul).length} 个文件）`);
}
