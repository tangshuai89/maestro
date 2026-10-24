import type { MediaSessionCommands } from '../hooks/useMediaSession';

/**
 * 把「系统媒体控件的 8 个 action」接到 `usePlayer` 的动作上。
 *
 * ## 为什么不在 App.tsx 里直接写闭包
 *
 * `App.tsx` 是**接线层**：单测碰不到它（仓库里靠浏览器覆盖采集器测它）。
 * 写成内联闭包的话，那些闭包的**函数体**只会在用户真的按媒体键时才执行
 * → 行覆盖 0 → **覆盖率 diff 门禁**判「新增行未覆盖」→ 整个 PR 被拦。
 *
 * 更要紧的是：那样写等于**把逻辑放进测不到的地方**。挪到这里之后：
 * - 逻辑有单测（`media-session-commands.test.ts`）
 * - App.tsx 只剩一行调用（每次 render 都执行 → 覆盖得到）
 *
 * ## 两个「toggle」语义的坑
 *
 * `mediaSession` 分 `play` / `pause` 两个动作，而 `usePlayer` 只有一个
 * `handlePlayPause`（toggle）。直接用它会出现"按 play 反而暂停"。
 * ⇒ 用**当前播放状态**决定要不要 toggle（也少一次无谓的状态翻转）。
 */
export interface MediaSessionCommandSources {
  /** 当前是否在播 */
  playing: boolean;
  /** 播放/暂停（toggle） */
  handlePlayPause: () => void;
  /** 上一首 */
  handlePrev: () => void;
  /** 下一首 */
  handleSkip: () => void;
  /** 跳到指定秒数 */
  seek: (seconds: number) => void;
}

export function buildMediaSessionCommands(src: MediaSessionCommandSources): MediaSessionCommands {
  return {
    play: () => {
      if (!src.playing) src.handlePlayPause();
    },
    pause: () => {
      if (src.playing) src.handlePlayPause();
    },
    prev: () => src.handlePrev(),
    next: () => src.handleSkip(),
    seek: (seconds: number) => src.seek(seconds),
    stop: () => {
      if (src.playing) src.handlePlayPause();
    },
  };
}
