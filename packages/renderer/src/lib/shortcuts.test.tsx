/**
 * `lib/shortcuts.ts` 的判定测试（specs/shortcut-cheatsheet/）。
 *
 * 这个文件的价值全在**防漂移**：快捷键速查面板渲染的是 `APP_SHORTCUTS`，
 * `App.tsx` 的 keydown 判定调的是 `matchesShortcut` —— 两边同源。
 * 这里的用例锁住「这张表怎么被解释」，让改键位时必须同步改判定。
 */
import { describe, it, expect } from 'vitest';
import {
  APP_SHORTCUTS,
  APP_SHORTCUT_BY_ID,
  matchesShortcut,
  groupShortcuts,
  formatAccelerator,
} from './shortcuts';

/** 造一个最小可用的 KeyboardEvent 替身。 */
function ev(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  } as KeyboardEvent;
}

describe('shortcuts · 判定', () => {
  it('定义表里的每条都有 id / 键位 / 描述 / 分组（面板要渲染这些）', () => {
    for (const s of APP_SHORTCUTS) {
      expect(s.id, `${s.id} 缺 id`).toBeTruthy();
      expect(s.keys, `${s.id} 缺展示键位`).toBeTruthy();
      expect(s.label, `${s.id} 缺描述`).toBeTruthy();
      expect(['播放', '界面', '桌面']).toContain(s.group);
    }
  });

  it('id 唯一（APP_SHORTCUT_BY_ID 按 id 取，不能撞）', () => {
    const ids = APP_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('⌘⇧M：⌘+⇧+M 命中，⌘+M 不命中，单独的 M 不命中', () => {
    const s = APP_SHORTCUT_BY_ID['toggle-mini'];
    expect(matchesShortcut(ev({ key: 'm', metaKey: true, shiftKey: true }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: 'M', metaKey: true, shiftKey: true }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: 'm', metaKey: true }), s)).toBe(false);
    expect(matchesShortcut(ev({ key: 'm' }), s)).toBe(false);
  });

  it('⌘⇧M：Ctrl+⇧+M 也命中（metaOrCtrl —— Windows/Linux 兼容）', () => {
    const s = APP_SHORTCUT_BY_ID['toggle-mini'];
    expect(matchesShortcut(ev({ key: 'm', ctrlKey: true, shiftKey: true }), s)).toBe(true);
  });

  it('⌘⇧D / ⌘⇧L 各自只认自己的键', () => {
    expect(
      matchesShortcut(
        ev({ key: 'd', metaKey: true, shiftKey: true }),
        APP_SHORTCUT_BY_ID['toggle-desktop-lyrics'],
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        ev({ key: 'd', metaKey: true, shiftKey: true }),
        APP_SHORTCUT_BY_ID['toggle-lite'],
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        ev({ key: 'l', metaKey: true, shiftKey: true }),
        APP_SHORTCUT_BY_ID['toggle-lite'],
      ),
    ).toBe(true);
  });

  it('Space：code=Space 或 key=" " 都命中；别的键不命中', () => {
    const s = APP_SHORTCUT_BY_ID['play-pause'];
    expect(matchesShortcut(ev({ key: ' ', code: 'Space' }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: ' ', code: 'Unidentified' }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: 'a' }), s)).toBe(false);
  });

  it('Esc：命中 Escape；大小写无关', () => {
    const s = APP_SHORTCUT_BY_ID['exit-lite'];
    expect(matchesShortcut(ev({ key: 'Escape' }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: 'escape' }), s)).toBe(true);
    expect(matchesShortcut(ev({ key: 'Esc' }), s)).toBe(false); // 不是 Escape
  });

  it('定义表里没有的键一律不命中（防止「万能匹配」）', () => {
    const s = APP_SHORTCUT_BY_ID['toggle-mini'];
    expect(matchesShortcut(ev({ key: 'q', metaKey: true, shiftKey: true }), s)).toBe(false);
  });
});

describe('shortcuts · 分组与展示', () => {
  it('groupShortcuts 按 播放→界面→桌面 归拢，组内顺序保持定义表顺序', () => {
    const groups = groupShortcuts();
    expect(groups.map((g) => g.group)).toEqual(['播放', '界面', '桌面']);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groupShortcuts 只收 APP_SHORTCUTS 里的条目（不凭空造）', () => {
    const groups = groupShortcuts(APP_SHORTCUTS);
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(APP_SHORTCUTS.length);
  });

  it('formatAccelerator 把 Electron accelerator 转成 macOS 符号', () => {
    expect(formatAccelerator('Control+Option+ArrowRight')).toBe('⌃⌥→');
    expect(formatAccelerator('Control+Option+Space')).toBe('⌃⌥Space');
    expect(formatAccelerator('Control+Option+D')).toBe('⌃⌥D');
  });
});
