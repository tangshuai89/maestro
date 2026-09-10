# D2 — 视觉双世界收敛（文档收尾 + Archive 标注）

> 范围：确认 AETHER 单视觉 + 文档/注释同步 + Figma 99 · Archive 标注"v3 旧视觉，不再扩展"。
> 关联：`docs/figma-driven-frontend.md` §5「覆盖范围」+ §9「实现状态」。

## 0. 现状修正

之前在 v4 评估里把 D2 列为 P0 缺口（"双视觉混用 / Monster Beats 残留"），但 2026-09-10
重新盘点代码：

- `components/views/MonsterBeatsView.tsx` **已删**（`components/player/` 整个目录都已不存在）
- `App.tsx` 只 import `TheaterView`——AETHER 单视图
- `_monster-beats.scss` 不存在
- `_transport.scss` / `_theater.scss` 全部用 `var(--text-secondary)` / `var(--ease-spring)`——令牌统一

**实际 D2 = 文档与 Figma 状态同步**，不需要重构代码。

## 1. 范围

| 改动 | 文件 | 类型 |
|---|---|---|
| 改注释 "Monster Beats view" → "AETHER Theater view" | `packages/renderer/src/App.tsx` L203-205 | 代码注释 |
| 删"Two visual worlds"段；加"AETHER 单视觉"声明 | `.superdesign/init/theme.md` | 文档 |
| L531-532：MonsterBeatsView → TheaterView（历史顺序重写） | `.superdesign/init/components.md` | 文档 |
| 6 处 MonsterBeatsView 引用 → TheaterView；mb-* 类说明 | `.superdesign/init/extractable-components.md` | 文档 |
| 加"D2 收敛 2026-XX-XX 完成" | `docs/figma-driven-frontend.md` §5/§9 | 文档 |
| 在 99 · Archive 顶部加 Archive README frame（红色 outline + 警告 + 链接） | `scripts/figma-aether-v4-archive-readme.js`（新）+ `figma-v4-d2-command.md` | Figma |

## 2. 不在 D2 范围

- **删除 99 · Archive 页**——保留作为 v3 视觉基准（v4-command.md 明确"不要动"）
- **视觉回归保护**（Playwright 截图 baseline）——升级到 D6 阶段 5 或独立 P3
- **AETHER 主题令牌扩展**（如缺 `--cover-glow` 之类的视觉 token）——如发现再加，不在 D2 范围

## 3. 验收

- [ ] `git grep -nE "MonsterBeats|monster-beats" packages/renderer/src` → 无残留（注释也行）
- [ ] `git grep -nE "MonsterBeats|monster-beats" .superdesign/init/` → 仅在历史说明中
- [ ] `find packages/renderer/src -name "*monster*"` → 0 文件
- [ ] `find packages/renderer/src/styles -name "*monster*"` → 0 文件
- [ ] `git diff --stat` 5 个文件改 + 1 个新脚本 + 2 个新 spec 文件
- [ ] `npm run typecheck` + `npm run lint` 0 error
- [ ] 真跑 Figma Archive README 段后：`node scripts/figma-aether-v4-audit.mjs` 不破坏 23/25
