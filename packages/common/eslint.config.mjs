import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Common (cross-package shared utilities) ESLint config.
//
// Coverage: src/**/*.ts (normalizer, contract, grouping).
// Excludes: test files, dist, node_modules.
//
// ISSUES.md §1.2 / §3.8 enforcement:
//   no-console: warn (allow warn/error — error logging is legitimate)
//   no-explicit-any: warn
//
// Source currently has 0 console / 0 as any — adding these rules keeps
// the shared package clean (this is what server's mergeLibrary + renderer's
// groupLibrary both depend on, AGENTS.md hard constraint).
export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: { ecmaVersion: 2022 },
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
