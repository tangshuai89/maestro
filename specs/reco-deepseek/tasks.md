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
- [x] 21. 延迟包 L1：候选池阶段并发化（TaskPool 边查边搜）+ 顺序确定性测试
- [x] 22. 延迟包 L2/L3：LLM `max_tokens` + prompt 候选/采样行数上限 + 配额下调
- [x] 23. 延迟包 L4/L5：候选池缓存（10min + exclude 就地过滤）+ 分阶段 timings
      （日志 + run 响应）
- [x] 24. 延迟包 L6：RecoLoading 按真实耗时推阶段 + 已等待秒数
- [x] 25. `reco/signals.ts`：信号权重/衰减/防抖/负样本/拉黑 + 单测
- [x] 26. `POST /api/reco/signal`（单条 + 批量，脏数据 2xx）+ controller e2e #9–11
- [x] 27. 前端上报：usePlayer 播放/完播/早切/红心/踩 五处 + api.reportRecoSignal
      （fire-and-forget）
- [x] 28. 信号折进口味档案（有界加权）与负反馈闭环（负样本排除 + 艺人拉黑）
- [x] 29. 种子模式：run(seed) 围绕种子艺人 + prompt 点明 + seed 信号 +
      TheaterView「像《歌名》一样」入口
- [x] 30. `reco/eval.ts`：留一法纯函数（切分/召回/MRR/分档/多样性/报告/基线对比）
- [x] 31. `RecoService.evaluate`：真实流水线 + noCache（不污染产品池缓存）+
      pool/llm 双模式
- [x] 32. `POST /reco/eval` + CLI `npm run reco:eval`（只读 state.json；--save/--compare
      做基线回归追踪）
- [x] 33. 测试：eval.test 5 组 + reco.test #46/#47（真召回 / 检索全空必须 0）
- [x] 34. **2026-09-21 bug 修复**：
      - Bug #1「像《歌名》一样」胶囊在 1200×800 窗口底部被切：挪到 `.th-reco-head`
        行内右对齐（`.th-reco-head-actions` flex 容器，head `min-height: 30px` 锁高
        防止按钮出现/消失时整体跳动）；同步把 `.th-footer-version` 从 `bottom: 20px`
        收到 `bottom: 2px`，让 cards 底 ≈ footer 顶 ≈ y=886（垂直链约束保持 ~868 不破）
      - Bug #2 推荐卡不更新：`usePlayer` 新增 reactive `queueIdx` + `queueUnifiedItems`
        （presentTrack / switchToProvider / resetForSwitch 都同步 setSnapshot）；
        `useReco` 删掉 `suggestions` state，改 `useMemo` 从队列位置派生
        `slice(queueIdx, queueIdx + 3)` —— 播到第 4/11/18 首时图鉴自动翻页
