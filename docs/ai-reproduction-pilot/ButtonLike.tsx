/**
 * Figma Button/Like（组件集 263:106）复原，三态受外部控制：
 * unliked（白心玻璃底）/ liked（红底+红晕）/ fanout（红心+右上徽章）。
 * 心形描边与 Icon/Heart（252:96）一致：stroke 2 / 24 viewBox 内联 SVG
 * （与 MonsterBeatsView.tsx 的 lucide-style 内联图标惯例一致，无外部依赖）；
 * 设计稿里三态的心形 Vector 均只有 strokes、没有 fills，故始终 fill="none"，
 * 只用 color 切描边色，不做「liked 时实心」的额外假设。
 */
import styles from './ButtonLike.module.scss';

export type ButtonLikeState = 'unliked' | 'liked' | 'fanout';

export interface ButtonLikeProps {
  state: ButtonLikeState;
  /**
   * 跨平台命中数，仅 state === 'fanout' 时渲染徽章。
   * TODO: 设计稿三态文本都是占位 "0"，fanOutCount=0 时 fanout 态是否仍应显示
   * 徽章（还是应退化成 liked 外观）未在设计稿/规格里定义，此处先按「照常渲染」处理。
   */
  fanOutCount?: 0 | 1 | 2 | 3 | 4;
  onClick?: () => void;
}

// lucide heart（MonsterBeatsView.tsx:130 同款 path）
const HEART_PATH = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z';

export default function ButtonLike({ state, fanOutCount = 0, onClick }: ButtonLikeProps) {
  const isRed = state === 'liked' || state === 'fanout';

  return (
    <button
      type="button"
      className={`${styles.button} ${styles[state]}`}
      onClick={onClick}
      aria-pressed={isRed}
    >
      <svg
        className={styles.icon}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={HEART_PATH} />
      </svg>
      {state === 'fanout' && (
        <span className={styles.badge}>
          <span className={styles.badgeCount}>{fanOutCount}</span>
        </span>
      )}
    </button>
  );
}
