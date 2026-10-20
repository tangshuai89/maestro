# Figma 老稿改造（RETROFIT）— 把扁平老设计稿变成 AI 可驱动的组件库

> 状态：**探索任务产出 + Phase A 已落地**（分析器 / 生成器 / 类型校验全绿，尚未在真实 Figma 文件上执行）
> 关联：`docs/figma-legacy-retrofit.md`（完整方法论）、`docs/figma-driven-frontend.md`（v4 方案）、
> `docs/d-series-status.md`（本仓 Figma 文件现状）、`scripts/figma-retrofit-*`

---

## 0. 为什么要做这件事

本仓的 Figma 文件（`FtbRZXvzlCp4Sq9e322cQQ`）**已经完成组件化**：24 个 component set / 28 变体、
Code Connect strict 110/110、52 个变量双向漂移门禁在跑（见 `docs/d-series-status.md` §1）。

但那条路是 **D 系列手写的**：14 段 `use_figma` 脚本 + 逐条 spec，每一份稿子都要从零写一遍
（`scripts/figma-aether-v4-{foundations,components,screens,motion}.js`）。

**缺的是通用化**：换一份老设计稿（客户稿 / 旧版本稿 / 别的项目稿）时，没有「读老稿 → 出组件候选 → 物化成组件」
的自动通路。

外部调研（2026-10-20）同时确认了两件事：

1. Figma **官方没有**「把扁平文件一键组件化」的功能（Make / Sites / Buzz / Motion 都不是这个定位）；
   `use_figma`（2026-03-24 上线）提供的是**写画布的能力**，组件化逻辑得自己写。
2. 「在 Figma 文件内对重复 frame 做自动聚类」**没有已发表的现成工具**（调研原文：这是一个真实的生态空白）。

所以本 spec 的目标不是「再手写一份稿」，而是**把手写流程里可自动化的那段抽出来**。

---

## 1. 范围

| 工作                                    | 文件                                        | 类型 |
| --------------------------------------- | ------------------------------------------- | ---- |
| 分析器（老稿 → 组件/令牌候选）          | `scripts/figma-retrofit-analyze.mjs`        | 新   |
| 分析核心（纯函数，便于离线回归）        | `scripts/lib/figma-retrofit.mjs`            | 新   |
| 合成 legacy fixture（离线自测用）       | `scripts/figma-retrofit-fixture.mjs`        | 新   |
| 生成器（计划 → use_figma 段代码）       | `scripts/figma-retrofit-plan-to-plugin.mjs` | 新   |
| 生成段类型校验（@figma/plugin-typings） | `scripts/figma-retrofit-typecheck.mjs`      | 新   |
| npm scripts 接线                        | `package.json`                              | 改   |
| 方法论文档                              | `docs/figma-legacy-retrofit.md`             | 新   |

## 2. 不在范围

- **不动本仓现有 Figma 文件** —— 它的组件化已经完成，本 spec 只提供「换稿时」的通用通路
- **不做像素级回归**（见 §5 Phase C）：需要真实 Figma 渲染对比，单独排期
- **不替代语义决策**：组件叫什么、变体轴怎么切、哪个色是「主色」——**必须人或 AI 判断**，脚本只给候选
- **不处理原型连线（interactions）**：插件 API 写不了，平台限制（见 `docs/prototype-wiring-checklist.md`）
- **不改 `docs/figma-driven-frontend.md` 的 v4 方案**：那是本仓的既成事实，本 spec 是并列的通用化路径

---

## 3. 平台硬约束（2026-10 官方文档核实，直接决定管线形状）

