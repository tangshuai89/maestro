# AETHER v4 原型连线操作单（12 条）

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
用途：插件 API 无法写 interactions（平台限制），需在 Figma UI 原型模式手动连线。
连完后 REST 可读（`GET /v1/files/:key` 返回节点 `interactions` 字段），AI 还原时可直接拿到动效参数。

## 操作方式（每条约 30 秒）

1. 选中「起点」变体节点（组件集内的具体变体，如 `Core/Play` 的 `state=idle`）；
2. 右侧面板切到 **Prototype** 模式（闪电图标）；
3. 从节点中心的圆点拖拽到「终点」变体节点；
4. 交互设置：
   - Trigger（触发）：见下表「触发」列（ON_HOVER / ON_CLICK / MOUSE_DOWN）
   - Animation：**Smart Animate**；时长/缓动见下表
   - 勾选 "Smart animate matching layers"（变体图层名已一致，可平滑过渡）
5. 03 页屏幕连线同理：选中屏幕帧内触发元素（transport 实例 / 推荐卡实例）→ 拖到目标屏幕帧。

## 连线清单（12 条）

| # | 起点 | 终点 | 触发 | 时长 | 缓动 |
|---|---|---|---|---|---|
| 1 | 02/Core/Play `state=idle` | 02/Core/Play `state=hover` | ON_HOVER | 120ms | cubic-bezier(.16,1,.3,1) |
| 2 | 02/Core/Play `state=idle` | 02/Core/Play `state=pressed` | ON_CLICK | 100ms | ease-in |
| 3 | 02/Button/Icon `size=sm, state=default` | 02/Button/Icon `size=sm, state=hover` | ON_HOVER | 120ms | cubic-bezier(.16,1,.3,1) |
| 4 | 02/Button/Icon `size=md, state=default` | 02/Button/Icon `size=md, state=hover` | ON_HOVER | 120ms | cubic-bezier(.16,1,.3,1) |
| 5 | 02/Card/Neural `state=default` | 02/Card/Neural `state=hover` | ON_HOVER | 160ms | cubic-bezier(.16,1,.3,1) |
| 6 | 02/Ring/Progress `state=idle` | 02/Ring/Progress `state=hover` | ON_HOVER | 120ms | ease-out |
| 7 | 02/Ring/Progress `state=idle` | 02/Ring/Progress `state=dragging` | MOUSE_DOWN | 100ms | ease-out |
| 8 | 02/Lyrics/Line `state=prev` | 02/Lyrics/Line `state=current` | ON_CLICK | 240ms | cubic-bezier(.16,1,.3,1) |
| 9 | 02/Lyrics/Line `state=current` | 02/Lyrics/Line `state=next` | ON_CLICK | 240ms | cubic-bezier(.16,1,.3,1) |
| 10 | 03/Screen/NowPlaying/Playing（transport `controls` 实例） | 03/Screen/NowPlaying/Paused | ON_CLICK | 200ms | ease-out |
| 11 | 03/Screen/NowPlaying/Playing（进度环 `star-orbit` 实例） | 03/Screen/NowPlaying/Buffering | ON_CLICK | 200ms | ease-out |
| 12 | 03/Screen/SourceSelect（任意推荐卡 `suggestion-card` 实例） | 03/Screen/NowPlaying/Playing | ON_CLICK | 240ms | ease-out |

> 说明：条目 1-9 在 02 · Components 页组件集上连（组件集连线会被所有实例继承）；
> 条目 10-12 在 03 · Screens 页屏幕帧上连（触发元素用屏幕内实例）。
> **Figma 限制：同一起点节点 + 同一触发只能有一条交互**——第 10 条已占用
> transport 实例的 ON_CLICK，第 11 条同起点只剩 ON_DRAG；因此第 11 条起点
> 改用进度环 `star-orbit` 实例（点击进度条 seek → 缓冲，语义自然）。
> **2026-08-21 实弹确认（REST 读回 81 条，12 条目标全部命中）**：
> - 第 2 条 Core/Play idle→pressed 实际触发为 **MOUSE_DOWN**（按下即反馈，
>   语义等价于 tap；操作时若 Figma 只给 MOUSE_DOWN 属正常）
> - 第 10/12 条实际从**整帧**连线（Screen 帧级触发），REST 读回同时存在
>   controls 实例级连线——两种写法都成立，AI 都能拿到动效
> - 02 页 Controls/Transport 内部 btn/core 的 hover/pressed 连线为
>   motion SEG1 写入的继承连线（属预期）
> Button/Like 的 liked/fanout 是数据态而非交互态，无需连线（MOTION SPEC 标注 tap 100ms 由代码实现）。

## 自动轮播动效（Archive 同款，03 页屏幕循环流转）

恢复 Archive「宇宙剧场 A→B→C→A」的自动轮播：给 03 页三个播放状态屏连
AFTER_TIMEOUT 链式循环，进入原型播放后自动流转、周而复始（与手动 12 条
ON_CLICK 连线共存——不同触发类型互不冲突，同一节点只占一条 AFTER_TIMEOUT）。

| # | 起点 | 终点 | 触发 | 间隔 | 动画 |
|---|---|---|---|---|---|
| A | 03/Screen/NowPlaying/Playing | 03/Screen/NowPlaying/Paused | AFTER_TIMEOUT | 3000ms | Smart Animate 1200ms EASE_IN_AND_OUT |
| B | 03/Screen/NowPlaying/Paused | 03/Screen/NowPlaying/Buffering | AFTER_TIMEOUT | 3000ms | Smart Animate 1200ms EASE_IN_AND_OUT |
| C | 03/Screen/NowPlaying/Buffering | 03/Screen/NowPlaying/Playing | AFTER_TIMEOUT | 3000ms | Smart Animate 1200ms EASE_IN_AND_OUT |

操作：选中起点屏幕帧 → Prototype 面板 → **+ 添加交互**（不是拖拽圆点）→
Trigger 选 **After timeout**，间隔 3000ms → 动效 Smart Animate 1200ms +
ease in-out → 目标帧选终点。三条连完形成闭环，点播放即自动轮播。

> 若只想演示两屏往返（Playing↔Paused），连 A 即可；B/C 可后续补。
> 间隔/时长可在 Prototype 面板随时改，AI 读 REST 时取到的是最终参数。

## 验证（连完后）

```bash
# REST 读回 interactions（应 ≥12 条，分布于 02/03 页节点）
FIGMA_TOKEN=<token> node /tmp/aether-segments/check-interactions.mjs
# 审计（原型连线项从 SKIP 转 PASS）
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit.mjs
```

预期输出：`TOTAL interactions nodes: 12+`，审计「原型连线 ≥ 12」PASS。
