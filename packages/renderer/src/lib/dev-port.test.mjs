/**
 * dev 端口发布/读取单测。
 *
 * 放在 src/lib/ 下（而非与被测模块同目录的 scripts/）：scripts/test.sh 只
 * 扫 packages 各 src 目录下的 .test.mjs，摆在 scripts/ 里不会被跑到 ——
 * 那样这条测试形同虚设。
 *
 * 运行: node packages/renderer/src/lib/dev-port.test.mjs
 */
import assert from 'node:assert';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import {
  DEFAULT_DEV_PORT,
  DEV_PORT_FILE,
  __setExecForTest,
  clearPublishedDevPort,
  isDevPortFree,
  isPortTaken,
  pickFreePort,
  readPublishedDevPort,
  resolveAndPublishDevPort,
} from '../../scripts/dev-port.mjs';

let passed = 0;
const ok = (n) => { passed++; console.log('✅ ' + n); };
const withExec = (impl, fn) => {
  __setExecForTest(impl);
  try { return fn(); } finally { __setExecForTest(null); }
};

try {
  // 1. 明确占用
  withExec(() => 'node 1 2 0 0 TCP 127.0.0.1:5173 (LISTEN)\n', () => {
    assert.strictEqual(isPortTaken(5173), true);
    assert.strictEqual(isDevPortFree(5173), false);
  });
  ok('1. 明确占用 → isPortTaken=true / isDevPortFree=false');

  // 2. 明确空闲
  withExec(() => '', () => {
    assert.strictEqual(isPortTaken(5173), false);
    assert.strictEqual(isDevPortFree(5173), true);
  });
  ok('2. 空闲 → isPortTaken=false');

  // 3. lsof 不可用 → 降级为"未占用"，不把用户逼去设 RENDERER_PORT
  withExec(() => { throw new Error('lsof: not found'); }, () => {
    assert.strictEqual(isPortTaken(5173), false,
      'lsof 不可用必须降级为未占用，让 vite 自己去撞墙给提示');
  });
  ok('3. lsof 不可用 → 降级为未占用（不误判成占用）');

  // 4. 输出里没有该端口 → 不算占用
  withExec(() => 'node 1 2 0 0 TCP 127.0.0.1:5174 (LISTEN)\n', () => {
    assert.strictEqual(isPortTaken(5173), false);
  });
  ok('4. 输出中无目标端口 → 不算占用');

  // 5. pickFreePort 跳过连续占用
  const taken = new Set([5173, 5174, 5175]);
  withExec((f, a) => {
    const port = Number((a[1].match(/-iTCP:(\d+)/) || [])[1]);
    return taken.has(port) ? 'node 1 2 0 0 TCP 127.0.0.1:' + port + ' (LISTEN)\n' : '';
  }, () => {
    assert.strictEqual(pickFreePort(5173), 5176, '应跳过 5173-5175 落到 5176');
  });
  ok('5. pickFreePort 跳过连续占用端口');

  // 6. MAX_TRIES 用尽 → 还回起点，交给 vite 报错
  withExec(() => 'node 1 2 0 0 TCP 127.0.0.1:1 (LISTEN)\n', () => {
    assert.strictEqual(pickFreePort(9000, 9000, 5), 9000);
  });
  ok('6. MAX_TRIES 用尽 → 还回起点（交给 vite 报错）');

  // ══════════════════════════════════════════════════════
  // 端口发布 / 读取（2026-10-08 黑屏修复的核心）
  // ══════════════════════════════════════════════════════

  // 7. vite 报告的实际端口优先于配置的端口
  {
    clearPublishedDevPort();
    // configured=5173（vite 首选）但 actual=5174（真正监听的）
    const published = resolveAndPublishDevPort(DEFAULT_DEV_PORT, 5174);
    assert.strictEqual(published, 5174, 'actual 必须覆盖 configured');
    assert.strictEqual(readPublishedDevPort(), 5174);
    ok('7. vite 报告的 actual 端口优先于 configured（端口文件 = 实际监听端口）');
  }

  // 8. 拿不到 actual 时退回探测
  {
    clearPublishedDevPort();
    withExec(() => '', () => {
      // configured 5173、actual undefined、5173 空闲 → 都指向 5173
      assert.strictEqual(resolveAndPublishDevPort(5173, undefined), 5173);
    });
    ok('8. 拿不到 actual 时退回 configured / 探测结果');
  }

  // 9. 没发布过时 electron 读到 null（而不是猜一个错端口）
  {
    clearPublishedDevPort();
    assert.strictEqual(readPublishedDevPort(), null,
      '没有端口文件必须返回 null，让 electron 走兜底 + 提示，而不是读到脏值');
    ok('9. 未发布 → readPublishedDevPort 返回 null');
  }

  // 10. clearPublishedDevPort 清干净（vite 退出后不留过期值）
  {
    resolveAndPublishDevPort(5173, 5180);
    assert.ok(existsSync(DEV_PORT_FILE), '前置：端口文件已写入');
    clearPublishedDevPort();
    assert.strictEqual(existsSync(DEV_PORT_FILE), false, '退出后端口文件必须清掉');
    ok('10. clearPublishedDevPort 清掉端口文件（不留过期值给下次 dev）');
  }

  // 11. 端口文件内容是纯数字，原子写不留残缺
  {
    clearPublishedDevPort();
    resolveAndPublishDevPort(5173, 5199);
    const raw = readFileSync(DEV_PORT_FILE, 'utf8').trim();
    assert.strictEqual(raw, '5199');
    assert.ok(/^\d+$/.test(raw), '端口文件应是纯数字，避免读到写了一半的内容');
    clearPublishedDevPort();
    ok('11. 端口文件是纯数字（原子写，不会读到写了一半）');
  }

  // 12. 常量
  assert.strictEqual(DEFAULT_DEV_PORT, 5173);
  ok('12. DEFAULT_DEV_PORT = 5173');

  console.log('\n🎉 dev-port.test: ' + passed + ' passed');
} catch (e) {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
} finally {
  try { clearPublishedDevPort(); } catch { /* ignore */ }
}
