# 老旧设计稿 → AI 可驱动设计稿：通用改装方法

> 面向的问题：手上有一份**扁平的老设计稿**（一堆 frame/text/rect、硬编码颜色、没有组件、没有变量），
> 目标是把它改成**纯 AI 驱动开发**能吃的组件库。
>
> 配套实现见 `scripts/figma-retrofit-*`；任务清单见 `specs/figma-legacy-retrofit/`。
> 本仓自己的 Figma 文件已经改造完成（见 `docs/d-series-status.md`），本文讲的是**换稿时**怎么重来一遍。

---

## 0. 先说结论

**官方没有「一键组件化」这个按钮。** 2025–2026 Figma 的 AI 能力（Make / Sites / Buzz / Motion / design agent）
全是「创作与表达」工具；`generate_figma_design` 捕获 UI 得到的还是**扁平图层**（官方原话：
"flat layers, without a connection to your libraries"）。真正能改变文件结构的只有一条路：

> **`use_figma`（2026-03-24 上线）= 让 agent 在你的文件里跑 Plugin API 代码。**
> 组件化逻辑得自己写（Figma 官方社区 skill `reconstruct-component-figma` / `apply-design-system` /
> `ds-init-figma` 就是这么干的）。

而「怎么从扁平稿里认出哪些东西该是组件」这件事，**外部调研没找到任何已发表的现成工具**——
连学术界的 UI 组件检测（UI-DETR / UICVD / VINS…）都是**像素域**方法，而 Figma 文件自带结构化节点树，
结构分析严格优于像素法。

所以**方法 = 一条三段管线 + 一个人机分工点**：

```
① 读：结构指纹聚类 → 组件候选 / 变体轴 / 令牌候选      ← 脚本做（本次已落地）
② 写：就地提升为组件 + 组件集 + 实例替换 + 变量绑定    ← 脚本做（本次已落地）
③ 验：结构审计 + 像素级回归                            ← 半自动（Phase C 未做）
                 ▲
                 └── 人/AI 不可委托的部分：语义命名、变体轴切法、语义色归类
```

---

## 1. 三段管线

### ① 读 —— 结构指纹聚类

**不要用像素相似度**：它会把「同一个组件的不同状态」误聚类。
要用**结构指纹**：(节点数, 每个节点的 type + 尺寸 + 样式, 文本内容集合)。

但纯结构指纹也不够 —— 本次落地时踩了两个坑：

| 坑                     | 现象                                           | 解法                                                   |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| **只用一个签名**       | 同一按钮的 4 个平台色被拆成 4 个互不相干的组件 | **两段签名**：结构签名聚「类」，样式签名聚「变体」     |
| **把相对坐标算进签名** | 同一排并列的 4 个按钮因 x 不同被拆成 4 类      | **坐标不进签名**（位置差异属于实例摆放，不是组件身份） |

于是：

```
结构签名 = 层级 + 布局 + 圆角 + 效果 + 文字样式          （不含颜色、不含坐标、不含图层名）
样式签名 = 结构签名 + 颜色（fill / stroke / text）

结构签名相同 → 同一类组件
样式签名不同 → 该组件的一个变体（差异维度 = 变体轴候选）
```

再叠一层**文本路径差异**：同一组内内容不同的文本位（例如 5 张卡片的曲名）→ 必须变成 **TEXT 组件属性**，
否则实例化后所有实例都显示同一首歌。这是「改装后视觉不变」的前提。

产出 `retrofit-plan.json`（机器可读）+ `retrofit-report.md`（人读），里面明确标注：

- 组件候选：出现次数、变体数、变体轴、文本属性
- 令牌候选：硬编码色（按使用次数 + 角色 text/surface/border）、文字样式、间距、圆角、效果
- **机器名图层**单独标记（`group` / `frame1` / `Frame1268`）—— 这部分**没法自动命名**，必须人或 AI 补
- 覆盖率：可组件化节点占比

### ② 写 —— 就地提升，不是重建

关键 API：**`figma.createComponentFromNode(node)`** —— 把既有 frame **就地**变成组件，保留所有子节点与样式。

这一步是整个方案能成立的原因：如果只能 `createComponent()` 从零画，
「老稿改装」就退化成「照着老稿重画一遍」，视觉必然漂移。

三种写法：

| 写法                                            | 用在哪                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| `createComponentFromNode` + `combineAsVariants` | 老稿里同结构的多个变体 → 组件集（就地提升后合并） |
| `createComponent` + `createInstance`            | 老稿里**找不到**的可复用单元 → 新建               |
| 保持原样不动                                    | 老稿里一次性元素（标题、插画）                    |

替换实例时三件事必须做对，否则视觉一定变：

1. **显式设 x / y / 宽高** —— 新实例不会继承旧节点的位置尺寸（非 auto-layout 父级尤其）
2. **覆盖文本属性** —— `inst.setProperties({ title: '夜空中最亮的星' })`
3. **保留下标** —— 在原父节点的同一下标插入，再删原节点；同父节点内**按下标倒序**处理，避免下标漂移

契约载体：**FRAME 没有 `description` 属性**（`'description' in frame === false`，写会抛错、REST 也不返回），
所以沿用本仓 D1/D10 的做法 —— **隐藏 TEXT 子节点**。
机器可读元数据用 **`setSharedPluginData`**（`setPluginData` 的 plugin id 每次工具执行都变，读不回来）。

### ③ 验 —— 两条腿

