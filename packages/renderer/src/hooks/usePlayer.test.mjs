// F1 usePlayer 核心逻辑测试：tryUpgradeFromTrial、跨平台降级循环
//
// usePlayer 是 1296 行的 React hook，深度依赖 refs/state，无法在不引入
// React testing library 的情况下整体测试。这里测它的**纯决策函数**：
//   - getFullSongProviders(spotifyTier)
//   - pickFallbackSource(sources, tried, priority)
//   - pickUpgradeSource(sources, tried, fullProviders)
//   - TRIAL_MAX_SEC / TRIAL_GAP_SEC 常量
//   - FALLBACK_PRIORITY 顺序
//
// 这些函数封装了跨平台降级和试听升级的核心选择逻辑，是 hook 里
// 最容易出 bug 的部分（优先级顺序、vipLocked 过滤、tried 去重）。
//
// 运行: node src/hooks/usePlayer.test.mjs

import { register } from 'node:module';

const loaderCode = `
import { extname } from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
    const parent = context.parentURL;
    if (parent && parent.endsWith('.ts')) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
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

// Mock globals needed by transitive imports
globalThis.window = globalThis;
globalThis.location = { search: '', reload: () => {} };
const lsStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
};

const mod = await import('./usePlayer.ts');
const {
  FALLBACK_PRIORITY,
  FULL_SONG_PROVIDERS,
  getFullSongProviders,
  pickFallbackSource,
  pickUpgradeSource,
  TRIAL_MAX_SEC,
  TRIAL_GAP_SEC,
} = mod;

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected ||
    JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── helpers ───────────────────────────────────────────────────────────
function makeSource(platform, { hasCopyright = true, vipLocked = false } = {}) {
  return { platform, hasCopyright, vipLocked, trackId: `${platform}-1`, url: `/${platform}/1` };
}

async function main() {
  // ── 常量 ────────────────────────────────────────────────────────────
  check('1. FALLBACK_PRIORITY 顺序', FALLBACK_PRIORITY, ['qq', 'netease', 'deezer', 'spotify']);
  check('2. FULL_SONG_PROVIDERS', FULL_SONG_PROVIDERS, ['qq', 'netease']);
  check('3. TRIAL_MAX_SEC = 120', TRIAL_MAX_SEC, 120);
  check('4. TRIAL_GAP_SEC = 45', TRIAL_GAP_SEC, 45);

  // ── getFullSongProviders ────────────────────────────────────────────
  check('5. getFullSongProviders(premium) 含 spotify', getFullSongProviders('premium'), ['qq', 'netease', 'spotify']);
  check('6. getFullSongProviders(free) 不含 spotify', getFullSongProviders('free'), ['qq', 'netease']);
  check('7. getFullSongProviders(null) 不含 spotify', getFullSongProviders(null), ['qq', 'netease']);
  check('8. getFullSongProviders(undefined) 不含 spotify', getFullSongProviders(undefined), ['qq', 'netease']);

  // ── pickFallbackSource ──────────────────────────────────────────────
  // 9. 空 sources → undefined
  check('9. pickFallbackSource 空 sources', pickFallbackSource([], new Set()), undefined);

  // 10. 单个 qq source → 返回 qq
  {
    const src = makeSource('qq');
    const picked = pickFallbackSource([src], new Set());
    check('10. pickFallbackSource 单 qq', picked?.platform, 'qq');
  }

  // 11. qq 已 tried → 跳到 netease
  {
    const sources = [makeSource('qq'), makeSource('netease')];
    const picked = pickFallbackSource(sources, new Set(['qq']));
    check('11. qq tried → netease', picked?.platform, 'netease');
  }

  // 12. 全 tried → undefined
  {
    const sources = [makeSource('qq'), makeSource('netease')];
    const picked = pickFallbackSource(sources, new Set(['qq', 'netease']));
    check('12. 全 tried → undefined', picked, undefined);
  }

  // 13. 按 FALLBACK_PRIORITY 顺序选（qq 优先于 deezer）
  {
    const sources = [makeSource('deezer'), makeSource('qq')];
    const picked = pickFallbackSource(sources, new Set());
    check('13. 按 priority 选 qq 优先于 deezer', picked?.platform, 'qq');
  }

  // 14. hasCopyright=false → 跳过
  {
    const sources = [makeSource('qq', { hasCopyright: false }), makeSource('netease')];
    const picked = pickFallbackSource(sources, new Set());
    check('14. hasCopyright=false 跳过', picked?.platform, 'netease');
  }

  // 15. 4 平台全在 → 按 priority 选 qq
  {
    const sources = ['qq', 'netease', 'deezer', 'spotify'].map((p) => makeSource(p));
    const picked = pickFallbackSource(sources, new Set());
    check('15. 4 平台 → qq 优先', picked?.platform, 'qq');
  }

  // 16. qq + netease tried → 选 deezer（跳过 spotify）
  {
    const sources = ['qq', 'netease', 'deezer', 'spotify'].map((p) => makeSource(p));
    const picked = pickFallbackSource(sources, new Set(['qq', 'netease']));
    check('16. qq+netease tried → deezer', picked?.platform, 'deezer');
  }

  // 17. qq tried + deezer 无版权 → 选 spotify
  {
    const sources = [
      makeSource('qq'),
      makeSource('deezer', { hasCopyright: false }),
      makeSource('spotify'),
    ];
    const picked = pickFallbackSource(sources, new Set(['qq']));
    check('17. qq tried + deezer 无版权 → spotify', picked?.platform, 'spotify');
  }

  // ── pickUpgradeSource ───────────────────────────────────────────────
  // 18. 空 sources → undefined
  check('18. pickUpgradeSource 空 sources', pickUpgradeSource([], new Set()), undefined);

  // 19. qq source → 返回 qq
  {
    const src = makeSource('qq');
    const picked = pickUpgradeSource([src], new Set());
    check('19. pickUpgradeSource 单 qq', picked?.platform, 'qq');
  }

  // 20. qq vipLocked → 跳过（换到另一个 VIP 锁没意义）
  {
    const sources = [makeSource('qq', { vipLocked: true }), makeSource('netease')];
    const picked = pickUpgradeSource(sources, new Set());
    check('20. qq vipLocked → netease', picked?.platform, 'netease');
  }

  // 21. 全 vipLocked → undefined
  {
    const sources = [makeSource('qq', { vipLocked: true }), makeSource('netease', { vipLocked: true })];
    const picked = pickUpgradeSource(sources, new Set());
    check('21. 全 vipLocked → undefined', picked, undefined);
  }

  // 22. deezer 不在 fullProviders → 不选
  {
    const sources = [makeSource('deezer'), makeSource('qq')];
    const picked = pickUpgradeSource(sources, new Set());
    check('22. deezer 不在 fullProviders → 选 qq', picked?.platform, 'qq');
  }

  // 23. qq tried → netease
  {
    const sources = [makeSource('qq'), makeSource('netease')];
    const picked = pickUpgradeSource(sources, new Set(['qq']));
    check('23. qq tried → netease', picked?.platform, 'netease');
  }

  // 24. 全 tried → undefined
  {
    const sources = [makeSource('qq'), makeSource('netease')];
    const picked = pickUpgradeSource(sources, new Set(['qq', 'netease']));
    check('24. 全 tried → undefined', picked, undefined);
  }

  // 25. hasCopyright=false → 跳过
  {
    const sources = [makeSource('qq', { hasCopyright: false }), makeSource('netease')];
    const picked = pickUpgradeSource(sources, new Set());
    check('25. hasCopyright=false 跳过', picked?.platform, 'netease');
  }

  // 26. 自定义 fullProviders（含 spotify premium）
  {
    const sources = [makeSource('qq', { vipLocked: true }), makeSource('spotify')];
    const picked = pickUpgradeSource(sources, new Set(), ['qq', 'netease', 'spotify']);
    check('26. premium fullProviders → spotify', picked?.platform, 'spotify');
  }

  // 27. spotify vipLocked + premium → 跳过 spotify
  {
    const sources = [makeSource('qq', { vipLocked: true }), makeSource('spotify', { vipLocked: true })];
    const picked = pickUpgradeSource(sources, new Set(), ['qq', 'netease', 'spotify']);
    check('27. spotify vipLocked → undefined', picked, undefined);
  }

  // ── 降级循环模拟 ────────────────────────────────────────────────────
  // 28. 模拟完整降级链：qq → netease → deezer → spotify → undefined
  {
    const sources = ['qq', 'netease', 'deezer', 'spotify'].map((p) => makeSource(p));
    const tried = new Set();
    const chain = [];
    let picked = pickFallbackSource(sources, tried);
    while (picked) {
      chain.push(picked.platform);
      tried.add(picked.platform);
      picked = pickFallbackSource(sources, tried);
    }
    check('28. 完整降级链 qq→netease→deezer→spotify', chain, ['qq', 'netease', 'deezer', 'spotify']);
  }

  // 29. 降级链中 deezer 无版权 → 跳到 spotify
  {
    const sources = [
      makeSource('qq'),
      makeSource('netease'),
      makeSource('deezer', { hasCopyright: false }),
      makeSource('spotify'),
    ];
    const tried = new Set();
    const chain = [];
    let picked = pickFallbackSource(sources, tried);
    while (picked) {
      chain.push(picked.platform);
      tried.add(picked.platform);
      picked = pickFallbackSource(sources, tried);
    }
    check('29. deezer 无版权 → 跳到 spotify', chain, ['qq', 'netease', 'spotify']);
  }

  // 30. 升级链：只 qq+netease（无 spotify 因为非 premium）
  {
    const sources = ['qq', 'netease', 'deezer', 'spotify'].map((p) => makeSource(p));
    const tried = new Set();
    const chain = [];
    let picked = pickUpgradeSource(sources, tried);
    while (picked) {
      chain.push(picked.platform);
      tried.add(picked.platform);
      picked = pickUpgradeSource(sources, tried);
    }
    check('30. 升级链只 qq+netease（非 premium）', chain, ['qq', 'netease']);
  }

  console.log(`\n🎉 usePlayer.test 通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
