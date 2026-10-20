# NL 意图驱动检索 — Tasks

> 对应 `specs/nl-intent-retrieval/spec.md`。修 `specs/nl-playlist/` 的
> "风格 / 语言 / 年代与描述吻合"验收项未达成的问题。

## Phase A — 检索层

- [x] **A1** `reco/genre-seeds.ts`：流派→代表艺人映射表（中英文别名）+ `normalizeGenreKey`
- [x] **A2** `reco/genre-seeds.ts`：`buildIntentSeeds(intent)` —— 合并
      `similar_artists`（优先）→ `genre_artists`（LLM）→ 映射表兜底 →
      `similar_tracks` 解析；返回 `{artists, tracks, styleDirective}`
- [x] **A3** `nl-intent.ts`：`NLIntent.genre_artists` 字段 + `toIntent` 解析
      （≤ 3 流派 × ≤ 4 艺人）+ `normalizeIntentInput` 类型校验（非数组 → 400）
- [x] **A4** `nl-intent.ts`：SYSTEM_PROMPT 要求"每个流派给 2-4 位代表艺人"；
      `similar_tracks` 要求 "歌名 - 艺人" 格式
- [x] **A5** `reco.service.ts`：intent 模式候选池 —— 种子优先、FM 关闭、
      口味档案降级为队尾兜底；独立 cache key（不污染普通推荐的池缓存）
- [x] **A6** `reco.service.ts`：select prompt 的 intent 模式 —— 「本次要求」
      置顶、口味锚点/采样移除、规则 2 改为"本次要求优先"；generate 路径同步
      （意图置顶 + 口味库降级为兜底 + system 加"本次要求最高优先级"段）

## Phase B — 渲染端

- [x] **B1** `api.ts`：`NLIntent` 类型加 `genre_artists`
- [x] **B2** `NLPlaylistModal.tsx`：意图面板展示"代表艺人"行（前 6 位）

## Phase C — 测试 + 验收

- [x] **C1** 单测：流派映射（jazz / 爵士乐 / 爵士三种写法同一结果；未知流派返回空）
      → `reco/genre-seeds.test.ts`
- [x] **C2** 单测：`buildIntentSeeds` —— 种子优先级、去重、条数上限、
      `styleDirective` 判定（只写 exclude_* 不切模式）→ `reco/genre-seeds.test.ts`
- [x] **C3** 单测：`toIntent` 解析 `genre_artists`（裁剪 / 非法输入不炸）→
      `reco/nl-playlist.test.ts`
- [x] **C4** 单测：intent 模式候选池 —— 种子艺人进池、口味艺人**不进**池、
      FM 未被调用、候选不足时口味艺人补到队尾；select prompt 两种模式措辞
      → `reco/nl-intent-retrieval.test.ts`
- [x] **C5** 回归：无 intent 的普通推荐路径行为不变（`reco.test.ts` / `reco.controller.e2e.test.ts` 全绿）
- [x] **C6** 人工验收：「来点儿爵士乐」→ 队列主体是爵士
      → `scripts/nl-intent-e2e-probe.mjs`（真实 DeepSeek + 真实平台检索）

## Phase D — 度量（风格纯度）

- [x] **D1** `reco/eval-genre.ts`（pure）：三类指标 —— 检索层种子覆盖 / 策展层流派纯度 /
      口味污染（库 + 主干）
- [x] **D2** `reco/eval-genre.ts`：`parseGenreTags`（LLM 判定响应三形状 + 长度对齐）
- [x] **D3** `genre-seeds.ts`：`resolveGenreTag` —— 复合流派写法归一
      （"chinese folk"→folk、"electro house"→electronic，词边界防 "children's music" 误判）
- [x] **D4** `reco.service.ts`：`evaluateGenrePurity()` —— 真实链路评测
      （parse-intent → 种子 → 候选池 → 挑选 → 填源 → 流派判定），
      **不写"最近推荐过"历史**（评测不污染用户自己的推荐）
- [x] **D5** `reco/eval-genre-cli.ts` + `npm run reco:eval:genre`：
      `--no-judge` / `--save` / `--compare` / `--json` / `--session` / `--count`
- [x] **D6** 单测：`eval-genre.test.ts` —— 指标口径 / 判定响应 / 归一 / 汇总对比
- [x] **D7** 用 D5 跑真实评测，**用数字找出三个真问题**（见下）并修掉

### D7 评测暴露的问题（2026-10-20）

第一轮评测（5 场景）跑出 **80% 通过率**，但有几个问题浮出来：

1. **超额要稀释风格**（民谣场景：流派纯度仅 50%，后 6 首是流行 OST）
   → intent 模式下**不再超额要**（只要 count 条，不多要 1.5x）。
   超额要等于给模型"凑数"的机会，它会从清单里挑风格不符的条目来凑。
   少挑不亏：`fillFromPool` 按候选池顺序补位，而 intent 模式的池是**种子优先**。
