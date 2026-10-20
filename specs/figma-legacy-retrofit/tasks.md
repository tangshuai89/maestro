# Figma 老稿改造（RETROFIT）— Tasks

> 关联：`specs/figma-legacy-retrofit/spec.md` · 方法论：`docs/figma-legacy-retrofit.md`

## Phase A — 仓库内工具链（已完成）

- [x] **A1** `scripts/lib/figma-retrofit.mjs` — 分析核心（纯函数）
  - [x] 结构签名 / 样式签名两段聚类
  - [x] 变体轴推导（tone / textTone / size / content）
  - [x] 令牌候选（颜色 / 文字样式 / 间距 / 圆角 / 效果）
  - [x] 文本路径差异 → 组件属性候选 + 实例级文本取值
  - [x] 机器名图层识别（`isGenericName`）
  - [x] 顶层 frame → 屏幕清单，不进组件候选
- [x] **A2** `scripts/figma-retrofit-analyze.mjs` — CLI（`--file` / `--fetch` / `--fixture` / `--json`）
- [x] **A3** `scripts/figma-retrofit-fixture.mjs` — 合成 legacy 稿（离线自测）
- [x] **A4** `scripts/figma-retrofit-plan-to-plugin.mjs` — 计划 → use_figma 段代码生成器
  - [x] SEG1 Foundations（建页 + 颜色变量 primitive→semantic）
  - [x] SEGn Components（就地提升 + 组件集 + TEXT 组件属性 + 实例替换）
  - [x] 幂等（组件集已存在则复用；已是实例的节点跳过）
  - [x] 按体积装箱（16KB/段）而非按个数
  - [x] `setSharedPluginData` 写机器可读契约
- [x] **A5** `scripts/figma-retrofit-typecheck.mjs` — 用 @figma/plugin-typings 校验生成段
- [x] **A6** npm scripts 接线
- [x] **A7** 端到端跑通：fixture → plan → plugin → typecheck 全绿
- [x] **A8** `npm run lint` + `npm run typecheck` 0 error

## Phase B — 真实文件执行（需要 Figma MCP OAuth + Full seat）

- [ ] **B1** 备份/复制目标文件（官方建议：先在副本上试）
- [ ] **B2** 跑分析器：`npm run retrofit:analyze -- --fetch <fileKey> --out .figma-retrofit`
- [ ] **B3** 人工审阅计划：补组件语义名 + 确认变体轴切法 + 确认语义色归类
- [ ] **B4** 生成段：`npm run retrofit:plan -- .figma-retrofit/retrofit-plan.json .figma-retrofit/plugin.js`
- [ ] **B5** 类型校验：`npm run retrofit:typecheck -- .figma-retrofit/plugin.js`
- [ ] **B6** 喂 use_figma 跑 SEG1（Foundations）→ 截图 + 查变量
- [ ] **B7** 逐段跑 SEGn（Components）→ 每段后截图
- [ ] **B8** 逐屏人工比对：内容差异处应显示各实例自己的文案
- [ ] **B9** 老稿页标为只读基准（沿用 `99 · Archive` 做法）

## Phase C — 自动化验收（未开始）

- [ ] **C1** `scripts/figma-retrofit-audit.mjs` — REST 结构审计（比对本仓 audit 脚本模式）
- [ ] **C2** 像素级回归：老帧渲染 vs 实例组装渲染，差异阈值门禁
- [ ] **C3** 契约回流：`setSharedPluginData` 契约 → `figma-code-connect.json` 候选

## Phase D — 语义补齐（需要人或 AI 判断，脚本做不了）

- [ ] **D1** 机器名图层 → 语义名（分析器已标 `nameConfidence: generic`）
- [ ] **D2** 变体轴命名（`tone=100b21` → `tone=accent`）
- [ ] **D3** 语义色归类（surface/text/border → accent/primary/muted/…）
- [ ] **D4** 组件契约补全（react 路径 / props / a11y / states）
