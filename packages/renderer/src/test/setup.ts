/**
 * Vitest global setup —— 在每个测试文件运行前一次性挂载。
 *
 *  - @testing-library/jest-dom：给 expect 加 toBeInTheDocument 等 DOM 断言
 *  - cleanup：每个用例 after 自动卸载组件，防止 DOM 累积污染
 *  - navigator.clipboard mock：happy-dom 默认不实现，ErrorPanel 复制按钮需要
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// happy-dom 不实现 clipboard；ErrorPanel 调它不能炸
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

// URL.createObjectURL 是 SettingsModal 导出按钮依赖的；
// happy-dom 14+ 已实现，但稳妥起见兜个 mock 防止测试间泄漏
if (!('createObjectURL' in URL)) {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:mock-url'),
    configurable: true,
  });
}
if (!('revokeObjectURL' in URL)) {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  });
}
