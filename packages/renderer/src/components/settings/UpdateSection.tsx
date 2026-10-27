import { useAppUpdate } from '../../hooks/useAppUpdate';
import { describeUpdateState, isInstallable } from '../../lib/appUpdate';

/**
 * 设置里的「应用更新」段（specs/auto-update）。
 *
 * 纯展示 + 三个动作（检查 / 重启安装）。状态的真源在**主进程**
 * （`updater:state` 事件 + `updater:get-state`），这里只订阅 + 转发动作。
 */
export default function UpdateSection() {
  const { state, check, install } = useAppUpdate();
  const checking = state.kind === 'checking';
  const installable = isInstallable(state);

  return (
    <section className="set-section">
      <h3 className="set-section-title">应用更新</h3>
      <p className="set-section-hint">
        {describeUpdateState(state)}
        {installable ? '' : ' · 新版本会自动下载，安装需要你点「重启并安装」'}
      </p>
      <div className="set-row">
        <button className="set-btn-sm" onClick={() => void check()} disabled={checking}>
          {checking ? '检查中…' : '检查更新'}
        </button>
        {installable && (
          <button className="set-btn-sm" onClick={() => void install()} style={{ marginLeft: 8 }}>
            重启并安装
          </button>
        )}
      </div>
    </section>
  );
}