- **结构审计**：REST 读回，比对「组件集数 / 变体数 / 变量绑定率 / 实例覆盖率」。
  本仓 `scripts/figma-aether-v4-audit.mjs` 就是这个模式（含 `--fixture` 离线腿），可直接抄。
- **像素级回归**：老帧渲染 vs 改造后实例组装渲染，逐像素比对。
  这是「改装没改坏」的**唯一客观证据** —— 本次尚未实现（Phase C）。

---

## 2. 人机分工（不可委托的部分）

AI 可以把 `Frame1268` 变成 `CardContainer`，但**不能决定它是不是一张卡片**。

必须由人（或有上下文的人形 AI）拍板的四件事：

1. **组件名** —— 老稿的图层名就是给 AI 看的文档；机器名等于没有文档
2. **变体轴切法** —— 4 个平台色是 `tone` 一个轴 4 个值，还是 4 个独立组件？（**用变体，不要拆独立组件**）
3. **语义色归类** —— `#100b21` 是 `surface` 还是 `bg-elevated`？`#00e5ff` 是 `accent` 还是 `info`？
4. **组件契约** —— React 路径 / props / a11y / states

对应的官方口径（Figma 官方「Structure your Figma file for better code」）：
组件化 → Code Connect → 变量 → 清晰命名 → auto layout → 标注 → dev resources。

---

## 3. 平台硬约束速查（2026-10 官方文档核实）

| 约束                                     | 后果                                                |
| ---------------------------------------- | --------------------------------------------------- |
| REST **不能**写页/组件/变体/样式         | 结构写入只能走 Plugin API                           |
| REST 变量读写是 **Enterprise 专属**      | 非 Enterprise → 变量走插件侧 `figma.variables`      |
| `use_figma` 只在**远程 server**          | 桌面 server 没有 `use_figma`                        |
| 沙箱跨调用**不保留状态**、非原子         | 每段自包含 + 幂等；段间 id 写死字面量               |
| 单次输出 **≤20KB**                       | 按体积装箱分段（本次 16KB/段）                      |
| `console.log` 不回传                     | 段末 `return` 摘要                                  |
| 改文本前必须 `loadFontAsync`             | 从节点读字体，别硬编码；字体必须已上传到账号        |
| `combineAsVariants` **不自动排版**       | 变体会全叠在 (0,0)，要自己摆网格                    |
| `createComponentFromNode` **改 node id** | 仓库内引用会失效（maestro D7 实测 `314:x → 516:x`） |
| 插件 API **写不了 interactions**         | 原型连线只能人工重连                                |
| 组件要**手动 publish**                   | Code Connect 映射才能补全                           |

---

## 4. 现成可抄的社区资产

Figma 官方社区 skill 仓库（`figma/community-resources`）里，这几个直接对应本方法：

| Skill                                         | 用途                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| `reconstruct-component-figma`                 | 选中 frame → 重建为 Atomic Design 组件树（含保真优先级） |
| `apply-design-system`                         | 把既有设计接到已发布组件库（4 桶分类法）                 |
| `lint-design-figma`                           | 体检：硬编码色 / 缺 text style / **detached components** |
| `design-system-inventory-figma`               | 一次调用产出全文件 tokens + components + styles 清单     |
| `export-tokens-figma` / `import-tokens-figma` | 变量 ↔ DTCG / CSS / Tailwind / SCSS 往返                 |
| `cc-figma-component`                          | 从 JSON 契约生成全变量绑定的组件集                       |

`apply-design-system` 的工作法值得直接抄：**先备份 → 体检 → 按 section 分桶 → 一次只改一个 section →
逐段截图校验 → 交付四清单（Swapped / Composed / Already connected / Blocked）**。
它的「`blocked` 是合法终态」这句话尤其重要：不要为了让指标好看而假装接上了。

OpenAI 维护的 `figma-generate-library` skill 则是「从零建库」的最完整作业手册（五阶段、20–100+ 次调用、
状态账本落盘、`NEVER parallelize use_figma calls`）。

---

## 5. 中文替代路线（只读结论）

**MasterGo（即时设计）** 是能力上唯一对位的一档：Magic MCP（读 DSL / D2C）+ **Vibe MCP（AI 操作画布）**

- DSM 设计系统管理 + 设计 Token 导出 + D2C PRO 组件解析器 + **官方「从 Figma 迁移」通道**。
  但硬门槛是企业版席位（研发/编辑席位 + AI 积分）、双轨期漂移风险，
  且其「变体 + 变量写回」的粒度未逐项核实。仅在有合规/私有化/席位成本硬约束时才评估。

Pixso MCP（需下载客户端）、墨刀 MCP（方向相反：需求→HTML 原型）、Ant Design MCP（代码侧，与设计文件无关）
都不解决本问题。

---

## 6. 本仓的现状与本方法的关系

本仓 Figma 文件已经改造完成：24 组件集 / 28 变体、Code Connect strict 110/110、52 变量双向漂移门禁、
15 个 Screen frame、MOTION SPEC 机器可读化。

**还欠的**（与本方法无关，是平台/人力限制）：

- 6 条原型连线 —— 插件 API 写不了 interactions，必须人坐在 Figma 里连
- 44/52 生成层 token 从未被 `var(--x)` 消费 —— 代码侧课题，已开 `specs/token-adoption/`
- D6 的 description 补全与 audit-d6 的两个 bug

**本方法补的是**：下次拿到一份**没被人读过**的老稿时，不必再手写 14 段脚本 + 整套 spec，
先跑分析器拿到候选，人只补语义部分（命名 / 变体轴 / 语义色），再让生成器物化。
