# Figma → 前端 差异清单（`figma:diff`）

> 一句话：**回答「设计稿变了，前端代码该改什么」，产出一份能直接喂给 coding agent 的清单。**
>
> 这不是"两边永远一样"的静态校验，而是**单向驱动 + 变更感知**：
> 设计稿变更 → 感知 → 产出前端改动清单 → agent 去改。

关联：`docs/figma-driven-frontend.md`（Figma 驱动前端的总纲）·
`specs/d4-token-drift/`（token 腿的既有判定）· `specs/d5-code-connect/`（组件映射）·
`specs/d6-description-template/`（描述模板）· `specs/d10-motion-spec/`（动效规格）·
`specs/token-adoption/`（token 落地基线）

---

## 1. 现状与问题（2026-10-29 盘点实测）

仓库里已有四条 Figma 审计腿，但**没有一条能回答"前端该改什么"**：

| 腿         | 脚本                            | 能证明                     | **不能证明**                         |
| ---------- | ------------------------------- | -------------------------- | ------------------------------------ |
| token 漂移 | `check-token-drift.mjs`         | 代码 == 提交的 dump 快照   | dump 快照 == Figma 现状              |
| v4 总审计  | `figma-aether-v4-audit.mjs`     | 若干 D 系列断言            | 汇总成"改哪些文件"的清单             |
| 描述模板   | `figma-aether-v4-audit-d6.mjs`  | description 含 AI_CONTRACT | 哪些组件缺、缺什么                   |
| 动效规格   | `figma-aether-v4-audit-d10.mjs` | Figma ↔ 仓库 spec id 一致  | 代码里 39 个 `@keyframes` 有没有登记 |

### 1.1 三个硬缺口

| #   | 缺口                                                                         | 证据                                                |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| P1  | **token 快照停在 10-13**，之后 `renderer/src/styles/` 改了 26 次             | `scripts/figma-tokens-dump.json` mtime = 2026-10-13 |
| P2  | **live 腿静默跳过**（无 `FIGMA_TOKEN` 时 workflow 直接 pass）                | `.github/workflows/token-drift.yml`                 |
| P3  | **REST `variables/local` 要 Enterprise `file_variables:read`**（本机无 PAT） | 2026-10-27 实测：两条 PAT 分别 401 / 403            |
| P4  | **四条腿各自要凭据、各自输出格式**，没法拼成一张表                           | 见 §1 表格                                          |

⇒ 结论：**「设计稿变更 → 前端感知」这条链路的真实能力 ≈ 0。**

### 1.2 为什么必须是「统一入口」而不是再加一条腿

再加一条腿的结果是：第 5 个脚本、第 5 种输出格式、第 5 套凭据要求。
**统一入口的价值不在于多一个检查，而在于把"检查"变成"待办清单"** ——
这是 2026-10-24 归档决策能成立的前提：待办清单只放**产生 app 功能**的活，
而"Figma 要求前端做什么"正是产生 app 功能的活。

---

## 2. 目标与非目标

### 2.1 目标

| #   | 目标                                                          | 判据                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------- |
| G1  | 一条命令产出「设计稿 → 前端」差异清单，每条带**目标文件路径** | `npm run figma:diff` 输出 markdown，每条有文件    |
| G2  | 清单分**主线（改代码）**与**附注（设计稿侧）**两段            | 主线段只含 `must` / `should`；`note` 单列         |
| G3  | 能被 coding agent 直接消费                                    | markdown 每条含 `action` + `target`               |
| G4  | CI 可作门禁                                                   | `npm run figma:diff:gate` 有 must/should → exit 1 |
| G5  | **不采集就不误红**（还没采集不是错误）                        | 无快照 → exit 0 + 明确提示                        |
| G6  | 判据本身可验证                                                | 变异验证：改坏判据 → 测试必红                     |

### 2.2 非目标

- ❌ **不做 Figma 写操作**（不建模、不连线、不改 description）—— 那是纯设计稿债，归档区（2026-10-24）。
- ❌ **不改现有 CI 腿的语义** —— `check-token-drift` 继续读 `figma-tokens-dump.json`。
- ❌ **不引入新依赖** —— 全部用 Node 内置能力（`node:fs` / `node:child_process` / 内置 `fetch` 不用）。
- ❌ **不做双向对齐的强制门禁** —— 反向差异只出附注。

---

## 3. 架构：采集 → 比对 → 输出

```
┌──────────────────────────────────────────────────────────────────┐
│ ① 采集层（人工 / agent，一次性，1-2 次/月）                       │
│    scripts/figma-snapshot-seg.js  →  use_figma（只读）            │
│    只遍历节点 + 只读属性；不创建/修改/删除任何节点                  │
│    返回体只取 ---AI_CONTRACT--- 段（精确提取，非截断）              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ 人工落盘（use_figma 无 fs 权限）
                               ▼
│    scripts/figma-snapshot.json                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ ② 比对层（纯函数，离线可测）                                       │
│    scripts/lib/figma-snapshot.mjs                                │
│    四条腿：tokens / components / descriptions / motion            │
│    每条差异统一形状：{lane, kind, severity, title, detail, action, target} │
└──────────────────────────────┬───────────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ ③ 输出层                                                         │
│    scripts/figma-diff.mjs                                        │
│    markdown（主线/附注分节） │ --json │ --gate │ --only │ --snapshot │
└──────────────────────────────────────────────────────────────────┘
```

### 3.1 为什么不自己写文件读取（Figma 侧）

`use_figma` 是 **MCP 云端工具**，没有本地文件系统权限 ⇒ 采集结果**必须人工落盘**。
这是唯一的死结（REST 需要 Enterprise PAT，本机没有），因此采集层被刻意设计成
"贴一段代码 → 拿到 JSON → 落盘"的最短路径。

### 3.2 为什么只取 `---...---` 契约段

| 理由          | 后果                                                  |
| ------------- | ----------------------------------------------------- |
| 返回体可控    | 34 个组件 × 全文 description 会到几十 KB，有上限      |
| AI 真正需要的 | `react` 路径 + 4 个必填 key 是否存在；散文对它没用    |
| 契约段在开头  | 段内**精确提取**（正则 `---([\s\S]*?)---`），不是截断 |

契约解析（YAML 浅解析）放在 **Node 侧**而不是采集段 —— 这样能离线构造坏数据做单测。

---

## 4. 四条腿的判定规则

严重度三档：**`must`（必须改）** / **`should`（该改）** / **`note`（附注）**。

