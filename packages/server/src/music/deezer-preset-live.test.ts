/**
 * Deezer preset 的**活写路径**持久化测试（2026-10-24 新增）。
 *
 * ## 为什么有這個文件
 *
 * 2026-10-24 删掉了死端点 `PUT /music/deezer/preset`（renderer 从不调它），
 * 随之删掉了 `deezer-preset.test.ts` —— 那个文件测的**全是死路径**，
 * 而且它后半段的 `setPref` 持久化断言在
 * `common/session.persist-spotify.test.ts` 里已经有了（重复覆盖）。
 *
 * 但删的时候发现一件更要紧的事：**活的那条写路径是坏的**。
 *
 * ## 活路径 vs 死路径
 *
 * renderer 切 Deezer 流派走的是 `GET /music/next?provider=deezer&preset=xxx`。
 * 那个路由在调 service **之前**把 preset 落到 `session.prefs`。
 *
 * 死端点当年修过这个 bug（consistency-fixes G2：「直接改 prefs 不 persist
 * → 重启丢 preset」→ 改走 `setPref`），**但活的那条路径当时漏了** ——
 * 它至今仍是直接改 `session.prefs`，**不排写入**。
 *
 * ## 症状（用户能看见的）
 *
 * 选完流派 → **App 被强杀**（sidecar 是 SIGKILL，Nest 的 `onModuleDestroy`
 * 不会跑 → 不会补一次 flush）→ 重启 → 流派回到默认。
 *
 * 正常退出（`onModuleDestroy` → `storage.set` + `flushSync`）会把整个 blob
 * 写出去，所以**优雅退出不丢** —— 正是这种"有时候丢有时候不丢"让它
 * 一直没人发现。
 *
 * ## 这个测试怎么抓
 *
 * 模拟「进程被强杀」：
 *   1. 先建 session 并 `flushSync()` → **磁盘上有一份没有 preset 的 session**
 *   2. 调 controller 的 `next()`（musicService 打桩 → 不打网络）
 *   3. **不调 flushSync**，只等 350ms（> storage 的 200ms 写盘 debounce）
 *      → 相当于进程在写盘定时器触发后被杀，**来不及补 flush**
 *   4. **新开**一套 StorageService/SessionService 从磁盘重新读
 *   5. 断言 `prefs.deezerPreset` 还在
 *
 * 改坏了（第 2 步不调 `setPref`）→ 第 4 步读出来是 `undefined` → **红** ✓
 *
 * 运行: npx ts-node src/music/deezer-preset-live.test.ts
 */
export {};
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-deezer-preset-live-'));
process.env.STORAGE_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-var-requires */
const { ConfigService } = require('../common/config');
const { StorageService } = require('../common/storage');
const { SessionService } = require('../common/session');
const { MusicController } = require('./music.controller');

/** storage 的写盘 debounce 是 200ms —— 等 350ms 保证定时器已经触发过。 */
const WRITE_DEBOUNCE_MS = 200;
const WAIT_AFTER_WRITE_MS = WRITE_DEBOUNCE_MS + 150;

/** 打桩的 musicService：`next()` 只用它换歌，这里不关心内容，也**不打网络**。 */
const fakeMusicService = {
  getNextTrack: async () => ({ id: 'stub-track', title: 'stub', artist: 'stub' }),
};

const mkReq = (sessionId?: string) =>
  ({ signedCookies: sessionId ? { mb_session: sessionId } : {} }) as any;

/** res 只需要 `cookie`（新建 session 时被调用）。 */
const mkRes = () => ({ cookie: () => {} }) as any;

async function main() {
  const cfg = new ConfigService();
  const storage = new StorageService(cfg);
  const svc = new SessionService(storage, cfg);
  const controller = new MusicController(
    fakeMusicService as any,
    {} as any,
    svc,
    {} as any,
    {} as any,
    {} as any,
  );

  try {
    // ── 0. 建一个 session，并把「没有 preset 的状态」写进磁盘 ──────
    let cookieId = '';
    const res0 = {
      cookie: (_name: string, value: string) => {
        cookieId = value;
      },
    } as any;
    const session = svc.resolve(mkReq(), res0);
    assert.ok(cookieId, 'resolve 应新建 session 并下发 cookie');
    assert.ok(session.id, 'session 应有 id');
    // 现在磁盘上有一份**没有** preset 的 session
    storage.flushSync();

    // ── 1. 活路径：GET /music/next?provider=deezer&preset=rock ──────
    await controller.next('deezer', 'rock', mkReq(cookieId), mkRes());

    // 内存里立刻能看到
    assert.strictEqual(
      (svc as any).blob.byId[cookieId].prefs?.deezerPreset,
      'rock',
      '调 next(preset=rock) 后内存里应是 rock',
    );
    console.log('✅ 1. next(provider=deezer, preset=rock) → 内存里 preset = rock');

    // ── 2. **不 flush**，只等写盘 debounce —— 模拟「进程被强杀」──────
    await new Promise((r) => setTimeout(r, WAIT_AFTER_WRITE_MS));

    // ── 3. 从磁盘重新读（模拟重启）────────────────────────────────
    const cfg2 = new ConfigService();
    const storage2 = new StorageService(cfg2);
    const svc2 = new SessionService(storage2, cfg2);
    const reloaded = (svc2 as any).blob.byId[cookieId];

    assert.ok(reloaded, '重启后 session 应还在（它本来就该持久化）');
    assert.strictEqual(
      reloaded.prefs?.deezerPreset,
      'rock',
      '⚠️ 强杀后重启，preset 丢了 —— 活路径没有走 setPref/persist（' +
        '这是 2026-10-24 修的那个 bug：直接改 session.prefs 不排写入）',
    );
    console.log('✅ 2. 强杀后重启 → preset 仍在（活路径确实排了写入）');

    // ── 4. 非 deezer 平台不该被写 preset ──────────────────────────
    {
      const before = (svc as any).blob.byId[cookieId].prefs?.deezerPreset;
      await controller.next('qq', 'jazz', mkReq(cookieId), mkRes());
      const after = (svc as any).blob.byId[cookieId].prefs?.deezerPreset;
      assert.strictEqual(
        after,
        before,
        '非 deezer 平台不该改 deezerPreset（否则 QQ 电台会被 Deezer 的流派污染）',
      );
      console.log('✅ 3. 非 deezer 平台不写 deezerPreset');
    }

    // ── 5. 连续切换 → 最后一个赢 ─────────────────────────────────
    {
      await controller.next('deezer', 'jazz', mkReq(cookieId), mkRes());
      await controller.next('deezer', 'classical', mkReq(cookieId), mkRes());
      assert.strictEqual(
        (svc as any).blob.byId[cookieId].prefs?.deezerPreset,
        'classical',
        '连续切换后应保留最后一个',
      );
      await new Promise((r) => setTimeout(r, WAIT_AFTER_WRITE_MS));
      const cfg3 = new ConfigService();
      const storage3 = new StorageService(cfg3);
      const svc3 = new SessionService(storage3, cfg3);
      assert.strictEqual(
        (svc3 as any).blob.byId[cookieId].prefs?.deezerPreset,
        'classical',
        '连续切换后重启也应是最后一个',
      );
      console.log('✅ 4. 连续切换 preset → 最后一个赢，且落盘');
    }

    console.log('\n🎉 deezer-preset-live.test 全部 4 项通过');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('❌ deezer-preset-live.test 失败:', e);
  process.exit(1);
});
