// lyricsShare.test.mjs — 歌词分享图的窗口选择 + 文件名
//
// 只测纯函数（sliceLyricsWindow / lyricsImageFileName）；canvas 绘制路径
// 需要真实 DOM + createImageBitmap，交给端到端 / 手工验收。
// Run: node src/lib/lyricsShare.test.mjs

import { register } from 'node:module';
import * as assert from 'node:assert';

// ── inline loader：.ts 扩展名补全（lyricsShare.ts 引用 '../api'）─────────
// 与 groupLibrary.test.mjs / api.test.mjs 同一套自实现 loader。
const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && context.parentURL.endsWith('.ts')) {
    const ext = extname(specifier);
    if (!ext) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    } else if (ext === '.js') {
      try { return await nextResolve(specifier.slice(0, -3) + '.ts', context); } catch {}
    }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context);
  if (url.endsWith('.ts') && result.source) {
    const src = String(result.source);
    if (src.includes('import.meta.env')) {
      const patched = src.replace(/import\\.meta\\.env/g, '({DEV:false,PROD:true})');
      return { format: result.format, url, source: patched };
    }
  }
  return result;
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

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

/** n 行歌词：text = `L{i}`，time = i */
function makeLines(n) {
  return Array.from({ length: n }, (_, i) => ({ time: i, text: `L${i}` }));
}

async function main() {
  const { sliceLyricsWindow, lyricsImageFileName } = await import(
    './lyricsShare.ts'
  );

  // ── 1. 无 highlight → 从头取满窗口 ─────────────────────────────
  check('1. 无 highlight → 前 40 行，不高亮', () => {
    const r = sliceLyricsWindow(makeLines(100), null);
    assert.strictEqual(r.window.length, 40);
    assert.strictEqual(r.window[0].text, 'L0');
    assert.strictEqual(r.window[39].text, 'L39');
    assert.strictEqual(r.highlightIndex, null);
    assert.strictEqual(r.trimmedBefore, 0);
    assert.strictEqual(r.trimmedAfter, 60);
  });

  // ── 2. 高亮在中部 → 窗口居中到高亮行 ──────────────────────────
  check('2. 高亮第 80 行 → 窗口居中，第 80 行必在窗口内', () => {
    const r = sliceLyricsWindow(makeLines(200), 'L80');
    assert.strictEqual(r.window.length, 40);
    const texts = r.window.map((l) => l.text);
    assert.ok(texts.includes('L80'), '高亮行必须在窗口里');
    assert.strictEqual(r.window[r.highlightIndex].text, 'L80');
    // 40 行窗口：19 行在其前、20 行在其后（略偏后，给"下一句"更多留白）
    assert.strictEqual(r.highlightIndex, 19);
    assert.strictEqual(r.trimmedBefore, 61);
  });

  // ── 3. 高亮在最后一行 → 窗口尾部对齐 ──────────────────────────
  check('3. 高亮最后一行 → 窗口贴尾部', () => {
    const r = sliceLyricsWindow(makeLines(100), 'L99');
    assert.strictEqual(r.window.length, 40);
    assert.strictEqual(r.window[39].text, 'L99');
    assert.strictEqual(r.highlightIndex, 39);
    assert.strictEqual(r.trimmedAfter, 0);
    assert.strictEqual(r.trimmedBefore, 60);
  });

  // ── 4. 高亮在第一行 → 窗口从头开始（不被 start 夹成负数）──────
  check('4. 高亮第 0 行 → start 夹到 0', () => {
    const r = sliceLyricsWindow(makeLines(100), 'L0');
    assert.strictEqual(r.window[0].text, 'L0');
    assert.strictEqual(r.highlightIndex, 0);
    assert.strictEqual(r.trimmedBefore, 0);
  });

  // ── 5. 行数少于窗口 → 全取，不越界 ────────────────────────────
  check('5. 歌词只有 12 行 → 全取，highlightIndex 有效', () => {
    const r = sliceLyricsWindow(makeLines(12), 'L7');
    assert.strictEqual(r.window.length, 12);
    assert.strictEqual(r.highlightIndex, 7);
    assert.strictEqual(r.trimmedBefore, 0);
    assert.strictEqual(r.trimmedAfter, 0);
  });

  // ── 6. 高亮文案不存在（同名句 / 已切歌）→ 退化成从头取 ─────────
  check('6. highlightText 找不到 → 退化成从头取满，不报错', () => {
    const r = sliceLyricsWindow(makeLines(100), '不存在的一句');
    assert.strictEqual(r.window.length, 40);
    assert.strictEqual(r.window[0].text, 'L0');
    assert.strictEqual(r.highlightIndex, null);
  });

  // ── 7. 空数组 / 空 highlightText ──────────────────────────────
  check('7. 空数组 / 空串 highlight → 空窗口，不抛', () => {
    const r = sliceLyricsWindow([], 'L0');
    assert.deepStrictEqual(r.window, []);
    assert.strictEqual(r.highlightIndex, null);
    const r2 = sliceLyricsWindow(makeLines(5), '');
    assert.strictEqual(r2.window.length, 5);
    assert.strictEqual(r2.highlightIndex, null);
  });

  // ── 8. 自定义 max ────────────────────────────────────────────
  check('8. max 参数生效（max=3）', () => {
    const r = sliceLyricsWindow(makeLines(50), 'L40', 3);
    assert.strictEqual(r.window.length, 3);
    assert.strictEqual(r.window[r.highlightIndex].text, 'L40');
  });

  // ── 9. 文件名清理非法字符 ─────────────────────────────────────
  check('9. lyricsImageFileName 清掉 / : * ? " < > |', () => {
    assert.strictEqual(
      lyricsImageFileName('a/b', 'c:d*e?f"g<h>i|j'),
      'a_b - c_d_e_f_g_h_i_j 歌词.png',
    );
  });

  console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} lyricsShare.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