> **方向铁律**：主线只放「Figma 要求前端改」的。反向（仓库有、Figma 没有 / 映射指向不存在的组件）
> 一律 `note` 并单列「附注」段。这条直接来自 2026-10-24 归档决策：
> **纯设计稿对齐不产生 app 功能，不占待办清单位置。**

### 4.1 tokens 腿

| 差异            | 严重度 | 目标文件                                                   |
| --------------- | ------ | ---------------------------------------------------------- |
| `figmaOnly`     | must   | `packages/renderer/src/styles/base/_tokens.generated.scss` |
| `valueMismatch` | must   | 同上                                                       |
| `repoOnly`      | note   | 同上（反向）                                               |

复用 `scripts/lib/aether-tokens.mjs` 的 `renderScss` / `parseGeneratedTokens` ——
与 D4 的映射**同一套**，不复制第二份（两套映射漂移是 D4 的 P1 根因，别重犯）。

### 4.2 components 腿

| 差异               | 严重度 | 含义                                                                      |
| ------------------ | ------ | ------------------------------------------------------------------------- |
| `reactPathMissing` | must   | 契约声明的 react 文件在仓库**不存在** → 必须新建/改                       |
| `unmapped`         | should | Figma 组件集在 `figma-code-connect.json` 里没映射                         |
| `nodeIdChanged`    | should | 映射还在但 nodeId 对不上 → 组件被重建过，需重新连线                       |
| `orphaned`         | note   | 映射指向设计稿里已不存在的组件（反向；组件集与 `Screen/` FRAME 都算存在） |

### 4.3 descriptions 腿

| 差异           | 严重度 | 含义                                             |
| -------------- | ------ | ------------------------------------------------ |
| 缺语义载体     | note   | 既没 description 也没隐藏 TEXT 契约载体          |
| 缺 AI_CONTRACT | note   | 有描述但没 `---` 契约段（附预览）                |
| 缺必填字段     | note   | `react` / `props` / `a11y` / `states` 缺哪个点名 |

> 这一腿**整条是 note** —— 描述缺失是设计稿侧的问题，不该出现在"前端待办"里。

**载体判定用 `hasDescription` 而不是 `description` 全文**（采集段只回传契约段 + 布尔标记）。
理由：若比对层只认 `description` 字段，每个组件都会被误报成"没有 description"
—— 40+ 条假附注，会把真附注淹没（2026-10-29 实测发现并修掉的缺陷，变异项 M6 锁死）。

### 4.4 motion 腿

| 差异                     | 严重度 | 含义                                       |
| ------------------------ | ------ | ------------------------------------------ |
| `figmaOnly`（spec 条目） | must   | 设计稿有的动效规格仓库没有 → 补登记        |
| `unregisteredKeyframes`  | should | 代码里的 `@keyframes` 没登记进 motion spec |
| `repoOnly`               | note   | 仓库有、设计稿没有（反向）                 |

**当前实测**：spec 20 条 vs 代码 39 个 `@keyframes`，spec 里提到的 keyframes 名字 **0 个** ⇒
`unregisteredKeyframes` 会一次性报出 39 条。这是 D10 真实回归（`audit-d10` 无 token 直接报错，
双向闭环从未跑通），本腿把它**暴露出来但不当场修**（补登记需要同步 Figma，见 §7）。

---

## 5. 命令接口

```bash
npm run figma:diff                    # markdown 清单（默认）
npm run figma:diff:json               # 机器可读
npm run figma:diff:gate               # 有未豁免的 must/should → exit 1
npm run figma:diff -- --only tokens   # 单腿：tokens|components|descriptions|motion
npm run figma:diff -- --snapshot <p>  # 指定别的快照文件
npm run figma:diff -- --allowlist <p> # 指定别的豁免表
npm run figma:diff -- --token-dump <p> # 指定别的 token dump
npm run figma:diff -- --code-connect <p> # 指定别的 code-connect 映射表
npm run figma:diff -- --verbose       # 附带 keyframes / spec 计数
npm run figma:test                    # 只跑判据自检（68 个反向验证）
npm run figma:diff:mutation           # 变异验证（改坏判据 → 必须有测试红）
npm run figma:diff:mutation -- --only M30   # 只跑某几条变异
```

> **为什么要 `--token-dump` / `--code-connect` 这两个"指向别的文件"的参数**：
> 它们的路径原先写死 ⇒ **任何针对这些腿的判据都测不到**（变异验证实测：
> "整条关掉 tokens 腿"测试仍然全绿 —— 因为根本没法喂不同的输入）。
> 路径可覆盖 ⇒ 判据才能被端到端地证伪。

### 5.1 退出码

| 码  | 含义                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------- |
| 0   | 无未豁免的 must/should 差异                                                                             |
| 1   | 有未豁免的 must/should 差异（`--gate` 时）；无 `--gate` 时仅 must 触发                                  |
| 2   | 用法/文件错误（快照不存在、JSON 解析失败、**快照退化**、motion 采集失败、lane 拼错、token dump 退化等） |

### 5.2 快照缺失 = 错误（不是"跳过"）

- 快照已提交进仓库（commit `1ce7248`）⇒ 它**不在 = 仓库被改坏了**，不是"还没采集过"。
  ⇒ 缺失一律 **exit 2**，消息里附采集步骤。
- ⚠️ 早先的规则是"缺失就 exit 0 跳过"（为了让第一次接线不红）。
  独立评审实测出这是**最直接的绕过路径**：`git rm scripts/figma-snapshot.json` 就能让门禁变绿。
  ⇒ 规则已改（2026-10-29），变异项 M21 守住。

### 5.3 六条「防假绿」硬规则

> 这六条是 2026-10-29 实现期 + **独立评审**实测加的 —— 都是「看起来绿，其实没测到」的形态。
> 每一条都有对应的变异项（见 §6.2）。

**① 快照缺失必须报错（exit 2）** —— 见 §5.2。

**② 退化快照必须报错（exit 2）**

`components` 与 `screens` **同时为空** ⇒ 几乎一定是采集失败 / JSON 抄断 / 写成 `{}`。
这种快照跑出来的比对结果是"0 差异" ⇒ 门禁绿 ⇒ **而真相是"根本没采到"**。
⇒ 必须 exit 2 而不是当成"设计稿没有差异"。

**②b `counts` 必须与数组长度对得上（exit 2）**

