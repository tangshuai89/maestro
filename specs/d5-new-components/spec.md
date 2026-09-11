# D5_NEW — 02 · Components 建 10 个 component set

> 范围：之前 D5 在 `figma-code-connect.json` 加了 10 个 TBD-FIGMA 占位映射（React
> 端 17/17 独立组件 100% 覆盖），但 Figma 端无对应 component set。本任务在 02 ·
> Components 页建这 10 个 component set（每个含变体 + description + 组件属性），
> 拿到真实 nodeId 后注入 code-connect.json，让 `test:code-connect:strict` 从
> 100/110 → **110/110**。
> 关联：`figma-code-connect.json` + `scripts/figma-code-connect-validate.mjs` + `scripts/figma-aether-v4-components-d5.js`（本任务新建） + `docs/figma-driven-frontend.md` §3。

## 1. 10 个 component set 规格

| # | figmaComponent | 变体属性 | 变体数 | React props（component property 暴露）|
|---|---|---|---|---|
| 1 | `Modal/Shell` | `state=[default]` | 1 | `panelClassName: string?` |
| 2 | `Modal/ErrorPanel` | `state=[collapsed, expanded]` | 2 | `message: text`（必须用 `text` 类型）|
| 3 | `Modal/RecoLoading` | `state=[loading, error]` | 2 | `librarySize: number`, `errorText: text?` |
| 4 | `SourceChip` | `platform=[qq, netease, deezer, spotify]` | 4 | `isBest: boolean`（instance override，**不**做变体）|
| 5 | `Screen/SourceSelect` | `state=[empty, ready]` | 2 | `provider: enum[qq,netease,deezer,spotify]?` |
| 6 | `Titlebar` | `state=[logged-out, logged-in, logging-in]` | 3 | `accountName: text?`, `likedCount: number?`, `qqQuality: enum[standard,high,lossless]?` |
| 7 | `Layout/QualityMenu` | `quality=[standard, high, lossless]` | 3 | `disabled: boolean`（instance override）|
| 8 | `Layout/SourceMenu` | `provider=[qq, netease, deezer, spotify]` | 4 | `disabled: boolean`（instance override）|
| 9 | `Layout/DeezerPresetSelect` | `state=[default, hover, open]` | 3 | `value: text?`, `editorialCount: number?` |
| 10 | `Modal/NeteaseCookie` | `state=[empty, qr-shown, cookie-paste, submitting]` | 4 | `errorText: text?` |

合计：**28 变体**（接近 v4 推荐上限"≤30 变体/页"）。

## 2. 单变体设计原则（v4-command.md §3.3）

- 每个组件 ≤1 个变体属性（`state` / `platform` / `provider` / `quality`），避免 3×3×4 爆组合
- 复杂数据（`message` / `librarySize` / `errorText`）用 **component property**（text / number / enum instance override），不做变体
- 布尔属性（`isBest` / `disabled`）**不**做变体（用 instance override）
- 跨变体图层名一致（Smart Animate 兼容 + audit-d6 一致性）

## 3. 范围

| 工作 | 文件 | 类型 |
|---|---|---|
| 规格 spec + tasks | `specs/d5-new-components/{spec,tasks}.md` | 新 |
| 每组件详细规格 | `specs/d5-new-components/component-specs.md` | 新 |
| use_figma 段（建 10 个 component set） | `scripts/figma-aether-v4-components-d5.js` | 新 |
| 执行手册 | `scripts/figma-v4-d5-new-command.md` | 新 |
| Mock 端到端 | `scripts/figma-v4-smoke-d5-new.mjs` | 新 |
| TBD-FIGMA → 真实 nodeId 注入器 | `scripts/figma-code-connect-inject.mjs` | 新 |
| `figma-code-connect.json` 占位 + 真实 id 双向更新工具 | 改 | 改 |

## 4. 不在范围

- **已存在 11 组件集 + 8 SVG icon 的改造**——D5 之前已映射
- **Modal/Shell 在 React 端是 `Modal`，但 6 屏用了内联 panel**——本任务不重构代码（参 D5 PENDING_REFACTOR 决策）
- **Screen/EmptyState 真实独立组件**——React 端嵌入 TheaterView，D5_NEW 跳过

## 5. 验收（DoD）

- [ ] `node scripts/figma-v4-smoke-d5-new.mjs` → 28 变体 / 10 component set 全部建出
- [ ] 真实跑完 use_figma 后：`figma-code-connect.json` 里 10 个 TBD-FIGMA 替换为真实 nodeId
- [ ] `node scripts/figma-code-connect-validate.mjs --strict` → **110/110 PASS**
- [ ] `node scripts/figma-aether-v4-audit.mjs` 跑通（v4 23/25 → 23/25+）
- [ ] `npm run test:ci` 末尾自动跑 audit 不破
- [ ] `npm run typecheck` + `npm run lint` 0 error

## 6. 风险

- **操作数限制**：use_figma 沙箱 50KB / 60 节点（v4-command.md §沙箱实测规则）。10 个组件 set + 28 变体平均每组件 6 节点 = 60 节点，**接近上限**。SEG 分 2 段：SEG1 (5 个简单组件) + SEG2 (5 个复杂组件)。
- **变体数膨胀**：28 变体可接受（v4-ABC 剧场稿本身有 50+ 变体；新增 28 在合理范围）。
- **Figma 端 layout 复杂**：每个 component 要做出 AETHER 美学（玻璃面板 / 青色光晕 / 状态色），**剧本 5 段**逐个组件画；不画完整视觉只标 description + bounds。

## 7. Phase B — 用户在 Claude Code 跑

1. 跑 `scripts/figma-v4-d5-new-command.md`（2 段 use_figma 调用）
2. 收集返回的 `createdNodeIds`（10 个 component set id）
3. 跑 `node scripts/figma-code-connect-inject.mjs --ids=ID1,ID2,...,ID10` 自动替换 TBD-FIGMA
4. 跑 `node scripts/figma-code-connect-validate.mjs --strict` 确认 110/110
5. 截图 02 · Components 顶部新加的 10 个 component set 入 PR 描述
