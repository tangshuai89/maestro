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
- [x] **S3-5** **alpha 派生值批** —— 配方是 `color-mix(in **srgb**, var(--token) N%, transparent)`
      （不新增 Figma token），**240 处 / 8 个文件**；总预算 411 → **171**
- [x] **S3-5a** **配方是量出来的，不是猜的**：浏览器 canvas 读回像素比对
      （`/tmp/check-color-mix.mjs`）——
      · `in oklab`：8/9 等价，**饱和色会漂**（`rgba(0,229,255,.3)` = `[0,229,255,77]`，
        oklab 版 `[0,232,255,76]`，G 差 3）；而青色 alpha 在仓库里有 33 处
      · `in srgb`：**9/9 全等**（含青色）→ 采用
      ⚠️ 注意这跟"混两个颜色取感知中点"是两回事 —— 那种场景 oklab 才对（`_base.scss` 的
      封面渐变仍在用 oklab，不要动）。**派生 alpha 一律用 srgb。**
- [x] **S3-5b** 验证：build 绿；`tokens:check` 绿；**`visual:test` 6/6 绿且一处基线未动** ——
      240 处同值/等价替换的硬证据
- [x] **S3-5c** 映射只收**色板级**颜色（白 / 米白 / 青 / 紫 / 酸紫）；
      语义双关的 `255,59,92`（红心=错误）与平台色 `61,255,162 / 255,217,61 / 61,155,255`
      **故意不收**，留给 S3-8 人工过（合计不到 10 处）
- [x] **S3-7** 遗留色板归属决策 —— **2026-09-24 决议**：legacy overlay palette 走方案 B —— 留在 `_variables.scss` 作为 SCSS 编译期常量（与 AETHER 运行时 `--sh-*` 令牌解耦；platform brand 颜色单独走 budget `exempt`，见 S3-8）。文件已挂 `exempt`（PR #92 batch 4），hex 计数不再纳入门禁。
- [x] **S3-8** TSX/TS 里的语义色 —— **2026-09-24 决议**：
      - platform brand 颜色（4 处 × 3 文件 = 12 处：`LikedLibraryModal/SearchPanel/SourceSelect` 里的 `#FFD93D/#FF3B5C/#3D9BFF/#3DFFA2`）→ 走 budget `exempt`（与 `providerLogos.tsx` 12 处同源，品牌识别不是设计令牌）。
      - 状态色（4 处 `AuthErrorPanel.tsx`）→ 已用新加的 `--status-error/--status-warning/--status-info` token（PR #92 batch 5）。
      - `TheaterView.tsx` 剩余 9 处：4 处是 platform brand（letter color）已含在上文豁免里；其余为 SVG `stopColor` / 装饰用 `--white` / alpha rgba，本轮不替换。
      关闭 S3-8。
- [x] **S3-8b** SCSS 机械尾巴 —— **2026-09-24 决议**：仓库无对应语义 token（这些色都用在 gradient stop / load icon 描边 / 装饰边框等无主语义位置），保留为字面量；"基线不许动"理解为不引入新差异。S3-8b 关闭。
- [x] **S3-8c** 无对应令牌的值 —— **2026-09-24 决议**：`rgba(0,0,0,*)` 是功能性 scrim/shadow（modal backdrop、box-shadow halo），`#94a3b8`（slate-400）专用于 `_liked-modal.scss` 的 VersionType 角标色（instrumental/karaoke）—— 都不通用化，保留字面量。S3-8c 关闭。
- [ ] **S3-9** `_tokens.scss` 手写层与生成层的遮蔽收敛（含 D4 留的 `--text-dim` 决策）—— ⚠️ **决策待 user 拍板**：当前 `_tokens.scss` `--text-dim: rgba(245, 240, 232, 0.55)`（WCAG AA 注释）被 `_tokens.generated.scss` 的 `--text-dim: rgba(245, 240, 232, 0.4)` 静默覆盖（D4 §1 P5 已识别）。两种走法：(a) 走 D4 导出链把 Figma 端改成 0.55；(b) 删手写层 `--text-dim` 接受 0.4。**本 PR 不动代码**，留作 follow-up。

## S4 — 后续（不在本专题）

- [ ] **S4-1** spacing / radius / 字号 的硬编码扫描与替换（方法同 S1/S2，噪音大，单开）