采集段同时返回 `counts`（components / screens / motionEntries 三个数）。
**只查"两个数组都空"不够** —— 只抄了 1 个组件、counts 还写着 35 的快照能顺利通过。
⇒ 快照必须带 `counts`，且三个数必须与实际数组长度**逐一相等**，否则 exit 2。

**③ motion 采集失败必须报错（exit 2）**

采集段在 MOTION SPEC 解析失败时写 `parseError`，找不到 frame 时写 `missing: true`。
不读它 ⇒ 采集侧失败被当成"设计稿没有动效" ⇒ **motion 腿的 `figmaOnly`（must）永远报不出来**。
⇒ `parseError` / `missing` / motion 非对象 / `motion.spec` 非数组 ⇒ 一律 exit 2。

**④ token dump 退化必须报错（exit 2）**

dump 退化成 `{}`（没有 `variables`）时 tokens 腿会被**静默跳过** ⇒ 门禁绿，
而真相是"token 那条腿压根没跑"。⇒ 要跑 tokens 腿却没有可用 dump ⇒ exit 2。

**⑤ `must` 永远不可豁免**

豁免表 `scripts/figma-diff-allowlist.json` 只对 `should` 生效。豁免条目必须带**非空字符串**
`reason`（`reason: true` 这种非字符串不算），否则视为**未登记**（不豁免）；
匹配条件（`kind` / `lane` / `target`）不能全空，否则等于豁免一切。
豁免项**仍会打印**在清单的「已豁免」段 —— 只是不红。

**⑥ `--only` 拼错必须报错（exit 2）**

`--only component`（少个 s）曾会静默跑成 0 条差异、exit 0 ⇒ 看起来"没差异"。
⇒ lane 名不在白名单里 ⇒ exit 2。

**⑦ 显式指定的输入文件不存在必须报错（exit 2）**

`--snapshot` / `--token-dump` / `--code-connect` **显式给了路径却找不到** ⇒ 是调用方的错。
不能静默降级：映射表找不到 ⇒ 映射为空 ⇒ 所有组件都变成 `unmapped` ⇒ 差异清单失真，
而退出码看着还是"正常的 1"。⇒ exit 2。
（默认路径找不到时行为不同：默认的快照缺失是"仓库坏了"⇒ 也 exit 2，见 §5.2。）

**⑧ 退化的输入表必须报错（exit 2）—— 存在 ≠ 有效**

**code-connect 映射表存在但 0 条映射** ⇒ 所有组件都变成 `unmapped` ⇒ 而 `unmapped`
**正好在豁免表里** ⇒ 门禁照样绿 —— 这是与「空 token dump」**同一种**假绿，只是更隐蔽
（因为连"未映射"的提示都会一起被豁免掉）。

⇒ 判据不是"文件在不在"，而是"**这张表里有没有它该有的东西**"：
token dump 要有非空的 `variables`，映射表要有非空的 `mappings`。
**2026-10-29 实测**：这条是自己审查时发现的，评审没提 —— 说明「等效变异检测」
之外还需要「按退化形态逐个问一遍：这张表空了会怎样」。

**为什么需要豁免**：快照一提交进仓库，`--gate` 就从"永远跳过"变成**真门禁**。
而真门禁上线当天必然红 —— 当前已知的 should 级差异有两类（code-connect 覆盖率没跟上 /
motion spec 没登记全部 keyframes），短期修不完（后者要同步 Figma，是死锁）。
⇒ 照仓库既有范式 `scripts/token-drift-allowlist.json`：**类级豁免 + 必填 reason**，
修好一类就删一条豁免。**一个永远红的门禁等于没有门禁**（见 `specs/eval-driven-nl/`）。

---

## 6. 验收标准

### 6.1 功能

- [x] `node scripts/figma-diff.test.mjs` → **68/68 pass**
- [x] `node scripts/figma-diff.mjs --gate`（真实快照）→ exit 0
- [x] `node scripts/figma-diff.mjs --json` → `{ok, meta, stats, statsAll, diffs, waived}`
- [x] `node scripts/figma-diff.mjs --only tokens` 单腿可用；`--only` 拼错 → exit 2
- [x] `node scripts/figma-diff.mjs --snapshot /tmp/nope.json` → exit 2
- [x] markdown 主线段只含 must/should；note 单列「附注：设计稿侧待办（不占待办清单位置）」
- [x] 每条差异带 `target`（相对仓库根的文件路径）→ 可直接喂 coding agent
- [x] 豁免项仍出现在清单「已豁免」段；`--json` 里进 `waived` 数组
- [x] `must` 被豁免 → 门禁仍红；豁免条目缺 `reason` / reason 非字符串 / 条件全空 → 不豁免
- [x] **八条防假绿守卫**（§5.3）各有端到端用例：
      快照缺失 · 空快照 · counts 不符 · components-screens 非数组 ·
      motion parseError / missing / 非对象 / spec 非数组 ·
      token dump 退化（`{}` 与空数组）· code-connect 映射表为空 ·
      `--only` 拼错 · 显式指定的输入文件缺失
- [x] **屏幕也走正向检查**：react 路径不存在 → must；被重建 → nodeIdChanged；
      非路径的 react 值（复用说明）→ 不报假 must；同名不同类（组件集 + 同名屏幕）→ 不误报
- [x] **组件集不享受「不像路径就跳过」的豁免**（只有屏幕享受）⇒
      `react: xxx.tsx（待新建）` 这种带注释的写法也报 must
- [x] **映射抄到另一个「存在」的节点也报 nodeIdChanged**（组件侧 + 屏幕侧）
- [x] **「是不是屏幕」按来源判、不按名字判** ⇒ 组件集与屏幕撞名时（真实数据 `Screen/SourceSelect`），
      组件集**不**享受屏幕的「不像路径就跳过」豁免

### 6.2 判据可验证（**交付标准**）

> 判据类工具必须证明「改坏判据 → 测试会红」，否则等于没判据
> （D 系列反复吃过的教训，见 `specs/eval-driven-nl/`）。
>
> **一次性手测不算数** —— 必须是**可复现**的脚本，否则下次改判据时无法复查。

- [x] **可复现变异验证**：`scripts/figma-diff.mutation.mjs` → **37/37 变异全部被抓住**
      （脚本会原地改坏源码 → 跑测试 → 断言至少 1 个测试红 → 还原；
      基线不绿则直接 exit 1；变异锚点不唯一命中也 exit 1 —— 防"变异没生效"被误读成"门禁没抓到"）
