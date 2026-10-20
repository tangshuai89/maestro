/**
 * useTheme 测试（此前零覆盖）。
 *
 * 契约：
 *  - theme 从 localStorage 读（没存过 → 'system'）
 *  - 'system' → **移除** `<html data-theme>`，交给 CSS 的 prefers-color-scheme
 *  - 'dark' / 'light' → 设置 `<html data-theme="...">`，CSS token 块随之翻转
 *  - resetTheme → 回到 'system'
 *  - 变化后写回 localStorage
 *
 * 注意：hook 的 JSDoc 说「当前没有组件读 theme」，但它**确实**在写
 * `<html data-theme>` —— 那是 CSS token 翻转的开关，所以这层要守住。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';
import { STORAGE_KEYS } from '../lib/storage';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('没存过 → system', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('从 localStorage 读出已存的 theme', () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('theme=system → 不设 data-theme 属性（交给 prefers-color-scheme）', () => {
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('切到 dark → <html data-theme="dark">', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('切到 light → <html data-theme="light">', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('light');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('resetTheme → 回到 system 且移除属性', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      result.current.resetTheme();
    });
    expect(result.current.theme).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('变化写回 localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme('light');
    });
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('light');
  });
});
