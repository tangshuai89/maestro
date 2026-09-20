# D4 — Tasks

## Phase A — 仓库内（已交付）

- [x] **A1** `specs/d4-token-drift/spec.md` — 范围 + 验收 + 三级判定
- [x] **A2** `specs/d4-token-drift/tasks.md` — 任务跟踪
- [x] **A3** `scripts/lib/aether-tokens.mjs` — 共享映射（render / parse / 遮蔽）
- [x] **A4** `scripts/figma-export-tokens.mjs` 改用共享映射（修 P1/P2 的根因：两套映射）
- [x] **A5** `scripts/check-token-drift.mjs` 重写（离线腿 + 手写层遮蔽 + `--json`）
- [x] **A6** `scripts/figma-tokens-pull.mjs`（REST 实时拉取，scope 缺失退出码 3）
- [x] **A7** `scripts/token-drift-allowlist.json`（豁免需写 reason）
- [x] **A8** `.github/workflows/token-drift.yml`（schedule + 手动，无 secret 跳过）
- [x] **A9** `package.json` 加 `tokens:check` / `tokens:export` / `tokens:pull`，接进 `test:ci`
- [x] **A10** 刷新 `scripts/figma-tokens-dump.json`（51 → 52）+ 重生成 `_tokens.generated.scss`
- [x] **A11** `docs/figma-driven-frontend.md` §9 加 D4 状态
- [x] **A12** `scripts/figma-tokens-dump-seg.js` —— MCP 只读段（PAT 缺 scope 时的替代路径）
- [x] **A13** `scripts/figma-v4-smoke-tokens-seg.mjs` —— 该段的 mock 冒烟（断言与生成物逐字节一致）

## Phase B — 验证（已跑）

- [x] **B1** `node scripts/check-token-drift.mjs` → 0 exit，52 token 一致
- [x] **B2** 实时 Figma 渲染 vs 仓库生成物：52 个 token 值逐行核对一致
      （MCP 返回 `cssHash=a7081058` / 1847 字节，仓库生成物 `b4e9bd58`；差异仅来自
      Radius 块顺序 —— Figma 创建序 vs 快照规范序，工具已显式允许）
- [x] **B3** 故障注入：故意改 dump 一个颜色 → 必须 FAIL；改回 → PASS
- [x] **B4** `node scripts/figma-tokens-pull.mjs` 无 token → exit 3 + 指引
- [x] **B5** `npm run typecheck` + `npm run lint` + `npm test`
- [x] **B6** 凭据实测：两条 PAT 分别 401 / 403（缺 `file_variables:read`），见 spec §8
- [x] **B7** `node scripts/figma-v4-smoke-tokens-seg.mjs` → 7/7（渲染物 1847 字节与仓库逐字节一致）
- [x] **B8** C3 改后 `npm run build:renderer` 编译通过（`color-mix` 与嵌套 var 回退都吃得住）；
      `#ff3b5c` 在 renderer 只剩生成层 4 处定义；`npm run typecheck` + `npm run lint` 0 error

## Phase C — 待用户拍板的后续

- [ ] **C1** `--text-dim` 的修法抉择（Figma 改 0.55 / 保持 0.4 并删掉手写覆盖）
- [ ] **C2** 给 CI 配 `FIGMA_TOKEN`（需 Enterprise `file_variables:read`）→ live 腿才真正跑起来；
      没有该套餐则走 MCP 只读段 + 离线腿（spec §8 两条出路）
- [x] **C3** `--status-error` 落地：7 处 `#ff3b5c` + 6 处 `rgba(255,59,92,α)` 改 token
      （`_error-panel` 8 · `_liked-modal` 5 · `_theater` 2 · `_auth-error-panel` 2 ·
      `_search-panel` 1 · `_settings-modal` 1）
- [ ] **C4** 硬编码 hex 扫描（独立专题）
- [ ] **C5** 44/52 token 从未被消费的根因收敛（AETHER 调色板/尺寸仍散在各组件硬编码）——见 spec §5.1

## Phase B 执行记录（2026-09-20）

**实时快照来源**：Claude Code 侧用不了 `use_figma` 的旧结论已过期——本次 Codex 会话直接
通过 Figma MCP（`mcp__figma__use_figma`，OAuth）跑只读段拿到 52 个变量 + 渲染后的 SCSS，
`cssHash=a7081058`。这条路径比 REST 更省事（不需要 `file_variables` scope）。

**转录校验**：手工把 MCP 返回的 dump 落盘后重新导出，`git diff` 恰好 **+1 行**
（`--status-error: #ff3b5c;`）——说明另外 51 条的值一个字节没动（任何数字打错都会多出一行 diff）；
新加那条的 hex 与实时值吻合。

**自查抓到的自身 bug**：`check-token-drift.mjs` 的位置参数判断写成 `!flagAt`，
`flagAt` 为 -1 时 `!(-1) === false`，导致旧的调用方式 `node ... <dump.json>` 被静默忽略、
永远回落到默认快照。已改成显式比较并回归三种调用方式（位置参数 / `--dump` / 无参数）。

**旧比对脚本为什么会全红**：`check-token-drift.mjs` 自带一份 `toCssName()`，与
`figma-export-tokens.mjs` 的 `kebab()` 是两套独立实现（前者产出 `--semantic-accent`，
后者产出 `--accent`），再加 FLOAT 不带 px → 51 处全部假 FAIL。教训与
`packages/common/src/normalizer.ts` 那条一致：**跨端共用逻辑必须单一实现**。
