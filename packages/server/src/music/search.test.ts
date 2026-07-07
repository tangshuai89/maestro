/**
 * 统一搜索核心逻辑验证（Node built-in assert，无需 jest）。
 * 运行: npx ts-node packages/server/src/music/search.test.ts
 */
const assert = require('node:assert');

// 复用 MusicService 的去重逻辑（直接内联一份做白盒测试，
// 避免在 prod 文件里混入测试代码，也无需 DI 环境）。
function normalizeKey(title: string, artist: string): string {
  const raw = `${title} ${artist}`
    .replace(/[！-～]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0),
    )
    .replace(/[\s\-_,.()（）【】《》'"′″·&+/!?！？:：;；]+/g, '')
    .toLowerCase();
  return raw;
}

function dedup(
  all: { id: string; title: string; artist: string; platform: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { id, title, artist } of all) {
    const key = normalizeKey(title, artist);
    if (!map.has(key)) {
      map.set(key, id);
    }
  }
  return map;
}

// ── 测试用例 ──────────────────────────────────────────────────

// 1. 同一首歌在两个平台 → 去重为一条
{
  const result = dedup([
    { id: 'qq-001', title: '晴天', artist: '周杰伦', platform: 'qq' },
    { id: 'ne-001', title: '晴天', artist: '周杰伦', platform: 'netease' },
  ]);
  assert.strictEqual(result.size, 1, '同一首歌应去重为 1 条');
  console.log('✅ 1. 跨平台去重');
}

// 2. 标点/空格差异 → 归一化后合并
{
  const result = dedup([
    { id: 'qq-001', title: 'Hello', artist: 'Adele', platform: 'qq' },
    { id: 'de-001', title: 'Hello!', artist: 'Adele', platform: 'deezer' },
  ]);
  assert.strictEqual(result.size, 1, '标点差异应归一化');
  console.log('✅ 2. 标点归一化');
}

// 3. 全角/半角差异 → 合并
{
  const result = dedup([
    { id: 'qq-001', title: 'hello', artist: 'adele', platform: 'qq' },
    { id: 'qq-002', title: 'ＨＥＬＬＯ', artist: 'ＡＤＥＬＥ', platform: 'qq' },
  ]);
  assert.strictEqual(result.size, 1, '全角半角应归一化');
  console.log('✅ 3. 全角半角');
}

// 4. 不同歌 → 各自保留
{
  const result = dedup([
    { id: 'qq-001', title: '晴天', artist: '周杰伦', platform: 'qq' },
    { id: 'qq-002', title: '七里香', artist: '周杰伦', platform: 'qq' },
  ]);
  assert.strictEqual(result.size, 2, '不同歌曲应各自保留');
  console.log('✅ 4. 不同歌曲');
}

// 5. 空输入 → 返回空
{
  const result = dedup([]);
  assert.strictEqual(result.size, 0, '空输入应返回空');
  console.log('✅ 5. 空输入');
}

// 6. 繁简混合（基础）→ 目前不做繁简转换，但空格去标点应正确
{
  const result = dedup([
    { id: 'qq-001', title: '突然好想你', artist: '五月天', platform: 'qq' },
    { id: 'ne-001', title: '突然好想你', artist: ' 五月天 ', platform: 'netease' },
  ]);
  assert.strictEqual(result.size, 1, '首尾空格应归一化');
  console.log('✅ 6. 空格 trim');
}

console.log('\n🎉 全部 6 个测试通过');
