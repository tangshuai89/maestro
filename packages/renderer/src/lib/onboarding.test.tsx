import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isOnboardingDone,
  markOnboardingDone,
  clearOnboardingDone,
  shouldShowOnboarding,
} from './onboarding';
import { STORAGE_KEYS } from './storage';

/**
 * 首次启动引导的 flag（specs/first-run-guide）。
 *
 * 关键判据：**flag 写失败不能让 App 崩**（隐私模式 / 配额满 → localStorage
 * 抛异常）—— 写失败的唯一后果是「下次还会看到引导」。
 */
describe('首次启动引导的 flag', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('默认 = 没看过', () => {
    expect(isOnboardingDone()).toBe(false);
  });

  it('标记之后 = 看过', () => {
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
  });

  it('清掉之后 = 又变回没看过（设置里的「重新看引导」靠它）', () => {
    markOnboardingDone();
    clearOnboardingDone();
    expect(isOnboardingDone()).toBe(false);
  });

  it('flag 写在约定的键上（键名集中管理在 STORAGE_KEYS）', () => {
    markOnboardingDone();
    expect(localStorage.getItem(STORAGE_KEYS.onboardingDone)).toBe('1');
  });

  it('localStorage 读抛异常 → 当作没看过（不掀翻 App）', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: 隐私模式');
    });
    expect(isOnboardingDone()).toBe(false);
  });

  it('localStorage 写抛异常 → 不往外抛（最多下次再看一次引导）', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markOnboardingDone()).not.toThrow();
  });

  it('localStorage 删抛异常 → 不往外抛', () => {
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearOnboardingDone()).not.toThrow();
  });
});

describe('shouldShowOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('还没选音源 → 不弹（选音源那步已经有 SourceSelect 全屏页了）', () => {
    expect(shouldShowOnboarding(false)).toBe(false);
  });

  it('选了音源 + 没看过 → 弹', () => {
    expect(shouldShowOnboarding(true)).toBe(true);
  });

  it('选了音源 + 看过 → 不弹（不再打扰）', () => {
    markOnboardingDone();
    expect(shouldShowOnboarding(true)).toBe(false);
  });

  it('没选音源 + 看过 → 不弹', () => {
    markOnboardingDone();
    expect(shouldShowOnboarding(false)).toBe(false);
  });
});
