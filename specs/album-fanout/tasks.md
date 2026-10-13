# Album fan-out — 任务清单

> 配 [`spec.md`](./spec.md)。每完成一项勾一条；开工前先读 spec 的「验收标准」
> 段确认 scope 没漂。

## 0. 准备

- [ ] 0.1 grep `~/Music/` 有无 album fan-out / collect album / album save 历史决策
- [ ] 0.2 复核 `MusicProvider.hasAlbumSaveApi` 是否已就位（推测在 `provider.ts`）
- [ ] 0.3 读 `specs/heart-fanout/spec.md` + `specs/match-engine/spec.md` 复习复用模式

## 1. 归一键（packages/common/src/normalizer.ts 增量）

- [ ] 1.1 加 `normalizeAlbumKey(album, artist, year?)`：复用 `normalizeKey` 流水线 + `|y${year}` 后缀
- [ ] 1.2 加 `normalizer.test.ts` 覆盖：
  - 同专辑名 + 同 year → 同 key
  - 同专辑名 + 不同 year → 不同 key
  - 同专辑名 + 都缺 year → 同 key（fallback）
  - 全角 → 半角、`(Deluxe)` 保留（catalog 级）
  - CJK 跨写法（周杰伦 vs 周杰倫）→ 同 key

## 2. 跨平台专辑匹配（packages/server/src/match/match.service.ts 增量）

- [ ] 2.1 加 `findEquivalentAlbum(seed: Album)`：主键 `normalizeAlbumKey` +
      兜底 `trackCount ±1` + `totalDuration 差 ≤ 60s` + `track 名顺序匹配率 ≥ 70%`
- [ ] 2.2 加 `mergeAlbumLibrary(albums: Album[])`：复用 `search.util.ts` 的
      `dedupAlbums + buildUnifiedAlbums`（后者本任务一并实现）
- [ ] 2.3 加 `search.util.ts` 的 album dedup + build（与现有 track dedup 同构）
- [ ] 2.4 `match.test.ts` 覆盖：
  - 四平台同名专辑同年 → merge 到同一 UnifiedAlbum
  - `(Deluxe Edition)` vs 原版 → **不**合并（版本差异保留）
  - 跨语言（CJK vs Latin）专辑名 → 同 key 合并
  - trackCount 差 > 2 → 不合并（视为不同版本）

## 3. MusicProvider.hasAlbumSaveApi（packages/server/src/common/provider.ts 增量）

- [ ] 3.1 `qq: false`（无公开 API）
- [ ] 3.2 `netease: true`
- [ ] 3.3 `deezer: false`
- [ ] 3.4 `spotify: true`
- [ ] 3.5 provider 静态单元测试：每平台实现 toggleAlbumSave(session, albumId, saved)
      （NetEase / Spotify 各写一个最小 happy-path，回归 e2e）

## 4. fan-out 业务逻辑（packages/server/src/music/music.service.ts 增量）

- [ ] 4.1 加 `fanOutAlbumSave(session, mergedAlbumId, sources, saved)`：循环
      `toggleAlbumSave`，收集 `fannedOutTo`，写 `albumFanOut` 字段
- [ ] 4.2 加 `toggleAlbumSave(session, provider, albumId, saved)`：per-platform 写
      + 同步到 `albumsByPlatform`
- [ ] 4.3 `loadState` / `saveState` 扩展支持 `albumFanOut` 字段
- [ ] 4.4 失败策略：单平台失败 → fannedOutTo 不含 + 整体 success=true
- [ ] 4.5 结构性跳过：hasAlbumSaveApi=false / 未登录 → **不写入** albumFanOut
      （避免假收藏污染 + 角标虚高）

## 5. Controller（packages/server/src/music/music.controller.ts 增量）

- [ ] 5.1 加 `POST /music/album/save/merged` 端点
- [ ] 5.2 加 `POST /music/album/save/:albumId?provider=netease` 端点
- [ ] 5.3 验证 sources 非空 + mergedAlbumId 缺失 → 400

## 6. 类型（packages/server/src/music/types.ts 增量）

- [ ] 6.1 `Album` / `UnifiedAlbum` / `FanOutAlbumSaveRequest` /
      `FanOutAlbumSaveResponse` 定义（按 spec.md §「类型定义」）

## 7. Renderer API 封装（packages/renderer/src/api.ts 增量）

- [ ] 7.1 加 `fanOutAlbumSave(mergedAlbumId, sources, saved)` 方法
- [ ] 7.2 加 `toggleAlbumSave(albumId, provider, saved)` 方法
- [ ] 7.3 `api.d.ts` 类型同步（如果存在）

## 8. UI 接入（packages/renderer/src/ 增量）

- [ ] 8.1 SearchPanel 专辑徽章 / 卡片：点击触发 fanOutAlbumSave
- [ ] 8.2 已 fan-out 的专辑显示角标（"2❤"）
- [ ] 8.3 detect：进入专辑视图时后台 `findEquivalentAlbum` 补齐其它平台

## 9. 测试

- [ ] 9.1 白盒：`normalizer.test.ts` + `match.test.ts` 覆盖专辑场景
- [ ] 9.2 白盒：state 序列化 + 幂等反写（不动未收藏过的平台）
- [ ] 9.3 e2e：nest 启动后 curl `/music/album/save/merged` 验证 happy / validation / unsave / single-platform / 结构性跳过 路径
- [ ] 9.4 `npm run typecheck` 通过
- [ ] 9.5 `npm test` 全量绿

## 10. 知识库沉淀（完工后）

- [ ] 10.1 `~/Music/maestro/album-fanout.md`：设计要点 + 复用决策 + 平台能力矩阵
- [ ] 10.2 `~/Music/maestro/spotify.md` 增量记 "album save endpoint" 一节
- [ ] 10.3 `~/Music/maestro/maestro-frontier.md`（若有）补一节：本 sheet 与
      heart-fanout 的对比表

## 估时汇总

| 阶段 | 估时 |
|---|---|
| 0–1 | 1 天（准备 + 归一键） |
| 2 | 1 天（匹配引擎） |
| 3 | 0.5 天（provider 能力矩阵） |
| 4–5 | 1 天（service + controller） |
| 6–7 | 0.5 天（类型 + api.ts） |
| 8 | 0.5 天（UI） |
| 9 | 1 天（测试） |
| 10 | 0.25 天（知识库） |
| **合计** | **~4.75 天** |