2. **指标口径：种子名 vs 艺人名**（"好妹妹" vs "好妹妹乐队" 不算命中）
   → 种子覆盖改用 `artistMatches`（双向包含），与候选池同口径。
3. **污染混进 pass 会让告警变噪声**（九十年代摇滚：风格纯度 100%、库污染 33%
   却判 ❌）→ **pass 只看风格维度**；库污染单独作为 ⚠️ 回音壁告警。
   用户要"九十年代摇滚"而他库里本来就有 U2，那不是风格错误。
4. **⚠️ 候选池缓存没失效**（最隐蔽的一个）：`cacheKey` 只含
   (session, 库规模, 种子)，**不含池的构建参数**。把 intent 模式每人配额
   2→4 之后，连续三轮评测仍然只有 2 首/艺人——**旧缓存命中了 10 分钟**。
   症状是"代码改了但行为没变"，极难查。
   → 缓存 key 加**版本号**（`v2`）：**改池构建参数必须 bump 版本**。
   → 评测链路显式跳过缓存（诊断要测当前代码，不能被旧池污染）。
5. **池的来源交错会插队**：intent 模式的"深挖"是流派代表艺人（最贴风格），
   "相邻"是风格边缘（会漂）。交错合并让边缘条目插到风格条目中间 →
   intent 模式改**分组合并**（流派条目连续排前），并把每人配额放宽到 4。
6. **`anchorLimit` 默认只深挖 3 个种子**——intent 模式的种子**全是流派代表艺人**
   （每个都在风格内），截断就是白白浪费（LLM 给了 4 位，第 4 位马頔被丢掉）。
   → intent 模式 `anchorLimit = 种子数`（全用上）。

   这条是民谣场景失败的真凶：3 位种子 × 每人 2 首 = 池里只有 6 首民谣 →
   模型要凑 12 首 → 只能从漂移的相邻艺人里挑 → 6 首流行 OST 混进单子。

修完后的**最终评测结果**（5 场景 · 真实链路 · 每例 12 首）：

| 指标             | 修复前 | 修复后     | 阈值         |
| ---------------- | ------ | ---------- | ------------ |
| 检索层 种子覆盖  | 51.7%  | **75.0%**  | ≥60%         |
| 策展层 流派纯度  | 80.0%  | **100.0%** | ≥70%         |
| 库污染（回音壁） | 10.0%  | 10.0%      | ≤20%（告警） |
| 主干污染         | 0.0%   | **0.0%**   | —            |
| 通过率           | 80%    | **100%**   | —            |

五个场景（爵士 / 电子 / 九十年代摇滚 / 中文民谣 / Deadmau5 prog house）
**全部 100% 流派纯度**，基线已存 `packages/server/.storage/genre-purity-baseline.json`。

### C6 验收记录（2026-10-20，真实链路）

会话 `96d26fb5…`（库 1174 首，登录 spotify/netease/qq），探针
`node scripts/nl-intent-e2e-probe.mjs "来点儿爵士乐"`：

| 场景                        | 意图解析                   | 种子                                                       | 结果                                                                                                                        |
| --------------------------- | -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 来点儿爵士乐                | genres=[jazz]              | Miles Davis / John Coltrane / Chet Baker / Ella Fitzgerald | 12 首**全是爵士**：Miles Davis、John Coltrane、Chet Baker、Billie Holiday、Thelonious Monk、Louis Armstrong、Duke Ellington |
| 放点适合夜跑的电子乐        | genres=[electronic, edm]   | Daft Punk / Chemical Brothers / Disclosure / Calvin Harris | 12 首**全是 EDM**：Daft Punk、The Chemical Brothers、Disclosure、Swedish House Mafia、Zedd                                  |
| 像 Deadmau5 那种 prog house | genres=[progressive house] | Deadmau5 / Eric Prydz / Pryda / Fehrplay                   | 12 首**全是 prog/electro house**，且 **Deadmau5 本人在列**（`similar_artists` 参与检索的证据）                              |

对照组（同一会话、**不带 intent** 的普通推荐）= 改造前 NL 歌单的行为：
林俊杰 / 邓紫棋 / 米津玄师 / 汪苏泷 —— 与用户截图里的"大流行"完全一致，
坐实根因是**检索层没有风格维度**（而不是 LLM 选曲能力）。

耗时：池 4.9s / LLM 2.6s / 填源 3.7s / 合计 12.5s（普通推荐同一量级）。

### 已知遗留

- `packages/server/src/music/album-service.e2e.test.ts` 有 1 条**改动前就红**的
  失败（Spotify 专辑详情错误文案），与本 spec 无关，未在此修复。
