# 队列面板（Queue Panel）

> **状态**：🚧 进行中 · 来源：产品盘点「该有的」P2「队列面板」
> 关联：`specs/desktop-integration/`（媒体键也走队列）· `specs/playlist-edit/`（歌单 → 队列）

## 背景与现状核实

**产品层的问题**：播放队列是用户**完全看不见的黑盒**。

现状核实（2026-10-25，代码逐行核对）：

| 层                 | 状态             | 证据                                                                                                                                                                                             |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 队列**数据**       | ✅ **100% 齐备** | `usePlayer.ts:238` `queueRef = {tracks, idx, unifiedItems?, loadMore?}`；`tracks` 与 `unifiedItems` **索引对齐**                                                                                 |
| 队列**响应式镜像** | ✅ 已有          | `usePlayer.ts:254` `queueSnapshot = {idx, items}`（state）；对外暴露 `queueIdx` / `queueUnifiedItems`（`:2195`）                                                                                 |
| 队列**推进**       | ✅ 已有          | `loadNextTrack`：`q.idx = (q.idx + 1) % q.tracks.length`（`:1343`）                                                                                                                              |
| 队列**UI**         | ❌ **完全没有**  | 全仓 grep「即将播放 / 接下来 / 播放队列 / 队列」→ 组件目录里**没有**任何队列面板；`queueUnifiedItems` 的唯一消费者是 `useReco`（派生「推荐卡跟随队列位置」）——**推荐卡知道队列在哪，用户看不到** |

**用户可见症状**：搜了 20 首点了第 3 首 → 剩下的 17 首在哪？能不能跳到第 7 首？
能不能把第 12 首从队列里拿掉？播完会循环回第 1 首（`% length`）——但用户不知道这件事。

⇒ 补队列面板。**零后端改动**（数据层已 100% 齐备，缺的只是「看得见 + 能操作」）。

## 与上游 PR 的关系

本 PR **独立于** #129 / #130（base = `master`）：改的是 `usePlayer` + 新组件 + Titlebar，
与那两个 PR（歌单相关）**零文件重叠** ⇒ 不会冲突，三者可任意顺序合并。

## 关键设计决定

### ① 「＋」不在本 PR 的范围，但队列是歌单的**播放态**

NL 歌单 / 统一搜索 / 红心库播放时，整份列表都会变成队列。⇒ 队列面板是这三个功能的
**共同出口**——用户在歌单里看到的「12 首」和队列面板里的「12 首」是同一份。

### ② 队列面板放在 **Titlebar**，不放传输条

- Titlebar 由 `App.tsx:498` 渲染，是 `TheaterView` 的**兄弟**，**不在 `.th-root` 里**
  ⇒ 加按钮**不影响视觉基线**（`tests/visual/theater.spec.mjs` 截的是 `.th-root` 空闲态）
- 传输控件（`control-btn` / `play-btn` 那些类名）只存在于 `_transport.scss`，
  **没有任何 .tsx 在用**（实测 grep 零命中）——真正的控制键在 Titlebar / MiniPlayer
  ⇒ 放在 Titlebar 是跟现状一致的落点

### ③ 新操作必须**强制**同步快照（这是个真坑）

`presentTrack` 里的快照同步是**条件式**的：

```ts
setQueueSnapshot((prev) => {
  const newIdx = qSnap?.idx ?? -1;
  if (prev.idx === newIdx) return prev; // ← idx 没变就不 setState
  return { idx: newIdx, items: qSnap?.unifiedItems };
});
```

这个「只有 idx 真变了才 setState」是**故意的**（避免跨平台 fallback 同首重 presentTrack
时无意义 re-render）。但**移除一个非当前曲目的曲目时 idx 不变** ⇒ 快照不更新
⇒ **面板不会重渲染**（用户点了「×」但那一行还在）。

⇒ 新操作**不能复用** `presentTrack` 的条件式同步，必须**显式** `setQueueSnapshot`。
这是本 spec 最容易做错、也最该被测试锁住的一条。

### ④ `tracks` 与 `unifiedItems` **索引对齐**，改一个必须改另一个

`playSearch` 把不可播的曲目从**两个数组里同时**丢掉，保证 `idx` 能同时映射到
`tracks[idx]` 和 `unifiedItems[idx]`（❤ 扇出、检测都靠这个映射）。
⇒ 移除曲目时必须 **splice 两个数组**，只动一个就会让 idx 映射错位
（症状：点第 N 首跳到的歌和面板显示的不是同一首）。

## 范围

### 做

