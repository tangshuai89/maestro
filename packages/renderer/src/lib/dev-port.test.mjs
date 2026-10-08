/**
 * dev-port 探测单测。
 *
 * 放在 src/lib/ 下（而不是与被测模块同目录的 scripts/）：scripts/test.sh 只
 * 扫 packages 各 src 目录下的 .test.mjs，摆在 scripts/ 里不会被跑到 ——
 * 那样这条测试就形同虚设。
 *
 * 运行: node packages/renderer/src/lib/dev-port.test.mjs
 */
import assert from 'node:assert';
import {
  DEFAULT_DEV_PORT,
  isPortTaken,
  pickFreePort,
  isDevPortFree,
  __setExecForTest,
} from '../../scripts/dev-port.mjs';

let passed = 0;
const ok = (n) => { passed++; console.log('✅ ' + n); };

/** 临时替换 lsof 执行器。 */
function withExec(impl, fn) {
  __setExecForTest(impl);
  try { return fn(); } finally { __setExecForTest(null); }
}

try {
  // 1. 明确占用
  withExec(() => 'node 123 1 0  0  TCP 127.0.0.1:5173 (LISTEN)\n', () => {
    assert.strictEqual(isPortTaken(5173), true);
    assert.strictEqual(isDevPortFree(5173), false);
  });
  ok('1. 明确占用 → isPortTaken=true / isDevPortFree=false');

  // 2. 明确空闲（lsof 无输出）
  withExec(() => '', () => {
    assert.strictEqual(isPortTaken(5173), false);
    assert.strictEqual(isDevPortFree(5173), true);
  });
  ok('2. 空闲 → isPortTaken=false');

  // 3. lsof 抛错（没装 / 权限不足）→ 降级为"未占用"，不把用户逼去设环境变量
  withExec(() => { throw new Error('lsof: not found'); }, () => {
    assert.strictEqual(isPortTaken(5173), false,
      'lsof 不可用必须降级为未占用，让 vite 自己去撞墙给提示');
  });
  ok('3. lsof 不可用 → 降级为未占用（不误判成占用）');

  // 4. 输出里没有该端口（别的进程占着别的端口）→ 不算占用
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
    assert.strictEqual(pickFreePort(9000, 9000, 5), 9000, '找不到就还回起点');
  });
  ok('6. MAX_TRIES 用尽 → 还回起点（交给 vite 报错）');

  // 7. 常量
  assert.strictEqual(DEFAULT_DEV_PORT, 5173);
  ok('7. DEFAULT_DEV_PORT = 5173');

  console.log('\n🎉 dev-port.test: ' + passed + ' passed');
} catch (e) {
  console.error('\n❌ 失败:', e.message);
  process.exit(1);
}
