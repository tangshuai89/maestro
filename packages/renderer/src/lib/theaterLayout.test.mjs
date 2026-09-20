// theaterLayout.test.mjs — 剧场视图尺寸适配规则
// Run: node src/lib/theaterLayout.test.mjs

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function main() {
  const { theaterDensity, canvasScale, lyricWindow, CANVAS, TITLEBAR_H } = await import('./theaterLayout.ts');

  // ── 档位阈值 ────────────────────────────────────────────────────
  check('1. 1920 → regular', theaterDensity(1920), 'regular');
  check('2. 1440 → regular', theaterDensity(1440), 'regular');
  check('3. 1280 → regular（含边界）', theaterDensity(1280), 'regular');
  check('4. 1279 → compact', theaterDensity(1279), 'compact');
  check('5. 1200（窗口默认）→ compact', theaterDensity(1200), 'compact');
  check('6. 1100 → compact（含边界）', theaterDensity(1100), 'compact');
  check('7. 1099 → narrow', theaterDensity(1099), 'narrow');
  check('8. 960（窗口最小宽）→ narrow', theaterDensity(960), 'narrow');

  // ── 画布与缩放 ──────────────────────────────────────────────────
  check('9. narrow 用紧凑画布 960×800', CANVAS.narrow, { w: 960, h: 800 });
  check('10. regular 用 1440×900', CANVAS.regular, { w: 1440, h: 900 });
  check('11. Titlebar 高 40', TITLEBAR_H, 40);

  // 960×800 窗口：可用高 = 800 - 40(Titlebar) = 760 → 0.95 是高度瓶颈，不是 1
  // 意义：紧凑档在最小窗口下只缩 5%（9px 小字 → 8.55px），
  // 而旧的 1440 画布在同一窗口是 0.667（9px → 6px，不可读）
  check('12. 960×800 narrow 缩放 = 0.95（高度瓶颈，仅缩 5%）', canvasScale(960, 800, 'narrow'), 0.95);
  check('12b. 同一窗口下 narrow 比 regular 少缩 30%（可读性来源）',
    Math.round((canvasScale(960, 800, 'narrow') - canvasScale(960, 800, 'regular')) * 1000) / 1000, 0.283);
  // 1440×900 窗口 → 高度是瓶颈（860 可用高 / 900 画布 ≈ 0.956）
  check('13. 1440×900 regular 缩放 ≈ 0.956（高度瓶颈）', Math.round(canvasScale(1440, 900, 'regular') * 1000) / 1000, 0.956);
  // 1200×800（窗口默认）→ 宽度瓶颈 0.833
  check('14. 1200×800 regular 缩放 ≈ 0.833（宽度瓶颈）', Math.round(canvasScale(1200, 800, 'regular') * 1000) / 1000, 0.833);
  // 1920×1200 → 放大而非缩小（大窗口反而更清楚）
  check('15. 1920×1200 regular 缩放 > 1', canvasScale(1920, 1200, 'regular') > 1, true);
  // 极矮窗口：高度项有 0.3 下限
  check('16. 极矮窗口(1000×200) 不塌到 0（高度项下限 0.3）', canvasScale(1000, 200, 'regular'), 0.3);

  // ── 歌词窗口 ────────────────────────────────────────────────────
  check('17. regular 歌词 1+当前+3 = 5 行', lyricWindow('regular'), { prev: 1, following: 3 });
  check('18. compact 歌词 1+当前+1 = 3 行', lyricWindow('compact'), { prev: 1, following: 1 });
  check('19. narrow 歌词只有当前行', lyricWindow('narrow'), { prev: 0, following: 0 });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
