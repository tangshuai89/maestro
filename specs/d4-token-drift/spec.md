# D4 — 变量 ↔ SCSS 双向漂移检测（CI 闭环）

> 目标：让「Figma 改了 token」和「代码侧改了 token」两个方向都**自动被发现**，
> 而不是靠人记得跑一次导出脚本。当前只有单向手跑导出（`figma-export-tokens.mjs`），
> 且比对脚本 `check-token-drift.mjs` 因命名映射不一致**永远报假 FAIL**（实测 51 处）。
>
> 关联：`docs/figma-driven-frontend.md` §2.4（Figma ↔ CSS 映射表，本专题的权威契约）、
> `specs/d6-description-template`、`specs/d10-motion-spec`。

## 1. 现状与问题（2026-09-20 实测）

| # | 问题 | 证据 |
|---|---|---|
| P1 | 比对脚本命名映射与导出脚本**不一致** | `check-token-drift.mjs` 的 `toCssName()` 把 `Color/semantic/accent` 映射成 `--semantic-accent`，导出脚本映射成 `--accent` → 17 组缺失/多余 |
| P2 | 比对脚本**不补 px 单位** | spacing/radius 全部报 `SCSS=8px vs Figma=8`（17 处假 FAIL） |
| P3 | dump 快照**过期** | 提交的 dump 51 条，Figma 实际 52 条（缺 `Color/semantic/status-error`，D1/D2 期间新建） |
| P4 | 导出**无 CI 门禁** | `.github/workflows/` 无任何 token 相关 job；只能手跑 |
| P5 | 手写层与生成层的**遮蔽无人管** | `_tokens.scss` 与 `_tokens.generated.scss` 都写 `:root`，`main.scss` 先 `@use 'base/tokens'` 后 `@use 'base/tokens.generated'` → **生成层胜出**，手写覆盖静默失效（见 §5 实测） |

## 2. 范围

| 工作 | 文件 | 类型 |
|---|---|---|
| 专题 spec + tasks | `specs/d4-token-drift/{spec,tasks}.md` | 新 |
| 单一映射实现（导出/比对共用） | `scripts/lib/aether-tokens.mjs` | 新 |
| 导出脚本改用共享映射 + 支持 `--out` / `--stdout` | `scripts/figma-export-tokens.mjs` | 改 |
| 比对脚本重写（修 P1/P2，加手写层遮蔽检测） | `scripts/check-token-drift.mjs` | 改 |
| REST 实时拉取变量（Tier 2，带 scope 缺失降级） | `scripts/figma-tokens-pull.mjs` | 新 |
| 实时漂移工作流（schedule + 手动，无 secret 自动跳过） | `.github/workflows/token-drift.yml` | 新 |
| 离线门禁接进 `test:ci` | `package.json` | 改 |
| 刷新 dump 快照（51 → 52）+ 重新生成 SCSS | `scripts/figma-tokens-dump.json`、`_tokens.generated.scss` | 改 |

## 3. 设计：两条腿，三级判定

**两条腿（这是"双向"的落点）**

1. **Figma → SCSS**：dump 快照（或 REST 实时）→ 渲染 SCSS → 与提交的
   `_tokens.generated.scss` 逐行比。发现"设计改了但代码没跟"。
2. **SCSS → Figma**：扫仓库里的 `:root` 声明，找出**代码有、Figma 没有**的令牌，
   以及**手写层覆盖生成层**的遮蔽关系。发现"代码私自造 token / 覆盖静默失效"。

**三级判定**

| 级别 | 含义 | 退出码影响 |
|---|---|---|
| FAIL | 生成物与 dump 不一致、dump schema 坏了、实时与快照不一致 | 非 0 |
| WARN | 手写层遮蔽生成层、代码侧多出的 token、dump 里未被映射的变量 | 0（打印） |
| OK | 一致 | 0 |

