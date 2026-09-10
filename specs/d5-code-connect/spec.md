# D5 — Code Connect 补 5 映射 + 自动化校验

> 范围：v4 评估 §3.2 提到"Code Connect 覆盖仅 50%"，D1 跑完后 6 屏在 Figma 03 · Screens
> 已建，但 `figma-code-connect.json` 里 6 个映射是 `D1-PLACEHOLDER-N` 占位（等用户跑
> 完 D1 拿到 createdNodeIds 后替换）。D5 同时把 modal/full 屏的 React 组件
> Props schema 补全 + 加 **自动化校验脚本**（CI 接入 test:ci），未来 PR 改 Props
> 漏更新 mapping 会自动失败。
> 关联：`docs/figma-driven-frontend.md` §9 + `figma-code-connect.json`。

## 0. 现状

- `figma-code-connect.json` 当前 21 个映射（15 v4-ABC + 6 D1 占位）
- D1 6 屏的 `figmaNodeId` 字段是 `D1-PLACEHOLDER-1~6`——等用户在 Claude Code 跑完 D1 后拿到
  `createdNodeIds`（SEG1=Search、SEG2=Liked、SEG3=Settings、SEG4=RecoKey、SEG5=AuthError、SEG6=EmptyState）
  替换为真实 node_id
- 6 个 D1 映射的 `props` 字段为占位，需基于 React 组件真实 Props 补全

## 1. 范围

| 工作 | 文件 | 类型 |
|---|---|---|
| D5 spec + tasks | `specs/d5-code-connect/{spec,tasks}.md` | 新 |
| 自动化校验脚本（reactPath 存在 + props 完整 + 一致性） | `scripts/figma-code-connect-validate.mjs` | 新 |
| 5 个 D1 映射 props 补全（基于 React 组件 Props） | `figma-code-connect.json` | 改 |
| 5 个 modal/full 屏映射 `_d1Status` 字段标注「nodeId 待 D1 跑完替换」 | `figma-code-connect.json` | 改 |
| 加 `npm run test:code-connect` 脚本 | `package.json` | 改 |
| 接 `test:ci`（自动跑 validate） | `package.json` | 改 |
| v4-audit 的 SKIP 字段说明 | `scripts/figma-aether-v4-audit.mjs` | 改（注释） |

## 2. 不在 D5 范围

- **替换真实 node_id**——必须等用户跑完 D1 拿到 createdNodeIds；这是 **Phase B 用户操作**
- **新加 modal 组件集到 02 · Components**——Figma 端工作，需 use_figma；D5 是仓库内工作
- **Card/Glass 槽位组件映射**——v4 文档 §3.1 提过但 v4-ABC 没建（剧场稿无 Card/Glass 组件）
- **Pact/Spectral API 契约**——后续 D6/D7 阶段

## 3. 验收（DoD）

- [ ] `node scripts/figma-code-connect-validate.mjs` → 0 error（21+ 映射全过）
- [ ] `node scripts/figma-code-connect-validate.mjs --strict` → 21+ 映射每个 props 完整（无 `TBD` / `PENDING`）
- [ ] `npm run test:ci` 跑通（含 test:code-connect 步骤）
- [ ] `npm run typecheck` + `npm run lint` 0 error
- [ ] 6 个 D1 映射的 React Props 与源文件 1:1（不漏 prop）
- [ ] `git grep "D1-PLACEHOLDER" figma-code-connect.json` → 0 命中（**Phase B 完成后**）

## 4. Phase B（用户在 D1 跑完后）

- [ ] 用户把 D1 6 段的 createdNodeIds 替换 6 个 `D1-PLACEHOLDER-N` 字段
- [ ] 跑 validate 确认 node_id 全部为真实 id
- [ ] 截图 Code Connect 面板（在 Figma 选中 6 个 frame，Dev Mode 应显示 react 路径）

## 5. Schema 规范（validate 校验）

每个 mapping 必须满足：

```json
{
  "figmaComponent": "string (非空, 不含空格)",
  "figmaNodeId": "string (非空)",
  "reactComponent": "string (PascalCase)",
  "reactPath": "string (路径存在, .tsx 后缀)",
  "props": "object (空 {} 也合法; 但 type!=any, 必含至少 1 个 prop) 或 array (Props 数组)"
}
```

可选字段：
- `_d1Status`: string (D1 占位标记, 跑完后删)
- `_description`: string (备注)

Validate 检查项：
1. **路径存在**：`reactPath` 指向的 `.tsx` 文件实际存在
2. **组件导出**：文件内有 `export default function Xxx` 或 `export { Xxx }`
3. **Props 提取**：用 TypeScript compiler API 解析 interface Props，列出 prop 列表；校验 mapping.props 至少覆盖 80% 关键 prop（必填 prop 100% 覆盖）
4. **node_id 真实**：除非标记 `_d1Status`，否则 `figmaNodeId` 不能是 `D1-PLACEHOLDER-N` 形式
5. **name 规范**：`figmaComponent` 不能含空格，必须以 `X/Y` 或纯 name 形式
