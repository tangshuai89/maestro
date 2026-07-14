/**
 * StorageService.mergeFrom 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/common/storage.test.ts
 *
 * 核心不变量：导入一份快照 **绝不** 抹掉本地已有的红心 / 登录态。
 */
export {}; // 顶层 const 不与其他 .test.ts 冲突
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { StorageService } = require('./storage');

// 每次用一个空的临时 storageDir，避免读到真实 state.json。
function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-storage-test-'));
  const fakeCfg = { storageDir: dir };
  return new StorageService(fakeCfg);
}

// ── 1. 未知 key：仅在缺失时写入 ─────────────────────────────
{
  const svc = makeService();
  svc.set('theme-ish', 'local-value');
  svc.mergeFrom({ 'theme-ish': 'imported', 'new-key': 'imported-new' });
  assert.strictEqual(svc.get('theme-ish'), 'local-value', '已有 key 不被覆盖');
  assert.strictEqual(svc.get('new-key'), 'imported-new', '缺失 key 从导入写入');
  console.log('✅ 1. 未知 key：已有不覆盖、缺失补入');
}

// ── 2. secrets:* 仅补缺，不覆盖 ────────────────────────────
{
  const svc = makeService();
  svc.set('secrets:deepseek', { apiKey: 'local-key' });
  svc.mergeFrom({
    'secrets:deepseek': { apiKey: 'imported-key' },
    'secrets:spotify-client-id': { clientId: 'imported-cid' },
  });
  assert.deepStrictEqual(
    svc.get('secrets:deepseek'),
    { apiKey: 'local-key' },
    '已有 secret 不被导入覆盖',
  );
  assert.deepStrictEqual(
    svc.get('secrets:spotify-client-id'),
    { clientId: 'imported-cid' },
    '缺失 secret 从导入补入',
  );
  console.log('✅ 2. secrets:* 仅补缺不覆盖');
}

// ── 3. music:* liked/disliked 并集，不丢已有红心 ────────────
{
  const svc = makeService();
  svc.set('music:sess1', {
    providers: {
      qq: { queue: [{ id: 'q1' }], liked: ['a', 'b'], disliked: ['x'] },
    },
    fanOut: { m1: [{ platform: 'qq', trackId: 'a' }] },
  });
  svc.mergeFrom({
    'music:sess1': {
      providers: {
        qq: { queue: [{ id: 'OLD' }], liked: ['b', 'c'], disliked: ['y'] },
        netease: { queue: [], liked: ['n1'], disliked: [] },
      },
      fanOut: {
        m1: [
          { platform: 'qq', trackId: 'a' }, // 重复 → 去重
          { platform: 'netease', trackId: 'a' }, // 新 → 追加
        ],
        m2: [{ platform: 'qq', trackId: 'z' }],
      },
    },
  });
  const merged = svc.get('music:sess1');
  // liked 是并集
  assert.deepStrictEqual(
    [...merged.providers.qq.liked].sort(),
    ['a', 'b', 'c'],
    'qq.liked 应是本地+导入的并集（不丢 a）',
  );
  assert.deepStrictEqual(
    [...merged.providers.qq.disliked].sort(),
    ['x', 'y'],
    'qq.disliked 并集',
  );
  // 本地 queue 保留（不被导入的 OLD 覆盖）
  assert.deepStrictEqual(
    merged.providers.qq.queue,
    [{ id: 'q1' }],
    '本地 queue 保留，不被导入覆盖',
  );
  // 新 provider 直接带入
  assert.deepStrictEqual(
    merged.providers.netease.liked,
    ['n1'],
    '导入里的新 provider（netease）带入',
  );
  // fanOut 去重 + 追加
  assert.strictEqual(merged.fanOut.m1.length, 2, 'm1 fanOut 去重后 2 条');
  assert.deepStrictEqual(
    merged.fanOut.m2,
    [{ platform: 'qq', trackId: 'z' }],
    'm2 新 fanOut 带入',
  );
  console.log('✅ 3. music:* liked/disliked/fanOut 并集，queue 本地优先');
}

// ── 4. sessions：本地 id 不被覆盖，新 id 带入 ───────────────
{
  const svc = makeService();
  svc.set('sessions', {
    byId: { s1: { id: 's1', providers: { qq: { qqCookie: 'LOCAL' } } } },
  });
  svc.mergeFrom({
    sessions: {
      byId: {
        s1: { id: 's1', providers: { qq: { qqCookie: 'IMPORTED' } } },
        s2: { id: 's2', providers: { netease: { musicU: 'IMPORTED-U' } } },
      },
    },
  });
  const sessions = svc.get('sessions');
  assert.strictEqual(
    sessions.byId.s1.providers.qq.qqCookie,
    'LOCAL',
    '本地 session id 不被导入覆盖',
  );
  assert.strictEqual(
    sessions.byId.s2.providers.netease.musicU,
    'IMPORTED-U',
    '导入的新 session id 带入',
  );
  console.log('✅ 4. sessions：本地 id 保留、新 id 带入');
}

// ── 5. library:* items 按 id 并集 ─────────────────────────
{
  const svc = makeService();
  svc.set('library:sess1', {
    importedAt: 1,
    items: [{ id: 'i1' }, { id: 'i2' }],
    sources: [],
  });
  svc.mergeFrom({
    'library:sess1': {
      importedAt: 2,
      items: [{ id: 'i2' }, { id: 'i3' }],
      sources: [],
    },
  });
  const lib = svc.get('library:sess1');
  assert.deepStrictEqual(
    lib.items.map((i: { id: string }) => i.id).sort(),
    ['i1', 'i2', 'i3'],
    'library items 按 id 并集（不丢 i1）',
  );
  console.log('✅ 5. library:* items 按 id 并集');
}

// ── 6. mergeFrom 返回被触碰的 key 列表 ─────────────────────
{
  const svc = makeService();
  svc.set('secrets:deepseek', { apiKey: 'x' }); // 已存在 → 不触碰
  const touched = svc.mergeFrom({
    'secrets:deepseek': { apiKey: 'y' }, // skip
    'new-thing': 1, // touched
  });
  assert.deepStrictEqual(touched, ['new-thing'], '只返回真正写入的 key');
  console.log('✅ 6. mergeFrom 返回被触碰的 key');
}

console.log('\n🎉 全部 6 个测试通过');
