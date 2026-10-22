/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Vitest config — 阶段 1 引入，仅跑 React 组件 .test.tsx 文件。
 *
 * 为什么不接管所有 .test.mjs / .test.ts：现有 .mjs 用了自实现的
 * `data:text/javascript` ESM loader（api.test.mjs 等），vitest 不支持；
 * 现有 .test.ts 走 ts-node 跑得稳，没必要动。只新增 .test.tsx 跑 vitest。
 *
 * 因此 include 严格限制为 .test.tsx，避免误吞 .mjs/.ts。
 */
const SRC_DIR = resolve(__dirname, 'src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 跟 vite 一致：把 @maestro/common 解到 src（workspaces 软链的
      // dist 是编译产物，避免组件测试受 build:common 顺序影响）。
      '@maestro/common': resolve(__dirname, '../common/src'),
    },
  },
  test: {
    environment: 'happy-dom',
    // 绝对路径防止 vitest 在仓库根 cwd 跑时扫到所有 .test.ts
    include: [`${SRC_DIR}/**/*.test.tsx`],
    setupFiles: [resolve(SRC_DIR, 'test/setup.ts')],
    globals: false, // 显式 import { describe, it, expect }，IDE 跳定义更稳
    clearMocks: true,
    restoreMocks: true,
    css: false, // 不需要 CSS module 解析；scss 在组件里 import 即忽略
    coverage: {
      // ⚠️ **必须用 vitest 自己的 coverage provider，不能用 c8 跑 vitest**。
      //
      // 原因（2026-10-21 实测，见 specs/stability/tasks.md H12）：c8 要把 V8 的
      // **字节偏移**映射回源码行，需要 **source map**（从 node 的 `source-map-cache`
      // 拿）。vitest 的模块是 vite/esbuild 转换后在**内存**里执行的，source map 是
      // inline data URL → node 的 `source-map-cache` 里**没有**它 → c8 拿转换后 JS
      // 的字节偏移去切源 .ts 文件 → **行号随机**。
      //
      // 但因为它切的是完整源文件，**DA 条目数 = 源文件行数** → 看起来「对齐」，
      // 极具欺骗性。实测：一个**从未被调用**的函数，其函数体各行 hits 却是 170；
      // 而同一函数里**必然执行**的 `setCurrentTime(0)` hits 却是 0。
      //
      // coverage-v8 走的是 vite 自己的 transform 链，**拿得到 source map** →
      // 行号正确。
      provider: 'v8',
      reportsDirectory: resolve(__dirname, '../../coverage/.vitest'),
      clean: true,
      reporter: ['json', 'lcov', 'text'],
      // 覆盖率数据只统计 src/ 下的源码（测试文件自身不计入）。
      // ⚠️ include 必须是**相对 root**（= packages/renderer）的 glob ——
      // 用绝对路径时 v8 provider 一条都匹配不上（实测：报告里 0 个文件、
      // All files 0%）。
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test.mjs',
      ],
    },
  },
});
