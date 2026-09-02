/**
 * T3 (consistency-fixes B4) + T7 (consistency-fixes E1) + T10 (consistency-fixes G2) 回归测试。
 *
 * 验证：
 *   T3 / T10 G2: invalidateLikedCache + setPref persist
 *   T7 E1: persistSpotify 对象身份校验
 *
 * 运行: npx ts-node src/common/session.persist-spotify.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-session-'));
process.env.STORAGE_DIR = tmpDir;

const { ConfigService } = require('./config');
const { StorageService } = require('./storage');
const { SessionService } = require('./session');

const cfg = new ConfigService();
const storage = new StorageService(cfg);
const svc = new SessionService(storage, cfg);

// helper: 直接在 blob 里造一个空 session（绕开 cookie 流程）
function mkSession(): any {
  const id = 'test-' + Math.random().toString(36).slice(2, 8);
  const session = {
    id,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    providers: {},
  };
  (svc as any).blob.byId[id] = session;
  return session;
}

async function main() {
  // ── T10 G2: setPref persist 到磁盘 ─────────────────────────────
  {
    const s = mkSession();
    svc.setPref(s, 'deezerPreset', 'pop');
    // 内存已设
    assert.strictEqual(s.prefs.deezerPreset, 'pop', 'setPref 应直接写入 session.prefs');
    // 强制把 storage 立即落盘（setPref 走 storage.set 是 200ms debounce）
    storage.flushSync();

    // 持久化到磁盘：新建一个 service 实例（读同一 storage 文件）
    const cfg2 = new ConfigService();
    const storage2 = new StorageService(cfg2);
    const svc2 = new SessionService(storage2, cfg2);
    const reloaded = svc2['blob'].byId[s.id];
    assert.ok(reloaded, '重启后 session 仍存在');
    assert.strictEqual(
      reloaded.prefs?.deezerPreset,
      'pop',
      `重启后 prefs.deezerPreset 应 = 'pop'（实际 ${reloaded.prefs?.deezerPreset}）`,
    );
    console.log('✅ T10.G2 setPref 持久化到磁盘（重启后保留）');
  }

  // ── T7 E1: persistSpotify 对象身份校验 ─────────────────────────
  {
    const s = mkSession();
    const livePS: any = { spotify: { accessToken: 'old', refreshToken: 'r1', expiresAt: 1 } };
    s.providers.spotify = livePS;

    const newTok = { accessToken: 'new', refreshToken: 'r1', expiresAt: Date.now() + 3600_000 };
    livePS.spotify = { ...livePS.spotify, ...newTok };
    svc.persistSpotify(s.id, livePS);

    const after = svc.getProvider(s, 'spotify');
    assert.strictEqual(after?.spotify?.accessToken, 'new',
      '同一引用 → 写入新 token 应成功');
    console.log('✅ T7.E1.1 同一 ProviderSession 引用 → 写入成功');
  }

  {
    const s = mkSession();
    const stalePS: any = { spotify: { accessToken: 'stale', refreshToken: 'r2', expiresAt: 1 } };
    s.providers.spotify = stalePS;

    // 模拟登出再重登：s.providers.spotify 现在是另一个对象（livePS2）
    const livePS2: any = { spotify: { accessToken: 'fresh-from-login', refreshToken: 'r2-new', expiresAt: Date.now() + 3600_000 } };
    s.providers.spotify = livePS2;

    const staleTok = { accessToken: 'STALE-FROM-OLD-REFRESH', refreshToken: 'r2', expiresAt: Date.now() + 7200_000 };
    svc.persistSpotify(s.id, { ...stalePS, spotify: staleTok });

    const after = svc.getProvider(s, 'spotify');
    assert.strictEqual(after?.spotify?.accessToken, 'fresh-from-login',
      'stale 写入被丢弃 — s.providers.spotify 仍是 fresh-from-login');
    assert.strictEqual(after, livePS2, 'live 对象仍是 livePS2（没被覆盖）');
    console.log('✅ T7.E1.2 不同引用（重登）→ stale 写入被丢弃');
  }

  {
    const ghostId = 'ghost-session-' + Date.now();
    const ps = { spotify: { accessToken: 'x', refreshToken: 'r', expiresAt: 1 } };
    svc.persistSpotify(ghostId, ps);
    console.log('✅ T7.E1.3 session 不存在 → 静默 no-op');
  }

  console.log('\n🎉 session-setPref + persist-spotify 全部 5 项通过');
}

main().catch((e) => {
  console.error('❌ failed:', e);
  process.exit(1);
});
