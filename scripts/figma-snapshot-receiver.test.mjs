#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// AETHER 快照接收器 —— **反向验证**（真起 HTTP、真落盘）
//
// 为什么必须测：接收器是「采集 → 落盘」这条链的**最后一环**，
//   它的失败表现是**静默的**：快照没更新 ⇒ `figma:diff` 读的是旧数据
//   ⇒ 结论全错，而**现场看不出任何异常**（门禁照样绿）。
//   ⇒ 必须证明三件事：
//     ① 好数据能落盘，且落盘内容是**仓库统一格式**（prettier）——
//        否则 pre-commit 钩子会再改写一遍 ⇒ 脏 diff。
//     ② 脏数据**不许**落盘（否则一份坏快照能把仓库里那份好快照毁掉）。
//     ③ 半路失败不留半个坏文件（原子落盘）。
//
// 用法：node scripts/figma-snapshot-receiver.test.mjs
// ─────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReceiver,
  validateSnapshot,
  formatSnapshot,
  isLoopback,
  SNAPSHOT_REL,
} from './figma-snapshot-receiver.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 一份**合规**的快照（字段与采集插件产出的同构）。 */
function validSnapshot() {
  return {
    capturedAt: '2026-10-30T15:04:05+08:00',
    fileKey: 'FtbRZXvzlCp4Sq9e322cQQ',
    pages: ['02 · Components', '03 · Screens'],
    components: [
      {
        name: 'Hologram/Cover',
        nodeId: '257:174',
        type: 'COMPONENT_SET',
        variants: ['state=idle'],
        contract: '',
        hasDescription: true,
        hasContract: false,
        descriptionPreview: 'Holographic cover area 480×500.',
      },
    ],
    screens: [
      {
        name: 'Screen/Search',
        nodeId: '365:1008',
        type: 'FRAME',
        contract: '',
        hasDescription: false,
        hasContract: false,
        descriptionPreview: '',
      },
    ],
    motion: {
      spec: [{ id: 'btn-play-hover', category: 'interaction', component: 'Core/Play' }],
      version: '1.0',
      rawLength: 6287,
    },
    counts: { components: 1, screens: 1, motionEntries: 1 },
  };
}