- [x] **等效变异检测**：测试全绿时再比对**真实快照上的行为指纹** ⇒ 区分
      「判据没被测到」（真洞，必须修判据）与「锚点写错、压根没改到判据」（变异脚本自己的 bug，必须修锚点）
      —— 这两种都表现为"测试全绿"，但结论完全相反。**2026-10-29 实测踩到过一次**：
      M30 被写成 `const _ignored = true` 这种空变异，若没有这个检测，差点被当成"判据有洞"去改判据。
- [x] 空变异守卫（`from === to` 直接 exit 1）+ `--only <id>` 单条迭代

| #   | 故意改坏什么                           | 代表哪类失效                             |
| --- | -------------------------------------- | ---------------------------------------- |
| M1  | `reactPathMissing` 降级 must→note      | 主线丢失真问题                           |
| M2  | `parseContract` 不再区分缩进层级       | 嵌套 key 泄漏、契约被拍平                |
| M3  | 关掉 `unregisteredKeyframes` 检测      | motion 腿变哑                            |
| M4  | 让 note 也进主线段                     | 违反 10-24 方向铁律                      |
| M5  | `figmaOnly` 的 target 指错文件         | agent 改错地方                           |
| M6  | descriptions 腿只认 `description` 字段 | 全量误报（40+ 假附注）                   |
| M7  | 令牌名重复 `--` 前缀                   | 渲染成 `----accent`                      |
| M8  | 关掉「AI_CONTRACT 缺必填字段」检测     | 描述腿变哑                               |
| M9  | 允许豁免 `must` 级差异                 | 真问题被"为了过门禁"豁免掉               |
| M10 | 退化快照守卫失效（两个数组都空）       | 空/截断快照 → 门禁假绿                   |
| M11 | 豁免条目不要求 `reason`                | 随手加一条就能过门禁                     |
| M12 | 豁免条目条件全空也生效                 | 豁免掉一切差异                           |
| M13 | 调用点不传 `screens`                   | 屏幕不参与反向查找 → 30 条误报           |
| M14 | 整条关掉 tokens 腿                     | tokens 腿此前**不可测**                  |
| M15 | 豁免不按 `kind` 过滤                   | 豁免 A 顺带豁免 B                        |
| M16 | 豁免不按 `target` 过滤                 | 豁免范围失控                             |
| M17 | react 路径不清洗引号（lib 层）         | 带引号的路径 → 假 must                   |
| M18 | 屏幕不走正向检查                       | 屏幕的 react/重建完全看不见              |
| M19 | counts 交叉校验失效                    | 只抄 1 个组件的截断快照能通过            |
| M20 | motion 采集失败不报错                  | motion 的 must 永远报不出来              |
| M21 | 快照缺失时 exit 0                      | `git rm` 快照就能让门禁变绿              |
| M22 | `reason` 只判空不判类型                | `reason: true` 也能豁免                  |
| M23 | `@keyframes` 回到子串匹配              | 散文单词被当成"已登记"（漏报）           |
| M24 | `--only` 拼错不报错                    | 静默跑成 0 条差异                        |
| M25 | 豁免不按 `lane` 过滤                   | motion 的豁免顺带豁免掉 components       |
| M26 | 组件调用点不清洗 react 路径            | 报给 agent 的是带引号的死路径            |
| M27 | 屏幕调用点不清洗 react 路径            | 带引号 → "不像路径" → 屏幕 must 静默消失 |
| M28 | 组件集也享受「不像路径就跳过」的豁免   | `xxx.tsx（待新建）` 静默漏报             |
| M29 | 组件侧的「映射抄错节点」不报           | 抄到别的**存在**的节点查不出             |
| M30 | 屏幕侧的「映射抄错节点」不报           | 同上 · 屏幕侧                            |
| M31 | token dump 的 `variables` 空数组不报错 | tokens 腿静默跳过                        |
| M32 | motion 非对象不报错                    | 采集失败被当成"没有动效"                 |
| M33 | `motion.spec` 非数组不报错             | motion 腿静默跑成 0 条差异               |
| M34 | `reactPathOf` 清洗顺序倒过来           | 路径尾部残留引号 → 假的 must             |
| M35 | 显式指定的 `--code-connect` 缺失不报错 | 静默当成空映射表，清单失真               |
| M36 | code-connect 映射表存在但为空不报错    | 全都变 unmapped → 豁免掉 → 门禁假绿      |
| M37 | 「是不是屏幕」不按来源判               | 撞名组件集白拿屏幕豁免 → 静默漏报        |

- [x] 还原后复跑 → 68/68 绿
- [x] 端到端反例：坏快照必须报出差异且退出码非 0；干净快照 → 零 must/should
- [x] **M9 是被变异验证抓出来的**：那条测试原本还剩别的 `should` 项撑着 exit 1，
      就算 `must` 被豁免也看不出区别 ⇒ 测试没在测它声称的东西。修法：把 `unmapped`
      一并豁免，让 `must` 成为唯一生效差异。

### 6.2.1 独立评审（2026-10-29，Claude Code 在沙箱里跑）

评审在 `/tmp` 沙箱里对 `feat/figma-diff` 跑了 11 条候选变异，**6 条存活**
⇒ 说明当时的测试没在测它声称的东西。本地复核**逐条复现了存活**（不是"疑似"）：

| 存活变异               | 后果                                | 现在由谁守住              |
| ---------------------- | ----------------------------------- | ------------------------- |
| 调用点不传 `screens`   | 30 条 orphaned 误报                 | M13 + 端到端用例          |
| 整条关掉 tokens 腿     | tokens 腿此前**不可测**（路径写死） | M14 + `--token-dump` 参数 |
| 豁免不按 `kind` 过滤   | 豁免 A 顺带豁免 B                   | M15 + 端到端用例          |
| 豁免不按 `target` 过滤 | 豁免范围失控                        | M16 + 端到端用例          |
| react 路径不清洗       | 带引号的路径 → 假 must              | M17 + 端到端用例          |
| `reason` 非字符串      | `reason: true` 也能豁免             | M22 + 端到端用例          |

评审还找出 **5 条判据漏洞**（都能让 `--gate` 在不该绿时变绿），全部已修：
快照缺失 / 退化快照只查"都空" / motion 采集失败不报 / 屏幕不走正向检查 / 屏幕重建无信号。
对应 M19–M21、M24 与新增守卫（§5.3）。

