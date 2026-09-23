- [x] 1. 抽 `QqMusicProvider.detectVipLocked(pay, qqVip)` 私有方法：
      - pay_album===1 / pay_track===1 / fee>0 任一命中 → true
      - 仅 pay_play=1 → qqVip!==true
      - 其余 → false
      实现为模块顶层 `detectQqVipLocked` 函数（更便于单测，spec 写法是 private method，
      但顶层函数可达同样目的且不需要实例化 QqMusicProvider）
- [x] 2. 扩 `SearchResponse.pay` interface（qq.provider.ts）加
      `pay_album` / `pay_track` / `pay_download` / `fee` 字段
- [x] 3. 改 `qq.provider.ts:519-520` 调 detectQqVipLocked
- [x] 4. 抽 `detectNeteaseVipLocked(p)` 顶层函数（netease.provider.ts）：
      fee>0 → true；否则保留旧 `pl>0` 判据
- [x] 5. 改 `netease.provider.ts:319` 调新函数
- [x] 6. 写单测：`qq.provider.test.ts` 加 13a-13f（数字专辑 VIP/非 VIP / 付费
      单曲 / fee>0 / pay 缺失 / fee=0 兜底误伤防护，共 6 项）
- [x] 7. 写单测：`netease.provider.test.ts` 加 15a-15d（数字专辑 / 免费回归 /
      VIP 付费单曲 / pl 缺失兜底，共 4 项）
- [x] 8. 跑 `npm run typecheck && npm run lint && npm test`，全绿（196 + 各
      e2e suite 全过，0 failed）
- [ ] 9. 端到端：本地启 server 模拟「台北车站」搜索，确认 bestSource 正确避开
      数字专辑源（手动复现 — 留给用户自己跑）
- [x] 10. renderer 侧同症状第二根因（接手后续修）：`searchOne`（单平台模式）
      映射的 UnifiedSearchItem `versions: []`，而 SearchPanel.handleRowClick
      播的是 `item.versions[0]` → undefined → 静默 return，单平台模式每行
      点击都不播放。修法：versions 填一条指向自身的 VersionEntry + vipLocked
      透传（api.ts），api.test.mjs 加 #38 回归。
