# 试听升级 / 播放兜底：候选实探 —— 任务清单

对应 spec: `specs/trial-source-fallback/spec.md`

## 1. 根因取证（2026-10-26 用户实测「又出现 29 秒」）

- [x] 复现现场：Deezer 30s 试听 + QQ 死 mid（`0019n4uH2jsLcq`，GetVkey 无 purl）
- [x] 直查运行中的服务端 `/music/equivalents` → 返回的正是那个刚失败的死 mid
- [x] 用本机真实凭据逐个实探候选，确认**可播源一直存在**：
      QQ `0012pLSk373qDS` / `003QXtcO0CKyjE` / `002GMHid3295Om` 有流；
      网易云 `528685` / `2163851150` / `2606324669` 有**完整流**（元数据却标 vipLocked）

## 2. 服务端（`packages/server/src/music/music.service.ts`）

- [x] `matchEquivalentTrack` 改 async，新增可选 `accept` 实探回调；
      命中后 `accept` 拒绝就**继续试同 tier 的下一个候选**（tier 严格度不变）
- [x] `searchEquivalentUncached` / `searchEquivalent` 透传 `accept`；
      传了 `accept` 就**绕开结果缓存**（缓存里只有首个命中）
- [x] `findPlayableEquivalent` 跨平台分支：候选逐个实探，第一个真能出声的才返回
- [x] `findPlayableEquivalent` 同平台分支：改用 `accept` 回调实探（不再「先取后探」）
- [x] 网易云**不再按 `vipLocked` 元数据一票否决**（实探过就是能出声）
- [x] QQ 仍按 `vipLocked` 元数据拒（QQ 的 30s 试听流实探分不出来）

## 3. 客户端（`packages/renderer/src/hooks/usePlayer.ts`）

- [x] `tryUpgradeFromTrial`：删掉**平台级**黑名单，保留**曲目级** `triedTrackIdsRef` 守卫
- [x] `tryFallbackSource`：同上

## 4. 测试

- [x] 新增 `packages/server/src/music/trial-source-fallback.test.ts`（5 条）1. 首个候选实探不过 → 换同 tier 的下一个可播候选 2. 网易云 vipLocked=true 但实探出完整流 → 不再被元数据一票否决 3. 全部候选实探不过 → null + reason=stream-failed 4. QQ vipLocked 候选 → 仍按元数据拒 5. 普通等价搜索（❤ 同步路径）不做实探（不引入额外网络开销）
- [x] 补 `packages/renderer/src/hooks/usePlayer.behavior.test.tsx`（3 条）1. 试听升级：服务端返回**同平台的另一个 trackId** → 必须切过去（用户实测形状）2. 试听升级：服务端返回**没试过的平台** → 照常升级 3. 试听升级：服务端返回的源**已经试过** → 不换源（防循环）
- [x] 补 `packages/server/src/music/cross-platform-match.e2e.test.ts` 的 netease mock
      （缺 `probeFullStream` —— 真实 provider 有；实探路径会用到）
- [x] 既有 40 条 e2e 断言全绿

## 5. 变异验证（改坏必须红）

- [x] **变异 1（服务端）**：跨平台分支去掉 `accept` 回调（= 不实探 = 原始 bug）
      → `trial-source-fallback.test.ts` 精确红：
      `❌ 第一个候选实探不过 → 必须换同 tier 的下一个可播候选，而不是把死 mid 推回去`
- [x] **变异 2（客户端）**：把平台级守卫加回去
      → `usePlayer.behavior.test.tsx` 只有新用例 1 红（其余 29 条仍绿）：
      `AssertionError: expected 'td-preview' to be 'tq-alive'`
- [x] 两次变异均已回滚，`grep MUTATION` 无残留，回滚后两个套件全绿

## 6. 门禁

- [x] `npm run typecheck` 全绿
- [x] `npm run lint` 全绿（PR #133 的 CI `Lint` 步 success）
- [x] 全量套件 `bash scripts/test.sh --ci` → **EXIT=0**（PR #133 的 CI `Run tests` 步 success）
- [x] 覆盖率 diff 门禁（base = `994582b`）→ ✅ 本次改动的代码全部被执行过（PR #133 的 CI `Coverage diff gate` 步 success）
- [x] PR 合并后核对内容进 master（PR #133 已合入 master ✅）

## 7. 局限（如实记录，不假装解决）

- **QQ 的 30s 试听流服务端分不出来**：`getStreamPath` 对 VIP 试听曲照样给 purl，
  服务端拿不到「这是 30 秒」的信号 → QQ 的试听识别仍靠 renderer 的运行时
  「实际时长 ≪ 元数据全长」判定。服务端这层只能挡住「压根没 purl」。
- **Spotify 全曲流要靠 WPS**（Premium 才成立），服务端等价源路径给不了 WPS 源。
- 本次只修「兜底链选错源」；**搜索期**的付费识别仍是
  `specs/paid-album-detection` 的职责（且对 QQ 付费 mid 天然无解 —— 接口不返字段）。