> 评审同时确认：**首份快照 4 个抽查对象全对**（nodeId / 变体数 / react 路径 /
> Hologram/Cover 确实没有契约段）—— 内容真实性由它对着画布核过，我只验了结构。

### 6.2.2 第二轮独立评审（2026-10-29，同样在沙箱里跑）

> **自己的盲区是自己的盲区** —— 第一轮修完不等于没有洞。
> 评审用自己的变异集再跑一遍，又找出 **2 条存活变异 + 2 个新引入的回退 + 1 个退化输入**。
> 全部本地复现并修掉，且**每一条都补成了变异项**（M25–M35）。

| 评审发现                                       | 后果                                                                           | 现在由谁守住               |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| **S4** 豁免不按 `lane` 过滤（存活）            | 一条 `{lane:"motion"}` 把 components 的 should 也豁免                          | M25 + 端到端用例           |
| **S6** 调用点不清洗 react 路径（存活）         | 组件侧报出带引号的死路径；屏幕侧带引号 → "不像路径" → **屏幕的 must 静默消失** | M26 / M27 + 两条端到端用例 |
| **B** 组件集也享受「不像路径就跳过」（新回退） | `react: xxx.tsx（待新建）` **静默漏报**（615a29d 能报，fe13a07 反而不报）      | M28 + 端到端用例           |
| **C** 映射抄到另一个「存在」的节点（新回退）   | 只看"映射 id 在不在快照里"查不出抄错节点                                       | M29 / M30 + 两条端到端用例 |
| token dump `{"variables":[]}`（退化输入）      | tokens 腿静默跳过，exit 0                                                      | M31 + 端到端用例           |

另外两处连带修掉的真缺陷：

- `reactPathOf` 的**清洗顺序反了**（先去引号再去尾逗号）⇒ 路径尾部残留一个引号 ⇒ 假的 must。
  之前被"不像路径就跳过"的检查掩盖着，直到组件集不再享受那个豁免才暴露。⇒ M34。
- 变异清单里 **M19 与 M10 锚点完全相同**（"24 条"实际只有 23 条不同）⇒ M19 改成 counts 交叉校验。

> **这次评审暴露的一件事，比它找出的洞本身更重要**：
> 评审明确指出「M13–M24 里有没有空变异」——**空变异（改了源码但没改行为）会让变异验证
> 报出"存活"，而结论完全相反**。于是给变异脚本加了**等效变异检测**（§6.2）：
> 测试全绿时再比对真实快照上的行为指纹。
> **2026-10-29 实测立刻咬到**：M30 被我写成 `const _ignored = true` 这种空变异，
> 若没有这个检测，差点被当成"判据有洞"去改判据 —— 而真相是**我的锚点写错了**。

### 6.3 接线

- [x] `package.json` 新增 `figma:diff` / `figma:diff:json` / `figma:diff:gate` / `figma:test` / `figma:diff:mutation`
- [x] `test:ci` 追加 `node scripts/figma-diff.test.mjs && node scripts/figma-diff.mjs --gate`
- [x] `npm run test:ci` 全量绿（新腿不破坏既有腿）

### 6.4 采集路径可用性

- [ ] 用真实 Figma 文件跑一次 `figma-snapshot-seg.js` 的 SEG1，产出首份 `scripts/figma-snapshot.json`
- [ ] 跑 `npm run figma:diff` 核对清单与设计稿实际状况一致（人工抽查 ≥3 条）

---

## 7. 已知死结与边界

| #   | 死结                                         | 出路                                                                                                                                  |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **采集必须人工落盘**（use_figma 无 fs 权限） | 落盘一步；或等 Figma MCP 支持本地文件写                                                                                               |
| D2  | **云端 MCP 有 20 次/月限额**（Starter 团队） | 只读段也吃限额 ⇒ **每月 1-2 次**，设计稿大改后才重采                                                                                  |
| D3  | **REST `variables/local` 要 Enterprise PAT** | 本机无 PAT ⇒ OAuth 是唯一可行路径（即 D1 的采集段）                                                                                   |
| D4  | **motion spec 补登记是双向死锁**             | 补条目须**同步 Figma**（`audit-d10` 核对「Figma ↔ 仓库 id 集合一致」），只改仓库会让校验红 ⇒ 需同时有 token                           |
| D5  | **token 腿的 dump 仍停在 10-13**             | 本轮不改 `check-token-drift` 语义；刷新 dump 需先解 D2/D3                                                                             |
| D6  | **只有 10/35 组件带 AI_CONTRACT 段**         | 没契约 ⇒ 读不到 `react` 路径 ⇒ components 腿对那 25 个组件是瞎的。属设计稿侧写操作（10-24 归档区），但它是**驱动的前提** ⇒ 需单独拍板 |

### 7.1 与 2026-10-24 归档决策的关系

本专题**不是**被归档的那 32 条里的一条，理由是层次不同：

| 层次                                     | 处理                | 本专题归属  |
| ---------------------------------------- | ------------------- | ----------- |
| 一次性补齐（已做完的对齐）               | 归档 ✅             | —           |
| 持续对齐（每次改设计稿都要手工做一遍）   | 归档 ✅（ROI 递减） | —           |
| **驱动基础设施**（一次性投入、永久复用） | **不该按"对齐"砍**  | **✅ 在此** |

`figma:diff` 属于第三层：它不"对齐"任何东西，它**让变更可被感知**。
用户 2026-10-29 的原话：「我需要能从 figma 设计稿向下驱动前端的工程设计，
因为很可能 figma 设计稿，我会随着时间的推移，变更设计」。

### 7.2 首份真实快照揭示的基线（2026-10-29 采集，commit `c31d6d1`）

> 这是本专题**最有价值的一次产出**：不是"清单有多长"，而是**第一次量出了「向下驱动」的覆盖率**。

快照规模：**35 个组件集 / 15 屏 / 20 条动效规格**。

| 维度                                 | 数字                                      | 含义                                                 |
| ------------------------------------ | ----------------------------------------- | ---------------------------------------------------- |
| 组件**有** AI_CONTRACT 段            | **10 / 35**                               | 只有 29% 的组件带结构化契约                          |
| 屏幕**有** AI_CONTRACT 段            | **6 / 15**                                | 正好是 D1 补的那 6 屏；其余 9 屏没有                 |
| 组件**有** description（有语义载体） | 31 / 35                                   | 4 个连描述都没有                                     |
| 有描述但**没契约段**                 | 21                                        | 写了散文、没写契约 —— 处置方式跟"完全没写"不同       |
| `must` 级差异                        | **0**                                     | 10 个带契约的组件，其 react 路径在仓库里**全部存在** |
| `should` 级差异                      | 10（未映射）+ 1（39 个 keyframes 未登记） | 已豁免，见 §5.3                                      |