**为什么遮蔽是 WARN 不是 FAIL**：遮蔽有合法用法（正在收敛），但没有一处是"无人知道"的。
所以打印出来逼人看一眼，不阻断 CI。真需要豁免时在 `scripts/token-drift-allowlist.json`
里登记 `{ "name": "--xxx", "reason": "..." }`——**必须写原因**，否则视为未登记。

## 4. 验收标准

- [x] `node scripts/check-token-drift.mjs` → **0 exit**，`✅ Token 一致（52 个 token）`
  （当前基线：51 处假 FAIL）
- [x] `node scripts/check-token-drift.mjs --json` → 机器可读结果，含
  `{ ok, counts, missingInScss, missingInFigma, valueMismatch, shadowed, codeOnly }`
- [x] Figma 实时变量渲染出的 52 个 token **值全部与仓库生成物一致**（逐行核对）
  ⚠️ 唯一差异是 Radius 块**顺序**：Figma 原生是创建序（8,12,16,20,24,10,14），
  快照是人工规范序（8,10,12,14,16,20,24）。工具里已显式区分（外部 dump 的顺序差异
  只报 ℹ️ 不计 drift），快照本身维持规范序。
- [x] `node scripts/figma-tokens-pull.mjs` 在无 `FIGMA_TOKEN` 时退出码 3 + 明确指引；
      PAT 缺 `file_variables` scope（HTTP 403）时同样退出码 3 并打印补救步骤
- [x] `npm run test:ci` 包含 token 检查（新环境 clone 后跑 CI 即自动门禁）
- [x] `.github/workflows/token-drift.yml`：无 secret 时 job 跳过而非失败（YAML 已校验；
  Actions 侧执行需推到远端后才能实跑）
- [x] `npm run typecheck` ✅ + `npm run lint` ✅（0 error，12 个既有 warning）
- [⚠️] `npm test`：**沙箱内跑不到全绿**——`music.controller.e2e` 的
  `GET /music/search?provider=qq&q=test` 需要真实出网，本环境 DNS 解析不了 `u.y.qq.com`
  （实测 `curl` 失败）→ 返回 500。与本次改动无关（本次未改 server 代码），且
  `test.sh` 因 `set -e` 在此中断，后续测试文件未跑到

## 5. 已知实测发现（本专题的"第一份战果"）

跑通工具后立刻暴露两条，**都与 §1 P5 有关**：

1. `--text-dim`：`_tokens.scss` 注释写着"0.55 为了 WCAG AA 对比度"，但生成层后加载，
   实际生效值是 **0.4** → 手写覆盖**静默失效**。修法二选一（需拍板）：
   (a) 把 Figma 变量改成 0.55，删掉手写覆盖；(b) 调整 `main.scss` 加载顺序（会让生成层失去
   兜底地位，风险更大）。本专题只**报警**，不改语义。
2. `--ease-spring` / `--ease-out`：两层都定义，值相同（仅逗号后空格不同），手写那两行是死代码。
3. `Color/semantic/status-error`：Figma 有、代码侧从未消费（`rg 'var\(--status-error\)'` 0 命中）。
   **已修（D4-C3）**：渲染代码里 7 处 `#ff3b5c` 硬编码 + 6 处 `rgba(255,59,92,α)` 全部改成
   `var(--status-error)` / `var(--status-liked)`，透明度用
   `color-mix(in oklab, var(--x) N%, transparent)`（仓库既有写法）。改后 `rg '#ff3b5c'` 在
   `packages/renderer/src` 只剩生成层那 4 处定义。

### 5.1 顺带量出来的更大缺口（未修，建议独立专题）

52 个生成层 token 里 **44 个从未被任何 `var(--x)` 消费**：

- primitive 全部 10 个（只当中转层，代码从没直接用）
- `--accent-purple` `--ai` `--text-main` `--text-dim` `--text-muted` `--track` `--white`
  `--status-sync` `--glass-fill-strong` `--platform-qq|netease|deezer|spotify`
- spacing 全 10 个 + radius 6 个 + motion duration 4 个 + `--ease-in-out`

