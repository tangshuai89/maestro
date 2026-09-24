---
title: "ADR-001 引入 shadcn/ui 作为 AETHER 组件库"
tags: [adr, decision, shadcn, tailwind, design-system, aether]
created: 2026-09-24
status: proposed
source: discussion
---

# ADR-001: 引入 shadcn/ui 作为 AETHER 组件库

- **状态**: Accepted（2026-09-24 — PR #92 合并后翻 accepted；specs/shadcn-migration/spec.md 与 docs/figma-driven-frontend.md §9 同步）
- **日期**: 2026-09-24
- **决策人**: 待定
- **关联**: `specs/shadcn-migration/spec.md`（待写）/ `specs/token-adoption/` / `specs/d4-token-drift/` / `docs/figma-driven-frontend.md`

## 背景 (Context)

maestro renderer 当前组件库**没有统一抽象**——45 个 `_*.scss` 文件 + 各自管自己的 `*.tsx`，零散复用靠 copy-paste 或局部 hook（`usePlayer` 等）。D 收尾（D1–D11）已经统一了设计令牌（`--accent` / `--status-error` / etc.）和组件 set（Figma Code Connect 已联），但**没有可复用的组件层**——每加一个 modal / button / tooltip 都要从 0 写。

下一阶段（milestone 路线）会进：
- 全局 toast / notification（异常反馈 / 推荐命中 / sync 状态）
- 更多 modal（dismiss-to-confirm / multi-step form / search-as-modal）
- 复杂 form（rotation、cell-grid、date-range）
- 桌面歌词浮窗（specs/7.2）需要的 overlay/tooltip/drag 体系
- 自然语言歌单（specs/7.4）的 chat UI / chip-input

按现状继续手写每个组件，**预算与质量都撑不住 1 年**。需要引入一个**设计系统底座**——选项见下。

## 决策 (Decision)

采用 **shadcn/ui**（Radix UI Primitives + Tailwind CSS + 复制源码到仓库的所有权模式）+ **Tailwind CSS**。

接入策略：
1. **Tailwind 装到 `packages/renderer`** 单一包（Electron 主进程 + Extension 不动）
2. **shadcn/ui 用 CLI 复制源码到 `packages/renderer/src/components/ui/`**（不引 runtime 依赖，组件所有权在仓库）
3. **AETHER 令牌桥接 shadcn tokens**：shadcn 用 `--background` / `--foreground` / `--primary` 等 HSL 命名，我们包一层 `tokens-bridge.scss` 把 shadcn CSS variable 映射到现有 AETHER 令牌（`--surface-deep` / `--text-main` / `--accent`）。**shadcn 用 HSL 三元组（如 `--accent: 195 100% 50%`），AETHER 用 hex**（如 `--accent: #00E5FF`），所以用 `hsl(var(--accent))` 包装
4. **SCSS 渐进迁移**：现有 45 个 `_*.scss` 不一次性改，shadcn 包做新组件优先，旧组件按模块逐个迁移（每周一批），保留 SCSS 仅放 shadcn 覆盖不到的细节样式
5. **平台品牌识别色豁免通道**：shadcn 不管品牌 logo / 第三方品牌色（如 DeepSeek 紫、Spotify 绿）——已有 budget exempt 通道保持
6. **AETHER 主题令牌不动命名**——这是后续 shadcn 改造的桥接基础

## 理由 (Rationale)

- **shadcn/ui 不是库，是 ownership 模式**：把组件源码复制到仓库，避免 vendor lock-in，组件完全可控（产品要求"加个 emoji button"随时改）
- **Radix Primitives 提供无障碍 + 键盘交互底座**（符合 AGENTS.md §0 "审计原则" + iOA 环境的隐私期望）
- **Tailwind 已是 React 生态事实标准**，shadcn 默认就搭——单独选 Tailwind 工作量也免了
- **HSL 三元组结构适合主题切换**（后续 dark / light 主题切换直接改 `hsl(var(--accent-h), 100%, 50%)` 三个通道）
- **D4 token 系统已经就位**（52 个 token + 6 个新加的 C4 token），shadcn 桥接只需 `tokens-bridge.scss` 一层映射

## 备选方案 (Alternatives)

| 方案 | 优点 | 缺点 | 为何不选 |
|---|---|---|---|
| **维持现状**（手写 SCSS + 各自 .tsx） | 0 引入成本 | 无组件库 → 重复造轮子；无 a11y 基座 → 键盘/读屏支持差 | 1 年撑不住 |
| **Material UI / Chakra / Ant Design** | 完整组件库 | 不所有权化 → 改一个 button 要 monkey-patch；视觉风格难与 AETHER 对齐 | 风格冲突；vendor lock-in |
| **Radix Primitives 直接用**（不接 shadcn） | a11y 基座 + 自由度高 | 每个组件自己写（Button、Dialog、Tooltip 都得从 0） | 工作量等同 shadcn 还更散 |
| **Mantine** | TS 友好、组件齐全 | 运行时依赖、定制成本 | 同 MUI 改造成本 |
| **Headless UI**（Tailwind 官方） | a11y + Tailwind 友好 | 组件种类少于 Radix（缺复杂组件如 Calendar / Combobox） | 复杂组件仍要自己写 |

## 后果 (Consequences)

### ✅ 正向
- 后续 component-heavy 工作（toast / modal / chat UI 等）效率 +200%
- A11y 底座到位（Radix 处理 keyboard / focus / screen reader）
- shadcn 主题切换结构（HSL 三元组）天然支持 dark/light 切换（虽然本期不做）
- Tailwind 与 SCSS 共存——新组件用 Tailwind className，旧 SCSS 按模块渐进迁移

### ⚠️ 风险
- 引入 Tailwind 增加 bundle 体积（PurgeCSS 后预计 +20KB，可接受）
- shadcn + AETHER 令牌双层抽象（`hsl(var(--accent))`），新人上手成本略高
- SCSS ↔ Tailwind className 混用期，组件代码风格可能短期分裂
- Figma Code Connect 配置需要同步加 shadcn 组件（specs/d5-code-connect 后续）

### 📌 待跟进
- [ ] 写 `specs/shadcn-migration/spec.md`（验收标准 + 范围 + 不在范围 + 文件改动清单）
- [ ] 实际加 `tokens-bridge.scss`（HSL 三元组映射 AETHER 令牌）
- [ ] shadcn CLI 初始化（只复制 Button + Dialog + Tooltip 三件套先验证）
- [ ] Figma Code Connect 加 shadcn 组件映射（specs/d5-code-connect B 阶段）
- [ ] 旧 SCSS 组件迁移计划（按 spec.md 排期）
- [ ] bundle size 验证（应 < +30KB gzip）

## 相关文档

- `specs/shadcn-migration/spec.md` — 待写（验收标准 + 范围）
- `specs/token-adoption/` — AETHER 令牌专题（C4 6 个新 token 在此落地）
- `specs/d4-token-drift/` — 双向漂移门禁（shadcn 接入不能引入新硬编码）
- `docs/figma-driven-frontend.md` — Figma 驱动前端流程
- `docs/visual-regression.md` — D11 baseline 兜回归
