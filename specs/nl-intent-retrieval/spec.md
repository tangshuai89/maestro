# NL 歌单 · 意图驱动检索（intent-driven retrieval）

> **状态**：🚧 实现中（本 spec 是 `specs/nl-playlist/` 的补丁，修复其验收标准
> "风格 / 语言 / 年代与描述吻合"未达成的问题）。

## 做什么

让 NL 歌单里的**风格指令真正作用在检索层**，而不是只当 prompt 里的软提示。

一句话需求 → `parse-intent` 解析出结构化意图 → **意图决定候选池怎么捞** →
LLM 只在"已经符合风格的真实曲目"里挑与排序。

## 为什么（问题复现）

2026-10-20 实测：输入「来点儿爵士乐」。

- `parse-intent` 解析**正确**：`genres: ["jazz"]`（弹窗「我理解的意图 → 风格 jazz」可见）
- 但生成的 12 首队列里：明天快乐 — 陈奕迅 / 不要说话 — 陈奕迅 / 我想念 — 汪苏泷 /
  ありがとう — KOKIA / Walk On The Wild Side — Lou Reed …——**几乎全是用户库里的
  大流行**，爵士含量≈0。

### 根因：意图只进了 prompt，没进检索

`reco.service.ts::run()` 的候选池**完全由「口味档案」决定**：

| 候选来源                     | 实际内容                                             | 对「来点爵士」的贡献 |
| ---------------------------- | ---------------------------------------------------- | -------------------- |
| `anchors`（主干艺人）        | 库内曲目数最多的 6 位 → 陈奕迅 / 汪苏泷 / Lou Reed … | **污染源**           |
| `exploreArtists`（探索艺人） | 库内中频艺人                                         | **污染源**           |
| `findRelatedArtists`         | 上面两位的**相邻艺人**（Deezer 协同过滤）            | 跟着污染源跑         |
| `fetchRadio`（平台 FM/榜单） | **按本账号收听史**生成的私人 FM                      | **污染源**（最严重） |

而 `intent`（含 `genres`）的唯一去向是 `intentToPromptHints()` → select prompt 里
一行软提示「风格标签：jazz」。于是 LLM 面对的候选清单里**一首爵士都没有**，
40 首全是流行——它没有别的可挑，只能挑流行。**这不是 LLM 能力问题，是检索层
没有风格维度的问题。**

同一个洞还有两处：

- `intent.similar_artists`（「更多像 X」）**从不参与检索**，只作为一行 prompt 文本。
- `intent.similar_tracks`（「像这首歌的感觉」）同上。

即：`specs/nl-playlist/spec.md` §不做什么里写的"Intent 只是约束"，在**风格维度**
上把约束降级成了装饰。用户要爵士，得到的是自己的回音壁。

## 验收标准

- [ ] 「来点儿爵士乐」→ 队列里**主体是爵士**（≥70% 可辨认为爵士/爵士邻近），
      且**不出现**用户库主干流行艺人（陈奕迅等）占多数的情况
- [ ] 「像 Deadmau5 那种 prog house」→ 队列里能搜到 Deadmau5 本人的歌
      （`similar_artists` 参与检索）
- [ ] 「来点爵士」在**空意图锚点**（LLM 没给流派代表艺人）时仍然成立
      （代码侧流派→代表艺人映射兜底）
- [ ] NL 风格意图路径**不拉平台私人 FM**（FM 是账号画像，最容易带偏风格）
- [ ] 意图种子候选**排在口味档案候选之前**：LLM 挑不满时，程序补位也补在风格内
- [ ] 无 intent 的普通「推荐」路径行为**完全不变**（向后兼容）
- [ ] intent 检索失败（平台全挂）→ 优雅回退自由生成（LLM 按风格点歌名），
      不报错、不空队列

## 数据模型

### NLIntent 新增字段

```ts
interface NLIntent {
  // …既有字段不动…
  /** 流派 → 代表艺人（LLM 提议，用于**检索**，不是 prompt 文本）。
   *  例：[{ genre: "jazz", artists: ["Miles Davis", "John Coltrane"] }] */
  genre_artists?: Array<{ genre: string; artists: string[] }>;
}
```

