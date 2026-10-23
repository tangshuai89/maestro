# NL 检索 · Eval-Driven 改造 — Tasks

> 对应 `specs/eval-driven-nl/spec.md`。

## Phase A — L0 不变量门禁（PR，0 成本）

- [x] **A1** `reco/eval-invariants.ts`：7 条不变量的纯函数实现
      （no-radio / all-seeds-searched / seed-artists-contribute / seed-block-first /
      excluded-absent / non-seed-ratio / pool-not-empty）
- [x] **A2** `reco/eval-invariants.test.ts`：调用**真实的** `RecoService.buildPool`
      （fake provider，不出网）断言 7 条不变量
- [x] **A3** **反向验证**：故意改坏一处（种子被截断 / 交错合并 / 拉了 FM /
      种子块填不满 / 排除项漏 / 种子无结果）→ 对应不变量**真的会红**
- [x] **A4** 每条不变量写明「抓的是哪个真实 bug」
- [x] **A5** 判据用 `deepDivedArtists`（以**种子身份**被搜）而不是搜索日志——
      相邻艺人里常混着种子本人，看日志会把"被截断的种子"误判成"搜过了"
      （候选池结果新增 `deepDivedArtists` 字段）

## Phase B — L1 离线回放评测（PR，确定性）

- [x] **B1** `scripts/record-nl-fixtures.mjs`：录制 intent / 种子 / 相邻艺人 /
      平台搜索结果 / 策展层 picks / 库主干艺人 → `reco/__fixtures__/nl-search.json`
- [x] **B2** 黄金集 `reco/__fixtures__/genre-golden.json`（人工标注流派）
- [x] **B2b** `scripts/tag-nl-fixtures.mjs`：**分批**标注（40 首/批）——
      一次标 240 首会撞 max_tokens 上限 → 响应截断 → 后半段全没标签
      （实测 citypop 场景 240 首 → 标签 0 条）
- [x] **B3** `reco/eval-offline.ts`：离线评测（fixture 供给 + 黄金集判定 + L0 不变量）
- [x] **B4** `reco/eval-offline-cli.ts` + `npm run reco:eval:offline`：
      报告 + `--save` / `--compare` / `--tolerance`
- [x] **B5** 基线入库 `specs/eval-driven-nl/baseline.json`；
      门禁判据 = 不变量全过 + **纯度不低于基线 N pt**
- [x] **B6** `reco/eval-offline.test.ts`：确定性（同输入两次数字一致）、
      纯度低于基线 → 门禁红、fixture 缺失 / 黄金集缺失 → **fail loud**、
      场景级反向验证（种子被截断 → 红）
- [x] **B7** 黄金集覆盖率低于阈值 → **拒绝给结论**（不当通过算）
- [x] **B8** 判据（expect / adjacent）取**当前**的评测定义，不取 fixture 里录的
      ——判据改了要能立刻生效，不该为了改判据去重录 fixture

## Phase C — L4 流程固化

- [x] **C1** `CLAUDE.md`：改 NL 检索必须先跑离线评测 + 贴对比数字
- [x] **C2** `lefthook.yml` pre-commit：改了 `reco/**` 就跑离线评测（2.8 秒）
- [x] **C3** `package.json`：`reco:eval:offline` / `reco:eval:sweep` 脚本
- [x] **C4** CI 接线：L0/L1 的门禁是**测试文件** → `npm test` → `test.yml` 的
      PR 门禁自动带上（无需新 workflow）

## Phase D — L2 真实链路场景扩充

- [x] **D1** `eval-genre.ts`：场景扩到 12 个（纯流派 / 场景+流派 / 排除艺人 /
      参照艺人 / 参照曲目 / 年代 / 语种 / 排除流派 / 冷门流派 / 混合流派 / 数量）
- [x] **D2** 判据修：synth80s 的期望流派加上相邻子风格（synth-pop / new wave）——
      标签分布证明这些**就是**该流派，判据太窄会把"风格正确"判成"不纯"
- [x] **D3** 跑一轮真实链路，数字入 spec

## Phase E — L3 评测驱动调参

- [x] **E1** 检索参数**可注入**（`INTENT_POOL_PARAMS` + `buildPool(poolParams)`）
- [x] **E2** `reco/sweep.ts` + `sweep-cli.ts` + `npm run reco:eval:sweep`：
      单维扫描 → 出表 → 给推荐
- [x] **E3** `sweep.test.ts`：评分口径 / 空网格 / 空场景 / 无效参数都不炸
- [x] **E4** 结论写进 spec（每个参数配多少、为什么）

## Phase F — 回归

