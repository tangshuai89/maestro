# AETHER D 系列 — 现状总表（2026-09-20）

> 一页看完：哪几项真做完了、证据是什么、还欠什么人工动作、哪些**原计划的前提被实测推翻**。
> 逐项细节在 `specs/d<NN>-*/`，Figma 侧演进在 `figma-driven-frontend.md` §9。

## 1. 主表

| # | 内容 | 状态 | 证据（2026-09-20 实测） | commit |
|---|---|---|---|---|
| **D1** | 03 · Screens 补 6 屏 Modal/Full | ✅ 完成 | audit-d1 18/18；6 屏 node `466:2`…`479:2` | 2026-09-10 |
| **D2** | 视觉双世界收敛 + Archive README | ✅ 完成 | v4 审计 34/36 基线未破 | 2026-09-10 |
| **D3** | 12 条 prototype wirings + 3 条轮播 | ⚠️ **部分**：02 页 9 条组件级连线在；**03 页 3 条 frame 级 + 3 条轮播并不存在** | REST `?depth=7` 全文件 57 个带连线节点 | — |
| **D4** | 变量 ↔ SCSS 双向漂移门禁 | ✅ 完成 | `tokens:check` → 52 token 一致；反方向遮蔽检测在跑 | `2b36fcb` `faad44b` |
| **D5** | Code Connect 补 5 个映射 | ✅ 完成（D1 顺带做掉） | `figma-code-connect.json` 无 `PLACEHOLDER` | 2026-09-10 |
| **D5_NEW** | 02 页建 10 个 component set | ✅ 完成 | strict **110/110**；24 个 set / 28 变体 | `0738966` |
| **D6** | description 模板 + 审计 | ⚠️ 仓库侧完成；**audit-d6 有两个 bug**（`0/150` 是假警报） | 修法已写进 `specs/d6-description-template/tasks.md` | 2026-09-10 |
| **D7** | NowPlaying 三屏改变体 | ✅ 结构完成（连线待手工） | 转换前后连线都是 57，一条没丢；图层名跨变体一致 | `6110e21` |
| **D8** | 桌面尺寸适配 | ✅ 完成（**前提被改写**） | 三档 density + 20 条单测；960 档从 0.67× 提到 0.95× | `3d77586` |
| **D10** | MOTION SPEC 机器可读 | ✅ 完成（**载体被改写**） | audit-d10 **20/20**，含 Figma ↔ 仓库 id 集合一致 | `bcc09fe` |
| **D11** | Playwright 视觉回归 + CI | ✅ 完成 | 6/6 绿；**故障注入 3 红**（双向验过） | `fa16e95` |

## 2. 还欠人工的（脚本做不了）

| 事项 | 为什么必须人工 | 怎么做 |
|---|---|---|
| D3 + D7 的 **6 条手连**（3 条 Smart Animate + 3 条 After delay 轮播） | 插件 API 写不了 interactions（平台限制） | `docs/prototype-wiring-checklist.md` 的「变体间连线操作单」；连完我用 REST 复查条数 |
| D8 / D11 的**真机手感验收** | 本环境无 GUI；基线只管"有没有变"，不管"好不好看" | `npm run dev`，把窗口拖到 960 / 1200 / 1920 |
| **D4-C1** `--text-dim` 修法 | 改的是语义（0.4 vs 0.55） | 建议按 Figma README 自己写的 A11y 约定改成 **0.55**，再删掉 `_tokens.scss` 那行死代码 |
| **D4-C2** CI 实时腿的 `FIGMA_TOKEN` | 要 Enterprise `file_variables:read` | 有该套餐 → 配 GitHub secret；没有 → 走 MCP 手动刷新（已通） |
| **推送 29 个 commit** | 你的仓库你按按钮 | `git push` |

## 3. 原计划前提被实测推翻的四处（已改写，不是"没做完"）

| 原计划 | 实测 | 改成 |
|---|---|---|
| D8 = 做 1280/1920 两个**尺寸帧** | 代码是固定 1440×900 画布 + `transform:scale()`；1440 稿最小可用宽度 **1330px**，而窗口默认 1200、最小 960 → 重排必压住 | **三档 density + 内容减法**；1920 档不需要设计帧（缩放 1.29× 反而更清楚） |
| D10 = 把 JSON 写进 **frame description** | FRAME 没有 `description` 属性（`'description' in frame === false`，写会抛错、REST 也不返回） | 隐藏 TEXT 子节点 `MOTION_SPEC`（同 D1 的 `AI_CONTRACT`） |
| D3 = "12 条连线全部命中"（2026-08-21 记录） | 03 页**没有** frame 级连线；`AFTER_TIMEOUT` 只在 99 · Archive 的三帧上 | 文档已加状态更正，D3 归入"待手工" |
| D5_NEW = 用户在 Claude Code 里喂 use_figma | Figma MCP 的 OAuth 已通（**不需要 PAT scope**） | 由 Codex 直接执行；跑之前只读探测还抓出 3 个会让整段回滚的 bug |

## 4. 已发现但**故意没做**的（独立专题候选）

| 项 | 内容 | 现状 |
|---|---|---|
| **D4-C5** | **44/52** 生成层 token 从未被 `var(--x)` 消费；`_theater.scss` 一个文件就另有 11 处 AETHER 调色板硬编码 | 已量化并记进 `specs/d4-token-drift/spec.md` §5.1；建议先做硬编码扫描出清单 |
| **D4-C4** | 硬编码 hex 扫描（"有没有绕过 token 直接写颜色"） | 未开工 |
| D6 收尾 | audit-d6 两个 bug（载体读错 + 把每个变体当独立目标）修完后，再给 v4-ABC 14 个组件补 description | 修法已写进 tasks |
| D11 可选 | 动效比对（录屏/gif）—— 现在的基线把动效**停住**了，测不到动效本身 | 明确不在 D11 范围 |

## 5. 其它线（非 Figma，仅供参考）

| 线 | 现状 |
|---|---|
| 推荐（reco v2 + 离线评测基座） | 已提交未推（`7f4d94e` `c7ae90c` `c43e618`） |
| Spotify EVS 签名链 | 卡外部：$99/年 Apple Developer + Premium 账号 |
| 打包 `npm run pack` 出 dmg | 卡 `7zip-bin` 传递依赖（需 `npm install` 恢复） |
| Stability：Spotify Widevine 500 | 未修 |