**三条结论**（数据说的，不是我猜的）：

1. **「向下驱动」目前只覆盖 29% 的组件。** 没有 AI_CONTRACT 段 ⇒ AI 读不到
   `react` 路径 ⇒ diff 的 components 腿对那 25 个组件**是瞎的**。
   ⇒ 现在的"0 项要改"准确含义是**「在已登记契约的 10 个组件上，前端没有欠账」**，
   不是"整个设计稿跟前端一致"。
2. **这是设计稿侧写操作 ⇒ 属 10-24 归档区**，不占待办清单位置。
   但它是**驱动的前提**（不是"对齐"）—— 与本专题同一层次，值得单独拍板。
3. **10 个带契约的组件 react 路径全部存在** ⇒ 一旦设计稿改了这些组件的契约，
   工具立刻能报出"该改哪个文件"。**这条链在已登记的范围内是通的** —— 这才是本专题的交付。

---

## 8. 采集（人工步骤）

> 2026-10-29 用户拍板：**走 Claude Code 手动跑一次**（零配置），**快照提交进仓库**
> （有了基线，`--gate` 才是真门禁）。
>
> **✅ 已执行**（2026-10-29，commit `c31d6d1`）：产出 `scripts/figma-snapshot.json`
> —— 35 组件 / 15 屏 / 20 动效。基线见 §7.2。

在 Claude Code（已连 Figma MCP、有 fs 权限）里贴这一段：

```
在 /Users/tangshuai/maestro 仓库里做一件事：采集 Figma 设计稿快照。

1. 读 scripts/figma-snapshot-seg.js，取出 SEG1 常量里的那段代码（模板字符串内容，
   去掉反引号和 module.exports 行）。
2. 调 use_figma：
   - fileKey: FtbRZXvzlCp4Sq9e322cQQ
   - skillNames: ["resource:figma-use"]
   - code: 第 1 步取出的代码原文，一字不改
3. 把返回的 JSON 原样写进 scripts/figma-snapshot.json：
   - 外层补 "capturedAt": "<当前 ISO8601 时间，带 +08:00>"
   - 其余字段（fileKey/pages/components/screens/motion/counts）照抄，不改写、不截断
4. 自检：确认 components 数组长度 > 0、screens 数组存在（长度可以为 0）。
   如果 components 是空的，说明采集失败或输出被截断 —— 报给我，不要写文件。
5. 写完说一声。

纯只读采集：不要创建/修改/删除任何 Figma 节点。
```

> ⚠️ **沙箱实测（2026-10-29 首次真实采集踩到的）**：`use_figma` 运行时**读不存在的属性会直接抛错**
> ⇒ 采集段里**不能**做 `node.findAllWithCriteriaAsync ? ... : ...` 这种特性探测，
> 必须直接调 `node.findAllWithCriteria({ types })`。（原实现是特性探测，首次采集直接失败。）

然后：

```bash
# 出清单
npm run figma:diff

# 「需要改前端代码」那节 → 直接喂给 coding agent

# 提交快照（让 --gate 在 CI 里成为真门禁）
git add scripts/figma-snapshot.json && git commit -m "figma: 首次采集设计稿快照"
```

⚠️ **快照落盘后要顺手做两件事**（✅ 已做，见 §5.3 与 tasks H3/H4）：

1. **删掉 `scripts/acceptance-evidence-ignore.json` 里本专题那条豁免** ——
   文件一旦存在，验收证据门禁就能自己校验到，不需要豁免了（豁免留着反而是噪音）。
2. **按真实差异核对 `scripts/figma-diff-allowlist.json`** ——
   豁免表是按当前已知的两类 should 级差异预置的（code-connect 覆盖率 / motion spec 登记）。
   真实快照落地后如果这两类已经不存在、或换了别的类，就按实际情况增删，
   **每条必须带 reason**。豁免表和快照一起提交，CI 才不会当天就红。

> 配额提醒：云端 MCP 在 Starter 团队 20 次/月，**只读段也吃**（2026-10-23 实测）。
> 跑一次 = 1 次 ⇒ 每月 1-2 次，设计稿大改后才重采。

快照结构：

```jsonc
{
  "capturedAt": "2026-10-29T10:00:00+08:00",
  "fileKey": "FtbRZXvzlCp4Sq9e322cQQ",
  "components": [
    {
      "name": "Modal/Shell",
      "nodeId": "514:72",
      "type": "COMPONENT_SET",
      "variants": ["Default"],
      "contract": "AI_CONTRACT:\n  react: ...", // 只取 ---...--- 段
      "hasDescription": true, // 语义载体有没有
      "descriptionPreview": "", // 只有「有描述但没契约段」时才有内容
    },
  ],
  "screens": [{ "name": "Screen/Home", "nodeId": "1:2", "type": "FRAME", "contract": "..." }],
  "motion": { "spec": [/* ... */], "version": "..." },
  "pages": ["02 · Components", "03 · Screens", "04 · Motion"],
}
```

---

## 9. 文件清单

| 文件                                          | 类型 | 作用                                                        |
| --------------------------------------------- | ---- | ----------------------------------------------------------- |
| `scripts/figma-diff.mjs`                      | 新   | 主入口（四腿比对 + 输出 + gate）                            |
| `scripts/lib/figma-snapshot.mjs`              | 新   | 纯函数核心（契约解析 / 四腿 diff / 渲染）                   |
| `scripts/figma-snapshot-seg.js`               | 新   | use_figma 只读采集段（SEG1）                                |
| `scripts/figma-diff.test.mjs`                 | 新   | 68 个反向验证测试                                           |
| `scripts/figma-diff.mutation.mjs`             | 新   | 可复现变异验证（37 条变异，改坏判据必须红）                 |
| `scripts/figma-diff-allowlist.json`           | 新   | should 级豁免表（必填 reason；must 不可豁免）               |
| `package.json`                                | 改   | 5 个 script + `test:ci` 追加两段                            |
| `scripts/lib/figma-contract-payload.mjs`      | 新   | 契约草案推导（纯函数，不编造）                              |
| `scripts/lib/figma-contract-section.js`       | 新   | **契约段的唯一实现**（提取/判定/合并；三处共用）            |
| `scripts/figma-contract-payload.mjs`          | 新   | 草案生成器 CLI（+ `--check` 防漂移）                        |
| `scripts/figma-contract-payload.test.mjs`     | 新   | 33 个反向验证测试                                           |
| `scripts/figma-contract-payload.mutation.mjs` | 新   | 12 条变异验证                                               |
| `scripts/figma-contract-section.test.mjs`     | 新   | 18 个反向验证（含「三端口径一致」）                         |
| `scripts/figma-contract-section.mutation.mjs` | 新   | 10 条变异验证                                               |
| `scripts/figma-contract-payload.json`         | 新   | 生成物：待写清单                                            |
| `scripts/figma-write-plugin/manifest.json`    | 新   | 写入插件的 manifest                                         |
| `scripts/figma-write-plugin/plugin.src.js`    | 新   | 写入插件源码（`__PAYLOAD__` + `__CONTRACT_SECTION__` 占位） |
| `scripts/figma-write-plugin/code.js`          | 生成 | 插件产物（payload + 共享实现内联）                          |