- [x] **F1** `npm run typecheck && npm run lint && npm test` 全绿
- [x] **F2** prettier 全过
- [x] **F3** `npm run reco:eval:offline` 在干净工作区可复现基线数字

## Phase G — PR 门禁接线（仓库自己的 coverage diff 门禁）

> 门禁样板：`scripts/coverage-diff-gate.js`（判据 = **新增/修改的行有没有被执行过**，
> 刻意不用基线快照）。它问的是"你这次写的代码有没有被跑到"。

- [x] **G1** CLI 入口**从未被执行**：两个 CLI 的自动执行块被 c8 记成未覆盖的新增行
      → 改成导出 `runCli(argv)` + `require.main === module` 守卫 +
      `/* c8 ignore start/stop */` 包住入口接线（接线层不是逻辑）
- [x] **G2** `eval-offline.ts` 的 fixture music 工厂**没有导出** → 测不到
      → 提成导出的 `createFixtureMusic`
- [x] **G3** `reco.service.ts` 的空池兜底写在 catch 里 → 那几行几乎永远跑不到
      → 提为模块级 `EMPTY_POOL`（import 时就执行）
- [x] **G4** 候选池缓存命中路径**从没被测到**（`filterPoolByExclude` 只被"排除集为空"
      触发，函数第一行就早退 → 真正的过滤逻辑是死代码）
      → `reco-pool-edge.test.ts` 用**非空排除集**打这条分支
- [x] **G5** "空库 + intent 不报 library_empty"这条路径从没被测到
      → `reco-pool-edge.test.ts` 跑完整 `run()`（LLM 打桩），断言日志分支 + 出歌
- [x] **G6** "候选池构建抛异常 → 回退空池"这条兜底从没被测到
      → `reco-pool-edge.test.ts` 模拟 provider 集成漂移（少一个方法）→ TypeError
- [x] **G7** 门禁本地可复现：`git archive HEAD` 出一份干净副本 → 按 `scripts/test.sh`
      的 c8 参数跑 reco 测试 → 生成 lcov → 跑 `coverage-diff-gate.js --base <base>`
      （隔离副本 = 不受并行 session 的工作区改动干扰）

## 评测抓出来的问题（都已修）

### 离线层（L1）抓的

| #   | 问题                                    | 症状                                                                                                   | 修法                                                                               |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | 平台搜索前 10 条常是"同名歌 + 别的歌手" | 6 个种子（Human League / College / Queen / Beyond / Fela Kuti / Weather Report）**一条候选都贡献不了** | `CANDIDATE_SEARCH_PAGE_SIZE` 10 → 20（provider 本来就取 30，是统一搜索层自己切的） |
| 2   | 相邻艺人里混着种子本人                  | 同一个艺人被搜两次 → 种子块被**从中间劈开**                                                            | 相邻艺人列表排掉与种子重名的                                                       |
| 3   | 黄金集批量标注撞 max_tokens             | 240 首的场景标签 0 条 → 评测"拒绝给结论"                                                               | 分批标注（40 首/批）                                                               |
| 4   | 判据取的是录制时的期望值                | 改了判据不生效（差点误判成数据问题）                                                                   | 判据取当前定义，fixture 只提供数据                                                 |

### 真实链路（L2）抓的（离线层当时覆盖不到）

| #   | 问题                        | 症状                                                                           | 修法                                                                               |
| --- | --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 5   | 库内去重把"用户想要的"滤光  | 库里已有的民谣歌被剔掉 → 种子块凑不满 → 模型补 4 首流行 OST（纯度 100%→66.7%） | intent 模式下**种子艺人的库内曲目不算重复**（只放宽库内去重，跳过/已推荐照旧排除） |
| 6   | 离线 fixture 用空库         | 上面那条失败模式在离线层**根本复现不了**                                       | fixture 每条结果带 `inLibrary` 标记 → 离线按同样口径喂 `library`                   |
| 7   | L2 与 L1 的 pass 判据不一致 | 同一场景离线绿、真实红                                                         | 两层都用宽松纯度，严格值同时报出作对照                                             |
| 8   | 种子给太少                  | LLM 给 4 位、人均只出 2 首 → 种子块 8 < 12                                     | prompt 要求 **4-6 位**；搜索 pageSize 20                                           |

### 已知残留

L2 剩 1/12（`rock-no-punk`）：4 位种子在平台上的**实际产出太少**（种子块 5 < 12）
→ 模型补了漂移的相邻艺人。这条**离线层复现不出**（fixture 里那批艺人产出更多）——
说明"种子在平台上的真实产出"是活的量，录制快照不能完全代表当下。
L1 是逻辑回归网，L2 才是真实校准，两层都要在。
