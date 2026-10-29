# 把 AI_CONTRACT 段写回设计稿 —— 操作指引

> 关联：`specs/figma-diff/spec.md` §10 · `scripts/figma-write-plugin/` · `scripts/figma-contract-payload.mjs`
>
> 这份指引是**给人照着做**的，不是给 agent 读的。

---

## 一句话

**不用等 Figma 席位升级。** 用「本地开发插件」把契约草案写进设计稿 ——
插件的写入权限是**你自己对该文件的编辑权**，不看套餐、不看席位，也不吃 MCP 配额。

---

## 前置条件

| #   | 条件                                    | 为什么                                                    |
| --- | --------------------------------------- | --------------------------------------------------------- |
| 1   | **Figma 桌面 App**（不是浏览器版）      | 「Import plugin from manifest」要读本地文件，浏览器读不到 |
| 2   | 你对 AETHER 文件有**编辑权**            | 插件以你的权限写；文件是 view-only 就写不进去             |
| 3   | 当前处于 **Design 模式**，不是 Dev Mode | Dev Mode 是只读检视视图，插件的写操作直接返回错误         |
| 4   | 仓库里的产物是**最新的**                | `npm run figma:payload:check` 会验证这一点                |

> **Dev Mode 怎么切**：Figma 顶部工具栏的模式切换，或按 `Shift+D`。
> **`Shift+D` 是双向开关**，不是单向入口 —— 按过头会切到 Dev Mode 又切不回来，得点工具栏。

---

## 三步

### 第 1 步 · 生成产物

```bash
npm run figma:payload
```

输出三样东西：

- `scripts/figma-contract-payload.json` —— 待写清单（机器可读）
- `scripts/figma-write-plugin/code.js` —— 插件产物（payload 内联在这里）
- **终端里的审阅报告** —— 逐节点列出「哪个字段是从哪来的」

**先看报告再写进设计稿。** 报告里有两节要你亲自过目：

- 「⚠️ 这 N 个组件的 a11y 是**按名字语义推断**的」—— 设计稿上本来就没规定无障碍语义，
  这里给的是按名字该有的最小角色约定，`keyboard` 一律留空（键位是真正的设计决定，猜错代价大）。
- 「⚠️ 这 N 个组件指向的文件在仓库里还不存在」—— 它们就是 `figma:diff` 会报的 **must**，
  意思是「前端该建这些组件」。

### 第 2 步 · 导入插件

1. 打开 **Figma 桌面 App**
2. 菜单 **Plugins → Development → Import plugin from manifest**
3. 选 `scripts/figma-write-plugin/manifest.json`
   （仓库根目录是 `/Users/tangshuai/maestro`，完整路径：
   `/Users/tangshuai/maestro/scripts/figma-write-plugin/manifest.json`）
4. 导入成功后，**Plugins → Development** 菜单里会出现 **AETHER Contract Writer**

> ⚠️ 选不中文件？多半是选了 `plugin.src.js`。**必须选 `manifest.json`**。
> ⚠️ 插件不能发布到社区也能用 —— 本地开发模式不需要审核。

### 第 3 步 · 跑

1. 打开 **AETHER 文件**（fileKey `FtbRZXvzlCp4Sq9e322cQQ`）
2. 确认处于 **Design 模式**
3. **Plugins → Development → AETHER Contract Writer**
4. 看右上角通知：`AETHER 契约写入：应用 15 · 跳过 0 · 失败 0`
5. 插件的完整报告在 Figma 的 **console**（开发者工具）里

**重复跑是安全的**：生成器只产出「还没有契约段」的节点，插件运行时再查一次载体 ⇒
不会覆盖已有契约、不会叠加。
（判「有没有契约段」的口径 = **能否提取出 `---` 包裹的段**，与采集段**同一份实现** ——
不是「文本里有没有 `AI_CONTRACT:`」这个关键词。后者会把散文里顺口一提当成「已写过」。）