`genre_artists` 与既有 `similar_artists` 的区别：前者是"这个流派长什么样"的
**检索种子**，后者是"用户点名要像谁"。两者都进检索。

### 检索种子（新增内部结构）

```ts
interface IntentSeeds {
  /** 艺人种子 → 逐个深挖该艺人的库外曲目。 */
  artists: string[];
  /** 参考曲目（"歌名 - 艺人" 或纯歌名）→ 解析出艺人后并入 artists。 */
  tracks: string[];
  /** 是否有"风格指令"（决定是否切到 intent 模式）。 */
  styleDirective: boolean;
}
```

`styleDirective = genres.length > 0 || similar_artists.length > 0 || similar_tracks.length > 0`

（只写 `exclude_*` 的意图**不**切模式——排除项是减法，不该改检索方向。）

## 检索管线（intent 模式）

```
intent.similar_artists ──┐
intent.genre_artists ────┼──→ 艺人种子 → 逐个深挖（searchArtist）
流派→代表艺人映射（兜底）─┘         │
intent.similar_tracks ──→ 解析艺人 ─┘
                                          ↓
                     Deezer 相邻艺人扩展（related-artist，风格内深挖）
                                          ↓
                    ┌─────────────────────┴─────────────────────┐
                    │  候选不够（< count）→ 追加库口味档案艺人   │
                    │  候选够   → 口味档案**不进池**              │
                    └───────────────────────────────────────────┘
                                          ↓
                            LLM 只在风格内挑选 + 排序
```

要点：

1. **种子顺序 = 优先级**。LLM 点名的 `similar_artists` > `genre_artists` >
   代码侧流派映射兜底 > `similar_tracks` 解析出的艺人。池子按种子顺序展开，
   所以"程序补位"也补在风格内。
2. **口味档案降级为兜底**：intent 模式下一律不把库主干艺人放进池子（这正是
   污染源）；只有当风格种子捞不满 `count` 条时，才把主干艺人追加到**队尾**，
   且 prompt 里已声明"本次要求优先"。
3. **FM 关闭**：intent 模式不调 `fetchRecoRadioCandidates`。
4. **相邻艺人扩展仍开**：Deezer 的相关艺人是平台侧协同过滤，Miles Davis 的
   相邻艺人还是爵士——这是风格内扩深度的关键来源。

## 流派 → 代表艺人映射（代码侧兜底）

LLM 可能偷懒不填 `genre_artists`（prompt 里已经要求"每个流派给 2-4 位代表
艺人"，但不能只靠它）。代码侧维护一张表，覆盖常见中英文流派写法：

| 流派（含常见别名）               | 代表艺人（节选）                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| jazz / 爵士 / 爵士乐             | Miles Davis、John Coltrane、Chet Baker、Dave Brubeck、Ella Fitzgerald、Thelonious Monk、Duke Ellington |
| rock / 摇滚 / 摇滚乐             | The Beatles、Rolling Stones、Radiohead、David Bowie、Queen、崔健、朴树                                 |
| electronic / 电子 / 电子乐 / EDM | Daft Punk、Deadmau5、Justice、The Chemical Brothers、Tiësto、窦唯                                      |
| classical / 古典 / 古典乐        | Beethoven、Mozart、Bach、Chopin、Debussy                                                               |
| folk / 民谣                      | Bob Dylan、Simon & Garfunkel、赵雷、陈粒、朴树                                                         |
| rnb / 节奏布鲁斯 / soul / 灵魂乐 | 陶喆、方大同、Alicia Keys、Marvin Gaye、SZA                                                            |
| hiphop / 嘻哈 / 说唱 / rap       | Jay-Z、Kendrick Lamar、Eminem、MC HotDog                                                               |
| blues / 蓝调                     | B.B. King、Muddy Waters、Robert Johnson、Etta James                                                    |
| funk / 放克                      | James Brown、Parliament、Earth Wind & Fire                                                             |
| metal / 金属                     | Metallica、Black Sabbath、Iron Maiden、窦唯                                                            |
| postrock / 后摇                  | Explosions in the Sky、Mogwai、惘闻                                                                    |
| citypop / city pop / 都市流行    | 竹内まりや、山下達郎、角松敏生                                                                         |
| bossa / bossa nova               | João Gilberto、Antônio Carlos Jobim、Gilberto Gil                                                      |
| anime / 二次元 / 动画            | 泽野弘之、菅野よう子、RADWIMPS、久石让                                                                 |
| chill / 轻音乐 / 纯音乐          | 坂本龙一、Ludovico Einaudi、Brian Eno                                                                  |

