# D1 — 03 · Screens 补 6 个 frame

> 范围：v4 pipeline 已建 3 屏（Playing/Paused/Buffering + SourceSelect）。**D1 补 6 个屏幕**，覆盖代码端
> 全部 modal/全屏分支（`.superdesign/init/routes.md`）。每屏用 02 页组件实例组装，禁裸画。
> 与 v4-ABC 剧场稿同一种美学（AETHER THEATER），不复用旧 Glass Cosmic 壳视觉。
> 关联：`docs/figma-driven-frontend.md` §5「覆盖范围」+ §9「实现状态」+ v4-command.md。

## 1. 6 个新 Screen frame

| # | frame 名 | 尺寸 | 类型 | 用现有组件 | 自由组装节点 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | `Screen/Search/Modal` | 1440×900 (弹层覆盖在 NowPlaying 上) | modal | Tag/Stat, Lyrics/Line×N, Icon/Search | 输入框 + 平台 chips + 结果列表 | P1 |
| 2 | `Screen/Liked/Modal` | 1440×900 (弹层) | modal | Tag/Stat, Icon/Heart, Badge/Platform | 列表行（封面缩略 + 曲名 + 平台 + 状态）| P2 |
| 3 | `Screen/Settings/Full` | 1440×900 (全屏) | full | Tag/Stat, Button/Text, Input/Text | 3 个 section 卡片 | P1 |
| 4 | `Screen/RecoKey/Modal` | 1440×900 (弹层覆盖) | modal | Tag/Stat, Button/Text, Input/Text | 模态壳 + 输入 + DeepSeek 链接 | P1 |
| 5 | `Screen/AuthError/Full` | 1440×900 (全屏) | full | Tag/Stat, Button/Text, Input/Text | 错误码 tag + 错误消息 + 操作按钮 | P2 |
| 6 | `Screen/EmptyState/Full` | 1440×900 (全屏) | full | Tag/Stat, Button/Text, Icon/Heart | 居中 illustration + 提示 + CTA | P2 |

总计：**4 P1 + 2 P2**——P1 屏幕在 D1 必交付，P2 屏幕如时间紧可放后续。

## 2. 复用约束（硬）

- **不引新组件**：6 screen 全部用 v4 已建 11 组件集 + 8 SVG icon + 现有 Scene/Backdrop
  - 原因：避免又一轮 `components SEG1-4` 跑（v4 audit 已 23/25，新增组件回归成本高）
  - 例外：必须新组件时，需在 D1 PR 单独说明并补 `audit.mjs` EXPECTED_SETS
- **不裸画**核心交互元素：所有按钮用 `Button/Text`/`Button/Icon` 实例，所有标识用 `Tag/Stat`/`Badge/Platform` 实例
- **可自由组装**的：辅助文字（提示文案）、分隔线、容器 frame、icon 缩略、illustrations
- **变量绑定**：所有颜色必须绑 `Color/semantic/*` 别名变量（走 PRIMITIVE 链），禁硬编码 hex
- **令牌**：间距走 `Spacing/*` 变量；圆角走 `Radius/*` 变量
- **AI CONTRACT**：每个 Screen frame 必须带契约（AI 消费用），模板见 §4。
  载体是 frame 下一个 `visible=false`、`fills=[]` 的 TEXT 子节点，名为 `AI_CONTRACT`
  ——**不是** `frame.description`：Plugin API 里 `description` 只在 `COMPONENT` /
  `COMPONENT_SET`（PublishableMixin）上，写 FRAME 会抛
  `no such property 'description' on FRAME node`。REST 侧走该 TEXT 节点的 `characters`。

## 3. 屏间关系（架构图）

```
03 · Screens
├─ Screen/NowPlaying/Playing         (v4 已有)
├─ Screen/NowPlaying/Paused          (v4 已有)
├─ Screen/NowPlaying/Buffering       (v4 已有)
├─ Screen/SourceSelect/              (v4 已有)
├─ Screen/Search/Modal               (D1 SEG1)
├─ Screen/Liked/Modal                (D1 SEG2)
├─ Screen/Settings/Full              (D1 SEG3)
├─ Screen/RecoKey/Modal              (D1 SEG4)
├─ Screen/AuthError/Full             (D1 SEG5)
└─ Screen/EmptyState/Full            (D1 SEG6)
```

modal 屏（Search/Liked/RecoKey）默认画在 1440×900 全屏 canvas，背景透明 + 蒙层由 `Scene/Backdrop` 提供
——与 NowPlaying 同款。full 屏（Settings/AuthError/EmptyState）自带 Scene/Backdrop 实例化背景。

## 4. AI CONTRACT 模板（每个 Screen frame 必填，存在 `AI_CONTRACT` TEXT 子节点里）

```
---
AI_CONTRACT:
  react: packages/renderer/src/components/<Modal>.tsx
  routes: <对应 routes.md 入口>
  props: { ... 列 prop 名 + type + default ... }
  a11y: { role, keyboard, aria-* }
  states: [default, ...]
  motion: { enter, exit, interaction }
  tokens: [Color/semantic/<x>, Spacing/<y>, Radius/<z>]
  bindings: <组件实例引用清单>
---
```

D1 6 屏的 description 草稿见 `design.md` §屏契约。

## 5. 验收（DoD）

- [ ] `scripts/figma-aether-v4-screens-d1.js` 6 段全部通过 `figma-v4-smoke-d1.mjs`（mock 跑）
- [ ] 真实跑完后 03 · Screens 含 ≥ 10 个 Screen/ frame（4 已有 + 6 新）
- [ ] `figma-aether-v4-audit-d1.mjs` 跑通 + 报告全部 PASS（mod 与原 v4-audit 增量）
- [ ] 每个新 Screen frame 下都有 `AI_CONTRACT` TEXT 子节点，内容含 `AI_CONTRACT:` / `react:` / `a11y:`
- [ ] 6 屏画在 y=1000 第二行（y=0 那行已被 v4-ABC 的 12 屏占满，x 0→17160），与已有屏无包围盒重叠
- [ ] 03 页自有填充变量绑定率 ≥ 70%（Modal 比 NowPlaying 简单，应该更高）
- [ ] 03 页实例内填充变量绑定率 ≥ 30%
- [ ] 没有新增组件（与 v4-audit EXPECTED_SETS 一致：11 组件集 + 1 Scene/Backdrop）
- [ ] 原型连线 12 条**不**在 D1 范围（仍走 Figma UI 手动）

## 6. 不在 D1 范围

- D2（视觉双世界收敛）——独立 PR，需先决策保留/废弃 Monster Beats
- D3（动效 12 条 prototype wirings）——Figma UI 手动，已在 v4 文档「完成后」节清单
- D5（Code Connect 补 5 映射）——独立 PR，与 D1 平行
- 1280/1920 尺寸帧（D9）——后续 P3
