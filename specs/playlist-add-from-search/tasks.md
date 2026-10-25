# 从搜索结果加到歌单 — Tasks

> 关联：`specs/playlist-add-from-search/spec.md`
> ⚠️ **本 PR stack 在 `feat/playlist-edit` 之上**（base = `feat/playlist-edit`）：
> 「已在歌单」判定复用上游 PR 提到 `@maestro/common` 的 `playlistTrackKey`，
> **同一个函数**，不是各写一份。合并顺序：**#129 → #130**。

## Phase A — 核实

- [x] **A1** 核实「加到歌单」缺口：`specs/playlist-edit/` 的「不做什么」里
      明确把「从搜索结果一键加到歌单」留到了这一批
- [x] **A2** 核实服务端能力**已存在**：`PATCH /library/playlists/:id` 的 `append` + `POST /library/playlists` —— 本 spec **零后端改动**
- [x] **A3** 核实视觉基线**不受影响**：`tests/visual/theater.spec.mjs` 截的是
      `.th-root`（`TheaterView`）空闲态；`SearchPanel` 由 `App.tsx` 在
      `player.searchOpen` 时渲染，是 `TheaterView` 的**兄弟**、**不在 `.th-root` 里**；
      空闲态没有结果行 ⇒ 结果行根本不进截图
- [x] **A4** 核实行尾位置的归属：行尾（最右侧）是**版本展开按钮的专属位**
      （Bug #7 换来的）⇒ 「＋」只能放在它**前面**
- [x] **A5** 核实硬编码颜色门禁：`.sp-add-btn` 沿用 `.sp-ver-toggle` 的
      `color-mix(in srgb, var(--white) …)` 写法 → 不触发
      `scan-hardcoded-colors.mjs`（它只抓 `#hex` / `rgb()` / `hsl()`）

## Phase B — 实现

- [x] **B1** `packages/renderer/src/components/modals/AddToPlaylistDialog.tsx`
  - [x] 歌单列表（名字 + 首数）
  - [x] 每行「+ 加入」/「已在歌单」
  - [x] 「+ 新建歌单并加入」（名字 ≤ 60 字，Enter 提交）
  - [x] 成功反馈「已加入「X」」（**不静默关窗**）
  - [x] 0 个歌单 → 空态引导新建
  - [x] 失败 → 错误条（服务端原文）
  - [x] 「已在歌单」判定用 `playlistTrackKey`（与 server 去重同一个函数）
- [x] **B2** `packages/renderer/src/components/search/SearchPanel.tsx`
  - [x] 结果行加「＋」按钮（**在版本按钮之前**）
  - [x] `stopPropagation()`（整行是 `role="button"` → 点行 = 播放）
  - [x] 无版权的歌也能加（加进去 ≠ 现在能播）
  - [x] 选择器弹窗接线（**只在选中某首时挂载** → 拉列表的请求也只在那时发）
- [x] **B3** `packages/renderer/src/styles/components/_search-panel.scss`
      —— `.sp-add-btn`（玻璃质感，与 `.sp-ver-toggle` 同一套写法）

## Phase C — 测试

- [x] **C1** `AddToPlaylistDialog.test.tsx` —— **9 条**
  - [x] 列表 / 空态 / 无目标
  - [x] 「+ 加入」→ `patchPlaylist(id, {append:[track]})` + 反馈
  - [x] **已在歌单 → 无按钮**（含「id 不同但首个音源相同」这条）
  - [x] 新建歌单 → `createPlaylist({name, tracks, source:'manual'})`
  - [x] 加入 / 创建失败 → 错误条
- [x] **C2** `SearchPanel.test.tsx` —— 补 **2 条**
  - [x] 点「＋」→ 打开弹窗且**不触发播放**
  - [x] 「＋」在版本按钮**之前**（DOM 顺序断言）

## Phase D — 门禁

- [x] **D1** **变异验证**（2 个，「变异生效」与「门禁变红」分开断言）
  - [x] 去掉「＋」的 `stopPropagation` → SearchPanel 用例**必须红**
  - [x] 「已在歌单」判定改用 `item.id` → AddToPlaylistDialog 用例**必须红**
- [x] **D2** `npm run typecheck` / `npm run lint` 0 error（新文件 0 warning）
- [ ] **D3** 全量套件 `bash scripts/test.sh --ci` → `EXIT=0`（**待跑**）
- [ ] **D4** 覆盖率 diff 门禁绿（本次新增行必须被执行过）（**待跑**）
- [x] **D5** `CHANGELOG.md` + `specs/playlist-edit/spec.md` 的「不做什么」条目更新

## 不在本 spec 范围

- ❌ 批量加歌（一次选多首）
- ❌ 右键菜单 / 快捷键加歌
- ❌ 从**专辑页**加歌（只做歌曲结果行）
- ❌ 「加到歌单」弹窗里的歌单搜索 / 排序（歌单多了以后需要）
- ❌ 歌单分享 / 导出
