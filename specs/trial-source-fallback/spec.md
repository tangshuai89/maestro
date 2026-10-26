# 试听升级 / 播放兜底：候选必须**实探**，不能「取首个命中就返回」

## 做什么

修一个**复发性** bug：用户点一首歌，只播 **29 秒**就停（界面显示 `00:11 / 00:29`

- `30S TRIAL` 角标），期望是全曲。

同一个症状在 `specs/paid-album-detection` 里已经修过一次（那是**搜索期**的
付费标记识别），本 spec 修的是**播放兜底链**——搜索期判对了也照样会卡住。

## 症状与现场

2026-10-26 用户实测（截图 + 服务端日志）：

```
[audio] "Drip Dry Eyes" 在 qq 播放失败，自动切到 deezer 源
GET /music/equivalents?provider=deezer&title=Drip+Dry+Eyes&artist=YUKIHIRO+TAKAHASHI&duration=330&trackId=1543760812
searchEquivalent netease title-exact match [original]: "DRIP DRY EYES - 高橋幸宏" (dur=330≈338, version=studio)
searchEquivalent qq    exact match [original]: "Drip Dry Eyes - YUKIHIRO TAKAHASHI"
searchEquivalent spotify cross-script title match [original]: "ドリップ・ドライ・アイズ - 2021 …" (dur=330≈331)
→ 没有任何「升级」日志 → 29 秒试听播到头就结束了（09:22:26 → 09:22:55 = 29s）
```

时长链：QQ `0019n4uH2jsLcq`（330s）GetVkey **无 purl** → `code=4` → 降级到
Deezer 的 30s 预览 → 试听升级链路**没走通** → 卡在 29 秒。

## 根因（两层，缺一不可）

### 层 1（服务端，主因）：跨平台分支**不实探**，把死源推给前端

`MusicService.findPlayableEquivalent` 的跨平台分支是「按渠道优先级取**首个**
命中就返回」：

```ts
for (const p of priority) {
  const t = hit?.[1];
  if (!t) continue;
  if (t.vipLocked === true) { sawLocked = true; continue; }   // ← 只信元数据
  return { source: { platform: p, trackId: t.id, … } };         // ← 不实探
}
```

同平台分支有 `probePlayable` 实探，跨平台分支**没有** —— 这个不对称就是 bug。

实测（2026-10-26，用本机真实凭据直查）：

| 候选                                      | 元数据            | 实探               | 结论     |
| ----------------------------------------- | ----------------- | ------------------ | -------- |
| QQ `0019n4uH2jsLcq`（330s，统一项里那个） | `vipLocked=false` | ❌ GetVkey 无 purl | **死源** |
| QQ `0012pLSk373qDS`（331s，同歌另一版本） | `vipLocked=false` | ✅ 出流            | **可用** |
| QQ `003QXtcO0CKyjE`（280s）               | `vipLocked=false` | ✅ 出流            | 可用     |
| 网易云 `528685`（338s，标题精确匹配）     | `vipLocked=true`  | ✅ **完整流**      | **可用** |
| 网易云 `2163851150` / `2606324669`        | `vipLocked=true`  | ✅ 完整流          | 可用     |
| Spotify `5xDD6xL65xH0WugjRaX6E7`          | `vipLocked=true`  | ❌ 无预览          | 不可用   |

即：**可播的全曲源一直都在**，但服务端按优先级先撞上 QQ 那个死 mid 就返回了，
把后面的网易云完整流、QQ 其它 mid **全部遮蔽**。

而且元数据两头都不可信：

- **QQ 搜索不返 `pay_album` / `pay_track`**（见 `qq.provider.ts` 的 `QqPay`
  注释）→ 付费/无版权的 mid 被标成 `vipLocked=false`，点进去才发现没 purl。
  所以「搜索期判付费」这条路对这类歌**无解**。
- **网易云 `vipLocked`（`fee>0`）与真实可播性不一致**：实测 `528685` 标
  `vipLocked=true`，`probeFullStream` 却拿到**完整流**。旧代码按元数据一票
  否决 → 把一个真正能播的源扔了。

### 层 2（客户端，次因）：平台级黑名单把「同平台的另一个可播版本」一起拒了

`usePlayer.tryUpgradeFromTrial` / `tryFallbackSource` 的守卫是**平台级**的：

```ts
if (src && fullProviders.includes(src.platform)
    && !triedTrackIdsRef.current.has(`${src.platform}:${src.trackId}`)
    && (!triedPlatformsRef.current.has(src.platform) || sameProviderAlt)) { … }
```