---

## 10. 写通道 —— 把契约段写回设计稿（2026-10-29）

### 10.1 为什么不用 MCP 写工具

| 通道                             | 写画布？            | 要求                                          |
| -------------------------------- | ------------------- | --------------------------------------------- |
| 远程 MCP（`mcp.figma.com/mcp`）  | ✅ `use_figma`      | 付费套餐 + **Full** 席位（写团队文件需 Full） |
| 桌面 MCP（`127.0.0.1:3845/mcp`） | ❌ **不支持写画布** | 付费套餐 + Dev/Full                           |
| **本地开发插件**（本专题采用）   | ✅                  | **任何套餐都行**，只需「你对文件有编辑权」    |
| REST API + PAT                   | ❌                  | REST 对**文件内容是只读**的，没有改节点的接口 |

⇒ 官方口径：「Creating a development plugin is supported on any plan」。
插件的写入权限 = **用户自己对该文件的编辑权**，不看席位类型、不看套餐墙，
**也不吃 MCP 配额**（200/天那个计数器管的是 MCP 工具调用）。
⇒ 不必等席位升级、不必把文件搬进教育团队。

### 10.2 三条红线（生成器 + 插件共同守住）

1. **不编造** —— 推不出来的字段不生成。最典型的是 `react` 路径：
   没有 code-connect 映射 ⇒ 这个组件在前端**还没有归属** ⇒ 编一个路径等于给前端
   发一条它永远不会兑现的 must ⇒ **跳过并写明原因**。
2. **格式对** —— 载体文本必须用 `---` 裹住。采集段的 `contractOf()` 是
   `raw.match(/---([\s\S]*?)---/)` ⇒ **不裹就提不出契约段**（写→读闭环断）。
3. **推导不越界** —— `states` 只认 `state=` 前缀的变体；
   `platform=` / `provider=` / `quality=` / `tone=` 是别的维度。
   实证：已完成的 `SourceChip` 变体是 `platform=qq|…`，而它的 `states` 是
   `[default, best, no-rights]` —— 压根不在变体里。

### 10.3 契约内容**不是**机械推导得出来的（2026-10-29 实测）

逐条比对 code-connect 映射与 10 份已有人工契约，发现：

- `props` —— 映射是 `{provider: MusicProvider}`，人工契约写的是
  `{provider: enum[qq|netease|deezer|spotify]}`；`Array` 写成了 `DeezerEditorial[]`；
  `string?` 一处写成 `panelClassName?: string`、另一处（Titlebar）写成不带 `?`；
  Titlebar 的 23 个 props 到契约里变成 22 个、顺序变了、类型整列省略。
- `a11y` / `tokens` / `bindings` —— 映射里**根本没有**这些字段。

⇒ 所以生成器**只起草 + 标注来源**，不冒充权威：
每个字段带 `provenance`（`mapping` / `mapping-signature` / `variants` /
`convention` / `none`），整段带 `draft: true`，报告里单列「需人审阅」的部分。

### 10.4 落地流程

> 逐步操作指引见 **`docs/figma-contract-write-guide.md`**（给人照着做的那份）。

```bash
npm run figma:payload          # 生成 payload.json + 插件产物 code.js + 审阅报告
npm run figma:payload:check    # 产物与快照是否同步（漂移 ⇒ exit 1）
```

然后在 **Figma 桌面 App**：

1. Plugins → Development → **Import plugin from manifest**
   → 选 `scripts/figma-write-plugin/manifest.json`
2. ⚠️ 必须处于 **Design 模式**（不是 Dev Mode；`Shift+D` 是双向切换）
3. 打开 AETHER 文件 → 运行插件 → 看通知里的「应用 N 条」

**幂等**：生成器只产出「还没有契约段」的节点，插件运行时再查一次载体 ⇒
重复跑不会覆盖、不会叠加。

### 10.4.1 「契约段」只有一份实现（2026-10-29 修 P1）

三处都在做同一件事：「从载体文本里把契约段抠出来」——
**采集段**（提取）、**写入插件**（判幂等 + 写回）、**生成器**（判跳过）。
以前三处各写一份，口径不一致 ⇒ **静默漏写**：

> 插件用「文本里含 `AI_CONTRACT:`」判幂等，采集段用 `/---([\s\S]*?)---/` 提取。
> 散文里顺口提一句 `AI_CONTRACT:` ⇒ 插件以为「已经写过了」而跳过，
> 采集段却提不出契约段 ⇒ 设计稿上永远没有契约，而 `figma:diff` **现场看不出任何异常**。

⇒ 现在共用 **`scripts/lib/figma-contract-section.js`**（唯一实现）：

| 函数                                 | 作用                                         |
| ------------------------------------ | -------------------------------------------- |
| `extractContractSection(raw)`        | 按 `/---([\s\S]*?)---/` 提取段正文           |
| `hasContractSection(raw)`            | 有没有契约段（**不是**「文本含不含关键词」） |
| `mergeContractSection(raw, section)` | 把契约段**合进**载体文本，不覆盖             |

**怎么做到「只有一份」而三处都能用**（采集段与插件都跑在 Figma 沙箱里，不能 import）：

- 采集段（`scripts/figma-snapshot-seg.js`）= CommonJS ⇒ require 时用
  `fn.toString()` 把**函数源码**拼进 SEG1 字符串；
