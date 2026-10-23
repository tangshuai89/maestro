/**
 * 「偶发内部异常不许变成 500」的回归测试（2026-10-23）。
 *
 * ## 背景
 *
 * 用户报：**搜索歌曲时偶尔出现 POST 500**。查下来不是搜索路径本身坏了
 * （那个有大改的 diff + 测试背书），而是**搜索路径上两个 POST 端点没有
 * 错误隔离**：
 *
 *   - `POST /music/like/detect` → `detectLikedAndSync` —— 内部任何一次偶发
 *     异常（存储写、锁竞争、provider 抖动）冒到 controller 就变成 500。
 *   - `POST /music/track/likeCount` → 直接调 provider，**连 try/catch 都没有**。
 *
 * 500 的代价不是"报错"这么轻：前端会把这次 detect 当成"探测失败"→ 角标
 * 一直不亮，而且**看不出**是哪层坏了。
 *
 * ## 本文件钉住的三条
 *
 *   A. `POST /music/track/likeCount`：provider 抛异常 → **2xx + null**，
 *      不是 500。
 *   B. `detectLikedAndSync`：**绝不 throw** —— 内部抛异常时降级成
 *      `{liked:false, fannedOutTo:[], settled:false}`（前端已有的「中间态」
 *      语义 → 继续轮询、且**不会**把真实红心抹掉）。
 *   C. storage 的写是**原子**的：写到一半失败 → 旧文件**完好无损**
 *      （原地覆盖写会把文件截断 → 下次启动整个状态被清空）。
 *
 * 不打真实网络：provider 方法全部打桩。
 * 运行: npx ts-node src/music/server-degrade.e2e.test.ts
 */
export {};
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

/* eslint-disable @typescript-eslint/no-var-requires */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-degrade-'));
process.env.STORAGE_DIR = tmpDir;
delete process.env.MAESTRO_INTERNAL_TOKEN;