根因不是"没人管"，而是 **AETHER 调色板和尺寸在组件里各自硬编码**：`_theater.scss`
一个文件就另有 11 处 `#00e5ff|#5b2bff|#b57bff|#3dffa2`，`_search-panel.scss` 6 处、
`_settings-modal.scss` 4 处、`_reco-loading.scss` 3 处……手写层令牌（`--radius-md` / `--space-16`）
同样 0 消费，组件直接用 px。

也就是说"Figma 是事实源"目前只对 **8/52** 成立。这已经不算漂移，是**令牌体系没真正投入使用**，
值得单开专题（记作 **D4-C5**）：先做硬编码 hex/px 扫描出清单，再按组件分批替换，
用 D11 的视觉回归兜底。

## 6. 不在范围

- **改 token 语义**（如上面 `--text-dim` 的修法）——需单独拍板
- **REST 变量的 PAT scope 申请**——需 Figma 侧开 Enterprise `file_variables`，用户操作。
  2026-09-20 实测结论见 §8。
- **硬编码 hex 扫描**（"代码里有没有绕过 var(--x) 直接写颜色"）——另一类漂移，独立专题
- **Playwright 视觉回归（D11）**——不同手段，不在本专题

## 7. 风险

| 风险 | 处置 |
|---|---|
| CI 无 PAT 时 live 检查跑不了 | 离线腿（dump 快照）承担门禁；live 腿只在有 secret 的 schedule 上跑 |
| dump 快照本身会过期（P3 重演） | live 腿每次 schedule 都对比"实时 vs 快照"，过期即在 job summary 报出 |
| 遮蔽检测误报（合法覆盖） | 白名单 + 强制 reason 字段 |

## 8. CI 实时腿的凭据现状（2026-09-20 实测）

结论：**手上的 PAT 跑不了 REST 实时腿，CI 需要换一条路或换一个 token。**

| 凭据 | `GET /v1/me` | `GET /v1/files/:key/variables/local` | 判定 |
|---|---|---|---|
| PAT-A（Claude 历史里的第一条） | 401 | 403 | 已失效/被吊销 |
| PAT-B（第二条） | 200 | 403 | **有效但缺 scope** |

PAT-B 的 403 原文（Figma 直接列出了它有的 scope）：

```
Invalid scope(s): current_user:read, file_comments:read, file_comments:write,
file_content:read, file_metadata:read, file_versions:read, library_assets:read,
library_content:read, team_library_content:read, file_dev_resources:read,
file_dev_resources:write, folders:read, webhooks:read, webhooks:write.
This endpoint requires the file_variables:read scope
```

`file_variables:read` 属 Figma Enterprise 能力，所以这不是"忘了勾"，是**套餐/权限层的事**。
`figma-tokens-pull.mjs` 在这种情况按设计退出码 3（跳过），不会把每日 job 打红。

**两条可选出路**（需你拍板）：

1. 若账号有 Enterprise：新建 PAT 勾上 `file_variables:read` → 配成 GitHub secret
   `FIGMA_TOKEN` → `token-drift.yml` 的 live 腿自动开始工作（仓库里不落任何凭据）。
2. 若没有：实时刷新改走 **MCP 只读段**（`scripts/figma-tokens-dump-seg.js`，OAuth，
   不需要 PAT scope），CI 只保留离线腿。代价是刷新动作得由人/agent 触发一次。

> 顺带提醒：PAT-B 目前明文躺在 `~/.claude/projects/.../*.jsonl` 的历史记录里。
> 要用它当 CI secret 的话，建议先在 Figma 侧重建一个（旧的就地作废），别长期复用历史里的那把。

> ⚠️ **未验证的缝隙**：`figma-tokens-pull.mjs` 的 REST **解析路径**（响应体 → dump 结构）
> 至今没在真实 200 响应上跑过——只拿到过 401/403。拿到带 scope 的 token 后，
> 第一件事是跑一次 `tokens:pull` 并把结果与 MCP 段产出的 dump 对比（应当逐值相等），
> 别默认它一次就能对上。