- 写入插件（`scripts/figma-write-plugin/`）= 由 `scripts/figma-contract-payload.mjs`
  同样用 `toString()` 内联（`__CONTRACT_SECTION__` 占位符）。

⇒ 两边跑的是**同一份源码**，不可能漂移。
判据：`scripts/figma-contract-section.test.mjs` 里有「三端口径一致」用例
（把 SEG1 与 code.js 里的内联实现抠出来，在沙箱里跑同一批输入，比对行为）。

⚠️ **比对层 `scripts/lib/figma-snapshot.mjs` 不参与这份实现**（别再往里加）：
它消费的是采集段**已提取好的契约原文**（快照的 `contract` 字段），只做 YAML 浅解析，
**根本不做 fence 提取** ⇒ 没有口径可漂移。

⚠️ **踩过的坑（别再踩）**：SEG1 是模板字符串，但 `${...}` 插值是**字面替换**
（插进来的内容不再被模板解析）⇒ 预先把 `\` 翻倍会留下 `\\s`（正则变成匹配字面反斜杠），
不翻倍又依赖「插值不再解析」这一脆弱事实。
⇒ 最终改成**在模板之外拼好最终字符串**（`SEG1_PART1 + SHARED + SEG1_PART2`），
没有第二层求值 ⇒ 不用转义。

⚠️ **模板字符串里的注释也不能随便写反引号**（2026-10-29 实测）：
在 SEG1 的模板段落里写了一个 `` `---` `` 形式的行内代码 ⇒ **反引号把模板字符串截断**
⇒ SEG1 整段语法错 ⇒ 采集段完全跑不起来。
而当时**所有既有测试都是绿的** —— 因为没人真跑过 SEG1（见 §10.4.4）。

### 10.4.2 合并不覆盖（2026-10-29 修 P0 —— 会丢数据）

真实快照里 **21 个组件已有人工写的散文 description**
（例：「Holographic cover area 480×500: orbit ring + 12 ticks…」）。
插件原来写的是 `node.description = text` ⇒ **跑一次就把那些设计文档抹掉**（不可逆）。

⇒ 改为 `mergeContractSection()`：**契约段放前面**、**散文原样保留在后面**。

契约段为什么放前面：

- 采集段用 `/---([\s\S]*?)---/` 提取 —— **非贪婪，取第一对 `---`**。
  契约段在前 ⇒ 提取到的就是契约段；散文在前 ⇒ 散文里若出现 `---` 会提错段。
- 与既有 10 份人工契约的形态一致（契约段在 description 开头）。

判据：`scripts/figma-contract-section.test.mjs` 里
「真实快照: 21 个「有散文无契约」的节点 ⇒ 合并后散文全在」用例，
逐字比对散文（不只是 `includes`）。

### 10.4.3 Figma Plugin API 的三条硬事实（2026-10-29 查官方文档）

| 事实                                                      | 影响                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentAccess: dynamic-page` 下**不会**自动装载全部页面 | 跨页访问节点前必须 `await figma.loadAllPagesAsync()`，否则读未加载页会抛错                                                                                              |
| 同步 `figma.getNodeById` **已废弃**                       | 用 `await figma.getNodeByIdAsync(id)`                                                                                                                                   |
| **Figma 会为插件预载 Inter 字体**                         | `loadFontAsync({family:'Inter'})` 几乎必然成功；兜底用 `listAvailableFontsAsync()`（**不用** `figma.root.findAll` —— 它在 dynamic-page 下只遍历当前页，且大文件上很慢） |

`figma.closePlugin()` 的参数是**字符串**（官方签名 `closePlugin(message?: string)`）
⇒ 传对象会被忽略，调用方拿不到任何结果 ⇒ 传摘要字符串，并在失败时点名是哪几个。

### 10.4.4 「只有一份」要怎么**守得住**（2026-10-29）

「共用一份源码」这件事本身**不构成门禁**。两种漏法：

| 漏法                                     | 现象                                        | 怎么抓                                               |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| **行为漂移**（口径改了）                 | 三处提取结果不一致 ⇒ 静默漏写               | 「三端口径一致」用例（把内联实现抠出来同批输入比对） |
| **结构漂移**（又写了一份，行为暂时一致） | 变成两份实现 ⇒ 迟早漂移，但**当下测试全绿** | **结构性守卫**：fence 正则只许出现在共享实现区域内   |

⇒ 因此有三条硬要求：

1. **结构性守卫**（`figma-contract-section.test.mjs`）
   采集段 / 插件产物 / 插件源码里，fence 正则的**区域外计数必须为 0**、
   总数必须为 1。配套两条变异（M11 采集段 / M12 插件源码）⇒ 改坏必被抓。
2. **采集段必须真跑一遍**（同文件「采集段端到端」用例）
   SEG1 是「贴给 `use_figma` 执行的代码字符串」，不参与构建/测试 ⇒
   它坏了没有任何门禁会发现。
   ⇒ 用最小 figma mock + `AsyncFunction` 执行 SEG1，断言组件腿/屏幕腿/动效腿
   与 `counts` 一致性。**实证**：本轮第一次真跑就抓到模板字符串里的反引号把模板截断
   （而当时所有既有测试都是绿的）。
3. **不留第二份手写实现**
   MOTION SPEC 的 JSON 用的是同一套 `---` 包裹约定，
   采集段里曾有**唯一**一份手写的第二份正则 ⇒ 已统一到共享实现。
   （约定一改，motion 腿会**静默失效**：提不出 JSON ⇒ spec 空 ⇒ 门禁看不出异常。）

### 10.5 当前基线（2026-10-29）

| 分类                                | 数量 | 说明                                                  |
| ----------------------------------- | ---- | ----------------------------------------------------- |
| 可写（有映射 + 有 nodeId 严格相等） | 15   | 全部指向 `views/TheaterView.tsx`（文件已存在）        |
| 跳过：已有契约段                    | 16   | 幂等，不覆盖                                          |
| 跳过：无 react 归属                 | 19   | **前端还没有对应组件** ⇒ 需要先做 code-connect 补映射 |

⚠️ **这 19 个才是 I1 的真阻塞**：它们缺的不是「能写进 Figma」，
而是「在前端该对应哪个组件」。补契约不能替代那个决定。
写完这 15 条后，`figma:diff` 的 components 腿覆盖率会从 **10 个组件 → 25 个**，
且从此这些组件的 react 路径进入**持续校验**（文件被删/改名会被报出来）。
