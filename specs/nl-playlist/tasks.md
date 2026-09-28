# NL playlist — Tasks

## Phase A — 服务端

- [x] **A1** `parse-intent` prompt 模板（强约束 JSON 包裹 `<json>...</json>`，库上下文 ≤ 50 首）
- [x] **A2** `parse-intent` service：DeepSeek 调用 + JSON 解析 + 422/429/502 状态码（与 reco 一致）
- [x] **A3** `reco.run` 扩展：接受 `intent?` / `exclude_titles?` / `exclude_artists?`；向后兼容（无 intent 走原路径）
- [x] **A4** `Playlist` 数据模型（crypto.randomUUID() id + `state.json` 里 `playlists:{sessionId}` key）+ storage helper
- [x] **A5** `POST /library/playlists` + `GET /library/playlists` + `GET/DELETE/PATCH /:id`
- [x] **A6** 单测：parse-intent JSON 解析 / fallback / rate-limit；reco.run 扩展字段；Playlist CRUD

## Phase B — 渲染端

- [x] **B1** shadcn `Textarea` 组件复制（ownership 模式，与 PR #92 一致）
- [x] **B2** `NLPlaylistModal` 组件（shadcn Dialog + Textarea + 结果列表 + 覆盖/追加切换）
- [x] **B3** ✨ 入口：lite 模式复用；theater 模式 search 框上方按钮
- [x] **B4** `usePlaylist` hook（拉 / 存 / 删 / 改）+ 最简歌单列表 UI
- [x] **B5** 保存为歌单二次 Dialog（name 输入 + 提交）

## Phase C — 联调 + 验收

- [ ] **C1** Prompt 调试：5–10 个真实场景（"夜跑""慵懒""九十年代摇滚"…）跑通
- [ ] **C2** "排除 / 更多像"约束端到端验证
- [x] **C3** 错误路径：缺 key / 429 / 5xx / JSON parse fail / network — UI 全部友好提示
      > 服务端 5 条路径已在 `nl-playlist.e2e.test.ts` 覆盖（428/429/5xx/502 非 JSON
      > + 400 输入校验）；renderer 侧 NLPlaylistModal 三处 error banner
      > （生成失败 / 歌单操作失败 / parse-intent 400）均 fail loud 不静默。
- [x] **C4** e2e：输入 → 队列 → 播放 → 保存歌单 → 重开仍在
      > 自动化部分（`nl-playlist.e2e.test.ts`，上游 DeepSeek 全 stub 不出网）：
      > parse-intent happy path + 库上下文进 prompt + 歌单 CRUD 全链路 + 错误路径。
      > **未覆盖**：「≥10 首可播队列」与「跨平台回填命中率」需真实 DeepSeek key +
      > 出网，属 C1 人工环节。

## 排期

| commit | 内容 | 估时 |
|---|---|---|
| 1 | A1+A2 | 0.5d |
| 2 | A3 | 0.5d |
| 3 | A4+A5 | 0.5d |
| 4 | A6（单测） | 内含在 A1-A5 |
| 5 | B1+B2+B3 | 1d |
| 6 | B4+B5 | 0.5d |
| 7 | C1-C4 | 1d |
| **总** | 7 commit / 1 PR | **4d** |

## 不在本 PR 范围（v2 留）

- 语音输入
- 多轮对话
- 实时流式输出
- 歌单编辑完整 UI（拖拽排序 / 批量操作）
- 跨设备同步
- LLM 选曲（仍由 DeepSeek prompt 一次性出 `{title,artist}[]`）
