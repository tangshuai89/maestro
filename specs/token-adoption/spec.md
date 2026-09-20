# 设计令牌落地（D4-C5 的独立专题）

> 一句话：**让 token 真正被用起来**。
> D4 解决的是"Figma 与 SCSS 不会悄悄漂移"，本专题解决的是它下游更尴尬的问题 ——
> **令牌导出了、门禁装上了，但代码里大部分人根本没用它**。
>
> 关联：`specs/d4-token-drift/spec.md` §5.1（缺口量化）· `specs/d8-compact-layout/`（三档 density）
> · `specs/d11-visual-regression/`（改动靠它兜底）

## 1. 现状（2026-09-20 实测）

| 事实 | 数字 |
|---|---|
| 生成层 token 总数 | 52 |
| **从未被任何 `var(--x)` 消费** | **44**（"Figma 是事实源"目前只对 8/52 成立） |
| 硬编码 AETHER 调色板（`#00e5ff` `#5b2bff` `#b57bff` `#3dffa2` 等） | `_theater.scss` 11 处 · `_search-panel.scss` 6 · `_settings-modal.scss` 4 · `_reco-loading.scss` 3 · `_auth-error-panel.scss` 2 · `_liked-modal.scss` 1 |
| 手写层令牌同样 0 消费 | `--radius-md` / `--space-16` 等，组件直接写 px |

成因不是"没人管"，而是**每个组件各自把设计语言抄了一遍**：剧场稿的调色板在
`.th-root` 里又声明了一份局部变量（`--neon: #00e5ff` …），别的组件直接写 hex。

## 2. 目标与做法

分三步，每步都可独立验收：

| 步 | 做什么 | 产出 |
|---|---|---|
| **S1 出清单** | 扫 renderer 源码里的硬编码颜色字面量（`#hex` / `rgb()` / `rgba()` / `hsl()`），排除令牌层文件本身 | `scripts/scan-hardcoded-colors.mjs` + 清单报告 |
| **S2 棘轮门禁** | 给每个文件一个"允许数量"预算，**只许降不许升** —— 防回退，且不需要一次性还清技术债 | `scripts/token-adoption-budget.json` + 接进 `test:ci` |
| **S3 分批替换** | 按风险从低到高换：先做**语义等价**的（同值替换），再做需要判断的 | 每批一个 commit，D11 基线兜底 |

### S3 的分批顺序（按"改动风险 × 价值"排）

1. **`_theater.scss` 的局部调色板** —— `--neon/--violet/--acid/--heart/--green/--glass-bg`
   全部映射到已有 token（`--accent` / `--accent-purple` / `--ai` / `--status-liked` /
   `--status-sync` / `--glass-fill`）。一处改动带活 6 个 token，且值完全等价。
   ⚠️ `--glass-stroke` 与 token **同名**，直接 `var()` 会自引用 → 该条单独处理（改绑或改名）。
2. **错误色族**（已在 D4-C3 做过 `#ff3b5c`）余下的 `#ff6b81` 等变体。
3. **各 modal / panel 的调色板**（`_search-panel` / `_settings-modal` / `_reco-loading` /
   `_auth-error-panel` / `_liked-modal`）。
4. **`_tokens.scss` 与生成层的遮蔽收敛**（D4 留的 `--text-dim` 决策 + 两行等值死代码）。

每一步都必须：`tokens:check` 绿 + `visual:test` 绿（或**先看 diff 图再 update 基线**）。

### 已确定的配方（2026-09-20 实测，别改回去）

| 场景 | 配方 | 为什么 |
|---|---|---|
| **派生 alpha**（`rgba(色, N)`） | `color-mix(in **srgb**, var(--token) N%, transparent)` | sRGB 里混透明 = 纯 alpha 缩放，**9/9 像素全等**（含饱和青色） |
| 混两个颜色取感知中点（如封面渐变） | `color-mix(in **oklab**, …)` | oklab 是感知均匀空间，这里才对 |

⚠️ **别把两者搞混**：实测 `color-mix(in oklab, #00e5ff 30%, transparent)` 会漂成
`[0,232,255,76]`，而原值 `rgba(0,229,255,.3)` 是 `[0,229,255,77]` —— G 差 3。
仓库里青色 alpha 有 33 处，用错配方就是**静默漂移**（视觉基线也只能在事后抓到）。

## 3. 不在范围

- **spacing / radius / 字号**的硬编码扫描与替换（同一套方法，但噪音大得多 ——
  px 到处都是、且很多是排版微调，不适合一刀切）。等 S1/S2 跑顺再单开。
- **动效参数**（duration / easing）的收敛。
- 第三方库内部颜色。
- 把 `_theater.scss` 拆文件 / 重构样式组织方式。

## 4. 验收

- [ ] `node scripts/scan-hardcoded-colors.mjs` 能出清单（按文件分组 + 总数 + 逐条字面量与行号）
- [ ] `--json` 输出机器可读结果；`--gate` 在超预算时**非零退出**并指名哪个文件超了多少
- [ ] `scripts/token-adoption-budget.json` 初值 = 当前实测值（不许虚高）
- [ ] 门禁接进 `npm run test:ci`（与 token-drift 离线腿同一层）
- [ ] **门禁自检**：故意加一个 hex → 必须红；删掉 → 回绿（D11 那次教的：没验过红灯不算装上）
- [ ] S3 第 1 批（剧场调色板）落地后，预算数字相应下调
- [ ] 每批替换后 `tokens:check` + `visual:test` 双绿

## 5. 风险

| 风险 | 处置 |
|---|---|
| 同值替换也会引起视觉漂移（如 alpha 计算方式从 `rgba()` 变 `color-mix()`） | 每批跑 D11 基线；有 diff 先看图再决定 update |
| 一处 token 改动影响多个屏幕 | 分批小步 + 基线兜底；不在同一批里混"换 token"与"改设计" |
| 预算数字被随意调高 | 门禁只报"超预算"，**调高预算必须出现在 diff 里**（review 可见），并在 PR 里写原因 |
| `--glass-stroke` 之类的同名自引用 | S1 的扫描器把 `var(--x)` 自引用也纳入检查（见 tasks S1-4） |
