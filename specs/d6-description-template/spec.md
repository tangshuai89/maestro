# D6 — Figma description 模板审计

> 范围：Figma 节点（组件、变体、Screen frame）的 description 字段必须含标准化的 AI CONTRACT 段，
> 让 coding agent（Figma Dev Mode MCP / REST 读）拿到节点就能解析 props / a11y / states / motion / tokens，
> 直接生成 React 代码。
> 关联：`docs/figma-driven-frontend.md` §3.3 组件化纪律 + §9 + `figma-code-connect.json`。

## 0. 现状

- **D1 6 屏 description** 已经在 SEG1-6 段脚本里写好了（含 `AI_CONTRACT:` 段）—— 2026-09-10 已建
- **v4-ABC 14 个组件 description** —— 大部分可能**没有** description（v4 阶段只建组件未补 description）
- **D5_NEW 10 个组件** —— Figma 端还没建，description 谈不上
- **D1 6 屏里嵌套的自由组装节点**（panel/header/footer 等）—— 非组件不需要 description

## 1. AI CONTRACT 模板（标准）

每个 Figma 节点（COMPONENT / COMPONENT_SET / 顶层 FRAME）description 必含 5 段（顺序不限）：

```
---
AI_CONTRACT:
  react: <path-to-React-component>      # 必填
  props: { ... }                        # 必填（可空 {}）
  a11y: { role, keyboard, aria-* }     # 必填
  states: [default, hover, ...]         # 必填（≥1）
  motion: { enter, exit, interaction }  # 必填（可空 {} 但需存在）
  tokens: [Color/semantic/accent, ...]  # 必填（≥1）
  bindings: [<Figma component names>]   # 必填（≥1，引用 02 页其他组件名）
---
```

> 简化版（4 段也可）：react / props / a11y / states 任一缺失 → FAIL。

## 2. 范围

| 工作 | 文件 | 类型 |
|---|---|---|
| AI CONTRACT 模板标准 | `specs/d6-description-template/template.md` | 新 |
| D6 spec + tasks | `specs/d6-description-template/{spec,tasks}.md` | 新 |
| Audit 校验脚本（REST 模式 + fixture 模式） | `scripts/figma-aether-v4-audit-d6.mjs` | 新 |
| v4-command.md 加 description 强制段 | `scripts/figma-v4-command.md` | 改 |
| CI 集成 | `package.json` | 改 |
| D1 6 屏 description 已合规（验证） | — | — |

## 3. 不在 D6 范围

- **Figma 端补 description**（v4-ABC 14 个组件）—— 需 use_figma；D6 是仓库内工作
- **D5_NEW 10 个组件 description** —— Figma 端还没建
- **D1 6 屏的子节点（panel/header/footer）** —— 非组件，不需要 description

## 4. 验收（DoD）

- [ ] `node scripts/figma-aether-v4-audit-d6.mjs --fixture /tmp/d6` → 0 FAIL（fixture 模式跑通）
- [ ] `node scripts/figma-aether-v4-audit-d6.mjs`（需要 FIGMA_TOKEN）→ 0 FAIL
- [ ] `npm run test:ci` 末尾自动跑 audit-d6
- [ ] `npm run typecheck` + `npm run lint` 0 error
- [ ] audit-d6 校验项：每个 COMPONENT_SET / FRAME（顶层）/ COMPONENT 节点，description 含 `react:` + `props:` + `a11y:` + `states:` 四段（缺一 FAIL）

## 5. Audit 检查项（audit-d6.mjs 实现细节）

对 Figma 文件每个节点（按 type 过滤）：
1. **类型白名单**：`COMPONENT_SET` / `COMPONENT` / 顶层 `FRAME`（name 以 `Screen/` 开头或 `README` / `Archive` / `MOTION SPEC`）
2. **description 非空**（`m.description` 存在且 length > 50）
3. **AI CONTRACT 段存在**：用正则 `---[\s\S]*?AI_CONTRACT:[\s\S]*?---`
4. **必填 4 字段**：
   - `react:` 出现（不校验路径存在，由 figma-code-connect-validate 校验）
   - `props:` 出现（值可 `{}`）
   - `a11y:` 出现（值可 `{}`）
   - `states:` 出现（值可 `[]`，但需有键）
5. **输出报告**：PASS / FAIL / SKIP 三档
   - PASS：全字段齐
   - FAIL：缺字段 + 缺什么 + 节点 id
   - SKIP：未列入白名单的节点（如 raw text、group、嵌套 frame）

## 6. Fixture 模式（无需 FIGMA_TOKEN）

`audit-d6.mjs --fixture <dir>`：从 `<dir>.json` 读（与 audit-d1 一致结构），mock REST 响应。

fixture 生成：暂无（用户跑完 D1 后可以用真 token 跑）。审计可以**现在就用 v4-command.md 描述的 D1 6 屏 description 文本**做手写 fixture。