/** 起一个接收器（随机端口 + 临时落盘目录），跑 fn，最后收摊。 */
async function withReceiver(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'aether-snapshot-'));
  const target = join(dir, 'figma-snapshot.json');
  const recv = createReceiver({ port: 0, target, log: () => {} });
  await new Promise((r) => recv.server.listen(0, r));
  const port = recv.server.address().port;
  try {
    await fn({ port, target, dir });
  } finally {
    await new Promise((r) => recv.server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

const post = (port, body) =>
  fetch(`http://localhost:${port}/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('AETHER 快照接收器 · 校验（纯函数）', () => {
  it('合规快照 ⇒ 零错误', () => {
    assert.deepEqual(validateSnapshot(validSnapshot()), []);
  });

  it('counts 与数组长度不一致 ⇒ 报错（这就是「快照不自洽」）', () => {
    const bad = validSnapshot();
    bad.counts.components = 99;
    const errors = validateSnapshot(bad);
    assert.ok(
      errors.some((e) => e.includes('counts.components')),
      `应报 counts 不一致，实际：${JSON.stringify(errors)}`,
    );
  });

  it('capturedAt 不是带时区 ISO ⇒ 报错', () => {
    const bad = validSnapshot();
    bad.capturedAt = '2026-10-30 15:04:05';
    assert.ok(validateSnapshot(bad).some((e) => e.includes('capturedAt')));
  });

  it('counts.motionEntries 与 motion.spec 长度不一致 ⇒ 报错', () => {
    const bad = validSnapshot();
    bad.counts.motionEntries = 99;
    assert.ok(
      validateSnapshot(bad).some((e) => e.includes('motionEntries')),
      '⚠️ motion 是对象（条目在 motion.spec），对账要跟 spec 比',
    );
  });

  it('motion 是数组（而不是对象）⇒ 报错（形状对不上就别落盘）', () => {
    const bad = validSnapshot();
    bad.motion = [];
    assert.ok(validateSnapshot(bad).some((e) => e.includes('motion')));
  });

  it('节点缺 nodeId / nodeId 非法 ⇒ 报错', () => {
    const bad = validSnapshot();
    bad.components[0].nodeId = 'not-an-id';
    assert.ok(validateSnapshot(bad).some((e) => e.includes('nodeId')));

    const worse = validSnapshot();
    delete worse.screens[0].nodeId;
    assert.ok(validateSnapshot(worse).some((e) => e.includes('nodeId')));
  });

  it('顶层不是对象 ⇒ 报错（不是崩）', () => {
    assert.ok(validateSnapshot(null).length > 0);
    assert.ok(validateSnapshot([]).length > 0);
    assert.ok(validateSnapshot('x').length > 0);
  });
});

// ════════════════════════════════════════════════════════════════
// 回环白名单 —— 接收器双栈监听，代价是端口会开到局域网
// ════════════════════════════════════════════════════════════════

describe('AETHER 快照接收器 · 回环白名单', () => {
  it('回环地址一律放行（IPv4 / IPv6 / IPv4 映射写法）', () => {
    assert.equal(isLoopback('127.0.0.1'), true);
    assert.equal(isLoopback('::1'), true);
    assert.equal(isLoopback('::ffff:127.0.0.1'), true);
    assert.equal(isLoopback('127.0.0.53'), true, '127/8 整段都是回环');
  });

  it('局域网地址一律拒绝（双栈监听的代价由这道白名单挡住）', () => {
    assert.equal(isLoopback('192.168.1.20'), false);
    assert.equal(isLoopback('10.0.0.3'), false);
    assert.equal(isLoopback('fe80::1'), false);
    assert.equal(isLoopback('2606:4700::1111'), false);
  });

  it('拿不到来源地址 ⇒ 拒绝（fail closed）', () => {
    assert.equal(isLoopback(undefined), false);
    assert.equal(isLoopback(''), false);
  });
});

describe('AETHER 快照接收器 · HTTP 行为', () => {
  it('插件用的那个地址（http://localhost:<port>）能通', async () => {
    // ⚠️ 这条是**插件实际用的 URL**（Figma 的 manifest 只认 localhost，
    //    IP 形式会被它的校验器拒绝）⇒ 必须真的能通。
    await withReceiver(async ({ port, target }) => {
      const res = await post(port, validSnapshot());
      assert.equal(res.status, 200);
      assert.ok(existsSync(target), '经 localhost 访问也要能落盘');
    });
  });

  it('POST 好数据 ⇒ 200 且**真的落盘**，落盘内容能解析回快照', async () => {
    await withReceiver(async ({ port, target }) => {
      const snap = validSnapshot();
      const res = await post(port, snap);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);

      assert.ok(existsSync(target), '⚠️ 收据器说成功了，文件却没落地 ⇒ 落盘失败');
      const written = JSON.parse(readFileSync(target, 'utf8'));
      assert.equal(written.capturedAt, snap.capturedAt);
      assert.equal(written.counts.components, 1);
      assert.equal(written.screens[0].nodeId, '365:1008');
    });
  });

  it('落盘内容是 **prettier 格式** ⇒ pre-commit 钩子不会再改写（不产生脏 diff）', async () => {
    await withReceiver(async ({ port, target }) => {
      await post(port, validSnapshot());
      const text = readFileSync(target, 'utf8');

      const { default: prettier } = await import('prettier');
      const cfg = (await prettier.resolveConfig(target)) ?? {};
      const again = await prettier.format(text, { ...cfg, parser: 'json' });
      assert.equal(again, text, '⚠️ 写出去的文件不是 prettier 规范 ⇒ 提交时钩子会改写它');
    });
  });

  it('落盘格式与仓库现有快照**同款** ⇒ 换快照不会带来无关 diff', async () => {
    const repoPath = resolve(ROOT, SNAPSHOT_REL);
    assert.ok(existsSync(repoPath), '仓库快照不在，测不了');
    const raw = readFileSync(repoPath, 'utf8');
    // ⚠️ 比的是「**同样格式化之后**的两份」—— 不能拿粘贴来的原文直接比：
    //    粘贴/剪贴板那份是 JSON.stringify 直出（数组全展开），
    //    而仓库里入库的版本是**经 pre-commit 钩子 prettier --write 之后**的样子。
    //    ⇒ 真正的口径是「接收器的输出 == prettier 的输出」。
    const fromReceiver = await formatSnapshot(JSON.parse(raw), repoPath);
    const { default: prettier } = await import('prettier');
    const cfg = (await prettier.resolveConfig(repoPath)) ?? {};
    const fromPrettier = await prettier.format(raw, { ...cfg, parser: 'json' });
    assert.equal(
      fromReceiver,
      fromPrettier,
      '⚠️ 接收器的输出格式与 prettier 不一致 ⇒ 提交时钩子会改写它（脏 diff）',
    );
  });

  it('仓库里**真实的**快照能通过校验（校验器不许与采集器的真实产出漂移）', () => {
    const repoPath = resolve(ROOT, SNAPSHOT_REL);
    assert.ok(existsSync(repoPath), '仓库快照不在，测不了');
    const snap = JSON.parse(readFileSync(repoPath, 'utf8'));
    // ⚠️ 这条是**防漂移**的：校验器是照着「我以为的形状」写的，
    //    而采集器产出的是「真实形状」（motion 是对象不是数组 —— 我就踩过这个坑：
    //    校验器按数组写 ⇒ 真实快照被误拒 ⇒ 落盘链路当场断掉）。
    //    ⇒ 拿真快照喂一遍，形状对不上立刻红。
    const errors = validateSnapshot(snap);
    assert.deepEqual(errors, [], `真实快照没通过校验：\n  ${errors.join('\n  ')}`);
  });

  it('POST 脏数据（counts 不自洽）⇒ 400 且**不落盘**', async () => {
    await withReceiver(async ({ port, target }) => {
      const bad = validSnapshot();
      bad.counts.components = 99;
      const res = await post(port, bad);
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.ok(Array.isArray(body.errors) && body.errors.length > 0);
      assert.ok(!existsSync(target), '⚠️ 脏数据绝不许落盘（会毁掉仓库里那份好快照）');
    });
  });

  it('POST 不是 JSON ⇒ 400 且不落盘', async () => {
    await withReceiver(async ({ port, target }) => {
      const res = await post(port, 'this is not json');
      assert.equal(res.status, 400);
      assert.ok(!existsSync(target));
    });
  });

  it('好数据落盘后，再来一份脏数据 ⇒ **老快照不被覆盖**', async () => {
    await withReceiver(async ({ port, target }) => {
      await post(port, validSnapshot());
      const before = readFileSync(target, 'utf8');

      const bad = validSnapshot();
      bad.fileKey = '';
      const res = await post(port, bad);
      assert.equal(res.status, 400);
      assert.equal(readFileSync(target, 'utf8'), before, '⚠️ 脏数据把好快照覆盖了');
    });
  });

  it('GET /health ⇒ 200（人能确认接收器活着）', async () => {
    await withReceiver(async ({ port }) => {
      const res = await fetch(`http://localhost:${port}/health`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).ok, true);
    });
  });

  it('未知路由 ⇒ 404（不是 500 崩掉）', async () => {
    await withReceiver(async ({ port }) => {
      const res = await fetch(`http://localhost:${port}/nope`, { method: 'POST', body: 'x' });
      assert.equal(res.status, 404);
    });
  });

  it('OPTIONS 预检 ⇒ 204 + CORS 头（插件在 iframe 里要读得到响应）', async () => {
    await withReceiver(async ({ port }) => {
      const res = await fetch(`http://localhost:${port}/snapshot`, { method: 'OPTIONS' });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
    });
  });
});

describe('AETHER 快照接收器 · 原子落盘', () => {
  it('落盘后目录里**不留临时文件**', async () => {
    await withReceiver(async ({ port, target, dir }) => {
      await post(port, validSnapshot());
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(dir);
      assert.deepEqual(files, ['figma-snapshot.json'], `目录里有残留：${files.join(', ')}`);
    });
  });

  it('同名目标已存在 ⇒ 被**覆盖**而不是追加（快照是全量替换）', async () => {
    await withReceiver(async ({ port, target }) => {
      writeFileSync(target, '{ "old": true }\n', 'utf8');
      await post(port, validSnapshot());
      const written = JSON.parse(readFileSync(target, 'utf8'));
      assert.equal(written.old, undefined);
      assert.equal(written.capturedAt, '2026-10-30T15:04:05+08:00');
    });
  });
});
