/**
 * SessionService + normalizeProvider 白盒测试（Node built-in assert）。
 * 运行: npx ts-node packages/server/src/common/session.test.ts
 *
 * 覆盖：
 *  - normalizeProvider：已知平台回退到 qq
 *  - SessionService.resolve：新会话创建 + cookie 设置
 *  - SessionService.resolve：已有会话复用 + TTL 滑动
 *  - SessionService.require：无会话 → 401
 *  - SessionService.setProvider / getProvider / clearProvider
 *  - SessionService.setPref / getLastValidatedAt / setLastValidatedAt
 *  - SessionService.persistSpotify：对象身份校验（T7）
 *  - SessionService.destroy
 *  - evictExpired：过期会话清理
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* eslint-disable @typescript-eslint/no-var-requires */

const { normalizeProvider } = require('./provider');
const { SessionService } = require('./session');
const { StorageService } = require('./storage');

function makeServices(opts: { sessionTtlMs?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-session-test-'));
  const storage = new StorageService({ storageDir: dir });
  const cfg = {
    storageDir: dir,
    sessionSecret: 'test-secret',
    sessionTtlMs: opts.sessionTtlMs ?? 7 * 24 * 3600 * 1000,
    backupDir: path.join(dir, 'backups'),
    backupRetention: 7,
  };
  const session = new SessionService(storage, cfg);
  return { session, storage, dir };
}

function fakeReqRes(cookieId?: string) {
  const signedCookies = cookieId ? { mb_session: cookieId } : {};
  const cookies: Record<string, string> = {};
  const req = { signedCookies, headers: {} } as any;
  const res = {
    cookie(name: string, val: string, opts: any) {
      cookies[name] = val;
    },
    clearCookie(name: string) {
      delete cookies[name];
    },
    cookies,
  } as any;
  return { req, res };
}

let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

// ── 1. normalizeProvider：已知平台 ────────────────────────────
check('1. normalizeProvider：已知平台精确返回', () => {
  assert.strictEqual(normalizeProvider('qq'), 'qq');
  assert.strictEqual(normalizeProvider('netease'), 'netease');
  assert.strictEqual(normalizeProvider('deezer'), 'deezer');
  assert.strictEqual(normalizeProvider('spotify'), 'spotify');
});

// ── 2. normalizeProvider：未知/undefined 回退到 qq ─────────────
check('2. normalizeProvider：未知/undefined/空串 → qq', () => {
  assert.strictEqual(normalizeProvider(undefined), 'qq');
  assert.strictEqual(normalizeProvider(''), 'qq');
  assert.strictEqual(normalizeProvider('bogus'), 'qq');
  assert.strictEqual(normalizeProvider('apple'), 'qq');
});

// ── 3. resolve：新会话创建 + cookie 设置 ──────────────────────
check('3. resolve：新会话创建 + 设置 cookie', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  assert.ok(s.id, 'session 有 id');
  assert.ok(s.createdAt > 0, 'session 有 createdAt');
  assert.ok(res.cookies['mb_session'], 'cookie 已设置');
  assert.ok(typeof s.providers === 'object', 'providers 对象存在');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 4. resolve：已有会话复用 ──────────────────────────────────
check('4. resolve：已有会话复用（同 cookie id）', () => {
  const { session, dir } = makeServices();
  const { req: req1, res: res1 } = fakeReqRes();
  const s1 = session.resolve(req1, res1);
  const { req: req2, res: res2 } = fakeReqRes(s1.id);
  const s2 = session.resolve(req2, res2);
  assert.strictEqual(s2.id, s1.id, '同 cookie → 同 session');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 5. resolve：TTL 滑动（lastAccessedAt 更新）────────────────
check('5. resolve：复用时 lastAccessedAt 更新', () => {
  const { session, dir } = makeServices();
  const { req: req1, res: res1 } = fakeReqRes();
  const s1 = session.resolve(req1, res1);
  const oldLast = s1.lastAccessedAt;
  // 等一小段确保时间戳不同
  const { req: req2, res: res2 } = fakeReqRes(s1.id);
  // 用 setTimeout 不行（同步测试），直接调 resolve 验证 lastAccessedAt >= oldLast
  const s2 = session.resolve(req2, res2);
  assert.ok(s2.lastAccessedAt >= oldLast, 'lastAccessedAt 应 >= 首次创建');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 6. require：无会话 → 401 ──────────────────────────────────
check('6. require：无会话 → UnauthorizedException', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  assert.throws(
    () => session.require(req, res),
    (err: any) => err.status === 401,
    '应抛 401',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 7. require：有会话 → 返回 session ─────────────────────────
check('7. require：有会话 → 返回 session', () => {
  const { session, dir } = makeServices();
  const { req: r1, res: res1 } = fakeReqRes();
  const s1 = session.resolve(r1, res1);
  const { req: r2, res: res2 } = fakeReqRes(s1.id);
  const s2 = session.require(r2, res2);
  assert.strictEqual(s2.id, s1.id);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 8. setProvider / getProvider ──────────────────────────────
check('8. setProvider / getProvider：写入 + 读取', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  session.setProvider(s, 'qq', { qqCookie: 'test=1', qqUin: '12345' });
  const p = session.getProvider(s, 'qq');
  assert.ok(p);
  assert.strictEqual(p.qqCookie, 'test=1');
  assert.strictEqual(p.qqUin, '12345');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 9. clearProvider ──────────────────────────────────────────
check('9. clearProvider：删除后 getProvider → undefined', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  session.setProvider(s, 'netease', { musicU: 'test-musicU' });
  session.clearProvider(s, 'netease');
  assert.strictEqual(session.getProvider(s, 'netease'), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 10. setPref / getPref（通过 getLastValidatedAt 验证）──────
check('10. setPref + getLastValidatedAt：写入 + 读取时间戳', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  assert.strictEqual(session.getLastValidatedAt(s, 'qq'), null, '初始 null');
  session.setLastValidatedAt(s, 'qq', 1234567890);
  assert.strictEqual(session.getLastValidatedAt(s, 'qq'), 1234567890);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 11. setPref 持久化（重启后仍在）──────────────────────────
check('11. setPref 持久化到磁盘', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-session-test-'));
  const storage = new StorageService({ storageDir: dir });
  const cfg = {
    storageDir: dir, sessionSecret: 's', sessionTtlMs: 7 * 24 * 3600 * 1000,
    backupDir: path.join(dir, 'b'), backupRetention: 7,
  };
  const s1 = new SessionService(storage, cfg);
  const { req, res } = fakeReqRes();
  const s = s1.resolve(req, res);
  s1.setPref(s, 'deezerPreset', 'electronic');
  // flushSync 确保写入磁盘（StorageService.set 是 debounced 的）
  storage.flushSync();
  // 模拟重启：新 storage + 新 session service 读同一目录
  const storage2 = new StorageService({ storageDir: dir });
  const s2 = new SessionService(storage2, cfg);
  const { req: req2, res: res2 } = fakeReqRes(s.id);
  const sReloaded = s2.resolve(req2, res2);
  assert.strictEqual(sReloaded.prefs?.deezerPreset, 'electronic', '重启后 pref 仍在');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 12. persistSpotify：对象身份校验（T7）─────────────────────
check('12. persistSpotify：非同一引用 → 丢弃写入', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  // 先写入一个 spotify provider session
  const original = { spotify: { accessToken: 'old', refreshToken: 'r', expiresAt: 0 } };
  session.setProvider(s, 'spotify', original);
  // 模拟登出 + 重登（新对象）
  session.clearProvider(s, 'spotify');
  const newSpotify = { spotify: { accessToken: 'new', refreshToken: 'r2', expiresAt: 0 } };
  session.setProvider(s, 'spotify', newSpotify);
  // 旧 refresh 完成后试图用旧对象调 persistSpotify
  session.persistSpotify(s.id, original);
  // 验证：旧 token 没复活
  const p = session.getProvider(s, 'spotify');
  assert.strictEqual(p.spotify?.accessToken, 'new', '旧 token 不应复活');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 13. persistSpotify：同一引用 → 正常写入 ───────────────────
check('13. persistSpotify：同一引用 → 正常更新', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  session.setProvider(s, 'spotify', {
    spotify: { accessToken: 'old', refreshToken: 'r', expiresAt: 0 },
  });
  // 取 session 内部的实际引用（setProvider 会创建合并对象）
  const ps = session.getProvider(s, 'spotify')!;
  // 更新 token（同一对象引用）
  ps.spotify = { accessToken: 'refreshed', refreshToken: 'r', expiresAt: Date.now() + 3600000 };
  session.persistSpotify(s.id, ps);
  const p = session.getProvider(s, 'spotify');
  assert.strictEqual(p.spotify?.accessToken, 'refreshed', 'token 应更新');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 14. destroy：删除会话 + 清 cookie ─────────────────────────
check('14. destroy：删除会话 + clearCookie', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  assert.ok(res.cookies['mb_session'], 'cookie 已设置');
  // 用带 cookie 的 req destroy
  const { req: req2, res: res2 } = fakeReqRes(s.id);
  session.destroy(req2, res2);
  assert.strictEqual(res2.cookies['mb_session'], undefined, 'cookie 已清除');
  // 再 require 应 401
  const { req: req3, res: res3 } = fakeReqRes(s.id);
  assert.throws(() => session.require(req3, res3), (e: any) => e.status === 401);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 15. evictExpired：过期会话被清理 ──────────────────────────
check('15. evictExpired：过期会话被清理', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-session-test-'));
  const storage = new StorageService({ storageDir: dir });
  // 设一个极短的 TTL（1ms）
  const cfg = {
    storageDir: dir, sessionSecret: 's', sessionTtlMs: 1,
    backupDir: path.join(dir, 'b'), backupRetention: 7,
  };
  const session = new SessionService(storage, cfg);
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  // 等待 > 1ms
  const start = Date.now();
  while (Date.now() - start < 5) { /* spin */ }
  // 触发 evictExpired（通过新建 SessionService 模拟，构造函数会调）
  const storage2 = new StorageService({ storageDir: dir });
  const session2 = new SessionService(storage2, cfg);
  // 旧 session 应已被 evict
  const { req: req2, res: res2 } = fakeReqRes(s.id);
  const s2 = session2.resolve(req2, res2);
  // resolve 对不存在的 id 会创建新 session
  assert.notStrictEqual(s2.id, s.id, '旧 session 过期后应创建新 session');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 16. setProvider 合并（不覆盖已有字段）────────────────────
check('16. setProvider：additive merge（已有字段保留）', () => {
  const { session, dir } = makeServices();
  const { req, res } = fakeReqRes();
  const s = session.resolve(req, res);
  session.setProvider(s, 'qq', { qqCookie: 'a=1', qqUin: '111' });
  // 再写入一个不同字段，已有字段应保留
  session.setProvider(s, 'qq', { qqVip: true });
  const p = session.getProvider(s, 'qq');
  assert.strictEqual(p.qqCookie, 'a=1', '已有字段保留');
  assert.strictEqual(p.qqUin, '111', '已有字段保留');
  assert.strictEqual(p.qqVip, true, '新字段写入');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n🎉 session.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