`triedPlatformsRef` 里有 `qq`（第一次就是 QQ 失败）→ 即使服务端这次返回的是
**QQ 的另一个 mid**（`0012pLSk373qDS`），客户端也会以「该平台本首歌已试过」
为由拒掉。**唯一那条活路被自己堵上了。**

（`sameProviderAlt` 只在「当前源平台 == 返回源平台」时放行 —— 本场景当前源是
Deezer，返回源是 QQ，条件不成立。）

### 为什么这次客户端拒得其实是对的

层 2 的守卫在旧语义下**拦对了**：服务端返回的就是那个刚失败的 mid，换过去
也是 code=4，白白烧掉一次性兜底。**但它连「同平台的另一个 mid」一起拦了**，
而那才是解法。正确分工应该是：

- **服务端**：只返回**实探过、真能出声**的源。
- **客户端**：只拦**同一个源**（曲目级 `triedTrackIdsRef`），平台级循环由
  「每首歌只问一次服务端」的一次性守卫兜住。

## 验收标准

- [ ] 跨平台分支的候选**逐个实探**：实探不过就换**同 tier 的下一个**候选，
      而不是「取首个命中就返回」
- [ ] 实探判据按平台区分：- QQ：`getStreamPath` 能出 purl；`vipLocked=true` 仍按元数据拒（QQ 的
      试听流实探分不出来 —— GetVkey 照给 purl）- 网易云：`probeFullStream`（要求**完整流**，`freeTrialInfo` 不算）- Spotify / Deezer：无「全曲流」语义 → 不作为兜底目标（维持原行为）
- [ ] 网易云**不再按 `vipLocked` 元数据一票否决** —— 实探过就是能出声
- [ ] `matchEquivalentTrack` 的 `accept` 回调只在**同一个 tier 内**换候选，
      匹配严格度不放松（不会退到更松的 tier 去匹配别的歌）
- [ ] 客户端两处守卫（`tryUpgradeFromTrial` / `tryFallbackSource`）**只按曲目级
      拦截**，不再按平台级拉黑
- [ ] 循环防护仍在：服务端一次性守卫（`serverEquivTriedRef` /
      `trialServerTriedRef`）+ 客户端曲目级守卫（`triedTrackIdsRef`）
- [ ] 实测复现路径（QQ 死 mid → Deezer 30s 试听 → 升级到同歌可播 mid）走通
- [ ] `npm run typecheck && npm run lint && npm test` 全绿 + 覆盖率 diff 门禁绿
- [ ] 变异验证：把「实探」改回「不实探」→ 门禁必须红；把客户端守卫改回
      「平台级拉黑」→ 门禁必须红

## 实现方案

### 服务端（`packages/server/src/music/music.service.ts`）

1. `matchEquivalentTrack` → `async`，新增可选 `accept?: (t: Track) => Promise<boolean>`。
   每个 tier 的循环里，命中之后先问 `accept`：`false` 就 `continue` 试**同 tier
   的下一个**候选（tier 严格度不变）。
2. `searchEquivalentUncached` / `searchEquivalent` 透传 `accept`。
   **传了 `accept` 就绕开结果缓存**（缓存里只有首个命中，拿不到同 tier 的其它
   候选）—— 与既有的 `excludeIds` 绕缓存是同一条理由。
3. `findPlayableEquivalent` 跨平台分支：把 `probe` 回调交给 `searchEquivalent`
   作为 `accept`；`vipLocked` 元数据否决只保留给 QQ。

### 客户端（`packages/renderer/src/hooks/usePlayer.ts`）

4. `tryUpgradeFromTrial` / `tryFallbackSource`：删掉平台级守卫，保留曲目级
   `triedTrackIdsRef` 守卫。

## 局限（诚实说明）

- **QQ 的 30s 试听流分不出来**：`getStreamPath` 对 VIP 试听曲照样给 purl，
  服务端拿不到「这是 30 秒」的信号 → QQ 的试听识别仍靠 renderer 的
  「实际时长 ≪ 元数据全长」运行时判定。服务端这层只能挡住「压根没 purl」。
- **Spotify 全曲流要靠 WPS**（Premium 才成立），服务端等价源路径给不了
  WPS 源；`getFullSongProviders` 已按 `tier + wpsReady` 双重条件把 Spotify
  排除在非 Premium 场景之外。
- 本 spec 只修「兜底链选错源」；**搜索期**的付费识别仍是
  `specs/paid-album-detection` 的职责（且对 QQ 付费 mid 天然无解 —— 接口
  不返字段）。
