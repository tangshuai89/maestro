# Figma → 前端 差异清单 — Tasks

> 专题：`specs/figma-diff/spec.md`
> 目标：**回答「设计稿变了，前端代码该改什么」，产出一份能直接喂给 coding agent 的清单。**

## Phase A — 采集层（已交付）

- [x] **A1** `specs/figma-diff/spec.md` — 范围 + 四腿判定 + 退出码 + 豁免机制 + 死结边界
- [x] **A2** `specs/figma-diff/tasks.md` — 任务跟踪
- [x] **A3** `scripts/figma-snapshot-seg.js` —— use_figma **只读**采集段（SEG1）
  - 遍历 `02 · Components`（COMPONENT_SET + 孤立 COMPONENT）/ `03 · Screens`（`Screen/` FRAME）/ `04 · Motion`（MOTION SPEC frame）
  - **只取 `---...---` 契约段**（精确提取，非截断）—— 返回体可控 + AI 只需结构化契约
  - 载体规则：`COMPONENT → .description` / `FRAME → 隐藏 TEXT 子节点 AI_CONTRACT|MOTION_SPEC`
    （与 `figma-aether-v4-audit-d1.mjs` §3、`audit-d10.mjs` 的 `carrierOf()` 同源）
  - 纯只读：不创建/修改/删除任何节点
- [x] **A4** 人工落盘路径写进采集段文件头（use_figma 无 fs 权限 → 采集是唯一死结）
- [x] **A5** 每个节点额外回传 `hasDescription` / `hasContract` / `descriptionPreview`
      （只有「有描述但没契约段」时才带预览，常规路径只多两个布尔量）

## Phase B — 比对层（已交付）

- [x] **B1** `scripts/lib/figma-snapshot.mjs` —— 纯函数核心（不碰 fs、不 spawn，可离线构造坏数据）
- [x] **B2** `parseContract()` —— AI_CONTRACT 浅解析（沙箱无 YAML parser → 只取顶层 key → 原始值）
- [x] **B3** `reactPathOf()` —— 契约里的 react 路径 → 干净文件路径（去引号/尾逗号）
- [x] **B4** `diffTokens()` —— `figmaOnly`/`valueMismatch` = must；`repoOnly` = note
  - 复用 `scripts/lib/aether-tokens.mjs` 的 `renderScss`/`parseGeneratedTokens`（与 D4 **同一套映射**，不复制第二份）
- [x] **B5** `diffComponents()` —— `reactPathMissing` = must；`unmapped`/`nodeIdChanged` = should；`orphaned` = note
- [x] **B6** `diffDescriptions()` —— 缺语义载体 / 缺 AI_CONTRACT / 缺必填字段 = note（整腿是附注）
- [x] **B7** `diffMotion()` —— spec `figmaOnly` = must；`unregisteredKeyframes` = should；`repoOnly` = note
- [x] **B8** `summarize()` / `renderMarkdown()` —— 主线段只放 must/should；note 单列「附注：设计稿侧待办（不占待办清单位置）」

## Phase C — 输出层（已交付）

- [x] **C1** `scripts/figma-diff.mjs` —— 主入口（读快照 + dump + code-connect + motion spec + 扫代码 `@keyframes` → 四腿比对）
- [x] **C2** markdown 输出（每条带 `action` + `target` 相对路径 → 可直接喂 coding agent）
- [x] **C3** `--json` 机器可读（`{ok, snapshot, meta, stats, statsAll, diffs, waived}`）
- [x] **C4** `--gate` 门禁（有**未豁免**的 must/should → exit 1）
- [x] **C5** `--only <lane>` 单腿（tokens / components / descriptions / motion）
- [x] **C6** `--snapshot <path>` 指定别的快照
- [x] **C7** `--verbose` 附带 keyframes / spec 计数
- [x] **C8** 退出码三档：0 = 无差异或**无快照跳过** / 1 = 有差异 / 2 = 用法或文件错误
  - 默认快照缺失 → exit 0 + 采集指引（还没采集不是错误）
  - `--snapshot` 显式指定却不存在 → exit 2（调用方的错，不吞）
- [x] **C9** **退化快照守卫**：`components`/`screens` 同时为空 → exit 2
      （空/截断的快照会比对出"0 差异"→ 门禁假绿，而真相是"根本没采到"）
