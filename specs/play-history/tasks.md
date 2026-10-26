# 播放历史（最近播放）—— 任务清单

对应 spec: `specs/play-history/spec.md`

## 1. 共享类型（common）

- [x] 新建 `packages/common/src/playHistory.ts`：`PlayHistoryEntry` /
      `PlayHistoryInput` / `playHistoryKey` / `mergePlayHistory` /
      `normalisePlayHistoryEntry` / `PLAY_HISTORY_LIMIT`
- [x] `packages/common/src/index.ts` 导出
- [x] `packages/common/src/playHistory.test.ts`（20 条，node:assert 风格）

## 2. 服务端

- [x] `common/storage.ts`：`SESSION_SCOPED_PREFIXES` 加 `history:`
- [x] `music.service.ts`：`historyKey` / `getPlayHistory` / `recordPlayHistory` /
      `clearPlayHistory`
- [x] `music.controller.ts`：`GET/POST/DELETE /music/history`
- [x] `packages/server/src/music/play-history.test.ts`（7 条）

## 3. Renderer

- [x] `api.ts`：`recordPlayHistory` / `fetchPlayHistory` / `clearPlayHistory`
- [x] `usePlayer.ts`：presentTrack 的 isNewSong 分支记一条（fire-and-forget）
- [x] 新建 `components/modals/RecentlyPlayedModal.tsx`（列表 / 相对时间 /
      清空 / 点一条派发 onPlay）
- [x] `Titlebar.tsx`：加「🕘 最近播放」按钮
- [x] `App.tsx`：接线（state + 打开时拉历史 + 挂载弹窗）
- [x] 测试：`RecentlyPlayedModal.test.tsx`（10 条）+ `Titlebar.test.tsx` 补 1 条

## 4. 门禁

- [x] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] 全量套件 + 覆盖率 diff 门禁绿
- [ ] 变异验证：去掉去重 → 门禁必须红
- [ ] PR 合并后核对内容进 master

## 5. 局限（如实记录）

- 最多 200 条；同歌重播不重复记（刻意的「最近播放」语义）
- 历史只存元信息 + 平台/trackId，不存 mediaMid ⇒ QQ 播放退回 standard 音质
