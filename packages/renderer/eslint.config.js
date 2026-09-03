import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // dist 与 .test.mjs（测试用 console 自由）排除
  { ignores: ['dist', '**/*.test.mjs'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // ISSUES.md §1.2：堵新 console.log（warn 起步，给已有 4 处 console.log
      // 留过渡）。console.warn / console.error 是合法的错误日志通道，
      // 显式 allow——不误伤音频错误日志等。
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // ISSUES.md §3.8：堵新 `as any`。warn 起步让 CI 可见但不立即 break；
      // 想要严格可后续升级 error。
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