映射表只作**兜底**：LLM 给的 `genre_artists` 优先，映射表补充没覆盖到的。

## 选曲 prompt（intent 模式）

intent 模式下 select prompt 与普通模式**分开措辞**：

- 「本次要求」提到**口味档案之前**，并显式声明"本次要求优先于口味档案"
- 候选清单**去掉**「最常听的歌手」锚点行与口味采样节选
  （留着它们，模型会把"用户常听陈奕迅"当成"用户现在想听陈奕迅"——
  这正是本次线上问题里 Lou Reed 被选中的原因）
- 规则 2 从"口味优先"改为"本次要求优先"

普通模式（非 intent / 无风格指令）prompt **一字不改**。

## 接口规格

无新接口。既有接口变化：

```
POST /reco/parse-intent
Response: { intent: NLIntent; raw?: string }
  → intent 可能多出 genre_artists 字段（可选，缺省为空数组）
```

`POST /reco/run` 入参/出参**不变**（`intent` 已经是可选字段）。

### 库的前置条件（2026-10-23 修正）

`POST /reco/run` 的「库非空」前置检查**只对没传 `intent` 的普通推荐路径生效**。

- **没传 `intent`**（普通「✨推荐」）→ 库为空仍报 `library_empty`。理由：它的候选池
  就是库里的主干艺人 + 平台 FM，空库时推荐等于无中生有。前端 `useReco` 有
  「库空 → 自动 import」兜底。
- **传了 `intent`**（NL 歌单）→ **不要求库**。理由：intent 模式的候选池只来自意图
  种子（流派代表艺人 → 平台真实目录），口味档案与平台 FM 都不参与；库在这里只有
  「去重」和「种子捞不满时的兜底」两处用途，空库时前者失效无害、后者退化成自由
  生成——都是设计内的降级，不是错误。

判据是「**有没有传 `intent`**」，不是「意图里有没有风格指令」——用后者会让
「来点好听的」这种解析出空流派的意图又撞回 `library_empty`。

> 2026-10-23 线上 bug：这道检查原本无条件前置在 intent 判定之前 → 从没导入过 ❤ 库
> 的用户点 NL 歌单「生成队列」必然 400，尽管意图解析完全正确。已修 + 3 例回归。

## 度量：风格纯度评测

**没有度量，"变好了吗"就只能靠人眼看** —— 2026-10-20 的线上问题正是这么漏掉的
（要爵士给 12 首大流行，看一眼觉得"不太对"，但没有数字能报警）。

留一法评测（`reco/eval.ts`）测的是**口味**（能不能推回藏起来的歌）。NL 歌单要回答
的是另一个问题：**用户说"来点爵士"，队列里到底有多少是真的爵士**。所以另做一套
风格纯度评测（`reco/eval-genre.ts`）。

### 三类指标

| 指标                         | 含义                                    | 成本          | 抓什么                         |
| ---------------------------- | --------------------------------------- | ------------- | ------------------------------ |
| `seedCoverage`               | 队列里来自**意图种子艺人**的占比        | 免费          | 检索层有没有听种子的话         |
| `tagPurity`                  | LLM 逐首判定的流派里命中期望的比例      | 1 次 LLM/场景 | 用户体感（"这首算不算爵士"）   |
| `libraryLeak` / `anchorLeak` | 队列里艺人出现在用户库 / 库主干里的占比 | 免费          | 回音壁（要爵士给大流行就是它） |

`seedCoverage` 高但 `tagPurity` 低 = 种子对、策展跑偏；`tagPurity` 高但
`libraryLeak` 高 = 风格对了但掺了回音壁；两者都高才健康。

