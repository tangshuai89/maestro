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
- [x] **C8** 退出码三档：0 = 无差异 / 1 = 有差异 / 2 = 用法或文件错误
  - ⚠️ 早先的规则是「默认快照缺失 → exit 0 + 采集指引（还没采集不是错误）」——
    独立评审实测那是**最直接的绕过路径**（`git rm` 快照就能让门禁变绿）⇒ **已改为 exit 2**（见 K1）
  - `--snapshot` / `--token-dump` / `--code-connect` 显式指定却不存在 → exit 2（调用方的错，不吞）
- [x] **C9** **退化快照守卫**：`components`/`screens` 同时为空 → exit 2
      （空/截断的快照会比对出"0 差异"→ 门禁假绿，而真相是"根本没采到"）
- [x] **C10** **豁免机制** `scripts/figma-diff-allowlist.json`
  - 类级豁免 + **必填 reason**（照 `token-drift-allowlist.json` 既有范式）
  - **`must` 永远不可豁免**；匹配条件（kind/lane/target）不能全空
  - 豁免项仍打印在「已豁免」段 + `--json` 的 `waived` 数组 —— 只是不红
- [x] **C11** `--allowlist <path>` 指定别的豁免表（供离线测试用）
- [x] **C12** `--token-dump <path>` / `--code-connect <path>` —— 路径可覆盖
      （原先写死 ⇒ **任何针对这两腿的判据都测不到**：变异验证实测「整条关掉 tokens 腿」测试仍全绿）

## Phase D — 判据自检（已交付）

- [x] **D1** `scripts/figma-diff.test.mjs` —— **68 个测试，全部反向验证**（喂坏数据断言判据报出来）
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
- [x] **E2** **37/37 变异全部被抓住**（完整清单见 spec §6.2；下表是前 12 条，编号 M1–M37）：

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

- [x] **E3** 还原后复跑 → **68/68 绿**
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
      （快照缺失时该腿静默通过 ⇒ 第一次接线不红 —— ⚠️ 这条规则后来被 K1 改成 exit 2，
      快照已提交进仓库后门禁才成为**真门禁**）
- [x] **G3** `npm run test:ci` 全量绿（新腿不破坏既有腿）
- [x] **G4** 变异验证脚本也接进 `test:ci`？（**未接** —— 它会原地改坏源码，
      并行跑 CI 与本地开发会互相打架 ⇒ 保持手动 `npm run figma:diff:mutation`）

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

- [ ] @blocked **I1** **补 AI_CONTRACT 段到其余 25 个组件 + 9 屏** ——
      设计稿侧写操作（10-24 归档区，**不占待办清单位置**），
      但它是「向下驱动」的**前提**（不是"对齐"）⇒ 值得单独拍板。
      **已拍板（2026-10-29）**：走「**升 Figma 席位**」路线。
      ⚠️ **下面这张表是查 Figma 官方文档核过的**（2026-10-29），
      **更正了此前的错误说法**：「升 Dev/Full 席位 ⇒ 解锁**桌面**写通道」——
      **桌面服务器根本不支持写画布**，写通道只在**远程**服务器。

      | 通道                                              | 写画布？                                 | 席位 / 套餐要求                                  |
              | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
              | **远程** `mcp.figma.com/mcp`（仓库 `.mcp.json` 就是它） | ✅ `use_figma` 写画布                    | **付费套餐（Professional/Org/Enterprise）+ Dev 或 Full 席位** |
              | **桌面** `http://127.0.0.1:3845/mcp`                | ❌ **不支持写画布**（只读 + 选区上下文）  | 付费套餐 + Dev/Full 席位（Collab 不行）             |
              | mcode-tools Figma 连接器（本 profile）              | ❌ 只有 2 个只读工具                     | —                                                 |

              **⇒ 正确的目标是：把团队从 Starter 升到付费套餐（Professional 起）+ Full 席位。**
              为什么是 **Full** 而不是 Dev：**「写自己 drafts 以外的文件需要 Full 席位」**
              —— AETHER 是**团队共享文件**，Dev 席位在它上面只有只读。
              （Dev 席位在**自己的 draft** 里可写。）

              **限额现状（官方表格）**：

              | 席位         | Starter | Professional（View/Collab） | Professional（Dev/Full） | Organization（Dev/Full） |
              | ------------ | ------- | -------------------------- | ------------------------ | ------------------------ |
              | 工具调用限额 | 20 / 月 | **6 / 月**（比 Starter 还少！） | 200 / 天，10–15 / 分钟    | 600 / 天，20 / 分钟       |

              ⚠️ **只升套餐不升席位会更差**（付费套餐的 View/Collab 席位只有 6 次/月）。
              ⚠️ 免限额的写工具只有 `whoami` / `add_code_connect_map` / `generate_figma_design`
              —— **`use_figma` 写画布要算进限额** ⇒ 补 34 个契约段要分批，别一次打完。
              ⚠️ **不要同时配桌面服务器**：官方明确说「两个都配时客户端可能连上桌面那个，
              于是远端独有的写工具永远加载不上」⇒ 保持 `.mcp.json` 只指向远程。

              ⇒ **「升席位 ≠ 立刻能干完，还差两步」这条已作废**（2026-10-29 Phase M 交付）：
              写段脚本**已存在**，而且**不需要任何席位升级** —— 本地开发插件的写入权限 =
              你自己对文件的编辑权（不看席位、不吃 MCP 配额）⇒ **不必等席位，也不必搬文件**。
              ⇒ I1 剩下的**真阻塞换了**：不是「写不进 Figma」，而是「**19 个组件在前端还没有归属**」
              ⇒ 走 **I2 / I4**（code-connect 补映射）。
              ⇒ 当前**可写 15 个**（都有映射），写完 components 腿覆盖率 **10 → 25**。

