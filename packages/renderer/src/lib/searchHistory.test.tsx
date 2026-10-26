/**
 * 搜索历史的存储与规整（specs/search-history/）。
 *
 * 纯函数为主（好测），localStorage 的读写在 `lib/storage.ts`。
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SEARCH_HISTORY,
  normaliseHistoryEntry,
  parseSearchHistory,
  pushSearchHistory,
} from './searchHistory';

describe('searchHistory · 规整', () => {
  it('去空白；空串 / 非字符串 → null', () => {
    expect(normaliseHistoryEntry('  周杰伦 ')).toBe('周杰伦');
    expect(normaliseHistoryEntry('')).toBeNull();
    expect(normaliseHistoryEntry('   ')).toBeNull();
    expect(normaliseHistoryEntry(123)).toBeNull();
    expect(normaliseHistoryEntry(null)).toBeNull();
  });

  it('超长的词不算历史（误粘贴/噪声）', () => {
    expect(normaliseHistoryEntry('x'.repeat(200))).toBeNull();
  });
});

describe('searchHistory · 并入', () => {
  it('新词进最前', () => {
    expect(pushSearchHistory(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('同一个词再搜 → 移到最前，**不追加第二条**', () => {
    expect(pushSearchHistory(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  it('空词不改变历史', () => {
    expect(pushSearchHistory(['a'], '   ')).toEqual(['a']);
  });

  it('超过上限 → 丢最旧的', () => {
    const many = Array.from({ length: 20 }, (_, i) => `k${i}`);
    const out = pushSearchHistory(many, 'new');
    expect(out.length).toBe(MAX_SEARCH_HISTORY);
    expect(out[0]).toBe('new');
    expect(out).not.toContain('k19');
  });

  it('limit=0 → 空数组（不炸）', () => {
    expect(pushSearchHistory(['a'], 'b', 0)).toEqual([]);
  });
});

describe('searchHistory · 解析脏数据', () => {
  it('非 JSON / 非数组 → 空数组', () => {
    expect(parseSearchHistory('not json')).toEqual([]);
    expect(parseSearchHistory('{"a":1}')).toEqual([]);
    expect(parseSearchHistory(null)).toEqual([]);
  });

  it('丢掉空串 / 非字符串 / 超长项', () => {
    expect(
      parseSearchHistory(JSON.stringify(['a', '', '  ', 123, null, 'b'.repeat(200), 'b'])),
    ).toEqual(['a', 'b']);
  });

  it('丢掉重复项（保留第一次出现的顺序）', () => {
    expect(parseSearchHistory(JSON.stringify(['a', 'b', 'a']))).toEqual(['a', 'b']);
  });
});
