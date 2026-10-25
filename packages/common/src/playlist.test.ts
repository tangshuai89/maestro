/**
 * 歌单曲目身份 key 的契约测试。
 *
 * 为什么要有这个测试：server 追加去重和 renderer「已在歌单」判定用的是
 * **同一个函数**（`@maestro/common` 的 `playlistTrackKey`），所以这里测的
 * 不是「某个函数对不对」，而是**两端共同依赖的那条规则**有没有被人改歪。
 *
 * 一旦有人只改一端（比如把 key 改成只用 `id`），这个测试会挡住。
 *
 * 运行: npx ts-node src/playlist.test.ts
 */
export {};
const assert = require('node:assert');
const { playlistTrackKey } = require('./playlist');

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
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

// ── 1. 有 sources[0] → platform:trackId ──────────────────
check(
  '有 sources[0] → "qq:123"',
  playlistTrackKey({ id: 'merged-key', sources: [{ platform: 'qq', trackId: '123' }] }),
  'qq:123',
);

// ── 2. 没有 sources → 退化到 id ─────────────────────────
check('没有 sources → 用 id', playlistTrackKey({ id: 'merged-key' }), 'merged-key');
check(
  'sources 是空数组 → 用 id',
  playlistTrackKey({ id: 'merged-key', sources: [] }),
  'merged-key',
);

// ── 3. **id 不同、首个音源相同 → key 必须相同** ────────────
// 这是两端最容易漂的一条：合并后的 item 的 `id` 是「归一 key」，
// 跟平台 trackId 不是一回事。若客户端按 `id` 判「不在歌单」、
// 服务端按 `platform:trackId` 判「重复」→ 用户点了「+」没反应。
check(
  'id 不同但首个音源相同 → key 相同（跨平台合并后的关键）',
  playlistTrackKey({
    id: 'norm-a',
    sources: [{ platform: 'netease', trackId: 'T1' }],
  }) ===
    playlistTrackKey({
      id: 'norm-b',
      sources: [{ platform: 'netease', trackId: 'T1' }],
    }),
  true,
);

// ── 4. 只有第一个音源算数（第二个源不同不算另一首）──────
check(
  '只看 sources[0]：第二个源不同不影响 key',
  playlistTrackKey({
    id: 'x',
    sources: [
      { platform: 'qq', trackId: 'A' },
      { platform: 'netease', trackId: 'B' },
    ],
  }),
  'qq:A',
);

// ── 5. 平台不同 → 不同 key（不能把不同平台的同一 id 混为一首）
check(
  '平台不同 → key 不同',
  playlistTrackKey({ id: 'same', sources: [{ platform: 'qq', trackId: '9' }] }) ===
    playlistTrackKey({ id: 'same', sources: [{ platform: 'deezer', trackId: '9' }] }),
  false,
);

// ── 6. 真实平台集合下 key 不会把两首不同的歌撞在一起 ──────
// key 格式是 `${platform}:${trackId}`。理论上如果 platform 或 trackId 内部
// 出现冒号，两组 (platform, trackId) 可能撞出同一个字符串。
// 实际不会发生：platform 是**闭集**（下面 4 个值，都不含冒号），
// trackId 是各平台返回的 id（QQ musicmid / 网易云数字 / Spotify base62 /
// Deezer 数字），都不含冒号。这里用真实形态穷举，把这个前提**钉死**。
const REAL_PLATFORMS = ['qq', 'netease', 'deezer', 'spotify'];
const REAL_TRACK_IDS = ['003OUlho2HcRTP', '1901371647', '4cOdK2wGLETKBW3PvgPWqT', '0c6xIDDpzE5m'];

{
  const seen = new Map<string, string>();
  let collision = '';
  for (const p of REAL_PLATFORMS) {
    for (const t of REAL_TRACK_IDS) {
      const k = playlistTrackKey({ id: `${p}-${t}`, sources: [{ platform: p, trackId: t }] });
      const prev = seen.get(k);
      if (prev && prev !== `${p}:${t}`) {
        collision = `${prev} vs ${p}:${t}`;
      }
      seen.set(k, `${p}:${t}`);
    }
  }
  check('真实平台 × 真实 trackId：无碰撞', collision, '');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
