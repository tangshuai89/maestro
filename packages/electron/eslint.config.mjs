import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Electron main/preload ESLint config.
//
// Coverage:
//   src/**/*.ts (main, preload, auth/, lib/)
//   excludes: *.test.ts, dist, node_modules.
//
// ISSUES.md §3.7 hardening:
//   no-console: warn (allow warn/error — legitimate error logging).
//   Note: `lib/logger.ts` legitimately wraps console internally — its
//   console.* calls are eslint-disable'd inline so the wrapper itself
//   doesn't trip the rule.
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Tighten in follow-up PRs.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
