# DeepSeek 推荐引擎

## 做什么

把用户的统一库（P2 导入得到的）喂给 DeepSeek，让它根据库里的歌推荐用户
可能喜欢的新歌。返回的"推荐歌名 + 歌手"再去统一搜索（P0）查真实可播
的平台，回填到推荐队列里播放。

## 验收标准

- [x] 用户在 UI 设置页填入 DeepSeek API key，存到本地（.env 或 storage）
- [x] 没设 key 时调推荐 → 友好提示"请先在设置里填入 DeepSeek API key"
- [x] 推荐请求带统一库（最多前 200 首）+ 想要的语言 / 风格 prompt
- [x] 响应解析：JSON 数组，每项 { title, artist }；解析失败 → 报错并保留 raw 给 debug
- [x] 推荐结果去重：和已 ❤ 库 + 上一批推荐去重（normalizeKey）
  > `run(opts.exclude)`：auto-continue 时前端把队列里已推荐的歌回传，服务端
  > 并进 dedup seen 集合 + prompt 的「请勿再推荐」清单（reco.test #13）。
- [x] 拿到推荐后用 P0 的统一搜索填实平台源（自动用 bestSource）
- [x] 推荐列表分页：每页 10 条，按用户消费进度（已听 N 条自动加页）
  > 播到最后一首 → `usePlayer.loadNextTrack` 用 `queueRef.loadMore`（reco 队列
  > 专属）取下一批 append 续播，而非循环回第一首；`useReco` 提供 loadMore
  > 并带上 exclude。空批/失败兜底回退到循环。
- [x] rate-limit 429：暂停重试 + UI 显示"推荐暂缓，请稍候"
- [x] 网络错误：fail loud，不静默吞

## 接口规格

### 后端

```
GET  /api/reco/status
→ { configured: boolean, lastRunAt?: number, librarySize: number }

POST /api/reco/run
Request:
  { count?: number;   // 默认 10
    language?: 'zh' | 'en' | 'ja' | 'auto';
    mood?: string;     // 自由文本
  }
Response:
  { items: UnifiedSearchItem[];   // 已 fill 平台源
    model: string;               // 'deepseek-chat'
    runAt: number;
  }
Error:
  400: 还没 import 库
  428: 没设 DeepSeek key（NestJS `PRECONDITION_REQUIRED`）
  429: 上游 rate-limit
  502: 上游 5xx

POST /api/reco/key
Request: { apiKey: string }
Response: { ok: true }
→ 写到 process.env.DEEPSEEK_API_KEY + .storage/secrets.json（git-ignored）
  ⚠️ 注意：secrets 文件不参与持久化 state 的 export，永远本地
```

### 前端

设置页（SettingsPanel 或 SidePanel）：
- "DeepSeek API Key" 输入框（type=password），存/改
- 留 "DeepSeek 平台" 链接：https://platform.deepseek.com
- key 状态行："已配置（key 末 4 位 ab12）"/ "未配置"

主界面：
- "🎲 推荐" 按钮（搜索按钮旁边）
- 点击 → POST /api/reco/run → 拿到 UnifiedSearchItem[] → 直接走 P0 的播放队列

## 实现范围（v1）

