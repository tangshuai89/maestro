import { useState } from 'react';

/**
 * 首次启动引导（specs/first-run-guide）—— 3 步，可跳过。
 *
 * ## 为什么是「全屏覆盖层」而不是一个小气泡
 *
 * 引导的目的只有两个：**让人知道 App 能干什么** + **让人知道 AI 推荐要 key**。
 * 做成小气泡 = 用户点掉就忘了；做成挡在标题栏前面的整屏 = 想用 App 就必须
 * 读完（或明确跳过）。「跳过」永远在最显眼的地方 ⇒ 引导不是关卡。
 *
 * ## 步骤与出口
 *
 *   1 欢迎     → 「开始」
 *   2 AI 推荐  → 「现在设置」（打开**已有的** RecoKeyModal）/「以后再说」
 *   3 上手     → 「开始使用」
 *
 * 任何一步都能跳过（右上角「跳过」）⇒ 写 flag ⇒ 不再打扰。
 */

interface Props {
  /** 是否显示（由 App 控制：选完音源 + 没看过引导） */
  open: boolean;
  /** 完成 / 跳过都走它 —— App 负责写 flag + 关闭 */
  onClose: () => void;
  /** 第 2 步「现在设置」→ 打开 RecoKeyModal（**复用**，不重写 key 输入） */
  onOpenRecoKey: () => void;
}

/** 三步各自的文案 —— 单独抽出来，方便测试断言「这一步说了什么」。 */
export const GUIDE_STEPS = [
  {
    kicker: 'STEP 1 / 3',
    title: '欢迎使用 Maestro',
    points: [
      {
        head: '四个音源，一个播放器',
        body: 'QQ 音乐 / 网易云 / Deezer / Spotify —— 凭据只存在你本机，不上传任何服务器。',
      },
      {
        head: '统一搜索 + 一个 ♤ 库',
        body: '跨平台搜同一首歌，红心进同一个库，换平台不用重新收藏。',
      },
      {
        head: 'AI 推荐 + 歌词',
        body: '按你的口味生成歌单；歌词多源聚合，滚动跟着歌走。',
      },
    ],
  },
  {
    kicker: 'STEP 2 / 3',
    title: 'AI 推荐需要一把自己的钥匙',
    points: [
      {
        head: 'DeepSeek API key',
        body: '推荐引擎跑在你自己的 key 上。填了才能用「AI 推荐」，不填也能正常听歌。',
      },
      {
        head: '不想现在填？',
        body: '随时跳过 —— 之后在「设置 → DeepSeek API key」里也能补上。',
      },
    ],
  },
  {
    kicker: 'STEP 3 / 3',
    title: '三件值得知道的事',
    points: [
      {
        head: '搜索在标题栏',
        body: '点标题栏的 🔍，或按搜索框 —— 跨平台搜歌，回车直接播。',
      },
      {
        head: '⌘⇧L / ⌘⇧M',
        body: '极简模式（只有歌名和播控）/ 迷你悬浮条 —— 窗口小的时候用。',
      },
      {
        head: '⌨ 快捷键面板',
        body: '标题栏最右那个按钮 —— 所有快捷键都在里面，不用背。',
      },
    ],
  },
] as const;

export default function FirstRunGuide({ open, onClose, onOpenRecoKey }: Props) {
  const [step, setStep] = useState(0);
  if (!open) return null;

  const current = GUIDE_STEPS[step];
  const isLast = step === GUIDE_STEPS.length - 1;

  const finish = () => {
    // 回到第 1 步 —— 下次「重新看引导」从头开始，不留半截状态
    setStep(0);
    onClose();
  };

  return (
    // 面板复用共享的 .modal-overlay / .modal-panel（阴影/边框/圆角都在那边，
    // 硬编码颜色预算也在那边）—— 引导的样式只做**布局覆盖**。
    <div
      className="modal-overlay frg-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="首次启动引导"
    >
      <div className="modal-panel frg-panel">
        <div className="frg-head">
          <span className="frg-kicker">{current.kicker}</span>
          <button type="button" className="frg-skip" onClick={finish}>
            跳过引导
          </button>
        </div>

        <h2 className="frg-title">{current.title}</h2>

        <ul className="frg-points">
          {current.points.map((p) => (
            <li key={p.head} className="frg-point">
              <span className="frg-point-head">{p.head}</span>
              <span className="frg-point-body">{p.body}</span>
            </li>
          ))}
        </ul>

        <div className="frg-actions">
          {step === 1 && (
            <button type="button" className="frg-btn frg-btn--ghost" onClick={onOpenRecoKey}>
              现在设置
            </button>
          )}
          <button
            type="button"
            className="frg-btn frg-btn--primary"
            onClick={() => (isLast ? finish() : setStep(step + 1))}
          >
            {isLast ? '开始使用' : step === 1 ? '以后再说' : '开始'}
          </button>
        </div>
      </div>
    </div>
  );
}
