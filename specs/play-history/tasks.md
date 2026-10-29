# 播放历史（最近播放）—— 任务清单

对应 spec: `specs/play-history/spec.md`

## 1. 共享类型（common）

- [x] 新建 `packages/common/src/playHistory.ts`：`PlayHistoryEntry` /
      `PlayHistoryInput` / `playHistoryKey` / `mergePlayHistory` /
      `normalisePlayHistoryEntry` / `PLAY_HISTORY_LIMIT`
- [x] `packages/common/src/index.ts` 导出
- [x] `packages/common/src/playHistory.test.ts`（20 条，node:assert 风格）

## 2. 服务端

- [x] `packages/server/src/common/storage.ts`：`SESSION_SCOPED_PREFIXES` 加 `history:`
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
- [x] `npm run lint` 全绿（0 error；16 个 warning 是仓库既有的）
- [x] 全量套件 `bash scripts/test.sh --ci` → EXIT=0（59 个 vitest 文件 / 740 条用例 + node 管道）
- [x] 覆盖率 diff 门禁（base = `7cc96ce`）→ ✅ 本次改动的代码全部被执行过
- [x] 变异验证：去掉 `mergePlayHistory` 的去重 → **红**（断言1 文件内容确实变了；
      断言2 common 的 `playHistory.test.ts` 2 failed；断言3 server 的
      `play-history.test.ts` ERR_ASSERTION 4≠3 —— **server 侧走的是 common 的
      `dist/`，验这个变异前必须先 `npm run build` 重建 dist**，否则测的是旧产物）
- [x] PR 合并后核对内容进 master（PR #137 已合；master 里有 `packages/common/src/playHistory.ts` + `packages/server/src/music/play-history.controller.e2e.test.ts` ✅）

## 4b. 覆盖率 diff 门禁抓出来的**三个真缺口**（已补）

- [x] `music.controller.ts` 的三个端点从没被 HTTP 层调过 → 新增
      `play-history.controller.e2e.test.ts`（17 条）
- [x] `api.ts` 的 `fetchPlayHistory` / `clearPlayHistory` 从没被调过 →
      `api.test.mjs` 补 10 条
- [x] `App.tsx` 的 `openRecent` + 弹窗挂载 + `onPlay` 是纯接线层 →
      `collect-browser-coverage.mjs` 补三步（开 → 点一条播放 → 清空）

## 4c. 顺带修掉的**两个覆盖率工具链 bug**（不是本 feature 的事，但本 PR 的门禁依赖它们）

- [x] `scripts/lib/lcov.js`：同名函数的「后写覆盖」把真命中盖成 0
      → 按 lcov 规范平行数组配对 + 命中取 max（反向验证：拆掉两道防线 → 自测红 4 项）
- [x] `scripts/test.sh`：node 管线按包分目录采集（同一文件被两种方式加载时，
      行号空间不同 → c8 的逐文件合并让 0 命中覆盖真数据）

## 5. 局限（如实记录）

- 最多 200 条；同歌重播不重复记（刻意的「最近播放」语义）
- 历史只存元信息 + 平台/trackId，不存 mediaMid ⇒ QQ 播放退回 standard 音质
