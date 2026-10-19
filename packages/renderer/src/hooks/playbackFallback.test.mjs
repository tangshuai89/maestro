/**
 * 播放失败兜底链的**接线契约测试**（纯源码断言，跑 node）。
 * 运行: node src/hooks/playbackFallback.test.mjs
 *
 * ## 为什么要有这层
 *
 * 2026-10-19 报障「启动后不播放」的真实根因是 QQ 对部分歌曲不返 purl
 * （实测《演员》能放、《晴天》不能），而应用对此**零兜底**：界面停在
 * 「等待播放」还显示 READY。这不是纯逻辑错，是 `tryFallbackSource` 里一行
 * `if (!unified || !cur) return false` —— radio track 没有 unified，直接
 * 从兜底链里被踢出去。
 *
 * 这类 bug 纯函数单测抓不到：`shouldSearchEquivalent(hasTrack, alreadyTried)`
 * 全绿，因为错的是**它有没有被调用**。所以只能从源码层守：
 * 凡是"删掉兜底"或"去掉上限"的改法，都必须让本文件变红。
 */

import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const usePlayer = read('usePlayer.ts');
const probe = read('../../../server/src/music/qq-session-probe.ts');
const qqProvider = read('../../../server/src/music/qq.provider.ts');

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

/** 抠出某个函数的源码块（按大括号配平）。 */
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start > 0, `找不到 ${signature}`);
  let depth = 0;
  let seen = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
      seen = true;
    } else if (src[i] === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${signature} 的大括号没配平`);
}

check('F1. tryFallbackSource 不再因「没有 unified」直接放弃兜底', () => {
  const body = fnBody(usePlayer, 'const tryFallbackSource = useCallback');
  assert.ok(
    !/if \(!unified \|\| !cur\) return false/.test(body),
    '兜底链又退回到「没有 unified 就不兜底」——radio 歌放不了时零兜底',
  );
  assert.ok(/if \(!cur\) return false/.test(body), '至少要有「没有当前 track 才放弃」的守卫');
});

check('F2. 兜底链真的调用了 shouldSearchEquivalent（unified 不是前置条件）', () => {
  const body = fnBody(usePlayer, 'const tryFallbackSource = useCallback');
  assert.ok(
    /shouldSearchEquivalent\(\{/.test(body),
    'tryFallbackSource 没调 shouldSearchEquivalent —— 无 unified 的歌搜不到等价源',
  );
  // 入参必须含 hasTrack（而不是 hasUnified）
  assert.ok(
    /hasTrack:\s*true/.test(body),
    'shouldSearchEquivalent 的入参应基于 hasTrack，而不是 unified 是否存在',
  );
});

check('F3. radio 兜底有「同歌只换一次源」的闸（否则 qq↔netease 无限来回）', () => {
  const body = fnBody(usePlayer, 'const tryFallbackSource = useCallback');
  assert.ok(
    /const radioKey = unified \? null :/.test(body),
    'radio 去重键必须在 unified 存在时让位（unified 走 per-song guard）',
  );
  // 光有「读」或光有「写」都不构成闸：换源后 presentTrack 会把标记重置，
  // 所以必须**先读判重、再写记下**，两步都在才算有闸。
  assert.ok(
    /radioFallbackKeyRef\.current === radioKey/.test(body),
    'radio 兜底闸缺「读」：同歌换过一次源之后仍然会再去搜 → qq↔netease 无限来回',
  );
  assert.ok(
    /radioFallbackKeyRef\.current = radioKey/.test(body),
    'radio 兜底闸缺「写」：去重键从不记录 → 闸形同虚设',
  );
});

check('F4. onError 的重试分支走 shouldTransientRetry（有次数上限）', () => {
  const body = fnBody(usePlayer, 'const onError = () => {');
  assert.ok(
    /shouldTransientRetry\(\{/.test(body),
    'onError 没走 shouldTransientRetry —— 重试无上限，坏源会无限重试',
  );
  assert.ok(/transientAttemptsRef\.current \+= 1/.test(body), '重试次数没有累加，上限形同虚设');
  // 旧的无上限判据不能回来
  assert.ok(
    !/if \(!retryAttemptedRef\.current && audio\.dataset\.wantPlay === '1'\)/.test(body),
    'onError 又退回无上限的裸判断',
  );
});

check('F5. 重试「成功」后有卡死探测（play() resolve 不代表出了声）', () => {
  const body = fnBody(usePlayer, 'const onError = () => {');
  assert.ok(/isPlaybackStalled\(\{/.test(body), '缺卡死判定：00:00 会被当成播放中');
  assert.ok(/stallTimerRef\.current = setTimeout/.test(body), '缺探测定时器');
  assert.ok(/STALL_PROBE_MS/.test(body), '探测窗口没接上常量');
});

check('F6. presentTrack 重置重试次数 / 清探测定时器 / 递增换歌 epoch', () => {
  const body = fnBody(usePlayer, 'const presentTrack = useCallback');
  assert.ok(
    /transientAttemptsRef\.current = 0/.test(body),
    '切歌没清重试计数 → 第一首会吃掉后面的额度',
  );
  assert.ok(/clearStallTimer\(\)/.test(body), '切歌没清卡死探测定时器 → 会对新歌误判');
  assert.ok(
    /songEpochRef\.current \+= 1/.test(body),
    '切歌没递增 epoch → 跨 await 的兜底回调会打到新歌上',
  );
});

check('F7. 兜底的跨 await 守卫用 epoch（radio 没有 id，只比 unified 会恒等）', () => {
  const body = fnBody(usePlayer, 'const tryFallbackSource = useCallback');
  assert.ok(
    /songEpochRef\.current !== epoch/.test(body),
    '缺 epoch 守卫：radio 路径切歌后旧结果仍会生效',
  );
});

check('F8. QQ 探针日志带 purl 比例（alive=true 不等于"什么都正常"）', () => {
  assert.ok(/purlCount\?/.test(probe) || /purlCount:/.test(probe), '探针结果没带 purlCount');
  assert.ok(/songCount/.test(probe), '探针结果没带 songCount');
  assert.ok(
    /purl=\$\{res\.purlCount/.test(qqProvider),
    '日志没打 purl=x/y —— "alive=true" 会继续误导排查（2026-10-19 就被带偏过）',
  );
});

console.log(`\n🎉 playbackFallback.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
