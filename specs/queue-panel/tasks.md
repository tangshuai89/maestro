# 队列面板（Queue Panel） — Tasks

> 关联：`specs/queue-panel/spec.md` · 来源：产品盘点「该有的」P2「队列面板」

## Phase A — 核实与规格

- [x] **A1** 核实队列**数据层 100% 齐备**：
      `usePlayer.ts:238` `queueRef = {tracks, idx, unifiedItems?, loadMore?}`；
      `:254` `queueSnapshot = {idx, items}`（响应式 state）；
      `:1343` `loadNextTrack` 用 `q.idx = (q.idx + 1) % q.tracks.length` 推进
- [x] **A2** 核实队列**UI 完全没有**：全仓 grep「即将播放 / 接下来 / 播放队列 / 队列」
      → 组件目录里没有任何队列面板；`queueUnifiedItems` 的唯一消费者是 `useReco`
      （派生「推荐卡跟随队列位置」）—— **推荐卡知道队列在哪，用户看不到**
- [x] **A3** 核实**传输控件的 CSS 是孤儿**：`control-btn` / `play-btn` 只存在于
      `_transport.scss`，**没有任何 .tsx 在用**（实测 grep 零命中）→ 真正的控制键
      在 Titlebar / MiniPlayer
- [x] **A4** 核实**加 Titlebar 按钮不撞视觉基线**：`tests/visual/theater.spec.mjs`
      截的是 `.th-root`（`TheaterView`）；Titlebar 由 `App.tsx:498` 渲染，是
      `TheaterView` 的**兄弟**、**不在 `.th-root` 里**
- [x] **A5** `specs/queue-panel/spec.md` —— 范围 + 11 条验收 + 四条关键决定

## Phase B — `usePlayer` 的两个操作

- [x] **B1** `jumpToQueueIndex(index)` —— 跳到队列第 N 首
  - [x] 改 `q.idx` + `presentTrack`（**不**用 `playSearch` 重放整条队列）
  - [x] `detectAndApplyLiked`（跳歌和切歌一样要 detect ❤ 角标）
  - [x] 越界 / 无队列 → 不动
- [x] **B2** `removeFromQueue(index)` —— 把第 N 首移出队列
  - [x] **`tracks` 与 `unifiedItems` 一起改**（索引对齐）
  - [x] **显式** `setQueueSnapshot`（`presentTrack` 的同步是「只有 idx 真变了
        才 setState」；移除**非当前**曲目时 idx 不变 ⇒ 不显式推一版，
        队列面板**不会重渲染**）
  - [x] 移除**当前**曲目 → 继续播下一首（最后一首则回到上一首）
  - [x] 移除**别的**曲目 → 当前曲下标跟着前移，播放不中断
  - [x] 移空整个队列 → `queueIdx = -1`
- [x] **B3** `usePlayer.core.test.tsx` —— 补 **7 条**（含「快照必须强制同步」那条）

## Phase C — 面板与接线

- [x] **C1** `packages/renderer/src/components/modals/QueuePanel.tsx`
  - [x] 列表：序号 / 标题 / 艺术家 / 时长
  - [x] **当前曲高亮**（▶ 标记 + `data-current`）
  - [x] 点歌名 → `onJump(index)`；点「×」→ `onRemove(index)`
  - [x] 空队列 / 电台模式 → 两种不同的文案
  - [x] 底部：首数 + 总时长
- [x] **C2** `packages/renderer/src/components/modals/QueuePanel.test.tsx` —— **7 条**
- [x] **C3** `packages/renderer/src/components/layout/Titlebar.tsx` —— 队列入口按钮
      （带首数徽章；**没有队列时 disabled** = 电台模式）
- [x] **C4** `packages/renderer/src/components/layout/Titlebar.test.tsx` —— 补 **2 条**
- [x] **C5** `packages/renderer/src/App.tsx` —— 接线（面板 + `overlayOpen` + 传参）
- [x] **C6** `packages/renderer/src/styles/components/_transport.scss` —— `.queue-btn` + `.queue-count-badge`（与 `.liked-count-badge` 共用一条规则）

## Phase D — 接线层的覆盖（只有浏览器覆盖采集能走到）

- [x] **D1** `scripts/collect-browser-coverage.mjs` —— 采集脚本加队列面板交互
      （开面板 / 跳一首 / 移一首 / Esc 关掉）
      —— **App.tsx 没有单元测试**，接线层只能靠这里覆盖；
      不走一遍的话覆盖率 diff 门禁会报「App.tsx 的新增行没被执行过」

## Phase E — 门禁与验收

- [x] **E1** **变异验证**（3 个，「变异生效」与「门禁变红」分开断言）
  - [x] `removeFromQueue` 不改 `unifiedItems` → 索引对齐用例**必须红**
  - [x] `removeFromQueue` 不显式 `setQueueSnapshot` → 快照同步用例**必须红**
  - [x] `jumpToQueueIndex` 不更新 `q.idx` → 跳歌用例**必须红**
- [x] **E2** `npm run typecheck` / `npm run lint` 0 error（新文件 0 warning）
- [ ] **E3** 全量套件 `bash scripts/test.sh --ci` → `EXIT=0`（**待跑**）
- [ ] **E4** 覆盖率 diff 门禁绿（本次新增行必须被执行过）（**待跑**）
- [ ] **E5** `CHANGELOG.md`（**待写**）

## 不在本 spec 范围

- ❌ 拖拽排序（要同时重排 `tracks` + `unifiedItems` 并修正 `idx`，风险高）
- ❌ 清空队列（语义要先定：清空后当前这首还播不播？直接跳电台？）
- ❌ 队列面板内的搜索 / 筛选
- ❌ 队列跨会话持久化
- ❌ 从队列里「加进歌单」（批次 2 的歌单能力已覆盖，路径不同）
