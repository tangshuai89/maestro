# 播放历史（最近播放）

## 做什么

用户回头找「昨天那首」的**唯一途径** —— 功能盘点 P1（成本 0.5–1 天）：
`播放历史 / 最近播放 · playHistory / 播放历史 → 0 处`（前后端都没有）。

## 现状（实测，master `0bb5860`）

`grep -rn "playHistory\|播放历史" packages/` → **0 处** ⇒ 纯新增。

## 关键设计

### 存在**服务端**（不是 localStorage）

播放历史是**用户数据**，跟 ❤ 库/歌单一样 —— 换 session 就是另一份（互不串），
也进加密备份。**搜索历史**才是本机使用痕迹（走 localStorage，见
`specs/search-history/`）—— 两者刻意不同：一个是"我的听歌记录"，一个是
"这台机器上搜过什么"。

存储键：`history:<sessionId>`（新增到 `SESSION_SCOPED_PREFIXES` ⇒ 死 session
的键会被 GC 回收）。

### 语义：「最近播放」不是「播放流水」

同一首歌再听一次 → **移到最前 + 更新时间，不追加第二条**。流水账对
「找回昨天那首」没用，还会让列表被同一首歌刷屏。

### 记录时机

`usePlayer.presentTrack` 的 **isNewSong** 分支 —— 换歌时记一条。同一首歌的
跨平台降级（`presentFallbackSource` → `presentTrack`）**不记**（否则一次
code=4 降级会在历史里塞三条同一首歌）。

fire-and-forget：记历史失败**绝不能**影响播放。

### 共享类型放 common

`packages/common/src/playHistory.ts` 放 `PlayHistoryEntry` / `mergePlayHistory` /
`normalisePlayHistoryEntry` —— server 存/读、renderer 判定共用一份（AGENTS.md：
跨包类型/工具放 common，两端各写一份必然漂移）。

## 验收标准

- [ ] 服务端：`GET /music/history`（读，空 → 空数组）/ `POST /music/history`（记）
      / `DELETE /music/history`（清）
- [ ] 同一首再记 → 移到最前、不追加第二条
- [ ] session 分片：另一个 session 看不到
- [ ] 脏数据（null / 缺字段 / 非对象）被过滤，读出来是干净的
- [ ] 非法输入（缺 platform/trackId/title/artist）→ 不落库
- [ ] 记录时机 = 换歌；同歌跨平台降级不重复记
- [ ] UI：Titlebar「🕘 最近播放」→ 弹窗列出条目（歌名/歌手/时长/相对时间），
      点一条能播（拼成可播的 unified item），有「清空历史」
- [ ] 单测：common 20 条 + server 7 条 + renderer 10 条 + Titlebar 1 条
- [ ] `npm run typecheck && npm run lint && npm test` 全绿 + 覆盖率 diff 门禁绿
- [ ] 变异验证：去掉去重 → 门禁必须红

## 局限（如实说明）

- 最多留 **200 条**（≈ 重度用户两三天的量）；再往上对「找回昨天那首」没价值，
  只会让 state.json 一直变大。
- **同一首歌重播不重复记**（这是刻意的「最近播放」语义，不是 bug）。
- 历史条目只存**元信息 + 平台/trackId**，不存流地址 —— 播放时用
  `/music/stream/<platform>/<trackId>` 现取（QQ 高音质会退回 standard，
  因为历史里没存 mediaMid）。
