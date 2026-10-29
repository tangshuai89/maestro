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
npm run figma:diff -- --verbose       # 附带 keyframes / spec 计数
npm run figma:test                    # 只跑判据自检（36 个反向验证）
npm run figma:diff:mutation           # 变异验证（改坏判据 → 必须有测试红）
```

### 5.1 退出码

| 码  | 含义                                                                   |
| --- | ---------------------------------------------------------------------- |
| 0   | 无未豁免的 must/should 差异，或**无快照已跳过**（还没采集不是错误）    |
| 1   | 有未豁免的 must/should 差异（`--gate` 时）；无 `--gate` 时仅 must 触发 |
| 2   | 用法/文件错误（快照显式指定却不存在、JSON 解析失败、**快照退化**等）   |

### 5.2 快照缺失的两档语义

- 默认路径 `scripts/figma-snapshot.json` 不存在 → **exit 0 + 提示如何采集**。
  理由：CI 里这条腿在没有采集时必须**静默通过**，否则第一次接线就红。
- `--snapshot <path>` 显式指定却不存在 → **exit 2**。理由：那是调用方的错，不能吞。

### 5.3 两条「防假绿」硬规则

> 这两条是 2026-10-29 实现期实测加的 —— 都是「看起来绿，其实没测到」的形态。

**① 空快照必须报错（exit 2）**

`components` 与 `screens` **同时为空** ⇒ 几乎一定是采集失败 / JSON 抄断 / 写成 `{}`。
这种快照跑出来的比对结果是"0 差异" ⇒ 门禁绿 ⇒ **而真相是"根本没采到"**。
⇒ 必须 exit 2 而不是当成"设计稿没有差异"。
（`motion` 可以为空 —— MOTION SPEC frame 可能不存在，不作为判据。）

**② `must` 永远不可豁免**

豁免表 `scripts/figma-diff-allowlist.json` 只对 `should` 生效。豁免条目必须带 `reason`，
否则视为**未登记**（不豁免）；匹配条件（`kind` / `lane` / `target`）不能全空，
否则等于豁免一切。豁免项**仍会打印**在清单的「已豁免」段 —— 只是不红。

**为什么需要豁免**：快照一提交进仓库，`--gate` 就从"永远跳过"变成**真门禁**。
而真门禁上线当天必然红 —— 当前已知的 should 级差异有两类（code-connect 覆盖率没跟上 /
motion spec 没登记全部 keyframes），短期修不完（后者要同步 Figma，是死锁）。
⇒ 照仓库既有范式 `scripts/token-drift-allowlist.json`：**类级豁免 + 必填 reason**，
修好一类就删一条豁免。**一个永远红的门禁等于没有门禁**（见 `specs/eval-driven-nl/`）。

---

## 6. 验收标准

### 6.1 功能

- [x] `node scripts/figma-diff.test.mjs` → **36/36 pass**
- [x] `node scripts/figma-diff.mjs` → 无快照时提示采集步骤并 exit 0
- [x] `node scripts/figma-diff.mjs --json` → `{ok, skipped, reason:"no_snapshot"}`
- [x] `node scripts/figma-diff.mjs --gate` → 有未豁免的 must/should 时 exit 1
- [x] `node scripts/figma-diff.mjs --only tokens` 单腿可用
- [x] `node scripts/figma-diff.mjs --snapshot /tmp/nope.json` → exit 2
- [x] markdown 主线段只含 must/should；note 单列「附注：设计稿侧待办（不占待办清单位置）」
- [x] 每条差异带 `target`（相对仓库根的文件路径）→ 可直接喂 coding agent
- [x] 空快照 / components-screens 非数组 → exit 2（不退化成"0 差异"）
- [x] 豁免项仍出现在清单「已豁免」段；`--json` 里进 `waived` 数组
- [x] `must` 被豁免 → 门禁仍红；豁免条目缺 `reason` / 条件全空 → 不豁免

### 6.2 判据可验证（**交付标准**）

> 判据类工具必须证明「改坏判据 → 测试会红」，否则等于没判据
> （D 系列反复吃过的教训，见 `specs/eval-driven-nl/`）。
>
> **一次性手测不算数** —— 必须是**可复现**的脚本，否则下次改判据时无法复查。

- [x] **可复现变异验证**：`scripts/figma-diff.mutation.mjs` → **12/12 变异全部被抓住**
      （脚本会原地改坏源码 → 跑测试 → 断言至少 1 个测试红 → 还原；
      基线不绿则直接 exit 1）

| #   | 故意改坏什么                           | 代表哪类失效               |
| --- | -------------------------------------- | -------------------------- |
| M1  | `reactPathMissing` 降级 must→note      | 主线丢失真问题             |
| M2  | `parseContract` 不再区分缩进层级       | 嵌套 key 泄漏、契约被拍平  |
| M3  | 关掉 `unregisteredKeyframes` 检测      | motion 腿变哑              |
| M4  | 让 note 也进主线段                     | 违反 10-24 方向铁律        |
| M5  | `figmaOnly` 的 target 指错文件         | agent 改错地方             |
| M6  | descriptions 腿只认 `description` 字段 | 全量误报（40+ 假附注）     |
| M7  | 令牌名重复 `--` 前缀                   | 渲染成 `----accent`        |
| M8  | 关掉「AI_CONTRACT 缺必填字段」检测     | 描述腿变哑                 |
| M9  | 允许豁免 `must` 级差异                 | 真问题被"为了过门禁"豁免掉 |
| M10 | 退化快照守卫失效                       | 空/截断快照 → 门禁假绿     |
| M11 | 豁免条目不要求 `reason`                | 随手加一条就能过门禁       |
| M12 | 豁免条目条件全空也生效                 | 豁免掉一切差异             |

- [x] 还原后复跑 → 36/36 绿
- [x] 端到端反例：坏快照必须报出差异且退出码非 0；干净快照 → 零 must/should
- [x] **M9 是被变异验证抓出来的**：那条测试原本还剩别的 `should` 项撑着 exit 1，
      就算 `must` 被豁免也看不出区别 ⇒ 测试没在测它声称的东西。修法：把 `unmapped`
      一并豁免，让 `must` 成为唯一生效差异。

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

| 文件                                | 类型 | 作用                                          |
| ----------------------------------- | ---- | --------------------------------------------- |
| `scripts/figma-diff.mjs`            | 新   | 主入口（四腿比对 + 输出 + gate）              |
| `scripts/lib/figma-snapshot.mjs`    | 新   | 纯函数核心（契约解析 / 四腿 diff / 渲染）     |
| `scripts/figma-snapshot-seg.js`     | 新   | use_figma 只读采集段（SEG1）                  |
| `scripts/figma-diff.test.mjs`       | 新   | 36 个反向验证测试                             |
| `scripts/figma-diff.mutation.mjs`   | 新   | 可复现变异验证（12 条变异，改坏判据必须红）   |
| `scripts/figma-diff-allowlist.json` | 新   | should 级豁免表（必填 reason；must 不可豁免） |
| `package.json`                      | 改   | 5 个 script + `test:ci` 追加两段              |