**已有人工写的描述不会被抹掉**：插件是**合并**而不是覆盖 —— 契约段加在前面，
你写的散文原样保留在后面。（21 个组件本来就有散文描述，这是最容易出事的地方。）

---

## 跑完之后

```bash
# 1. 重跑采集（用 scripts/figma-snapshot-seg.js 的 SEG1 段）
#    → 产出新的 scripts/figma-snapshot.json
# 2. 重新生成草案（快照变了，草案要跟上）
npm run figma:payload

# 3. 看差异清单 —— components 腿的覆盖率应该从 10 个组件变成 25 个
npm run figma:diff
```

> ⚠️ **第 1 步必须做**：不重跑采集，`figma:diff` 读的还是旧快照，
> 看不到新写的契约 —— **现场看不出任何异常**（这就是 `--check` 那条腿存在的原因）。

---

## 出问题怎么办

| 症状                                 | 原因                                             | 修法                                                    |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| 通知说「应用 0 · 跳过 N」            | 节点都已有契约段（幂等命中）                     | 正常。若预期该写，检查报告的 skipped 原因               |
| 通知说「失败 N」                     | 看 console 的 error                              | 多半是字体加载失败（文档里没有可加载的字体）            |
| 什么都没发生、也没通知               | 插件没跑到，或在 Dev Mode                        | 确认 Design 模式；确认 Plugins → Development 菜单里有它 |
| 找不到节点（node-not-found）         | 快照的 nodeId 与当前文件对不上（设计稿被重建过） | 重跑采集拿新 nodeId，再重新生成草案                     |
| `npm run figma:payload:check` 报过期 | 快照更新了但草案没重新生成                       | 跑 `npm run figma:payload`                              |
| 导入插件时报 manifest 解析失败       | 选错文件了                                       | 必须选 `manifest.json`，不是 `plugin.src.js`            |

> **插件跑完怎么确认写对了**（别只看通知）：
> 通知只告诉你「应用了几条」，不告诉你**内容对不对**。
> ⚠️ `npm run figma:payload:check` **不能**证明这一点 —— 它只比对
> 「仓库里的产物」与「仓库里的快照」是否同步，**跟 Figma 里实际写了什么无关**。
> 快照没更新时它照样绿（典型的假绿）。
> ⇒ 真正的自查只有一条：**重跑采集**，看新快照里那些组件的 `contract` 字段有没有内容，
> 再跑 `npm run figma:diff` 看 components 腿的覆盖率是否从 10 个涨到 25 个。
> 想逐条看内容 ⇒ 用 Figma 的 Dev Mode 或直接看节点的 description。

---

## 边界（重要）

- **插件只写「还没有契约段」的节点** ⇒ 它**不会**修正已有人工契约里写错的内容。
  要改已有契约，得先在 Figma 里手动删掉旧的契约段，再跑一次插件。
- **但已有的人工描述会被保留** ⇒ 契约段加在**前面**，你写的散文原样留在后面。
  （插件是「合并」不是「覆盖」—— 这条是 2026-10-29 修掉的 P0，
  原来的写法会把 21 个组件的设计文档直接抹掉。）
- **草案不是权威** ⇒ 整段带 `draft: true`，且 `provenance` 标注了每个字段的来源。
  落地后应该**人工审阅**再当设计契约用。
- **19 个节点被跳过**（`Icon/* ×8` · `State/RecoUnconfigured` · `Scene/Backdrop` · 9 个屏幕）
  ⇒ 它们缺的不是「能写进 Figma」，是「在前端该对应哪个组件」⇒ 该先做 code-connect 补映射
  （tasks.md 的 I2 / I4），不是补契约能解决的。
- **插件本体没在真实 Figma 里跑过**（开发它的人没有桌面端）⇒
  离线能验的都验了（推导规则、写→读闭环、三端口径一致、采集段端到端模拟、
  **插件本体的 mock 测试**、变异 12/12 全被抓住），
  但**桌面端的运行时行为仍需你跑这一次确认**。