let passed = 0;
let failed = 0;
async function check(label: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${label}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${label}\n   ${(err as Error).message}`);
    failed++;
  }
}

async function main() {
  // ═══ A. POST /music/track/likeCount：provider 抛异常 → 2xx + null ═══
  {
    const { NestFactory } = require('@nestjs/core');
    const cookieParser = require('cookie-parser');
    const { AppModule } = require('../app.module');
    const {
      InProcessClient,
      getRequestHandlerFromNestApp,
    } = require('../test-helpers/in-process-http');
    const { QqMusicProvider } = require('./qq.provider');
    const { NeteaseMusicProvider } = require('./netease.provider');

    const app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser('test-secret'));
    await app.init();
    const client = new InProcessClient(getRequestHandlerFromNestApp(app));

    const qqProvider: any = app.get(QqMusicProvider);
    const neteaseProvider: any = app.get(NeteaseMusicProvider);

    // provider 抛异常 —— 模拟「平台偶发失败」（风控/网络抖动/形状不兼容）
    qqProvider.getTrackFavCount = async () => {
      throw new Error('QQ 平台炸了');
    };
    neteaseProvider.getTrackLikeCount = async () => {
      throw new Error('网易云平台炸了');
    };

    await check('A1. likeCount（qq）：provider 抛异常 → 不是 500', async () => {
      const res = await client.call('POST', '/music/track/likeCount', {
        platform: 'qq',
        trackId: 'x-1',
      });
      assert.ok(
        res.status < 500,
        `期望 <500，实际 ${res.status}（body=${JSON.stringify(res.body ?? null).slice(0, 200)}）`,
      );
      assert.strictEqual(res.status, 201, `期望 201，实际 ${res.status}`);
    });

    await check('A2. likeCount（netease）：provider 抛异常 → 2xx + null', async () => {
      const res = await client.call('POST', '/music/track/likeCount', {
        platform: 'netease',
        trackId: 'x-1',
      });
      assert.ok(res.status < 500, `期望 <500，实际 ${res.status}`);
      assert.strictEqual(res.status, 201, `期望 201，实际 ${res.status}`);
      assert.strictEqual(res.body ?? null, null, `期望 null，实际 ${JSON.stringify(res.body)}`);
    });

    await check('A3. likeCount（spotify）：不认识的平台 → 2xx + null', async () => {
      const res = await client.call('POST', '/music/track/likeCount', {
        platform: 'spotify',
        trackId: 'x-1',
      });
      assert.ok(res.status < 500, `期望 <500，实际 ${res.status}`);
      assert.strictEqual(res.status, 201, `期望 201，实际 ${res.status}`);
    });

    await app.close();
  }

  // ═══ B. detectLikedAndSync：绝不 throw ═══
  {
    const { MusicService } = require('./music.service');

    // 造一个「内部必然炸」的 service：存储读抛异常 + provider 说这首已红心
    // （→ 走到写段 → loadState → 存储读 → 抛）。
    const explodingStorage: any = {
      get: () => {
        throw new Error('存储读炸了');
      },
      set: () => {},
      delete: () => {},
    };
    const qq: any = {
      fetchLikedMidSet: async () => new Set<string>(['t-1']),
    };
    const noop: any = {};
    const svc = new MusicService(
      explodingStorage,
      qq,
      noop,
      noop,
      noop,
      noop,
      {} as any,
      {} as any,
      { registerProcessor: () => {}, registerDiscoverResolver: () => {}, enqueue: () => {} } as any,
    );

    const session: any = {
      id: 'sess-1',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      providers: { qq: { qqCookie: 'cookie' } },
    };

    await check('B1. detectLikedAndSync：内部抛异常 → **不 reject**', async () => {
      let result: any;
      let threw: unknown = null;
      try {
        result = await svc.detectLikedAndSync(
          session,
          'merged-qq-t-1-studio',
          [{ platform: 'qq', trackId: 't-1' }],
        );
      } catch (err) {
        threw = err;
      }
      assert.strictEqual(
        threw,
        null,
        `契约是「绝不 throw」，实际抛了：${(threw as Error)?.message}`,
      );
    });

    await check('B2. detectLikedAndSync：降级形状 = 未落定（settled:false）', async () => {
      const res = await svc.detectLikedAndSync(
        session,
        'merged-qq-t-1-studio',
        [{ platform: 'qq', trackId: 't-1' }],
      );
      assert.deepStrictEqual(
        res,
        { liked: false, fannedOutTo: [], settled: false },
        `降级形状不对：${JSON.stringify(res)}`,
      );
      assert.strictEqual(
        res.settled,
        false,
        '⚠️ settled 必须是 false —— settled:true + liked:false 会被前端当成「确认没红心」→ 把真实红心抹掉',
      );
    });
  }

  // ═══ C. storage 的写是原子的 ═══
  {
    const { StorageService } = require('../common/storage');

    await check('C1. 写完之后：文件是合法 JSON + 没有残留 .tmp', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-storage-'));
      const svc = new StorageService({ storageDir: dir } as any);
      svc.set('k1', { a: 1 });
      (svc as any).writeLocked();
      const file = path.join(dir, 'state.json');
      assert.ok(fs.existsSync(file), 'state.json 不存在');
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepStrictEqual(parsed['k1'], { a: 1 });
      assert.ok(
        !fs.existsSync(`${file}.tmp`),
        '残留了 .tmp 文件（写失败的路径没清理干净）',
      );
    });

    await check('C2. 写失败 → **旧文件完好无损**（原子写的核心性质）', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-storage-'));
      const file = path.join(dir, 'state.json');
      // 先落一份「旧内容」
      fs.writeFileSync(file, JSON.stringify({ old: true }, null, 2));

      const svc = new StorageService({ storageDir: dir } as any);
      svc.set('new', { b: 2 });

      // 让写失败 —— 必须模拟**真实形态**：writeFileSync 是 'w' 模式，**先截断
      // 再写**；磁盘满 / EIO 发生在写的中途 → 文件停在半截。
      // ⚠️ 只「抛异常而不截断」是**模拟错了**：那样连原地覆盖写都测不出区别
      //   （原地写也会「什么都没发生」→ 旧文件完好 → 用例假绿）。
      const realWrite = fs.writeFileSync;
      (fs as any).writeFileSync = (p: any, _data: any) => {
        realWrite(p, ''); // 截断（writeFileSync 'w' 模式的第一件事）
        throw new Error('磁盘满了');
      };
      let threw = false;
      try {
        (svc as any).writeLocked();
      } catch {
        threw = true;
      } finally {
        (fs as any).writeFileSync = realWrite;
      }
      assert.ok(threw, '写失败时应该把异常抛出来（不能吞）');

      // 关键断言：旧文件**没有被截断**，还是合法 JSON
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      assert.deepStrictEqual(
        parsed,
        { old: true },
        `旧文件被破坏了：${raw.slice(0, 200)}`,
      );
      assert.ok(
        !fs.existsSync(`${file}.tmp`),
        '写失败后残留了 .tmp 文件',
      );
    });

    await check('C4. chmod 失败 → **写照常成功**（best-effort，不阻塞）', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-storage-'));
      const svc = new StorageService({ storageDir: dir } as any);
      svc.set('k1', { a: 1 });

      const realChmod = fs.chmodSync;
      (fs as any).chmodSync = () => {
        throw new Error('只读盘');
      };
      let threw = false;
      try {
        (svc as any).writeLocked();
      } catch {
        threw = true;
      } finally {
        (fs as any).chmodSync = realChmod;
      }
      assert.ok(!threw, 'chmod 失败**不该**让整次写失败（Windows/只读盘上是 best-effort）');
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      assert.deepStrictEqual(parsed['k1'], { a: 1 }, '写应该已经落盘');
    });

    await check('C5. 清理也失败（unlink 抛）→ 抛的仍是**原始**错误', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-storage-'));
      const svc = new StorageService({ storageDir: dir } as any);
      svc.set('k1', 1);

      const realWrite = fs.writeFileSync;
      const realUnlink = fs.unlinkSync;
      (fs as any).writeFileSync = (p: any, _d: any) => {
        realWrite(p, '');
        throw new Error('原始错误：磁盘满了');
      };
      (fs as any).unlinkSync = () => {
        throw new Error('清理错误：unlink 失败');
      };
      let caught: any = null;
      try {
        (svc as any).writeLocked();
      } catch (err) {
        caught = err;
      } finally {
        (fs as any).writeFileSync = realWrite;
        (fs as any).unlinkSync = realUnlink;
      }
      assert.ok(caught, '写失败时应该抛异常');
      assert.strictEqual(
        (caught as Error).message,
        '原始错误：磁盘满了',
        `抛出来的应该是**原始**写错误，不是清理错误：${(caught as Error).message}`,
      );
    });

    await check('C3. 文件权限是 0600（原子写后仍然收紧）', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-storage-'));
      const svc = new StorageService({ storageDir: dir } as any);
      svc.set('k1', 1);
      (svc as any).writeLocked();
      const mode = fs.statSync(path.join(dir, 'state.json')).mode & 0o777;
      assert.strictEqual(mode.toString(8), '600', `期望 600，实际 ${mode.toString(8)}`);
    });
  }

  console.log('');
  if (failed > 0) {
    console.error(`❌ ${failed} 项失败`);
    process.exit(1);
  }
  console.log(`🎉 server-degrade: ${passed} passed, 0 failed`);
}

main().catch((err) => {
  console.error('测试自身崩了:', err);
  process.exit(1);
});
