# D10 — Tasks

## Phase A — 仓库内（已完成）

- [x] **A1** `specs/d10-motion-spec/spec.md` — 范围 + JSON Schema + 验收
- [x] **A2** `specs/d10-motion-spec/tasks.md` — 任务跟踪
- [x] **A3** `specs/motion-spec.json` — 20 条完整动效规格（12 prototype + 3 轮播 + 5 ambient）
- [x] **A4** `specs/d10-motion-spec/fixture-description.md` — frame description 模板
- [x] **A5** 写 `scripts/figma-aether-v4-audit-d10.mjs`（REST + fixture 双模式）
- [x] **A6** 写 `scripts/figma-d10-fixture.js`（fixture 生成器）
- [x] **A7** `package.json` 加 `test:motion` + 接 `test:ci`

## Phase B — 用户跑（待 Figma 端写入）

- [x] **B1** 写入 04 · Motion · MOTION SPEC frame —— **载体从 frame description 改为隐藏 TEXT 子节点**
      `MOTION_SPEC`（node `508:2`）：FRAME 没有 `description` 属性，原方案物理上不可能成立。
      写入走生成器 `node scripts/figma-aether-v4-motion-spec-write.js` + use_figma，
      回读 `charsLen=6295 / djb2=6c55cc64` 与本地预期完全一致。
- [x] **B2** `FIGMA_TOKEN=xxx node scripts/figma-aether-v4-audit-d10.mjs` → **20/20 全绿**
      （含 `Figma ↔ 仓库 spec id 集合一致`）。该脚本只读 `/files/:key`，只需
      `file_content:read`，不需要 `file_variables`，所以普通 PAT 就能跑。
- [ ] **B3** 跑 `npm run test:ci` 跑通 —— 本沙箱断网导致 `music.controller.e2e` 的 QQ 搜索 500，
      `test.sh` 会在此中断；需要能出网的环境。D10 自身链路已由 B1+B2 覆盖。

## Phase C — 持续

- [x] **C1** 任何新增动效的 PR 必含 spec 条目（PR template 加 checkbox）
      （2026-10-28 落地）→ 新建 `.github/PULL_REQUEST_TEMPLATE.md`，含
      「**新增或修改了动效**？→ `specs/motion-spec.json` 加了对应条目」这一条，
      并指明 Figma 侧怎么同步、用哪条命令校验（`audit-d10.mjs`）。
      顺带把仓库**已经在守**的几条一起放进模板（typecheck / lint / 全量套件 /
      覆盖率 diff 门禁 / CHANGELOG / 新建组件 / 改 spec 要勾验收清单 / 改打包产物）
      —— 贡献者只在一处看清单，少一个去处就少一次「忘了」。
      ⚠️ **诚实说明**：checkbox 本身是**承诺**不是门禁 —— 模板不会让 CI 变红。
      真要强制，得加一道「动了动效 → `specs/motion-spec.json` 必须一起动」的
      CI 检查（**尚未做**，见 NEXT-ITERATION）。
- [x] **C2** 与 D4 同步：spec 改了 → tokens 自动 export → SCSS diff —— D4 交付的
      `tokens:check` 已接进 `test:ci`，覆盖这条
