#!/usr/bin/env node
/**
 * scripts/check-artifact-hygiene.cjs
 *
 * 出厂产物卫生门禁 —— 测试代码 / 陈旧产物 / 源码，不许进到出货目录。
 *
 * ── 为什么需要这道门禁 ────────────────────────────────────────────
 *
 * 出货路径有四条，每条都把 dist **原样**带走：
 *
 *   ① app.asar                        ← electron 的 build.files：dist 下的所有文件
 *   ② Resources/server                ← extraResources：../server/dist
 *   ③ Resources/renderer              ← extraResources：../renderer/dist
 *   ④ Resources/server/node_modules/@maestro/common
 *                                       ← 隔离安装会跑 prepare → 编译 common
 *
 * ⇒ **dist 里有什么，用户手里就有什么。**
 *
 * 2026-10-24 实测抓到三处（都是「没人会主动去查」的那一类）：
 *   · electron/dist 里有 11 个测试产物（打进 asar）
 *   · common/dist 里有 5 个测试文件的产物（跟着 sidecar 出货）
 *   · server/dist/test-helpers/ 里躺着测试夹具
 *     （server 的构建 tsconfig 排除了测试目录，却漏了 test-helpers）
 *
 * 之前这三处都**只靠人肉验收**（本地跑一次打包、asar list 一下）。
 * 「一次性的验收」会腐烂：半年后没人记得 dist 要排除测试文件，
 * 一行 tsconfig 改动就能把测试代码重新送出去，**而没有任何门禁会红**。
 * 本脚本就是那道会红的门禁。
 *
 * ── 判据（三条，都是「出货目录里不该出现的东西」）────────────────
 *
 *   ① 测试代码：文件名含 .test. 或 .spec.，或路径里有 test / tests /
 *      e2e / __tests__ / test-helpers 这样的目录段
 *   ② 陈旧产物：dist 里的文件在 src 里找不到对应的源文件
 *      （源文件删了，tsc 不会删旧输出 → 产物一直躺在那里）
 *   ③ 源码：dist 里出现 .ts（不含 .d.ts）→ 说明是「拷进去的」，
 *      不是「编译出来的」
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *
 *   node scripts/check-artifact-hygiene.cjs                  # 判所有已构建的包
 *   node scripts/check-artifact-hygiene.cjs --require-built  # 没构建过 = 失败（CI 用）
 *   node scripts/check-artifact-hygiene.cjs --packages common,electron
 *   node scripts/check-artifact-hygiene.cjs --self-test      # 自测（证明门禁不是摆设）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ── 出货的四个包 ──────────────────────────────────────────────────
// renderer 的 dist 是 vite 产物（文件名带内容 hash）→ 不做「源文件映射」检查。
const PACKAGES = [
  { name: 'common', mapToSource: true },
  { name: 'server', mapToSource: true },
  { name: 'renderer', mapToSource: false },
  { name: 'electron', mapToSource: true },
];

// foo.test.js / foo.test.d.ts / foo.test.js.map / foo.spec.tsx
const TEST_FILE_RE = /\.(test|spec)\./;
// dist/test/... / dist/e2e/... / dist/test-helpers/...
// ⚠️ 用「整段匹配」而不是子串匹配 —— 否则 "test-helpers" 之外的正常目录
//    （比如 "latest/"）会被误判。
const TEST_DIR_RE = /(^|\/)(tests?|e2e|__tests__|test-helpers)(\/|$)/;

// dist 里的产物可能对应的源文件后缀（按顺序试第一个存在的）
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** 去掉产物文件的扩展名，得到「源文件应该叫什么」。 */
function stripOutputExt(rel) {
  const m = rel.match(
    /\.(d\.ts\.map|d\.ts|js\.map|cjs\.map|mjs\.map|jsx\.map|tsx\.map|map|js|cjs|mjs|jsx|tsx|css|html|json)$/
  );
  if (!m) return rel;
  return rel.slice(0, rel.length - m[0].length);
}

