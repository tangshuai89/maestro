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
  },
});