| 约束                                                                                                           | 对管线的影响                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| REST API **不能**创建页/组件/变体/样式（OpenAPI 里没有对应写路径）                                             | 所有结构写入必须走 Plugin API（`use_figma`）                       |
| REST 的**变量**读写是 Enterprise full member 专属                                                              | 非 Enterprise → 变量必须走 `figma.variables`（插件侧）             |
| `use_figma` 只在**远程 server**、需 Full seat、专业版及以上                                                    | 桌面 server 没有 `use_figma`                                       |
| 沙箱是**改过的** Plugin API：`figma.notify` 抛错、`figma.currentPage = x` 抛错                                 | 一律用 `await figma.setCurrentPageAsync(page)`                     |
| 沙箱**跨调用不保留状态**；单次输出 ≤20KB；**非原子**（可能部分执行）                                           | 每段自包含 + 幂等 + 按体积装箱                                     |
| `console.log` 不回传，`return` 才是唯一输出通道                                                                | 段末必须 `return` 摘要                                             |
| 改文本前必须 `loadFontAsync`（不能硬编码字体族，账号外的字体不可用）                                           | 从节点读 `getStyledTextSegments(['fontName'])`                     |
| FRAME **没有** `description` 属性                                                                              | 契约载体用隐藏 TEXT 子节点（沿用 D1/D10 做法）                     |
| `setPluginData` 的 plugin id 每次工具执行都变 → 读不回来                                                       | 契约元数据用 `setSharedPluginData`                                 |
| `combineAsVariants` 不自动排版、变体全叠在 (0,0)                                                               | 生成段要自己摆网格                                                 |
| `createComponentFromNode` 会改顶层 node id                                                                     | 仓库内引用的 node id 会失效（已知：maestro D7 实测 `314:x→516:x`） |
| **无官方「自动组件化」功能**；社区 skill（`apply-design-system` / `reconstruct-component-figma` 等）可抄工作法 | 组件化逻辑自己写                                                   |

---

## 4. 管线（本次落地的部分）

```
  老稿（Figma 文件 / REST dump）
        │
        ├─① 读 ──────────────────────────────► retrofit-plan.json
        │   scripts/figma-retrofit-analyze.mjs
        │   · 结构签名聚「类组件」（忽略颜色、忽略坐标）
        │   · 样式签名聚「变体」（颜色差异 → 变体轴候选）
        │   · 文本路径差异 → 组件属性候选
        │   · 硬编码色 / 文字样式 / 间距 / 圆角 / 效果 → 令牌候选
        │   · 机器名图层单独标记（需人工/AI 命名）
        │
        ├─② 写 ──────────────────────────────► figma-retrofit-plugin.js
        │   scripts/figma-retrofit-plan-to-plugin.mjs
        │   · SEG1 Foundations：建页 + 颜色变量（primitive → semantic 别名链）
        │   · SEGn Components：createComponentFromNode 就地提升 + combineAsVariants
        │                       + 内容差异位暴露成 TEXT 组件属性
        │   · 其余出现位置替换成实例（保留位置/尺寸 + 覆盖文本属性）
        │   · setSharedPluginData 写机器可读契约
        │
        └─③ 验 ──────────────────────────────► Phase C（未做，见 §5）
            · 类型校验：scripts/figma-retrofit-typecheck.mjs（@figma/plugin-typings）
            · 结构审计：REST 读回，比对组件集/变体数/绑定数（可复用 figma-aether-v4-audit.mjs 模式）
            · 视觉回归：老屏渲染 vs 改造后实例组装渲染（未做）
```

### 4.1 关键设计：两段签名

只用一个签名会错：

- 只用**完整样式签名** → 同一按钮的 4 个平台色被拆成 4 个互不相干的组件
- 只用**结构签名** → 丢失变体信息，推不出 variant axis
- 把**相对坐标**算进签名 → 同一排并列的 4 个按钮因 x 不同被拆成 4 类

所以：**结构签名聚「类」，样式签名聚「变体」，坐标不进签名**（位置差异属于实例摆放，不是组件身份）。

### 4.2 关键设计：内容差异必须变成组件属性

老稿里 5 张曲目卡只有曲名/艺人不同。若直接把其中一个提升成组件、其余替换成实例，
**所有实例都会显示同一首歌**。因此分析器要算出「同一组内内容不同的文本位」，
生成器把它们暴露成 TEXT 组件属性，实例侧用 `setProperties` 覆盖 —— 这是「改装后视觉不变」的前提。

