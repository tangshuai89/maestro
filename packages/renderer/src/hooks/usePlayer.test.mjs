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
  shouldApplyLikeResult,
  shouldStopWpsBeforeTransition,
  shouldTransientRetry,
  shouldSearchEquivalent,
  isPlaybackStalled,
  TRANSIENT_RETRY_MAX,
  STALL_PROBE_MS,
  parsePlayableQueue,
  TRIAL_MAX_SEC,
  TRIAL_GAP_SEC,
  isResidualAudio,
} = mod;

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected || JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(
      `❌ ${label}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`,
    );
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

  // ── isResidualAudio（2026-10-16 新增，残缺音源判定）────────────────
  // 背景：旧实现带 `FULL_SONG_PROVIDERS.includes(provider)` 前置条件，导致
  // 《不染》这种「QQ 全长版全 VIP 锁、只有 preview 平台能出声」的场景
  // **连试都不试**，用户静默听完 29 秒零反馈。下面钉死「不按 provider 过滤」。
  check(
    '6. ★ 《不染》场景：deezer 源、音频 29s、元数据 325s → 判残缺（要跨平台搜全曲）',
    isResidualAudio({ provider: 'deezer', audioDuration: 29, metaDuration: 325 }),
    true,
  );
  check(
    '7. 同上，spotify 源 → 同样判残缺（旧实现会直接 false）',
    isResidualAudio({ provider: 'spotify', audioDuration: 30, metaDuration: 240 }),
    true,
  );
  check(
    '8. qq 源 VIP 试听 → 仍判残缺（原有行为不回退）',
    isResidualAudio({ provider: 'qq', audioDuration: 30, metaDuration: 240 }),
    true,
  );
  check(
    '9. provider 不影响判定：四个平台同参数结果一致',
    ['qq', 'netease', 'deezer', 'spotify'].map((provider) =>
      isResidualAudio({ provider, audioDuration: 29, metaDuration: 325 }),
    ),
    [true, true, true, true],
  );
  // 不该判残缺的情形
  check(
    '10. 正常全曲（225s 音频 / 240s 元数据）→ 不判残缺',
    isResidualAudio({ provider: 'qq', audioDuration: 225, metaDuration: 240 }),
    false,
  );
  check(
    '11. 元数据与音频差 < TRIAL_GAP_SEC（45s）→ 不判（切片加载抖动）',
    isResidualAudio({ provider: 'qq', audioDuration: 200, metaDuration: 240 }),
    false,
  );
  check(
    '12. 音频 > TRIAL_MAX_SEC（120s）→ 不判（本来就不是试听）',
    isResidualAudio({ provider: 'spotify', audioDuration: 180, metaDuration: 300 }),
    false,
  );
  check(
    '13. audioDuration 未就绪（Infinity / NaN / 0）→ 不判',
    [
      isResidualAudio({ provider: 'qq', audioDuration: Infinity, metaDuration: 300 }),
      isResidualAudio({ provider: 'qq', audioDuration: NaN, metaDuration: 300 }),
      isResidualAudio({ provider: 'qq', audioDuration: 0, metaDuration: 300 }),
    ],
    [false, false, false],
  );
  check(
    '14. metaDuration 缺失 / 0 → 不判（没有全长基准就无从判断）',
    [
      isResidualAudio({ provider: 'qq', audioDuration: 29, metaDuration: 0 }),
      isResidualAudio({ provider: 'qq', audioDuration: 29, metaDuration: NaN }),
    ],
    [false, false],
  );

  // ── getFullSongProviders (Bug #3: 必须 tier premium AND wpsReady 才含 spotify) ──
  // 5. premium tier + WPS 就绪 → 含 spotify（全曲流，WPS 接管）
  check(
    '5. getFullSongProviders(premium, true) 含 spotify',
    getFullSongProviders('premium', true),
    ['qq', 'netease', 'spotify'],
  );
  // 5b. premium-duo + WPS 就绪 → 含 spotify
  check(
    '5b. getFullSongProviders(premium-duo, true) 含 spotify',
    getFullSongProviders('premium-duo', true),
    ['qq', 'netease', 'spotify'],
  );
  // 5c. premium-family + WPS 就绪 → 含 spotify
  check(
    '5c. getFullSongProviders(premium-family, true) 含 spotify',
    getFullSongProviders('premium-family', true),
    ['qq', 'netease', 'spotify'],
  );
  // 6. premium tier 但 WPS 没就绪 → **不含** spotify（Bug #3 根因修复）
  //    否则 trial upgrade 会换到 30s preview URL，UI 显 00:30 而不是 04:34。
  check(
    '6. getFullSongProviders(premium, false) 不含 spotify',
    getFullSongProviders('premium', false),
    ['qq', 'netease'],
  );
  // 6b. 默认参数 wpsReady=false → 同 6
  check(
    '6b. getFullSongProviders(premium) 默认 wpsReady=false → 不含 spotify',
    getFullSongProviders('premium'),
    ['qq', 'netease'],
  );
  check('7. getFullSongProviders(null) 不含 spotify', getFullSongProviders(null), [
    'qq',
    'netease',
  ]);
  check('8. getFullSongProviders(undefined) 不含 spotify', getFullSongProviders(undefined), [
    'qq',
    'netease',
  ]);
  // 8b. free + WPS 就绪 → 仍不含（tier 不是 premium 系列）
  check('8b. getFullSongProviders(free, true) 不含 spotify', getFullSongProviders('free', true), [
    'qq',
    'netease',
  ]);

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
    const sources = [
      makeSource('qq', { vipLocked: true }),
      makeSource('netease', { vipLocked: true }),
    ];
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
    const sources = [
      makeSource('qq', { vipLocked: true }),
      makeSource('spotify', { vipLocked: true }),
    ];
    const picked = pickUpgradeSource(sources, new Set(), ['qq', 'netease', 'spotify']);
    check('27. spotify vipLocked → undefined', picked, undefined);
  }

  // ── T6 shouldApplyLikeResult（consistency-fixes D2/D5/D6 守护） ──
  // ticket 一致 + track 一致 → 允许应用。
  check('T6.1 ticket + track 都一致 → true', shouldApplyLikeResult(1, 'a', 1, 'a'), true);
  // ticket 不一致（用户重新 ❤ / 踩）→ 丢弃旧结果。
  check('T6.2 ticket 不一致 → false', shouldApplyLikeResult(1, 'a', 2, 'a'), false);
  // track 不一致（切歌）→ 丢弃旧结果。
  check('T6.3 track 不一致 → false', shouldApplyLikeResult(1, 'a', 1, 'b'), false);
  // currentTrackId undefined（极快地又切走）→ 丢弃。
  check(
    'T6.4 currentTrackId undefined → false',
    shouldApplyLikeResult(1, 'a', 1, undefined),
    false,
  );
  // 两个都不一致 → 丢弃。
  check('T6.5 ticket + track 都不一致 → false', shouldApplyLikeResult(1, 'a', 2, 'b'), false);

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
    check('28. 完整降级链 qq→netease→deezer→spotify', chain, [
      'qq',
      'netease',
      'deezer',
      'spotify',
    ]);
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

  // ── parsePlayableQueue ─────────────────────────────────────────────
  // 31. 空数组 → 空 tracks + 空 unifiedItems
  {
    const result = parsePlayableQueue([]);
    check('31. parsePlayableQueue 空数组', result.tracks, []);
    check('31b. parsePlayableQueue 空数组 unifiedItems', result.unifiedItems, []);
  }

  // 32. WPS 关 → pickPlayableTrack 选 bestSource
  {
    const items = [
      {
        title: '晴天',
        artist: '周杰伦',
        album: '叶惠美',
        coverUrl: '/cover.jpg',
        duration: 270,
        bestSource: 'qq',
        // hasCopyright 必填：parsePlayableQueue 现在用 isPlayableEntry 过滤
        // （与 SearchPanel 的行可点性共用同一把尺子），而它第一件事就是
        // `if (!src.hasCopyright) return false`。缺这个字段 = 判成无版权 = 整首
        // 被丢出队列。服务端 always 填 true（search.util.ts / music.service.ts），
        // 所以 fixture 也要给全，否则测的是一个生产中不存在的输入。
        sources: [
          {
            platform: 'qq',
            trackId: 'qq-1',
            url: '/qq/stream',
            mediaMid: 'mm1',
            hasCopyright: true,
          },
        ],
      },
    ];
    const result = parsePlayableQueue(items, { wpsReady: false });
    check('32. parsePlayableQueue WPS 关 → pickPlayableTrack', result.tracks.length, 1);
    check('32b. track provider = qq', result.tracks[0].provider, 'qq');
    check('32c. track audioUrl = /qq/stream', result.tracks[0].audioUrl, '/qq/stream');
    check('32d. unifiedItems 对齐', result.unifiedItems.length, 1);
  }

  // 33. WPS 开 → Spotify 源优先（audioUrl 留空）
  {
    const items = [
      {
        title: 'Test',
        artist: 'Artist',
        album: 'Album',
        coverUrl: '/cover.jpg',
        duration: 200,
        bestSource: 'qq',
        sources: [
          { platform: 'qq', trackId: 'qq-1', url: '/qq/stream', mediaMid: 'mm1' },
          { platform: 'spotify', trackId: 'sp-1', url: '/sp/preview', mediaMid: 'mm2' },
        ],
      },
    ];
    const result = parsePlayableQueue(items, { wpsReady: true });
    check('33. parsePlayableQueue WPS 开 → spotify 源', result.tracks.length, 1);
    check('33b. track provider = spotify', result.tracks[0].provider, 'spotify');
    check('33c. track audioUrl = ""（WPS 接管）', result.tracks[0].audioUrl, '');
    check('33d. track mediaMid = mm2', result.tracks[0].mediaMid, 'mm2');
  }

  // 34. WPS 开但无 spotify 源 → 回退 pickPlayableTrack
  {
    const items = [
      {
        title: 'Test',
        artist: 'Artist',
        album: 'Album',
        coverUrl: '/cover.jpg',
        duration: 200,
        bestSource: 'qq',
        sources: [
          {
            platform: 'qq',
            trackId: 'qq-1',
            url: '/qq/stream',
            mediaMid: 'mm1',
            hasCopyright: true,
          },
        ],
      },
    ];
    const result = parsePlayableQueue(items, { wpsReady: true });
    check('34. WPS 开但无 spotify → 回退 pickPlayableTrack', result.tracks[0].provider, 'qq');
    check('34b. audioUrl 非空', result.tracks[0].audioUrl, '/qq/stream');
  }

  // 35. bestSource = null → pickPlayableTrack 返回 null → 跳过
  {
    const items = [
      {
        title: 'Test',
        artist: 'Artist',
        album: 'Album',
        coverUrl: '/cover.jpg',
        duration: 200,
        bestSource: null,
        sources: [
          {
            platform: 'qq',
            trackId: 'qq-1',
            url: '/qq/stream',
            mediaMid: 'mm1',
            hasCopyright: true,
          },
        ],
      },
    ];
    const result = parsePlayableQueue(items);
    check('35. bestSource=null → 跳过', result.tracks, []);
    check('35b. unifiedItems 也空', result.unifiedItems, []);
  }

  // 36. 混合：有 bestSource 和无 bestSource 的 items
  {
    const items = [
      {
        title: 'A',
        artist: 'X',
        album: 'Al',
        coverUrl: '/c.jpg',
        duration: 200,
        bestSource: 'qq',
        sources: [{ platform: 'qq', trackId: '1', url: '/u1', mediaMid: 'm1', hasCopyright: true }],
      },
      {
        title: 'B',
        artist: 'Y',
        album: 'Bl',
        coverUrl: '/c2.jpg',
        duration: 180,
        bestSource: null,
        sources: [
          { platform: 'netease', trackId: '2', url: '/u2', mediaMid: 'm2', hasCopyright: true },
        ],
      },
      {
        title: 'C',
        artist: 'Z',
        album: 'Cl',
        coverUrl: '/c3.jpg',
        duration: 220,
        bestSource: 'netease',
        sources: [
          { platform: 'netease', trackId: '3', url: '/u3', mediaMid: 'm3', hasCopyright: true },
        ],
      },
    ];
    const result = parsePlayableQueue(items);
    check('36. 混合 items → 只保留可播的', result.tracks.length, 2);
    check('36b. 第一首 A', result.tracks[0].title, 'A');
    check('36c. 第二首 C（B 被跳过）', result.tracks[1].title, 'C');
    check('36d. unifiedItems 对齐', result.unifiedItems.length, 2);
  }

  // 37. wpsReady 默认 false（不传 opts）
  {
    const items = [
      {
        title: 'T',
        artist: 'A',
        album: 'Al',
        coverUrl: '/c.jpg',
        duration: 200,
        bestSource: 'qq',
        sources: [
          { platform: 'qq', trackId: '1', url: '/u1', mediaMid: 'm1', hasCopyright: true },
          { platform: 'spotify', trackId: '2', url: '/sp', mediaMid: 'm2' },
        ],
      },
    ];
    const result = parsePlayableQueue(items);
    check('37. 不传 opts → wpsReady=false → 选 qq', result.tracks[0].provider, 'qq');
  }

  // 38. getFullSongProviders: premium-duo 也含 spotify
  {
    // Bug #3: 必须 tier premium-* AND wpsReady=true 才含 spotify。
    // 老测试 38/38b 不传 wpsReady（默认 false）→ 期望不变（不含 spotify）。
    check(
      '38. getFullSongProviders(premium-duo, false) 默认不含 spotify',
      getFullSongProviders('premium-duo'),
      ['qq', 'netease'],
    );
    check(
      '38b. getFullSongProviders(premium-family, false) 默认不含 spotify',
      getFullSongProviders('premium-family'),
      ['qq', 'netease'],
    );
  }

  // 39. pickUpgradeSource: vipLocked 跳过
  {
    const sources = [makeSource('qq', { vipLocked: true }), makeSource('netease')];
    const picked = pickUpgradeSource(sources, new Set());
    check('39. pickUpgradeSource: qq vipLocked → 跳到 netease', picked?.platform, 'netease');
  }

  // 40. pickUpgradeSource: 全 vipLocked → undefined
  {
    const sources = [
      makeSource('qq', { vipLocked: true }),
      makeSource('netease', { vipLocked: true }),
    ];
    const picked = pickUpgradeSource(sources, new Set());
    check('40. pickUpgradeSource: 全 vipLocked → undefined', picked, undefined);
  }

  // 41. pickFallbackSource: 自定义 priority
  {
    const sources = ['qq', 'netease', 'deezer'].map((p) => makeSource(p));
    const picked = pickFallbackSource(sources, new Set(), ['deezer', 'netease', 'qq']);
    check('41. pickFallbackSource 自定义 priority → deezer 优先', picked?.platform, 'deezer');
  }

  // 42. pickUpgradeSource: 自定义 fullProviders
  {
    const sources = ['qq', 'netease', 'deezer', 'spotify'].map((p) => makeSource(p));
    const picked = pickUpgradeSource(sources, new Set(), ['spotify', 'deezer']);
    check('42. pickUpgradeSource 自定义 fullProviders → spotify 优先', picked?.platform, 'spotify');
  }

  // ── shouldStopWpsBeforeTransition (Bug #2 stability-bug2-wps-double-play) ──
  // 43. WPS 没播过 → false（不必 stop）
  check(
    '43. wpsLastPlayedId=null → false',
    shouldStopWpsBeforeTransition(null, { provider: 'qq', id: 'q-1' }, true),
    false,
  );

  // 44. nextTrack=null → false（没新歌谈不上 stop）
  check('44. nextTrack=null → false', shouldStopWpsBeforeTransition('sp-A', null, true), false);

  // 45. 同 spotify track、wpsReady=true → false（不应该打断 pause/resume）
  check(
    '45. spotify→同 spotify id, wpsReady=true → false（保留 resume）',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'spotify', id: 'sp-A' }, true),
    false,
  );

  // 46. (A) spotify→QQ → true（必须停 WPS，否则旧 URI 续播 → 两路叠加）
  check(
    '46. spotify→QQ, wpsReady=true → true',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'qq', id: 'q-1' }, true),
    true,
  );

  // 47. (B) 同 spotify provider 但 id 变 → true（wpsReady=true 也要 stop 旧的）
  check(
    '47. spotify A→spotify B, wpsReady=true → true',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'spotify', id: 'sp-B' }, true),
    true,
  );

  // 48. (B) spotify→spotify, wpsReady 翻 false（token/EME race）→ true
  check(
    '48. spotify A→spotify B, wpsReady=false → true',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'spotify', id: 'sp-B' }, false),
    true,
  );

  // 49. (C) spotify→QQ→spotify A（id 相同但中间离开过）→ true
  //     这里模拟的是：上一首 WPS 播 A → 切到 QQ → 又切回 spotify A。
  //     此时虽然 id 相同，但 wpsPlayedIdRef 已被 presentTrack 清成 null，
  //     所以新一次 useEffect 进来时 wpsLastPlayedId=null → 走 false 分支。
  //     本测试验证「ref 没被清」的另一条路径：直接喂 wpsLastPlayedId='sp-A' +
  //     跳到 spotify A → 仍要 stop（虽然 id 相同，但中间有过换 provider，
  //     WPS 状态不可信）。这个场景的实际防御在 presentTrack 里清 ref；这里
  //     测纯函数在「同 id 但 wpsReady=false」下的判定。
  check(
    '49. spotify→spotify 同 id, wpsReady=false → true（不可信）',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'spotify', id: 'sp-A' }, false),
    true,
  );

  // 50. nextTrack.id 是空字符串 → 不视作 spotify id，仍要 stop
  check(
    '50. spotify→spotify 空 id → true',
    shouldStopWpsBeforeTransition('sp-A', { provider: 'spotify', id: '' }, true),
    true,
  );

  // ── 播放失败处置策略（2026-10-19 报障「启动后不播放」）──────────────
  //
  // 这三条守的是两个真实洞：
  //  A. transient 重试无上限 + 成功后清零 guard → 坏源无限重试，永远走不到兜底
  //  B. radio track 没有 unified → tryFallbackSource 直接 return false → 零兜底

  // 51. wantPlay=0（暂停/切歌后）→ 不重试，直接兜底
  check(
    '51. wantPlay=0 → 不做 transient 重试',
    shouldTransientRetry({ attempts: 0, wantPlay: false }),
    false,
  );

  // 52. wantPlay 未定义（同上，等价于没在播）→ 不重试
  check(
    '52. wantPlay=undefined → 不做 transient 重试',
    shouldTransientRetry({ attempts: 0, wantPlay: undefined }),
    false,
  );

  // 53. 次数未到上限 → 重试
  check(
    '53. attempts=0 且在播 → 重试',
    shouldTransientRetry({ attempts: 0, wantPlay: true }),
    true,
  );

  // 54. 达到上限 → 不再重试（这正是无限重试那个洞）
  check(
    '54. attempts 达上限 → 停止重试并走兜底',
    shouldTransientRetry({ attempts: TRANSIENT_RETRY_MAX, wantPlay: true }),
    false,
  );

  // 55. 上限可配；attempts 超过上限同样为 false
  check(
    '55. attempts 超上限 / 自定义 max',
    [
      shouldTransientRetry({ attempts: 9, wantPlay: true }),
      shouldTransientRetry({ attempts: 1, wantPlay: true, max: 1 }),
      shouldTransientRetry({ attempts: 0, wantPlay: true, max: 0 }),
    ],
    [false, false, false],
  );

  // 56. 没有 track → 不搜等价源
  check(
    '56. 无 track → 不搜等价源',
    shouldSearchEquivalent({ hasTrack: false, alreadyTried: false }),
    false,
  );

  // 57. **没有 unified 也要能搜** —— radio 路径零兜底那个洞。helper 的入参
  //     里刻意没有 unified：它不该是前置条件（findEquivalentSource 只吃
  //     title/artist/duration）。
  check(
    '57. 无 unified 语境下仍允许搜等价源',
    shouldSearchEquivalent({ hasTrack: true, alreadyTried: false }),
    true,
  );

  // 58. 同一首歌只搜一次 —— 否则 qq↔netease 来回换（radio 的 presentTrack
  //     没有 unified，会把每次换源当新歌重置 triedPlatforms）
  check(
    '58. 同歌已搜过 → 不再搜（防来回换源）',
    shouldSearchEquivalent({ hasTrack: true, alreadyTried: true }),
    false,
  );

  // 59. 观察窗口没到 → 不能判定卡死（否则把正常起播误判成坏源）
  check(
    '59. elapsed 未到探测窗口 → 不判卡死',
    isPlaybackStalled({ currentTime: 0, elapsedMs: STALL_PROBE_MS - 1 }),
    false,
  );

  // 60. 窗口到了 + 进度为 0 → 卡死（play() resolve 了但没出声）
  check(
    '60. 窗口到了仍 00:00 → 判卡死',
    isPlaybackStalled({ currentTime: 0, elapsedMs: STALL_PROBE_MS }),
    true,
  );

  // 61. 窗口到了但已经在走 → 正常
  check(
    '61. 窗口到了且有进度 → 不判卡死',
    isPlaybackStalled({ currentTime: 1.2, elapsedMs: STALL_PROBE_MS + 500 }),
    false,
  );

  console.log(`\n🎉 usePlayer.test 通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
