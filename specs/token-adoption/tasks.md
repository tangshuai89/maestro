# 设计令牌落地 — Tasks

## S1 — 出清单

- [x] **S1-1** `scripts/scan-hardcoded-colors.mjs`：扫 `packages/renderer/src/**/*.{scss,tsx,ts}`
      的 `#hex` / `rgb()` / `rgba()` / `hsl()` / `hsla()`
- [x] **S1-2** 排除令牌层本身（`base/_tokens.scss`、`base/_themes.scss`、`*.generated.scss`）
      与纯注释行（注释里写设计稿色值不算违规）
- [x] **S1-3** 输出：按文件分组 + 合计 + TOP 文件；`--verbose` 逐条 `文件:行号 字面量 原文`
- [x] **S1-4** `--gate` 模式：对照 `scripts/token-adoption-budget.json` 的每文件预算，
      超出即非零退出并指名"超了几个"；低于预算则提示"可以下调"
- [x] **S1-5** `--json` 模式供 CI/后续脚本消费
- [x] **S1-6** `scripts/token-adoption-budget.json`：**初值 507 处 / 23 个文件**（实测，不许虚高）
- [x] **S1-7** 豁免机制（含原因）：`lib/coverColor.ts` / `placeholderCover.ts` / `lyricsShare.ts`
      / `debug.ts` 共 14 处 —— 算法生成颜色（封面取色、canvas 分享图、console 样式），
      tokenize 反而错
- [x] **S1-8** `--write-budget` 从实测生成预算（避免手抄数字出错）

## S2 — 门禁

- [x] **S2-1** 接进 `npm run test:ci`（与 `check-token-drift.mjs` 同一层）；
      另加 `npm run tokens:hardcoded` / `tokens:hardcoded:gate`
- [x] **S2-2** **门禁自检**：在 `_modal.scss` 故意加 `--probe-hardcoded: #ff0000`
      → `--gate` 报红并指名「2 > 预算 1（超出 1）」；删掉 → exit 0 回绿；文件已还原
- [x] **S2-3** `--write-budget` + spec 里写清"改完一处就下调预算"的棘轮纪律

## S3 — 分批替换（每批一个 commit）

- [x] **S3-1** `_theater.scss` 局部调色板 → 令牌：`--neon/--violet/--acid/--green/--glass-bg`
      改为 `var(--accent/accent-purple/ai/status-sync/glass-fill)`；另把 `.th-root` 的
      `background: #02020a` / `color: #f5f0e8` 换成 `var(--primitive-bg-bottom)` / `var(--text-main)`
      （**保留局部别名**，8/1/4/2/1 处用法一行不动）
- [x] **S3-2** `--glass-stroke` 同名自引用：**直接删掉局部声明**，3 处用法自然落到生成层的同值令牌
- [x] **S3-7** 验证：`_theater.scss` 125 → **117** 处；预算 507 → **499**；
      `tokens:check` 绿；**`visual:test` 6/6 绿且未更新基线** —— 证明是同值等价替换
- [ ] **S3-3** 错误色族余量（`#ff6b81` 等）
- [ ] **S3-4** 各 modal / panel 调色板（search / settings / reco-loading / auth-error / liked）
- [ ] **S3-5** `_tokens.scss` 手写层与生成层的遮蔽收敛（含 D4 留的 `--text-dim` 决策）
- [ ] **S3-6** 每批后：`tokens:check` + `visual:test` 双绿；有视觉 diff 先看图

## S4 — 后续（不在本专题）

- [ ] **S4-1** spacing / radius / 字号 的硬编码扫描与替换（方法同 S1/S2，噪音大，单开）
