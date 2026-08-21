# AI 还原试点报告 — Button/Like

日期：2026-08-21 · 文件：FtbRZXvzlCp4Sq9e322cQQ · 还原对象：02 页 `Button/Like` 组件集（3 变体）

## 试点目的

验证 Figma 驱动链路闭环：**设计稿 → REST JSON → AI → React/SCSS**。AI 仅凭
REST 导出的组件子树（`/tmp/aether-segments/pilot-input.json`，46KB）+ 令牌生成物
（`_tokens.generated.scss`）+ 规格文档，独立还原组件代码，不接触 Figma UI。

## 链路输入（AI 实际拿到的）

1. `pilot-input.json` — REST 精简导出：Icon/Heart + Button/Like（3 变体）+ Core/Play + Controls/Transport
   （布局、填充、描边、圆角、效果、文本、组件属性引用、变量绑定标志）
2. `packages/renderer/src/styles/base/_tokens.generated.scss` — 51 个设计令牌
3. `docs/aether-theater-v4-spec.md` — 组件语义与动效规格

## 还原产物

- `docs/ai-reproduction-pilot/ButtonLike.tsx` — 三态组件（unliked/liked/fanout + fanOutCount）
- `docs/ai-reproduction-pilot/ButtonLike.module.scss` — 40×40 / radius-8 / 玻璃底 / 红晕 / 徽章

## 验证结论 ✅ 链路成立

- AI 从 JSON 正确提取：40×40 尺寸、radius 8 绑定、glass-fill/glass-stroke 变量、
  liked 红底 18% + 红描边 + DROP_SHADOW(r10/s1/红40%)、fanout 徽章（accent 90% + 计数文本）
- 正确识别心形为「纯描边、无填充」（三态 Vector 均只有 strokes）——未做「liked 实心」的错误假设
- 正确使用令牌：`--radius-8` / `--glass-fill` / `--glass-stroke` / `--status-liked` / `--accent`；
  缺失的 18%/90% 叠加态用 `color-mix` 派生而非硬编码
- 动效约定落地：tap 100ms scale 0.96→1（MOTION SPEC 一致）
- 诚实标注未知项：徽章绝对坐标（导出无 x/y）、文本字号（10px 为倒推近似）——留 TODO/注释，未编造

## 试点暴露的问题（已修复/已记录）

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | `figma-export-tokens.mjs` 把 ease STRING 变量导出成带引号字符串（`"cubic-bezier(...)"`） | `var(--ease-out)` 在 transition 里整条失效（renderer `_cover-card.scss` 等真实在用） | ✅ 已修复（ease-* 裸输出）并重新生成 tokens |
| 2 | 试点初版依赖 `lucide-react`，renderer 未安装该包 | 编译不过 | ✅ 已改为内联 SVG（与 MonsterBeatsView 同款 heart path，零依赖） |
| 3 | REST 导出不含节点绝对坐标 | 徽章右上角偏移只能估算 | 📝 已知限制：设计稿以 auto-layout 为准，坐标由布局推导 |

## 结论

**Figma 驱动链路验证通过**：AI 可仅凭设计稿文件还原出结构正确、令牌复用、
动效一致、无幻觉的组件代码。语义化命名 + 变量绑定 + README 契约是链路质量
的三个关键支撑；导出工具 bug 由试点直接暴露并修复，证明「还原试点」作为
管线质检环节有效。

## 复现方法

```bash
# 1. 导出组件子树 JSON（需 FIGMA_TOKEN）
FIGMA_TOKEN=<token> node /tmp/aether-segments/export-pilot.mjs > pilot-input.json
# 2. 跑还原（claude CLI 或等效 AI，prompt 见 /tmp/aether-segments/prompt-pilot.md）
# 3. 对比产物与 02 页组件：尺寸/令牌/变体/动效逐项核对
```
