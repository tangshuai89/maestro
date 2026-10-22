#!/usr/bin/env node
/**
 * 收集「哪些源文件的**行级**覆盖数据可信」。
 *
 * ## 为什么需要这个
 *
 * c8 把 V8 的**字节偏移**范围映射回源码行，需要 **source map**。source map
 * 从 node 的 `source-map-cache` 拿（node 原生 CJS/ESM loader 加载模块时填充）。
 *
 * - **node 侧**（`ts-node` 跑 `.test.ts`）：ts-node 注册了 source-map-support
 *   → `source-map-cache` **有** → 行号正确 ✓
 * - **node 侧**（`node` 直接跑 `.test.mjs`，renderer 的纯函数档）：node 的
 *   type-stripping **不产出 source map** → 行号**错位** ✗
 * - **vitest 侧**（`.test.tsx`）：vite/esbuild 转换后的 JS 在**内存**里，
 *   source map 是 inline data URL，node 的 `source-map-cache` 里**没有** →
 *   行号**错位** ✗
 *
 * 行号错位长什么样（2026-10-21 实测）：
 *
 *   - esbuild 把 `usePlayer.ts` 从 2192 行压成 1336 行（删掉 856 行类型/空行）
 *   - c8 拿不到 source map → 拿 **转换后 JS 的字节偏移** 去切 **源 .ts 文件**
 *   - 切出来的行号是**随机的** —— 但因为切的是完整源文件，**DA 条目数 = 源文件
 *     行数**，看起来「对齐」，极具欺骗性
 *   - 实测反例：一个**从未被调用**的函数，它的函数体各行 DA hits 却是 170
 *     （模块顶层语句的次数）；而同一函数里**必然执行**的 `setCurrentTime(0)`
 *     hits 却是 0
 *
 * ⇒ **renderer 的行级覆盖数字不可信**（server/common/electron 的可信）。
 * 门禁若拿行级数据判「新增代码有没有被测到」，在 renderer 上会**漏报**（未覆盖
 * 的新代码看起来已覆盖）甚至**误报**。
 *
 * ## 函数级覆盖为什么可信
 *
 * 函数名是**源码标识符**，不随转换器的字节布局变化 → 跨管线、跨 entry 都稳定。
 * 实测：从未被调用的探针函数，FNDA 精确地是 0 ✓
 *
 * ## 用法
 *
 *   node scripts/collect-line-coverage-trust.js <输出文件> <temp 目录>...
 *
 * 输出每行一个「行覆盖可信」的源文件路径（相对仓库根）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 自测：用构造的 source-map-cache 验证「哪些文件被认成行覆盖可信」。
 *
 * 为什么需要：这个脚本算错的后果是**门禁静默地关掉所有行级判据**（或反过来
 * 在不可信的数据上判）。实测踩过两次：
 *  1. 只认 `file://` 前缀 → node 侧的相对路径 key 全被漏掉 → 清单恒空
 *  2. 用 `includes('/packages/')` 检查 → 相对路径**开头**就是 `packages/`
 *     （没有前导斜杠）→ 同样恒空
 *
 * 清单恒空 = 门禁退化成「只靠函数级」→ 不会误报，但会漏报。**静默降级**比
 * 报错更糟，所以这个脚本必须有自测。
 */
function selfTest() {
  const fs = require('node:fs');
  const os = require('node:os');
  const path2 = require('node:path');
  const tmp = fs.mkdtempSync(path2.join(os.tmpdir(), 'maestro-trust-selftest-'));
  const covDir = path2.join(tmp, 'cov');
  fs.mkdirSync(covDir, { recursive: true });
  // 用**真实的 cwd** 构造绝对路径 —— collector 会把绝对路径转成相对仓库根，
  // 用假路径（/abs/repo）会被 `startsWith('..')` 过滤掉，自测就测不到真逻辑。
  const abs = (rel) => 'file://' + path2.join(process.cwd(), rel);
  fs.writeFileSync(
    path2.join(covDir, 'a.json'),
    JSON.stringify({
      'source-map-cache': {
        [abs('packages/server/src/ok.ts')]: { data: { mappings: 'x' } },
        [abs('packages/server/src/no-data.ts')]: { data: null },
        [abs('node_modules/x/index.js')]: { data: { mappings: 'x' } },
        [abs('packages/renderer/src/vitest-only.ts')]: { data: { mappings: 'x' } },
      },
    }),
  );
  const out = path2.join(tmp, 'out.txt');
  const argv = process.argv.slice(2);
  process.argv = [argv[0], argv[1], out, covDir];
  main();
  const got = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
  const rel = got.map((p) => p.replace(process.cwd() + '/', ''));
  const ok = rel.includes('packages/server/src/ok.ts');
  const noData = rel.includes('packages/server/src/no-data.ts');
  const nodeMod = rel.some((p) => p.includes('node_modules'));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ok || noData || nodeMod) {
    console.error('❌ collect-line-coverage-trust 自测失败:');
    if (!ok) console.error('   ✗ 有 source map 的文件没被认出来');
    if (noData) console.error('   ✗ 没有 source map 数据的文件被误认');
    if (nodeMod) console.error('   ✗ node_modules 被误认');
    process.exit(1);
  }
  console.log('✅ collect-line-coverage-trust 自测通过（路径形态 + data 判据 + 排除规则）');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    return;
  }
  if (args.length < 2) {
    console.error(
      'usage: node scripts/collect-line-coverage-trust.js <out> <tempDir>...\n' +
        '       node scripts/collect-line-coverage-trust.js --self-test',
    );
    process.exit(2);
  }
  const [outPath, ...tempDirs] = args;

  /** @type {Set<string>} */
  const trusted = new Set();

  for (const dir of tempDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      let json;
      try {
        json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      } catch {
        continue;
      }
      const cache = json['source-map-cache'];
      if (!cache) continue;
      for (const fileUrl of Object.keys(cache)) {
        const entry = cache[fileUrl];
        // 只有**真的带 source map 数据**的才算（data 为空 = 没有映射）
        if (!entry || !entry.data) continue;
        // key 有两种形态（实测）：
        //   - `file:///abs/path`（node 的 CJS loader）
        //   - `packages/common/src/x.ts`（**相对仓库根**，node 22 的
        //     source-map-cache 对本地模块就是这种形态）
        // 两种都要认 —— 只认 file:// 会把 node 侧全部漏掉（实测 0 个）。
        let rel;
        if (fileUrl.startsWith('file://')) {
          rel = path.relative(process.cwd(), fileUrl.slice('file://'.length));
        } else if (path.isAbsolute(fileUrl)) {
          rel = path.relative(process.cwd(), fileUrl);
        } else {
          rel = fileUrl;
        }
        if (rel.startsWith('..')) continue; // 不在仓库内
        // ⚠️ 用 `startsWith('packages/')` 而不是 `includes('/packages/')` ——
        // 相对路径**开头**就是 `packages/`，没有前导斜杠（实测踩过：后者
        // 匹配不到任何一个文件 → 清单恒为空 → 门禁把所有文件的行级判据都关掉）。
        if (!rel.startsWith('packages/')) continue;
        if (rel.includes('/node_modules/')) continue;
        if (rel.includes('/dist/')) continue;
        trusted.add(rel);
      }
    }
  }

  const out = [...trusted].sort().join('\n');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out ? out + '\n' : '');

  console.error(
    `── 行覆盖可信的源文件：${trusted.size} 个（清单：${outPath}）`,
  );
}

main();