- [x] **C10** **豁免机制** `scripts/figma-diff-allowlist.json`
  - 类级豁免 + **必填 reason**（照 `token-drift-allowlist.json` 既有范式）
  - **`must` 永远不可豁免**；匹配条件（kind/lane/target）不能全空
  - 豁免项仍打印在「已豁免」段 + `--json` 的 `waived` 数组 —— 只是不红
- [x] **C11** `--allowlist <path>` 指定别的豁免表（供离线测试用）

## Phase D — 判据自检（已交付）

- [x] **D1** `scripts/figma-diff.test.mjs` —— **57 个测试，全部反向验证**（喂坏数据断言判据报出来）
- [x] **D2** 端到端反例：坏快照必须报出差异且退出码非 0；干净快照 → 零 must/should
- [x] **D3** 端到端：快照文件不存在 → exit **2**（不是 1）
- [x] **D4** 端到端：空快照 → exit **2**（不得当成"0 差异"）
- [x] **D5** 端到端：豁免行为 → should 被豁免则门禁绿、`must` 被豁免则仍红、
      缺 `reason` / 条件全空 ⇒ 不豁免

## Phase E — 变异验证（已交付 —— 判据类工具的交付标准）

> 判据能不能主动抓出坏改动，必须靠**反证**，不能靠"真模型跑绿"（D 系列反复吃过的教训）
> **一次性手测不算数** —— 必须是**可复现**的脚本，否则下次改判据时无法复查。

- [x] **E1** `scripts/figma-diff.mutation.mjs` —— 可复现变异验证脚本
  - 对每个变异：改坏源码 → 跑 `figma-diff.test.mjs` → 断言**至少 1 个测试红** → 还原
  - 基线不绿直接 exit 1（"测试全绿"本身不证明判据被执行了）
  - 变异锚点必须唯一命中，否则视为变异无效并 exit 1
- [x] **E2** **24/24 变异全部被抓住**：

| #   | 故意改坏什么                           | 代表哪类失效             |
| --- | -------------------------------------- | ------------------------ |
| M1  | `reactPathMissing` 降级 must→note      | 主线丢失真问题           |
| M2  | `parseContract` 不再区分缩进层级       | 嵌套 key 泄漏、契约拍平  |
| M3  | 关掉 `unregisteredKeyframes` 检测      | motion 腿变哑            |
| M4  | 让 note 也进主线段                     | 违反 10-24 方向铁律      |
| M5  | `figmaOnly` 的 target 指错文件         | agent 改错地方           |
| M6  | descriptions 腿只认 `description` 字段 | 全量误报（40+ 假附注）   |
| M7  | 令牌名重复 `--` 前缀                   | 渲染成 `----accent`      |
| M8  | 关掉「AI_CONTRACT 缺必填字段」检测     | 描述腿变哑               |
| M9  | 允许豁免 `must` 级差异                 | 真问题被"为了过门禁"豁免 |
| M10 | 退化快照守卫失效                       | 空/截断快照 → 门禁假绿   |
| M11 | 豁免条目不要求 `reason`                | 随手加一条就能过门禁     |
| M12 | 豁免条目条件全空也生效                 | 豁免掉一切差异           |

- [x] **E3** 还原后复跑 → **57/57 绿**
- [x] **E4** **M9 是被变异验证抓出来的**：那条测试原本还剩别的 `should` 项撑着 exit 1，
      就算 `must` 被豁免也看不出区别 ⇒ 测试没在测它声称的东西。
      修法：把 `unmapped` 一并豁免，让 `must` 成为唯一生效差异。

## Phase F — 实现期发现并修掉的真缺陷

> 这几条不是"想到的"，是**跑起来之后被自己的判据/输出抓到的** —— 都补了回归测试 + 变异项。

- [x] **F1** 令牌名重复 `--` 前缀（渲染成 `----accent`）
  - 根因：`parseGeneratedTokens` 返回的 key 已含 `--`，比对层又拼了一次
  - 修法：`cssName()` 统一兜住；回归测试 + 变异项 M7
