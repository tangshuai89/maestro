// build-base.test.mjs — vite base 必须保持 './'（Electron loadFile 白屏回归）
//
// 背景：prod 走 `mainWindow.loadFile()` = `file://` 协议。vite 默认 base='/'
// 会把产物入口写成 `src="/assets/main-*.js"`，绝对路径在 file:// 下解析到
// 文件系统根 → index.html 与 lyrics.html（桌面歌词浮窗）一起白屏。
// `npm run dev` 走 loadURL(http://127.0.0.1:5173) 所以永远测不出来，
// 只有 `npm run pack` 的产物才命中。
//
// Run: node src/test/build-base.test.mjs

import * as assert from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${err.message}`);
    failed++;
  }
}

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function main() {
  const config = readFileSync(resolve(pkgRoot, 'vite.config.ts'), 'utf8');

  // ── 1. 配置里 base 必须是 './' ────────────────────────────────
  check("1. vite.config.ts 显式 base: './'", () => {
    assert.ok(
      /base:\s*['"]\.\/['"]/.test(config),
      "没找到 base: './' —— vite 默认 '/' 会让打包产物在 file:// 下白屏",
    );
  });

  // ── 2. 如果 dist 存在，产物里的资源引用必须是相对路径且能解析 ──
  check('2. dist 产物资源路径是相对的且文件存在（dist 未构建则跳过）', () => {
    for (const entry of ['index.html', 'lyrics.html']) {
      const file = resolve(pkgRoot, 'dist', entry);
      if (!existsSync(file)) {
        console.log(`   （跳过 ${entry}：dist 未构建）`);
        continue;
      }
      const html = readFileSync(file, 'utf8');
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((u) => u.includes('assets'));
      assert.ok(refs.length > 0, `${entry} 里没找到 assets 引用`);
      for (const ref of refs) {
        assert.ok(
          ref.startsWith('./'),
          `${entry} 的资源引用 "${ref}" 不是相对路径（file:// 下会解析到文件系统根）`,
        );
        const abs = resolve(pkgRoot, 'dist', ref);
        assert.ok(
          existsSync(abs),
          `${entry} 引用的 "${ref}" 在 dist 里不存在`,
        );
      }
    }
  });

  // ── 3. Tailwind --tw-* 变量兜底必须在产物里 ─────────────────────
  // 背景（2026-09-29）：项目刻意不引 Tailwind Preflight（它的 reset 会覆盖
  // AETHER 的 button/input 样式，4 档 theater visual baseline 全飘红）。但
  // Preflight 还负责初始化 `--tw-*` 变量，缺了它 → `.translate-x-[-50%]`
  // 的 `transform: translate(var(--tw-translate-x), var(--tw-translate-y))`
  // 因 var 无定义而**整条作废** → shadcn Dialog 居中失效、modal 铺出屏幕。
  // 注意它不是"回退到 none"就能接受的静默失败，视觉上像布局随机歪掉。
  check('3. dist 产物里有 --tw-transform 系变量的 `*{}` 兜底初始化', () => {
    let found = false;
    for (const entry of ['index.html', 'lyrics.html']) {
      const file = resolve(pkgRoot, 'dist', entry);
      if (!existsSync(file)) continue;
      // HTML 里内联的 CSS 也算（dev 模式与产物两条路径都要覆盖）
      const html = readFileSync(file, 'utf8');
      if (/--tw-translate-x:\s*0/.test(html)) found = true;
    }
    const assetsDir = resolve(pkgRoot, 'dist', 'assets');
    if (existsSync(assetsDir)) {
      for (const f of readdirSync(assetsDir)) {
        if (!f.endsWith('.css')) continue;
        const css = readFileSync(resolve(assetsDir, f), 'utf8');
        if (/--tw-translate-x:\s*0/.test(css)) found = true;
      }
    }
    assert.ok(
      found,
      '产物里找不到 `--tw-translate-x: 0` 的通配初始化 —— ' +
        'Tailwind transform 系 utility（shadcn Dialog 居中等）会静默失效',
    );
  });

  console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} build-base.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