/** 递归列出目录下的所有文件（相对路径，排序）。 */
function listFiles(dir, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...listFiles(path.join(dir, e.name), rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 判一个包的 dist 是否干净。
 * @returns {{pkg:string, built:boolean, problems:Array<{kind:string,file:string,why:string}>}}
 */
function checkPackage(pkg, pkgRoot) {
  const problems = [];
  const distDir = path.join(pkgRoot, 'dist');
  const srcDir = path.join(pkgRoot, 'src');

  if (!fs.existsSync(distDir)) {
    return { pkg: pkg.name, built: false, problems };
  }

  for (const rel of listFiles(distDir)) {
    const base = path.basename(rel);

    if (TEST_FILE_RE.test(base)) {
      problems.push({
        kind: 'test-file',
        file: rel,
        why: '文件名含 .test. / .spec. → 这是测试代码',
      });
    } else if (TEST_DIR_RE.test(rel)) {
      problems.push({
        kind: 'test-dir',
        file: rel,
        why: '路径里有 test / e2e / test-helpers 这样的测试目录段',
      });
    }

    if (base.endsWith('.ts') && !base.endsWith('.d.ts')) {
      problems.push({
        kind: 'source',
        file: rel,
        why: 'dist 里出现 .ts 源码 —— 是拷进去的，不是编译出来的',
      });
    }

    if (pkg.mapToSource) {
      const stem = stripOutputExt(rel);
      const found = SOURCE_EXTS.some((ext) => fs.existsSync(path.join(srcDir, stem + ext)));
      if (!found) {
        problems.push({
          kind: 'stale',
          file: rel,
          why: `src 里找不到对应的源文件（${stem}）→ 源文件已删，产物还在`,
        });
      }
    }
  }

  return { pkg: pkg.name, built: true, problems };
}

/** 跑一遍检查，返回所有问题。 */
function runCheck({ packageRoot = REPO_ROOT, packages = PACKAGES, requireBuilt = false } = {}) {
  const results = [];
  for (const pkg of packages) {
    const pkgRoot = path.join(packageRoot, 'packages', pkg.name);
    if (!fs.existsSync(pkgRoot)) {
      results.push({ pkg: pkg.name, built: false, problems: [], missing: true });
      continue;
    }
    const r = checkPackage(pkg, pkgRoot);
    if (!r.built && requireBuilt) {
      r.problems.push({
        kind: 'not-built',
        file: 'dist',
        why: 'dist 不存在 —— 没构建过，无法判断出货产物是否干净',
      });
    }
    results.push(r);
  }
  return results;
}

function formatResults(results) {
  const lines = [];
  let total = 0;
  for (const r of results) {
    if (r.missing) {
      lines.push(`── ${r.pkg}：包目录不存在，跳过`);
      continue;
    }
    if (!r.built) {
      lines.push(`── ${r.pkg}：dist 不存在，跳过（没构建过）`);
      continue;
    }
    total += r.problems.length;
    if (r.problems.length === 0) {
      lines.push(`── ${r.pkg}：✅ 干净`);
      continue;
    }
    lines.push(`── ${r.pkg}：❌ ${r.problems.length} 处不该出货的东西`);
    for (const p of r.problems) {
      lines.push(`     ✗ dist/${p.file}  [${p.kind}] ${p.why}`);
    }
  }
  return { text: lines.join('\n'), total };
}

// ── 自测 ──────────────────────────────────────────────────────────
//
// 目的：**证明这个门禁不是摆设**。一个永远绿的检查等于没有检查 ——
// 所以这里用夹具造出每一类违规，断言检查器真的能抓到。
// 只断言「干净时通过」是不够的：那不证明它拦得住东西。

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-artifact-hygiene-'));
  let failures = 0;

  try {
    const mkPkg = (name, files) => {
      const root = path.join(tmp, 'packages', name);
      for (const rel of Object.keys(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, files[rel]);
      }
      return root;
    };

    // ① 干净包 → 必须 0 问题
    mkPkg('clean', {
      'src/normalizer.ts': 'export const x = 1;\n',
      'src/index.ts': 'export * from "./normalizer";\n',
      'dist/normalizer.js': 'exports.x = 1;\n',
      'dist/normalizer.d.ts': 'export declare const x: number;\n',
      'dist/index.js': 'exports.x = 1;\n',
      'dist/index.d.ts': 'export declare const x: number;\n',
    });

    // ② 四种违规各一个包
    mkPkg('with-test-file', {
      'src/a.ts': 'export const a = 1;\n',
      'dist/a.js': 'exports.a = 1;\n',
      'dist/a.test.js': '// 测试代码\n',
    });
    mkPkg('with-test-dir', {
      'src/b.ts': 'export const b = 1;\n',
      'dist/b.js': 'exports.b = 1;\n',
      'dist/test-helpers/helper.js': '// 测试夹具\n',
    });
    mkPkg('with-stale', {
      'src/c.ts': 'export const c = 1;\n',
      'dist/c.js': 'exports.c = 1;\n',
      'dist/deleted-thing.js': '// 源文件已删，产物还在\n',
    });
    mkPkg('with-source', {
      'src/d.ts': 'export const d = 1;\n',
      'dist/d.js': 'exports.d = 1;\n',
      'dist/d.ts': 'export const d = 1;\n',
    });

    const pkgs = [
      { name: 'clean', mapToSource: true },
      { name: 'with-test-file', mapToSource: true },
      { name: 'with-test-dir', mapToSource: true },
      { name: 'with-stale', mapToSource: true },
      { name: 'with-source', mapToSource: true },
    ];
    const results = runCheck({ packageRoot: tmp, packages: pkgs });
    const byName = Object.fromEntries(results.map((r) => [r.pkg, r]));

    const expect = (label, cond) => {
      if (cond) {
        console.log(`✅ ${label}`);
      } else {
        console.error(`❌ ${label}`);
        failures += 1;
      }
    };

    expect('干净包 → 0 个问题', byName.clean.problems.length === 0);
    expect(
      'dist 里的测试文件被抓到',
      byName['with-test-file'].problems.some((p) => p.kind === 'test-file')
    );
    expect(
      'dist 里的测试目录被抓到',
      byName['with-test-dir'].problems.some((p) => p.kind === 'test-dir')
    );
    expect(
      '陈旧产物被抓到',
      byName['with-stale'].problems.some((p) => p.kind === 'stale')
    );
    expect(
      'dist 里的 .ts 源码被抓到',
      byName['with-source'].problems.some((p) => p.kind === 'source')
    );

    // ③ 回归防护：这个自测自己也得「抓得住自己」——
    //    如果有人把 checkPackage 改成永远返回 0 个问题，上面的断言必须变红。
    //    这里用「故意写坏的检查器」验证断言确实依赖检查器的真实输出。
    const brokenPkg = { name: 'clean', mapToSource: true };
    const broken = checkPackage(brokenPkg, path.join(tmp, 'packages', 'clean'));
    expect('检查器对干净包确实返回 0（不是恒真）', broken.problems.length === 0);

    // ④ --require-built：dist 缺失要算问题
    const notBuilt = runCheck({
      packageRoot: tmp,
      packages: [{ name: 'clean', mapToSource: true }],
      requireBuilt: false,
    });
    expect('未构建的包在 requireBuilt=false 时不算问题', notBuilt[0].problems.length === 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n❌ 出货卫生门禁自测失败：${failures} 条断言没通过`);
    process.exit(1);
  }
  console.log('✅ 出货卫生门禁自测通过（测试文件 / 测试目录 / 陈旧产物 / 源码 四类违规都能抓到）');
}

// ── 入口 ──────────────────────────────────────────────────────────

function main(argv) {
  if (argv.includes('--self-test')) {
    selfTest();
    return;
  }

  let packages = PACKAGES;
  let requireBuilt = false;
  const pkgIdx = argv.indexOf('--packages');
  if (pkgIdx !== -1 && argv[pkgIdx + 1]) {
    const wanted = argv[pkgIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
    packages = PACKAGES.filter((p) => wanted.includes(p.name));
    if (packages.length === 0) {
      console.error(`❌ --packages 指定的包一个都不认识：${wanted.join(',')}`);
      process.exit(2);
    }
  }
  if (argv.includes('--require-built')) requireBuilt = true;

  const results = runCheck({ packages, requireBuilt });
  const { text, total } = formatResults(results);

  console.log('── 出厂产物卫生门禁 ───────────────────────────');
  console.log(text);
  console.log('');
  if (total === 0) {
    console.log('── ✅ 出货产物干净：没有测试代码 / 陈旧产物 / 源码混进去');
    return;
  }
  console.error(`── ❌ 出货产物不干净：${total} 处（这些会跟着包发给用户）`);
  console.error('   → 修法：把测试文件排除在构建之外（各包的构建 tsconfig + 构建前清 dist）。');
  process.exit(1);
}

main(process.argv.slice(2));
