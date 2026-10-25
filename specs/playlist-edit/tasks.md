# 歌单编辑（Playlist Edit） — Tasks

> 关联：`specs/playlist-edit/spec.md` · 来源：产品盘点「该有的」P1「歌单编辑」

## Phase A — 现状核实与规格

- [x] **A1** 逐行核实四层能力，**修正上一轮盘点的说法**：- 后端 `playlist.service.ts:149` `patch(id, {name?, append?, remove?})` ✅ - 接口层 `api.ts:361` `patchPlaylist` ✅ - hook 层 `usePlaylist.ts:81/92/103` `rename`/`append`/`remove` ✅ - **UI 层 ❌** —— `NLPlaylistModal.tsx` 全文只出现 `pl.playlists`（渲染）
      和 `pl.remove_playlist`（删除），三个编辑方法**一次都没被调用**
      ⇒ 缺口精确落在 UI 组件，**不需要动后端 / 不需要动 hook**
- [x] **A2** `specs/playlist-edit/spec.md` —— 产品概念 + 14 条验收 + 不做什么
- [x] **A3** `specs/playlist-edit/tasks.md` —— 本文件
- [x] **A4** 核实 server 的追加去重 key：`platform:trackId`
      （`playlist.service.ts:208` `trackKey`）
- [x] **A5** 核实 server 的移除语义：`drop.has(t.id) || drop.has(platform:trackId)`
      ⇒ **按 item.id 移除会一次干掉同一首歌的 QQ 版 + Spotify 版**（id 相同）

## Phase B — 跨包共享「曲目身份」

- [x] **B1** `packages/common/src/playlist.ts` —— `playlistTrackKey`
      （有 `sources[0]` → `platform:trackId`；否则 → `id`）
- [x] **B2** `packages/common/src/index.ts` —— 导出
- [x] **B3** `packages/common/src/playlist.test.ts` —— 7 条
      （重点：**id 不同但首个音源相同 → key 相同**；真实平台 × 真实 trackId 无碰撞）
- [x] **B4** `packages/server/src/library/playlist.service.ts` —— 改用共享 key
      （删掉私有 `trackKey`），**行为不变**（既有测试原样通过）
- [x] **B5** `packages/server/src/library/playlist.test.ts` —— 补 1 组：
      去重 / 移除按平台身份，不是 item.id

## Phase C — renderer 歌单管理弹窗

- [x] **C1** `packages/renderer/src/components/modals/PlaylistManagerModal.tsx`
  - [x] 标题行 inline 改名（✎ → 输入框 → Enter/失焦保存，Esc 取消）
  - [x] 改名失败**保持编辑态**（用户能直接改），错误条显示服务端原文
  - [x] 防重复提交（`Enter` 后输入框卸载会再触发 blur → 两次 PATCH）
  - [x] 曲目列表（序号 / 标题 / 艺术家 / 时长）+ 每行「×」移除
  - [x] 移除传**平台曲目身份**（不是 item.id）
  - [x] 底部「▶ 播放全部」+「+ 添加歌曲」
  - [x] 添加面板：内嵌统一搜索 → 点「+ 加」逐首加入
  - [x] 「已在歌单」判定用共享 key → 显示「已在歌单」且**不给按钮**
  - [x] 0 首 → 空态文案
- [x] **C2** `packages/renderer/src/components/modals/PlaylistManagerModal.test.tsx`
      —— **19 条**，逐条对应 spec §验收 1–14
- [x] **C3** `packages/renderer/src/components/modals/NLPlaylistModal.tsx` —— 接线
  - [x] 「我的歌单」区每行加「管理」按钮
  - [x] **保留**「点歌单名 = 播放」的既有行为
  - [x] 歌单数据由**持有 `usePlaylist()` 的组件**注入（单一数据源，
        避免两个 hook 实例各持一份 state）
- [x] **C4** `packages/renderer/src/components/modals/NLPlaylistModal.test.tsx`
      —— 补 1 条（「管理」入口 → 打开管理弹窗）

## Phase D — 门禁与验收

- [x] **D1** **变异验证**（3 个）：
  - [x] 移除传 `track.id` 而非 `playlistTrackKey(track)` → 移除用例红
  - [x] 「已在歌单」判定改用 `t.id` → 「已在歌单」用例红
  - [x] 去掉空名校验 → 空名用例红
  - [x] **「变异确实生效」与「门禁确实变红」分开断言**
- [x] **D2** `npm run typecheck` / `npm run lint` 0 error（新文件 0 warning）
- [ ] **D3** 全量套件 `bash scripts/test.sh --ci` → `EXIT=0`（**待跑**）
- [ ] **D4** 覆盖率 diff 门禁绿（本次新增行必须被执行过）（**待跑**）
- [x] **D5** `CHANGELOG.md` + `specs/nl-playlist/spec.md` 的「不做什么」条目更新

## 不在本 spec 范围

- ❌ 歌单内曲目**排序 / 拖拽**（沿用 `specs/nl-playlist/spec.md:188` 的原始边界）
- ❌ 歌单封面图 / 歌单描述
- ❌ 从**搜索结果**一键「加到歌单」（另一个入口，单独一批做，
  避免动 `SearchPanel` 的 theater 布局）
- ❌ 歌单分享 / 导出 / 跨设备同步
- ❌ 批量操作（多选删除、批量重命名）