- [x] **F2** **descriptions 腿全量误报**（40+ 假附注，会把真附注淹没）
  - 根因：采集段只回传 `contract`，比对层却读 `description` 全文字段
  - 修法：采集段补 `hasDescription` / `descriptionPreview`；比对层优先认新字段（兼容旧格式）
  - 回归测试 + 变异项 M6
- [x] **F3** `parseContract` 嵌套 key 泄漏（`props` / `a11y` 被拍平成空值）
  - 根因：不区分缩进层级，`props:` 下的 `onPlay:` 被当成平级顶层 key
  - 修法：按缩进层级判定，嵌套内容归属父 key
  - 回归测试 + 变异项 M2

## Phase G — 接线（已交付）

- [x] **G1** `package.json` 新增 `figma:diff` / `figma:diff:json` / `figma:diff:gate` / `figma:test` / `figma:diff:mutation`
- [x] **G2** `test:ci` 追加 `node scripts/figma-diff.test.mjs && node scripts/figma-diff.mjs --gate`
      （快照缺失时该腿静默通过 ⇒ 第一次接线不红）
- [x] **G3** `npm run test:ci` 全量绿（新腿不破坏既有腿）

## Phase H — 首次真实采集（**已完成**）

> 2026-10-29 用户拍板：**Claude Code 手动跑一次** + **快照提交进仓库**。

- [x] **H1** 在 Claude Code 里跑采集段，产出首份 `scripts/figma-snapshot.json`
      → **35 组件 / 15 屏 / 20 动效**（commit `c31d6d1`）
- [x] **H2** `npm run figma:diff` 出清单，核对与设计稿实际状况一致
      → 揭示真实基线，见 spec §7.2
- [x] **H3** **删掉** `scripts/acceptance-evidence-ignore.json` 里本专题那条豁免
      （文件已存在，验收证据门禁自己能校验到；已验证撤掉后门禁仍绿）
- [x] **H4** 按真实差异核对 `scripts/figma-diff-allowlist.json`
      → 两条豁免都命中真实差异（10 个未映射 / 39 个 keyframes），理由已换成真实数字
- [x] **H5** 提交快照 + 豁免表 ⇒ `--gate` 在 CI 里成为真门禁

## Phase I — 首份真实采集暴露的问题（**待拍板**）

> 工具的第一次真实运行就量出了一个**此前没人知道的事实**（spec §7.2）：
> **35 个组件里只有 10 个带 AI_CONTRACT 段**（屏 6/15）。
> 没有契约段 ⇒ AI 读不到 `react` 路径 ⇒ components 腿对那 25 个组件是瞎的。

- [ ] **I1** **补 AI_CONTRACT 段到其余 25 个组件 + 9 屏** ——
      设计稿侧写操作（10-24 归档区，**不占待办清单位置**），
      但它是「向下驱动」的**前提**（不是"对齐"）⇒ 值得单独拍板
