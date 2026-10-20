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
- [x] **S3-8** TSX/TS 里的语义色 —— **2026-09-24 决议**：- platform brand 颜色（4 处 × 3 文件 = 12 处：`LikedLibraryModal/SearchPanel/SourceSelect` 里的 `#FFD93D/#FF3B5C/#3D9BFF/#3DFFA2`）→ 走 budget `exempt`（与 `providerLogos.tsx` 12 处同源，品牌识别不是设计令牌）。- 状态色（4 处 `AuthErrorPanel.tsx`）→ 已用新加的 `--status-error/--status-warning/--status-info` token（PR #92 batch 5）。- `TheaterView.tsx` 剩余 9 处：4 处是 platform brand（letter color）已含在上文豁免里；其余为 SVG `stopColor` / 装饰用 `--white` / alpha rgba，本轮不替换。
      关闭 S3-8。
- [x] **S3-8b** SCSS 机械尾巴 —— **2026-09-24 决议**：仓库无对应语义 token（这些色都用在 gradient stop / load icon 描边 / 装饰边框等无主语义位置），保留为字面量；"基线不许动"理解为不引入新差异。S3-8b 关闭。
- [x] **S3-8c** 无对应令牌的值 —— **2026-09-24 决议**：`rgba(0,0,0,*)` 是功能性 scrim/shadow（modal backdrop、box-shadow halo），`#94a3b8`（slate-400）专用于 `_liked-modal.scss` 的 VersionType 角标色（instrumental/karaoke）—— 都不通用化，保留字面量。S3-8c 关闭。
- [ ] **S3-9** `_tokens.scss` 手写层与生成层的遮蔽收敛（含 D4 留的 `--text-dim` 决策）—— ⚠️ **决策待 user 拍板**：当前 `_tokens.scss` `--text-dim: rgba(245, 240, 232, 0.55)`（WCAG AA 注释）被 `_tokens.generated.scss` 的 `--text-dim: rgba(245, 240, 232, 0.4)` 静默覆盖（D4 §1 P5 已识别）。两种走法：(a) 走 D4 导出链把 Figma 端改成 0.55；(b) 删手写层 `--text-dim` 接受 0.4。**本 PR 不动代码**，留作 follow-up。

