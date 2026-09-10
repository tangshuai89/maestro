# AI CONTRACT description 模板（D6 标准）

> 用于 Figma 节点（COMPONENT / COMPONENT_SET / 顶层 FRAME）的 description 字段。
> AI agent（Figma Dev Mode MCP / REST API）读到节点时直接 parse 即可。

## 必填（4 段缺一不可）

```yaml
---
AI_CONTRACT:
  react: <path>        # React 组件源码路径（必填）
  props: {}            # 必填（可空对象）
  a11y: {}             # 必填（可空对象；至少 role）
  states: [default]    # 必填（≥1 个；用 default 占位也可）
---
```

## 完整版（5 段，强烈推荐）

```yaml
---
AI_CONTRACT:
  react: packages/renderer/src/components/<X>.tsx
  props:
    <name>: { type, figmaProp?, default?, map? }
  a11y:
    role: button | dialog | alert | status | ...
    keyboard: [Enter, Escape, ...]
    aria-label: <text or {condition}>
  states:
    - default
    - hover
    - active
    - disabled
  motion:
    enter: { duration: 240, easing: ease-out }
    exit: { duration: 200, easing: ease-out }
    interaction: { trigger, scale, glow, ... }
  tokens:
    - Color/semantic/<name>
    - Spacing/<n>
    - Radius/<n>
  bindings: [Component/<name>, ...]   # 引用的其他 Figma 组件
---
```

## 各组件类型最小集（推荐）

### 按钮（Button/Icon、Button/Text、Button/Like）

```yaml
---
AI_CONTRACT:
  react: packages/renderer/src/components/<...>.tsx
  props:
    tone: { type: enum[default|accent|danger|ghost], default: default }
    state: { type: enum[default|hover|active|disabled], default: default }
  a11y:
    role: button
    keyboard: [Enter, Space]
  states: [default, hover, active, disabled, focus]
  motion:
    press: { scale: 0.96, duration: 120, easing: cubic-bezier(.34,1.56,.64,1) }
  tokens: [Color/semantic/accent, Radius/<n>]
---
```

### Modal 壳（Modal/Shell — D5_NEW）

```yaml
---
AI_CONTRACT:
  react: packages/renderer/src/components/common/Modal.tsx
  props:
    onClose: { type: function }
    panelClassName: { type: string?, default: undefined }
    children: { type: ReactNode }
  a11y:
    role: dialog
    keyboard: [Escape]
  states: [open, closing]
  motion:
    enter: { overlay: fade 200ms, panel: fade-up 240ms }
    exit: { overlay: fade 200ms }
  tokens: [Color/semantic/glass-fill, Color/semantic/glass-stroke]
  bindings: [Scene/Backdrop]   # Modal 通常在 Backdrop 之上
---
```

### Screen 帧（D1 6 屏格式，已实施）

```yaml
---
AI_CONTRACT:
  react: packages/renderer/src/components/<X>.tsx
  routes: [search]
  props:
    onPlay: { type: function, args: "items, index" }
    onClose: { type: function }
  a11y:
    role: dialog
    keyboard: [Escape, ArrowDown, ArrowUp, Enter]
  states: [empty, loading, results, error, timeout]
  motion:
    enter: fade 240ms
    exit: fade 200ms
  tokens: [Color/semantic/text-main, Color/semantic/glass-fill]
  bindings: [Scene/Backdrop, Tag/Stat, Lyrics/Line, Icon/Search]
---
```

## 错误示例（audit-d6 会 FAIL）

```yaml
# 缺 a11y
---
AI_CONTRACT:
  react: components/Button.tsx
  props: {}
  states: [default]
---

# 缺 react
---
AI_CONTRACT:
  props: {}
  a11y: { role: button }
  states: [default]
---

# 没 AI_CONTRACT 段
这是组件描述但没用模板

# 用了但 4 段散落
AI_CONTRACT for this component:
  - react: ...
  - states: ...
```

## 与 figma-code-connect.json 的关系

- `figma-code-connect.json` 的 `props` 段是**组件层 schema**（Figma prop → React prop 映射）
- Figma 节点 description 里的 `props` 段是**实例层语义**（运行时怎么用）
- 两边都要写，但 audit-d6 只校验 Figma 节点 description

## CI 接入

`npm run test:description` 跑 `figma-aether-v4-audit-d6.mjs`（默认 fixture 模式）；
`npm run test:ci` 末尾自动跑一次。
真实 Figma 跑：`FIGMA_TOKEN=xxx npm run test:description` 或 `node scripts/figma-aether-v4-audit-d6.mjs --json`。