- [ ] @deferred **I2** code-connect 补 10 个映射（Icon/* ×8 · State/RecoUnconfigured · Scene/Backdrop）
      —— 属 10-24 归档决策里「持续对齐」那一类，等用户拍板
- [ ] @blocked **I3** motion spec 补登记 39 个 `@keyframes` → **须同步 Figma**（`audit-d10` 核对 id 集合一致），只改仓库会让校验红
      （这是豁免表第 2 条的由来；写权限被套餐锁死 ⇒ 解不开）
- [ ] @todo **I4** code-connect 覆盖率反向检查（映射数落后于组件数，缺口静默扩大）→ `figma-code-connect-validate.mjs` 现无覆盖率检查
      （这是豁免表第 1 条的由来；这是**真·欠着的工程活**，不需要 Figma 权限）
- [ ] @blocked **I5** 刷新 `scripts/figma-tokens-dump.json`（token 腿的 dump 停在 10-13）→ 需先解采集侧限制（缺 Enterprise PAT）
- [ ] @todo **I6** 刷新 `docs/d-series-status.md`（停在 10-15）
- [ ] @deferred **I7** D7-D1 的 6 条手连线是否随 10-24 决策一并归档 —— 等用户拍板

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

## Phase L — 第二轮独立评审的修复（已交付）

> 2026-10-29：Claude Code **第二轮**复审（用自己的变异集再跑一遍），又找出
> **2 条存活变异 + 2 个新引入的回退 + 1 个退化输入**。本地逐条复现，全部修掉，
> 且**每一条都补成了变异项**（M25–M35）—— 防复发靠的不是记忆，是可复现的脚本。

- [x] **L1** **豁免不按 `lane` 过滤**（评审存活 S4）—— 一条 `{lane:"motion"}` 的豁免
      把 components 的 should 也豁免掉 ⇒ 修 + 端到端用例 + 变异项 M25
- [x] **L2** **调用点不再清洗 react 路径**（评审存活 S6）——
      组件侧：报给 agent 的是**带引号的死路径**；屏幕侧：带引号的值"不像路径"
      ⇒ **屏幕的 must 静默消失**
      ⇒ 补两条端到端用例（组件侧断言 `detail.reactPath` 已去引号；屏幕侧断言必须报 must）
      ⇒ 变异项 M26 / M27
- [x] **L3** **回退 B**：组件集也享受「不像路径就跳过」的豁免
      ⇒ `react: xxx.tsx（待新建）` **静默漏报**（615a29d 能报，fe13a07 反而不报）
      ⇒ 该豁免**只对屏幕生效**（屏幕的 react 未必是路径，如「复用 TheaterView 条件渲染」）
      ⇒ 端到端用例 + 变异项 M28
- [x] **L4** **回退 C**：映射的 nodeId 抄成另一个**存在**的节点时不报
      ⇒ 建 nodeId→名字表：映射 id 指向别的名字 ⇒ 报 nodeIdChanged（`detail.mappedTo`）
      ⇒ 组件侧 + 屏幕侧各一条端到端用例 ⇒ 变异项 M29 / M30
- [x] **L5** token dump 的 `variables` 是**空数组**时静默跳过 tokens 腿 ⇒ 改成 exit 2
      ⇒ 端到端用例 + 变异项 M31
- [x] **L6** motion 非对象 / `motion.spec` 非数组 ⇒ 退出码 2
      ⇒ 补**隔离用例**：counts 传 null，让 counts 校验**不**拦 ⇒ 测到的确实是这两条守卫本身
      ⇒ 变异项 M32 / M33
- [x] **L7** `reactPathOf` **清洗顺序反了**（先去引号再去尾逗号）⇒ 路径尾部残留引号 ⇒ 假的 must
      ⇒ 改成**先逗号后引号** ⇒ 变异项 M34
- [x] **L8** 变异脚本加**等效变异检测**：测试全绿时再比对真实快照的**行为指纹**
      ⇒ 区分「判据没被测到」（真洞 → 修判据）与「锚点写错、压根没改到判据」（→ 修锚点）
      ⇒ **2026-10-29 实测立刻咬到**：M30 被我写成 `const _ignored = true` 这种空变异，
      若没有这个检测，差点被当成"判据有洞"去改判据
- [x] **L9** 变异脚本加 `--only <id>`（单条迭代）+ 空变异守卫（`from === to` 直接 exit 1）
- [x] **L10** 消除 **M19 / M10 锚点完全相同**的重复（"24 条"实际只有 23 条不同）
      ⇒ M19 改成 counts 交叉校验失效
- [x] **L11** 新增 `--code-connect <path>` 参数 —— 映射表路径原先写死 ⇒ 映射类判据没法端到端测
      ⇒ 显式指定却不存在 ⇒ exit 2（不能静默当成空映射表，清单会失真）⇒ 端到端用例 + 变异项 M35
- [x] **L12** **code-connect 映射表存在但为空** ⇒ 全部组件变 unmapped ⇒ 而 unmapped 在豁免表里
      ⇒ **门禁照样绿**（与「空 token dump」同一种退化）⇒ 改成 exit 2 + 端到端用例 + 变异项 M36
- [x] **L13** **「是不是屏幕」不能按名字判** —— 真实数据 `Screen/SourceSelect` 既是
      COMPONENT_SET（515:133）又是同名 FRAME（314:1432）。按名字判 ⇒ 那个**组件集**
      白拿「不像路径就跳过」的豁免 ⇒ 它的 react 值写成非路径时**静默漏报**
      ⇒ 改成按**来源**判（组件集 / 屏幕清单）⇒ 端到端用例 + 变异项 M37
      （行为中性：真实快照的输出与修复前逐字节一致）
- [x] **L14** 自检 **68/68 绿** · 变异验证 **37/37 全被抓住** · 真实快照 `--gate` exit 0

---

## Phase M — 写通道：把契约段写回设计稿（已交付 —— **不需要席位升级**）

> 2026-10-29：I1 原本卡在「Figma 写工具被 Starter 套餐付费墙拦」。
> 查官方文档 + 实测后发现**存在一条免费的路**：**本地开发插件**。
> 官方口径「Creating a development plugin is supported on any plan」——
> 插件的写入权限 = **用户自己对该文件的编辑权**，不看席位、不看套餐墙、不吃 MCP 配额。
> ⇒ 不必等席位升级，也不必把文件搬进教育团队。

- [x] **M1** `scripts/lib/figma-contract-payload.mjs` —— 契约草案推导（**纯函数**）
  - `deriveStates()` —— 只认 `state=` 前缀（`platform=`/`quality=`/`tone=` 是别的维度）
  - `deriveProps()` —— 映射签名 → 契约 `{ name: type }`（`type` 带 `?` ⇒ `name?: type`）
  - `deriveA11y()` —— 按组件名的**族惯例**（可审计；keyboard 一律留空）
  - `buildCarrierText()` —— **必须用 `---` 包裹**（不裹下次采集提不出契约段）
  - `carrierOf()` —— COMPONENT(SET) → `description`；FRAME → `text-child`
  - `buildContractPayload()` —— 三条红线：**不编造** / 格式对 / 推导不越界
- [x] **M2** `scripts/figma-contract-payload.mjs` —— 生成器 CLI
  - `npm run figma:payload` → payload.json + 插件产物 code.js + **人可读审阅报告**
  - `npm run figma:payload:check` → **产物与快照是否同步**（漂移 ⇒ exit 1）
  - ⚠️ 产物必须**确定性**：时间戳取自快照的 `capturedAt`，不用「现在」
    （用「现在」的话 `--check` 永远红 ⇒ 等于没有门禁 —— 实现期踩过）
- [x] **M3** `scripts/figma-write-plugin/` —— 写入插件
  - `manifest.json` —— `documentAccess: dynamic-page`、**禁网络**（`allowedDomains: ["none"]`）
  - `plugin.src.js` —— 逻辑 + `__PAYLOAD__` 占位（**payload 内联 ⇒ 零 IO / 零 UI / 零网络**）
  - `code.js` —— 生成物
  - 幂等两道闸：生成器只产出「还没契约段」的节点 + 插件运行时再查一次载体
  - 改 TEXT 前 `loadFontAsync`（且只能加载文档里已有的字体）
- [x] **M4** `scripts/figma-contract-payload.test.mjs` —— **33 个反向验证测试**
  - 三条红线各有对应用例（不编造 / 格式可提取 / 推导不越界）
  - ⚠️ 实现期被**变异验证**逼出过一个洞：原来只断言「必填字段在不在」，
    于是「把 states 清空」这条变异**逃逸** ⇒ 补了**内容级**断言
- [x] **M5** `scripts/figma-contract-payload.mutation.mjs` —— **12/12 变异全被抓住**
- [x] **M6** 接进 `test:ci`：`figma-contract-payload.test.mjs` + `figma-contract-payload.mjs --check`
- [x] **M7** 修正 I1 的描述：**升席位 ≠ 立刻能干完**，且真阻塞不是「写不进 Figma」
  - 当前基线：可写 **15**（全部指向 `views/TheaterView.tsx`）· 跳过 16（已有契约）· 跳过 **19**（无 react 归属）
  - ⇒ **那 19 个才是 I1 的真阻塞**：缺的不是「能写进 Figma」，是「在前端该对应哪个组件」
    ⇒ 该走 code-connect 补映射（I2/I4），不是补契约能解决的

## Phase N — 写通道的自查与修复（2026-10-29，插件交付前的代码审查）

> 插件本体**从未在真实 Figma 里跑过**（我这边没有桌面端）⇒ 本轮做的是
> **静态审查 + 离线可测部分**：把「会静默出错最贵」的地方抽成纯函数并做反向验证。

- [x] **N1** **P0：插件覆盖已有散文 description ⇒ 抹掉人工设计文档**
  - 实证：真实快照里 **21 个组件已有人工写的散文 description**
    （例：「Holographic cover area 480×500: orbit ring + 12 ticks…」）
  - 插件原来写 `node.description = text` ⇒ **跑一次就抹掉**（不可逆）
  - 修法：改用 `mergeContractSection()` —— **契约段放前面、散文原样保留在后面**
  - 契约段放前面的理由：采集段 `/---([\s\S]*?)---/` **取第一对 `---`**；
    契约段在前 ⇒ 提取到的就是契约段（散文里有 `---` 也不会提错）
- [x] **N2** **P1：三端口径不一致 ⇒ 静默漏写**
  - 插件用「文本含 `AI_CONTRACT:`」判幂等，采集段用 `/---([\s\S]*?)---/` 提取
    ⇒ 散文里顺口提一句 `AI_CONTRACT:` ⇒ 插件以为「已写过了」而跳过，
    采集段却提不出 ⇒ 设计稿上永远没有契约，而 **`figma:diff` 现场看不出异常**
  - 修法：抽出**唯一实现** `scripts/lib/figma-contract-section.js`，
    采集段（CommonJS，require 时拼源码）与插件（生成器 `toString()` 内联）**共用**
  - 判据：新增「三端口径一致」用例（把 SEG1 与 code.js 的内联实现抠出来，
    在沙箱里跑同一批输入比对行为）
- [x] **N3** `scripts/figma-contract-section.test.mjs` —— **22/22 绿**
  - 覆盖：提取口径（含「散文提及不算契约段」）/ 合并不丢散文（逐字比对）/
    幂等不叠加 / 真实快照 21 个节点回归 / 三端口径一致 /
    **结构性守卫**（fence 正则只许出现在共享实现区域内）/
    **采集段端到端模拟**（真跑一遍 SEG1，三条腿都断言）
- [x] **N4** `scripts/figma-contract-section.mutation.mjs` —— **12/12 全被抓住**
  - 变异覆盖：贪婪匹配 / 不校验类型 / 丢契约段 / 段放后面 / **覆盖散文** /
    幂等失效 / **判定改成关键词匹配** / 空段不短路 / 不 trim / 不裹 `---` /
    **采集段又手写一份 fence 正则** / **插件源码又手写一份 fence 正则**
- [x] **N5** Figma Plugin API 的三条硬事实（查官方文档核实）
  - `documentAccess: dynamic-page` 下**不会**自动装载全部页面
    ⇒ 跨页访问前必须 `await figma.loadAllPagesAsync()`（原来就有，保留）
  - 同步 `figma.getNodeById` **已废弃** ⇒ 改 `await figma.getNodeByIdAsync(id)`
  - **Figma 会为插件预载 Inter 字体** ⇒ `loadFontAsync(Inter)` 几乎必然成功；
    兜底改用 `listAvailableFontsAsync()`（**不用** `figma.root.findAll` ——
    它在 dynamic-page 下只遍历当前页，且大文件上很慢）
  - `figma.closePlugin()` 参数是**字符串** ⇒ 原来传对象会被忽略，
    调用方拿不到任何结果 ⇒ 改传摘要字符串，失败时点名是哪几个
- [x] **N6** SEG1 的转义坑（实现期踩的，记下来别再踩）
  - 模板的 `${...}` 插值是**字面替换**（插进来的不再被模板解析）
  - 预先把 `\` 翻倍 ⇒ 留下 `\\s`（正则匹配字面反斜杠）⇒ 提取永远失败
  - ⇒ 改成**在模板之外拼好最终字符串**（`SEG1_PART1 + SHARED + SEG1_PART2`）
- [x] **N7** 接进 `test:ci`：`figma-contract-section.test.mjs`（新增一条腿）
  - npm scripts：`figma:section:test` / `figma:section:mutation`
- [x] **N8** **采集段端到端模拟**（此前 SEG1 **从来没被跑过**）
  - SEG1 是「贴给 `use_figma` 执行的代码字符串」，不参与任何构建/测试
    ⇒ 它坏了（语法错、提取口径错）**没有任何门禁会发现**，
    直到你手工跑一次采集、发现快照是空的/错的
  - 实证：本轮先在模板字符串的注释里写了一个反引号 ⇒ 模板被截断
    ⇒ SEG1 整段语法错，**而当时所有既有测试都是绿的**（因为没人跑过它）
  - 修法：加「采集段端到端」用例 —— 最小 figma mock
    （页 / 组件集 / 孤立组件 / set 内变体 / 屏幕 / 非 `Screen/` 帧 / MOTION SPEC）
    - `AsyncFunction` 执行 SEG1 ⇒ 断言组件腿、屏幕腿、动效腿与 `counts` 一致性
  - 顺带补齐 mock 的两处不完整：缺 `parent`（set 内变体被误算成孤立组件）、
    缺 `characters`（隐藏 TEXT 子节点里的契约提不出来）
- [x] **N9** **结构性守卫**：fence 正则**只许出现一次**
  - 只测「行为一致」不够：有人新写一份**同样**的正则 ⇒ 行为暂时一致、测试绿，
    但已经变成**两份实现** ⇒ 迟早漂移
  - ⇒ 断言**结构**而不是行为：采集段 / 插件产物 / 插件源码里，
    fence 正则只允许出现在共享实现区域内（区域外计数必须为 0）
  - 配套两条变异（M11 采集段 / M12 插件源码）⇒ 改坏必被抓
- [x] **N10** 采集段的 motion 路径也统一到共享实现
  - MOTION SPEC 的 JSON 用的是同一套「`---`」包裹约定，
    但采集段里**唯一**手写的第二份正则就在这条路径上
  - ⇒ 约定一改（fence 换写法）motion 腿会**静默失效**
    （提不出 JSON ⇒ spec 空 ⇒ 门禁看不出任何异常）
- [x] **N11** 更正两处**文档漂移**（代码是对的、文档是错的）
  - 共享实现文件头把「②」写成了比对层 `scripts/lib/figma-snapshot.mjs`
    ⇒ 实情：比对层消费的是采集段**已提取好的契约原文**，只做 YAML 浅解析，
    **根本不做 fence 提取** ⇒ 没有口径可漂移。已更正
  - 文件从 `.cjs` 改名 `.js`（仓库惯例：`scripts/*.js` = CommonJS）后，
    4 个文档里 6 处引用没跟上 ⇒ 一并修正

---

## 变更日志

| 日期       | 变更                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-29 | 初版：Phase A–G 交付，30/30 绿，变异验证 8/8 被抓住                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-29 | 实现期抓到并修掉 3 个真缺陷（F1 双 `--` / F2 descriptions 全量误报 / F3 嵌套 key 泄漏），补变异项 M6–M8                                                                                                                                                                                                                                                                                                                         |
| 2026-10-29 | 快照要**提交进仓库** ⇒ `--gate` 变真门禁 ⇒ 加 C9 退化守卫 + C10 豁免机制；变异项扩到 12 条；M9 被变异验证抓出测试自身有洞                                                                                                                                                                                                                                                                                                       |
| 2026-10-29 | 首份真实快照落地（35/15/20）⇒ Phase H 完成；量出「35 个组件只有 10 个带契约」这条基线（spec §7.2）；Phase I 记录待拍板项；Phase J 记录并行 session 修的两个缺陷（采集段特性探测 / orphaned 误报）                                                                                                                                                                                                                               |
| 2026-10-29 | 独立评审（Claude Code 沙箱）查出 5 条判据漏洞 + 6 条存活变异 ⇒ Phase K 全部修掉；自检 38→57，变异 12→24（全被抓住）；基线：0 must / 10 unmapped + 39 keyframes 已豁免                                                                                                                                                                                                                                                           |
| 2026-10-29 | **第二轮**独立评审又查出 2 条存活 + 2 个新回退 + 1 个退化输入 ⇒ Phase L 全部修掉；自检 57→**68**，变异 24→**37**（全被抓住）；变异脚本加**等效变异检测**（区分"真洞"与"锚点写错"）；自查再补两条：code-connect 映射表为空 ⇒ 门禁假绿、「是不是屏幕」不能按名字判                                                                                                                                                                |
| 2026-10-29 | **Phase N** 写通道自查：修 **P0**（插件覆盖散文 description ⇒ 抹掉 21 个组件的人工设计文档）+ **P1**（三端口径不一致 ⇒ 静默漏写）⇒ 抽出唯一实现 `scripts/lib/figma-contract-section.js`，采集段与插件共用；新测试 18/18 绿、新变异 10/10 全被抓住；核实 Figma Plugin API 三条硬事实（dynamic-page 不自动装载全页 / `getNodeById` 已废弃 / Figma 预载 Inter 字体）                                                               |
| 2026-10-29 | **Phase N2** 单一实现收口：采集段 motion 路径也统一到共享实现（最后一份手写 fence 正则）；加**结构性守卫**（fence 正则只许出现在共享实现区域内）+ 两条对应变异；加**采集段端到端模拟**（SEG1 此前从未被跑过 —— 实测真跑时立刻抓到模板字符串里的反引号把模板截断，而当时所有既有测试都是绿的）；更正两处文档漂移（比对层其实不参与 fence 提取 / `.cjs`→`.js` 改名后 6 处引用没跟上）；测试 18→**22**、变异 10→**12**（全被抓住） |
