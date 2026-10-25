# 从搜索结果加到歌单（Add to Playlist from Search）

> **状态**：🚧 进行中 · 来源：产品盘点「该有的」P1「歌单编辑」的**另一半**
> 关联：`specs/playlist-edit/`（歌单管理，本 PR 的**上游**）· `specs/nl-playlist/`（数据模型）

## 背景

`specs/playlist-edit/` 把「歌单**管理**」补上了（改名 / 移除单曲 / 播放全部），
但**攒歌单的入口**仍然只有一条：NL 生成 → 保存为歌单。

现实里攒歌单的动作是「搜到一首歌 → 存起来 → 再搜下一首」。让用户为了存一首歌
先去想一句话（NL）再走「保存为歌单」二次弹窗，是把**顺手的事**做成了**仪式**。

⇒ 本 spec 补上**从统一搜索结果一键加到歌单**。

## 与上游 PR 的关系

本 PR **stack 在 `feat/playlist-edit` 之上**（base = `feat/playlist-edit`）：

- 「已在歌单」判定要用 `platform:trackId` 这个 key（见下），
  而这个 key 是 `specs/playlist-edit/` 提到 `@maestro/common` 的
  `playlistTrackKey` —— **同一个函数**，不是各写一份
  （`AGENTS.md`：跨包工具禁止两端各写一份独立实现）
- 合并顺序：**#129 先合，#130 后合**（#130 的 base 会自动跟到 master）

## 关键设计决定

### ① 「已在歌单」必须按 `platform:trackId` 判，不是 `item.id`

服务端追加时按 `platform:trackId` 去重（`PlaylistService`）。若客户端按 `item.id` 判：

- 客户端：这首不在歌单 → 放行「+ 加入」
- 服务端：这首已在 → 去重跳过
- ⇒ **歌单长度不变、界面无提示** → 用户看到的是「点了没反应」

跨平台合并后的 `item.id` 是**归一 key**，跟平台 trackId 不是一回事 ⇒ 两边必须用同一个函数。

### ② 「＋」按钮放在**版本展开按钮之前**

行尾（最右侧）是版本展开按钮的**专属位**——这是 Bug #7 换来的：
行尾曾经是 ▶ 播放三角，用户把它当「展开箭头」点 → 直接播放。

所以「＋」**不能**抢行尾。放在它前面，版本按钮仍是最右。

### ③ 视觉基线不受影响（已核实，不是猜的）

`tests/visual/theater.spec.mjs` 截的是 `.th-root`（`TheaterView`）**空闲态**：

- `SearchPanel` 由 `App.tsx` 在 `player.searchOpen` 时渲染，是 `TheaterView` 的**兄弟**，
  **不在 `.th-root` 里**
- 空闲态没有搜索结果 ⇒ **结果行根本不进截图**

⇒ 改结果行不会撞视觉基线（`visual` job 不受影响）。新增的 `.sp-add-btn` 用
`color-mix(in srgb, var(--white) …)`（与既有 `.sp-ver-toggle` 同一套写法），
不触发 `scan-hardcoded-colors.mjs` 门禁（它只抓 `#hex` / `rgb()` / `hsl()`）。

### ④ 成功后给**明确反馈**，不静默关窗

加完歌单后弹窗**留在原地**，并显示「已加入「X」」——同时那个歌单会变成「已在歌单」，
用户能直接确认结果，也能顺手再往别的歌单加。

## 范围

### 做

1. **统一搜索结果行**加「＋」按钮 → 打开「加到歌单」选择器
   - 位置：版本展开按钮**之前**
   - `stopPropagation()`：整行是 `role="button"`（点行 = 播放）⇒ 必须拦
   - **无版权的歌也能加**（加进去 ≠ 现在能播）
2. **「加到歌单」选择器弹窗**（新组件 `AddToPlaylistDialog`）
   - 歌单列表（名字 + 首数）
   - 每个歌单右侧「+ 加入」/「已在歌单」
   - 「+ 新建歌单并加入」（名字 ≤ 60 字）
   - 成功反馈「已加入「X」」
   - 没有歌单 → 空态引导新建
3. **不传后端**：`PATCH /library/playlists/:id` 的 `append` 与
   `POST /library/playlists` 都**已存在**（`specs/playlist-edit/` 之前就有）

### 不做

- ❌ 批量加歌（一次选多首）
- ❌ 右键菜单 / 快捷键加歌
- ❌ 从**专辑页**加歌（只做歌曲结果行）
- ❌ 「加到歌单」的排序 / 搜索（歌单多了以后需要，届时另立）
- ❌ 歌单分享 / 导出