---

## 5. 验收（DoD）

### Phase A — 仓库内（已完成）

- [x] `node scripts/figma-retrofit-fixture.mjs` 生成合成 legacy 稿（3 屏 / 12 按钮 / 12 徽章 / 8 卡片 / 9 歌词行）
- [x] `node scripts/figma-retrofit-analyze.mjs --file <fixture>` 跑通，产出 `retrofit-plan.json` + `retrofit-report.md`
- [x] 聚类结果正确：12 个按钮合为 1 组、12 个徽章合为 1 组并识别出 **4 色变体轴**、9 个歌词行识别出 **2 态变体轴**
- [x] 顶层 frame 被识别为**屏幕**而不是组件（不进组件候选）
- [x] 机器名图层（group/frame1…）单独标记为「需命名」
- [x] `node scripts/figma-retrofit-plan-to-plugin.mjs` 生成段代码，每段 < 20KB（按体积装箱，不是按个数）
- [x] `node scripts/figma-retrofit-typecheck.mjs` → 全部段通过 @figma/plugin-typings 类型检查
- [x] npm scripts 接线（`retrofit:analyze` / `retrofit:fixture` / `retrofit:plan` / `retrofit:typecheck`）
- [x] `npm run lint` / `npm run typecheck` 0 error

### Phase B — 真实文件执行（待做，需要 Figma MCP OAuth + Full seat）

- [ ] 在**副本**文件上跑（官方建议：先在副本/草稿上试，别动生产文件）
- [ ] SEG1 Foundations → 校验变量集合与别名链
- [ ] SEGn Components → 每段后 `get_screenshot` 确认组件集
- [ ] 改造后逐屏截图，与老稿截图做**人工比对**（内容不同处应为实例属性覆盖）
- [ ] 老稿页保留为只读基准（沿用 `99 · Archive` 的做法）

### Phase C — 自动化验收（未做）

- [ ] **像素级回归**：老帧渲染 vs 实例组装渲染（Figma REST `GET /v1/images`），差异阈值门禁
- [ ] 结构审计脚本：`scripts/figma-retrofit-audit.mjs`（比对本仓 `figma-aether-v4-audit.mjs` 的模式）
- [ ] 契约回流：把 `setSharedPluginData` 的契约导出成 `figma-code-connect.json` 的候选

---

## 6. 风险

| 风险                                                     | 缓解                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| **语义决策不可自动化**（组件名 / 变体轴 / 语义色）       | 计划里明确标 `nameConfidence: generic` 与 `TODO`；人工只补这部分    |
| **组件化后 node id 全变**，仓库内引用失效                | 改造只在副本上做；node id 以 `setSharedPluginData` 里的稳定标识为准 |
| **实例化会丢原型连线**（Plugin API 写不了 interactions） | 老稿连线本来就要人工重连（见 `docs/prototype-wiring-checklist.md`） |
| 变体矩阵爆炸（正交轴 3×3×4）                             | 生成器只取前 2 个变体轴；>30 组合必须先拆子组件                     |
| **非原子执行**（沙箱可能部分生效）                       | 每段幂等：已存在的组件集直接复用，已是实例的节点跳过                |
| 单次输出 20KB                                            | 生成器按 16KB 装箱，超限会显式告警                                  |

---

## 7. 与既有资产的关系

- 本 spec **不替代** D 系列手写脚本：v4 是「一份稿子做到极致」，本 spec 是「换稿时能自动起步」
- 本 spec 的分析器输出**可以**喂给既有 v4 脚本模式（`use_figma` 段 + smoke mock + typecheck）
- 本 repo 的令牌链路（`scripts/lib/aether-tokens.mjs` / `check-token-drift.mjs`）是**代码侧**的单一事实源；
  本 spec 处理的是**设计侧**的老稿输入，两侧通过 Figma 变量对齐，不新增第二套映射
