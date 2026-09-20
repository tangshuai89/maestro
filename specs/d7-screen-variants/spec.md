# D7 — NowPlaying 三屏改变体（让 Smart Animate 跨状态生效）

> 范围：`03 · Screens` 上 `Screen/NowPlaying/Playing|Paused|Buffering` 原本是**三个独立 frame**，
> 帧与帧之间只能做 dissolve。改成**一个组件集的三个变体**后，变体间连线才能走 Smart Animate
> —— 它会按图层名匹配并补间位置/尺寸/颜色，播放态切换才谈得上"流畅"。
>
> 关联：`docs/prototype-wiring-checklist.md`（第 10-12 条与 A/B/C 的旧写法）、
> `specs/motion-spec.json`（`screen-playing-to-paused` 等 5 条 screen-flow 条目）、
> `scripts/figma-aether-v4-screens.js`（三屏原本由 SEG1/SEG2 建成独立 frame）。

## 1. 为什么必须是变体

Smart Animate 的匹配前提是**跨状态图层名一致**。三个独立 frame 之间没有"同一图层"的概念，
Figma 只能整帧淡入淡出；变体之间才有逐层匹配。这也是 `docs/figma-driven-frontend.md` §3.3
那条"跨变体图层名一致"纪律的用武之地。

## 2. 做了什么

在 `03 · Screens` 上：

1. 把三个 frame 就地转成 COMPONENT（`figma.createComponentFromNode`），变体名 `state=Playing|Paused|Buffering`；
2. `combineAsVariants` 合成组件集 **`Screen/NowPlaying`**（node `516:1884`），定位到原 Playing 的位置 (0,0)；
3. 写 AI_CONTRACT description（含 Smart Animate 的图层名清单）。

## 3. 验收

- [x] `Screen/NowPlaying` 组件集存在，3 变体 `state=Playing|Paused|Buffering`
- [x] **图层名跨变体一致**：8 个同名子层（三屏各自一致），Buffering 另有 1 个 `Tag/Stat`（淡入即可）
- [x] **原型连线一条没丢**：REST `?depth=7` 扫描，转换前 57 个带连线节点 → 转换后 **57**（逐页相同）
- [x] `figma-aether-v4-audit.mjs` **34/36**（1 FAIL + 1 SKIP），与 D2/D10/D5_NEW 基线逐项一致
  —— 屏幕数 18 → 15（阈值 4）；"原型连线 ≥12 — 实际 64 条"未变；03 页绑定率 58% 未变
- [x] 三屏子节点数不变（8 / 8 / 9）

## 4. 不在范围 / 需人工

- **变体间连线本身**：插件 API 写不了 interactions（沙箱规则 6），要把 Playing↔Paused↔Buffering
  真正连起来（含 3 条 AFTER_TIMEOUT 轮播）仍得在 Figma UI 原型模式手连 —— D7 只交付**前提**。
- **另外三个 NowPlaying 系屏幕**（NoLyrics / TrialFallback / RecoUnconfigured）保持独立 frame，
  未并入该组件集（它们不是"播放态切换"，是降级分支）。

## 5. 风险与已知影响

| 项 | 说明 |
|---|---|
| node id 变化 | `createComponentFromNode` **不保留 id**：`314:2/314:1045/314:1237` → `516:1881/1882/1883`。仓库内无硬引用（已 grep 确认），文档按名字引用不受影响 |
| depth 假象 | 转换后变体内的实例深一层，`?depth=5` 会少读到 9 条连线 —— 那不是丢失，用 `?depth=7` 复验为 57 |
| 屏幕计数 | v4 audit 只统计 `type === 'FRAME' && name.startsWith('Screen/')`，故 18 → 15；阈值 4，未破 |