- [ ] **I2** code-connect 补 10 个映射（Icon/* ×8 · State/RecoUnconfigured · Scene/Backdrop）
- [ ] **I3** motion spec 补登记 39 个 `@keyframes` → **须同步 Figma**（`audit-d10` 核对 id 集合一致），只改仓库会让校验红
      （这是豁免表第 2 条的由来）
- [ ] **I4** code-connect 覆盖率反向检查（映射数落后于组件数，缺口静默扩大）→ `figma-code-connect-validate.mjs` 现无覆盖率检查
      （这是豁免表第 1 条的由来）
- [ ] **I5** 刷新 `scripts/figma-tokens-dump.json`（token 腿的 dump 停在 10-13）→ 需先解采集侧限制
- [ ] **I6** 刷新 `docs/d-series-status.md`（停在 10-15）
- [ ] **I7** D7-D1 的 6 条手连线是否随 10-24 决策一并归档

## Phase J — 并行 session 协作（已交付）

> 2026-10-29：Claude Code 在同一仓库里跑了采集段，并顺手修了我两个真缺陷。两处都经复核为**正确**。

- [x] **J1** 采集段特性探测失效 —— `use_figma` 运行时**读不存在的属性会直接抛错**
      ⇒ `node.findAllWithCriteriaAsync ? ... : ...` 直接失败。
      修法：只调 `node.findAllWithCriteria({ types })`。**沙箱实测事实**，已写进 spec §8。
- [x] **J2** `orphaned` 全量误报（30 条）—— code-connect 映射里有
      `Screen/Search/Modal` 这类指向 **03 · Screens 上的 FRAME** 的条目，
      但反向查找只查了组件集清单 ⇒ 全被判成"设计稿里没有"。
      修法：`diffComponents` 增加 `snapshotScreens` 参数，反向查找用「组件 ∪ 屏幕」。
- [x] **J3** 修完后自检 38/38 绿 · 变异 12/12 仍全被抓住

## Phase K — 独立评审的修复（已交付）

> 2026-10-29：Claude Code 在 `/tmp` 沙箱里评审 `feat/figma-diff`，跑了 11 条候选变异，
> **6 条存活** ⇒ 当时的测试没在测它声称的东西。本地逐条复现了存活，并全部修掉。

- [x] **K1** 快照缺失时 exit 0 → 改成 **exit 2**（`git rm` 快照就能让门禁变绿 = 最直接的绕过）
- [x] **K2** 退化快照守卫只查「两个数组都空」→ 加 **counts 交叉校验**（三个数必须逐一相等）
- [x] **K3** motion 采集失败（`parseError` / `missing` / 非对象）不报 → 全部 **exit 2**
- [x] **K4** **屏幕不走正向检查** → 屏幕的 react 路径不存在（must）/ 被重建（nodeIdChanged）现在都报得出
- [x] **K5** 屏幕重建后无信号 → 修 K4 时一并解决（映射 centric 判定）
- [x] **K6** 同名不同类（`Screen/SourceSelect` 既是组件集又是同名屏幕）→ **不误报** nodeIdChanged
      （这是 K4 引入的假阳性，已修：只有映射的 nodeId 在快照里**已不存在**时才报）
- [x] **K7** token dump 退化成 `{}` → tokens 腿静默跳过 → 改成 **exit 2**；并加 `--token-dump` 参数让它可测
- [x] **K8** `--only` 拼错 → 静默跑成 0 条差异 → 改成 **exit 2**
- [x] **K9** 豁免 `reason` 非字符串（`true`）也能生效 → 改成只认**非空字符串**，且处理**崩不了**
      （原来 `entry.reason.trim()` 在布尔值上抛 TypeError，退出码恰好也是 1 ⇒ 测试分不出"正确地不豁免"和"崩了"）
- [x] **K10** `@keyframes` 登记判定用子串匹配 → 改成 **token 精确比对**（散文里的 "faded-out" 不该让名为 "fade" 的 keyframe 算已登记）
- [x] **K11** 变异清单扩到 **24 条**（M13–M24 覆盖评审发现的 6 条存活 + 防绕过类）
- [x] **K12** 端到端测试加 `assertCleanJson()` 断言 —— 区分「脚本崩了」和「正确地不豁免」
- [x] **K13** 评审同时确认**首份快照 4 个抽查对象全对**（内容真实性由它对着画布核过）

---

## 变更日志

| 日期       | 变更                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-29 | 初版：Phase A–G 交付，30/30 绿，变异验证 8/8 被抓住                                                                                                                                               |
| 2026-10-29 | 实现期抓到并修掉 3 个真缺陷（F1 双 `--` / F2 descriptions 全量误报 / F3 嵌套 key 泄漏），补变异项 M6–M8                                                                                           |
| 2026-10-29 | 快照要**提交进仓库** ⇒ `--gate` 变真门禁 ⇒ 加 C9 退化守卫 + C10 豁免机制；变异项扩到 12 条；M9 被变异验证抓出测试自身有洞                                                                         |
| 2026-10-29 | 首份真实快照落地（35/15/20）⇒ Phase H 完成；量出「35 个组件只有 10 个带契约」这条基线（spec §7.2）；Phase I 记录待拍板项；Phase J 记录并行 session 修的两个缺陷（采集段特性探测 / orphaned 误报） |
| 2026-10-29 | 独立评审（Claude Code 沙箱）查出 5 条判据漏洞 + 6 条存活变异 ⇒ Phase K 全部修掉；自检 38→57，变异 12→24（全被抓住）；基线：0 must / 10 unmapped + 39 keyframes 已豁免                             |