## UI 规格

搜索结果行（行尾区域，从右往左）：

```
… 平台chip  [无版权]  ( ＋ )  [ N 个版本 ▾ ]
                              ↑ 新增    ↑ 保持最右
```

选择器弹窗：

```
┌─ 加到歌单 ──────────────────────┐
│ 夜空中最亮的星 — 逃跑计划        │
│ ┌────────────────────────────┐ │
│ │ 夜跑 Electron（12）    + 加入│ │
│ │ 已有那首（3）          已在歌单│ │
│ └────────────────────────────┘ │
│ [+ 新建歌单并加入]               │
└──────────────────────────────────┘
```

## 验收标准

| #   | 标准                                                                       | 判据                                   |
| --- | -------------------------------------------------------------------------- | -------------------------------------- |
| 1   | 结果行有「＋」按钮                                                         | `aria-label="将 <歌名> 加入歌单"`      |
| 2   | 点「＋」→ 打开「加到歌单」弹窗                                             | 弹窗可见                               |
| 3   | 点「＋」**不触发播放**                                                     | `onPlay` 未被调用（`stopPropagation`） |
| 4   | 「＋」在版本按钮**之前**                                                   | DOM 顺序断言                           |
| 5   | 弹窗列出歌单（名字 + 首数）                                                | 与 `listPlaylists` 一致                |
| 6   | 点「+ 加入」→ `patchPlaylist(id, {append:[track]})`                        | 参数一致                               |
| 7   | 加入成功 → 显示「已加入「X」」                                             | 明确反馈，不静默                       |
| 8   | 已在歌单的那首 → 显示「已在歌单」且**无**按钮                              | 判定用 `platform:trackId`              |
| 9   | 「已在歌单」判定：**id 不同、首个音源相同**也算已在                        | 与服务端去重一致                       |
| 10  | 新建歌单并加入 → `createPlaylist({name, tracks:[track], source:'manual'})` | 参数一致                               |
| 11  | 没有歌单 → 空态引导新建                                                    | 有文案                                 |
| 12  | 加入 / 创建失败 → 错误条                                                   | 显示服务端原文                         |
| 13  | 关闭选择器后不残留状态                                                     | 重开是干净的                           |

## 技术约束

- 前端状态用 React hooks（不引 Redux）
- 组件用既有 shadcn `Dialog` / `Button` / `Input`
- 命名空间严守 `sh-` 前缀（`specs/shadcn-migration/spec.md`）
- 外部调用统一走 `packages/renderer/src/api.ts`（不新增 fetch 点）
- renderer 的测试文件**必须 `.test.tsx`**（`.test.ts` 会被 `scripts/test.sh` 的
  ts-node 管道接手 → 整个套件红）
- 视觉基线不受影响（§③ 已核实）

## 文件改动清单

| 文件                                                                   | 动作                      |
| ---------------------------------------------------------------------- | ------------------------- |
| `packages/renderer/src/components/modals/AddToPlaylistDialog.tsx`      | 新建                      |
| `packages/renderer/src/components/modals/AddToPlaylistDialog.test.tsx` | 新建                      |
| `packages/renderer/src/components/search/SearchPanel.tsx`              | 改（行尾按钮 + 弹窗接线） |
| `packages/renderer/src/components/search/SearchPanel.test.tsx`         | 改（补 2 条）             |
| `packages/renderer/src/styles/components/_search-panel.scss`           | 改（`.sp-add-btn`）       |
| `specs/playlist-add-from-search/spec.md`                               | 新建（本文件）            |
| `specs/playlist-add-from-search/tasks.md`                              | 新建（任务跟踪）          |
| `CHANGELOG.md`                                                         | 改（Unreleased 段）       |

**零后端改动**、**零 common 改动**（复用上游 PR 的 `playlistTrackKey`）、**零新依赖**。

## 门禁

- `npm run typecheck` / `npm run lint` 0 error
- renderer 单测（vitest）全绿，**必须核对 `Test Files N` 的 N**
- 全量套件 `bash scripts/test.sh --ci` → `EXIT=0`
- **变异验证**：
  - 去掉「＋」的 `stopPropagation` → 用例 3 **必须红**
  - 「已在歌单」判定改用 `item.id` → 用例 8/9 **必须红**
- 覆盖率 diff 门禁绿（本次新增行必须被执行过）
- `visual` job 仍绿（§③）