### 判定口径

- **通过（pass）只看风格维度**：`tagPurity ≥ 70%`（未判定时用 `seedCoverage ≥ 60%`）。
  口味污染**不**参与 pass——用户要"九十年代摇滚"而他库里本来就有 U2，队列里出现
  它们不是风格错误；混进 pass 会让告警变噪声，掩盖真正的风格回归。
- **回音壁（echoChamber）单独告警**：`libraryLeak > 20%` 时标 ⚠️，提示"这批歌
  的艺人你本来就在听"。

### 用法

```bash
npm run reco:eval:genre                              # 5 个默认场景，带 LLM 流派判定
npm run reco:eval:genre -- --no-judge                # 不调 LLM（只算检索层 + 污染）
npm run reco:eval:genre -- --save <file>             # 存基线
npm run reco:eval:genre -- --compare <file>          # 与基线对比
```

真实链路（parse-intent → 种子 → 候选池 → 挑选 → 填源 → 流派判定），
会消耗 DeepSeek token 与平台搜索请求。**"最近推荐过"历史会被还原**——
评测不污染用户自己的推荐。

### 默认场景

`来点儿爵士乐` / `放点适合夜跑的电子乐` / `九十年代摇滚，排除周杰伦` /
`周末慵懒的中文民谣` / `像 Deadmau5 那种 prog house`——覆盖纯流派、场景+流派、
流派+排除、参照型四种诉求。

## 文件改动清单

### 新增

- `packages/server/src/reco/genre-seeds.ts` — 流派→代表艺人映射 + `buildIntentSeeds`
  - `resolveGenreTag`（复合流派写法归一）
- `packages/server/src/reco/genre-seeds.test.ts` — 映射 / 种子优先级白盒测试
- `packages/server/src/reco/nl-intent-retrieval.test.ts` — intent 模式候选池 + prompt 白盒测试
- `packages/server/src/reco/eval-genre.ts` — 风格纯度指标（pure 层）
- `packages/server/src/reco/eval-genre.test.ts` — 指标口径白盒测试
- `packages/server/src/reco/eval-genre-cli.ts` — 风格纯度评测 CLI
- `scripts/nl-intent-e2e-probe.mjs` — 端到端探针（真实 DeepSeek + 真实平台检索）
- `specs/nl-intent-retrieval/spec.md` / `tasks.md` — 本 spec

### 改动

- `packages/server/src/reco/nl-intent.ts` — `NLIntent.genre_artists` + schema 解析 +
  SYSTEM_PROMPT 要求输出流派代表艺人 + `intentHasStyleDirective()`
- `packages/server/src/reco/reco.service.ts` — intent 模式候选池（种子/兜底/FM 关闭）
  - select prompt 的 intent 模式
- `packages/renderer/src/api.ts` — `NLIntent` 类型加 `genre_artists`
- `packages/renderer/src/components/modals/NLPlaylistModal.tsx` — 展示"代表艺人"

## 风险

- **流派种子搜不到**：冷门流派（如 "afrobeat"）在 QQ/网易云可能搜不到曲 →
  候选池不足 → 回退自由生成（LLM 按风格点歌名 + 填源兜底），不报错。
- **多一次检索的延迟**：intent 模式比普通推荐多搜几个艺人（每个艺人 = 4 平台
  一次搜索，5s 超时）。用现有 `TaskPool`（并发 5）+ 5s 超时封顶，最坏多等一个
  波次。**可接受**：普通路径的候选池缓存不受影响（intent 模式用独立 cache key）。
- **流派代表艺人是 LLM 编的**：一个"不存在"的艺人名 → 搜索无结果 → 该种子空转，
  不影响其它种子。映射表兜底也有同样性质。
- **口味档案被完全忽略**：intent 模式确实不按用户口味选歌——但这正是用户
  明确要求"来点爵士"时的期望。兜底路径（候选不足）会重新引入口味。

## 相关文档

- `specs/nl-playlist/spec.md` — 本 spec 的补丁对象（其 §验收"风格吻合"未达成）
- `specs/reco-deepseek/` — 候选池 / 选曲 / 填源链路
