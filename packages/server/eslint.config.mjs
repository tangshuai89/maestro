import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Server ESLint config.
//
// Coverage:
//   src/**/*.ts (controllers, services, providers) — linted.
//   test files (test.ts, spec.ts), test-helpers/, dist/, node_modules/ — ignored.
// Tests use console freely and have many `as any` for private fields /
// mock methods — no lint pressure there.
//
// ISSUES.md §1.2 / §3.8 enforcement:
//   no-console: warn (allow warn/error — legitimate error logging)
//   no-explicit-any: warn
//
// Other rules from typescript-eslint recommended are kept OFF (or downgraded)
// because they surface a lot of pre-existing noise unrelated to the ISSUES
// goals. Tighten them in dedicated follow-up PRs.
export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/test-helpers/**',
      // Cleanup script in plain JS (TS parser chokes on duplicate `norm`).
      'src/scripts/cleanup-ne-fanout-mismatches.js',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      // ── ISSUES §1.2 / §3.8 ─────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',

      // ── 放宽存量噪声（非本 PR 目标） ────────────────────────────
      // 大量已存在的未用变量（约定前缀 _ 视为有意）、无用转义、unsafe-*，
      // 不在本 PR scope。等后续专项 PR 收紧。
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-function-return-type': 'off',
    },
  },
);