1. **Titlebar 加「☰ 队列」按钮**（带队列首数徽章），**没有队列时禁用**（电台模式）
2. **队列面板弹窗**（新组件 `QueuePanel`）
   - 列表：序号 / 标题 / 艺术家 / 时长
   - **当前播放的那首高亮**
   - 点某首 → 跳到它
   - 每行「×」→ 从队列移除
   - 底部：首数 + 总时长
3. **`usePlayer` 新增两个操作**
   - `jumpToQueueIndex(index)` —— 跳到队列第 N 首
   - `removeFromQueue(index)` —— 把第 N 首移出队列
   - 两者都**显式**同步 `queueSnapshot`（决定 ③）

### 不做（留 v2）

- ❌ 拖拽排序（要同时重排 `tracks` + `unifiedItems` 并修正 `idx`，风险高）
- ❌ 清空队列（语义要先定：清空后当前这首还播不播？直接跳电台？）
- ❌ 队列面板内的搜索 / 筛选（队列一般 20 首以内）
- ❌ 队列跨会话持久化
- ❌ 队列面板的「从队列里加进歌单」（批次 2 的歌单能力已覆盖，路径不同）

## 验收标准

| #   | 标准                                               | 判据                                                          |
| --- | -------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Titlebar 有「队列」按钮                            | 有队列时可点；**无队列时 disabled**                           |
| 2   | 按钮带队列首数徽章                                 | 与 `queueUnifiedItems.length` 一致                            |
| 3   | 面板列出队列全部曲目                               | 序号 / 标题 / 艺术家 / 时长                                   |
| 4   | 当前曲高亮                                         | 当前 idx 那行有标记                                           |
| 5   | 点某首 → 跳到它                                    | `jumpToQueueIndex` 被调 + 播放该首                            |
| 6   | 点「×」→ 移出队列                                  | `removeFromQueue` 被调 + **那一行消失**（不是「移了但还在」） |
| 7   | 移除**非当前**曲目 → 当前曲**不变**                | idx 不变、播放不中断                                          |
| 8   | 移除**当前**曲目 → 继续播下一首                    | 播放不中断、指针前进                                          |
| 9   | 移除后 `tracks` 与 `unifiedItems` **仍然索引对齐** | 跳到第 N 首 = 面板第 N 行                                     |
| 10  | 面板在队列变化后**重渲染**                         | 移除非当前曲目后列表立刻更新（决定 ③）                        |
| 11  | 电台模式（无队列）→ 按钮禁用                       | `queueUnifiedItems === undefined`                             |

## 技术约束

- 前端状态用 React hooks（不引 Redux）
- 组件用既有 shadcn `Dialog` / `Button`
- 命名空间严守 `sh-` 前缀
- **零后端改动**、**零 common 改动**、**零新依赖**
- renderer 的测试文件**必须 `.test.tsx`**
- 视觉基线不受影响（决定 ②）

## 文件改动清单

| 文件                                                          | 动作                                         |
| ------------------------------------------------------------- | -------------------------------------------- |
| `packages/renderer/src/hooks/usePlayer.ts`                    | 改（`jumpToQueueIndex` / `removeFromQueue`） |
| `packages/renderer/src/hooks/usePlayer.queue.test.tsx`        | 新建（两个操作的单测）                       |
| `packages/renderer/src/components/modals/QueuePanel.tsx`      | 新建（面板）                                 |
| `packages/renderer/src/components/modals/QueuePanel.test.tsx` | 新建（面板单测）                             |
| `packages/renderer/src/components/layout/Titlebar.tsx`        | 改（队列入口按钮）                           |
| `packages/renderer/src/components/layout/Titlebar.test.tsx`   | 改（补入口用例）                             |
| `packages/renderer/src/App.tsx`                               | 改（接线：面板 + 传队列数据）                |
| `packages/renderer/src/styles/components/_titlebar.scss`      | 改（按钮样式）                               |
| `specs/queue-panel/spec.md`                                   | 新建（本文件）                               |
| `specs/queue-panel/tasks.md`                                  | 新建（任务跟踪）                             |
| `CHANGELOG.md`                                                | 改（Unreleased 段）                          |

## 门禁

- `npm run typecheck` / `npm run lint` 0 error
- renderer 单测（vitest）全绿，**必须核对 `Test Files N` 的 N**
- 全量套件 `bash scripts/test.sh --ci` → `EXIT=0`
- **变异验证**：
  - `removeFromQueue` 不 splice `unifiedItems` → 用例 9 **必须红**
  - `removeFromQueue` 不强制同步快照 → 用例 10 **必须红**
  - `jumpToQueueIndex` 不更新 `q.idx` → 用例 5 **必须红**
- 覆盖率 diff 门禁绿（本次新增行必须被执行过）
- `visual` job 仍绿（决定 ②）
