import { describe, it, expect } from 'vitest';
import { describeUpdateState, isInstallable } from './appUpdate';
import type { UpdateState } from '../../../electron/src/preload';

/**
 * 更新状态的文案映射（specs/auto-update）。
 *
 * 这段文案是**用户唯一能看到**的东西 ⇒ 每种状态都得有一句人话，
 * 而且不能出现 `undefined` / `[object Object]`。
 */
describe('describeUpdateState', () => {
  const cases: Array<[UpdateState, string]> = [
    [{ kind: 'idle' }, '还没检查过更新'],
    [{ kind: 'unsupported', reason: '开发模式不检查更新' }, '开发模式不检查更新'],
    [{ kind: 'checking' }, '正在检查更新…'],
    [{ kind: 'not-available', version: '1.0.0' }, '已是最新版本（1.0.0）'],
    [{ kind: 'not-available', version: '' }, '已是最新版本'],
    [{ kind: 'available', version: '1.2.0' }, '发现新版本 1.2.0'],
    [{ kind: 'downloading', percent: 42 }, '正在下载新版本…42%'],
    [{ kind: 'ready', version: '1.2.0' }, '新版本 1.2.0 已就绪'],
    [{ kind: 'error', message: 'boom' }, '检查更新失败：boom'],
  ];

  it.each(cases)('%j → 含「%s」', (state, expected) => {
    const text = describeUpdateState(state);
    expect(text).toContain(expected);
  });

  it('任何状态都不会吐出 undefined / [object Object]', () => {
    for (const [state] of cases) {
      const text = describeUpdateState(state);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('[object Object]');
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('isInstallable', () => {
  it('只有「已就绪」才能安装', () => {
    expect(isInstallable({ kind: 'ready', version: '1.2.0' })).toBe(true);
  });

  it('其它状态一律不能安装', () => {
    const others: UpdateState[] = [
      { kind: 'idle' },
      { kind: 'unsupported', reason: 'x' },
      { kind: 'checking' },
      { kind: 'not-available', version: '1.0.0' },
      { kind: 'available', version: '1.2.0' },
      { kind: 'downloading', percent: 10 },
      { kind: 'error', message: 'x' },
    ];
    for (const s of others) expect(isInstallable(s)).toBe(false);
  });
});
