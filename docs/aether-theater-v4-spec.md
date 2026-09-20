# AETHER THEATER v4-ABC — 剧场稿 AI 驱动重建规格

> 基准：`99 · Archive` 页的 `AETHER THEATER — 宇宙剧场 · A`（1440×900）
> 用户决定：v3 `AETHER — Canvas` 为被抛弃的设计（已删除），ABC 剧场稿为最终视觉方向。
> 机制沿用 v4：4 页结构 / AETHER 变量（49 个，颜色已全覆盖）/ Text+Effect Styles / 变量绑定 / 审计。

## 剧场设计语言（从 A 帧实测提取）

| 元素 | 实测结构 | 视觉 |
|---|---|---|
| 01 / Nebula | 3 个模糊椭圆（Electric Violet 500×500 左上 / Neon Cyan 450×450 右下 / Acid Violet 400×400 右上） | 全屏星云背景 |
| 02 / Stardust | 85 颗 1-3px 星尘椭圆，全屏随机 | 粒子层 |
| 03 / Sound Rings | 3 同心描边圆（直径 720/600/480，居中） | 声音可视化 |
| 04 / Hologram | orbit-ring 390×390 + 12 orbit-tick 刻度 + holographic-cover 280×280 椭圆（♪ 90px）+ cover-caption（song-title 40px 白95% / meta 16px 白45% / quality-tag 10px cyan60%）+ heart-stat（♥红 + 计数）+ live-tag | 全息封面区（左中） |

> ⚠️ **下半屏纵向链不变量**（Bug #8，2026-09-20 修）：这一竖列上的每一段间距都是
> **定值**，不允许出现"两个元素盒子互相压着"的排法——
>
> ```
> ring 底 570
>   时间  577 – 596          (.th-orbit-times: bottom -26，跟着进度环走)
>   ≈16    歌名               602 – 650   (40px / line-height 1.2)
>   8      歌手 // 专辑        658 – 679   (16px / 1.3)
>   18     音质 (HI-RES/320K)  697 – 709   (10px / 1.2，flex gap 8 + margin 10)
>   17     控制带              726 – 798   (.th-core-cluster + .th-reco 同一条底带)
>          画布底              900         (剩 102px)
> ```
>
> 两个坑都踩过：
> ① 控制带在 700 时，第三行音质标签落在播放键圆和它的青色光晕里 → 被糊掉；
> ② 把间距压到 8px 救它，视觉太挤 → 用户反弹。
> 真正的原因是**设计稿里时间行(盒底 596)和歌名块(锚 590)本来就重叠 6px**，靠
> Figma 的 Inter 墨迹位置勉强分开；浏览器里行高/回退字体一变就粘成一片。
> 结论：歌名块 602 + 控制带 726（比稿低 26px），换到每段 ≥16px 的确定节奏。
> 控制带**不能再往下**：右下推荐卡底边 868 已经贴着页脚水印 868。
> **改这里任何数字前，先算一遍上面的链 + 这两条边界。**
>
> `30S TRIAL` 标签（TrialFallback）原在 (560,640)：那是标题带的右侧，歌名最长
> 460px（居中于 430 → 右边界 660）时会被压在歌名上。实装挪到 **(560,755)** ——
> 控制带右侧空白区，与 72px 能量核心同一条水平中线（左邻 530 / 上邻音质行 709 /
> 右邻推荐块 1000，四边都有富余）。
| lyric-stream | prev 20px 白18% / current 44px 白95% + active-bar 3×53 cyan / next×3 20px 白18%（右区 560 宽） | 歌词流（右） |
| energy-core | inner-ring 52×52 白描边 + ▶ 30px 深色（72×72，左下） | 播放核心 |
| core-labels | prev/next 40×40 白6% 圆角按钮（Vector 图标） | 切歌按钮 |
| top-hud | brand（AETHER ENGINE v3.0 14px 白85% + SYSTEM PROTOCOL 9px 白25%）+ platform-badges×4（28×28 白8%）+ telemetry（BUFF cyan 10px + ♥计数 + 绿点） | 顶部 HUD |
| star-orbit | orbit-track 300×300 描边 + progress-arc（进度弧）+ orbit-dot 8×8 滑块 + time-stamps（02:14 cyan / 04:52 白30% 16px，左上区） | 环形进度 |
| neural-suggestions | feed-title 10px acid-purple + 3×120×120 卡（art-block 120×70 渐变 + song 11px 白80% + artist 9px 白35% + match cyan，右下） | AI 推荐 |
| Horizon | 1440 宽地平线 | 底部线 |

