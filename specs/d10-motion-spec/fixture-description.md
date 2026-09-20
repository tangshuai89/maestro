# D10 载体与写入操作单（MOTION SPEC）

> 目标：让 AI 读 Figma 文件时能**直接 parse** 动效规格，而不是只看到一张人读的表格。
>
> ⚠️ **2026-09-20 修正**：原计划把 JSON 写进 `MOTION SPEC` frame 的 **description** 字段 ——
> 这条路走不通。实测 `'description' in frame === false`：`description` 只挂在
> `COMPONENT` / `COMPONENT_SET` 上，往 FRAME 写会抛
> `in set_description: no such property 'description' on FRAME node`，REST 也不返回该字段。
> 原文档里的"方案 A"还用了 `require('fs')` 读仓库文件 —— use_figma 沙箱**没有 fs**，
> 那段代码在真实 Figma 里必然报错，只有 mock 跑得动。
>
> 详见 @/Users/tangshuai/knowledge/frontend/figma-plugin-api-write-gotchas.md §1 与 §6。

## 实际载体

`04 · Motion` 页 `MOTION SPEC` frame（node `314:2040`，1440×334）内的**隐藏 TEXT 子节点**：

| 项 | 值 |
|---|---|
| 节点名 | `MOTION_SPEC`（与 D1 的 `AI_CONTRACT` 同一套命名） |
| 当前 node id | `508:2` |
| `visible` | `false` |
| `fills` | `[]`（不进"自有填充变量绑定率"统计的分母） |
| `characters` | `---\n{"MOTION_SPEC":"1.0","spec":[...]}\n---` |
| 长度 / 指纹 | 6295 字符 · djb2 `6c55cc64`（2026-09-20） |

为什么 REST 读得到：隐藏 TEXT 节点的 `characters` 照常出现在 `/v1/files/:key` 的节点树里
（只要 `depth` 够），所以 AI 侧不需要 Dev Mode 也能拿到。

## 怎么写（唯一姿势：跑生成器）

```bash
# 1. 打印可直接粘贴的 use_figma code（内部会内联 specs/motion-spec.json 的紧凑 JSON）
node scripts/figma-aether-v4-motion-spec-write.js

# 只想看预期回读值：
node scripts/figma-aether-v4-motion-spec-write.js --check
```

把 stdout 那整段作为 `use_figma` 的 `code` 参数（`fileKey=FtbRZXvzlCp4Sq9e322cQQ`，
`skillNames=resource:figma-use`）。段脚本**幂等**：会先删掉旧的同名子节点再重建。

> 生成器存在的理由：use_figma 没有 fs，spec 只能内联进 code 参数。与其每次手抄 6.3KB
> JSON（会随 spec 演进漂移、还容易抄错），不如让 `JSON.stringify()` 生成字符串字面量，
> 保证写进 Figma 的永远是仓库文件的忠实副本。

## 怎么验（两层，都要过）

**第一层 · 指纹比对**（写完立刻可查，不依赖网络）

段脚本 `return` 的 `charsLen` / `djb2` 与 `--check` 打印的预期值比对。一致 = 写进去的内容
与仓库文件逐字节相同。这比肉眼看可靠：2026-09-20 首次写入回读 `charsLen=6295 djb2=6c55cc64`，
与本地预期完全一致。

**第二层 · 审计脚本**（走 REST，需要 token）

```bash
FIGMA_TOKEN=<token> node scripts/figma-aether-v4-audit-d10.mjs
```

只读 `/v1/files/:key?depth=4`，只需要 `file_content:read`（**不需要** `file_variables`，
所以普通 PAT 就能跑）。期望输出：

```
PASS  MOTION_SPEC 段内 JSON.parse — 6287 字符
PASS  顶层有 spec 数组 — 共 20 条
PASS  所有 spec 必填字段合规 — 20/20 PASS，0 FAIL
PASS  Figma ↔ 仓库 spec id 集合一致 — 共 20 条
20/20 spec 合规 ✅ 全部达标
```

离线自测（不联网）：`node scripts/figma-d10-fixture.js /tmp/d10-fix.json` 然后用
`--fixture /tmp/d10-fix` 跑审计；fixture 里带 1 条**故意的**负面用例（缺 driver），
所以离线预期是 `20/21`。

## Schema 字段约定

| 字段 | 必填 | 取值 |
|---|---|---|
| `id` | ✅ | 唯一字符串（如 `btn-play-hover`） |
| `category` | ✅ | `interaction` / `transition` / `ambient` / `screen-flow` |
| `component` | ✅ | Figma 已存在组件名（如 `Core/Play`） |
| `trigger` | ✅ | `ON_HOVER` / `ON_CLICK` / `ON_PRESS` / `MOUSE_DOWN` / `AFTER_TIMEOUT` / `track-time` / `audio-reactive` |
| `from_state` / `to_state` | interaction/transition/screen-flow 必填 | 变体名 |
| `duration_ms` | transition/screen-flow 必填 | 整数 |
| `easing` | transition/screen-flow 必填 | CSS easing 或预设 |
| `driver` | ambient 必填 | `bass-intensity` / `currentTime` / `pointer` / `audio-rms` / `track-id-seed` 等 |
| `animation` | ❌ | 默认 `smart-animate` / `css-keyframe` / `spring` |
| `tokens` | ❌ | 数组，引用 Color/Spacing/Radius 变量名 |
| `description` | ❌ | 人读说明 |

## 与 Figma interactions 的关系

- **Figma interactions**（D3 手动连的 12 条 + 3 条轮播）— 运行时实际跑的动效
- **本 JSON 规格**（D10）— 描述每条动效的参数（duration / easing / trigger / driver），让 AI parse

audit-d10 只校验 JSON 自身合规 + 与仓库 id 集合一致，**不**交叉校验 Figma 实际 interactions
（那是 `figma-aether-v4-audit.mjs` 的事）。
