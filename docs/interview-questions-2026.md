# 前端/全栈前端面试题库

> 收集时间：2026-07-27
> 来源：掘金搜索 API（2026 Q1-Q2 最新文章）+ GitHub `yangshun/front-end-interview-handbook`（2026-05 更新）
> 范围：中小厂 + 高级岗，覆盖 JS 基础/浏览器原理、React/Vue、工程化/性能、手写/算法/场景题

## ⚠️ 数据来源说明

- **真实"近 30 天"社交媒体内容获取受限**：小红书/知乎都对未登录搜索做反爬（403/JS 渲染拦截），webfetch 拿不到有效笔记列表
- 本次抓取的最新文章：**2026-04-19**（面试官视角复盘）、**2026-03-03**（场景题 10 道）、**2025-12-05**（JS 高级篇）
- GitHub handbook 的 JS Quiz / Coding / System Design 是体系化补充，截至 2026-05-28
- **如果想要真"30 天内"内容**，建议手动翻小红书 `前端面试` / 知乎 `前端面试` 话题，把链接贴给我，我来逐篇抓详情

---

## 一、AI 工程能力（2026 新标配 ⭐）

> 出处：[2026-04 面试官视角复盘](https://juejin.cn/post/7629927278534246427) —— 中小厂高级岗必问，2024 年几乎不考

| 难度 | 题目 | 考察点 |
|---|---|---|
| ⭐⭐ | 你用哪些 AI 编程工具？日常 AI 工作流是什么？ | 工具使用 |
| ⭐⭐ | 如何保证 AI 生成代码的质量？ | 质量保障流程 |
| ⭐⭐⭐ | 团队如何统一 AI 工具配置（Rule/MCP）？ | 工程化落地 |
| ⭐⭐⭐ | 怎么量化 AI 提效的价值？ | 团队影响力 |
| ⭐⭐⭐ | AI 生成的代码谁来 Review？流程是什么？ | 流程设计 |
| ⭐⭐⭐⭐ | AI 能帮你做什么/不能帮你做什么？什么时候不用 AI？ | 边界认知 |
| ⭐⭐⭐⭐ | 高质量 Prompt 的五要素（目标/约束/上下文/输出/质量） | Prompt 能力 |

---

## 二、JS 基础 + 浏览器原理

### A. 高频 8 股题（中小厂 100% 会问）

> 出处：[2025-12 JS 高级篇](https://juejin.cn/post/7579813925996970025)、[GitHub handbook JS Quiz](https://frontendinterviewhandbook.com/javascript-questions)

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐ | 事件委托（event delegation）原理 | DOM 事件流、内存节省 |
| ⭐⭐⭐ | `this` 在不同调用方式下的指向 | new / call/apply/bind / 箭头函数 / 严格模式 |
| ⭐⭐⭐ | 原型链 / `__proto__` / `prototype` | 继承、`Object.create` vs `setPrototypeOf` |
| ⭐⭐⭐ | 闭包的概念、用途、内存影响 | 数据私有、柯里化 |
| ⭐⭐⭐ | `var/let/const` 区别 + 暂时性死区 | 提升、块级作用域 |
| ⭐⭐ | `==` vs `===` / `null` vs `undefined` vs undeclared | 隐式转换坑 |
| ⭐⭐⭐ | 事件循环（浏览器 + Node.js） | 6 阶段、nextTick 与微任务优先级 |
| ⭐⭐⭐ | Promise 链 + 错误处理 | `then/catch/finally`、穿透、并发控制 |

### B. V8 / GC / 高级机制（高级岗重点）

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐ | V8 引擎 Parsing → Ignition → TurboFan 流程 | JIT、Deoptimization |
| ⭐⭐⭐⭐ | V8 分代回收：新生代 Scavenger + 老生代标记-清除-整理 | 晋升机制 |
| ⭐⭐⭐⭐ | Node.js 事件循环 6 阶段（timers/poll/check...） | vs 浏览器区别 |
| ⭐⭐⭐⭐ | `process.nextTick` vs Promise.then 优先级 | nextTick 最高 |
| ⭐⭐⭐ | 内存泄漏 4 大场景（全局变量 / 定时器 / 分离 DOM / 闭包滥用） | DevTools 诊断 |
| ⭐⭐⭐⭐ | Heap Snapshot + Allocation Timeline 定位泄漏 | Memory Tab 实操 |

### C. ES6+ & TS（高级岗必会）

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐ | 解构 / 模板字符串 / 扩展运算符 vs rest | 语法糖 |
| ⭐⭐⭐ | 箭头函数的 `this` 与构造函数的区别 | 不能用 new |
| ⭐⭐⭐ | ES6 class vs ES5 构造函数 | 严格模式、`__proto__` |
| ⭐⭐⭐ | 模块化演进：IIFE → CommonJS → AMD → ESM | 静态/动态、循环依赖 |
| ⭐⭐⭐⭐ | TS 高级类型：泛型 / 条件类型 / 映射类型 / 工具类型 | Partial/Pick/Omit 源码 |

### D. Web 安全

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐ | XSS 三类 + 防御（textContent / CSP / 转义） | 实战 |
| ⭐⭐⭐ | CSRF + 防御（SameSite / Token / Referer） | 同源策略 |
| ⭐⭐ | 同源策略 / CORS / JSONP 局限 | 跨域方案对比 |

---

## 三、React / Vue 框架原理

### A. React 必考（中小厂 100%，高级岗深挖）

> 出处：[面试官视角复盘](https://juejin.cn/post/7629927278534246427)、[JS 高级篇 框架原理节](https://juejin.cn/post/7579813925996970025)

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐⭐⭐ | **React Fiber 是什么？两个阶段？** | 链表结构、render 可中断 / commit 不可中断 |
| ⭐⭐⭐⭐⭐ | **时间切片怎么实现？** | requestIdleCallback → MessageChannel |
| ⭐⭐⭐⭐⭐ | **lanes 优先级调度模型** | 不同更新类型对应不同 lane |
| ⭐⭐⭐⭐ | useState 实现原理（链表 + current 指针 + dispatch 闭包） | 源码级 |
| ⭐⭐⭐⭐ | 为什么 Hooks 不能写在条件语句里？ | 链表顺序对应 |
| ⭐⭐⭐ | useEffect 清理机制、useMemo vs useCallback | 易混淆点 |
| ⭐⭐⭐ | 什么时候**不要**用 useMemo？ | memo 本身开销 |
| ⭐⭐⭐⭐ | React.memo / useMemo / useCallback 怎么选？ | Profile 数据驱动 |
| ⭐⭐⭐ | VDOM + Diff 算法（Tree/Component/Element 三层） | key 的作用 |
| ⭐⭐⭐⭐ | 性能优化流程：Profile → 假设 → 实施 → 数据验证 | 答题框架 |

### B. Vue 必考

> 出处：[2024 VUE 篇 28w 阅读](https://juejin.cn/post/7343484473184698405)、[2025 Vue3 进阶篇](https://juejin.cn/post/7511568225987051555)

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐⭐ | Vue3 响应式原理（Proxy vs defineProperty） | 依赖收集 vs 触发 |
| ⭐⭐⭐⭐ | Composition API vs Options API 取舍 | 复用性、TS 友好 |
| ⭐⭐⭐⭐ | ref vs reactive 区别、设计考量 | 响应式丢失 |
| ⭐⭐⭐⭐ | 生命周期钩子在 Composition API 中怎么对应 | onMounted/onUnmounted |
| ⭐⭐⭐ | `provide/inject` 实现原理 | 用于设计 RadioGroup 类组件 |
| ⭐⭐⭐ | Vue3 Diff 优化（最长递增子序列 + 静态标记） | PatchFlag |
| ⭐⭐⭐⭐ | `v-model` 原理 / 自定义组件双向绑定 | modelValue / update:modelValue |
| ⭐⭐⭐ | Vue Router 4 导航守卫分类 | 全局 / 路由 / 组件 |

---

## 四、工程化 + 性能优化

### A. 构建工具

> 出处：[JS 高级篇 工程化节](https://juejin.cn/post/7579813925996970025)、[2024 工程化篇](https://juejin.cn/post/7350535815132659749)

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐ | Webpack 核心概念（Entry/Output/Loaders/Plugins/Mode） | 流程 |
| ⭐⭐⭐⭐ | Webpack 优化：SplitChunks / Tree Shaking / 持久化缓存 | 生产配置 |
| ⭐⭐⭐ | Vite 为什么比 Webpack 快（dev 用原生 ESM + esbuild） | 原理 |
| ⭐⭐⭐⭐ | Vite 生产环境为什么用 Rollup？ | 兼容性 vs 性能 |
| ⭐⭐⭐ | Monorepo 工具对比（Lerna / Nx / Turborepo） | 选型 |
| ⭐⭐⭐ | Module Federation（微前端）原理 | 远程加载 + 共享依赖 |

### B. 性能优化（高级岗拉开差距）

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐⭐ | 关键渲染路径优化（关键 CSS 内联 / async defer / 预加载） | 加载性能 |
| ⭐⭐⭐⭐ | 大列表 10w 条数据怎么渲染？ | 虚拟列表（react-window / virtual scroll） |
| ⭐⭐⭐⭐ | Web Vitals 指标（FCP/LCP/INP/CLS） | 用户感知性能 |
| ⭐⭐⭐⭐ | 图片优化（WebP/AVIF / srcset / LQIP / 懒加载） | 资源体积 |
| ⭐⭐⭐⭐ | 瀑布流 + 弱网 + 低端机全场景优化 | 降级策略 |
| ⭐⭐⭐ | 重排重绘 / transform vs top:动画 | 合成层、GPU 加速 |
| ⭐⭐⭐⭐ | Code Splitting 三策略：路由/组件/Vendor | 缓存命中率 |
| ⭐⭐⭐ | 缓存策略（HTTP 强缓存/协商缓存 + Service Worker） | 多层缓存 |

### C. 监控 & 排查（高级岗加分项）

> 出处：[2026-03 场景题 第 8/9 题](https://juejin.cn/post/7612495518645174323)

| 难度 | 题目 | 重点 |
|---|---|---|
| ⭐⭐⭐⭐ | 如何排查"管理系统越用越慢"？ | Network / Performance / Memory 三板斧 |
| ⭐⭐⭐⭐ | 前端白屏如何排查？ | 控制台 + 资源 + 接口 + ErrorBoundary |
| ⭐⭐⭐⭐ | 前端监控采集 + 上报 + 分析全链路设计 | onerror + Beacon + ES/Kafka |
| ⭐⭐⭐⭐ | source map 反查生产报错 | 体积 + 安全权衡 |
| ⭐⭐⭐ | 内存泄漏定位（Heap Snapshot / Allocation Timeline） | 实战 |

---

## 五、手写题 + 算法 + 场景题

### A. 手写代码（中小厂必考，10-15 分钟/题）

> 出处：[GitHub handbook JS Coding](https://frontendinterviewhandbook.com/coding/javascript-utility-function)

**基础（高频）**

| 难度 | 题目 | 备注 |
|---|---|---|
| ⭐⭐ | `Array.prototype.map/reduce/filter/sort` 手写 | 最常考 |
| ⭐⭐⭐ | `debounce` / `throttle` | 必考之首 |
| ⭐⭐⭐⭐ | `Promise` / `Promise.all` / `Promise.race` | 并发控制 |
| ⭐⭐⭐ | `deepClone`（处理循环引用 + Map/Set/Symbol） | 面试加分项 |
| ⭐⭐⭐ | `groupBy` / `chunk` / `flatten` | Lodash 类 |
| ⭐⭐ | `Object.create` / `Object.assign` / 手写 bind | 基础 |

**进阶（高级岗 25-30 分钟）**

| 难度 | 题目 | 备注 |
|---|---|---|
| ⭐⭐⭐⭐ | 实现 `JSON.stringify` | 含 toJSON、循环引用 |
| ⭐⭐⭐⭐ | 简易 `useState` / `useEffect` | 链表 + dispatch |
| ⭐⭐⭐⭐ | 简易 EventEmitter（发布订阅） | on/emit/off/once |
| ⭐⭐⭐⭐ | `getElementsByClassName`（遍历 DOM 树） | DOM 编程 |
| ⭐⭐⭐⭐⭐ | 简易模板引擎（变量替换 + 简单条件） | 字符串解析 |
| ⭐⭐⭐⭐⭐ | 从 HTML 生成目录大纲（Google Docs 风格） | 树形结构 + DFS |

### B. 算法（LeetCode Top 100 高频足矣，15 分钟/题）

> 出处：[面试官视角复盘](https://juejin.cn/post/7629927278534246427)

| 难度 | 题型 | 高频题举例 |
|---|---|---|
| ⭐⭐ | 数组/字符串 | 两数之和、最长公共前缀、字符串反转 |
| ⭐⭐ | 哈希表 | 字母异位词分组、LRU 缓存 |
| ⭐⭐⭐ | 双指针/滑动窗口 | 无重复字符的最长子串、三数之和 |
| ⭐⭐⭐ | 链表 | 反转链表、合并有序链表、环形链表 |
| ⭐⭐⭐ | 二叉树 | 层序遍历、最大深度、路径总和 |
| ⭐⭐⭐⭐ | DFS/BFS | 岛屿数量、单词搜索 |
| ⭐⭐⭐⭐ | 基础动态规划 | 爬楼梯、零钱兑换、最大子序和 |

### C. 场景题（高级岗必问，看工程素养）

> 出处：[2026-03 场景题 10 道](https://juejin.cn/post/7612495518645174323) 完整原文已收录

| # | 题目 | 核心考察点 |
|---|---|---|
| 1 | 设计一个准确的前端倒计时 | setInterval 不可靠，要用时间戳差值 |
| 2 | 精准的支付秒杀倒计时 | 前后端时间同步、防篡改 |
| 3 | 管理系统越用越慢排查思路 | 定位三板斧 + 分层优化 |
| 4 | 后端接口返回几万条数据如何展示 | 虚拟列表 + Web Worker |
| 5 | H5 瀑布流低端安卓 + 弱网优化 | WebP + 懒加载 + 降级策略 |
| 6 | 设计 RadioGroup 组件（支持图片/文字/自定义） | 组合组件 + slot + 受控 |
| 7 | 如何排查白屏 | 控制台 → 资源 → 接口 → ErrorBoundary |
| 8 | 新项目启动流程 | 需求 → 选型 → 工程化 → 架构 |
| 9 | 前端监控全链路 | 采集 + sendBeacon + ES 分析 |
| 10 | 一百万并发抢商品谁是第一个 | 考察全栈视角，SETNX 原子操作 |

### D. 系统设计（高级岗压轴，60 分钟）

> 出处：[GitHub handbook System Design](https://frontendinterviewhandbook.com/front-end-system-design)

**答题框架**：RADIO（Requirements / Architecture / Data model / Interface / Optimization）

**UI 组件类（30 分钟）**
- Autocomplete / Image Carousel / Dropdown / Modal / Rich Text Editor / Data Table / Poll Widget

**应用类（60 分钟）**
- News Feed（Facebook 风）
- E-commerce Marketplace（Amazon 风）
- Chat Application（Messenger 风）
- Photo Sharing（Instagram 风）
- Collaborative Editor（Google Docs 风）—— **考察 CRDT/OT**
- Music Streaming（Spotify 风）—— **和我们 maestro 项目直接相关**
- Travel Booking（Airbnb 风）
- Video Conferencing（Zoom 风）

---

## 六、项目经验类（高级岗必问，送分题）

> 出处：[面试官视角复盘](https://juejin.cn/post/7629927278534246427) —— 决策链法则

### 三个必杀项目类型

| 类型 | 答题模板 |
|---|---|
| **性能优化项目** | 背景（10w 条表格）→ Profile 定位（DevTools Profiler）→ 方案对比（虚拟滚动/分片/骨架屏）→ 选型理由 → 实施细节（动态行高/滚动保持）→ 数据结果（3s→0.3s） |
| **架构设计项目** | 背景（jQuery 迁移 React）→ 三方案对比（渐进/微前端/重写）→ 选型理由（风险+团队规模）→ 实施细节（沙箱隔离）→ 成果（2 年零事故） |
| **失败/踩坑项目** | 过度设计案例（简单表单上 Redux）→ 反思（复杂度匹配业务）→ 选型原则（Context → Zustand → Redux） |

### 决策链法则答题模板
```
背景 → 问题 → 约束 → 方案对比 → 最终选择 → 结果 → 复盘
```

---

## 七、按难度分级的复习优先级

### ⭐ 优先级 P0（5 天搞定）
- [ ] Promise / Event Loop / 闭包 / 原型链（4 个题包打 80% JS 基础）
- [ ] React Fiber 两个阶段（不背源码，至少说出"链表 + 可中断 + MessageChannel"）
- [ ] debounce / throttle 手写 + 实际场景使用
- [ ] 性能优化三板斧（虚拟列表 / Web Vitals / 关键渲染路径）

### ⭐⭐ 优先级 P1（1-2 周）
- [ ] V8 / GC / Node.js 事件循环 6 阶段
- [ ] React Hooks 原理 + useState 手写
- [ ] 系统设计 RADIO 框架 + 2-3 个 UI 组件题
- [ ] 场景题 10 道过一遍思路
- [ ] AI 工程能力相关问题准备一套自己的答案

### ⭐⭐⭐ 优先级 P2（持续）
- [ ] System Design 应用类（Music Streaming 直接对标 maestro）
- [ ] 内存泄漏定位实战
- [ ] 微前端 / Monorepo 选型
- [ ] 项目三个必杀案例

---

## 八、可继续抓取的源

如果需要更近（5-7 月）的内容，建议手动从这些渠道拿到链接后给我：

- 小红书：搜索 `前端面试` `前端八股` `前端高级面试`
- 知乎：话题 `前端面试` `Web 前端开发`
- 脉脉：`前端面试` 话题
- B 站：搜 `前端面试经验 2026`
- Nowcoder / LeetCode 讨论区
- GitHub Trending：搜 `interview`