## 新组件库（02 页，10 组件集 + 1 组件）

| 组件集 | 变体 | 对应剧场元素 |
|---|---|---|
| `Scene/Backdrop`（组件） | —（Nebula+Stardust+Horizon 内建） | 01+02+Horizon |
| `Ring/Sound` | state=`idle\|playing`（3 同心圆） | 03 |
| `Hologram/Cover` | state=`idle\|playing\|loading`；TEXT 属性 songTitle/artist/quality | 04（封面+caption） |
| `Lyrics/Line` | state=`prev\|current\|next`；TEXT 属性 text | lyric-stream |
| `Core/Play` | state=`idle\|hover\|pressed\|playing` | energy-core |
| `Button/Icon` | size=`sm(32)\|md(40)` × state=`default\|hover\|active\|disabled`；TEXT 属性 glyph | core-labels |
| `Badge/Platform` | platform=`qq\|netease\|deezer\|spotify` × state=`idle\|active` | top-hud |
| `Tag/Stat` | tone=`cyan\|dim\|muted\|red\|green` × live=`false\|true`；TEXT 属性 label | telemetry/live-tag |
| `Ring/Progress` | state=`idle\|hover\|dragging`；TEXT 属性 tCur/tTotal | star-orbit |
| `Card/Neural` | state=`default\|hover`；TEXT 属性 song/artist/match | neural-suggestions |
| `Controls/Transport` | state=`playing\|paused`（Core/Play 实例 + prev/next） | energy-core + core-labels |

## 屏幕布局（03 页，1440×900，均为实例组装）

- **Screen/NowPlaying/Playing**：Backdrop → Ring/Sound(playing) → top-hud → star-orbit 进度环(左上 280,270) → Hologram/Cover(playing, 左中) → lyric-stream(右 820,320：Tag + 5× Lyrics/Line) → Controls/Transport(左下 300,700 → 实装 726) → neural-suggestions(右下 1000,700 → 实装 726)
- **Paused**：Cover(idle)、Core(idle→paused)、Rings(idle)
- **Buffering**：Cover(loading)、Core(paused)、Tag「BUFFERING // STREAM」
- **SourceSelect**：Backdrop + 4 平台卡（剧场风格：120×120 竖卡，Badge/Platform 实例）

## 新增 Text Styles（foundations SEG2 追加）

- `AETHER/Title-40`（Inter Semi Bold 40, ls -1）— 歌词 current / 封面歌名
- `AETHER/Body-20`（Inter Regular 20）— 歌词 prev/next
- `AETHER/Mono-16`（JetBrains Mono Regular 16）— 进度时间
（现有 8 个 + 3 = 11）

## MOTION SPEC 更新（04 页）

| 组件 | 触发 | 动画 | 时长 | 驱动 |
|---|---|---|---|---|
| Ring/Sound | playing | 圆环脉冲扩散（循环） | 2.4s | playing state |
| Hologram/Cover | playing | orbit-tick 旋转 + 光晕呼吸 | 4s | playing state |
| Lyrics/Line | track time | 行切换上滑 | 240ms | audio clock |
| Core/Play | hover/tap | 光晕增强 / scale 0.96 | 120/100ms | — |
| Ring/Progress | hover/drag | 弧线亮起 + dot 放大 | 120ms | pointer |
| Card/Neural | hover | lift + 描边亮起 | 160ms | — |
| Backdrop | audio | 星尘漂移（CSS 驱动） | 30s 循环 | audio-reactive |
| Screen | state | 整体淡入淡出 | 200ms | app state |

## 审计期望变更（audit.mjs / smoke 同步）

- EXPECTED_SETS → 新组件清单（变体数如上表）
- 屏幕断言 4 个不变；Text Styles ≥ 11
