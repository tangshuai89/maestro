/**
 * placeholderCover 纯函数测试。
 * 运行: node --import ./src/lib/test-loader.mjs src/lib/placeholderCover.test.mjs
 *
 * 覆盖：
 *  - 确定性：同 seed → 同输出
 *  - 不同 seed → 不同输出
 *  - 空 seed → fallback 到 'maestro'（不崩溃）
 *  - background 是合法 CSS linear-gradient 字符串
 *  - accent 是合法 RGB triplet（0-255）
 *  - 多 seed 产生不同 hue（分布性）
 *  - hashSeed 隐式验证（通过输出稳定性）
 */
import { placeholderCover } from './placeholderCover.ts';

let passed = 0;
let failed = 0;
function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}
function fail(label, msg) {
  console.log(`❌ ${label}\n   ${msg}`);
  failed++;
}
function expect(label, cond, detail = '') {
  if (cond) ok(label);
  else fail(label, detail);
}

// ── 1. 确定性：同 seed → 同输出 ───────────────────────────────
{
  const a = placeholderCover('晴天·周杰伦');
  const b = placeholderCover('晴天·周杰伦');
  expect(
    '1. 同 seed → 同 background + accent',
    a.background === b.background &&
      a.accent[0] === b.accent[0] &&
      a.accent[1] === b.accent[1] &&
      a.accent[2] === b.accent[2],
  );
}

// ── 2. 不同 seed → 不同输出 ───────────────────────────────────
{
  const a = placeholderCover('晴天·周杰伦');
  const b = placeholderCover('稻香·周杰伦');
  expect(
    '2. 不同 seed → 不同 background',
    a.background !== b.background,
  );
}

// ── 3. 空 seed → 不崩溃 ───────────────────────────────────────
{
  const r = placeholderCover('');
  expect(
    '3. 空 seed → 不崩溃，返回合法对象',
    typeof r.background === 'string' &&
      Array.isArray(r.accent) &&
      r.accent.length === 3,
  );
}

// ── 4. background 是合法 CSS linear-gradient ─────────────────
{
  const r = placeholderCover('test');
  expect(
    '4. background 以 linear-gradient(135deg, 开头',
    r.background.startsWith('linear-gradient(135deg, '),
    r.background.slice(0, 40),
  );
  expect(
    '4b. background 以 100%) 结尾',
    r.background.endsWith(' 100%)'),
    r.background.slice(-10),
  );
}

// ── 5. accent 是合法 RGB triplet（0-255）─────────────────────
{
  const r = placeholderCover('test');
  const [r1, g1, b1] = r.accent;
  expect(
    '5. accent 三个分量都在 0-255',
    r1 >= 0 && r1 <= 255 && g1 >= 0 && g1 <= 255 && b1 >= 0 && b1 <= 255,
    `${r1},${g1},${b1}`,
  );
  expect(
    '5b. accent 分量是整数',
    Number.isInteger(r1) && Number.isInteger(g1) && Number.isInteger(b1),
  );
}

// ── 6. 多 seed 产生不同 hue（分布性）──────────────────────────
{
  const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const backgrounds = new Set(seeds.map((s) => placeholderCover(s).background));
  expect(
    '6. 8 个不同 seed → 至少 6 个不同 background',
    backgrounds.size >= 6,
    `实际 ${backgrounds.size} 个不同`,
  );
}

// ── 7. 特殊字符 seed 不崩溃 ───────────────────────────────────
{
  expect(
    '7. 特殊字符 seed（emoji/中文/符号）不崩溃',
    typeof placeholderCover('🎵测试<script>').background === 'string',
  );
}

// ── 8. 长 seed 不崩溃 ─────────────────────────────────────────
{
  const longSeed = 'x'.repeat(10000);
  expect(
    '8. 10K 字符 seed 不崩溃',
    typeof placeholderCover(longSeed).background === 'string',
  );
}

// ── 9. accent 与 gradient 第一 stop 一致 ──────────────────────
{
  const r = placeholderCover('test-song');
  // background 格式: linear-gradient(135deg, rgb(R, G, B) 0%, ...
  const match = r.background.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  expect(
    '9. gradient 第一个 rgb() 与 accent 一致',
    match &&
      Number(match[1]) === r.accent[0] &&
      Number(match[2]) === r.accent[1] &&
      Number(match[3]) === r.accent[2],
    `gradient=${match?.[0]} accent=${r.accent.join(',')}`,
  );
}

// ── 10. 空 seed 和 'maestro' 产生相同结果 ─────────────────────
{
  const empty = placeholderCover('');
  const maestro = placeholderCover('maestro');
  expect(
    "10. 空 seed fallback 到 'maestro'",
    empty.background === maestro.background,
    `empty=${empty.background.slice(0, 30)} maestro=${maestro.background.slice(0, 30)}`,
  );
}

console.log(`\n🎉 placeholderCover.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
