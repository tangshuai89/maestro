/**
 * `<audio>` src 绑定的**契约测试**（纯源码断言，跑 node，无 React 运行时）。
 * 运行: node src/hooks/audioSrcBinding.test.mjs
 *
 * ## 为什么需要它
 *
 * crossfade 落地时，`<audio>` 的 `src` 从 React 绑定（`src={track.audioUrl}`）
 * 改成了命令式装载（`loadIntoSlots` / `reloadActiveWithUrl`）。这是必需改动：
 * 淡变要求"旧歌留在原元素继续播"，而 React 改 src 会把新 URL 甩到同一个
 * 元素上、掐断正在淡出的歌。
 *
 * 代价是**一条隐式契约**：从此"改 audioUrl"必须同时真的装载元素。只写
 * `setTrack({...prev, audioUrl})` 的话，React 状态变了、元素纹丝不动 → 用户看到
 * 「切了音质 / 降了标准，但歌还是 00:00 不出声」。
 *
 * 这个 bug **真的发生过**（2026-10-19 报障：启动后不播放）。它躲过了全部
 * 单元测试——因为纯逻辑（decideSwitch / 调度）是对的，断的是"接线"。
 * 所以只能从源码层守：凡是写 audioUrl 的地方，附近必须有命令式装载。
 */

import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const usePlayerSrc = read('usePlayer.ts');
const appSrc = read('../App.tsx');

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

check('C1. App 的两个 <audio> 都不绑 src（否则命令式装载会被 React 覆盖）', () => {
  // 只取真正的 JSX 自闭合标签：注释 / 字符串里的 `<audio>` 不算。
  const audioTags = appSrc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('<audio'))
    .map((l) => l.replace(/\/>$/, '>'));
  assert.strictEqual(audioTags.length, 2, `应恰好 2 个 <audio>，实际 ${audioTags.length}`);
  for (const tag of audioTags) {
    assert.ok(!/\bsrc=/.test(tag), `<audio> 仍绑着 src：${tag}`);
    assert.ok(/ref=\{audioSlots\.ref\('[ab]'\)\}/.test(tag), `<audio> 未挂槽位 ref：${tag}`);
    assert.ok(/preload="auto"/.test(tag), `<audio> 缺 preload：${tag}`);
  }
});

check('C2. 每一处改 audioUrl 的 setTrack 附近都有命令式装载', () => {
  const lines = usePlayerSrc.split('\n');
  // 先把块注释行标掉：注释里提到 setTrack / audioUrl 不是调用点。
  const code = lines.map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l));
  const hit = [];
  code.forEach((line, i) => {
    if (!/setTrack\(/.test(line)) return;
    // 往后 40 行内必须出现装载调用。presentTrack 的 setTrack 与 loadIntoSlots
    // 之间夹着十几行状态维护（重试计数 / epoch / pendingSeek 清零…），窗口太窄
    // 会因为「加了无关代码」而假阳性——已经踩过一次（2026-10-19）。
    const window = code.slice(i, i + 41).join('\n');
    if (!/audioUrl/.test(window)) return; // 只改 liked 等字段，不算
    hit.push({
      line: i + 1,
      text: line.trim(),
      ok: /reloadActiveWithUrl\(|loadIntoSlots\(/.test(window),
    });
  });
  assert.ok(hit.length > 0, '没找到改 audioUrl 的 setTrack —— 测试本身该更新了');
  const bad = hit.filter((h) => !h.ok);
  assert.deepStrictEqual(
    bad.map((b) => `usePlayer.ts:${b.line} ${b.text}`),
    [],
    '这些地方改了 audioUrl 却没装载元素 → 歌会卡在 00:00',
  );
});

check('C3. reloadActiveWithUrl 不碰 dataset.wantPlay（暂停时切音质不该自己播起来）', () => {
  const start = usePlayerSrc.indexOf('const reloadActiveWithUrl = useCallback');
  assert.ok(start > 0, '找不到 reloadActiveWithUrl');
  const body = usePlayerSrc.slice(start, start + 500);
  assert.ok(!/dataset\.wantPlay\s*=/.test(body), 'reloadActiveWithUrl 不该改 wantPlay');
  assert.ok(/\.src\s*=/.test(body) && /\.load\(\)/.test(body), '应设置 src 并 load()');
});

check('C4. 卸载时 dispose 切歌执行器（不留孤儿定时器 pause 元素）', () => {
  assert.ok(
    /slotLoaderRef\.current\?\.dispose\(\)/.test(usePlayerSrc),
    '缺 dispose：卸载后旧定时器还会 pause 元素 / 改增益',
  );
});

console.log(`🎉 audioSrcBinding.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
