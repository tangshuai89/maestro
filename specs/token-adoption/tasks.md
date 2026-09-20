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
- [x] **S3-3** 「完全等值」批（6 个 token，只动 `.scss`）：`#f5f0e8`→`--text-main`、
      `rgba(245,240,232,.4)`→`--text-dim`、`rgba(255,255,255,.06/.08/.12)`→
      `--glass-fill/glass-fill-strong/glass-stroke`、`#fff|#ffffff`→`--white`
      → **88 处 / 12 个文件**；总预算 499 → **411**
- [x] **S3-6** 每批后：`tokens:check` + `visual:test` 双绿；**这批基线一处没动** ✅
- [x] **S3-4** 新增 `--values` 视角（按色值聚合）：实测 **181 个不同值 / 499 处**，
      前 20 个值就占约一半 —— 债的形状是"同一个值在 7–9 个文件里各写一遍"
- [ ] **S3-5** **alpha 派生值批**：`rgba(255,255,255,.04/.05/.1/.2)`、
      `rgba(245,240,232,.3/.5/.7/.9)` 这些**没有对应 token** 的档位。
      候选做法：`color-mix(in oklab, var(--token) N%, transparent)`（不新增 Figma token）。
      ⚠️ 先拿**一处**验证 `color-mix` 与 `rgba()` 像素等价（基线不许动），再铺开
- [ ] **S3-7** **遗留色板归属决策**（`abstracts/_variables.scss` 的 24 处 + 用它的一众组件）：
      `$overlay-*` 磨砂深灰与平台徽章 `#31c27c/#ff7b7b/#b39dff` **不是 AETHER 那一套**
      （AETHER 的 `--platform-qq` 是黄色）。两条路：并入 AETHER 令牌，或给遗留壳层
      自己的令牌命名空间。**这是设计决策，不由脚本替你做** —— 本轮已把该文件排除在机械替换外
- [ ] **S3-8** **TSX/TS 里的语义色**（约 43 处：`#00E5FF` / `#3DFFA2` / `#FFD93D` /
      `#3D9BFF` / `#FF3B5C`）—— 要逐处判断语义（装饰用 primitive，还是状态用 semantic），
      不能机械替换
- [ ] **S3-9** `_tokens.scss` 手写层与生成层的遮蔽收敛（含 D4 留的 `--text-dim` 决策）

## S4 — 后续（不在本专题）

- [ ] **S4-1** spacing / radius / 字号 的硬编码扫描与替换（方法同 S1/S2，噪音大，单开）
