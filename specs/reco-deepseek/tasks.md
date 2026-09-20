- [x] 1. packages/server/src/reco/reco.service.ts: DeepSeek fetch 包装 + JSON 解析 retry + 429/5xx 分类
- [x] 2. RecoService: 拿 library → 拼 prompt → 调 DeepSeek → 解析 → 用 P0 统一搜索 fill 平台源
- [x] 3. Controller: GET /reco/status, POST /reco/run, POST /reco/key
- [x] 4. reco/reco.module.ts 注册并 import 到 app.module.ts
- [x] 5. key 持久化: .storage/secrets.json (走 StorageService，git-ignored)
- [x] 6. 前端 api.ts: fetchRecoStatus / runReco / saveRecoKey
- [x] 7. RecoKeyModal: 内联组件，key 输入 + 保存（不抽独立文件）
- [x] 8. 主界面加 "🎲 推荐" 按钮 + 未配 key 红点提示
- [x] 9. 白盒测试 12 条：响应解析（4 种形态）/ 推荐去重（库内 + 内部）/ prompt 拼装 / key 校验
- [x] 10. typecheck + 全量测试（search 12 + match 8 + reco 12 = 32 条）全绿
- [x] 11. e2e smoke: 5 个 case（status / no key 412 / 短 key 400 / set key 200 / no lib 400）
- [x] 12. auto-continue：播到最后一首自动取下一批续播（不循环回第一首）——
      queueRef.loadMore + useReco loadMore；服务端 exclude 去重（reco.test #13）
- [x] 13. 推荐质量调优 v1.1（#1~#7）：填源匹配校验 + 并行补位 + 库随机采样 +
      超额要 + session 历史去重 + prompt 强化 + 统一 normalizeKey（reco.test #14~16）
- [x] 14. 封面抽取兜底：候选无封面 → 跨平台探测（MusicService.fetchCoverFallback）+
      normalizeKey 缓存；合并层跨源抽取（search.util buildUnifiedItems 同簇取首个有封面）
      ——reco.test #24/#25 + search.test #9/#10 覆盖
- [x] 15. `reco/taste-profile.ts`：艺人亲和度 + 稳定 anchors + 亲和度加权种子采样
      （P0-a；reco.test #26/#27/#28）
- [x] 16. `reco/version-filter.ts`：把 VERSION_BAD/VERSION_SOFT/时长规则从 RecoService
      抽成共享纯函数（候选池与填源共用同一口径）
- [x] 17. `reco/candidate-pool.ts`：相邻艺人 + 同艺人深挖 + 平台 FM 三源候选池，
      去重/剔库/单艺人上限（P0-c；reco.test #29/#30）
- [x] 18. Deezer `fetchRelatedArtists` + MusicService `findRelatedArtists` /
      `fetchRecoRadioCandidates`（fail-soft，单平台失败不阻塞）
- [x] 19. RecoService 改「挑选 + 排序」：`buildSelectPrompt` / `parseSelection`（下标
      白名单）+ 候选池不足/解析失败回退自由生成 + 同艺人 ≤2（reco.test #31/#32/#33）
- [x] 20. run 响应加 `mode` / `candidateCount`；typecheck + lint 全绿，全量测试
      除 `music.controller.e2e` #3（沙箱无 DNS，QQ 搜索走真网络）外全绿
