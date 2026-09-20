import { useState, useEffect } from 'react';
import {
  getChannelPriority,
  setChannelPriority,
  resetChannelPriority,
  type MusicProvider,
  PROVIDER_LABELS,
} from '../../api';

/**
 * §6.2 Settings「渠道优先级」拖拽列表。
 *
 * Props: 无 — 内部自管数据 + 调用 api.ts 的 wrappers。
 * 渲染 4 行（默认全 4 平台，按 PLAY_PRIORITY 顺序），每行 [↑][↓][handle] + 平台名 + 当前位徽章。
 * 首位禁用 ↑、末位禁用 ↓。
 * 底部"重置"按钮 → 写回 fallback。
 */
export default function ChannelPriorityList() {
  const [fallback, setFallback] = useState<MusicProvider[]>([
    'qq',
    'netease',
    'deezer',
    'spotify',
  ]);
  const [list, setList] = useState<MusicProvider[]>(fallback);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg?: string } | null>(null);

  useEffect(() => {
    void getChannelPriority()
      .then((r) => {
        setFallback(r.default);
        setList(r.priority);
      })
      .catch(() => {
        /* 兜底保留 PLAY_PRIORITY 默认 */
      });
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...list];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setList(next);
    setStatus(null);
  };

  const handleSave = async () => {
    setStatus(null);
    try {
      const r = await setChannelPriority(list);
      setList(r.priority);
      setStatus({ kind: 'ok', msg: '已保存' });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  const handleReset = async () => {
    setStatus(null);
    try {
      const r = await resetChannelPriority();
      setList(r.priority);
      setStatus({ kind: 'ok', msg: '已重置' });
    } catch (e) {
      setStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  return (
    <div className="set-priority-list">
      {list.map((p, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === list.length - 1;
        return (
          <div key={p} className="set-priority-item" draggable>
            <button
              className="set-priority-up"
              disabled={isFirst}
              onClick={() => move(idx, -1)}
              aria-label="上移"
              title="上移"
            >
              ↑
            </button>
            <button
              className="set-priority-down"
              disabled={isLast}
              onClick={() => move(idx, 1)}
              aria-label="下移"
              title="下移"
            >
              ↓
            </button>
            <div className="set-priority-handle">
              <span
                className={`set-row-platform set-row-platform--${p}`}
                style={{ minWidth: 60, height: 22 }}
              >
                {PROVIDER_LABELS[p]}
              </span>
              {isFirst && (
                <span className="set-priority-current-badge">· 当前默认</span>
              )}
            </div>
          </div>
        );
      })}
      <div className="set-section-actions" style={{ marginTop: 14 }}>
        <button
          className="set-btn set-btn--accent"
          onClick={() => void handleSave()}
          disabled={list.length === 0}
        >
          保存
        </button>
        <button className="set-btn" onClick={() => void handleReset()}>
          重置默认顺序
        </button>
      </div>
      {status && (
        <div className={`set-status set-status--${status.kind}`} role="status">
          {status.msg}
        </div>
      )}
    </div>
  );
}