- [x] **S3-10**（2026-10-20）**"故意不收"批 —— 语义双关色的收口**。S3-5c / S3-8 当时把
      几组色值判为"语义双关 / 无主语义"刻意留着，本批按上下文逐个定案：
      · **platform brand 徽标色**（`TheaterView.tsx` PLATFORM_META 4 处 + `_liked-modal.scss`
      `.lib-badge-*` 4 处）→ `var(--platform-qq/netease/deezer/spotify)`。
      ⚠️ 这 8 处**不是**豁免而是**真消费**：S3-8 原话"4 处是 platform brand（letter color）
      已含在上文豁免里"与代码实际不符 —— `TheaterView.tsx` 并不在 exempt 名单里，
      那 4 处是硬编码字面量。本批改为 token 引用后 `--platform-deezer` 才真正有消费者
      （此前 57 个 token 里它零消费）。
      · **背景深空色 `#02020a`**（13 处 / 7 文件）→ `var(--primitive-bg-bottom)`；
      **`#0a0518`**（2 处）→ `var(--primitive-bg-top)`。
      · **霓虹青 `#00e5ff`**（7 处）→ `var(--accent)`；**电光紫 `#5b2bff`**（1 处）→
      `var(--accent-purple)`；**酸紫 `#b57bff`**（3 处）→ `var(--ai)`。
      · **`#3b82f6`**（`_liked-modal.scss` 1 处）→ `var(--accent-blue)`（该 token 此前零消费）。
      · **`#ffffff`**（`TheaterView.tsx` SVG `stopColor` 1 处）→ `var(--white)`。
      · **`rgba(0,229,255,0.5)`**（`TheaterView.tsx` `.th-scan-arc` 的 `stroke` 1 处）→
      `stroke="var(--accent)"` + `strokeOpacity={0.5}` —— 纯色 + 元素级 alpha，与
      `rgba()` paint 数学等价。
      · **shadcn bridge 的玻璃层**（`tokens-bridge.scss` 2 处）→ 改引用
      `var(--glass-stroke)` / `var(--glass-fill-strong)`。**单向引用无循环**（bridge 在
      `_tokens.generated.scss` 之后加载，AETHER 令牌不引用 `--sh-*`），且顺手消掉了
      该文件头注释里"改 generated hex 后必须手动同步本文件 HSL"的维护债。
      · **`providerLogos.tsx` 12 处补豁免** —— S3-8 写明"与 providerLogos.tsx 12 处同源，
      品牌识别不是设计令牌"，但实际没进 exempt 名单（另外 3 个同源文件进了）。
      补上时理由单独写：它用的是**官方品牌色**（网易云 #e60026 / Spotify #1db954），
      与另外 3 个文件用的 AETHER provider 色**不是同值**，不能共用一句话。
      · **合计 38 处 / 9 文件**；总预算 **140 → 102**（`--write-budget` 生成，**只降不升**；
      `_source-select.scss` / `tokens-bridge.scss` / `_base.scss` 归零后移出预算表）；
      再把 `providerLogos.tsx` 12 处移入 exempt → **最终 102 → 90**。
      · **验证**：`tokens:check` 绿（57 token 一致）；`typecheck` 绿；`lint` 0 error；
      `token-integrity` 9/9 绿；vitest（TheaterView/SettingsModal/SearchPanel）85/85 绿；
      **`visual:test` 7/7 绿且一处基线未动** —— 证明 38 处全是同值/等价替换。
      · ⚠️ **嵌套 var 专项验证**（`--badge: var(--platform-qq)` 嵌进
      `color-mix(in srgb, var(--badge) 25%, transparent)`）：Chrome 实测
      嵌套与字面量 computed 值**逐位相同**（`color(srgb 1 0.85098 0.239216 / 0.25)`），
      alpha 0.25 正确解析 —— 正是 spec §2 警告过的雷区，已排除。
- [ ] **S3-11**（未做）Tailwind 默认色阶批（`_liked-modal.scss` 36 处 +
      `_settings-modal.scss` 9 处 + `_transport.scss` 7 处 + `_error-panel.scss` 5 处 +
      `_netease-modal.scss` 5 处 + `useReco.ts` 5 处）—— 这些是 **shadcn/Tailwind 色阶**
      （`#3b82f6/#60a5fa/#a855f7/#c084fc/#f97316/#fb923c/#94a3b8/#64748b/#cbd5e1/#fbbf24/#f59e0b`），
      **不属于 AETHER 设计令牌**，要迁到 shadcn theme 变量
      （`--sh-primary/--sh-destructive/--sh-muted-foreground/…`），
      属 `specs/shadcn-migration` Phase 2「批 1：迁移 `_liked-modal.scss` 的 45 处硬编码颜色
      到 shadcn theme」—— 两个专题在同一批文件上，**必须合并做**，别各开各的。
- [ ] **S3-12**（未做）provider 健康状态色 / AI 理由色 —— 设计稿里**没有**这套语义
      （`#ffb800/#ff6b00/#d63031/#c0392b/#6c5ce7/#4834d4/#0f8a3a/#1db954` 是 provider 健康态，
      `#FF3B3B/#FFD60A/#4CD964/#2D7FFF/#FF2D87` 是 `useReco.ts` 的 AI 推荐理由色标）。
      要么进 Figma 补变量（走 D4 导出链），要么落成 shadcn token。**需先拍板语义归属**。

## S4 — 后续（不在本专题）

- [ ] **S4-1** spacing / radius / 字号 的硬编码扫描与替换（方法同 S1/S2，噪音大，单开）