- ✅ DeepSeek OpenAI-compatible API 调用（base_url=https://api.deepseek.com/v1）
- ✅ prompt 模板：system + user（带 library 列表 + 偏好）
- ✅ 响应 JSON 解析（带 retry 一次：模型偶尔在 ```json 围栏里）
- ✅ 推荐结果二次去重（库内已有 + 本次重复）
- ✅ 用 P0 统一搜索填实平台源
- ❌ 长期记忆 / 反馈学习（v1 不做）
- ❌ prompt 调优工具（先 hardcode 一个能用的 prompt）

## 推荐质量调优（v1.1，2026-07）

三段流水线：**选歌（DeepSeek）→ 去重 → 填平台源（统一搜索）**。这轮 7 项优化：

- [x] **#1 填源匹配校验**：`fillPlatforms` 不再无脑取 `searchUnified` 首条——先按
      `normalizeKey(歌名+歌手)` 精确匹配，再退化到歌名+歌手双向包含（`looseMatch`），
      都不中就**丢弃**，杜绝同名翻唱/live/纯音乐/不相关首条混进队列（reco.test #14/#15）
- [x] **#2 填源并行**：串行 for-await → 分波 `Promise.all`，并发上限 `FILL_CONCURRENCY=6`
      （压住对 netease/QQ 的读并发，避免「操作频繁」），总耗时从 Σ 降到 ~max
- [x] **#3 库随机采样**：不再固定喂前 200，`sampleLibrary` 从**全库**随机采样 150 首当种子，
      每次 run 换一批 → 缓解同质化，长库靠后的歌也能影响推荐
- [x] **#4 超额要 + 补位**：向模型要 `count×2`（上限 40），fillPlatforms 分波补到 `count`
      为止（reco.test #16），避免 dedup/匹配损耗后数量不足
- [x] **#5 session 历史去重**：`reco:history:{sessionId}` 存最近 200 首，`run` 时并进
      exclude + prompt 避让 → **手动连点「推荐」也不复读**（不止 auto-continue）
- [x] **#6 prompt 强化**：明确"录音室原版、排除 live/翻唱/remix/伴奏、歌手用原文、
      宁少勿编"，并点名用户**高频歌手**（`topArtists`）当口味锚点
- [x] **#7 统一归一**：dedup 复用 `search.util.normalizeKey`（含全角→半角），与搜索/
      匹配同口径，堵全角/半角变体漏去重
- [x] **#8 版本偏好（挑正常音源）**：`searchAndMatch` 在匹配上的候选里按**版本纯净度**
      打分挑选——录音室原版 0 < live/现场 10 << DJ/remix/伴奏/加速/抖音/翻唱/纯音乐 100
      （`versionPenalty`/`VERSION_BAD`/`VERSION_SOFT`，只扫 title 免误伤 "DJ Okawari"
      这类艺人名）。修「晴天搜出来是 DJ 版」：有录音室原版就选原版；**只剩坏版本且
      用户没点名要 → 丢弃让上层补位换一首正常歌**；rec 自己点名 remix/live 则豁免。
      候选池扩到 15，且只保留可播（bestSource≠null）的。回归见 reco.test #17/#18/#19

## 推荐质量调优（v2，2026-09）— 检索 + 重排

**问题诊断**（2026-09-20 读全链路后确认）：v1.1 的质量瓶颈不在 prompt 细节，而在
**输入信号**与**候选来源**两层。prompt 已堆到 11 条硬规则，继续加规则边际收益≈0。

| 根因 | 现状证据 | 后果 |
| --- | --- | --- |
| 只有「红心」一种信号 | 全 server 无播放/跳过/完播记录 | 口味是多年红心的平均脸，不知道你**最近**在听什么 |
| 随机采样打散口味结构 | `sampleLibrary` 全库均匀随机 150 首，每次 run 换样 | 混合库拿到的是风格沙拉；第 3 次 run 起"不像我" |
| 候选来自模型自由生成 | 产物是 `{title, artist}`，幻觉条目在 fill 阶段被丢 | 白烧 token + 模型只敢推超热门曲，深层口味出不来 |
| 无多样性控制 | 按模型输出顺序收下，无艺人配额 | 一位歌手可占满整批 |

**v2 架构**：`口味档案 → 目录锚定候选池 → LLM 挑选/排序 → 白名单校验 → 填源`

- [x] **P0-a 口味档案**（`reco/taste-profile.ts`，纯函数）：
  - 艺人亲和度：`splitArtists` 拆多艺人 + `normalizeKey` 归一后按出现次数加权排序
  - `anchors` = 全库亲和度 top N（默认 6）——**作为口味主干在同一会话内稳定**，
    run 之间不再漂移；只有库变化（签名变）才重算
  - `seeds` = **亲和度加权采样**（70% 按亲和度权重 + 30% 均匀长尾）替代原均匀随机：
    每次 run 换一批种子但仍落在用户真实口味内
  - 库签名 = `items.length + importedAt`；按 session 缓存档案
- [x] **P0-c 目录锚定候选**（`reco/candidate-pool.ts`）：候选**只来自真实目录**，三条来源
  - 相邻艺人：Deezer `/search/artist` → `/artist/{id}/related`（匿名、真实协同信号）
  - 同艺人深挖：对 anchor + 相邻艺人跑统一搜索，取**库外**曲目（deep cut）
  - 平台 FM：QQ / 网易云私人 FM / Deezer 榜单（未登录/失败即跳过，fail-soft）
  - 候选去重（`normalizeKey`）→ 剔除库内 + exclude + 坏版本 → 单艺人在池内上限
- [x] **LLM 改为挑选 + 排序**：prompt 收短，输出 `{ "picks": [ { "id": 3, "reason": "…" } ] }`；
  `id` 必须落在候选池下标内（**白名单校验**，幻觉 id/越界一律丢弃）
- [x] **回退**：候选池不足（< count）或挑选解析失败 → 回退 v1.1 自由生成路径，
  行为与错误码不变（不因新路径失败而让推荐整体报错）
- [x] **多样性**：同一归一艺人最多 2 首（候选池限 + 最终装配限两道）
- [x] 保留 v1.1 全部既有保证：版本纯净度 / 时长过滤 / 填源匹配校验 / 封面兜底 /
  库 + 历史去重 / exclude 避让 / 429 与网络错误 fail loud
- [x] `POST /api/reco/run` 响应新增 `mode: 'select' | 'generate'` + `candidateCount`
  （调试与效果对比用，向后兼容的可选字段）

## 推荐质量调优（v2.1，2026-09-20）— 延迟包 + 行为信号

**触发**：用户实测 v2「慢一些，要好久」。诊断出三段串行 + 无输出上限：
候选池四段串行（相邻艺人查询 → 深挖 → 相邻搜索 → 电台），最坏 36s；LLM 没设
`max_tokens` 且 prompt 里塞了最多 120 行候选；填源再叠 4 波搜索。

### 延迟（L1–L6）

- [x] **L1 候选池阶段并发化**：主干/探索搜索立刻入队 → 相邻艺人查询与电台取批
      同时起飞 → 相邻艺人一查到就追加进**同一个** `TaskPool`（边查边搜），
      删掉三段串行屏障；结果仍按入队序展开，**与网络快慢无关**（reco.test #37）
- [x] **L2 LLM 输出封顶 + prompt 瘦身**：挑选路径带 `max_tokens=900`（生成路径
      1500）；prompt 只列前 40 条候选（池子仍全量供补位），口味采样 60 → 40 行
      （reco.test #39）
- [x] **L3 配额下调**：`anchorLimit 4→3`、`relatedPerAnchor 3→2`、候选搜索
      `pageSize 20→10`、电台超时 `8s→4s`、每平台电台 8→6 首
- [x] **L4 候选池缓存**：按 `(session, 库规模, 主干)` 缓存 10 分钟；exclude 变化
      就地过滤，够用就不重建 → 连点/续播第二次几乎瞬回（reco.test #38）。
      key **不含信号指纹**——否则每播一首歌就失效，边听边点推荐时缓存永远打不中
- [x] **L5 分阶段耗时可观测**：日志一行给出 `池/LLM/填源/合计` 毫秒与候选数；
      `POST /reco/run` 响应新增 `timings.{poolMs,llmMs,fillMs,totalMs,cachedPool}`
      （reco.test #38）
- [x] **L6 加载页文案**：RecoLoading 按**真实耗时**推 STEPS（不再 2.4s 循环回第一句），
      超过 4s 显示已等待秒数

### 行为信号与负反馈（P0-b）

- [x] **`reco/signals.ts`**：信号类型 `play|complete|skip|like|dislike|seed`，
      权重（跳过 -2 / 踩 -4 / 完播 +2.5 / 红心 +3）、21 天半衰期、
      30s 同曲同类型防抖、500 条上限（reco.test #41）
- [x] **`POST /api/reco/signal`**：单条或 `{signals:[...]}` 批量；脏数据丢弃、
      永远 2xx（上报失败不能影响播放）（reco.controller.e2e #9–11）
- [x] **前端上报**：`usePlayer` 在开始播放 / `ended` / 早切（<30% 且时长≥60s）/
      红心 / 踩 五处上报；同一首只报一次 play（WPS 重载 / 音质切换不重复）
- [x] **信号进口味档案**：`artistSignalScores` 折进 `ArtistAffinity.weight`
      （**有界**：正分最多 +10，负分最多把权重压到 0），主干按权重排序
      （reco.test #42）
- [x] **负样本闭环**：跳过/踩过的歌当"库内已有"排除（候选池 + prompt 避让，
      reco.test #43）；信号分 ≤ -6 的艺人**整位拉黑**不再进池（reco.test #44）

### 以歌为种子（"像这首一样"）

- [x] `POST /reco/run` 支持 `seed: { title, artist }`：候选只围绕该艺人 + 它的
      相邻艺人（不撒用户主干、不做探索轮换），prompt 追加"更多像这首"的要求，
      并把这次点击记成 `seed` 强正信号（reco.test #45）
- [x] 前端 TheaterView 推荐块**头部行右对齐**位置新增「像《歌名》一样」胶囊
      按钮（播放中有歌时出现）。**不放卡片下方**：1440×900 画布的垂直链
      （Bug #8 — cards 底 / footer 顶 = 868）已经没有富余空间，再往下推会被
      1200×800 默认窗口的 scale 0.833 切到底边（见 2026-09-21 bug #1）。

### 推荐卡跟随队列位置（2026-09-21）

**为什么**：之前 `useReco` 的 `suggestions` state 只在 `runRecoFlow` 第一次返回
时 `setSuggestions(result.items.slice(0, 3))`——batch 1 的前 3 首被冻成永久
图鉴。播到第 4 首开始看的就是陈旧数据；`loadMore` 拉到 batch 2 后图鉴也
不切到 batch 2 的前 3 首。

**做法**：
- `usePlayer` 暴露 reactive 的 `queueIdx` + `queueUnifiedItems`——presentTrack
  / switchToProvider / resetForSwitch 都同步写一次（避免 ref 改完没 re-render）
- `useReco` 删掉内部 `suggestions` state，改 `useMemo` 从队列位置派生：
  `queueUnifiedItems.slice(queueIdx, queueIdx + 3)` → 始终是「**正在播 + 接下来 2**」

**取舍**：
- 视觉：第 4 首开始图鉴翻页（idx 1/2/3 → idx 3 → idx 10 batch 切换）；
- 失败模式：如果队列突然被切空（resetForSwitch），`queueIdx = -1` → 图鉴空，
  这是预期行为，比「卡在陈旧 batch 1」更直白；
- 跨平台降级同一首重 presentTrack 不会回放新卡片：`setQueueSnapshot(prev =>
  prev.idx === newIdx ? prev : ...)` 守门（reco.test #13 同款 closure-trap 风险）。

## 离线评测基座（v2.2，2026-09-20）

**为什么**：前面几轮的优化（v2 / v2.1）都只能靠"实测感觉"判断效果——没有可重复
的数字，"变好了"就是玄学。

**方法**：留一法（leave-one-out）。从库里随机藏起 N 首红心歌，**只用剩下的歌**
跑同一条真实流水线（候选池 → 挑选 → 填源），看藏起来的歌能不能被推回来。

指标刻意分两层，直接告诉我们损失发生在哪一段：

| 层 | 指标 | 含义 |
| --- | --- | --- |
| 检索 | `poolRecall` / `poolRecallTop20` | 藏起来的歌有没有进候选池（候选生成 Problem？） |
| 选择 | `recallAtK` / `MRR` | 候选里的歌有没有真被推给用户（LLM 挑选 Problem？） |

再加一档拆分：**同艺人 / 新艺人**。同艺人的歌我们本来就会搜这位艺人，天然容易
捞到——**新艺人那一档才反映泛化能力**，看结果时别被同艺人的高分骗了。

- [x] `reco/eval.ts`（纯函数）：`splitLibrary`（rng 可注入 → 同 seed 复现同一份考卷）/
      `recall` / `meanReciprocalRank` / `holdoutBreakdown` / `diversityMetrics` /
      `averageRuns` / `formatEvalReport` / `compareEvalReports`（基线回归追踪）
- [x] `RecoService.evaluate`：用**真实** deps（统一搜索 + 相邻艺人 + 电台）跑评测；
      `noCache: true` 让评测**不写**产品候选池缓存（否则 train-only 的池会污染真实推荐），
      也不写推荐历史
- [x] 两种模式：`pool`（默认，不调 LLM、零 token 成本，测检索层）/ `llm`（完整流水线）
- [x] `POST /api/reco/eval`（本地诊断，body: holdoutSize/count/mode/runs/seed）
- [x] CLI：`npm run reco:eval -- --holdout=20 --count=10 --runs=3 --seed=1 --mode=pool`
      支持 `--json` / `--save=<file>` / `--compare=<file>` / `--session=` / `--storage=`
- [x] CLI 只读：直接从 `state.json` 取会话（不经 SessionService，不触发任何业务写入）；
      跑之前应先关掉 app，避免两进程共用同一份 storage
- [x] 测试：`eval.test.ts`（切分/召回/MRR/分档/多样性/报告对比 5 组）+
      `reco.test #46/#47`（能真的召回藏起来的歌；检索全空时指标必须为 0，防假阳性）

**已知局限**：留一法假设"你会再喜欢一次你收藏过的歌"，测不到"新歌发现"那部分；
同艺人档天然偏高（见上）。后续可加"按时间切分"（若库里带上加入时间）与在线指标
（跳过率）互相印证。

**仍未做**（下一批）：按时间切分的评测、同人歌单/跨会话长期档案、候选池预热到播放
间隙、推荐结果级联（边出边播）。

## 不做什么

- ~~不持久化推荐历史~~ → v1.1 起持久化「最近推荐过」用于去重（不是"历史推荐结果"，
  只是去重键；库变了不影响，因为只按歌名+歌手 normalizeKey 比对）
- 不做"推荐质量反馈" UI
- 不做 AB / 模型选择——只用 deepseek-chat（温度 0.9 hardcoded）

## 技术约束

- HTTP 客户端用 fetch（统一 server 风格）
- 5xx / 网络错误：fail loud（throw），controller 转 502
- 429：throw RateLimitError，controller 转 429 + Retry-After 头
- API key 不写日志（logger 只记 key 末 4 位 + provider）
- 库规模限制：前 200 首喂给 prompt（token 预算）
- 新 module：packages/server/src/reco/reco.service.ts
